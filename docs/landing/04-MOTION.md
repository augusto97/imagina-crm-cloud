# Imagina Base — Dirección de motion y animaciones

> La regla: **el movimiento explica el producto**, no lo decora. Cada animación responde a
> una pregunta del visitante («¿cómo se ve?», «¿es fácil?», «¿qué hace solo?»). Todo lo que
> se mueve se puede pausar y respeta `prefers-reduced-motion`.

## 1. Referencias que vienen en este kit

### `motion/animaciones/` — el estilo de motion de la marca
Son las ilustraciones animadas reales del centro de aprendizaje de la app, grabadas
cuadro por cuadro (loops exactos de ~7 s, 1536×960, MP4 + WebM). Ya usan los colores, las
tipografías y los componentes de la app: **son la referencia de estilo número uno**. Se
pueden usar tal cual en la landing (en loop, silenciadas) o recrearlas en HTML/CSS.

| Archivo | Qué muestra | Sección sugerida |
|---|---|---|
| `vistas-hero` | La misma lista pasa de tabla → calendario → Gantt | Hero / «Los mismos datos…» |
| `tab-hero` | Un tablero de indicadores que se arma | Tableros |
| `kanban-drag` | Una tarjeta se arrastra entre etapas | Ventas y CRM |
| `auto-lienzo` | Un flujo de automatización con ramas | Automatizaciones |
| `automation-whatsapp` | Una automatización que manda un WhatsApp | Automatizaciones / Cobros |
| `cobro-hero` | Link de pago y estado del cobro | Cobros |
| `pdf-emitir` | Se emite una cuenta de cobro numerada | Cobros / Documentos |
| `portal-hero` | El portal del cliente | De cara a tus clientes |
| `form-hero` | Un formulario público que crea registros | De cara a tus clientes |
| `citas-hero` | La agenda pública para reservar | Agenda de citas |
| `mesa-sla` | Tickets con tiempos de respuesta (SLA) | Mesa de ayuda |
| `wab-template-send` | Envío de una plantilla de WhatsApp oficial | Integraciones |
| `ia-asistente` | El asistente propone cambios en lenguaje natural | IA |
| `ia-agente` | Un agente trabaja sobre los registros | IA |
| `pp-empezar` | Primeros pasos: de cero a la primera lista | Cómo empiezas |
| `empresa-branding` | Logo y colores propios aplicados | Tu marca |
| `tienda-sync` | La tienda WooCommerce sincronizada | Tienda online |
| `lote-pegar` | Pegar desde Excel en la tabla | Vistas (tabla tipo Excel) |

### `motion/app/` — la app real en uso
Clips grabados de la app con datos de ejemplo (1440×900, con cursor visible): sirven como
referencia de ritmo y, recortados, como videos de producto.

| Archivo | Qué muestra |
|---|---|
| `vistas-cambian` | Tareas: tabla → tablero → calendario → Gantt → carga del equipo |
| `kanban-arrastrar` | Mover una oportunidad de etapa; el total de la columna se actualiza |
| `busqueda-global` | Ctrl+K: buscar «colegio» y abrir el registro |
| `tabla-seleccionar-y-sumar` | Seleccionar celdas de montos y ver la suma |
| `automatizacion-flujo-a-lienzo` | El editor pasa de la vista de pasos al lienzo con ramas |
| `ficha-abrir` | Abrir la ficha de un cliente desde la tabla |
| `agenda-publica-reservar` | Un cliente elige servicio, día y hora |
| `tablero-ventas` | El tablero de ventas cargando con sus gráficos |

---

## 2. Tokens de movimiento (para todo el sitio)

| Token | Valor | Uso |
|---|---|---|
| `--dur-fast` | 150 ms | hover, foco, chips |
| `--dur-base` | 250 ms | cambios de estado, pestañas |
| `--dur-slow` | 450 ms | aparición de secciones |
| `--dur-hero` | 600 ms | transiciones de la demo del hero |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | entradas |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | transformaciones de vistas |
| `--stagger` | 40-80 ms | hijos de una sección |

Sin rebotes ni efectos elásticos: la marca es precisa y tranquila. Desplazamientos
cortos (8-16 px). Nada gira.

---

## 3. Las 15 ideas de motion

1. **Titular por líneas (al cargar).** El antetítulo, el subtítulo y los botones suben 12 px
   y pasan de un desenfoque de 6 px a nítido, escalonados cada 80 ms, en 500-600 ms con
   `--ease-out`. **El H1 se ve desde el primer cuadro** (es el LCP): solo se anima con
   `transform`, o desde `opacity: 0.001`, nunca desde 0.
2. **«Una base, muchas vistas» (hero, en loop).** Los mismos 8 registros pasan de filas
   de tabla a tarjetas de kanban, a bloques del calendario y a barras del Gantt (técnica
   FLIP o View Transitions API). 600 ms por transición, 4 s quieto en cada vista. Se
   pausa al pasar el mouse, al enfocar y fuera de pantalla. Referencia:
   `motion/animaciones/vistas-hero.mp4`.
3. **Chips «¿Qué quieres organizar?» (al tocar).** Los datos de la demo cambian con un
   fundido de 200 ms y los totales cuentan hasta su valor nuevo. Cada chip trae su lista:
   Clientes, Ventas (kanban), Cobros (facturas con estados), Proyectos (Gantt), Citas
   (semana), Soporte (SLA), Inventario.
4. **Cursor que demuestra (loop de 6-8 s, solo visible en pantalla).** Un cursor elige una
   celda de «Estado», abre el selector y elige «Pagada»; el chip cambia de color. Cada
   movimiento en 400 ms con `--ease-out`. Referencia: `motion/app/tabla-seleccionar-y-sumar.mp4`.
