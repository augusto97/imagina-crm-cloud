# Prompt para Claude Design — Landing de Imagina Base

## Cómo usarlo (5 pasos)

1. En Claude Design, crea un proyecto nuevo: **«Landing Imagina Base»**.
2. **Sube estos archivos** (son los que más le sirven; si te deja subir más, agrega el resto
   de `capturas/`):
   - `marca/logo.png`, `marca/logo-oscuro.png`
   - `capturas/escritorio/01-ventas-pipeline-kanban.png`
   - `capturas/escritorio/02-clientes-tabla-tipo-excel.png`
   - `capturas/escritorio/03-tablero-ventas.png`
   - `capturas/escritorio/04-tablero-cartera.png`
   - `capturas/escritorio/07-gantt-cronograma.png`
   - `capturas/escritorio/10-ficha-del-cliente.png`
   - `capturas/escritorio/12-automatizacion-lienzo.png`
   - `capturas/escritorio/14-integraciones.png`
   - `capturas/escritorio/20-agenda-publica-horario.png`
   - `capturas/escritorio/22-documento-pdf-editor.png`
   - `capturas/escritorio/24-portal-editor.png`
   - `capturas/oscuro/03-tablero-ventas-oscuro.png`
   - `capturas/celular/01-ventas-pipeline-kanban-celular.png`, `10-ficha-del-cliente-celular.png`, `15-mi-trabajo-celular.png`
   - Los documentos `02-TEXTOS-LANDING.md`, `03-SEO.md` y `04-MOTION.md`
   - Si acepta video: `motion/animaciones/vistas-hero.mp4`, `auto-lienzo.mp4`, `pdf-emitir.mp4`
3. **Pega el prompt de abajo** (bloque «PROMPT PRINCIPAL») completo.
4. Revisa la primera versión y usa los **prompts de seguimiento** del final para iterar
   sección por sección.
5. Cuando te guste, pídele la **entrega para WordPress** (último prompt de seguimiento).

---

## PROMPT PRINCIPAL (copiar y pegar)

