"""dte-torn.

`lxml.etree` se importa acá, antes que cualquier otra cosa, a propósito.

Si `xmlsec` se importa **antes** que `lxml`, después del primer parseo libxml2
deja de poder abrir archivos por ruta: `etree.parse("esquema.xsd")` falla con un
`XMLSyntaxError` sin detalle, mientras que parsear bytes sigue funcionando. Es
un fallo silencioso hasta que algo intenta cargar un XSD. Como todo módulo de la
aplicación pasa por este `__init__`, el orden queda garantizado en un solo
lugar. Ver `tests/test_xmlsec_compat.py::test_orden_de_importacion`.
"""

import lxml.etree  # noqa: F401  (orden de importación, ver arriba)