5. **Flujo de automatización que se dibuja (una vez, al 40 % visible).** El trazo del SVG
   avanza con `stroke-dashoffset` en 900 ms; los nodos aparecen de escala 0,96 a 1 con
   60 ms de escalonado; después un punto recorre el camino y aparece un aviso de WhatsApp.
   Referencia: `motion/animaciones/auto-lienzo.mp4`.
6. **Del cobro al pago (bloque «Cobra más rápido»).** Clic en «Generar PDF» → la hoja sale
   y se apila → se estampa «CC-0042» (escala 1,2 → 1 en 300 ms) → burbuja de WhatsApp con
   el link → «Pagado ✓ $1.250.000». Referencias: `pdf-emitir.mp4`, `cobro-hero.mp4`.
7. **Burbujas de WhatsApp (al entrar en pantalla).** Indicador «escribiendo…» durante
   800 ms y luego la burbuja; tres mensajes con 1,2 s entre cada uno. Referencia:
   `wab-template-send.mp4`.
8. **Contadores de KPI (una vez, al ser visibles).** De 0 al valor en 900 ms con
   `--ease-out`, en formato de pesos («$ 66.400.000»). `font-variant-numeric: tabular-nums`
   para que nada salte.
9. **Calculadora de precio (con el control deslizante).** Mueves «¿Cuántas personas son?»:
   la barra de «herramientas que cobran por usuario en dólares» crece; la de Imagina Base se
   queda plana. Transición de 250 ms. Muestra el dolor del cobro por usuario sin decirlo.
10. **Tu marca en vivo (al tocar una muestra de color).** El portal de ejemplo se tiñe por
    variables CSS en 400 ms y cambian el logo y el dominio de la barra
    (`portal.tuempresa.com`). Referencia: `empresa-branding.mp4`.
11. **Excel que se convierte en lista («Cómo empiezas»).** Una hoja de cálculo con
    columnas sueltas «cae» sobre la app; las columnas se reconocen solas (texto, número,
    fecha, teléfono) y la tabla se arma con chips de color, en 1,5 s. Es el importador casi
    automático de verdad. Referencia: `lote-pegar.mp4`, `pp-empezar.mp4`. Variante para la
    sección de IA (planes de pago): el cuadro que escribe solo («Tengo una distribuidora de
    alimentos con 3 vendedores…») con `ia-asistente.mp4`.
12. **Marquee de integraciones.** 40 s en `linear infinite`, con degradado de máscara en
    los bordes; se pausa con hover o foco. Con movimiento reducido pasa a una grilla quieta.
13. **Aparición de secciones (una sola vez).** `opacity` + `translateY(8px)` en 450 ms con
    hijos escalonados cada 40-60 ms. Nada más.
14. **Una sección fija con el scroll (solo escritorio).** En «Una base. Todo tu negocio.»,
    la pantalla de la app queda fija y cambia de caso mientras el texto avanza a la
    izquierda. En el celular no se fija: son pestañas.
15. **Botón claro/oscuro en la demo.** La interfaz cambia de tema en 300 ms: luce el modo
    oscuro real de la app (capturas en `capturas/oscuro/`).

### Motivo gráfico de la marca
El logo tiene **rayas diagonales blancas** y una **forma de pico (una «A»)** sobre un
degradado de azul a turquesa. Úsalo con moderación:
- Rayas diagonales finas (al 6-10 % de opacidad) como textura en el fondo del hero y del
  bloque de cobros, que se desplazan muy lento (60 s) y se quedan quietas con movimiento
  reducido.
- La forma de pico como máscara para revelar una captura (una sola vez, en el hero o en el
  llamado final).
- El degradado del logo (#00A0C7 → #00E3DF) para brillos suaves detrás de las capturas.

---

## 4. Rendimiento y accesibilidad (no negociables)

- **Movimiento reducido** (`prefers-reduced-motion: reduce`): sin loops, autoplay, marquee,
  parallax ni desenfoque; los cambios de estado son instantáneos.
- **WCAG 2.2.2:** todo lo que se mueva más de 5 s necesita un botón de pausa visible.
- **LCP:** el texto del hero no depende de JavaScript. La demo del hero es HTML/SVG o un
  póster AVIF con `fetchpriority="high"`. En el celular, póster quieto en vez de video.
- **Video:** WebM (VP9) + MP4 (H.264) de respaldo, `muted autoplay loop playsinline
  preload="none"` con póster; debajo del pliegue, arranque con IntersectionObserver. Loops
  de 6-12 s y menos de 1,5 MB cada uno (vuelve a comprimir los del kit para la web).
- **CLS:** `aspect-ratio` reservado en todo medio; contadores con `tabular-nums`; nada que
  se inserte arriba después de cargar.
- **INP y batería:** anima solo `transform` y `opacity`; el desenfoque solo en textos chicos
  y una vez; pausa todo lo que esté fuera de pantalla. Pensar en Android de gama media.
- **Herramientas:** CSS, SVG y Web Animations API para la interfaz (más livianas y se leen
  como texto). Lottie (dotLottie) solo para ilustraciones narrativas; Rive si hace falta
  interacción con estados. Si se usa GSAP, solo en esta página y solo ScrollTrigger.
- **WordPress:** encolar los scripts solo en la landing; la demo interactiva como un
  componente propio y liviano (JS sin framework o un islote de Preact), no con el motor de
  animaciones del constructor de páginas.
- **Accesibilidad de la demo:** pestañas con roles ARIA y flechas del teclado; el texto
  animado duplicado de forma visualmente oculta para lectores de pantalla; buen contraste
  en los dos temas.
