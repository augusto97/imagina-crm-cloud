# Cómo se escribe el centro de aprendizaje

Guía para escribir y mantener el manual del **centro de aprendizaje**
(`/aprende`, v0.1.322, ADR-S75): módulos, artículos, ilustraciones animadas y
capturas reales.

## 1. La vara de calidad

El centro de aprendizaje reemplaza a una ayuda que el usuario calificó de
"muy básica, poco ilustrativa y corta". El manual tiene que:

- **Explicar TODO lo que se puede hacer** en cada parte de la app, no sólo el
  camino feliz. Cada pantalla tiene su artículo, y cada ajuste de esa pantalla
  tiene su fila en una tabla «Ajuste · Qué hace», con un consejo de cuándo usarlo.
- **Dar ideas**: cada artículo trae al menos un **ejemplo de un negocio real**
  (un café, una clínica, una inmobiliaria, una ferretería, una agencia, un
  colegio…) que muestre para qué sirve, no sólo cómo se usa.
- **Ser visual**: cada artículo tiene al menos una imagen. Lo ideal es una
  **animación** que explique la idea y una **captura real** paso a paso que
  muestre dónde se toca.
- **Ser largo cuando hace falta**: un artículo típico tiene 600 a 1.500
  palabras, 3 a 6 secciones (`h`), pasos numerados, tablas de ajustes, avisos,
  preguntas frecuentes y botones para ir a la pantalla.
- **Ser exacto**: los nombres de botones, pestañas y secciones van en
  **negrita** y tal cual se ven en la app. Nada inventado: si no estás seguro de
  cómo se llama o qué hace algo, búscalo en el código (`apps/web/app/...`) o
  ábrelo en la app de desarrollo. `CLAUDE.md` §5 describe cada función con detalle.

## 2. Dónde vive cada cosa

```
apps/web/app/admin/learn/
  content/types.ts                 formato (no tocar al escribir contenido)
  content/modules/<modulo>.meta.ts     metadatos del módulo + lista de artículos
  content/modules/<modulo>.content.ts  los artículos completos (bloques)
  illustrations/kit.tsx            piezas para dibujar escenas (no tocar)
  illustrations/items/<clave>.tsx  una ilustración por archivo
  LearnIcon.tsx                    íconos permitidos (catálogo cerrado)
scripts/help-captures/
  scenarios/<modulo>.mjs           las capturas reales de ese módulo
  run.mjs · prepare.mjs · fill.mjs grabador, cuenta de ejemplo y datos
  tools/                           fotos para revisar (ilustración, página, cuadros)
```

Agregar un módulo = sumar sus dos archivos de `content/modules/`; agregar una
ilustración = sumar su archivo en `items/`; agregar capturas = sumar su
escenario. No hay índices que mantener a mano.

## 3. El formato

`<modulo>.meta.ts` exporta `meta: LearnModuleMeta` (ver `content/types.ts`):
id (= nombre del archivo), grupo, orden, título, frase corta, ícono (nombre de
`LEARN_ICONS`), tono, ilustración de portada (`hero`), 3-5 `highlights` y la
lista de artículos (`id`, `title`, `summary`, `minutes`, `level`, `keywords`,
`needs` si lo hace un rol con cierta capacidad, `operatorOnly` si es sólo del
operador de la plataforma).

`<modulo>.content.ts` exporta `articles: LearnArticle[]` en el MISMO orden que
el meta. Cada artículo: `id`, `route` (pantalla donde se hace), `related` (ids
de otros artículos, de cualquier módulo) y `blocks`:

| Bloque | Para qué |
|---|---|
| `{ t: 'p', md }` | Párrafos (formato sencillo: `**negrita**`, `*cursiva*`, `- viñetas`, `1. pasos`, `[enlace](/ruta)`) |
| `{ t: 'h', text }` | Título de sección (sale en «En esta página») |
| `{ t: 'steps', items }` | Pasos numerados |
| `{ t: 'settings', title, rows: [{ name, what, tip }] }` | Tabla de ajustes |
| `{ t: 'callout', tone: 'tip'\|'warn'\|'info', title?, md }` | Consejo, ojo o nota |
| `{ t: 'example', title, md }` | Caso real de un negocio |
| `{ t: 'anim', key, caption }` | Ilustración animada |
| `{ t: 'demo', key, caption, fallback }` | Captura real paso a paso (`fallback` = clave de una ilustración, obligatoria) |
| `{ t: 'cards', items: [{ icon, title, md, tone }] }` | Grilla de opciones o funciones |
| `{ t: 'faq', items: [{ q, a }] }` | Preguntas frecuentes |
| `{ t: 'actions', items: [{ label, to \| article \| tour }] }` | Botones: ir a la pantalla, abrir otro artículo o un recorrido |
| `{ t: 'keys', items: [{ keys, what }] }` | Atajos de teclado |

Estructura recomendada de un artículo:

1. Un párrafo que dice **qué es y para qué sirve** (con un ejemplo concreto).
2. Una ilustración animada que lo muestre.
3. «Cómo se hace»: pasos + captura real.
4. Las opciones/ajustes en tablas (TODOS los de esa pantalla).
5. Ejemplos de negocios reales e ideas.
6. Avisos de lo que hay que saber (límites, permisos, qué pasa si…).
7. Preguntas frecuentes.
8. Botones para ir a la pantalla y artículos relacionados.

## 4. Reglas del texto

- **Español neutro con tuteo** (ADR-S42): «elige, puedes, tienes, aquí». Jamás
  voseo («elegí, podés, tenés, acá, vos»). El test lo revisa.
- **Nunca el nombre del producto** (white-label): se dice «la app». Si hace
  falta el nombre de la empresa del cliente, `{app}` se reemplaza por el nombre
  que configuró.
