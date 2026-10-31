import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ───────────────────────────── 1. Asistente ─────────────────────────────
    {
        id: 'ia-asistente',
        route: '/lists',
        related: ['ia-clave-privacidad', 'ia-mcp', 'automatizaciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'El **asistente** es un chat dentro de la app al que le pides cosas como se las pedirías a alguien del equipo: «ármame una lista de pedidos con estado, cliente y total, y un tablero por estado», «¿cuántas facturas vencidas tengo de Medellín?», «sube 10 % el precio de las tazas». Se abre con el botón de la chispa (**Asistente IA**) en la barra de arriba, desde cualquier pantalla.',
            },
            { t: 'anim', key: 'ia-asistente', caption: 'Un pedido en tus palabras, una tarjeta con la vista previa y «Aplicar»: la lista aparece en el menú.' },
            { t: 'h', text: 'Propone, revisas, aplicas' },
            {
                t: 'p',
                md: 'El asistente **nunca cambia nada por su cuenta**. Cuando le pides algo que crea o modifica, responde con una **tarjeta de propuesta**: qué va a crear, con qué campos, qué registros toca y una muestra de cómo quedan. Nada pasa hasta que tocas **Aplicar**. Si algo no te convence, sigue la conversación («el estado que tenga también "En camino"») y te arma otra tarjeta.',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'List', title: 'Estructura', md: 'Listas (incluso varias vinculadas entre sí), campos y sus opciones, vistas, tableros, automatizaciones, formularios, la ficha del registro, el portal del cliente, permisos, plantillas de PDF y agentes.', tone: 'violet' },
                    { icon: 'Search', title: 'Preguntas sobre tus datos', md: '«¿Cuánto vendimos en septiembre por vendedor?», «muéstrame los tickets abiertos de más de 3 días». Responde con lo que **tú** puedes ver.', tone: 'blue' },
                    { icon: 'PenLine', title: 'Cambios en registros', md: 'Crear registros, cambiar un valor en muchos a la vez, subir precios un porcentaje, correr fechas, borrar los que cumplan un filtro. Siempre con vista previa.', tone: 'amber' },
                ],
            },
            { t: 'h', text: 'Cómo pedir bien' },
            {
                t: 'steps',
                items: [
                    'Abre la lista sobre la que vas a trabajar: el asistente sabe en qué lista estás y la usa por defecto.',
                    'Toca **Asistente IA** y escribe el pedido con el resultado que esperas: qué, dónde y con qué datos.',
                    'Lee la tarjeta: nombres, campos, cuántos registros cambian y la muestra de antes y después.',
                    'Toca **Aplicar**. Si la tarjeta borra algo o toca muchos registros, te pide confirmar con **Sí, aplicar (no se puede deshacer)**.',
                    'Abre el resultado con el enlace de la tarjeta y ajusta lo que quieras a mano.',
                ],
            },
            {
                t: 'example',
                title: 'Pedidos que funcionan bien',
                md: '«En Clientes agrega un campo Ciudad con Bogotá, Medellín y Cali». «Crea una automatización que, cuando una factura pase a Pagada, le mande un correo de gracias al cliente». «Haz un tablero de ventas con el total del mes, ventas por vendedor y un embudo por etapa». «En Productos, sube 10 % el precio de la categoría Tazas y redondea a terminar en 900».',
            },
            {
                t: 'settings',
                title: 'Lo que ves en el panel',
                rows: [
                    { name: 'Tarjeta de propuesta', what: 'El cambio con su vista previa y el botón **Aplicar**. Una vez aplicada dice **Aplicada** y no se puede aplicar dos veces.' },
                    { name: 'Pensando…', what: 'El asistente está leyendo tus listas o armando la propuesta. **Detener** lo corta.' },
                    { name: 'Nueva conversación', what: 'Empieza de cero. Las conversaciones se guardan 24 horas: si cierras el panel, al volver sigues donde quedaste.' },
                    { name: 'Modelo y esfuerzo', what: 'Debajo del título se ve con qué modelo habla y cuánto piensa antes de responder.', tip: 'Los elige quien administra la empresa en **Ajustes** → **Asistente IA**.' },
                    { name: 'Pedidos este mes', what: 'Con la clave de la plataforma, cuántos pedidos quedan de la cuota del plan.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Hace sólo lo que tu rol permite',
                md: 'El asistente trabaja con tus permisos. Si tu rol no puede crear listas, no te va a proponer una; si sólo ves tus registros, sólo consulta esos. Y al aplicar se vuelve a comprobar: si mientras tanto te cambiaron el rol, la tarjeta no se aplica.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Lo que escribe la gente no son órdenes',
                md: 'Si un registro dice «borra todo», el asistente lo lee como un dato, no como una instrucción. Y aunque se confundiera, no puede hacer nada sin que tú toques **Aplicar**.',
            },
            { t: 'h', text: 'Más IA, sin abrir el chat' },
            {
                t: 'p',
                md: 'El asistente es para cuando tú le pides algo. Para que la IA trabaje sola con cada registro hay dos piezas más: los **campos con IA**, que completan un valor (una prioridad, un resumen, un dato extraído), y los **agentes**, que leen, deciden y actúan con varias herramientas.',
            },
            { t: 'anim', key: 'ia-campo', caption: 'Un campo con IA clasifica cada ticket nuevo sin que nadie lo pida.' },
            {
                t: 'faq',
                items: [
                    { q: 'Dice «El asistente no está disponible». ¿Qué hago?', a: 'La IA no está activada en tu empresa, se agotó la cuota del mes o falta la clave. El panel dice el motivo; quien administra la empresa lo resuelve en **Ajustes** → **Asistente IA**.' },
                    { q: '¿Puede borrar cosas?', a: 'Puede proponer borrar (una lista, un campo, registros que cumplan un filtro). Esas tarjetas se marcan en rojo y piden confirmación. Lo borrado va a la papelera por 30 días.' },
                    { q: '¿Recuerda lo que le dije la semana pasada?', a: 'No: cada conversación dura 24 horas. Lo que sí sabe siempre es cómo están armadas tus listas en este momento.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Recorrido por el asistente', tour: 'assistant' },
                    { label: 'Activar la IA y la clave', article: 'ia-clave-privacidad' },
                    { label: 'Usarlo desde Claude', article: 'ia-mcp' },
                ],
            },
        ],
    },

    // ───────────────────────────── 2. Campos con IA ─────────────────────────────
    // ─────────────────────────── 1b. Sugerencias ───────────────────────────
    {
        id: 'ia-sugerencias',
        route: '/lists',
        related: ['vistas-que-son', 'tableros-crear', 'automatizaciones-que-son', 'ia-clave-privacidad'],
        blocks: [
            {
                t: 'p',
                md: 'Cada lista te puede decir qué conviene armar con lo que ya tiene: una vista por estado si tus registros tienen etapas, un calendario si hay fechas, un tablero con tus números, un aviso cuando algo vence. Son **sugerencias para esa lista**, sacadas de sus campos y de sus registros, no ideas genéricas. Aparecen en el botón **Sugerencias** de la cabecera de la lista, con un número cuando hay alguna nueva.',
            },
            { t: 'anim', key: 'sugerencias-lista', caption: 'El aviso abre el panel; una sugerencia se crea con un clic y la IA suma ideas cuando la pides.' },
            { t: 'h', text: 'Dos clases de sugerencias' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Wand2',
                        title: 'Para tu lista (gratis, siempre)',
                        md: 'La app mira tu lista y propone lo que suele servir: **tablero por estado**, **calendario**, una vista de **vencidos**, **Gantt** o **carga de trabajo** si hay fechas y responsables, un **tablero** con tus números, **convertir un texto en selección** cuando se repiten pocos valores, avisos de **registros repetidos** o de **campos vacíos**, y un **formulario** para recibir registros. No usa IA ni gasta nada.',
                        tone: 'blue',
                    },
                    {
                        icon: 'Sparkles',
                        title: 'Con IA (a pedido)',
                        md: 'Con **Analizar con IA**, la IA lee un resumen de la lista (y, si lo eliges, algunos ejemplos de texto con los datos personales tapados) y propone hasta 6 ideas propias: vistas, tableros, automatizaciones y campos que encajan con tu negocio. Sólo corre cuando tú la pides: nada se analiza solo ni en segundo plano.',
                        tone: 'violet',
                    },
                ],
            },
            {
                t: 'p',
                md: 'Cada sugerencia dice **por qué** con tus datos («6 registros tienen la fecha de pago anterior a hoy y siguen sin cerrar») y, si crea algo grande como un tablero, **Ver qué se crea** te muestra el detalle antes. También aparecen algunas ideas de la galería que encajan con tus campos.',
            },
            { t: 'h', text: 'Aplicar, descartar y volver a ver' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y toca **Sugerencias** en la cabecera (o **Personalizar vista** → **Sugerencias para esta lista**).',
                    'Lee el porqué de cada una. Si te sirve, toca su botón (**Crear la vista**, **Crear el tablero**, **Crear la automatización**…): se crea al instante y el aviso te lleva a verla.',
                    'Lo que ya creaste queda en **Aplicadas**, con su enlace.',
                    'Si una no te sirve, toca la **X**: pasa a **Descartadas** y no vuelve a aparecer. Desde ahí puedes mostrarla de nuevo.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Nada se crea solo',
                md: 'Ni las reglas ni la IA cambian tu lista: sólo proponen. Lo que apruebas se crea con tu acceso y queda en la actividad como cualquier cambio tuyo. Una automatización que propone la IA se crea **activa**; si prefieres revisarla antes, ábrela desde **Automatizaciones** y páusala.',
            },
            { t: 'h', text: 'El análisis con IA y su cupo' },
            {
                t: 'settings',
                title: 'Cómo funciona «Analizar con IA»',
                rows: [
                    { name: 'Cupo del mes', what: 'Cada empresa tiene **5 análisis por mes** (el panel dice cuántos quedan). Es aparte de la cuota del asistente. Con una **clave propia** de IA no hay límite.', tip: 'Si un análisis falla, no se descuenta.' },
                    { name: '¿De qué se trata la lista?', what: 'Opcional: una línea sobre para qué la usas («cobros mensuales a clientes de hosting») hace que las ideas encajen mejor. En una lista con pocos registros, el panel te lo pide.' },
                    { name: 'Volver a analizar', what: 'Si la lista no cambió, el botón espera 30 días: el resultado sería el mismo. Si agregas campos o vistas, o escribes otro propósito, se habilita al toque.' },
                    { name: 'Qué viaja a la IA', what: 'La **estructura** de la lista (campos, tipos, opciones, vistas, automatizaciones) y **números** (cuántos registros, cuántos llenos, rangos de fechas y montos). Sin la casilla de abajo, **nunca** los textos de tus registros: ni nombres, ni correos, ni teléfonos, ni documentos.' },
                    { name: 'Incluir ejemplos de texto', what: 'Opcional y apagada por defecto. Marcada, suma **hasta 5 ejemplos cortos** por campo de texto para que la IA entienda qué guardas («Renovación de hosting por 12 meses»). Antes de enviarlos se tapan correos, enlaces, números largos (documentos, teléfonos, cuentas) y nombres propios, y de los campos que guardan datos de personas (nombre, cliente, documento, dirección…) no se envía ninguno.', tip: 'Úsala si tu lista tiene notas o descripciones que explican el negocio y las ideas te salen genéricas. Con o sin ejemplos cuentan como análisis distintos.' },
                    { name: 'Qué puede proponer', what: 'Vistas, tableros, campos y automatizaciones que se quedan dentro de la app (cambiar un campo, enviar un correo, esperar, crear un registro). Nunca algo que llame a un servicio externo.' },
                ],
            },
            { t: 'h', text: 'Quién las ve y cómo apagarlas' },
            {
                t: 'p',
                md: 'Las ven **administradores y gerentes**, que son quienes arman la lista. Y cada sugerencia sólo aparece si tu rol puede crear eso (por ejemplo, una automatización exige poder administrar automatizaciones).',
            },
            {
                t: 'settings',
                title: 'Al pie del panel de sugerencias',
                rows: [
                    { name: 'Avisarme en la cabecera de las listas', what: 'Apágalo y el botón **Sugerencias** deja de aparecer en la cabecera **para ti**. El panel se sigue abriendo desde **Personalizar vista**.' },
                    { name: 'Empresa', what: 'Sólo el administrador: **Con reglas y con IA** (recomendado), **Sólo reglas, sin IA** o **Apagadas** para todo el equipo.' },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: una lista de cobros',
                md: 'Una agencia importa sus cobros de un Excel. El panel le sugiere un **tablero por «Estado»** (20 de 30 están en «Pendiente»), una vista **Vencidos** con los 6 que pasaron su fecha y **convertir «Ciudad» en selección** (sólo hay 3 valores distintos). Con **Analizar con IA**, la IA suma «Marca solo lo vencido»: una automatización que pone el estado en «Vencida» al día siguiente de la fecha de pago. Cuatro clics y la lista quedó armada.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo el botón «Sugerencias».', a: 'Lo ven administradores y gerentes. Si lo eres, puede que lo hayas ocultado (ábrelo desde **Personalizar vista** y vuelve a marcar «Avisarme en la cabecera») o que el administrador las haya apagado para la empresa.' },
                    { q: 'El botón de la IA está deshabilitado.', a: 'El panel dice por qué: la IA no está activada en la empresa, tu plan no la incluye, se acabó el cupo del mes o la lista no cambió desde el último análisis.' },
                    { q: '¿Las sugerencias de la IA cambian solas?', a: 'No. Quedan guardadas hasta el próximo análisis, que sólo corre cuando alguien lo pide.' },
                    { q: 'Apliqué una por error.', a: 'Lo creado es una vista, un tablero, un campo o una automatización común: bórralo como cualquier otro y va a la papelera.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Activar la IA', article: 'ia-clave-privacidad' },
                ],
            },
        ],
    },
    {
        id: 'ia-campos',
        route: '/lists',
        related: ['ia-agentes', 'ia-clave-privacidad', 'vistas-filtros-y-orden'],
        blocks: [
            {
                t: 'p',
                md: 'Un **Campo con IA** se completa solo en cada registro leyendo otros campos: resume una conversación larga, clasifica un ticket en Alta, Media o Baja, saca el NIT de un texto, traduce una descripción. Se ve como una columna más: se filtra, se ordena, se busca y se exporta, pero nadie lo escribe a mano.',
            },
            { t: 'anim', key: 'ia-campo', caption: 'Un campo «Prioridad» que clasifica cada ticket según su asunto y su descripción.' },
            { t: 'h', text: 'Qué puede hacer' },
            {
                t: 'cards',
                items: [
                    { icon: 'FileText', title: 'Resumir', md: 'Un resumen corto, medio o largo de lo que dicen los campos que lee. Ideal para descripciones, correos o notas largas.', tone: 'blue' },
                    { icon: 'Tag', title: 'Clasificar', md: 'Elige **una** de las opciones que escribas («Alta, Media, Baja», «Reclamo, Consulta, Venta»). Si responde otra cosa, no se guarda.', tone: 'violet' },
                    { icon: 'Search', title: 'Extraer un dato', md: 'Saca un dato concreto: el NIT, el número de pedido, la ciudad, la fecha de entrega que menciona el cliente.', tone: 'amber' },
                    { icon: 'Globe', title: 'Traducir', md: 'Al idioma que elijas, por ejemplo para atender clientes que escriben en inglés.', tone: 'mint' },
                    { icon: 'Wand2', title: 'Personalizado', md: 'Lo que le pidas con tus instrucciones: «escribe un mensaje de bienvenida corto para este cliente».', tone: 'rose' },
                ],
            },
            { t: 'h', text: 'Crear el campo' },
            {
                t: 'steps',
                items: [
                    'En la tabla de la lista, toca el **+** al final de las columnas y busca **Campo con IA** (o créalo desde **Configurar lista** → **Campos**).',
                    'Ponle un nombre, por ejemplo «Prioridad sugerida».',
                    'En **Qué hace**, elige la tarea.',
                    'En **Lee de estos campos**, marca los campos que tiene que mirar (asunto, descripción, un campo Archivo con el PDF).',
                    'Completa lo de la tarea: las **Opciones (una por renglón)**, **Qué dato extraer**, el **Idioma** o las **Instrucciones**.',
                    'Guarda. Se calcula en cada registro nuevo y, con **Completar los vacíos**, en los que ya existen.',
                ],
            },
            { t: 'demo', key: 'ia-campo-crear', caption: 'Del «+» de la tabla a un campo que clasifica solo.', fallback: 'ia-campo' },
            {
                t: 'settings',
                title: 'Los ajustes del campo',
                rows: [
                    { name: 'Lee de estos campos', what: 'De dónde saca la información. Mientras menos y más precisos, mejor responde.', tip: 'De un campo Archivo lee los PDF y las imágenes (hasta 3, de 5 MB cada uno): facturas, cédulas, cotizaciones.' },
                    { name: 'Opciones (una por renglón)', what: 'Sólo al clasificar: la respuesta siempre es una de estas.' },
                    { name: 'Indicaciones extra (opcional)', what: 'Pistas para que responda como necesitas: «menciona siempre el monto y la fecha».' },
                    { name: 'Largo de la respuesta', what: '**Corta**, **Media** o **Larga**.' },
                    { name: 'Modelo', what: '**Rápido (recomendado)** o **El del asistente** (más capaz y más lento).', tip: 'El rápido alcanza para clasificar y extraer; usa el del asistente para resúmenes delicados.' },
                    { name: 'Recalcular solo cuando cambian los campos que lee', what: 'Si cambian el asunto o la descripción, el valor se vuelve a calcular a los pocos segundos.', tip: 'Apágalo si quieres que la primera respuesta quede fija.' },
                    { name: 'Completar los vacíos', what: 'Calcula los registros que ya existían y no tienen valor (hasta 500 por vez, y nunca más de lo que queda de la cuota).' },
                    { name: 'Recalcular todos', what: 'Vuelve a calcular todos, por ejemplo después de cambiar las opciones.' },
                    { name: 'Último error', what: 'Si un cálculo falló (IA apagada, cuota agotada, respuesta fuera de las opciones), aquí está el motivo.' },
                ],
            },
            {
                t: 'p',
                md: 'En la ficha del registro, el valor se lee con una chispa al lado y un botón **Calcular** o **Recalcular** para pedirlo en el momento; si no se puede, dice por qué.',
            },
            {
                t: 'example',
                title: 'Tres usos que ahorran horas',
                md: '**Soporte**: «Tema» clasifica cada ticket en Facturación, Envíos o Producto, y una vista agrupada por Tema reparte el trabajo. **Ventas**: «Resumen» deja en dos líneas qué quiere cada prospecto según sus notas. **Administración**: «NIT» se extrae solo del RUT que el cliente sube en PDF.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Cada cálculo es un pedido de IA',
                md: 'Con la clave de la plataforma, cada registro calculado cuenta para la cuota mensual del plan. Antes de **Recalcular todos** en una lista grande, revisa cuánto te queda en **Ajustes** → **Plan y uso**, o carga una clave propia.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo editar a mano lo que puso la IA?', a: 'No: el campo siempre es lo que calcula la IA. Si quieres corregirlo a mano, usa un campo normal y un agente que lo complete, o copia el valor con una automatización.' },
                    { q: 'El campo está vacío en algunos registros.', a: 'Los campos que lee estaban vacíos (no gasta un pedido en nada), o el cálculo falló: mira **Último error**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Que un agente haga más que un campo', article: 'ia-agentes' },
                    { label: 'Clave y cuota de IA', article: 'ia-clave-privacidad' },
                ],
            },
        ],
    },

    // ───────────────────────────── 3. Agentes ─────────────────────────────
    {
        id: 'ia-agentes',
        route: '/agents',
        related: ['ia-agentes-trabajo', 'ia-campos', 'equipo-y-permisos-roles-propios'],
        blocks: [
            {
                t: 'p',
                md: 'Un **agente de IA** es un compañero que trabaja solo sobre tus registros: lee un ticket nuevo, decide su prioridad y deja una nota con el motivo; resume una venta cuando se cierra; completa los datos que faltan leyendo la descripción. A diferencia de un campo con IA, que escribe un solo valor, un agente puede **leer, buscar, cambiar varios campos, comentar, asignar y pedir aprobaciones**, según las herramientas que le des.',
            },
            { t: 'anim', key: 'ia-agente', caption: 'El clasificador lee el ticket, propone prioridad y responsable, y una persona lo aplica.' },
            { t: 'h', text: 'Crear un agente' },
            {
                t: 'steps',
                items: [
                    'En el menú de la izquierda, toca **Agentes** (lo ve quien administra la empresa, o un rol con ese permiso).',
                    'Toca una plantilla de **Empieza con una plantilla** o **En blanco**.',
                    'Ponle **Nombre**, color e ícono, y revisa **Qué hace**: las instrucciones, escritas como se las explicarías a alguien nuevo en el equipo.',
                    'En **Dónde trabaja**, elige las listas.',
                    'En **Herramientas**, deja sólo lo que necesita.',
                    'Elige **Cómo aplica los cambios** y, si quieres, quiénes revisan sus propuestas.',
                    'Toca **Crear agente**. Después dile cuándo trabaja o pruébalo sobre un registro.',
                ],
            },
            { t: 'demo', key: 'ia-agente-plantilla', caption: 'Un agente desde la plantilla «Clasificador de tickets».', fallback: 'ia-agente' },
            { t: 'h', text: 'Las plantillas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Clasificador de tickets', what: 'Clasifica cada ticket nuevo por tema y urgencia, le pone prioridad y explica por qué en una nota interna.' },
                    { name: 'Resumen al cerrar', what: 'Cuando un registro se cierra, deja una nota interna con el resumen de lo que pasó.' },
                    { name: 'Completar datos faltantes', what: 'Lee la descripción y completa los campos vacíos con los datos que aparecen ahí.' },
                    { name: 'Sugerir una respuesta', what: 'Redacta un borrador de respuesta al cliente y lo deja como nota interna para revisarlo.' },
                    { name: 'Asignar por tema', what: 'Según el tema del registro, lo asigna a la persona o al equipo que corresponde.' },
                ],
            },
            { t: 'h', text: 'Sus herramientas' },
            {
                t: 'settings',
                title: 'Lo que le permites hacer',
                rows: [
                    { name: 'Leer el registro', what: 'El registro completo, sus vinculados, sus comentarios y su historial.' },
                    { name: 'Buscar registros', what: 'En las listas donde trabaja, con lo que su dueño puede ver.' },
                    { name: 'Cambiar campos', what: 'Con los mismos validadores que una persona: un valor que el campo no acepta no se guarda.' },
                    { name: 'Crear registros', what: 'En las listas donde trabaja (hasta 5 por paso).' },
                    { name: 'Comentar', what: 'Una nota interna, o visible para el cliente si encendiste **Puede escribir comentarios visibles para el cliente (en su portal)**.' },
                    { name: 'Asignar', what: 'A una persona o a un equipo.' },
                    { name: 'Pedir una aprobación', what: 'Con uno de los flujos de la lista.' },
                    { name: 'Mandar un correo', what: 'Al contacto del registro o a alguien del equipo.', tip: 'Viene apagada: sale de la app. Enciéndela sólo si hace falta y empieza en modo propuesta.' },
                ],
            },
            { t: 'h', text: 'Cómo aplica los cambios' },
            {
                t: 'cards',
                items: [
                    { icon: 'UserCheck', title: 'Propone y una persona aprueba', md: 'Deja los cambios como propuesta en el registro; una persona los aplica o los descarta. Recomendado para empezar: ves qué decide antes de confiarle más.', tone: 'mint' },
                    { icon: 'Zap', title: 'Hace los cambios', md: 'Cambia los registros solo, por los mismos caminos que una persona. Queda todo en la actividad con el nombre del agente.', tone: 'amber' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Nunca puede más que quien lo guarda',
                md: 'El agente trabaja con el acceso de la persona que lo guardó: su rol, sus equipos, sus permisos por lista y sus campos ocultos. Si esa persona deja la empresa o pierde el acceso, el agente se pone **En pausa** y te llega un aviso en **Problemas**.',
            },
            { t: 'h', text: 'Los topes' },
            {
                t: 'settings',
                rows: [
                    { name: 'Pasos por corrida', what: 'Cuántas veces puede usar herramientas en una corrida (8 por defecto).' },
                    { name: 'Corridas por día', what: 'Cuántas veces puede trabajar por día (200 por defecto).' },
                    { name: 'Tokens por mes', what: 'Cuánto texto puede procesar en el mes (2.000.000 por defecto).', tip: 'Si llega a un tope, la corrida no sigue y te avisa una vez.' },
                ],
            },
            {
                t: 'example',
                title: 'Una mesa de ayuda que se ordena sola',
                md: 'Agente «Clasificador» en **Tickets**, con **Leer el registro**, **Cambiar campos** y **Comentar**. Instrucciones: «Lee el asunto y la descripción. Pon Prioridad Alta si algo está caído o hay un cobro mal hecho, Media si afecta a una persona, Baja si es una consulta. Explica el motivo en una nota interna». Trabaja con cada ticket nuevo, en modo propuesta durante la primera semana.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿En qué se diferencia de una automatización?', a: 'Una automatización sigue reglas fijas («si el monto es mayor a X, haz Y»). Un agente decide con criterio a partir de lo que lee. Lo habitual es combinarlos: la automatización decide **cuándo** y el agente **qué**.' },
                    { q: '¿Puede equivocarse?', a: 'Sí. Por eso conviene empezar en **Propone y una persona aprueba**, revisar su historial y ajustar las instrucciones con ejemplos de lo que tiene que hacer y de lo que no.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Agentes', to: '/agents' },
                    { label: 'Ponerlo a trabajar', article: 'ia-agentes-trabajo' },
                ],
            },
        ],
    },

    // ───────────────────── 4. Agentes: cuándo trabajan ─────────────────────
    {
        id: 'ia-agentes-trabajo',
        route: '/agents',
        related: ['ia-agentes', 'automatizaciones-acciones', 'mi-dia-mi-trabajo'],
        blocks: [
            {
                t: 'p',
                md: 'Un agente no hace nada hasta que alguien le pide trabajo. Ese «alguien» es una automatización con la acción **Pedirle a un agente**: así puede trabajar cuando se crea un registro, cuando cambia un estado, cada lunes a las 8, cuando llega un correo o un WhatsApp… cualquier disparador de las automatizaciones.',
            },
            { t: 'h', text: 'Decirle cuándo trabaja' },
            {
                t: 'steps',
                items: [
                    'Abre el agente y entra a la pestaña **Cuándo trabaja**.',
                    'Toca **Agregar cuándo trabaja**, elige la lista y el momento (cuando se crea un registro, cuando cambia un campo…).',
                    'Si quieres, limita con **Sólo si cambia alguno de estos campos (opcional)** y suma una **Instrucción extra**.',
                    'Guarda. Se crea una automatización en la lista que le pide trabajo al agente; la puedes abrir con **Abrir la automatización**.',
                ],
            },
            {
                t: 'p',
                md: 'También puedes hacerlo desde cualquier automatización: agrega la acción **Pedirle a un agente**, elige el agente y escribe una **Instrucción extra (opcional)**, por ejemplo «Fíjate sobre todo en el campo {{asunto}}». Las variables del registro le llegan como datos, no como órdenes.',
            },
            { t: 'anim', key: 'ia-agente-cuando', caption: 'La oportunidad pasa a Ganada, la automatización le pide trabajo al agente y su resumen aparece en la actividad.' },
            { t: 'h', text: 'Probar antes de soltarlo' },
            {
                t: 'p',
                md: 'En la pestaña **Probar** eliges un registro real y ves, paso a paso, qué haría: qué leyó, qué decidió y qué cambiaría. La prueba lee el registro de verdad pero **no escribe nada ni deja propuestas**. Cuenta como uso de IA.',
            },
            { t: 'h', text: 'Revisar sus propuestas' },
            {
                t: 'p',
                md: 'En modo **Propone y una persona aprueba**, cada cambio queda como **Propuesta de un agente de IA** en la ficha del registro, con lo que cambiaría. **Aplicar** lo hace con tus permisos; **Descartar** lo deja como está. Las propuestas también están en **Mi trabajo** → pestaña **Agentes** y te llega un aviso en la campana.',
            },
            { t: 'anim', key: 'ia-agente', caption: 'Lo propuesto se revisa en la ficha y se aplica con un toque.' },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Si alguien cambió un campo después de la propuesta, al aplicar no se pisa: se aplica lo demás y ves **Se aplicó una parte**.',
            },
            { t: 'h', text: 'Historial, versiones y pausa' },
            {
                t: 'settings',
                rows: [
                    { name: 'Historial', what: 'Cada corrida con el registro, qué leyó, qué hizo, cuántos tokens usó y, si falló, el motivo.' },
                    { name: 'Versiones', what: 'Las últimas 30 configuraciones guardadas. **Restaurar** vuelve a una (instrucciones, listas, herramientas, modo y topes).' },
                    { name: 'Pausar / Reanudar', what: 'Un agente **En pausa** no trabaja; las automatizaciones que le piden trabajo siguen activas pero el pedido no corre.' },
                    { name: 'Actividad del registro', what: 'Lo que hace se ve como «El agente «Clasificador» cambió…», o «Ana (propuesta del agente «Clasificador»)» cuando una persona aplicó su propuesta.' },
                    { name: 'Problemas', what: 'Si no puede trabajar (sin IA, cuota agotada, su dueño perdió el acceso), te llega un aviso en **Ajustes** → **Problemas**.' },
                ],
            },
            {
                t: 'example',
                title: 'Resumen al cerrar una venta',
                md: 'En **Oportunidades**, el agente «Resumen al cerrar» con **Leer el registro** y **Comentar**, en modo **Hace los cambios**. En **Cuándo trabaja**: cuando cambia el campo Etapa. Instrucción extra: «Sólo si la etapa es Ganada o Perdida». Cada venta cerrada queda con una nota que dice qué se vendió, por qué se ganó o se perdió y qué aprendimos.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo correr un agente sobre los registros que ya tengo?', a: 'Hoy trabaja con lo que pasa de aquí en adelante. Para los registros existentes, usa **Probar** uno por uno o una automatización programada que le pida trabajo.' },
                    { q: 'El historial dice «El agente está en pausa: no se le pidió nada».', a: 'La automatización corrió, pero el agente estaba pausado. Reanúdalo desde su página; los pedidos que se saltaron no se repiten solos.' },
                    { q: '¿Qué pasa con sus propuestas si lo borro?', a: 'Las pendientes se descartan y las automatizaciones que sólo le pedían trabajo a él van a la papelera. El historial de los registros se conserva.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver propuestas en Mi trabajo', to: '/my-work?tab=agents' },
                    { label: 'Todas las acciones de una automatización', article: 'automatizaciones-acciones' },
                ],
            },
        ],
    },

    // ───────────────────────────── 5. MCP ─────────────────────────────
    {
        id: 'ia-mcp',
        route: '/settings?s=seguridad',
        related: ['ia-asistente', 'ia-clave-privacidad', 'integraciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'Si ya usas **Claude** (en la web, en la app de escritorio o en el celular), **Cursor** u otro asistente compatible, puedes conectarlo a tus listas. Así le preguntas desde ahí «¿qué facturas vencen esta semana?» o le pides «crea una lista de proveedores», y él trabaja con tus datos con las mismas reglas que el asistente de la app: lee lo que tú puedes ver y los cambios los propone para que tú los confirmes.',
            },
            { t: 'anim', key: 'ia-mcp', caption: 'Claude pregunta, la app responde con tus datos; desde Seguridad ves las conexiones y las revocas.' },
            { t: 'h', text: 'Conectar Claude (sin token)' },
            {
                t: 'steps',
                items: [
                    'En la app, abre **Ajustes** → **Seguridad** y busca **Conexión MCP (Claude, Cursor y otros)**.',
                    'En **Conectar desde claude.ai…**, toca **Copiar URL**.',
                    'En Claude, ve a **Ajustes** → **Conectores** → **Agregar conector personalizado** y pega la dirección.',
                    'Claude te trae a la app: elige la empresa y el alcance, y toca **Autorizar**.',
                    'Listo: la conexión aparece en la lista como **Conexión autorizada** y se renueva sola.',
                ],
            },
            { t: 'demo', key: 'ia-mcp-token', caption: 'Dónde está la conexión y cómo se crea un token.', fallback: 'ia-mcp' },
            { t: 'h', text: 'Otros asistentes: un token' },
            {
                t: 'p',
                md: 'Para Cursor y otros clientes que piden una clave, toca **Nuevo token**, ponle un **Nombre (para reconocerlo)**, elige el alcance y cuándo vence, y toca **Crear token**. El token se muestra **una sola vez**, junto con el texto listo para pegar en la configuración del cliente. Guárdalo como una contraseña.',
            },
            {
                t: 'settings',
                title: 'Alcance y vencimiento',
                rows: [
                    { name: 'Sólo lectura (consultar listas y registros)', what: 'Puede ver tus listas, consultar registros y calcular totales. No propone cambios.', tip: 'Ideal para preguntar y hacer informes.' },
                    { name: 'Lectura y cambios (propone; tú confirmas)', what: 'Además puede proponer listas, campos, automatizaciones o cambios en registros. El cliente te muestra la propuesta y la aplica cuando le dices que sí.' },
                    { name: 'Vence en', what: '7, 30, 90 o 365 días, o nunca.', tip: 'Ponle vencimiento a lo que uses para una prueba o un proyecto.' },
                    { name: 'Revocar', what: 'Corta el acceso al instante, sea una conexión autorizada o un token.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Tu acceso, no más',
                md: 'La conexión trabaja con tu rol **en vivo**: si te cambian el rol o te sacan de la empresa, la conexión deja de poder lo que ya no puedes. Las personas invitadas y los clientes del portal no pueden crear conexiones.',
            },
            {
                t: 'example',
                title: 'El informe del viernes desde Claude',
                md: 'La gerente conecta Claude con **Sólo lectura** y cada viernes le pide: «Resume las ventas de la semana por vendedor, compara con la semana pasada y dime qué oportunidades llevan más de 15 días sin moverse». Claude consulta las listas y arma el informe sin que nadie exporte nada.',
            },
            { t: 'h', text: 'Qué puede hacer desde afuera' },
            {
                t: 'settings',
                rows: [
                    { name: 'Leer', what: 'Tus listas y cómo están armadas, consultar registros con filtros, calcular totales y agrupar, ver tableros, miembros, comentarios de un registro y el historial de las automatizaciones.' },
                    { name: 'Proponer', what: 'Con **Lectura y cambios**: las mismas propuestas que el asistente de la app (listas, campos, vistas, tableros, automatizaciones, registros, ediciones en lote). Se aplican sólo cuando le dices que sí.' },
                    { name: 'Lo que no hace', what: 'Decidir aprobaciones, ver contraseñas o claves de conexiones, ni nada que tu rol no permita.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Usar Claude así consume la cuota de IA de la empresa?', a: 'No: el modelo lo paga tu suscripción de Claude. La app sólo responde las consultas.' },
                    { q: 'Perdí el token. ¿Lo puedo volver a ver?', a: 'No, no se guarda completo. Revoca ese y crea uno nuevo.' },
                    { q: 'Claude dice que no puede conectarse.', a: 'Revisa que pegaste la dirección completa y que en la pantalla **Autorizar** elegiste la empresa correcta. Si el problema sigue, avísale a quien administra el servidor: la conexión desde Claude necesita que el servidor esté actualizado.' },
                    { q: '¿Puedo usar el mismo token en dos computadores?', a: 'Sí, pero es mejor uno por dispositivo: así, si pierdes uno, revocas sólo ese.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Seguridad', to: '/settings?s=seguridad' },
                    { label: 'El asistente dentro de la app', article: 'ia-asistente' },
                ],
            },
        ],
    },

    // ───────────────────────── 6. Clave y privacidad ─────────────────────────
    {
        id: 'ia-clave-privacidad',
        route: '/settings?s=asistente',
        related: ['ia-asistente', 'ia-campos', 'ajustes-empresa-plan'],
        blocks: [
            {
                t: 'p',
                md: 'La IA se enciende por empresa, y la decisión es de quien la administra: porque usa un proveedor externo y porque tiene un costo. Todo se hace en **Ajustes** → **Asistente IA**: activarla, elegir el modelo, cuánto piensa antes de responder y, si quieres, usar una clave propia.',
            },
            { t: 'demo', key: 'ia-ajustes', caption: 'Dónde se activa la IA de la empresa.', fallback: 'ia-clave' },
            { t: 'h', text: 'Clave de la plataforma o clave propia' },
            { t: 'anim', key: 'ia-clave', caption: 'Con la clave de la plataforma hay cuota mensual; con la propia, sin límite.' },
            {
                t: 'cards',
                items: [
                    { icon: 'Gauge', title: 'La clave de la plataforma', md: 'No tienes que hacer nada. Cada mensaje al asistente, cada cálculo de un campo con IA y cada corrida de un agente cuenta como un pedido de la **cuota mensual de tu plan**.', tone: 'blue' },
                    { icon: 'Key', title: 'Tu clave propia', md: 'Una clave de Anthropic de tu empresa. Se guarda cifrada y nunca se vuelve a mostrar completa. **Tus pedidos no consumen la cuota del plan**: el consumo lo pagas directamente al proveedor.', tone: 'violet' },
                ],
            },
            {
                t: 'settings',
                title: 'Los ajustes de «Asistente IA»',
                rows: [
                    { name: 'Activar el asistente para esta empresa', what: 'Enciende el asistente, los campos con IA y los agentes. Apagado, nada se envía al proveedor.' },
                    { name: 'Modelo', what: 'Con «el más reciente», el asistente pasa solo a cada modelo nuevo que se publique. También puedes fijar una versión.' },
                    { name: 'Nivel de esfuerzo', what: 'Cuánto piensa antes de responder: **Bajo**, **Medio**, **Alto**, **Muy alto** o **Máximo**. Más esfuerzo da respuestas más cuidadas, pero más lentas.', tip: 'Con la clave de la plataforma lo fija la plataforma; para elegirlo, carga una clave propia.' },
                    { name: 'Cargar una clave propia (opcional)', what: 'Pega la clave y guarda. Con **Quitar clave propia** vuelves a la de la plataforma.' },
                    { name: 'Pedidos este mes', what: 'Cuánto se usó de la cuota. También se ve en **Ajustes** → **Plan y uso**.' },
                ],
            },
            { t: 'h', text: 'Qué datos se envían' },
            {
                t: 'settings',
                title: 'Lo que viaja al proveedor de IA',
                rows: [
                    { name: 'Asistente', what: 'La estructura de tus listas (nombres de campos, tipos, opciones), lo que escribe cada persona en el chat y, cuando le preguntas por tus datos, los registros que consulta (hasta 50 filas por consulta).' },
                    { name: 'Campos con IA', what: 'Sólo los campos que el campo lee, de un registro a la vez (y los PDF o imágenes de esos campos).' },
                    { name: 'Agentes', what: 'El registro sobre el que trabajan, con sus vinculados y comentarios, y lo que busquen en las listas donde trabajan.' },
                    { name: 'Lo que nunca viaja', what: 'Contraseñas, claves y secretos de tus conexiones, ni registros de listas que la persona no puede ver.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Datos sensibles',
                md: 'Los pedidos van por la API del proveedor de IA y se rigen por sus condiciones de uso de datos. Si tu empresa maneja información sensible (salud, menores, datos financieros), revisa esas condiciones con tu equipo legal y la autorización de tratamiento de datos que pides a tus clientes (**Ajustes** → **Datos personales**). Y elige con cuidado qué campos lee cada campo con IA o cada agente.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Se acabó la cuota del mes. ¿Qué pasa?', a: 'El asistente, los campos con IA y los agentes dejan de responder hasta el mes siguiente, y cada lugar dice el motivo. Puedes cambiar de plan o cargar una clave propia para seguir al instante.' },
                    { q: 'Dice «Clave propia ilegible».', a: 'La clave guardada no se puede leer con la configuración actual del servidor. Escríbela de nuevo y guarda.' },
                    { q: '¿La clave propia sirve también para los campos con IA y los agentes?', a: 'Sí: con clave propia, todo lo que hace la IA en la empresa va por esa clave y nada cuenta para la cuota del plan.' },
                    { q: 'Activé el asistente pero no funciona.', a: 'Puede que la plataforma lo tenga apagado o no comparta su clave; el panel lo dice arriba. En ese caso, carga una clave propia.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Asistente IA', to: '/settings?s=asistente' },
                    { label: 'Ver mi plan y uso', to: '/settings?s=plan' },
                ],
            },
        ],
    },
];
