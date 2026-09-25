# Autocompletar cliente/proveedor desde el SII por RUT

Al crear un cliente (`frontend/components/customers/CustomerForm.tsx`) o un
proveedor (`frontend/components/providers/ProviderDialog.tsx`), escribir el RUT
y traer sus datos desde la "Consulta de situación tributaria de terceros"
(https://www2.sii.cl/stc/noauthz), en una ventana oculta.

## Lo que se vio en la página (2026-09-25)

- Es una app JS que llama a `/app/stc/recurso/v1/consulta/getConsultaData/`,
  protegida con **reCAPTCHA Enterprise v3** (invisible, por puntaje) y cola de
  queue-it.
- Un navegador headless suele sacar puntaje bajo y la respuesta vuelve con
  `captchaInvalido`. Saltarse el captcha no es opción.

## Enfoque

- La "ventana oculta" tiene que correr en el navegador del usuario (iframe o
  pestaña que él mismo carga), no como scraper en el backend.
- Si no alcanza el puntaje o el SII no deja cargarse en iframe, plan B: abrir
  la consulta en una pestaña visible y que el usuario copie los datos.

## Tareas

- [ ] Probar si el SII permite cargarse en iframe (cabeceras
      `X-Frame-Options`/CSP) y si el puntaje del captcha alcanza.
- [ ] Confirmar con una consulta real qué campos trae. Se espera razón social
      y actividades económicas (giro/ACTECO), sin dirección, comuna ni ciudad
      (esos seguirían a mano).
- [ ] Botón o disparo al salir del campo RUT en ambos formularios que llene
      razón social y giro.

## Por decidir

- Si el giro se llena con la primera actividad o se elige entre las que
  devuelve el SII.
