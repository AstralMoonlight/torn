"""`POST /folios/upload` — carga de un CAF real entregado por el SII (#22).

Reemplaza la carga manual (`scripts/setup_caf.py`, `scripts/inject_folios.py`,
ambos con `xml_caf` de relleno): el folio_desde/hasta y el vencimiento se
extraen del propio XML (`app/utils/caf_parser.py`), y se valida que el CAF
sea utilizable antes de guardarlo.
"""

from datetime import date, timedelta

import pytest

from app.models.dte import CAF
from app.models.issuer import Issuer

EMISOR_RUT = "76123456-0"


@pytest.fixture
def emisor(client, db_session):
    db_session.add(
        Issuer(
            rut=EMISOR_RUT, razon_social="Emisor Test", giro="Giro",
            acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce",
        )
    )
    db_session.commit()
    return db_session


def _caf_xml(rut=EMISOR_RUT, tipo_documento=39, folio_desde=1, folio_hasta=100, fecha_autorizacion="2026-06-01"):
    return f"""<?xml version="1.0" encoding="ISO-8859-1"?>
<AUTORIZACION>
<CAF version="1.0">
<DA>
<RE>{rut}</RE>
<RS>Emisor Test</RS>
<TD>{tipo_documento}</TD>
<RNG><D>{folio_desde}</D><H>{folio_hasta}</H></RNG>
<FA>{fecha_autorizacion}</FA>
<RSAPK><M>xxx</M><E>yyy</E></RSAPK>
<IDK>100</IDK>
</DA>
<FRMA algoritmo="SHA1withRSA">zzz</FRMA>
</CAF>
<RSASK>aaa</RSASK>
<RSAPUBK>bbb</RSAPUBK>
</AUTORIZACION>""".encode("iso-8859-1")


def _subir(client, xml_bytes):
    return client.post(
        "/folios/upload",
        files={"file": ("caf.xml", xml_bytes, "text/xml")},
    )


class TestCargaDeCaf:
    def test_carga_un_caf_valido(self, client, emisor):
        resp = _subir(client, _caf_xml())
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tipo_documento"] == 39
        assert body["folio_desde"] == 1
        assert body["folio_hasta"] == 100
        assert body["fecha_vencimiento"] == "2026-11-28"  # FA + 180 días

    def test_el_caf_cargado_queda_disponible_para_vender(self, client, emisor, db_session):
        resp = _subir(client, _caf_xml(tipo_documento=39, folio_desde=1, folio_hasta=50))
        assert resp.status_code == 201, resp.text

        status_resp = client.get("/folios/status")
        assert status_resp.status_code == 200
        boleta = next(f for f in status_resp.json() if f["dte_type"] == 39)
        assert boleta["available"] == 50
        assert boleta["total"] == 50

    def test_rechaza_rut_que_no_coincide_con_el_emisor(self, client, emisor):
        resp = _subir(client, _caf_xml(rut="11111111-1"))
        assert resp.status_code == 400
        assert "76123456-0" in resp.json()["detail"]

    def test_rechaza_caf_vencido(self, client, emisor):
        fecha_vieja = (date.today() - timedelta(days=400)).isoformat()
        resp = _subir(client, _caf_xml(fecha_autorizacion=fecha_vieja))
        assert resp.status_code == 400
        assert "venció" in resp.json()["detail"]

    def test_rechaza_rango_solapado_con_caf_existente(self, client, emisor, db_session):
        db_session.add(CAF(
            tipo_documento=39, folio_desde=1, folio_hasta=100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        db_session.commit()

        resp = _subir(client, _caf_xml(tipo_documento=39, folio_desde=50, folio_hasta=150))
        assert resp.status_code == 409
        assert "solapa" in resp.json()["detail"]

    def test_no_rechaza_caf_de_otro_tipo_con_rango_parecido(self, client, emisor, db_session):
        db_session.add(CAF(
            tipo_documento=39, folio_desde=1, folio_hasta=100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        db_session.commit()

        # Mismo rango de folios, pero tipo de documento distinto (33 vs 39):
        # no debe considerarse solapamiento.
        resp = _subir(client, _caf_xml(tipo_documento=33, folio_desde=1, folio_hasta=100))
        assert resp.status_code == 201, resp.text

    def test_rechaza_xml_mal_formado(self, client, emisor):
        resp = _subir(client, b"esto no es xml")
        assert resp.status_code == 400

    def test_rechaza_caf_sin_rango_de_folios(self, client, emisor):
        xml = """<AUTORIZACION><CAF version="1.0"><DA>
<RE>76123456-K</RE><RS>Emisor</RS><TD>39</TD><FA>2026-06-01</FA>
</DA></CAF></AUTORIZACION>""".encode("iso-8859-1")
        resp = _subir(client, xml)
        assert resp.status_code == 400

    def test_rechaza_sin_emisor_configurado(self, client, db_session):
        resp = _subir(client, _caf_xml())
        assert resp.status_code == 404