```
Diseña la landing page de Imagina Base, una plataforma SaaS para que las pequeñas y
medianas empresas de Latinoamérica organicen su negocio sin programar. La página vivirá
en WordPress en imagina.cloud/base, tiene que posicionar en Google en español y
convencer a dueños de negocio de crear su cuenta y después pagar un plan.

Te adjunto: el logo, capturas REALES de la app (con datos de ejemplo de una empresa
ficticia, «Distribuidora Andina»), videos de las animaciones de la app, y tres
documentos: 02-TEXTOS-LANDING.md (todos los textos, sección por sección: úsalos tal
cual), 03-SEO.md (estructura de encabezados y requisitos de SEO) y 04-MOTION.md
(dirección de animaciones). Léelos completos antes de diseñar.

QUÉ ES EL PRODUCTO
Imagina Base es una base de datos flexible sin código (como Airtable, ClickUp o las
bases de Notion), pensada y escrita para Latinoamérica. Con ella cada empresa arma su
CRM, su facturación y cobros, sus proyectos, su agenda de citas, su mesa de ayuda o su
inventario. Incluye: más de 30 tipos de campo; vistas de tabla tipo Excel, kanban con
totales, calendario, cronograma (Gantt) y carga de trabajo; tableros con indicadores;
automatizaciones visuales con esperas y condiciones; formularios públicos; portal para
los clientes; agenda de citas pública; cotizaciones y cuentas de cobro en PDF; links de
pago con Mercado Pago y Wompi; WhatsApp Business oficial; integraciones con Gmail,
Google Calendar/Sheets/Drive, Outlook, Slack, Telegram, WooCommerce y SQL Server;
inteligencia artificial (asistente que arma listas y tableros en lenguaje natural,
agentes que trabajan sobre los registros, campos con IA, conexión con Claude); marca
blanca con dominio propio; app instalable en el celular con notificaciones; importador
de Excel casi automático (reconoce las columnas y su tipo y arma la lista sola). Se
cobra POR EMPRESA (no por usuario), en pesos colombianos, con PSE, Nequi o tarjeta.

MODELO COMERCIAL: prueba gratis de 15 días sin tarjeta (hasta 500 registros, 3
personas, 3 automatizaciones). Planes de pago: Starter $59.000 COP/mes (US$15) y Pro
$199.000 COP/mes (US$49), más Empresa a medida. El asistente IA y el soporte en español
están SOLO en los planes de pago: dilo así donde aparezcan, sin esconderlo.

PARA QUIÉN
Dueños, gerentes y coordinadores de pymes de 3 a 50 personas en Colombia y el resto de
Latinoamérica (distribuidoras, agencias, inmobiliarias, clínicas y consultorios,
academias, tiendas online, empresas de servicios). No son técnicos. Hoy trabajan con
Excel, WhatsApp y varias apps sueltas. Segundo público: agencias y consultores que
implementan sistemas para sus clientes (les interesa la marca blanca).

MENSAJE CENTRAL
«Una base. Todo tu negocio.» No listes 30 funciones: muestra UN MISMO conjunto de datos
que cambia de forma (tabla → kanban → calendario → Gantt → portal → PDF) y deja que el
visitante elija SU caso desde el primer pantallazo. Los diferenciales frente a la
competencia internacional (que cobra en dólares, por usuario y con el sitio a medio
traducir) son: español neutro de punta a punta, precio por empresa en pesos, PSE y
Nequi, WhatsApp oficial, cuentas de cobro en PDF, portal para clientes sin costo por
usuario, Ley 1581 de datos personales, y «tus datos nunca se secuestran» (si dejas de
pagar, nada se borra: queda en solo lectura y exportas todo).

TONO
Español neutro, tuteando, cercano y claro, sin jerga técnica ni anglicismos («empresa»,
no «workspace»; «tablero», no «dashboard» en los titulares). Frases cortas. Beneficio
primero, función después. Nunca voseo («puedes», no «podés»). La IA no es el titular:
aparece como una ayuda concreta, en su propia sección.

IDENTIDAD VISUAL
- Logo: círculo con degradado de azul a turquesa, una forma de pico («A») blanca y rayas
  diagonales blancas. Archivos: logo.png (fondos claros) y logo-oscuro.png.
- Colores de marca (sacados del logo): Azul profundo #00A0C7, Azul cian #00AAD5,
  Turquesa #00CBD3, Aqua #00E3DF. Degradado de marca: #00A0C7 → #00E3DF.
- Color de la interfaz de la app (botones, enlaces, pestañas activas): teal #0C7E97;
  menú lateral oscuro de la app: #1E5867. Usa el teal para los botones de la landing,
  así lo que ve el visitante coincide con la app.
- Neutros: fondo #FFFFFF y #F6F8FA, texto #0F172A, texto secundario #475569, bordes
  #E2E8F0. Una sección oscura (fondo #0B1220 o el #121212 del modo oscuro de la app)
  para cortar el ritmo (por ejemplo, automatizaciones o IA).
- Colores de estado de la app (chips de opciones, la paleta 500 de Tailwind): celeste
  #0EA5E9, azul #3B82F6, violeta #8B5CF6, ámbar #F59E0B, esmeralda #10B981, rosa
  #F43F5E. Úsalos solo dentro de las capturas o maquetas de la app.
- Tipografía: Inter (la misma de la app). Titulares en Inter 700-800 con interlineado
  ajustado y tracking levemente negativo; texto en Inter 400-500. Números con
  tabular-nums.
- Formas: tarjetas con esquinas de 12-16 px, bordes finos de 1 px, sombras suaves y
  amplias. Las capturas siempre dentro de un marco de navegador minimalista (tres puntos
  y la URL base.imagina.cloud) o de un teléfono, con un brillo suave del degradado de
  marca detrás.
- Motivo de marca: las rayas diagonales del logo como textura muy sutil (6-10 % de
  opacidad) en el hero y en el bloque de cobros; la forma de pico como máscara para
  revelar una captura una sola vez. Sin ilustraciones genéricas de personas.
- Estilo general: limpio, luminoso, mucho aire, producto real en primer plano, como
  Attio, Linear o el CRM de monday, pero cálido y latinoamericano.

ESTRUCTURA (en este orden; los textos exactos están en 02-TEXTOS-LANDING.md)
0. Barra superior fija con logo, menú (Producto, Soluciones, Precios, Aprende), «Entrar»
   y el botón «Prueba gratis».
1. HERO: antetítulo, H1 «Organiza tu negocio a tu manera, sin programar», subtítulo,
   botón principal «Probar gratis 15 días» + secundario «Ver cómo funciona», y el
   micro-texto «15 días gratis · Sin tarjeta · En español · Precios en pesos». A la derecha (o debajo en
   celular) una DEMO INTERACTIVA de la app hecha en HTML/CSS (no una imagen plana) con
   chips «¿Qué quieres organizar?» (Clientes, Ventas, Cobros, Proyectos, Citas, Soporte,
   Inventario): cada chip cambia los datos y la vista. Basa la demo en las capturas
   01-ventas-pipeline-kanban, 02-clientes-tabla-tipo-excel y 07-gantt-cronograma, y en el
   video vistas-hero.mp4.
2. Franja de confianza con 5 íconos (Hecho en Colombia, 100 % en español, precios en
   pesos, PSE/Nequi/tarjeta, datos siempre exportables) y un espacio reservado para logos
   de clientes (déjalo como placeholder discreto, sin logos inventados).
3. El problema: «¿Tu negocio vive entre Excel, WhatsApp y cinco apps que no se hablan?»
   con tres tarjetas.
4. «Una base. Todo tu negocio.»: pestañas por caso de uso (Ventas y CRM, Cobros y
   cartera, Proyectos y tareas, Agenda de citas, Mesa de ayuda, Tienda online, A tu
   medida). En escritorio, la captura queda fija y cambia mientras el texto avanza; en
   celular, pestañas deslizables. Cada pestaña: título, 3 viñetas, captura y botón «Usar
   esta plantilla».
5. Cómo empiezas en 3 pasos. Protagonista: el importador de Excel (un archivo entra en
   la pantalla y se convierte en la lista, con el tipo de cada columna marcado).
6. Vistas: selector de 6 vistas sobre los mismos datos.
7. Automatizaciones (sección oscura): un flujo que se dibuja solo (factura por vencer →
   recordatorio → espera 3 días → si sigue pendiente…), con la captura del lienzo y la
   mención de las 39 ideas listas para activar.
8. Tableros: indicadores y gráficos (captura del tablero de ventas y del de cartera).
9. De cara a tus clientes: portal, formularios, agenda en línea, documentos PDF (cuatro
   tarjetas grandes con captura).
10. Bloque destacado de cobros con el degradado de marca: de la cuenta de cobro al pago
    por WhatsApp, animado.
11. Inteligencia artificial: asistente, agentes y campos con IA (tres columnas), con
    la etiqueta «Incluida en los planes de pago».
12. Integraciones: marquee de logos + tres viñetas.
13. En el celular: tres teléfonos en abanico con las capturas de celular.
14. Tu marca: demo de marca blanca (el portal cambia de color al tocar muestras).
15. Hecho para Latinoamérica: seis tarjetas.
16. Seguridad: cinco viñetas con íconos.
17. Comparativa en tabla HTML (no imagen), con texto en lugar de ✓/✗ para la
    competencia.
18. Precios: una franja «Prueba gratis de 15 días, sin tarjeta» y 3 planes en tarjetas
    (Starter, Pro, Empresa) con precios en pesos y un interruptor de moneda COP/USD;
    incluye una mini calculadora «¿Cuántas personas son?» que compara contra
    herramientas que cobran por usuario.
19. Aprende y soporte (soporte en español en los planes de pago).
20. Preguntas frecuentes en acordeón (15 preguntas, visibles en el HTML).
21. Llamado final con el degradado de marca y el botón «Probar gratis 15 días».
22. Pie de página.

ANIMACIONES (detalle en 04-MOTION.md)
El movimiento explica el producto, no decora. Usa: titular que se revela por líneas
SIN ocultar el H1 (el H1 se ve desde el primer cuadro), la demo del hero que cambia de
vista en loop (pausable), contadores de pesos que suben al entrar en pantalla, el flujo
de automatización que se dibuja con SVG, la burbuja de WhatsApp con el link de pago, el
PDF que se estampa con su número, el marquee de integraciones con bordes desvanecidos y
apariciones suaves de sección (opacidad + 8 px, escalonadas). Solo transform y opacity.
Duraciones de 150 a 600 ms, easing cubic-bezier(0.22,1,0.36,1), sin rebotes. Todo con
variante prefers-reduced-motion (sin loops ni autoplay) y botón de pausa en lo que se
mueva más de 5 segundos. Los videos de motion/animaciones son el estilo de referencia:
recréalos en HTML/CSS/SVG o úsalos como video en loop silenciado con póster.

REQUISITOS DE SEO Y RENDIMIENTO
- Un solo H1; un H2 por sección (estructura en 03-SEO.md). Todo el texto como texto real,
  nunca dentro de imágenes. Mínimo 1.200 palabras visibles.
- Imágenes con alt descriptivo, ancho y alto definidos, AVIF/WebP, carga diferida fuera
  del primer pantallazo. Video con póster, muted, playsinline y preload="none".
- Metas: LCP ≤ 2 s en un Android de gama media, CLS ≤ 0,05, INP ≤ 150 ms.
- Diseño mobile-first: diséñalo en 1440 px y en 390 px. En el celular, botón flotante
  «Prueba gratis» y nada de secciones fijas con scroll.
- Accesible: contraste AA, foco visible, pestañas y acordeones operables con teclado.

LO QUE NO DEBES HACER
- No inventes cifras, testimonios, logos de clientes, calificaciones ni certificaciones.
  Donde haga falta prueba social, deja un espacio marcado «[CUANDO EXISTA]».
- No digas que hace factura electrónica de la DIAN (no la hace).
- No uses el nombre de otra empresa como logo de cliente.
- No uses ilustraciones genéricas ni fotos de stock: el protagonista es la app real.
- No pongas más de un botón principal por sección.

ENTREGABLE DE ESTA PRIMERA VUELTA
La página completa en escritorio (1440 px) con todas las secciones, más el hero, la
sección de pestañas y precios también en celular (390 px). Usa los textos de
02-TEXTOS-LANDING.md tal cual; si algo no entra, propón una versión más corta y márcala.
```

