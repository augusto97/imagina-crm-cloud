# Novedades que viajan con cada versión

`catalog.ts` es la lista de novedades que el servidor muestra en «Novedades».
Al arrancar, el API la copia a la tabla `whats_new_entries` (idempotente:
`apps/api/src/whats-new/whats-new-sync.service.ts`).

## Agregar la novedad de una versión nueva (ritual de publicación)

1. Si la versión trae algo que la gente va a notar o usar, agrega una entrada
   AL FINAL de `WHATS_NEW_CATALOG`:
   - `key`: `v<versión>-<tema>` (p. ej. `v0.1.320-tablero-por-equipo`). No se
     cambia nunca: una clave nueva es otra novedad.
   - `version` y `date` (`AAAA-MM-DD`) de la versión.
   - `kind`: `feature` (nueva función), `improvement` (mejora), `fix`
     (corrección) o `notice` (aviso, con `expires_at`).
   - `title` (≤ 120) y `summary` (≤ 280): qué puede hacer la persona ahora y
     dónde está. Español neutro con tuteo; nunca el nombre del producto («la
     app»).
   - `body` opcional, con formato sencillo: `**negrita**`, `*cursiva*`,
     `- viñeta`, `1. paso`, `[texto](https://…)`.
   - `media` (v0.1.325): **cada novedad trae algo visual** (lo exige el test).
     `illustration` es la clave de una ilustración animada de Aprende
     (`apps/web/app/admin/learn/illustrations/items/<clave>.tsx`), `demo` la
     de una captura real (las que nombra el contenido de Aprende) y `slides`
     un carrusel de 2 a 6 diapositivas `{ title, text, illustration }` cuando
     la novedad trae varias partes. Español neutro también en las diapositivas.
   - `action` opcional: `{ label, href?, tour? }`. `href` es una ruta de la
     app (`/lists`, `/settings?s=…`) o un enlace https; `tour` es el id de un
     recorrido (si existe para la persona, el botón lo arranca).
   - `audience.roles` sólo si no les sirve a todos (p. ej. `['admin']` para
     algo que sólo configura un admin). Los invitados nunca ven funciones
     nuevas, sólo avisos.
   - `featured: true` sólo para lo más importante: se presenta en un diálogo
     una vez a cada persona.
2. Corre `pnpm --filter @imagina-base/shared test` (revisa el formato, las
   claves repetidas, el idioma y que no aparezca el nombre del producto).

## Qué ve cada persona como «nuevo»

- Cuenta como nueva desde que LLEGA al servidor (la actualización), no desde
  la fecha de la versión: un servidor que se actualiza semanas después muestra
  igual lo que trajo esa actualización.
- Sólo para quien ya tenía cuenta cuando llegó: lo anterior al alta de una
  persona queda como historial.
- Si una actualización trae muchas a la vez (un servidor que estuvo meses sin
  actualizarse), se anuncian las 8 más recientes; el resto queda como historial.
  La primera vez que esta función llega a un servidor, se anuncian las 6 más
  recientes.
- Una novedad que el operador editó u ocultó desde Plataforma → Novedades no
  la vuelve a tocar la sincronización («Restaurar el texto original» la
  devuelve al catálogo).
