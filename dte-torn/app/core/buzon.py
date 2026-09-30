"""Correo entrante por IMAP: la casilla de intercambio donde llegan los DTE.

Con la librería estándar (`imaplib`, `email`): bloquea, así que corre en un
hilo. Los mensajes se leen con `BODY.PEEK[]` (no quedan leídos) y solo se
marcan `\\Seen` después de procesarlos: si el proceso muere a mitad, el mensaje
se vuelve a leer en la próxima vuelta, y el hash del sobre evita duplicarlo.
"""

from __future__ import annotations

import asyncio
import email
import email.policy
import imaplib
import ssl
from dataclasses import dataclass, field
from email.utils import parseaddr

from app.core.config import Settings

#: Adjuntos que se miran. Los proveedores mandan el sobre como .xml; algunos
#: lo rotulan text/xml y otros application/octet-stream.
_TIPOS_XML = ("application/xml", "text/xml")


@dataclass
class CorreoRecibido:
    uid: bytes
    remitente: str
    #: A quién se responde el acuse: `Reply-To` si viene, si no `From`.
    responder_a: str
    asunto: str
    #: `[(nombre del archivo, contenido)]`, solo los XML.
    adjuntos: list[tuple[str, bytes]] = field(default_factory=list)


def leer_mensaje(uid: bytes, crudo: bytes) -> CorreoRecibido:
    """Arma un `CorreoRecibido` desde los bytes RFC 822 del mensaje."""
    msg = email.message_from_bytes(crudo, policy=email.policy.default)
    remitente = parseaddr(str(msg.get("From", "")))[1]
    responder = parseaddr(str(msg.get("Reply-To", "")))[1] or remitente
    correo = CorreoRecibido(uid=uid, remitente=remitente, responder_a=responder, asunto=str(msg.get("Subject", ""))[:300])
    for parte in msg.walk():
        if parte.is_multipart():
            continue
        nombre = parte.get_filename() or ""
        if parte.get_content_type() in _TIPOS_XML or nombre.lower().endswith(".xml"):
            contenido = parte.get_payload(decode=True)
            if contenido:
                correo.adjuntos.append((nombre or "envio.xml", contenido))
    return correo


@dataclass(frozen=True)
class Buzon:
    host: str
    puerto: int
    usuario: str
    clave: str
    carpeta: str

    @classmethod
    def desde(cls, s: Settings) -> Buzon | None:
        """None si no hay casilla configurada: entonces no se lee nada."""
        if not s.imap_host:
            return None
        usuario = s.imap_usuario or s.smtp_usuario
        if not usuario:
            raise ValueError("DTE_IMAP_HOST sin DTE_IMAP_USUARIO ni DTE_SMTP_USUARIO")
        return cls(s.imap_host, s.imap_puerto, usuario, s.imap_clave or s.smtp_clave or "", s.imap_carpeta)

    def _conectar(self) -> imaplib.IMAP4_SSL:
        imap = imaplib.IMAP4_SSL(self.host, self.puerto, ssl_context=ssl.create_default_context(), timeout=30)
        imap.login(self.usuario, self.clave)
        imap.select(self.carpeta)
        return imap

    async def no_leidos(self, limite: int = 50) -> list[CorreoRecibido]:
        return await asyncio.to_thread(self._no_leidos, limite)

    def _no_leidos(self, limite: int) -> list[CorreoRecibido]:
        imap = self._conectar()
        try:
            _, datos = imap.uid("SEARCH", None, "UNSEEN")
            correos = []
            for uid in (datos[0] or b"").split()[:limite]:
                _, partes = imap.uid("FETCH", uid, "(BODY.PEEK[])")
                crudo = next((p[1] for p in partes if isinstance(p, tuple)), None)
                if crudo:
                    correos.append(leer_mensaje(uid, crudo))
            return correos
        finally:
            imap.logout()

    async def marcar_leidos(self, uids: list[bytes]) -> None:
        if uids:
            await asyncio.to_thread(self._marcar_leidos, uids)

    def _marcar_leidos(self, uids: list[bytes]) -> None:
        imap = self._conectar()
        try:
            imap.uid("STORE", b",".join(uids), "+FLAGS", "(\\Seen)")
        finally:
            imap.logout()
