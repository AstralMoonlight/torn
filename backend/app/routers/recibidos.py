"""Documentos de proveedores (intercambio, parte b): proxy hacia dte-torn.

dte-torn lee la casilla de intercambio, guarda los documentos, acusa recibo y
habla con el Registro de Aceptación o Reclamo del SII. Este router agrega la
autenticación y el tenant, y lo que es del backend: con qué compra se ingresó
cada documento, el proveedor y los productos que calzan con sus líneas.

Aceptar o reclamar compromete a la empresa ante el SII: lo hace quien tiene
Compras, igual que ingresar la mercadería.
"""

from decimal import Decimal, InvalidOperation
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.dependencies.tenant import get_current_global_user, get_current_tenant_user, get_tenant_db, requiere_permiso
from app.models.product import Product
from app.models.provider import Provider
from app.models.purchase import Purchase
from app.models.saas import SaaSUser, TenantUser
from app.schemas import ProviderOut
from app.services import dte_client

router = APIRouter(prefix="/recibidos", tags=["recibidos"], dependencies=[Depends(requiere_permiso("Compras"))])

#: Un sobre con cientos de documentos pesa unos pocos MB (`MAX_SOBRE` en dte-torn).
MAX_ARCHIVO = 10_000_000


def _llamar(method: str, path: str, tenant, actor: str | None = None, **kwargs):
    try:
        return dte_client.request(method, path, tenant, actor, **kwargs)
    except dte_client.DteError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _con_compra(db: Session, documentos: list[dict]) -> list[dict]:
    """Agrega a cada documento la compra con que se ingresó (o None)."""
    ids = [d["id"] for d in documentos]
    compras = dict(db.query(Purchase.dte_recibido_id, Purchase.id).filter(Purchase.dte_recibido_id.in_(ids)).all()) if ids else {}
    return [{**d, "compra_id": compras.get(d["id"])} for d in documentos]


@router.get("", summary="Documentos recibidos de proveedores")
def listar(
    desde: Optional[str] = None,
    hasta: Optional[str] = None,
    q: Optional[str] = Query(None, max_length=100),
    sin_responder: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    tenant_user: TenantUser = Depends(get_current_tenant_user),
    db: Session = Depends(get_tenant_db),
):
    params = {k: v for k, v in {"desde": desde, "hasta": hasta, "q": q, "sin_responder": sin_responder,
                                "limit": limit, "offset": offset}.items() if v not in (None, False)}
    return _con_compra(db, _llamar("GET", "/recibidos", tenant_user.tenant, params=params).json())


@router.get("/envios", summary="Correos recibidos con problemas")
def envios(con_problemas: bool = True, tenant_user: TenantUser = Depends(get_current_tenant_user)):
    """Los envíos que no se recibieron conformes o cuyo acuse no salió."""
    return _llamar("GET", "/recibidos/envios", tenant_user.tenant, params={"con_problemas": con_problemas}).json()


@router.post("", status_code=201, summary="Cargar el XML de un proveedor")
async def cargar(
    file: UploadFile = File(...),
    tenant_user: TenantUser = Depends(get_current_tenant_user),
    global_user: SaaSUser = Depends(get_current_global_user),
    db: Session = Depends(get_tenant_db),
):
    """Para un documento que llegó por otro lado (un correo personal, un pendrive)."""
    contenido = await file.read(MAX_ARCHIVO + 1)
    if len(contenido) > MAX_ARCHIVO:
        raise HTTPException(status_code=413, detail="El archivo es demasiado grande.")
    carga = _llamar("POST", "/recibidos", tenant_user.tenant, global_user.email,
                    files={"archivo": (file.filename or "envio.xml", contenido, "application/xml")}).json()
    carga["documentos"] = _con_compra(db, carga["documentos"])
    return carga


class LineaOut(BaseModel):
    nombre: str
    codigo: str
    cantidad: Decimal
    unidad: str
    #: Costo neto por unidad, ya con el descuento de la línea.
    costo_unitario: Decimal
    monto: int
    exento: bool
    #: El producto nuestro que calza por código o por nombre. None: hay que elegirlo.
    product_id: Optional[int] = None


def _decimal(texto: str | None, defecto: str = "0") -> Decimal:
    try:
        return Decimal((texto or defecto).strip() or defecto)
    except InvalidOperation:
        return Decimal(defecto)


