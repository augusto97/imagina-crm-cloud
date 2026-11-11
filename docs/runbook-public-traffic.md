# Formularios, agenda y widget con mucho tráfico (ADR-S95, ADR-S102)

Un formulario, una agenda o el widget de contacto insertados en el sitio de una
empresa reciben una visita por cada persona que abre esa página del sitio, la
llene o no (el widget, en TODAS las páginas del sitio). Desde v0.1.352 la app
aguanta eso sola; esta guía explica qué hace y cómo poner Cloudflare delante
para que el servidor casi no lo vea.

## Lo que hace la app sola

- **La página se arma una vez y se reusa.** La página de un formulario
  (`/api/v1/public/f/<token>`) y la de una agenda (`/api/v1/public/b/<token>`)
  son iguales para todos los visitantes: se arman, se comprimen (brotli y gzip)
  una sola vez y se sirven desde memoria durante 30 segundos. Mil visitas a la
  vez hacen UNA consulta a la base.
- **El sello anti-robots ya no va en la página.** Se pide aparte
  (`…/forms/<token>/stamp` y `…/booking/<token>/stamp`, `no-store`) cuando la
  persona empieza a llenar. Por eso la página se puede guardar.
- **El navegador también guarda.** `Cache-Control: public, max-age=30,
  stale-while-revalidate=120` y `ETag`: la segunda visita de la misma persona
  responde un 304 sin cuerpo.
- **Los horarios de la agenda se reusan 30 segundos** por servicio, persona y
  semana. Reservar, cancelar, reprogramar, cambiar la agenda o un registro de
  su lista los borra al instante. La reserva siempre vuelve a revisar el
  horario contra la base: un horario cacheado nunca deja reservar dos veces.
- **Un tope para lo público.** Lo que sí necesita la base (una página que no
  estaba en memoria, los horarios de una semana nueva) pasa por una fila con
  `PUBLIC_DB_CONCURRENCY` armados a la vez (8 por defecto, máximo 200). Si la
  fila se llena, el visitante ve «Hay muchas visitas en este momento» y vuelve
  a intentar en segundos, en vez de que la app del equipo se ponga lenta.
- **Varios servidores.** Guardar un formulario o una agenda avisa a los demás
  por Redis (canal `imb:public-cache`); sin Redis, cada uno ve el cambio a los
  30 segundos.
- **Insertar sin cargar.** Con «Ventana al hacer clic» o «Botón flotante» el
  formulario no se pide hasta que alguien toca el botón (o pasa el mouse sobre
  él). Es lo que hacen Calendly y Cal.com.
- **`embed.js`** va minificado y comprimido de antemano (13,9 KB → 4,5 KB por
  la red), con `ETag` y una hora de caché.
- **El widget de contacto** (v0.1.409): su página (`/api/v1/public/w/<token>`)
  se arma una vez y se reusa como la de un formulario, y el navegador la guarda
  5 minutos (`max-age=300, s-maxage=60`). El logo se pide recién al abrir el
  panel, por una dirección fija del propio widget que se guarda un año. Las
  estadísticas cuentan una «aparición» por visita (no una por página), así un
  visitante que recorre diez páginas manda un aviso y no diez.

## Cuándo preocuparse

Con un solo proceso y 4 núcleos la página cacheada sale a miles por segundo
(ver la medición en ADR-S95). Si las empresas cuentan que sus visitantes ven
«Hay muchas visitas en este momento», o el servidor se ve cargado en los
picos:

1. Sube `PUBLIC_DB_CONCURRENCY` en el `.env` (por ejemplo a 16) si la base
   tiene margen — es lo que más deja pasar. Bájalo si la app del equipo se
   pone lenta durante los picos.
2. Pon una CDN delante (abajo).

## Cloudflare delante: la «dirección rápida» (v0.1.409, ADR-S102)

La idea: lo que se inserta en los sitios de las empresas (el script
`embed.js`, el widget y los formularios y agendas insertados) sale por una
dirección APARTE, por ejemplo `w.tudominio.com`, que pasa por Cloudflare.
Cloudflare entrega esas páginas desde su red y el servidor casi no las ve. La
app del equipo y los dominios propios de las empresas (ADR-S17) siguen yendo
directo al servidor: no se pone la app entera detrás de Cloudflare (los
dominios propios de las empresas dejarían de funcionar, errores 1001/1014).

Todo se configura en **Plataforma → Dominios → «Dirección rápida para los sitios
web»**, que trae los pasos y un botón **«Comprobar»**. En resumen:

