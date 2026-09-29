"""Correo saliente por SMTP, para el intercambio de DTE con los receptores.

Con la librería estándar: `smtplib` bloquea, así que corre en un hilo.
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage

from app.core.config import Settings


@dataclass(frozen=True)
class Correo:
    host: str
    puerto: int
    usuario: str | None
    clave: str | None
    remitente: str

    @classmethod
    def desde(cls, s: Settings) -> Correo | None:
        """None si no hay servidor configurado: entonces no se manda nada."""
        if not s.smtp_host:
            return None
        remitente = s.smtp_remitente or s.smtp_usuario
        if not remitente:
            raise ValueError("DTE_SMTP_HOST sin DTE_SMTP_REMITENTE ni DTE_SMTP_USUARIO")
        return cls(s.smtp_host, s.smtp_puerto, s.smtp_usuario, s.smtp_clave, remitente)

    async def enviar(self, mensaje: EmailMessage) -> None:
        await asyncio.to_thread(self._enviar, mensaje)

    def _enviar(self, mensaje: EmailMessage) -> None:
        with smtplib.SMTP_SSL(self.host, self.puerto, context=ssl.create_default_context(), timeout=30) as smtp:
            if self.usuario:
                smtp.login(self.usuario, self.clave or "")
            smtp.send_message(mensaje)
