# Autocompletar cliente/proveedor por RUT

Al crear un cliente (`frontend/components/customers/CustomerForm.tsx`) o un
proveedor (`frontend/components/providers/ProviderDialog.tsx`), escribir el RUT
y traer razón social, giro y, si se puede, dirección y comuna. Fuente original
pedida: la "Consulta de situación tributaria de terceros" del SII
(https://www2.sii.cl/stc/noauthz); si no se puede ahí, otra.

## Fuentes evaluadas (2026-09-25)

| Fuente | Qué trae | Costo | Problema |
|---|---|---|---|
| SII STC (`/app/stc/recurso/v1/consulta/getConsultaData/`) | Razón social, actividades | Gratis | reCAPTCHA Enterprise v3 + queue-it: un scraper oculto saca puntaje bajo y vuelve `captchaInvalido`. Saltarse el captcha no es opción |
| **Nóminas públicas del SII** ([sii.cl/sobre_el_sii/nominapersonasjuridicas.html](https://www.sii.cl/sobre_el_sii/nominapersonasjuridicas.html)) | Razón social, actividades económicas, direcciones (casa matriz y sucursales) | Gratis | Solo personas jurídicas; se actualiza pocas veces al año (última: agosto 2026) |
| [Webempresario](https://api-sii-chile.webempresario.com/) | Razón social, actividades, sucursales con dirección | Pago único, desde $4.990 por 1.000 consultas, sin credenciales | Tercero; dice sincronizar mensualmente con datos públicos del SII |
| [API Gateway](https://www.apigateway.cl/products/sii/contribuyentes) | Lo mismo que la STC, en tiempo real | Por créditos | Tercero; no trae dirección |
| [BaseAPI](https://baseapi.cl/servicios/contribuyente) | Datos del receptor con dirección y comuna | Mensual | Pide clave SII; se discontinúa para registros nuevos el 11-12-2026. Descartada |

## Enfoque propuesto

1. **Base local desde las nóminas del SII** (principal). Mismo patrón que los
   ACTECO (`backend/scripts/seed_actecos.py`, `database/actecos_sii.json`):
   script que descarga los ZIP de razón social, actividades y direcciones, y
   los carga en una tabla del esquema `public` (compartida por todos los
   tenants). Endpoint de búsqueda por RUT. Sin captcha, sin costo por
   consulta, responde al instante.
2. **Respaldo para lo que no está** (personas naturales con giro, empresas
   nuevas entre actualizaciones): decidir entre una API de pago (Webempresario
   parece la más barata y trae dirección) o dejar esos casos a mano.

## Tareas

- [ ] Descargar las nóminas y revisar formato real, tamaño y campos
      (confirmar que direcciones trae comuna y cómo se marca la casa matriz).
- [ ] Tabla en `public` + migración Alembic + script de carga/actualización
      idempotente (se vuelve a correr cuando el SII publica una nómina nueva).
- [ ] Endpoint `GET` por RUT que devuelve razón social, actividades y
      dirección de casa matriz.
- [ ] En ambos formularios: al salir del campo RUT (o con un botón), llenar
      los campos vacíos sin pisar lo que el usuario ya escribió.
- [ ] Tests del endpoint y del parser de las nóminas.

## Por decidir

- Si se paga una API para los RUT que no están en las nóminas, o quedan a mano.
- Si el giro se llena con la primera actividad o se elige entre las que trae.
- Tamaño de la tabla en la BD de producción (millones de filas posibles):
  cargar solo empresas vigentes (sin término de giro).
