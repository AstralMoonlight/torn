"""Cifrado de secretos por tenant y manejo del certificado digital.

Lo que se prueba acá no es que el cifrado "funcione" -eso lo garantiza
`cryptography`- sino las tres propiedades de las que depende el diseño:

1. Cada tenant tiene su propia llave: el material de uno no se abre con la del
   otro, aunque la llave maestra sea la misma.
2. Un blob cifrado está amarrado a su fila: moverlo de un registro a otro no
   descifra.
3. Cada apertura del certificado deja rastro en `audit_log`.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.certificados import (
    CertificadoInvalidoError,
    CertificadoVencidoError,
    SinCertificadoError,
    cargar_certificado,
    guardar_certificado,
    parsear_pfx,
)
from app.core.crypto import DescifradoError, aad, abrir, derivar_llave, sellar
from app.db import tenant_session
from app.models import AuditLog, Certificate
from tests.factories import CLAVE_PFX
from tests.factories import pfx as _pfx

CLAVE = CLAVE_PFX


# ------------------------------------------------------------------ crypto --


def test_cada_tenant_tiene_su_llave() -> None:
    """La derivación depende del tenant: dos tenants, dos llaves."""
    a, b = uuid.uuid4(), uuid.uuid4()
    assert derivar_llave(a) != derivar_llave(b)
    assert derivar_llave(a) == derivar_llave(a)  # determinística


def test_otro_tenant_no_abre_el_secreto() -> None:
    """Es la propiedad central: nunca una sola llave compartida."""
    a, b = uuid.uuid4(), uuid.uuid4()
    datos = aad(a, "certificates", uuid.uuid4())
    nonce, cifrado = sellar(a, b"secreto", datos)

    with pytest.raises(DescifradoError):
        abrir(b, nonce, cifrado, datos)


def test_el_blob_no_se_puede_mover_de_fila() -> None:
    """El AAD amarra el secreto a su registro concreto."""
    tenant = uuid.uuid4()
    fila_original, otra_fila = uuid.uuid4(), uuid.uuid4()
    nonce, cifrado = sellar(tenant, b"secreto", aad(tenant, "certificates", fila_original))

    with pytest.raises(DescifradoError):
        abrir(tenant, nonce, cifrado, aad(tenant, "certificates", otra_fila))


def test_alterar_el_cifrado_se_detecta() -> None:
    """GCM autentica: un byte cambiado rompe el descifrado, no lo corrompe."""
    tenant = uuid.uuid4()
    datos = aad(tenant, "cafs", uuid.uuid4())
    nonce, cifrado = sellar(tenant, b"secreto", datos)
    alterado = bytes([cifrado[0] ^ 0x01]) + cifrado[1:]

    with pytest.raises(DescifradoError):
        abrir(tenant, nonce, alterado, datos)


def test_ida_y_vuelta() -> None:
    """Lo obvio, que igual conviene tener cubierto."""
    tenant = uuid.uuid4()
    datos = aad(tenant, "certificates", uuid.uuid4())
    claro = b"contenido del .pfx" * 100
    nonce, cifrado = sellar(tenant, claro, datos)

    assert abrir(tenant, nonce, cifrado, datos) == claro
    assert claro not in cifrado  # nada de texto en claro en el blob


# ------------------------------------------------------------ parseo .pfx ---


def test_parsea_el_pfx_y_saca_el_rut() -> None:
    """El RUT sale del subjectAltName, donde lo pone el SII."""
    material = parsear_pfx(_pfx(rut="76543210-9"), CLAVE)

    assert material.rut == "76543210-9"
    assert material.llave_pem.startswith(b"-----BEGIN")
    assert material.cert_pem.startswith(b"-----BEGIN CERTIFICATE-----")
    assert len(material.fingerprint_sha256) == 64


def test_rut_con_digito_verificador_k() -> None:
    """El DV puede ser K, y el patrón tiene que aceptarlo."""
    assert parsear_pfx(_pfx(rut="12345678-K"), CLAVE).rut == "12345678-K"


def test_clave_incorrecta_no_abre_el_pfx() -> None:
    with pytest.raises(CertificadoInvalidoError):
        parsear_pfx(_pfx(), "clave-equivocada")


def test_el_repr_no_filtra_la_llave_privada() -> None:
    """Este objeto termina en trazas y en Sentry; no puede imprimir la llave."""
    material = parsear_pfx(_pfx(), CLAVE)
    texto = repr(material)

    assert b"BEGIN RSA PRIVATE KEY" not in texto.encode()
    assert "76543210-9" in texto  # lo que sí sirve para diagnosticar


# ------------------------------------------------------ guardar y cargar ----


async def test_guardar_y_cargar(tenant: uuid.UUID) -> None:
    """El certificado vuelve idéntico después de pasar por la base cifrado."""
    original = parsear_pfx(_pfx(), CLAVE)

    async with tenant_session(tenant) as s:
        fila = await guardar_certificado(s, tenant, _pfx(rut="76543210-9"), CLAVE)
        assert fila.subject_rut == "76543210-9"
        # En la base no queda nada en claro.
        assert CLAVE.encode() not in fila.password_cifrada

    async with tenant_session(tenant) as s:
        cargado = await cargar_certificado(s, tenant, motivo="test")

    assert cargado.rut == original.rut
    assert cargado.llave_pem.startswith(b"-----BEGIN")


async def test_cargar_sin_certificado(tenant: uuid.UUID) -> None:
    async with tenant_session(tenant) as s:
        with pytest.raises(SinCertificadoError):
            await cargar_certificado(s, tenant, motivo="test")


async def test_subir_uno_nuevo_desactiva_el_anterior(tenant: uuid.UUID) -> None:
    """`certificates` tiene único parcial sobre `activo`: solo puede haber uno."""
    async with tenant_session(tenant) as s:
        primero = await guardar_certificado(s, tenant, _pfx(rut="11111111-1"), CLAVE)
        primero_id = primero.id

    async with tenant_session(tenant) as s:
        await guardar_certificado(s, tenant, _pfx(rut="22222222-2"), CLAVE)

    async with tenant_session(tenant) as s:
        activos = (
            (await s.execute(select(Certificate).where(Certificate.activo.is_(True))))
            .scalars()
            .all()
        )
        assert len(activos) == 1
        assert activos[0].id != primero_id
        assert activos[0].subject_rut == "22222222-2"


async def test_certificado_vencido_no_se_guarda(tenant: uuid.UUID) -> None:
    """Firmar con un certificado vencido gasta un folio para que el SII rechace."""
    vencido = _pfx(desde_dias=-400, dias_validez=-30)

    async with tenant_session(tenant) as s:
        with pytest.raises(CertificadoVencidoError):
            await guardar_certificado(s, tenant, vencido, CLAVE)


async def test_cada_acceso_queda_auditado(tenant: uuid.UUID) -> None:
    """El certificado firma en nombre del cliente: todo acceso deja rastro."""
    async with tenant_session(tenant) as s:
        await guardar_certificado(s, tenant, _pfx(), CLAVE, subido_por="ana@empresa.cl")

    async with tenant_session(tenant) as s:
        await cargar_certificado(s, tenant, motivo="firma documento 1")
        await cargar_certificado(s, tenant, motivo="firma documento 2")

    async with tenant_session(tenant) as s:
        filas = (
            (await s.execute(select(AuditLog).order_by(AuditLog.created_at)))
            .scalars()
            .all()
        )

    operaciones = [f.operacion for f in filas]
    assert operaciones == ["CARGA_CERT", "ACCESO_CERT", "ACCESO_CERT"]
    assert all(f.resultado == "OK" for f in filas)
    assert all(len(f.cert_fingerprint) == 64 for f in filas)
    assert filas[0].actor == "ana@empresa.cl"
    assert filas[1].actor == "firma documento 1"


async def test_el_audit_log_no_se_puede_modificar(tenant: uuid.UUID) -> None:
    """Append-only de verdad: el rol de la aplicación no tiene UPDATE ni DELETE.

    Un registro de auditoría editable no sirve como registro de auditoría.
    """
    from sqlalchemy import delete, update
    from sqlalchemy.exc import ProgrammingError

    async with tenant_session(tenant) as s:
        await guardar_certificado(s, tenant, _pfx(), CLAVE)

    with pytest.raises(ProgrammingError):
        async with tenant_session(tenant) as s:
            await s.execute(update(AuditLog).values(resultado="FALSO"))

    with pytest.raises(ProgrammingError):
        async with tenant_session(tenant) as s:
            await s.execute(delete(AuditLog))


async def test_certificado_de_otro_tenant_no_se_abre(tenant: uuid.UUID) -> None:
    """Aunque alguien copie la fila entre tenants, el AAD no calza."""
    from app.core.crypto import aad as construir_aad
    from app.db import control_session
    from app.models import Tenant

    async with tenant_session(tenant) as s:
        fila = await guardar_certificado(s, tenant, _pfx(), CLAVE)
        cifrado, nonce, cert_id, version = (
            fila.pfx_cifrado,
            fila.nonce_pfx,
            fila.id,
            fila.key_version,
        )

    otro = uuid.uuid4()
    async with control_session() as s:
        s.add(
            Tenant(
                id=otro,
                rut_emisor="88888888-8",
                razon_social="Otra SpA",
                giro="Otro",
                acteco="620200",
            )
        )

    with pytest.raises(DescifradoError):
        abrir(otro, nonce, cifrado, construir_aad(otro, "certificates", cert_id), version)


async def test_certificado_de_persona_en_empresa_con_otro_rut(limpiar: None) -> None:
    """El caso normal en Chile: la empresa tiene un RUT y el certificado es del
    representante legal, con su RUT de persona natural.

    El certificado se guarda sin compararlo contra el RUT de la empresa. Si
    alguien agrega esa validación "por seguridad", este test la frena: rompería
    a casi todas las empresas reales.
    """
    from app.db import control_session
    from app.models import Tenant

    empresa = uuid.uuid4()
    async with control_session() as s:
        s.add(
            Tenant(
                id=empresa,
                rut_emisor="76543210-3",
                razon_social="Empresa Familiar SpA",
                giro="Comercio",
                acteco="471100",
            )
        )

    async with tenant_session(empresa) as s:
        fila = await guardar_certificado(s, empresa, _pfx(rut="11111111-1"), CLAVE)
        assert fila.subject_rut == "11111111-1"

    async with tenant_session(empresa) as s:
        cargado = await cargar_certificado(s, empresa, motivo="firma")
        assert cargado.rut == "11111111-1"
