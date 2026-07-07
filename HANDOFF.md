# HANDOFF — Lecciones aprendidas del plugin WordPress

> Conocimiento destilado del desarrollo del plugin `imagina-crm` (hermano de
> esta app). Cada punto de este documento es un bug REAL que costó horas o
> días de iteración. Leerlo evita repagarlos.
>
> Contexto: el frontend de `apps/web/` es un fork del `app/` del plugin, así
> que muchas de estas lecciones están *ya aplicadas* en el código heredado —
> este doc explica el porqué para que no se deshagan por accidente.

---

## 1. Layout y editores visuales (el aprendizaje más caro)

El plugin tiene un editor visual de plantillas (ficha CRM + portal del
cliente) que pasó por ~5 rediseños hasta quedar bien. Lo que quedó:

### 1.1 WYSIWYG solo es real si editor y front comparten el CSS
El editor y el render final DEBEN usar **las mismas clases CSS y las mismas
fórmulas** (`.imcrm-rows-layout` / `.imcrm-row` / `.imcrm-row__cell`). Cada
vez que el editor "reconstruyó" el espaciado con sus propios valores (gaps de
8px donde el front usa 12px, `calc(% - 0.5rem)` donde el front usa `%`), el
usuario reportó que "los espacios se ven diferentes". La regla: el chrome del
editor (bordes, handles, headers de sección) se agrega ALREDEDOR del layout
compartido, nunca lo reemplaza.

### 1.2 Ancho de columnas: `flex: <w> <w> 0`, jamás `flex-basis: %`
Con `flex-basis: 50%` + `flex-shrink: 0` + `gap: 12px`, dos columnas de 50%
desbordan (100% + gap). `flex: w w 0` deja que el navegador reparta el
espacio DESPUÉS de los gaps, proporcional al peso. Exacto con cualquier N de
columnas, sin `calc()`.

### 1.3 `min-height: auto` en hijos de flex columns
`min-height: 0` en los hijos permite que colapsen por debajo de su contenido
→ cards que "desbordan" contenido sobre el bloque siguiente. `auto` (default
de la spec) respeta el min-content. Solo usar `0` cuando se necesita scroll
interno explícito.

### 1.4 Estructura visible gana a drop zones invisibles
El editor con drop zones implícitas ("soltá entre estas dos cosas") fue
rechazado por el usuario como inusable. El modelo que funcionó: **secciones y
columnas como cajas visibles** con headers, botón "+ Sección" con presets de
columnas (1, 1/2+1/2, 2/3+1/3...), la columna entera se ilumina como drop
target, y reorden vertical con botones ↑/↓ (predecible) + drag solo para
mover ENTRE columnas.

### 1.5 Modelo de datos del layout
`{ y: fila, x: columna, pos: posición vertical en la columna, w: ancho/12 }`
con claves inmutables. Bloques anidados (`nested_section`): máximo 1 nivel,
editables EN el canvas (no en un form del inspector — eso también fue
rechazado como no funcional).

### 1.6 Bloques de presentación NO llevan acciones del registro
Los botones Guardar/Eliminar dentro del bloque "header" del template causaron
semanas de bugs de layout y confusión. Las acciones del registro viven en la
toolbar de la página, fuera del template. Un bloque solo presenta datos.

### 1.7 No anidar `<header>` HTML
El componente RecordHeader usaba `<header>` dentro del `<header>` del shell →
HTML inválido + comportamiento inconsistente entre browsers. Tags semánticos
solo donde la jerarquía lo permite; `<div>` para componentes reutilizables.

### 1.8 Reglas de hooks: useMemo ANTES de early returns
Un `useMemo` después de `if (loading) return <Spinner/>` crashea con React
#310 ("more hooks than previous render") cuando el estado cambia — pantalla
en blanco en producción. TODOS los hooks arriba de todos los returns.

---

## 2. Data fetching con TanStack Query (segunda lección más cara)

### 2.1 UN identificador canónico en las queryKeys
El plugin terminó con queries registradas por `slug` y mutaciones invalidando
por `id` numérico → las keys no matcheaban → **la UI no se actualizaba tras
mutar** (el Kanban no movía cards, la config de vistas no se reflejaba). El
"fix" de invalidar TODO (`keys.all`) causó lo opuesto: **cascadas de
refetches** de todas las listas al mutar una.

**Regla para esta app**: las queryKeys usan SIEMPRE el ID numérico. El slug
de la URL se resuelve a ID una vez (endpoint bootstrap / cache de lists) y de
ahí en más todo es por ID. Invalidaciones quirúrgicas por
`[namespace, listId]`.