def _producto(db: Session, codigo: str, nombre: str) -> Optional[int]:
    """Producto que se puede comprar (no un padre con variantes) con ese código
    interno o de barras, o si no, con ese mismo nombre."""
    con_variantes = db.query(Product.parent_id).filter(Product.parent_id.isnot(None))
    base = db.query(Product.id).filter(Product.is_deleted.isnot(True), Product.id.notin_(con_variantes))
    if codigo:
        encontrado = base.filter(or_(Product.codigo_interno == codigo, Product.codigo_barras == codigo)).first()
        if encontrado:
            return encontrado[0]
    if nombre:
        encontrado = base.filter(func.lower(Product.nombre) == nombre.strip().lower()).first()
        if encontrado:
            return encontrado[0]
    return None


def _lineas(db: Session, detalle: dict) -> List[LineaOut]:
    lineas = []
    for linea in detalle.get("lineas", []):
        cantidad = _decimal(linea.get("cantidad"), "1") or Decimal(1)
        monto = int(_decimal(linea.get("monto")))
        lineas.append(LineaOut(
            nombre=linea.get("nombre", ""), codigo=linea.get("codigo", ""), cantidad=cantidad,
            unidad=linea.get("unidad", ""), costo_unitario=(Decimal(monto) / cantidad).quantize(Decimal("0.01")),
            monto=monto, exento=bool(linea.get("exento")),
            product_id=_producto(db, linea.get("codigo", "").strip(), linea.get("nombre", "")),
        ))
    return lineas


@router.get("/{doc_id}", summary="Detalle de un documento recibido")
def ver(doc_id: UUID, tenant_user: TenantUser = Depends(get_current_tenant_user), db: Session = Depends(get_tenant_db)):
    """El documento con sus líneas, la compra con que se ingresó, el proveedor
    si ya existe y los productos que calzan con cada línea."""
    doc = _con_compra(db, [_llamar("GET", f"/recibidos/{doc_id}", tenant_user.tenant).json()])[0]
    proveedor = db.query(Provider).filter(Provider.rut == doc["rut_emisor"]).first()
    doc["provider_id"] = proveedor.id if proveedor else None
    doc["lineas"] = [linea.model_dump(mode="json") for linea in _lineas(db, doc["detalle"])]
    return doc


@router.get("/{doc_id}/xml", summary="XML del documento recibido")
def xml(doc_id: UUID, tenant_user: TenantUser = Depends(get_current_tenant_user)):
    r = _llamar("GET", f"/recibidos/{doc_id}/xml", tenant_user.tenant)
    return Response(r.content, media_type="application/xml",
                    headers={"Content-Disposition": r.headers.get("content-disposition", "inline")})


class AccionIn(BaseModel):
    #: ACD acepta, ERM recibo de mercaderías, RCD reclamo al contenido,
    #: RFP falta parcial, RFT falta total.
    accion: str


@router.post("/{doc_id}/accion", summary="Aceptar o reclamar en el SII")
def accion(
    doc_id: UUID,
    datos: AccionIn,
    tenant_user: TenantUser = Depends(get_current_tenant_user),
    global_user: SaaSUser = Depends(get_current_global_user),
    db: Session = Depends(get_tenant_db),
):
    doc = _llamar("POST", f"/recibidos/{doc_id}/accion", tenant_user.tenant, global_user.email,
                  json=datos.model_dump()).json()
    return _con_compra(db, [doc])[0]


@router.post("/{doc_id}/actualizar", summary="Consultar ahora al SII")
def actualizar(doc_id: UUID, tenant_user: TenantUser = Depends(get_current_tenant_user),
               db: Session = Depends(get_tenant_db)):
    return _con_compra(db, [_llamar("POST", f"/recibidos/{doc_id}/actualizar", tenant_user.tenant).json()])[0]


@router.post("/{doc_id}/proveedor", response_model=ProviderOut, summary="Proveedor del documento")
def proveedor(doc_id: UUID, tenant_user: TenantUser = Depends(get_current_tenant_user),
              db: Session = Depends(get_tenant_db)):
    """El proveedor del documento; si no existe, se crea con los datos que trae."""
    doc = _llamar("GET", f"/recibidos/{doc_id}", tenant_user.tenant).json()
    existente = db.query(Provider).filter(Provider.rut == doc["rut_emisor"]).first()
    if existente:
        return existente
    emisor = doc["detalle"].get("emisor", {})
    direccion = ", ".join(p for p in (emisor.get("DirOrigen"), emisor.get("CmnaOrigen")) if p)
    nuevo = Provider(
        rut=doc["rut_emisor"], razon_social=doc["razon_social_emisor"][:200],
        giro=(emisor.get("GiroEmis") or None) and emisor["GiroEmis"][:200],
        direccion=direccion[:200] or None, email=(emisor.get("CorreoEmisor") or None),
        telefono=(emisor.get("Telefono") or None), ciudad=(emisor.get("CiudadOrigen") or None),
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return nuevo
