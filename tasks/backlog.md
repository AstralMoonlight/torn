# Backlog priorizado

Estado al 2026-09-25. Los pendientes de `tasks/` pasaron a issues de GitHub, para trabajarlos desde el
tablero de Projects. El detalle sigue en cada archivo de `tasks/`; el issue es donde se marca el avance.

El orden sigue lo que decidió el usuario en [`alineacion_backend_frontend.md`](alineacion_backend_frontend.md):
primero los descuentos (P3 de ese archivo, P2 ya está hecho), después lo demás, y al final el paso a
producción y el intercambio.

| Etiqueta | Significa |
|---|---|
| P0 | Ahora: descuentos |
| P1 | Después: correcto frente al SII y verificación |
| P2 | Sin orden fijo entre ellos: boletas, autocompletar por RUT, mejoras y deuda |
| P3 | Al final: paso a producción, intercambio y deuda menor |

## P0: descuentos

1. [#39](https://github.com/AstralMoonlight/torn/issues/39) Test de contrato de los totales (va primero)
2. [#40](https://github.com/AstralMoonlight/torn/issues/40) Decidir quién puede aplicar descuentos y con qué tope
3. [#41](https://github.com/AstralMoonlight/torn/issues/41) POS: descuento por ítem en $ o %
4. [#42](https://github.com/AstralMoonlight/torn/issues/42) Descuento global en $ o % (`descuentos_globales`)
5. [#43](https://github.com/AstralMoonlight/torn/issues/43) El impreso muestra los descuentos (carta, 57 y 80 mm)

## P1: correcto frente al SII

6. [#44](https://github.com/AstralMoonlight/torn/issues/44) Crédito interno: `forma_pago=2` y vencimiento (A5)
7. [#45](https://github.com/AstralMoonlight/torn/issues/45) NC que corrige texto, código 2 (A4)
8. [#46](https://github.com/AstralMoonlight/torn/issues/46) Reimpresión sin cortar la razón social (C10)
9. [#47](https://github.com/AstralMoonlight/torn/issues/47) Verificación de punta a punta en maullín (A1, A3, sección 4)
10. [#48](https://github.com/AstralMoonlight/torn/issues/48) Validación del SII y declaración de cumplimiento (usuario, bloqueado por el SII)

## P2: lo demás

11. [#49](https://github.com/AstralMoonlight/torn/issues/49) Certificación de boletas (39 y 41)
12. [#50](https://github.com/AstralMoonlight/torn/issues/50) Autocompletar cliente y proveedor por RUT ([detalle](autocompletar_rut_sii.md))
13. [#51](https://github.com/AstralMoonlight/torn/issues/51) Alerta de pocos folios en el dashboard (C11)
14. [#52](https://github.com/AstralMoonlight/torn/issues/52) Retirar las tablas DTE locales (D13)

## P3: al final

15. [#53](https://github.com/AstralMoonlight/torn/issues/53) `monto_total` de dte-torn como fuente de verdad (D12, opción mayor)
16. [#54](https://github.com/AstralMoonlight/torn/issues/54) CAF de producción: ambiente en Folios (B7)
17. [#55](https://github.com/AstralMoonlight/torn/issues/55) Convivencia con Bsale: fecha de corte (B8)
18. [#56](https://github.com/AstralMoonlight/torn/issues/56) Intercambio ([detalle](intercambio.md))
19. [#57](https://github.com/AstralMoonlight/torn/issues/57) Revisión de código de las fases 3 y 4 de la certificación

## Sin pendientes

- [`ui_pendientes_finalizado.md`](ui_pendientes_finalizado.md): terminado.
- [`plan.md`](plan.md) y [`todo.md`](todo.md): certificación de factura terminada; lo que queda está en #48 y #57.