### 2.2 Cold load: un solo fetch, con el estado inicial completo
El plugin disparaba el primer fetch de records apenas resolvían las vistas
guardadas, y un tick después la vista default aplicaba filtros/per_page
distintos → segundo fetch. Deferir el fetch hasta que el estado inicial esté
completamente resuelto. En esta app: el endpoint `GET /bootstrap` +
integrar la vista default en el estado ANTES del primer query de records.

### 2.3 Batch endpoints desde el diseño
Cada N+1 del plugin se pagó con un endpoint bundle a posteriori
(`grouped-bundle` para la vista agrupada, batch de recurrences para las
celdas de fecha). Acá se diseñan de entrada: si una vista necesita N
recursos, existe UN endpoint que los devuelve juntos.

### 2.4 Optimistic updates con snapshot + rollback
El patrón del plugin funciona bien: `onMutate` cancela queries del scope,
snapshotea, muta cache; `onError` restaura; `onSettled` invalida el scope.
Mantenerlo, con el scope correcto (§2.1).

---

## 3. Dashboards y visualización

- **Los colores de las opciones de select son la fuente de verdad** en toda
  la app: el mismo verde de "Activo" en el Kanban, los chips de tabla y las
  barras/sectores de los charts. Nunca paletas independientes por vista.
- Tamaños default de widget POR TIPO (KPI 3×2, chart 4×4, tabla 6×5) — un
  default único genera KPIs con la mitad del card vacío.
- Tipografía fluida en KPIs con container queries (`cqh` + `clamp`), no
  tamaños fijos.
- SVG charts: medir el contenedor real (ResizeObserver) — jamás
  `preserveAspectRatio="none"` (deforma puntos/texto). Ids de gradientes con
  `useId()` (los ids fijos colisionan entre instancias del mismo widget).
- Grid denso estilo Linear: rowHeight 64, gap 12.

## 4. Dominio (decisiones que se conservan)

- **Doble identidad slug/ID** en listas y campos (ver STANDALONE.md §3.2).
  Historial de slugs (`slug_history`) para redirects de URLs viejas.
- **14 tipos de campo** del MVP con interfaz común (SQL/validate/serialize).
- **Filter tree** ClickUp-style (AND/OR anidado) compilado con whitelist.
- **Saved views** referencian TODO por field_id, nunca por slug.
- Roles: `admin/manager/agent/viewer/client` con matriz de capabilities.
- Automatizaciones: triggers (`record_created/updated`, `field_changed`,
  `due_date_reached`, `scheduled`) × actions (`send_email`, `call_webhook`,
  `update_field`, `create_record`) + runs con logs.
- Portal del cliente: usuario rol client vinculado a un record + template de
  bloques configurable + magic links.

## 5. Inventario del frontend heredado (apps/web)

**Se reutiliza tal cual** (con cambios solo de auth/routing):
- Tabla (TanStack Table + virtualización, edición inline, bulk, columnas
  configurables), vista agrupada, Kanban, Cards, Calendar.
- Editor de plantillas (`template-editor-core/`): canvas por secciones,
  tree view, registry pattern para inyectar tipos de bloque (CRM y portal
  usan el mismo shell).
- Dashboards completos (6 widgets + embudo + form).
- Filtros (filter tree UI + saved filters), slugs UI (SlugEditor + history).
- Sistema de diseño shadcn + tokens (prefijo `imcrm-` se mantiene por ahora).

**Se reemplaza**: `lib/api.ts` (auth token + base URL), HashRouter →
BrowserRouter, el shell wp-admin → shell propio (login + workspace switcher +
sidebar; estética objetivo: panel de Cloudflare).

**Se elimina**: todo lo de licensing UI, `PublicAssets`/shortcodes, wp-nonce.

## 6. Anti-metas (cosas que NO hacer, aprendidas por las malas)

- No parchear síntomas de layout con `overflow:hidden`/`h-full` sin entender
  la causa (costó 5 versiones seguidas de fixes fallidos en el header).
- No usar `justify-center` en contenedores con `overflow-y: auto` (recorta el
  inicio del contenido inaccesiblemente) — usar `margin: auto` en el hijo.
- No agregar features al editor visual que se gestionen fuera del canvas
  (inspector forms para estructura = rechazado por el usuario).
- No invalidar caches "por las dudas" con scopes amplios (§2.1).
- No confiar en que "el editor se ve bien" implica que el front se ve igual —
  verificar SIEMPRE ambos lados tras cambios de layout.
