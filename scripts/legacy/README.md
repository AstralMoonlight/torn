# Scripts heredados

Estos archivos vivían sueltos en la raíz del repositorio con nombre `test_*.py`.
No son tests de la suite: son **scripts manuales** escritos antes de que Torn
pasara a multi-inquilino, y en buena parte apuntan a un modelo de datos que ya
no existe.

Estaban causando un problema concreto: al llamarse `test_*.py`, `pytest` los
recogía si se le apuntaba a la raíz del repositorio. Como abren conexión a
PostgreSQL al importarse y algunos dependen de `requests` (que no está en
`requirements.txt`), rompían la recolección completa antes de llegar a `tests/`.
Eso tumbó el CI la primera vez que se ejecutó. `pytest.ini` restringe ahora la
recolección a `tests/`, y moverlos aquí quita la trampa de raíz.

Se renombraron de `test_*.py` a `manual_*.py`: con el prefijo `test_`, `pytest`
los seguía recogiendo aunque estuvieran aquí.

| Archivo | Qué hacía |
|---|---|
| `manual_jwt_auth.py` | Prueba manual del login y del token JWT |
| `manual_provisioning.py` | Prueba manual del alta de inquilinos |
| `manual_roles.py` | Prueba manual de roles y permisos |
| `manual_sale.py` | Prueba manual del flujo de venta |
| `manual_user_limits.py` | Prueba manual del límite de usuarios por plan |

## Estado

**No se han actualizado ni verificado.** Se conservan porque documentan flujos
que la suite todavía no cubre (autenticación, aprovisionamiento, límites de
plan), no porque funcionen tal cual.

Lo que corresponde con ellos es convertirlos en tests de `tests/`, que corre
sobre SQLite y sin red, o eliminarlos si ya no aportan. Se decide en #35.

La suite real está en `tests/` y se ejecuta con `pytest` desde la raíz.
