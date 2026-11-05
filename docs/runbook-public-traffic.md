# Formularios y agenda con mucho tráfico (ADR-S95)

Un formulario o una agenda insertados en el sitio de una empresa reciben una
visita por cada persona que abre esa página del sitio, la llene o no. Desde
v0.1.352 la app aguanta eso sola; esta guía explica qué hace y qué hacer si
alguna vez no alcanza.

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
- **`embed.js`** va comprimido de antemano, con `ETag` y una hora de caché.

## Cuándo preocuparse

Con un solo proceso y 4 núcleos la página cacheada sale a miles por segundo
(ver la medición en ADR-S95). Si las empresas cuentan que sus visitantes ven
«Hay muchas visitas en este momento», o el servidor se ve cargado en los
picos:

1. Sube `PUBLIC_DB_CONCURRENCY` en el `.env` (por ejemplo a 16) si la base
   tiene margen — es lo que más deja pasar. Bájalo si la app del equipo se
   pone lenta durante los picos.
2. Pon una CDN delante (abajo).

## Cloudflare delante (opcional)

La app ya manda las cabeceras correctas; sólo hay que decirle a Cloudflare que
respete las del servidor en las rutas públicas.

1. Apunta el dominio por Cloudflare (proxy naranja).
2. **Caching → Cache Rules → Create rule**:
   - Nombre: `Páginas públicas`.
   - Condición (*Custom filter expression*):
     `(starts_with(http.request.uri.path, "/api/v1/public/f/") or starts_with(http.request.uri.path, "/api/v1/public/b/"))`
   - Acción: **Eligible for cache**, *Edge TTL* → **Use cache-control header if
     present**, *Browser TTL* → **Respect origin**.
3. No hace falta excluir nada a mano: el sello, los envíos, los horarios y las
   reservas salen con `no-store` o por POST, y Cloudflare no los guarda.
4. Comprueba con `curl -sI https://tu-dominio/api/v1/public/f/<token>`: la
   segunda vez debe decir `cf-cache-status: HIT`.
5. (v0.1.374) **Que los parámetros de las campañas no rompan la caché.** Un
   enlace con `?utm_campaign=…&gclid=…` es una dirección distinta por cada clic
   de anuncio, y Cloudflare, por defecto, la guarda aparte. La página es la
   misma para todos (los datos de origen los lee el navegador y viajan con el
   envío), así que en la misma regla, en **Cache key → Query string**, elige
   **Ignore query string** (o «Exclude» con `utm_*`, `gclid`, `gbraid`,
   `wbraid`, `fbclid`, `msclkid`, `ttclid`). Insertado en un sitio, el
   formulario NO recibe esos datos por su dirección (llegan por mensaje del
   script de inserción), así que este paso sólo importa para el enlace directo
   compartido en anuncios.

Al despublicar un formulario, la CDN puede seguir mostrando la página vieja
hasta 30 segundos (el envío ya lo rechaza el servidor al instante).
