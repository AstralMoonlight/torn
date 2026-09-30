"""Router para gestión de Clientes / Contribuyentes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies.tenant import es_admin, get_current_local_user, get_current_tenant_user, get_tenant_db, requiere_permiso
from app.models.saas import TenantUser
from app.models.cash import CashSession
from app.models.customer import Customer, CustomerPayment
from app.models.payment import PaymentMethod, SalePayment
from app.models.sale import Sale
from app.models.settings import SystemSettings
from app.models.user import User
from app.schemas import (
    CuentaCliente, CustomerCreate, CustomerOut, CustomerPaymentCreate, CustomerUpdate, MovimientoCuenta,
)

router = APIRouter(prefix="/customers", tags=["customers"])


def _solo_admin_da_credito(tenant_user: TenantUser, cambia_plazo: bool) -> None:
    """El plazo de crédito decide a quién se fía: lo pone el administrador."""
    if cambia_plazo and not es_admin(tenant_user):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Solo el administrador puede dar o quitar crédito a un cliente.")


@router.post("/", dependencies=[Depends(requiere_permiso("Clientes", "Terminal POS"))], response_model=CustomerOut, status_code=status.HTTP_201_CREATED,
             summary="Crear Cliente",
             description="Registra un nuevo cliente/contribuyente.")
def create_customer(customer: CustomerCreate, db: Session = Depends(get_tenant_db),
                    tenant_user: TenantUser = Depends(get_current_tenant_user)):
    """Registra un nuevo cliente / contribuyente en la base de datos.
    
    Valida que el RUT no esté duplicado.
    
    Args:
        customer (CustomerCreate): Datos del cliente.
        db (Session): Sesión DB.
        
    Returns:
        CustomerOut: Cliente creado.
        
    Raises:
        HTTPException(409): Si ya existe un cliente con ese RUT.
    """

    _solo_admin_da_credito(tenant_user, customer.dias_credito is not None)

    # Verificar que el RUT no exista
    existing = db.query(Customer).filter(Customer.rut == customer.rut).first()
    if existing and not existing.is_active:
        # Se había eliminado (desactivado): vuelve con los datos nuevos.
        for campo, valor in customer.model_dump().items():
            setattr(existing, campo, valor)
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un cliente con RUT {customer.rut}",
        )

    db_customer = Customer(**customer.model_dump())
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.get("/", dependencies=[Depends(requiere_permiso("Clientes", "Productos"))], response_model=list[CustomerOut],
             summary="Listar Clientes",
             description="Obtiene todos los clientes registrados.")
def list_customers(db: Session = Depends(get_tenant_db)):
    """Lista los clientes activos (los eliminados quedan desactivados)."""
    return db.query(Customer).filter(Customer.is_active.is_(True)).order_by(Customer.razon_social).all()


@router.get("/search", response_model=list[CustomerOut], summary="Buscar Clientes (Predictivo)")
def search_customers(q: str = "", db: Session = Depends(get_tenant_db)):
    """Busca clientes por RUT o Razón Social (coincidencia parcial)."""
    if not q:
        return []
    
    # Normalize query for RUT search (strip dots/dashes) if it looks like a RUT part
    clean_q = q.replace(".", "").replace("-", "")
    
    query = db.query(Customer).filter(
        Customer.is_active.is_(True),
        (Customer.rut.ilike(f"%{clean_q}%")) |
        (Customer.razon_social.ilike(f"%{q}%"))
    ).limit(10)
    
    return query.all()


@router.get("/{rut}", response_model=CustomerOut,
             summary="Buscar Cliente",
             description="Busca un cliente por su RUT.")
def get_customer_by_rut(rut: str, db: Session = Depends(get_tenant_db)):
    """Busca un cliente por su RUT.
    
    Args:
        rut (str): RUT del cliente (formato '12345678-9').
        db (Session): Sesión DB.
        
    Returns:
        CustomerOut: Cliente encontrado.
        
    Raises:
        HTTPException(404): Si no se encuentra el cliente.
    """

    customer = db.query(Customer).filter(Customer.rut == rut).first()
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró un cliente con RUT {rut}",
        )
    return customer


def _cliente(db: Session, rut: str) -> Customer:
    customer = db.query(Customer).filter(Customer.rut == rut).first()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Cliente con RUT {rut} no encontrado")
    return customer


@router.post("/{rut}/pagos", dependencies=[Depends(requiere_permiso("Clientes"))], response_model=CustomerOut, status_code=status.HTTP_201_CREATED,
             summary="Registrar pago de deuda",
             description="Baja la deuda de crédito interno. El pago en efectivo entra a la caja abierta.")
def registrar_pago(rut: str, pago: CustomerPaymentCreate, db: Session = Depends(get_tenant_db),
                   local_user: User = Depends(get_current_local_user)):
    customer = db.query(Customer).filter(Customer.rut == rut).with_for_update().first()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Cliente con RUT {rut} no encontrado")
    metodo = db.get(PaymentMethod, pago.payment_method_id)
    if metodo is None or metodo.code == "CREDITO_INTERNO":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Medio de pago no válido para pagar una deuda.")
    deuda = customer.current_balance or 0
    if pago.amount > deuda:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"El pago (${pago.amount:,.0f}) supera la deuda (${deuda:,.0f}).".replace(",", "."))

    sesion = None
    settings = db.query(SystemSettings).first()
    if metodo.code == "EFECTIVO" and (settings is None or settings.control_caja):
        sesion = db.query(CashSession).filter(
            CashSession.user_id == local_user.id, CashSession.status == "OPEN").first()
        if sesion is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Abra la caja para recibir un pago en efectivo.")

    customer.current_balance = deuda - pago.amount
    db.add(CustomerPayment(
        customer_id=customer.id, amount=pago.amount, payment_method_id=metodo.id,
        user_id=local_user.id, cash_session_id=sesion.id if sesion else None, nota=pago.nota,
    ))
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/{rut}/cuenta", dependencies=[Depends(requiere_permiso("Clientes"))], response_model=CuentaCliente, summary="Cuenta corriente del cliente",
            description="Saldo y movimientos de crédito interno (ventas, notas de crédito y pagos), el más nuevo primero.")
def cuenta(rut: str, db: Session = Depends(get_tenant_db)):
    customer = _cliente(db, rut)
    movimientos = []
    ventas = (
        db.query(Sale, SalePayment.amount)
        .join(SalePayment, SalePayment.sale_id == Sale.id)
        .join(PaymentMethod, PaymentMethod.id == SalePayment.payment_method_id)
        .filter(Sale.customer_id == customer.id, PaymentMethod.code == "CREDITO_INTERNO")
        .all()
    )
    for sale, monto in ventas:
        nc = sale.tipo_dte == 61
        movimientos.append(MovimientoCuenta(
            fecha=sale.fecha_emision, tipo="NOTA_CREDITO" if nc else "VENTA",
            detalle=f"{'Nota de crédito' if nc else 'Venta'} folio {sale.folio}",
            cargo=0 if nc else monto, abono=monto if nc else 0, sale_id=sale.id,
        ))
    for p in db.query(CustomerPayment).filter(CustomerPayment.customer_id == customer.id).all():
        movimientos.append(MovimientoCuenta(
            fecha=p.created_at, tipo="PAGO",
            detalle=f"Pago {p.payment_method.name}" + (f": {p.nota}" if p.nota else ""), abono=p.amount,
        ))
    movimientos.sort(key=lambda m: m.fecha, reverse=True)
    return CuentaCliente(saldo=customer.current_balance or 0, movimientos=movimientos)


@router.put("/{rut}", dependencies=[Depends(requiere_permiso("Clientes", "Terminal POS"))], response_model=CustomerOut,
             summary="Actualizar Cliente",
             description="Actualiza datos de un cliente existente.")
def update_customer(rut: str, customer_update: CustomerUpdate, db: Session = Depends(get_tenant_db),
                    tenant_user: TenantUser = Depends(get_current_tenant_user)):
    """Actualiza un cliente."""
    db_customer = db.query(Customer).filter(Customer.rut == rut).first()
    if not db_customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con RUT {rut} no encontrado"
        )
    
    # Update fields
    update_data = customer_update.model_dump(exclude_unset=True)
    _solo_admin_da_credito(tenant_user, update_data.get("dias_credito", db_customer.dias_credito) != db_customer.dias_credito)
    for key, value in update_data.items():
        setattr(db_customer, key, value)
    
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.delete("/{rut}", dependencies=[Depends(requiere_permiso("Clientes"))], status_code=status.HTTP_204_NO_CONTENT,
               summary="Eliminar Cliente",
               description="Desactiva un cliente: deja de aparecer, pero sus ventas y su deuda se conservan.")
def delete_customer(rut: str, db: Session = Depends(get_tenant_db),
                    tenant_user: TenantUser = Depends(get_current_tenant_user)):
    """Desactiva un cliente. Borrarlo chocaba con la FK de sus ventas."""
    if not es_admin(tenant_user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el administrador puede eliminar clientes. Pídaselo a administración.")
    db_customer = db.query(Customer).filter(Customer.rut == rut).first()
    if not db_customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con RUT {rut} no encontrado"
        )
    
    db_customer.is_active = False
    db.commit()
    return None
