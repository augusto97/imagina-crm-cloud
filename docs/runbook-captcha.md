# Verificación anti-robots (captcha) de los formularios — v0.1.289

Cada formulario público puede pedir «Pedir verificación anti-robots» antes de
enviar. Para que la opción se pueda encender hacen falta **llaves de un
proveedor**: las del operador (para todas las empresas) o las de la propia
empresa (ganan sobre las del operador).

## Proveedores

| Proveedor | Recomendado | Panel |
|---|---|---|
| Cloudflare Turnstile | Sí (gratis, sin adivinanzas de imágenes) | https://dash.cloudflare.com/?to=/:account/turnstile |
| hCaptcha | — | https://dashboard.hcaptcha.com/sites |
| Google reCAPTCHA v2 (casilla) | — | https://www.google.com/recaptcha/admin/create |

En el panel del proveedor se crea un «sitio»/«widget» y se agregan los
**dominios donde se ven los formularios**: el de la app (o el dominio propio
de la empresa) y, si los formularios se insertan en un sitio web, ese dominio
también. El proveedor entrega dos llaves:

- **Llave del sitio** (pública): viaja en la página del formulario.
- **Llave secreta**: se guarda cifrada con `SECRETS_KEY` y nunca se vuelve a
  mostrar (sólo sus últimos caracteres).

## Dónde se cargan

- **Operador**: Plataforma → Integraciones → «Verificación anti-robots
  (captcha)». Se guardan en Redis (`platform:captcha`) y viajan en las copias
  del servidor (ADR-S20).
- **Empresa** (admin): Ajustes → Portal y formularios. Se guardan en
  `tenants.settings.captcha`. Si la `SECRETS_KEY` cambió y el secreto ya no se
  puede leer, la tarjeta lo dice y se usan las de la plataforma hasta volver a
  cargarlo. Al migrar la empresa a otro servidor con otra `SECRETS_KEY`, las
  llaves no viajan (hay que volver a cargarlas).

## Cómo funciona

- La página pública del formulario sólo carga el script del proveedor elegido
  y sólo si ese formulario pide la verificación: la CSP de la página suma
  únicamente esos dominios (`script-src`, `frame-src`, `connect-src`).
- El servidor verifica el token con el `siteverify` del proveedor (por el
  fetch con guard anti-SSRF), **una sola vez** por token, después de validar
  las respuestas (un error de tipeo no quema la verificación).
- Si las llaves desaparecen con formularios que la piden, el formulario sigue
  recibiendo respuestas (no se pierden inscripciones) y se abre un «Problema»
  en Ajustes → Problemas para que alguien las cargue.

## Probar en desarrollo

`CAPTCHA_SITEVERIFY_URL` (sólo fuera de producción) apunta el `siteverify` a
un servidor local; el script del proveedor se puede simular interceptando su
URL en el navegador (el E2E de v0.1.289 lo hace con un Turnstile falso que
entrega tokens `ok-…`).