- **Sin jerga**: nada de «slug», «JSON», «endpoint», «query». Se explica con
  palabras de un dueño de negocio. Los nombres técnicos que la app sí muestra
  (por ejemplo «Llamar webhook externo») se usan tal cual, explicando qué son.
- Ejemplos con datos latinoamericanos: pesos con punto de miles («$ 1.250.000»),
  fechas DD/MM/AAAA, nombres y ciudades de la región.

## 5. Ilustraciones animadas

Cada ilustración es un componente en `illustrations/items/<clave>.tsx` con
`export default function`. Se dibuja con el kit (`../kit`): `Stage` (escenario
480×300 que se escala solo), `Win` (ventana de la app), `At` (caja posicionada),
`T` (texto), `Bar`, `Chip` (opción sólida), `Pill`, `Avatar`, `Btn`,
`IconSquare`, `Bubble`, `Cursor`, `Flow` y las funciones de color `tone()`,
`primary()` y `C.*`. Usa íconos de `lucide-react`.

Reglas:

- **Colores sólo de los tokens** (`C.card`, `C.fg`, `tone('mint')`,
  `primary()`…): así toma el color de la marca de cada empresa y funciona en
  oscuro. Colores fijos sólo para marcas ajenas reconocibles (el verde de
  WhatsApp, por ejemplo).
- **Animación en CSS**: `<Keyframes css={...} />` con nombres que empiezan con
  un prefijo único del archivo (`kd-…` en `kanban-drag`). Todas comparten el
  ciclo del `Stage` (7 s; se cambia con `cycle`). Se aplica con `a="nombre"` en
  `At`/`Win` o `data-a` + `animationName`.
- **El estilo sin animación es el cuadro final**: con «reducir movimiento» se
  ve la escena quieta y completa (por eso, por ejemplo, la tarjeta arrastrada
  tiene como estilo base su posición FINAL y el keyframe 0% la lleva al inicio).
- El ciclo cierra sin saltos: en el 92-100% se desvanece y vuelve al inicio.
- `label` del `Stage`: una frase que describe la escena (lectores de pantalla).
- Que se parezca a la app real (chips sólidos, tarjetas blancas con borde
  fino, el rail lateral si aplica) y que cuente UNA idea clara.

Revisar: `node scripts/help-captures/tools/shot-illustration.mjs <clave> 0.6,2,3.5,5.5`
(y con `DARK=1`) y mirar las PNG de `/tmp/learn-shots/`. También se ven todas
en `http://localhost:5174/#/aprende/lab`.

## 6. Capturas reales

Un escenario por módulo en `scripts/help-captures/scenarios/<modulo>.mjs`, que
exporta por defecto un array de demos:

```js
export default [
    {
        key: 'vistas-kanban',            // único; lo usa el bloque `demo`
        title: 'Pasar la lista a tablero',
        steps: [
            { go: '/lists/{list:Oportunidades}/records', wait: '[data-tour="records-table"]', caption: 'Abre la lista de oportunidades.' },
            { click: '[data-tour="records-new-view"]', caption: 'Toca «+ Vista».' },
            { fill: '[data-tour="view-create-name"] input', text: 'Por etapa', caption: 'Ponle un nombre.' },
            { shot: '[data-tour="records-table"]', caption: 'Listo: cada etapa es una columna.' },
        ],
    },
];
```

Pasos: `go` (ruta; `{list:Nombre}` = lista de la empresa de ejemplo; `caption`
opcional = cuadro), `click` / `hover` / `dblclick` (+ `right: true` para clic
derecho, `then: selector` para esperar algo), `fill` + `text`, `press`
(tecla), `drag: [desde, hasta]`, `shot` (cuadro; con selector resalta esa zona),
`wait` (ms o selector) y `run: async ({ page, api, lists }) => …` para preparar
datos sin cuadro. Cada `click`/`fill`/`drag` deja un cuadro ANTES de actuar,
con la zona que se toca: el reproductor anima el cursor hasta ahí.

- Selectores estables: `data-tour`, `data-testid`, roles y textos visibles.
- 3 a 6 cuadros por demo; los textos en tuteo y diciendo qué pasa.
- La empresa de ejemplo («Café Aurora») tiene: Oportunidades, Clientes,
  Facturas, Tareas, Tickets, Productos y Citas, con ~16 registros cada una.
- Los escenarios corren en orden alfabético de archivo sobre la MISMA empresa:
  si uno crea o cambia cosas, que no rompa a los demás (o déjalo como estaba).

Grabar las tuyas (con una cuenta propia, para no pisar a nadie):

```sh
set -a; . apps/api/.env; set +a
node scripts/help-captures/prepare.mjs --email demo-<modulo>@ejemplo.test --password Clave-de-demo-1
PW_CHROMIUM=/opt/pw-browsers/chromium node scripts/help-captures/run.mjs \
    --email demo-<modulo>@ejemplo.test --password Clave-de-demo-1 --only clave1,clave2
bash scripts/help-captures/tools/frames.sh clave1   # mirar los cuadros
```

En el release, `scripts/help-captures/ci.sh` graba todas sobre una empresa
nueva y las mete en el bundle.

## 7. Verificar antes de dar por terminado

```sh
cd apps/web
LEARN_ONLY=<modulo1>,<modulo2> npx vitest run app/admin/learn   # formato, referencias y texto
npx tsc --noEmit -p tsconfig.json                                # tipos
npx eslint app/admin/learn                                       # lint
node ../../scripts/help-captures/tools/shot-page.mjs /aprende/<modulo>/<articulo> nombre   # + DARK=1, W=390 H=844
```

Y mirar las fotos: el artículo tiene que verse completo, ordenado y bien en
claro, oscuro y celular.