1. **DNS en Cloudflare**: un CNAME `w` → el host de la app (por ejemplo
   `base.tudominio.com`), **en gris (DNS only)** por ahora. Tiene que ser un
   subdominio DIRECTO del dominio (`w.tudominio.com`): el certificado gratis de
   Cloudflare no cubre uno de segundo nivel (`w.base.tudominio.com`).
2. **ServerAvatar**: agrega `w.tudominio.com` como alias de la aplicación y
   vuelve a emitir el certificado de Let's Encrypt (con la nube en gris, para
   que Let's Encrypt llegue al servidor).
3. **Nube naranja** en ese registro y, en **SSL/TLS**, el modo **Full
   (strict)** (el servidor ya tiene su certificado).
4. **Caching → Cache Rules → Create rule** con la condición que muestra el
   panel:
   `(http.host eq "w.tudominio.com" and starts_with(http.request.uri.path, "/api/v1/public/"))`
   - Acción: **Eligible for cache**; *Edge TTL* → **Use cache-control header if
     present, bypass cache if not**; *Browser TTL* → **Respect origin**.
   - No hace falta excluir nada a mano: el sello anti-robots, los envíos, los
     clics, las estadísticas, los horarios y las reservas salen con `no-store`,
     sin `Cache-Control` o por POST, y Cloudflare no los guarda.
   - (v0.1.374) En la misma regla, **Cache key → Query string → Ignore query
     string** (o «Exclude» con `utm_*`, `gclid`, `gbraid`, `wbraid`, `fbclid`,
     `msclkid`, `ttclid`): un enlace con datos de campaña es una dirección
     distinta por cada clic y, por defecto, Cloudflare la guarda aparte.
5. **Rules → Configuration Rules**, con la misma condición: apaga **Email
   Obfuscation** y **Rocket Loader**. Los dos reescriben el HTML y rompen las
   páginas (los scripts van autorizados por hash en la CSP).
6. **Captcha**: si los formularios usan Turnstile, hCaptcha o reCAPTCHA, agrega
   `w.tudominio.com` a los dominios permitidos de la clave.
7. En el panel, escribe la dirección, marca **«Las visitas llegan por
   Cloudflare»**, toca **«Comprobar»** y, si todo sale bien, **«Guardar»**.

«Comprobar» revisa, sin guardar nada: que la dirección responda, que sea ESTA
instalación, que pase por Cloudflare, que el servidor vea la IP real de cada
visitante y que Cloudflare guarde el script y la página del widget
(`cf-cache-status: HIT`). Si algo falta lo dice en palabras (por ejemplo, un
521 o la regla de caché que falta).

**La IP real.** Detrás de Cloudflare el servidor ve llegar los pedidos desde
los nodos de Cloudflare. Con «Las visitas llegan por Cloudflare» el servidor le
cree la cadena `X-Forwarded-For` a las direcciones oficiales de Cloudflare
(`apps/api/src/common/trust-proxy.ts`, tomadas de cloudflare.com/ips) y ve la
IP del visitante: los límites por visitante siguen siendo por visitante. El
nginx de ServerAvatar ya pasa esa cabecera. También se puede fijar desde el
`.env` con `TRUST_PROXY=loopback,cloudflare`. Ojo: alguien que hable directo
con el servidor desde una dirección de Cloudflare (un Worker) puede elegir la
IP que el servidor ve; sólo afecta a los límites por IP (las contraseñas
también se frenan por cuenta).

**Qué cambia para las empresas.** Los códigos que copien desde ahora (Compartir
→ Insertar en tu sitio, e Instalar del widget) salen con la dirección rápida.
Los que ya pegaron siguen funcionando por la dirección de la app; para que
pasen por Cloudflare, que copien el código de nuevo. Las empresas que comparten
por su dominio propio siguen con su dominio (white-label): no se les pone una
dirección de la plataforma.

Al despublicar un formulario, la CDN puede seguir mostrando la página vieja
hasta 30 segundos (60 la del widget; el envío ya lo rechaza el servidor al
instante).

### Probarlo en desarrollo

`node scripts/dev/fake-cloudflare.mjs 8790` levanta un «Cloudflare» de prueba
delante del API (agrega `cf-ray`, la cadena `X-Forwarded-For` con un nodo de
Cloudflare y una caché con `cf-cache-status`). En el panel, la dirección es
`http://127.0.0.1:8790` (en desarrollo se acepta http).