---

## Prompts de seguimiento (para iterar)

1. **Hero:** «Haz que la demo del hero sea interactiva: los chips cambian la lista y la
   vista (Ventas = kanban con totales en pesos; Cobros = tabla de facturas con estados de
   color; Proyectos = Gantt; Citas = calendario semanal; Soporte = kanban por SLA). Basa
   cada estado en las capturas que te pasé. Agrega el loop automático entre vistas cada
   4 segundos con botón de pausa.»
2. **Celular:** «Diseña la versión de 390 px de toda la página. Las pestañas de casos de
   uso pasan a carrusel deslizable, la comparativa a tarjetas apiladas, y agrega el botón
   flotante «Prueba gratis» que aparece después del hero.»
3. **Automatizaciones:** «Anima la sección de automatizaciones: el flujo se dibuja con
   SVG al entrar en pantalla, un punto recorre el camino y al final aparece una burbuja de
   WhatsApp con un link de pago. Sigue 04-MOTION.md, ideas 5 y 7.»
4. **Precios:** «Diseña la página completa de precios (/base/precios/) con la tabla de
   límites de cada plan, el interruptor de moneda COP/USD, la calculadora por número de
   personas, las formas de pago (PSE, Nequi, tarjeta, efectivo) y preguntas frecuentes de
   facturación.»
5. **Plantilla de página de solución:** «Con el mismo sistema visual, diseña una plantilla
   reutilizable para las páginas de solución (/base/crm/, /base/cobros/,
   /base/agenda-de-citas/…): hero con H1 propio, dolor, 3 bloques de función con captura,
   plantilla recomendada, preguntas frecuentes y llamado final.»
6. **Comparativa «alternativa a»:** «Diseña la plantilla de página /base/alternativas/airtable/
   con una tabla comparativa honesta (ventajas y desventajas), la ayuda para migrar y un
   llamado a la acción.»
7. **Entrega para WordPress:** «Prepara la entrega para implementarla en WordPress: HTML
   semántico por sección (cada sección como un bloque independiente), CSS con variables
   para los colores y tiempos de animación, JavaScript sin frameworks y solo para lo
   interactivo (demo del hero, pestañas, contadores, calculadora, acordeón), con
   prefers-reduced-motion y IntersectionObserver. Lista los recursos (imágenes, videos)
   con su nombre, tamaño y formato final.»
