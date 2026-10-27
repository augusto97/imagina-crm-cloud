import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tableros-crear',
        route: '/dashboards',
        related: ['tableros-tipos-de-widget', 'tableros-configurar-widget', 'tableros-compartir'],
        blocks: [
            {
                t: 'p',
                md: 'Un **tablero** (en la app también se llama *dashboard*) es una página con indicadores y gráficos que se calculan solos a partir de tus listas. No copias números a una hoja de cálculo ni armas el informe a mano: cada vez que alguien abre el tablero, los números salen de los registros de ese momento. Si hoy se ganó una venta, el tablero ya la cuenta.',
            },
            {
                t: 'p',
                md: 'Sirve para responder de un vistazo las preguntas que te haces todos los días: *¿cuánto vendimos este mes?*, *¿cuántos tickets siguen abiertos?*, *¿quién tiene más trabajo?*, *¿qué facturas vencen esta semana?*',
            },
            { t: 'anim', key: 'tab-hero', caption: 'Un tablero de ventas: al cambiar el período, todos los widgets se recalculan a la vez.' },
            { t: 'h', text: 'Dónde están los tableros' },
            {
                t: 'p',
                md: 'En el menú de la izquierda toca **Tableros**. El panel muestra **Todos los dashboards** y debajo **Tus dashboards**, la lista de los que puedes ver. La página principal muestra cada tablero como una tarjeta con su nombre, cuántos widgets tiene y cuándo se editó. Si un tablero no es para todo el equipo, la tarjeta lo dice con una etiqueta: **Sólo yo** o **Roles**.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Vienen tableros armados',
                md: 'Si creaste tus listas con una plantilla (ventas, facturación, inventario, soporte…), es probable que ya tengas un tablero listo, por ejemplo **Ventas** o **Cartera**. Ábrelo y úsalo como punto de partida: puedes cambiarle todo.',
            },
            { t: 'h', text: 'Dos formas de empezar' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'LayoutTemplate',
                        title: 'Desde una plantilla',
                        md: 'Eliges un tablero ya diseñado (embudo de ventas, cartera, carga de trabajo…), la lista sobre la que se arma y qué campo cumple cada papel. Nace con todos sus widgets.',
                        tone: 'blue',
                    },
                    {
                        icon: 'LayoutDashboard',
                        title: 'En blanco',
                        md: 'Le pones nombre y descripción, y agregas los widgets uno por uno con **Añadir widget**. Ideal cuando ya sabes exactamente qué quieres ver.',
                        tone: 'slate',
                    },
                ],
            },
            { t: 'h', text: 'Crear un tablero desde una plantilla' },
            { t: 'anim', key: 'tab-crear', caption: 'Eliges la plantilla, la lista, y la app sugiere qué campo es la etapa, el monto y la fecha.' },
            {
                t: 'steps',
                items: [
                    'En **Tableros**, toca **Nuevo dashboard**. Se abre en la pestaña **Plantilla**.',
                    'Busca o filtra por categoría y elige una plantilla. A la derecha ves qué widgets trae.',
                    'En **Sobre qué lista**, elige la lista con tus datos (por ejemplo, **Oportunidades**).',
                    'La app sugiere qué campo de tu lista cumple cada papel: la **Etapa**, el **Monto**, la **Fecha de cierre**, el **Responsable**. Revisa cada selector y corrige lo que no corresponda. Sólo aparecen los campos del tipo correcto.',
                    'Ponle un **Nombre del dashboard**, elige la **Visibilidad** y toca **Crear dashboard**.',
                ],
            },
            { t: 'demo', key: 'tab-plantilla', caption: 'Crear el tablero «Embudo de ventas» sobre la lista de oportunidades.', fallback: 'tab-crear' },
            {
                t: 'settings',
                title: 'Las plantillas que trae la app',
                rows: [
                    { name: 'Resumen por estado', what: 'Total de registros, cómo se reparten por estado y por responsable, altas por mes y los últimos registros.', tip: 'Sirve para casi cualquier lista que tenga un campo de estado.' },
                    { name: 'Embudo de ventas', what: 'Oportunidades, monto en el pipeline, ticket promedio, embudo por etapa, monto por vendedor, cierres por mes y próximos cierres.', tip: 'Para una lista de oportunidades o negocios.' },
                    { name: 'Cartera y cobros', what: 'Documentos, monto total, reparto por estado de pago, vencimientos por mes y próximos vencimientos.', tip: 'Para facturas, cuotas o cuentas por cobrar.' },
                    { name: 'Carga de trabajo', what: 'Pendientes, personas con trabajo, lo que no tiene responsable, reparto por persona, estado y prioridad, y lo que vence pronto.', tip: 'Para tareas, tickets o pedidos.' },
                    { name: 'Actividad en el tiempo', what: 'Cuántos registros entran por semana y por mes, comparado con el período anterior.', tip: 'Para ver si una lista crece: clientes nuevos, solicitudes, pedidos.' },
                    { name: 'Satisfacción', what: 'Promedio de calificación contra una meta, cuántos dieron cada nota y el promedio por categoría.', tip: 'Para encuestas o tickets con calificación.' },
                    { name: 'Inventario', what: 'Productos, unidades en stock, precio promedio, productos sin stock y los que tienen menos.', tip: 'Para una lista de productos con un campo numérico de stock.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Plantillas propias',
                md: 'Si armaste un tablero que te gusta, guárdalo como plantilla con **⋯ → Guardar como plantilla**. Aparece en la galería de **Nuevo dashboard** (en **Mis plantillas**) para usarlo sobre otra lista: la app te pide qué campo corresponde a cada uno.',
            },
            { t: 'h', text: 'Crear un tablero en blanco' },
            {
                t: 'steps',
                items: [
                    'Toca **Nuevo dashboard** y cambia a la pestaña **En blanco**.',
                    'Escribe el **Nombre** (por ejemplo «Pipeline comercial») y, si quieres, una **Descripción (opcional)** que aparece debajo del título.',
                    'Elige la **Visibilidad** y toca **Crear**.',
                    'En el tablero vacío toca **Añadir widget** para agregar el primer indicador.',
                ],
            },
            {
                t: 'example',
                title: 'Una clínica odontológica',
                md: 'La recepcionista usa la plantilla **Carga de trabajo** sobre la lista **Citas**: el papel *Responsable* queda en el campo «Odontólogo», el *Estado* en «Estado de la cita» y la *Fecha límite* en «Fecha». En un minuto tiene cuántas citas tiene cada odontólogo, cuántas están sin asignar y cuáles son las de hoy. La dueña arma aparte un tablero **Cartera y cobros** sobre **Pagos** para ver cada lunes cuánto falta por cobrar.',
            },
            { t: 'h', text: 'Quién puede crear y editar tableros' },
            {
                t: 'p',
                md: 'Crear, editar, publicar y programar envíos lo hace quien tiene permiso para **crear y editar tableros**: por defecto, los administradores y los gerentes. Los agentes y lectores ven los tableros que se comparten con su rol, pero no los cambian.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Cada persona ve sus propios números',
                md: 'Un tablero respeta los permisos de cada lista. Si un agente sólo puede ver los registros que creó, el mismo tablero le muestra **sus** totales, no los de toda la empresa. Y los campos que tiene ocultos no se suman ni se agrupan para él.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Un tablero puede mezclar varias listas?', a: 'Sí. Cada widget elige su propia lista: en el mismo tablero puedes tener las ventas de Oportunidades, los cobros de Facturas y los tickets abiertos de Soporte.' },
                    { q: '¿Se actualiza solo?', a: 'Sí. Los números se calculan al abrir el tablero y se refrescan cuando alguien cambia un registro. En el modo presentación además se recarga cada minuto.' },
                    { q: '¿Cuántos tableros puedo tener?', a: 'Los que necesites. Lo que sí conviene es que cada uno responda a un tema (ventas, cobranza, operación) para que se lea de un vistazo.' },
                    { q: '¿Cómo lo borro?', a: 'En el tablero toca **⋯ → Eliminar dashboard**. Va a la papelera con sus widgets y se puede recuperar durante 30 días; mientras tanto su enlace público deja de funcionar y sus envíos programados no salen.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Tableros', to: '/dashboards' },
                    { label: 'Ver el recorrido de tableros', tour: 'dashboards' },
                    { label: 'Los tipos de widget', article: 'tableros-tipos-de-widget' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tableros-tipos-de-widget',
        route: '/dashboards',
        related: ['tableros-configurar-widget', 'tableros-apiladas-y-dinamica', 'tableros-diseno'],
        blocks: [
            {
                t: 'p',
                md: 'Un **widget** es cada caja del tablero: un número, un gráfico o una tabla. Elegir bien el tipo es lo que hace que el tablero se entienda en dos segundos. La regla es simple: **primero piensa en la pregunta**, después elige el widget que la responde.',
            },
            { t: 'anim', key: 'tab-tipos', caption: 'Cada tipo de widget responde una pregunta distinta.' },
            { t: 'h', text: 'Indicadores: un número grande' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Hash',
                        title: 'KPI · Número',
                        md: 'Un solo número: cuántos registros hay, cuánto suman, el promedio, el más alto. Puede llevar **icono**, **prefijo** ($) o **sufijo** (%), una **meta** con barra de avance y una **mini-tendencia** de los últimos 30 días.',
                        tone: 'blue',
                    },
                    {
                        icon: 'TrendingUp',
                        title: 'KPI · Delta vs período',
                        md: 'El número de los últimos 7, 14, 30, 90 o 180 días comparado con el período anterior de la misma duración, con la flecha de cuánto subió o bajó.',
                        tone: 'mint',
                    },
                    {
                        icon: 'Gauge',
                        title: 'Medidor · Progreso vs meta',
                        md: 'Un arco que se llena hasta la meta. Se pinta en rojo bajo el 50 %, en ámbar hasta llegar y en verde al cumplirla.',
                        tone: 'amber',
                    },
                ],
            },
            { t: 'h', text: 'Gráficos: comparar y repartir' },
            {
                t: 'cards',
                items: [
                    { icon: 'BarChart3', title: 'Gráfico de barras', md: 'Compara grupos: monto por vendedor, tickets por categoría. Puede ir en **barras horizontales** o **columnas**, y partirse en series (barras apiladas).', tone: 'violet' },
                    { icon: 'PieChart', title: 'Gráfico de torta', md: 'Se dibuja como una dona con el total en el centro. Muestra cómo se reparte el todo: clientes por origen, facturas por estado.', tone: 'cyan' },
                    { icon: 'Filter', title: 'Embudo (etapas de pipeline)', md: 'Las etapas de un proceso de mayor a menor, con el porcentaje de cada una frente a la primera. Para ver dónde se caen las ventas.', tone: 'rose' },
                    { icon: 'TrendingUp', title: 'Línea y Área', md: 'Cómo evoluciona algo en el tiempo: ventas por mes, tickets por semana. Agrupa por una fecha en día, semana, mes, trimestre o año.', tone: 'blue' },
                ],
            },
            { t: 'h', text: 'Tablas: ver los registros' },
            {
                t: 'cards',
                items: [
                    { icon: 'Table', title: 'Tabla · Top N', md: 'Los primeros 5, 10, 20 o 50 registros según un orden: los próximos vencimientos, los clientes que más compran, los productos con menos stock.', tone: 'slate' },
                    { icon: 'Columns3', title: 'Tabla dinámica · Filas × columnas', md: 'Cruza dos campos: filas por ciudad y columnas por mes, con totales y mapa de calor. Es la tabla dinámica de una hoja de cálculo, pero siempre al día.', tone: 'mint' },
                ],
            },
            { t: 'h', text: 'Bloques de contenido' },
            {
                t: 'p',
                md: 'Además de datos, un tablero puede llevar contenido para que se lea como un informe. No usan ninguna lista:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Contenido · Título de sección', what: 'Un título grande con un **Subtítulo (opcional)**. Divide el tablero en partes: «Ventas», «Cobranza», «Equipo».', tip: 'Ocupa un renglón entero para que separe bien.' },
                    { name: 'Contenido · Texto', what: 'Notas, contexto, instrucciones o la meta del mes escrita.', tip: '«Meta de octubre: $ 60 M. Prioridad: cerrar las propuestas de más de 30 días».' },
                    { name: 'Contenido · Imagen', what: 'Tu logo, una foto o un banner. Se sube o se pega su dirección, con texto alternativo, alto, forma de ajustarse y un enlace al hacer clic.', tip: 'El logo arriba a la izquierda hace que el tablero se vea propio en el modo presentación.' },
                    { name: 'Contenido · Separador', what: 'Una línea para separar secciones.' },
                    { name: 'Contenido · Espaciador', what: 'Aire entre widgets.' },
                ],
            },
            { t: 'h', text: 'Qué widget elegir según la pregunta' },
            {
                t: 'settings',
                title: 'Pregunta → widget',
                rows: [
                    { name: '¿Cuánto llevamos este mes?', what: 'KPI · Número con la suma del monto y el período «Este mes».', tip: 'Agrégale una meta para ver la barra de avance.' },
                    { name: '¿Vamos mejor o peor que antes?', what: 'KPI · Delta vs período, con 30 días.' },
                    { name: '¿Llegamos a la meta?', what: 'Medidor · Progreso vs meta.' },
                    { name: '¿Quién vende más? ¿Qué categoría pesa más?', what: 'Gráfico de barras agrupado por la persona o la categoría.', tip: 'Con muchas categorías, muestra «Las 10 mayores».' },
                    { name: '¿Cómo se reparte?', what: 'Gráfico de torta (hasta 6-8 porciones se lee bien).' },
                    { name: '¿En qué etapa se pierden los clientes?', what: 'Embudo agrupado por la etapa.' },
                    { name: '¿Cómo viene la tendencia?', what: 'Línea o Área con granularidad Mes o Semana.' },
                    { name: '¿Qué tengo que atender ya?', what: 'Tabla · Top N ordenada por fecha de vencimiento ascendente.' },
                    { name: '¿Qué ciudad vendió más en cada mes?', what: 'Tabla dinámica con filas por ciudad y columnas por mes.' },
                ],
            },
            {
                t: 'example',
                title: 'Una ferretería con tres sucursales',
                md: 'Arriba, tres KPI: **Ventas del mes** (con meta de $ 45 M), **Ticket promedio** y **Facturas vencidas** (con icono de alerta). En el medio, un **Gráfico de barras** de ventas por sucursal desglosado por vendedor y una **Línea** de ventas por semana. Abajo, una **Tabla · Top 10** de productos con menos stock. Con un **Título de sección** entre cada bloque, el dueño lo entiende desde el celular.',
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Menos es más: un tablero con 6 a 10 widgets bien elegidos se lee mejor que uno con 25. Si tienes muchos temas, arma varios tableros.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo cambiar el tipo de un widget después?', a: 'Sí. Abre el widget con el lápiz (**Editar widget**) y cambia el **Tipo**; después revisa las opciones que pide el tipo nuevo (por ejemplo, el campo de fecha de una línea) mirando la vista previa.' },
                    { q: '¿Por qué la torta se ve como un anillo?', a: 'La app la dibuja como dona para poner el total en el centro. Puedes cambiar ese texto con **Etiqueta del centro**.' },
                    { q: '¿La tabla muestra todos los campos?', a: 'Eliges las **Columnas visibles**. Si no eliges ninguna, muestra el campo del título y los 7 siguientes.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Configurar un widget', article: 'tableros-configurar-widget' },
                    { label: 'Barras apiladas y tablas dinámicas', article: 'tableros-apiladas-y-dinamica' },
                    { label: 'Ir a Tableros', to: '/dashboards' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tableros-configurar-widget',
        route: '/dashboards',
        related: ['tableros-tipos-de-widget', 'tableros-apiladas-y-dinamica', 'tableros-explorar'],
        blocks: [
            {
                t: 'p',
                md: 'Todo widget de datos se arma con las mismas piezas: **de qué lista** saca los registros, **qué calcula** (contar, sumar, promediar…), **cómo agrupa** y **qué registros cuenta** (período y filtros). Mientras configuras, la **Vista previa** del mismo cuadro se recalcula con tus datos reales, así ves el resultado antes de guardar.',
            },
            { t: 'anim', key: 'tab-configurar', caption: 'Al elegir el campo «Monto», el cálculo pasa a «Suma» y la vista previa se recalcula al instante.' },
            { t: 'h', text: 'Agregar un widget' },
            {
                t: 'steps',
                items: [
                    'Abre el tablero y toca **Añadir widget** (arriba a la derecha).',
                    'Escribe el **Título** (por ejemplo «Monto por etapa») y elige el **Tipo**.',
                    'Elige la **Lista** de la que salen los datos.',
                    'Elige el **Campo a medir** (en los KPI se llama **Campo**): **(Todos los registros)** para contar, o un campo para sumarlo o promediarlo. Después el **Cálculo** y, en los gráficos, el **Agrupar por**.',
                    'Si quieres acotar, elige el **Período** y agrega filtros. Mira la **Vista previa**.',
                    'Toca **Añadir widget**. Aparece al final del tablero; después lo mueves donde quieras.',
                ],
            },
            { t: 'demo', key: 'tab-widget', caption: 'Agregar un gráfico de barras con el monto por etapa.', fallback: 'tab-configurar' },
            { t: 'h', text: 'Lo que tienen todos los widgets de datos' },
            {
                t: 'settings',
                rows: [
                    { name: 'Título', what: 'El nombre que se ve arriba del widget. Debajo, la app escribe sola qué se calcula y de qué lista («Suma · Oportunidades»).', tip: 'Escríbelo como respuesta: «Ventas de este mes», no «Gráfico 1».' },
                    { name: 'Tipo', what: 'KPI, delta, medidor, barras, torta, embudo, línea, área, tabla, tabla dinámica o un bloque de contenido.' },
                    { name: 'Lista', what: 'De dónde salen los registros. Cada widget puede usar una lista distinta.' },
                    { name: 'Campo a medir (o Campo)', what: 'Sobre qué se calcula. **(Todos los registros)** cuenta registros; un campo (el monto, la calificación, la fecha) permite sumarlo, promediarlo, etc.', tip: 'Al elegir un campo de número, el cálculo pasa solo a «Suma».' },
                    { name: 'Cálculo', what: 'Sin campo: **Contar registros**. Con un número: **Suma**, **Promedio**, **Mínimo**, **Máximo**, **Contar valores**, **Valores únicos** o **Vacíos**. Con una fecha: **Más antiguo** y **Más reciente**. Con una casilla: **Cantidad de sí** y **Cantidad de no**.', tip: '«Vacíos» sirve para encontrar huecos: clientes sin teléfono, tareas sin responsable.' },
                    { name: 'Período', what: 'Limita el widget a un rango de fechas sobre un campo de fecha: **Hoy**, **Esta semana**, **Este mes**, **Últimos 30 días**, **Este trimestre**, **Este año**, **De hoy en adelante**… o un rango fijo con **Desde** y **Hasta**.', tip: 'Es relativo: «Este mes» siempre es el mes actual, sin tocar nada el 1.º.' },
                    { name: 'Filtros', what: 'Condiciones como las de la tabla: «Estado es Ganado», «Ciudad es Bogotá». Puedes pedir que se cumplan todas o cualquiera, y agruparlas.' },
                    { name: 'Incluir subtareas', what: 'Sin marcar, el widget cuenta lo mismo que la tabla: sólo los registros de primer nivel. Marcado, suma también las subtareas.' },
                    { name: 'Diseño', what: 'El estilo de la tarjeta: fondo, color de texto, borde, relleno, esquinas, sombra, tamaño y peso de la letra, y estilos guardados de tu marca.', tip: 'Lo ves en detalle en «Acomodar y darle estilo al tablero».' },
                ],
            },
            { t: 'h', text: 'Opciones de los gráficos' },
            {
                t: 'settings',
                rows: [
                    { name: 'Agrupar por', what: 'El campo que forma cada barra, porción o etapa: selección, texto, email, enlace, fecha, casilla, persona o equipo.' },
                    { name: 'Granularidad temporal', what: 'Si agrupas por una fecha: **Día**, **Semana**, **Mes**, **Trimestre** o **Año**. Línea y área usan Mes si no eliges.', tip: 'Semana para el día a día, Mes para la tendencia del año.' },
                    { name: 'Orientación', what: 'En barras: **Barras horizontales** (mejor con nombres largos) o **Columnas (verticales)** (mejor con meses).' },
                    { name: 'Orden', what: '**Automático**, **Mayor valor primero**, **Menor valor primero**, **Alfabético** u **Orden de las opciones del campo**.', tip: 'Para un embudo, el orden de las opciones respeta el orden de las etapas.' },
                    { name: 'Categorías a mostrar', what: 'Hasta 50, o sólo **Las 5 / 10 / 20 mayores**. El resto se junta en una barra «Otros».' },
                    { name: 'Mostrar: Línea de promedio', what: 'Dibuja una línea punteada con el promedio en barras, líneas y áreas.' },
                    { name: 'Mostrar: Etiquetas de datos', what: 'Escribe el valor sobre cada punto o porción.' },
                    { name: 'Mostrar: Leyenda', what: 'Muestra u oculta la leyenda de colores de la torta.' },
                    { name: 'Ocultar grupos en cero', what: 'En barras, torta y embudo: no dibuja los grupos cuyo resultado da 0.', tip: 'Útil cuando filtras: así no quedan barras vacías.' },
                    { name: 'Etiqueta del centro', what: 'El texto debajo del total en la dona. Por defecto, «Total».' },
                ],
            },
            { t: 'h', text: 'Opciones del KPI y el medidor' },
            {
                t: 'settings',
                rows: [
                    { name: 'Icono', what: 'Un dibujo en la esquina: dinero, ventas, personas, meta, factura, reloj, alerta y más.' },
                    { name: 'Meta (opcional)', what: 'El número a alcanzar. El KPI muestra una barra con el porcentaje («68 % de la meta») en verde al cumplirla y en ámbar por debajo. El medidor la usa para llenar su arco.' },
                    { name: 'Prefijo y Sufijo', what: 'Texto antes o después del número: «$», «%», «h», «unid.».' },
                    { name: 'Mini-tendencia (campo de fecha)', what: 'Dibuja la misma métrica día a día durante los últimos 30 días, debajo del número.', tip: 'Ideal para «Ventas del mes»: ves si viene subiendo.' },
                    { name: 'Campo de fecha (define períodos)', what: 'En el KPI · Delta: la fecha con la que se cuentan los días.' },
                    { name: 'Período actual (días)', what: 'En el KPI · Delta: Últimos 7, 14, 30, 90 o 180 días, comparado con el mismo largo hacia atrás.' },
                ],
            },
            { t: 'h', text: 'Opciones de la tabla' },
            {
                t: 'settings',
                rows: [
                    { name: 'Ordenar por', what: '**Más reciente** o cualquier campo.' },
                    { name: 'Dirección', what: '**Descendente** (de mayor a menor) o **Ascendente**.', tip: 'Para «lo que vence pronto», ordena por la fecha en Ascendente y usa el período «De hoy en adelante».' },
                    { name: 'Cantidad', what: 'Top 5, 10, 20 o 50.' },
                    { name: 'Columnas visibles', what: 'Qué campos se ven. Sin elegir, el título y los 7 siguientes.' },
                ],
            },
            {
                t: 'example',
                title: 'Una agencia de marketing',
                md: 'Quiere saber cuánto factura cada cliente en el trimestre. Crea un **Gráfico de barras** sobre **Facturas**, con **Campo a medir: Total** y **Cálculo: Suma**, **Agrupar por: Cliente**, **Período: Este trimestre**, **Orden: Mayor valor primero** y **Las 10 mayores**. Agrega un filtro «Estado no es Anulada». Debajo, un **KPI** con la suma total y la **Meta** de $ 120 M.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Si un widget dice «No se pudo calcular»',
                md: 'Debajo aparece el motivo: por ejemplo, que se borró el campo que usaba o que el cálculo no aplica a ese tipo de campo. Sólo ese widget queda en aviso: el resto del tablero sigue funcionando. Ábrelo con **Editar widget** y corrige el campo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo sumar un campo calculado o un resumen de otra lista?', a: 'Sí, si da un número: los campos calculados de suma, resta, multiplicación y división, y los resúmenes (rollup) numéricos se pueden sumar, promediar y agrupar como cualquier número.' },
                    { q: '¿Por qué mi gráfico de línea muestra pocos puntos?', a: 'Revisa la **Granularidad temporal**: con «Mes» y datos de un solo mes verás un punto. Cambia a «Semana» o «Día».' },
                    { q: '¿Qué pasa si el período del widget y el del tablero no coinciden?', a: 'Si eliges un período arriba del tablero, ese manda sobre el de cada widget con fecha. Al volver a «Cada widget con su período», cada uno usa el suyo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Tableros', to: '/dashboards' },
                    { label: 'Barras apiladas y tablas dinámicas', article: 'tableros-apiladas-y-dinamica' },
                    { label: 'Mirar los datos del tablero', article: 'tableros-explorar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tableros-apiladas-y-dinamica',
        route: '/dashboards',
        related: ['tableros-configurar-widget', 'tableros-tipos-de-widget'],
        blocks: [
            {
                t: 'p',
                md: 'A veces una sola dimensión no alcanza. *¿Cuánto vendimos por mes?* se responde con barras; pero *¿cuánto vendió cada vendedor en cada mes?* necesita cruzar dos campos. Para eso hay dos herramientas: **desglosar** un gráfico en series y la **tabla dinámica**.',
            },
            { t: 'h', text: 'Barras apiladas: desglosar un gráfico' },
            { t: 'anim', key: 'tab-apiladas', caption: 'Las ventas de cada mes partidas por vendedor, primero en pesos y después «Al 100 %».' },
            {
                t: 'p',
                md: 'En un **Gráfico de barras**, una **Línea** o un **Área**, el campo **Desglosar por (opcional)** parte cada barra en series según otro campo, cada una con el color de su opción. Por ejemplo: agrupar por **Mes** (fecha de cierre) y desglosar por **Vendedor**.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Desglosar por (opcional)', what: 'El segundo campo. Con «— Sin desglose —» el gráfico es simple.', tip: 'Elige un campo con pocas opciones (3 a 8): estado, vendedor, sucursal.' },
                    { name: 'Series', what: '**Apiladas**: una encima de otra, el alto total es la suma. **Lado a lado** (en barras) o **Superpuestas** (en líneas): cada serie por separado.', tip: 'Apiladas para ver el total y cómo se compone; lado a lado para comparar series entre sí.' },
                    { name: 'Series a mostrar', what: 'Las 8 mayores (el resto en «Otros»), o 3, 5, 12 o 20.' },
                    { name: 'Al 100 % (cada barra muestra el reparto)', what: 'Todas las barras miden lo mismo y cada serie ocupa su porcentaje.', tip: 'Responde «¿qué parte del mes vendió cada uno?» aunque un mes haya vendido el doble que otro.' },
                    { name: 'Granularidad temporal', what: 'Si el desglose es una fecha, también eliges día, semana, mes, trimestre o año.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si el cálculo es **Promedio**, **Mínimo** o **Máximo**, las series van siempre lado a lado: apilar promedios no tiene sentido (no se suman).',
            },
            {
                t: 'p',
                md: 'La leyenda muestra cada serie con su color. Al hacer clic en una parte de una barra, se abre la lista filtrada por **los dos** valores: el mes y el vendedor.',
            },
            { t: 'h', text: 'La tabla dinámica' },
            { t: 'anim', key: 'tab-dinamica', caption: 'Ciudades en filas, meses en columnas, totales y un mapa de calor.' },
            {
                t: 'p',
                md: 'La **Tabla dinámica · Filas × columnas** pone un campo en las filas, otro en las columnas y el cálculo en cada cruce. Es la tabla dinámica que conoces de las hojas de cálculo, pero siempre al día y sin rearmarla.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Filas', what: 'El campo de cada fila (ciudad, vendedor, categoría).' },
                    { name: 'Filas a mostrar', what: 'Las 20 mayores (el resto en «Otros»), o 10, 50 o 100.' },
                    { name: 'Orden de las filas', what: 'Automático, mayor total primero, menor total primero, alfabético u orden de las opciones.' },
                    { name: 'Columnas', what: 'El campo de cada columna (mes, estado, canal). Si es una fecha, eliges la granularidad.' },
                    { name: 'Columnas a mostrar', what: 'Las 12 mayores (el resto en «Otros»), o 6, 24 o 50.' },
                    { name: 'Orden de las columnas', what: 'Igual que el de las filas.' },
                    { name: 'Totales por fila, por columna y general', what: 'Agrega la columna y la fila de totales.' },
                    { name: 'Mapa de calor (más intenso = mayor valor)', what: 'Pinta cada celda según su valor para que lo importante salte a la vista.' },
                ],
            },
            {
                t: 'example',
                title: 'Una distribuidora de alimentos',
                md: 'El gerente comercial arma una tabla dinámica sobre **Pedidos**: **Filas: Ciudad**, **Columnas: Fecha del pedido** por mes, **Cálculo: Suma** del **Total**, con totales y mapa de calor. En una mirada ve que Barranquilla cae en septiembre y que Medellín crece mes a mes. Al lado, un gráfico de barras por **Categoría** desglosado por **Canal** (tienda, mayorista, en línea) y al 100 % muestra que el canal en línea ya es un tercio de las ventas de bebidas.',
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Si la tabla dinámica queda muy grande, limita las filas a «Las 10 mayores» o agrega un período. Diez filas por doce columnas ya son 120 números: más que eso, nadie los lee.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo desglosar una dona?', a: 'No: la torta y el embudo muestran un solo campo. Para cruzar dos, usa barras apiladas o la tabla dinámica.' },
                    { q: '¿Qué es «Otros»?', a: 'La suma de todo lo que quedó fuera del límite que elegiste («Las 10 mayores»). Así el total sigue siendo correcto.' },
                    { q: '¿Puedo descargar la tabla dinámica?', a: 'Sí: el botón de descarga del widget baja los datos en CSV para abrirlos en una hoja de cálculo, o una imagen PNG.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Configurar un widget', article: 'tableros-configurar-widget' },
                    { label: 'Ir a Tableros', to: '/dashboards' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tableros-diseno',
        route: '/dashboards',
        related: ['tableros-tipos-de-widget', 'tableros-explorar', 'tableros-compartir'],
        blocks: [
            {
                t: 'p',
                md: 'Un buen tablero se lee de arriba hacia abajo: primero los números clave, después los gráficos que los explican y al final el detalle. Acomodar los widgets, darles tamaño y un poco de color es lo que lo convierte en algo que la gente abre todos los días.',
            },
            { t: 'anim', key: 'tab-layout', caption: 'Arrastra un widget por su cabecera, agranda otro desde la esquina, y en el celular quedan uno debajo del otro.' },
            { t: 'h', text: 'Mover y cambiar el tamaño' },
            {
                t: 'steps',
                items: [
                    'Para **mover** un widget, tómalo por su cabecera (donde está el título) y arrástralo. Los demás se corren solos para hacerle lugar.',
                    'Para **agrandarlo o achicarlo**, arrastra la esquina inferior derecha.',
                    'Al soltar, el orden se guarda solo para todos los que ven el tablero.',
                ],
            },
            {
                t: 'p',
                md: 'El tablero es una grilla de 12 columnas: un KPI suele ocupar 3 (cuatro por fila), un gráfico 6 (dos por fila) y una tabla las 12. Al pasar el mouse sobre un widget aparecen sus botones: **Descargar widget**, **Editar widget**, **Duplicar widget** (la copia aparece al final) y **Eliminar widget**.',
            },
            { t: 'h', text: 'En el celular' },
            {
                t: 'p',
                md: 'Cuando la pantalla es angosta (un teléfono), los widgets se apilan **uno debajo del otro** en el mismo orden en que se leen en el computador. Ahí puedes cambiar el **alto** de cada uno con el asa de abajo, sin desacomodar el diseño del computador. La dona se reacomoda sola: el aro arriba y la leyenda debajo.',
            },
            { t: 'h', text: 'El estilo de cada widget' },
            {
                t: 'p',
                md: 'En el formulario de cada widget, la sección **Diseño** cambia cómo se ve su tarjeta. Es la misma herramienta de estilo de la ficha y del portal del cliente.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Presets', what: 'Estilos listos para un clic: **Tarjeta clara**, **Banda oscura**, **Suave**, **Destacado**, **Aviso cálido**, más los que guardes con **Guardar actual**.', tip: 'Guarda los colores de tu marca como preset y úsalos en todos los tableros.' },
                    { name: 'Fondo, Color de texto y Borde', what: 'Colores de la tarjeta. El texto se ajusta solo para que se lea sobre el fondo elegido, en modo claro y oscuro.' },
                    { name: 'Relleno', what: 'El aire entre el borde y el contenido.' },
                    { name: 'Esquinas y Sombra', what: 'Qué tan redondeada es la tarjeta y cuánto se despega del fondo.' },
                    { name: 'Tamaño de texto y Peso', what: 'Más grande o más fino, de Fino a Bold.' },
                    { name: 'Alineación', what: 'Izquierda, centro o derecha (útil en títulos y textos).' },
                    { name: 'Restablecer diseño', what: 'Vuelve a la tarjeta normal.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Usa el color con intención: una **Banda oscura** para el KPI más importante, tarjetas normales para el resto. Si todo es de colores, nada resalta.',
            },
            { t: 'h', text: 'La página entera' },
            {
                t: 'settings',
                title: 'Botón «Página» (arriba del tablero)',
                rows: [
                    { name: 'Fondo de la página', what: 'Un color de fondo detrás de todos los widgets.', tip: 'Un gris muy claro hace que las tarjetas blancas resalten.' },
                    { name: 'Ancho máximo del contenido (px)', what: 'Limita qué tan ancho se estira el tablero en pantallas grandes.' },
                    { name: 'Tipografía global', what: '**Moderna**, **Serif (editorial)**, **Redondeada (amigable)** o **Monoespaciada (técnica)**.' },
                ],
            },
            { t: 'h', text: 'Nombre, descripción e icono' },
            {
                t: 'p',
                md: 'Pasa el mouse por el título del tablero y toca el lápiz, o ve a **⋯ → Configuración**. Ahí cambias el **Nombre**, el **Icono** (con su color, el mismo catálogo de las listas, que se ve en el menú) y la **Descripción (opcional)**, que aparece bajo el título.',
            },
            { t: 'demo', key: 'tab-diseno', caption: 'Los botones de un widget y la configuración de la página.', fallback: 'tab-layout' },
            {
                t: 'example',
                title: 'Un gimnasio',
                md: 'La administradora pone arriba un **Contenido · Imagen** con el logo y un **Título de sección** «Socios». Debajo, tres KPI (socios activos, altas del mes, renovaciones pendientes), el de altas con **Banda oscura**. Después otro título «Clases» con un gráfico de asistencia por clase y uno por horario. El fondo de la página en gris claro y la tipografía **Redondeada**. En la pantalla de la recepción, en modo presentación, parece hecho a medida.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Si muevo widgets, se le desacomoda a los demás?', a: 'El diseño es uno solo para el tablero: si lo cambias, lo ven así todos. Por eso sólo lo puede editar quien tiene permiso para editar tableros.' },
                    { q: '¿Puedo copiar un widget a otro tablero?', a: 'Puedes duplicarlo dentro del mismo tablero. Para llevar varios a otro lado, duplica el tablero entero desde su tarjeta (icono de copiar) o guárdalo como plantilla.' },
                    { q: '¿Se ve bien en modo oscuro?', a: 'Sí. Los colores que eliges se ajustan para que el texto se lea sobre la superficie real, en claro y en oscuro.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Tableros', to: '/dashboards' },
                    { label: 'Mirar los datos del tablero', article: 'tableros-explorar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tableros-explorar',
        route: '/dashboards',
        related: ['tableros-configurar-widget', 'tableros-compartir', 'tableros-diseno'],
        blocks: [
            {
                t: 'p',
                md: 'Un tablero no es sólo para mirar: puedes cambiar el período de todo de una vez, filtrar por persona o por estado, abrir los registros que hay detrás de un número y proyectarlo en una pantalla. Nada de esto cambia el tablero para los demás.',
            },
            { t: 'anim', key: 'tab-explorar', caption: 'El período pasa a «Este trimestre» y el filtro a «Responsable: yo»; todo se recalcula junto.' },
            { t: 'h', text: 'El período de todo el tablero' },
            {
                t: 'p',
                md: 'Arriba del tablero está el selector de período. Por defecto dice **Cada widget con su período**: cada widget usa el que le pusieron al configurarlo. Si eliges otro (**Hoy**, **Ayer**, **Esta semana**, **Semana pasada**, **Este mes**, **Mes pasado**, **Últimos 7 / 15 / 30 / 90 días**, **Próximos 7 / 30 días**, **De hoy en adelante**, **Este trimestre**, **Trimestre pasado**, **Este año**, **Año pasado**), ese período manda sobre todos los widgets que tienen un campo de fecha.',
            },
            {
                t: 'steps',
                items: [
                    'Abre el selector de período y elige, por ejemplo, **Mes pasado** para la reunión de cierre.',
                    'Para un rango exacto elige **Personalizado…** y completa **Desde** y **Hasta**.',
                    'Si algún widget no tiene campo de fecha, la app avisa al lado: «No aplica a… (sin campo de fecha)».',
                    'Para volver, elige **Cada widget con su período**.',
                ],
            },
            { t: 'callout', tone: 'info', md: 'El período que eliges se recuerda en tu dispositivo para ese tablero. A los demás no les cambia nada.' },
            { t: 'h', text: 'Filtros del tablero' },
            {
                t: 'p',
                md: 'Quien edita el tablero puede dejar filtros listos arriba para que cada persona elija el valor. Se configuran en **⋯ → Filtros del tablero**: eliges la **Lista** y el **Campo**, y queda un selector en la cabecera que filtra **todos los widgets de esa lista**.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Campo de selección', what: 'Filtra por una opción: «Sucursal: Centro», «Estado: Pendiente».' },
                    { name: 'Campo de persona', what: 'Con la opción **yo**: cada vendedor ve su propio tablero sin que armes uno para cada uno. También **otra persona…**.', tip: 'El filtro estrella de un tablero de ventas.' },
                    { name: 'Casilla', what: '**Sí**, **No** o **todos**.' },
                    { name: 'Campo de equipo', what: 'Con la opción **mis equipos**.' },
                ],
            },
            { t: 'demo', key: 'tab-filtros', caption: 'Elegir el período del tablero y ver los números recalculados.', fallback: 'tab-explorar' },
            { t: 'h', text: 'Del número al detalle con un clic' },
            { t: 'anim', key: 'tab-click', caption: 'Un clic en una porción abre la lista ya filtrada por ese valor.' },
            {
                t: 'p',
                md: 'Haz clic en una **barra**, una **porción** de la dona o una **etapa** del embudo y se abre la lista con esos registros, ya filtrada por ese valor (y por los dos valores si la barra está desglosada). Ahí puedes abrirlos, editarlos o exportarlos. En los gráficos agrupados por fecha el clic no navega.',
            },
            {
                t: 'example',
                title: 'Una empresa de servicios técnicos',
                md: 'La coordinadora ve en el embudo que hay 9 órdenes en «Esperando repuesto». Hace clic en esa etapa y se abre la lista de órdenes con ese filtro: ordena por fecha y llama primero a los clientes que esperan hace más días.',
            },
            { t: 'h', text: 'Descargar un widget' },
            {
                t: 'p',
                md: 'Pasa el mouse por un widget y toca el botón de descarga (**Descargar**): **Descargar imagen (PNG)** para pegarlo en una presentación o un chat, o **Descargar datos (CSV)** para abrir los números en una hoja de cálculo, con el formato de números de tu empresa.',
            },
            { t: 'h', text: 'Modo presentación' },
            {
                t: 'p',
                md: 'Toca **Presentar**: el tablero pasa a pantalla completa, se esconden los botones de edición y los números se recargan solos cada minuto. Queda sólo el selector de período y el botón **Salir**. Es ideal para una pantalla en la oficina, la bodega o la recepción.',
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Para un televisor que muestra el tablero todo el día sin una sesión abierta, usa el **enlace público** del tablero: se recarga cada 5 minutos y no necesita usuario.',
            },
            {
                t: 'keys',
                items: [
                    { keys: ['Esc'], what: 'Salir de la pantalla completa del modo presentación.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿El filtro «yo» funciona para un lector?', a: 'Sí. Cada persona que abre el tablero elige sus filtros, y además sólo ve los registros que sus permisos le dejan ver.' },
                    { q: '¿Por qué un widget no cambió al elegir el período?', a: 'Porque no tiene un campo de fecha (ni en su período ni en el agrupado). La app lo avisa al lado del selector.' },
                    { q: '¿Puedo filtrar por un texto libre?', a: 'Los filtros del tablero son de selección, persona, casilla o equipo. Para condiciones más finas, ponlas en los filtros de cada widget.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Tableros', to: '/dashboards' },
                    { label: 'Compartir el tablero', article: 'tableros-compartir' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tableros-compartir',
        route: '/dashboards',
        related: ['tableros-crear', 'tableros-explorar', 'correos-como-salen'],
        blocks: [
            {
                t: 'p',
                md: 'Un tablero se comparte de tres maneras: **dentro de la app** con tu equipo (eligiendo quién lo ve), con un **enlace público** que se abre sin iniciar sesión, y con un **envío programado por correo** que le llega a quien quieras cada día, semana o mes.',
            },
            { t: 'anim', key: 'tab-compartir', caption: 'Desde «Compartir»: un enlace de sólo lectura y un resumen por correo con el PDF.' },
            { t: 'h', text: 'Quién lo ve dentro de la app' },
            {
                t: 'settings',
                title: 'Visibilidad (al crearlo o en Configuración)',
                rows: [
                    { name: 'Todo el workspace', what: 'Lo ve todo el equipo en **Tableros**. La tarjeta dice **Compartido**.', tip: 'El tablero general de la empresa.' },
                    { name: 'Sólo yo', what: 'Sólo lo ves tú (y los administradores).', tip: 'Para armar uno de prueba antes de mostrarlo.' },
                    { name: 'Roles específicos', what: 'Lo ven los roles que marques: **Manager**, **Agente** y/o **Lector**.', tip: 'Por ejemplo, el tablero de márgenes sólo para gerentes.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Los administradores siempre ven todos los tableros. Y recuerda que cada persona ve los números según sus permisos en cada lista.',
            },
            { t: 'h', text: 'Enlace público' },
            {
                t: 'p',
                md: 'Toca **Compartir** y elige **Enlace público**. Con **Publicar enlace** se crea una dirección de sólo lectura: cualquiera que la tenga ve el tablero sin iniciar sesión, puede descargar los widgets y la página se refresca sola. También se puede **insertar** en otra página web (tu sitio o una intranet).',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Enlace público', what: 'La dirección, con **Copiar** y **Abrir**.' },
                    { name: 'Vence (opcional)', what: 'Funciona hasta el final de ese día. Vacío: no vence.', tip: 'Para un cliente o un auditor, ponle fecha.' },
                    { name: 'Quien mira puede cambiar el período', what: 'Le deja elegir hoy, este mes, el año pasado… Los datos se recalculan.' },
                    { name: 'Sitios donde se puede insertar', what: 'Uno por línea. Vacío: se puede insertar en cualquier sitio. El enlace se abre igual desde cualquier lugar.' },
                    { name: 'Código para insertar', what: 'El código listo para pegar en tu página web, con **Copiar código**.' },
                    { name: 'Nueva dirección', what: 'Crea una dirección nueva; la anterior deja de funcionar al instante, también donde esté insertada.', tip: 'Úsala si el enlace llegó a quien no debía.' },
                    { name: 'Dejar de publicar', what: 'El tablero ya no es público.' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Qué datos se ven',
                md: 'El enlace muestra los datos que puede ver **quien lo publicó**: si esa persona deja de tener acceso, el enlace deja de funcionar. Si el tablero tiene **tablas**, cualquiera con el enlace ve esas filas (los registros), no sólo los totales. Revisa que no muestren nada que no quieras compartir. Sólo quien creó el tablero o un administrador puede publicarlo.',
            },
            { t: 'demo', key: 'tab-enlace', caption: 'Publicar el tablero con un enlace de sólo lectura.', fallback: 'tab-compartir' },
            { t: 'h', text: 'Envío programado por correo' },
            {
                t: 'p',
                md: 'En **Compartir → Envío por correo** toca **Programar un envío**. Llega un resumen con los indicadores y los valores principales de cada gráfico, y un botón para abrir el tablero. Los datos son los que ve quien programa el envío.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Frecuencia', what: '**Todos los días**, **Cada semana** o **Cada mes**.' },
                    { name: 'Hora y Zona horaria', what: 'Cuándo sale. Sin elegir zona, usa la de la empresa.' },
                    { name: 'Días', what: 'En los envíos semanales, qué días de la semana.' },
                    { name: 'Día del mes', what: 'En los mensuales, el día (o **El último día**).' },
                    { name: 'Personas del equipo', what: 'Miembros que lo reciben. Tienen que poder ver el tablero.' },
                    { name: 'Correos externos (opcional)', what: 'Direcciones de afuera: un socio, el contador, un cliente. Hasta 25 destinatarios en total; cada uno recibe su propio correo y nadie ve a los demás.' },
                    { name: 'Asunto', what: 'Por defecto «Resumen de «nombre del tablero»».' },
                    { name: 'Adjuntar el tablero en PDF', what: 'Los gráficos dibujados en un PDF, para imprimir o archivar.' },
                    { name: 'Mensaje (opcional)', what: 'Un texto que va arriba del resumen.' },
                    { name: 'Activo', what: 'Apágalo para pausar el envío sin borrarlo.' },
                ],
            },
            {
                t: 'p',
                md: 'Antes de guardar, **Enviarme una prueba ahora** te manda el correo a ti. Ya creado, cada envío muestra cuántos destinatarios tiene, si lleva PDF, cuándo salió por última vez o por qué falló, y los botones **Editar**, **Enviar ahora**, **Reanudar** (si estaba pausado) y **Eliminar**.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Cada destinatario cuenta para la cuota de correos de tu plan, salvo que tu empresa envíe con su propio servidor o cuenta de correo. Si la empresa queda en solo lectura por falta de pago, los envíos no salen.',
            },
            {
                t: 'example',
                title: 'Una cadena de panaderías',
                md: 'El dueño programa **Cada semana**, lunes a las 7:00, el tablero **Ventas por sede** con PDF adjunto, para él y para su contador (correo externo). A cada administradora de sede le llega a diario, a las 20:00, el tablero **Cierre del día**. Y en la pantalla de la planta de producción corre el enlace público del tablero **Pedidos de mañana**.',
            },
            { t: 'h', text: 'Duplicar y guardar como plantilla' },
            {
                t: 'p',
                md: 'En la página de **Tableros**, el icono de copiar de cada tarjeta (**Duplicar dashboard**) crea una copia con todos sus widgets. Y **⋯ → Guardar como plantilla** lo deja en la galería para armar otros iguales sobre otras listas: le das un **Nombre de la plantilla**, una **Descripción** y una **Categoría**. Las plantillas que creas se pueden borrar desde la galería; los tableros hechos con ellas no se tocan.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿El enlace público muestra los filtros del tablero?', a: 'Muestra el tablero tal como está configurado. Si activas «Quien mira puede cambiar el período», además puede elegir el período.' },
                    { q: '¿Puedo insertarlo en mi página web?', a: 'Sí. Copia el **Código para insertar** y pégalo en tu sitio. Si llenas «Sitios donde se puede insertar», sólo esos sitios podrán mostrarlo dentro de sus páginas.' },
                    { q: '¿Qué pasa si borro el tablero?', a: 'El enlace deja de funcionar y los envíos no salen. Si lo recuperas de la papelera dentro de los 30 días, vuelven.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Tableros', to: '/dashboards' },
                    { label: 'Cómo salen los correos', article: 'correos-como-salen' },
                ],
            },
        ],
    },
];
