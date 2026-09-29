"""Intercambio: el correo que lleva el DTE aceptado a la casilla del receptor.

Función pura: recibe el sobre ya firmado (un `EnvioDTE` dirigido al RUT del
receptor) y el PDF, y arma el mensaje. Quién lo manda y cuándo vive en
`pipeline.intercambiar`.
"""

from __future__ import annotations

from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.dte.pdf import NOMBRES

#: Tipos que van al receptor por intercambio. Las boletas no pasan por aquí.
TIPOS_INTERCAMBIO = frozenset({33, 34, 52, 56, 61})


def mensaje_intercambio(
    *,
    sobre: bytes,
    pdf: bytes | None,
    tipo_dte: int,
    folio: int,
    rut_emisor: str,
    razon_social: str,
    remitente: str,
    destinatario: str,
) -> EmailMessage:
    nombre = NOMBRES.get(tipo_dte, f"DTE {tipo_dte}").capitalize()
    msg = EmailMessage()
    msg["From"] = formataddr((razon_social, remitente))
    msg["To"] = destinatario
    msg["Subject"] = f"{nombre} N° {folio} de {razon_social} ({rut_emisor})"
    msg["Message-ID"] = make_msgid(domain=remitente.rsplit("@", 1)[-1])
    msg.set_content(
        f"Adjuntamos el documento tributario electrónico {nombre} N° {folio} emitido por "
        f"{razon_social}, RUT {rut_emisor}, en formato XML (intercambio) y su representación "
        "impresa en PDF.\n\nEste correo se envía de forma automática."
    )
    base = f"DTE_{rut_emisor}_{tipo_dte}_{folio}"
    msg.add_attachment(sobre, maintype="application", subtype="xml", filename=f"{base}.xml")
    if pdf:
        msg.add_attachment(pdf, maintype="application", subtype="pdf", filename=f"{base}.pdf")
    return msg
