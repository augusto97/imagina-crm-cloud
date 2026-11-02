import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'primeros-pasos-piezas',
        route: '/lists',
        related: ['primeros-pasos-empezar', 'listas-y-campos-crear', 'listas-y-campos-texto-numeros', 'listas-y-campos-relaciones'],
        blocks: [
            {
                t: 'p',
                md: 'Piensa en la app como una hoja de cálculo con superpoderes, armada a la medida de tu negocio. Todo lo que guardas vive en **listas**; cada lista tiene **registros** (las filas) y cada registro tiene **campos** (las columnas). Con esas tres piezas una ferretería arma su inventario, una clínica su agenda de pacientes y una agencia sus proyectos con clientes que pagan cada mes.',
            },
            { t: 'anim', key: 'pp-piezas', caption: 'La lista entera, una de sus columnas (un campo) y una de sus filas (un registro).' },
            { t: 'h', text: 'Las tres piezas, una por una' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Table',
                        title: 'Lista',
                        md: 'Guarda **un tipo de cosa**: clientes, facturas, pedidos, tareas, citas. Tiene nombre, ícono y color, y aparece en el menú de la izquierda.',
                        tone: 'blue',
                    },
                    {
                        icon: 'Columns3',
                        title: 'Campo',
                        md: 'Un **dato** que tienen todos los registros de la lista: la ciudad, el valor, la fecha de entrega, el responsable. Cada campo tiene un **tipo** (texto, número, fecha, selección…).',
                        tone: 'violet',
                    },
                    {
                        icon: 'FileText',
                        title: 'Registro',
                        md: 'Una **fila**: un cliente, una factura, una tarea. Al abrirlo ves su **ficha** con todos sus datos, comentarios, archivos y el historial de cambios.',
                        tone: 'mint',
                    },
                ],
            },
            {
                t: 'p',
                md: 'La regla práctica para saber si algo merece su propia lista: si tiene **varios datos propios** y vas a tener **muchos de ellos**, es una lista. «Clientes» es una lista; la «ciudad» de un cliente es un campo. Si un mismo cliente tiene muchas facturas, «Facturas» va en otra lista **vinculada** a «Clientes» (ver más abajo).',
            },
            { t: 'h', text: 'Abrir un registro y ver su ficha' },
            {
                t: 'steps',
                items: [
                    'En el menú de la izquierda, toca una lista (por ejemplo **Clientes**). Se abre la tabla con todos sus registros.',
                    'Toca el **nombre** de un registro (la primera columna). Se abre su **ficha** en una ventana grande.',
                    'Cambia lo que quieras y toca **Guardar cambios**. En la tabla también puedes editar una celda directamente: se guarda en el momento.',
                    'A la derecha de la ficha están **Comentarios** y **Actividad**: lo que se habló del registro y quién cambió qué.',
                    'Con las flechas de arriba (o las teclas **J** y **K**) pasas al registro siguiente o al anterior sin cerrar la ficha.',
                ],
            },
            { t: 'demo', key: 'records-open', caption: 'Abrir un registro desde la tabla de clientes.', fallback: 'pp-piezas' },
            { t: 'h', text: 'Una lista, muchas formas de verla' },
            {
                t: 'p',
                md: 'Los mismos registros se pueden ver como **tabla**, **tablero** (kanban, por etapa o estado), **calendario**, **tarjetas**, **Gantt** o **carga de trabajo**. Cambiar de vista **no cambia los datos**: sólo cómo los miras. Cada vista guarda sus filtros, su orden y sus columnas, así cada persona del equipo tiene la suya («Mis clientes de Bogotá», «Facturas vencidas», «Tareas de esta semana»).',
            },
            { t: 'h', text: 'Listas que se conectan entre sí' },
            {
                t: 'p',
                md: 'Un campo de tipo **Relación** vincula registros de dos listas: cada factura apunta a su cliente, cada tarea a su proyecto, cada cita a su paciente. Con eso puedes, desde la ficha del cliente, ver todas sus facturas, y sumar cuánto te debe con un campo de **resumen**. Es lo que convierte varias tablas sueltas en un sistema.',
            },
            {
                t: 'settings',
                title: 'Lo que tiene cada campo',
                rows: [
                    { name: 'Tipo', what: 'Texto, número, moneda, fecha, selección, usuario, archivo, relación, fórmula… define qué se puede escribir y cómo se ve.', tip: 'Elige el tipo correcto desde el principio: así filtrar, ordenar y sumar funciona solo.' },
                    { name: 'Nombre', what: 'Lo que se lee en la columna y en la ficha. Se puede cambiar cuando quieras sin perder nada.', tip: 'Usa nombres cortos y claros: «Valor», no «Valor total del contrato en pesos».' },
                    { name: 'Obligatorio', what: 'No deja guardar un registro sin ese dato.', tip: 'Úsalo sólo en lo imprescindible (por ejemplo, el NIT de un cliente).' },
                    { name: 'Sin repetidos', what: 'No deja guardar dos registros con el mismo valor.', tip: 'Ideal para códigos, SKU, correos o números de documento.' },
                    { name: 'Valor por defecto', what: 'Se pone solo al crear un registro sin ese dato.', tip: 'Por ejemplo, Estado = «Nuevo» o Responsable = quien lo crea.' },
                ],
            },
            {
                t: 'example',
                title: 'Una agencia de viajes',
                md: 'Una lista **Clientes** (nombre, documento, teléfono, correo), otra **Viajes** vinculada a cada cliente (destino, fechas, valor, estado) y otra **Pagos** vinculada a cada viaje. En la ficha del cliente ve sus viajes y un campo de resumen le dice cuánto debe. Con un tablero por estado sigue cada viaje de «Cotizado» a «Pagado».',
            },
            {
                t: 'example',
                title: 'Una ferretería',
                md: '**Productos** (SKU, precio, stock, proveedor) y **Proveedores** (NIT, contacto, días de entrega). Una vista «Para reponer» filtra lo que tiene poco stock y el escáner del celular busca un producto por su código de barras.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Empieza con una plantilla',
                md: 'No hace falta armar todo a mano: las plantillas traen la lista con campos, vistas, automatizaciones y datos de ejemplo. Después la cambias a tu gusto.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cuántas listas puedo tener?', a: 'Las que necesites. Tu plan define cuántos registros en total puede tener la empresa (lo ves en Ajustes → Plan y uso).' },
                    { q: '¿Si cambio el nombre de un campo se pierden los datos?', a: 'No. Los datos quedan atados al campo, no a su nombre. Puedes renombrar campos y listas cuando quieras.' },
                    { q: '¿Qué diferencia hay entre una lista y una vista?', a: 'La lista es dónde viven los datos; la vista es una forma de mirarlos (filtrada, ordenada, como tablero…). Una lista puede tener muchas vistas.' },
                    { q: '¿Puedo traer lo que ya tengo en Excel?', a: 'Sí: con **Importar** subes un Excel o CSV, eliges qué columna va a qué campo y hasta puedes crear los campos en el momento.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido de listas y registros', tour: 'lists-and-records' },
                    { label: 'Crear una lista', article: 'listas-y-campos-crear' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'primeros-pasos-moverte',
        route: '/lists',
        related: ['primeros-pasos-carpetas', 'primeros-pasos-buscar', 'mi-dia-mi-trabajo', 'mi-dia-favoritos'],
        blocks: [
            {
                t: 'p',
                md: 'En el computador la pantalla tiene cuatro zonas que se repiten en toda la app: el **riel** de la izquierda (las secciones), el **panel** de al lado (el contenido de la sección), la **barra superior** (buscar, avisos, ayuda y tu cuenta) y el **área de trabajo** (lo que estás viendo). En el celular todo eso cabe en **una barra de pestañas abajo**, como en cualquier app del teléfono (lo ves más abajo). Con eso claro, nunca te pierdes.',
            },
            { t: 'anim', key: 'pp-menu', caption: 'El riel cambia de sección y el panel de al lado muestra lo de cada una.' },
            { t: 'h', text: 'El riel: las secciones de la app' },
            {
                t: 'settings',
                title: 'Qué hay en cada ícono del riel',
                rows: [
                    { name: 'Listas', what: 'Tus listas, ordenadas en carpetas, con lo que abriste hace poco arriba (**Recientes**).', tip: 'Es donde vas a pasar la mayor parte del día.' },
                    { name: 'Mi trabajo', what: 'Todo lo que tienes asignado en todas las listas, agrupado por vencimiento, más tus recordatorios, aprobaciones y lo que sigues.', tip: 'Ábrelo al empezar el día: es tu lista de pendientes.' },
                    { name: 'Favoritos', what: 'Las listas, tableros y vistas que anclaste con el pin.', tip: 'Ancla lo que abres todos los días.' },
                    { name: 'Tableros', what: 'Los dashboards con gráficos y cifras de tu operación.', tip: 'Aparece si tu rol puede ver tableros.' },
                    { name: 'Agentes', what: 'Los agentes de IA que trabajan solos sobre tus registros.', tip: 'Sólo lo ve quien administra agentes.' },
                    { name: 'Aprende', what: 'Este centro de aprendizaje, con guías completas de cada parte de la app.', tip: 'Busca aquí antes de preguntar: casi todo está explicado.' },
                    { name: 'Ajustes', what: 'Tu cuenta (seguridad, avisos, apariencia) y, si administras, la empresa: miembros, marca, correo, integraciones…', tip: 'Lo que ves depende de tu rol.' },
                ],
            },
            {
                t: 'p',
                md: 'Si eres superadministrador de la plataforma verás además **Plataforma**, la consola del operador. El resto del equipo no la ve.',
            },
            { t: 'h', text: 'El panel lateral' },
            {
                t: 'p',
                md: 'El panel muestra el contenido de la sección elegida. En **Listas** verás arriba **Recientes** (lo último que abriste) y debajo **Espacio de trabajo**, con tus carpetas y listas. Junto al título hay dos botones: **+** (**Nueva lista**) y el de carpeta (**Nueva carpeta**).',
            },
            {
                t: 'steps',
                items: [
                    'Para ganar espacio, toca **Colapsar panel** (las dos flechas «‹‹» arriba del panel). Queda sólo el riel.',
                    'Con el panel colapsado, **pasa el mouse** sobre un ícono del riel: el panel aparece flotando por encima, sin moverte de donde estás.',
                    'Para volver a fijarlo, toca **Expandir panel** arriba del riel.',
                    'Pasa el mouse sobre una lista del panel y toca **«···»** (o haz clic derecho) para ver todo lo que puedes hacer con ella.',
                ],
            },
            { t: 'demo', key: 'pp-moverte', caption: 'Pasar de Listas a Mi trabajo y a Favoritos desde el riel.', fallback: 'pp-menu' },
            { t: 'h', text: 'La barra superior' },
            {
                t: 'settings',
                title: 'De izquierda a derecha',
                rows: [
                    { name: 'Buscar listas, registros, dashboards…', what: 'Abre la búsqueda global. También con **Ctrl K** (o **⌘K** en Mac).', tip: 'Es la forma más rápida de llegar a un registro.' },
                    { name: '✨ Asistente IA', what: 'Le pides en tus palabras una lista, un tablero, una automatización o un dato.', tip: 'Aparece si la empresa lo activó y tu rol lo permite.' },
                    { name: 'Megáfono (Novedades)', what: 'Lo nuevo que llegó a la app, con un número cuando hay algo sin ver.', tip: 'En el celular está en **Más → Novedades**.' },
                    { name: 'Campana (Avisos)', what: 'Tus avisos: menciones, asignaciones, recordatorios, aprobaciones.', tip: 'El número rojo son los que no leíste.' },
                    { name: '? (Ayuda)', what: 'Guías rápidas, recorridos guiados y el contacto de soporte.' },
                    { name: 'Sol / luna', what: 'Cambia entre modo claro y oscuro.' },
                    { name: 'Tu avatar', what: 'El menú de tu cuenta: empresa, Mi cuenta, Ajustes, tema, instalar la app, Primeros pasos, atajos y cerrar sesión.' },
                ],
            },
            {
                t: 'p',
                md: 'A veces aparecen dos indicadores más: un **cronómetro** en marcha (si estás registrando tiempo en un registro) y una pastilla roja **«N problemas»** cuando algo que corre solo dejó de funcionar (una automatización, el correo o un conector). Tócala para ver qué pasó.',
            },
            { t: 'h', text: 'En el celular y en la app instalada' },
            {
                t: 'p',
                md: 'En una pantalla angosta (el teléfono o una tablet en vertical) la navegación es una **barra de pestañas abajo**, siempre a la vista y al alcance del pulgar. La pestaña en la que estás se ve resaltada en el color de tu empresa.',
            },
            { t: 'anim', key: 'celular-pestanas', caption: 'La barra de abajo: «Más» muestra todo lo demás y «Listas» te devuelve a tus listas.' },
            {
                t: 'settings',
                title: 'Las cinco pestañas',
                rows: [
                    { name: 'Listas', what: 'Tus listas por carpeta, con **Recientes** y **Favoritos** arriba para llegar de un toque.', tip: 'Si ya estás en Listas, tocarla otra vez te sube al principio.' },
                    { name: 'Mi trabajo', what: 'Lo que tienes asignado en todas las listas, por vencimiento, más recordatorios y aprobaciones.' },
                    { name: 'Buscar', what: 'La búsqueda global: listas, registros, tableros y guías. También lee códigos con la cámara.' },
                    { name: 'Avisos', what: 'Tus menciones, asignaciones, recordatorios y aprobaciones, a pantalla completa.', tip: 'El número rojo son los que no leíste.' },
                    { name: 'Más', what: 'Tu cuenta, el cambio de empresa, Favoritos, Tableros, Aprende, Ajustes, el tema, instalar la app, la ayuda y cerrar sesión.', tip: 'Un punto en «Más» indica que hay novedades sin ver.' },
                ],
            },
            {
                t: 'p',
                md: 'Arriba queda el nombre de tu empresa (si perteneces a más de una, tócalo para cambiar), la pastilla de **problemas** si algo dejó de funcionar y el **asistente ✨**. **Ajustes** y **Plataforma** se ven como una lista de secciones por tema; dentro de una sección, **‹ Ajustes** te devuelve a la lista.',
            },
            {
                t: 'example',
                title: 'El día de una vendedora',
                md: 'Laura abre **Mi trabajo** y ve que tiene 2 llamadas vencidas y 3 cotizaciones para hoy. Desde **Favoritos** entra a la vista «Mis oportunidades» del tablero de ventas, y cuando un cliente la llama busca su nombre con **Ctrl K** sin soltar el teléfono.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo «Tableros» ni «Agentes» en el riel (o en «Más»). ¿Por qué?', a: 'Dependen de tu rol. Si los necesitas, pídeselo a quien administra la empresa.' },
                    { q: 'En el celular, ¿dónde está mi cuenta y cerrar sesión?', a: 'En la pestaña **Más**: arriba está tu nombre (tu cuenta y seguridad) y al final, **Cerrar sesión**.' },
                    { q: '¿El panel colapsado se recuerda?', a: 'Sí, en ese dispositivo. La próxima vez que entres lo encontrarás igual.' },
                    { q: '¿Puedo cambiar el orden de las listas del menú?', a: 'Sí, si puedes administrar listas: arrástralas en el panel. El orden es el mismo para todo el equipo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver el recorrido por la app', tour: 'welcome' },
                    { label: 'Ir a Mi trabajo', to: '/my-work' },
                    { label: 'Carpetas y menú de cada lista', article: 'primeros-pasos-carpetas' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'primeros-pasos-empezar',
        route: '/lists',
        related: ['primeros-pasos-piezas', 'listas-y-campos-crear', 'importar-exportar-plantillas', 'importar-exportar-importar'],
        blocks: [
            {
                t: 'p',
                md: 'Cuando una empresa todavía no tiene listas, la página de Listas se convierte en **«Armemos tu espacio»**: tres caminos para tener todo andando el primer día. Todo lo que se crea se puede cambiar después, así que no hay forma de equivocarse.',
            },
            { t: 'anim', key: 'pp-empezar', caption: 'Describes tu negocio y la IA propone las listas, un tablero y automatizaciones para revisar.' },
            { t: 'h', text: 'Los tres caminos' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Sparkles',
                        title: 'Cuéntanos de tu negocio',
                        md: 'Describes a qué te dedicas y la **IA** arma tus listas vinculadas, con campos bien elegidos, vistas (tablero, calendario), un tablero de cifras, 1 a 3 automatizaciones y datos de ejemplo. **Revisas todo antes de crear**.',
                        tone: 'violet',
                    },
                    {
                        icon: 'LayoutTemplate',
                        title: 'Elegir por tipo de negocio',
                        md: 'Plantillas listas para usar, agrupadas por tipo: servicios y agencias, ventas, proyectos, soporte, comercio, salud y citas, recursos humanos, eventos. Puedes **combinar** varias.',
                        tone: 'blue',
                    },
                    {
                        icon: 'FileText',
                        title: 'Empezar en blanco',
                        md: 'Creas tu primera lista desde cero y agregas los campos uno por uno. Ideal si ya tienes muy claro lo que necesitas.',
                        tone: 'slate',
                    },
                ],
            },
            { t: 'h', text: 'Con la IA: «Cuéntanos de tu negocio»' },
            {
                t: 'steps',
                items: [
                    'Toca **Cuéntanos de tu negocio**.',
                    'En **¿A qué se dedica tu negocio?** escríbelo como se lo contarías a alguien: qué haces, con quién trabajas y qué quieres tener en orden. Si no se te ocurre, toca uno de los ejemplos de **Prueba con:**.',
                    'Opcional: marca **¿Qué quieres organizar primero?** (clientes y ventas, proyectos y tareas, soporte, inventario, citas, facturación y cobros) y el **Tamaño del equipo**.',
                    'Toca **Armar mi espacio**. Suele tardar menos de un minuto.',
                    'Revisa la propuesta: puedes **quitar** listas, campos, vistas, automatizaciones o el tablero con un toque, y **cambiar el nombre** de cada lista. Lo que dependía de algo que quitaste se quita solo y te lo avisa.',
                    'Elige la **Carpeta** donde quedan (si son varias listas) y si quieres **Incluir datos de ejemplo**.',
                    'Toca **Crear mi espacio**. Te lleva a la primera lista.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Qué viaja a la IA',
                md: 'Sólo lo que escribes en ese cuadro (y, si ya tienes listas, sus nombres, para no repetirlas). **No se envía ningún registro**. Si la empresa usa la IA de la plataforma, cuenta como 1 pedido de IA de tu plan. Si la IA no está disponible, la opción aparece desactivada con el motivo y el camino por plantillas queda como recomendado.',
            },
            { t: 'h', text: 'Con plantillas: «Elegir por tipo de negocio»' },
            {
                t: 'steps',
                items: [
                    'Toca **Elegir por tipo de negocio** y elige un tipo (por ejemplo **Salud y citas**).',
                    'Marca una o varias plantillas: cada una muestra **Qué trae** (listas, campos, vistas, automatizaciones).',
                    'Puedes combinar plantillas de distintos tipos (hasta 6 a la vez). Las que se relacionan quedan conectadas: por ejemplo, la agenda de citas con los clientes.',
                    'Elige la carpeta, decide si van los datos de ejemplo y toca **Crear mi espacio**.',
                ],
            },
            {
                t: 'example',
                title: 'Una clínica dental',
                md: 'Escribe «Clínica dental con citas, pacientes y cobros». La IA propone **Pacientes**, **Citas** (con vista de calendario) y **Tratamientos y cobros** vinculados, un tablero con las citas de la semana y lo que se debe, y una automatización que avisa por correo un día antes de cada cita. Quita lo que no usa y en un minuto está cargando pacientes reales.',
            },
            { t: 'h', text: 'Los datos de ejemplo y cómo borrarlos' },
            {
                t: 'p',
                md: 'Los datos de ejemplo son registros inventados para que veas cómo se ve todo funcionando (un tablero vacío no dice nada). Mientras existan, cada lista muestra arriba el aviso **«Estos son datos de ejemplo para que veas cómo funciona.»** con el botón **Borrar los datos de ejemplo**. Al tocarlo se van a la papelera (con **Deshacer**) y el aviso desaparece. Tus registros reales no se tocan.',
            },
            { t: 'h', text: 'La lista de «Primeros pasos»' },
            {
                t: 'p',
                md: 'Abajo a la derecha verás el botón **Primeros pasos** con un anillo de avance («3 de 9»). Es una lista de lo más importante para arrancar, y **cada paso se marca solo** cuando lo haces de verdad. Cada paso tiene **Hacerlo** (te lleva al lugar), **Muéstrame** (un recorrido guiado, cuando existe) y **Saltar este paso**.',
            },
            { t: 'demo', key: 'pp-primeros-pasos', caption: 'El panel de Primeros pasos con lo que falta para arrancar.', fallback: 'pp-empezar' },
            {
                t: 'settings',
                title: 'Los pasos (quien administra)',
                rows: [
                    { name: 'Crea tu primera lista', what: 'Una lista guarda tus registros: clientes, tareas, pedidos…' },
                    { name: 'Agrega o importa tus registros', what: 'Carga tus datos reales a mano o desde un Excel o CSV.' },
                    { name: 'Crea una vista: tablero, calendario…', what: 'Mira los mismos registros de otra forma.' },
                    { name: 'Invita a tu equipo', what: 'Cada persona con su rol.' },
                    { name: 'Crea una automatización', what: 'Que la app haga sola lo que se repite.' },
                    { name: 'Ponle tu marca', what: 'Tu logo y tus colores en la app y en lo que ven tus clientes.' },
                    { name: 'Conecta el correo de la empresa', what: 'Los correos salen desde tu propia dirección.' },
                    { name: 'Instala la app y activa las notificaciones', what: 'Tenla a un toque y entérate al instante.' },
                    { name: 'Pregúntale al asistente IA', what: 'Pídele en tus palabras una lista, un tablero o un dato.' },
                ],
            },
            {
                t: 'p',
                md: 'El resto del equipo ve otros pasos, pensados para quien usa la app a diario: **Abre un registro y deja un comentario**, **Mira «Mi trabajo»**, **Guarda una vista o un favorito** e **Instala la app y activa las notificaciones**. Desde el panel también puedes tocar **Agrega más con IA** para sumar listas nuevas sin tocar las que tienes, u **Ocultar primeros pasos**. Para volver a verlo: menú de tu cuenta (tu avatar) → **Primeros pasos**.',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Si tu rol no puede crear listas, en lugar de la bienvenida verás un mensaje para pedírselo a quien administra la empresa.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo usar la IA más adelante, cuando ya tengo listas?', a: 'Sí: en **Primeros pasos** toca **Agrega más con IA**. Crea lo nuevo aparte, sin tocar nada de lo que ya tienes.' },
                    { q: '¿La propuesta de la IA se puede cambiar después de crearla?', a: 'Sí, es una lista como cualquier otra: renombras, agregas o quitas campos, vistas y automatizaciones cuando quieras.' },
                    { q: 'Borré los datos de ejemplo por error.', a: 'Están en la papelera durante 30 días: Ajustes → Papelera, o **Deshacer** apenas los borras.' },
                    { q: 'Quiero empezar con mis datos de Excel.', a: 'Crea la lista en blanco y usa **Importar**: el importador crea los campos a partir de las columnas de tu archivo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Listas', to: '/lists' },
                    { label: 'Ver cómo crear una lista', tour: 'create-list' },
                    { label: 'Usar plantillas', article: 'importar-exportar-plantillas' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'primeros-pasos-buscar',
        route: '/lists',
        related: ['primeros-pasos-atajos', 'mi-dia-escaner', 'mi-dia-favoritos'],
        blocks: [
            {
                t: 'p',
                md: 'La **búsqueda global** es la puerta más rápida a cualquier cosa: un registro, una lista, un tablero, una sección de Ajustes o una guía de ayuda. Se abre desde cualquier pantalla con **Ctrl K** (en Mac, **⌘K**) o tocando el cuadro **Buscar listas, registros, dashboards…** de la barra superior. En el celular es la lupa.',
            },
            { t: 'anim', key: 'pp-buscar', caption: 'Ctrl+K, escribes «factura» y eliges entre registros, listas y guías.' },
            { t: 'h', text: 'Cómo se usa' },
            {
                t: 'steps',
                items: [
                    'Aprieta **Ctrl K** (o toca el cuadro de búsqueda).',
                    'Sin escribir nada ves **Recientes** (lo último que abriste) y accesos de **Ir a**: Todas las listas, Mi trabajo, Favoritos, Ajustes, Mi cuenta.',
                    'Escribe al menos **2 letras**: aparecen los registros que coinciden en todas tus listas, más listas, tableros y guías.',
                    'Muévete con las flechas **↑ ↓** y abre con **Enter**. **Esc** cierra.',
                ],
            },
            { t: 'demo', key: 'pp-buscar', caption: 'Buscar un cliente desde cualquier pantalla.', fallback: 'pp-buscar' },
            { t: 'h', text: 'Qué encuentra' },
            {
                t: 'settings',
                title: 'Las secciones de resultados',
                rows: [
                    { name: 'Recientes', what: 'Registros, listas y tableros que abriste hace poco.', tip: 'Para volver a lo que estabas viendo hace un rato.' },
                    { name: 'Registros', what: 'Los registros de todas las listas cuyo texto coincide (nombre, correo, teléfono, notas…).', tip: 'Sólo ves los registros que tu rol puede ver.' },
                    { name: 'Listas', what: 'Las listas por nombre, con su carpeta.' },
                    { name: 'Dashboards', what: 'Los tableros por nombre.' },
                    { name: 'Ir a', what: 'Secciones de la app: listas, Mi trabajo, favoritos, Ajustes, Mi cuenta.' },
                    { name: 'Acciones', what: 'Crear lista nueva, Atajos de teclado, Escanear un código, Centro de aprendizaje, Abrir la ayuda.' },
                    { name: 'Ayuda', what: 'Guías de este centro y del panel de Ayuda que tienen que ver con lo que escribiste.', tip: 'Prueba escribir «importar» o «permisos».' },
                ],
            },
            {
                t: 'p',
                md: 'La búsqueda no distingue mayúsculas ni acentos y busca por palabras: «clinica norte» encuentra «Clínica Norte». Dentro de una lista, el cuadro **Buscar…** de la barra de la tabla filtra sólo esa lista (y también mira la descripción de cada registro).',
            },
            { t: 'h', text: 'Buscar con la cámara' },
            {
                t: 'p',
                md: 'Junto al cuadro de búsqueda está **Escanear**: abre la cámara y busca el código QR o de barras en todas tus listas. Es ideal para inventario, entradas a un evento o activos con etiqueta.',
            },
            {
                t: 'example',
                title: 'Una distribuidora que atiende por teléfono',
                md: 'Cuando entra una llamada, la persona de servicio aprieta **Ctrl K**, escribe las primeras letras del cliente o los últimos números de su teléfono y abre su ficha en dos segundos, con sus pedidos y comentarios a la vista.',
            },
            { t: 'h', text: 'Trucos para encontrar más rápido' },
            {
                t: 'p',
                md: 'Escribe sólo una parte distintiva: «bahía» encuentra «Café Bahía S.A.S.». No importan las tildes ni las mayúsculas. Si ya tienes clara la lista, también puedes usar el buscador de la propia lista, que además filtra la tabla. Y antes de escribir nada, Ctrl K te muestra lo que abriste hace poco, que muchas veces es justo lo que buscas.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No me aparece un registro que sé que existe.', a: 'Puede que tu rol no tenga acceso a esa lista o a ese registro, o que esté en la papelera. Escribe al menos 2 letras y prueba con otra palabra del registro.' },
                    { q: '¿Funciona mientras escribo en un campo?', a: 'Sí, Ctrl K abre la búsqueda incluso con el cursor en un campo, porque usa una tecla con modificador.' },
                    { q: '¿Se pueden ver más resultados?', a: 'La búsqueda global muestra los más relevantes. Para buscar a fondo en una lista, ábrela y usa su buscador y sus filtros.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver el recorrido de búsqueda y atajos', tour: 'search-and-shortcuts' },
                    { label: 'Atajos de teclado', article: 'primeros-pasos-atajos' },
                    { label: 'Escanear códigos', article: 'mi-dia-escaner' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'primeros-pasos-carpetas',
        route: '/lists',
        related: ['primeros-pasos-moverte', 'listas-y-campos-ajustes', 'importar-exportar-duplicar'],
        blocks: [
            {
                t: 'p',
                md: 'Cuando tienes muchas listas, las **carpetas** las agrupan por área: «Ventas» (oportunidades, clientes), «Finanzas» (facturas, gastos), «Operación» (inventario, compras). Las carpetas se ven en el menú lateral y en la página **Listas**, con su propio ícono y color. Una carpeta es de un solo nivel: dentro van listas, no otras carpetas.',
            },
            { t: 'anim', key: 'pp-carpetas', caption: 'Arrastrar una lista sobre una carpeta la mete adentro.' },
            { t: 'h', text: 'Crear y llenar una carpeta' },
            {
                t: 'steps',
                items: [
                    'En el panel de Listas, junto a **Espacio de trabajo**, toca **Nueva carpeta** (el ícono de carpeta con un +).',
                    'Escribe el nombre (por ejemplo «Finanzas») y aprieta Enter.',
                    '**Arrastra** una lista y suéltala sobre el nombre de la carpeta: queda adentro. Soltándola sobre otra lista la reordenas; soltándola fuera de las carpetas vuelve a la raíz.',
                    'También puedes usar el menú de la lista («···») → **Mover a carpeta** y elegir la carpeta o **Sin carpeta**.',
                ],
            },
            { t: 'demo', key: 'pp-carpeta', caption: 'Crear una carpeta y mover una lista adentro.', fallback: 'pp-carpetas' },
            { t: 'h', text: 'El menú de una carpeta' },
            {
                t: 'p',
                md: 'Pasa el mouse sobre una carpeta y toca **«···»** (o haz clic derecho). El cuadrado de color muestra el ícono y, al pasar el mouse, se convierte en la flechita para **plegar o desplegar** la carpeta. Tocar el **nombre** abre la **página de la carpeta**: sus listas como tarjetas, un buscador y **Nueva lista** que nace adentro.',
            },
            {
                t: 'settings',
                title: 'Opciones de la carpeta',
                rows: [
                    { name: 'Cambiar el nombre', what: 'El nombre se vuelve editable en el mismo lugar. Enter guarda, Escape cancela.' },
                    { name: 'Color e ícono', what: 'Elige entre más de 300 íconos sólidos y una paleta de colores.', tip: 'Un color por área ayuda a encontrar todo de un vistazo.' },
                    { name: 'Nueva lista en esta carpeta', what: 'Crea una lista (en blanco, con plantilla o duplicando) que nace adentro.' },
                    { name: 'Nueva carpeta', what: 'Crea otra carpeta.' },
                    { name: 'Plegar / Desplegar', what: 'Esconde o muestra sus listas en el menú. Se recuerda en tu dispositivo.' },
                    { name: 'Eliminar carpeta', what: 'Borra la carpeta, **no las listas**: vuelven al nivel de arriba.' },
                ],
            },
            { t: 'h', text: 'El menú de una lista' },
            {
                t: 'p',
                md: 'Cada lista del menú lateral tiene su menú con **«···»** o clic derecho. Las opciones que ves dependen de tu rol:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Anclar a favoritos', what: 'La suma a **Favoritos**. Si ya está, dice **Quitar de favoritos**.' },
                    { name: 'Cambiar el nombre', what: 'Renombra la lista en el mismo menú. Los enlaces viejos siguen funcionando.' },
                    { name: 'Copiar vínculo', what: 'Copia la dirección de la lista para mandarla a un compañero.' },
                    { name: 'Color e ícono', what: 'Igual que en las carpetas.' },
                    { name: 'Mover a carpeta', what: 'Elige la carpeta o **Sin carpeta**.' },
                    { name: 'Nuevo registro / Importar CSV / Excel', what: 'Atajos para cargar datos sin abrir la lista primero.' },
                    { name: 'Compartir', what: 'Quién del equipo la ve, o publicarla hacia afuera.' },
                    { name: 'Campos · Automatizaciones · Uso compartido y permisos · Ajustes de la lista', what: 'Accesos directos a cada sección de configuración.' },
                    { name: 'Duplicar · Guardar como plantilla', what: 'Copia la lista o la guarda en la galería de la empresa.' },
                    { name: 'Eliminar', what: 'La manda a la papelera con todo lo de adentro; se recupera durante 30 días.' },
                ],
            },
            { t: 'h', text: 'Pasar de una empresa a otra' },
            {
                t: 'p',
                md: 'Si trabajas en más de una empresa (por ejemplo, una agencia que lleva a varios clientes), el nombre de la empresa arriba del panel tiene una flechita: tócalo y elige en **Tus empresas**. También puedes cambiar desde el menú de tu cuenta (tu avatar), sección **Empresa**. En el celular, toca el nombre de la empresa en la barra de arriba o entra a **Más → Tus empresas**. Cada empresa tiene sus propias listas, miembros, ajustes y avisos; tu cuenta y tu contraseña son las mismas.',
            },
            {
                t: 'example',
                title: 'Un colegio',
                md: 'Carpeta **Académico** (Estudiantes, Cursos, Notas), carpeta **Administración** (Pensiones, Proveedores) y carpeta **Comunidad** (Eventos, Solicitudes de padres). Cada coordinador ancla a favoritos sólo las listas que usa.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Las carpetas son iguales para todo el equipo?', a: 'Sí: carpetas y orden de las listas son de la empresa. Lo que es tuyo es lo que pliegas y lo que anclas a favoritos.' },
                    { q: '¿Puedo meter una carpeta dentro de otra?', a: 'No, a propósito: un solo nivel es más fácil de recorrer.' },
                    { q: 'No veo «Nueva carpeta».', a: 'Crear carpetas y mover listas lo hace quien puede administrar listas.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Listas', to: '/lists' },
                    { label: 'Ajustes de una lista', article: 'listas-y-campos-ajustes' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'primeros-pasos-atajos',
        route: '/settings?s=apariencia',
        related: ['primeros-pasos-buscar', 'primeros-pasos-moverte'],
        blocks: [
            {
                t: 'p',
                md: 'Si usas la app varias horas al día, los **atajos de teclado** te ahorran cientos de clics. Aprieta **?** en cualquier pantalla para ver la lista completa. Los atajos de una sola tecla no funcionan mientras escribes en un campo, así no se disparan por accidente.',
            },
            { t: 'anim', key: 'pp-atajos', caption: '«g» y después «t» lleva a Mi trabajo; «?» muestra todos los atajos.' },
            { t: 'h', text: 'Atajos generales' },
            {
                t: 'keys',
                items: [
                    { keys: ['Ctrl', 'K'], what: 'Buscar y abrir cualquier cosa (en Mac, ⌘ K).' },
                    { keys: ['?'], what: 'Mostrar la lista de atajos.' },
                    { keys: ['g', 'l'], what: 'Ir a Listas (aprieta «g», suelta, y después «l»).' },
                    { keys: ['g', 't'], what: 'Ir a Mi trabajo.' },
                    { keys: ['g', 'f'], what: 'Ir a Favoritos.' },
                    { keys: ['g', 'd'], what: 'Ir a Dashboards (tableros).' },
                    { keys: ['g', 's'], what: 'Ir a Ajustes.' },
                    { keys: ['Esc'], what: 'Cerrar un panel o un diálogo.' },
                    { keys: ['J', 'K'], what: 'En la ficha de un registro: el siguiente o el anterior.' },
                ],
            },
            { t: 'demo', key: 'pp-atajos', caption: 'La tecla ? muestra todos los atajos.', fallback: 'pp-atajos' },
            { t: 'h', text: 'En la tabla' },
            {
                t: 'keys',
                items: [
                    { keys: ['Clic'], what: 'Elegir una celda.' },
                    { keys: ['Enter'], what: 'Editar la celda (o doble clic, o empezar a escribir).' },
                    { keys: ['Mayús', 'Clic'], what: 'Elegir un rango (o arrastrar, o Mayús + flechas).' },
                    { keys: ['Ctrl', 'C'], what: 'Copiar (también Ctrl X para cortar y Ctrl V para pegar, incluso desde Excel o Sheets).' },
                    { keys: ['Ctrl', 'D'], what: 'Rellenar hacia abajo.' },
                    { keys: ['Supr'], what: 'Borrar el contenido de las celdas elegidas.' },
                    { keys: ['Ctrl', 'Z'], what: 'Deshacer (Ctrl Y rehace).' },
                    { keys: ['Clic derecho'], what: 'Todas las acciones de la celda.' },
                ],
            },
            { t: 'h', text: 'En el calendario' },
            {
                t: 'keys',
                items: [
                    { keys: ['M', 'S', 'D', 'A'], what: 'Ver mes, semana, día o agenda.' },
                    { keys: ['H'], what: 'Volver a hoy.' },
                    { keys: ['←', '→'], what: 'Período anterior o siguiente.' },
                ],
            },
            { t: 'h', text: 'Modo claro, oscuro o el del sistema' },
            {
                t: 'p',
                md: 'El botón de **sol/luna** de la barra superior cambia entre claro y oscuro al instante (en el celular está en **Más → Apariencia**). Para elegir con más detalle, ve a **Ajustes → Cuenta → Apariencia**:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Claro', what: 'La interfaz de siempre.', tip: 'Para oficinas con mucha luz.' },
                    { name: 'Oscuro', what: 'Superficies oscuras, menos brillo.', tip: 'Cómodo de noche o si pasas muchas horas frente a la pantalla.' },
                    { name: 'Seguir al sistema', what: 'Usa el modo de tu dispositivo y cambia solo cuando el sistema cambia.', tip: 'Ideal si tu teléfono pasa a oscuro al atardecer.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'La apariencia es **por dispositivo**: puedes tener el computador de la oficina en claro y el celular en oscuro. El portal de tus clientes y las páginas públicas siempre se ven en claro, con los colores que diseñó tu empresa.',
            },
            {
                t: 'example',
                title: 'Una contadora que carga facturas',
                md: 'Abre la lista con **g l**, se para en la primera celda, pega con **Ctrl V** las 40 filas que copió de Excel, revisa y corrige con **Enter**, y si se equivoca vuelve atrás con **Ctrl Z**. Sin tocar el mouse.',
            },
            { t: 'h', text: 'Por dónde empezar' },
            {
                t: 'p',
                md: 'No hace falta aprenderlos todos. Empieza por tres: **Ctrl K** para buscar, **g** y una letra para saltar de sección y **?** para ver la lista completa cuando te olvides de alguno. Cuando estés cómodo, suma los de la tabla (moverte con las flechas, Enter para editar, Ctrl C y Ctrl V para copiar y pegar como en una hoja de cálculo).',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Aprieto «g» y «t» y no pasa nada.', a: 'Asegúrate de no tener el cursor en un campo de texto y de apretar la segunda tecla dentro de un segundo.' },
                    { q: '¿Funcionan en Mac?', a: 'Sí. Donde dice Ctrl, en Mac usa ⌘ (Command).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Elegir la apariencia', to: '/settings?s=apariencia' },
                    { label: 'Ver el recorrido de búsqueda y atajos', tour: 'search-and-shortcuts' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'primeros-pasos-ayuda',
        route: '/aprende',
        related: ['primeros-pasos-empezar', 'primeros-pasos-buscar', 'mi-dia-campana'],
        blocks: [
            {
                t: 'p',
                md: 'La app trae varias formas de aprender sin salir de ella. Este **centro de aprendizaje** tiene las guías completas; el **panel de Ayuda** responde rápido lo que estás haciendo; los **recorridos** te muestran la pantalla paso a paso; y **Novedades** te cuenta lo que llegó nuevo.',
            },
            { t: 'anim', key: 'pp-ayuda', caption: 'El panel de Ayuda y un recorrido que ilumina cada parte de la pantalla.' },
            { t: 'h', text: 'El centro de aprendizaje' },
            {
                t: 'p',
                md: 'Está en el riel, en **Aprende**. Tiene un módulo por cada parte de la app, con guías largas, animaciones y capturas reales paso a paso. Usa el buscador de arriba («enviar WhatsApp», «permisos», «importar Excel») y avanza a tu ritmo: cada guía que lees hasta el final queda marcada con un ✓ y arriba ves cuántas llevas. Cada guía termina con botones para ir directo a la pantalla de la que habla.',
            },
            { t: 'h', text: 'El panel de Ayuda' },
            {
                t: 'p',
                md: 'El botón **?** de la barra superior (en el celular, en **Más → Centro de ayuda**) abre un panel a la derecha, sin salir de donde estás:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Buscador', what: '«¿Qué quieres hacer? Ej.: importar un Excel». Encuentra guías rápidas por palabras.' },
                    { name: 'Centro de aprendizaje', what: 'Acceso a las guías completas.' },
                    { name: 'En esta pantalla', what: 'Las guías que tienen que ver con lo que estás viendo ahora.', tip: 'Ábrelo cuando no sepas qué hace algo de la pantalla actual.' },
                    { name: 'Empieza aquí', what: 'El **Recorrido por la app**, **Primeros pasos**, **Atajos de teclado** y **Novedades**.' },
                    { name: 'Guías por tema', what: 'Categorías con guías cortas «¿Cómo hago…?» y los **Recorridos guiados**.', tip: 'Las que dicen «Lo hace un administrador» son de tareas que tu rol no hace, para que sepas a quién pedírselas.' },
                    { name: '¿Necesitas más ayuda?', what: 'El contacto de soporte (correo, WhatsApp o centro de ayuda), si quien opera la plataforma lo configuró.' },
                ],
            },
            { t: 'demo', key: 'pp-ayuda', caption: 'Abrir el panel de Ayuda desde la barra superior.', fallback: 'pp-ayuda' },
            { t: 'h', text: 'Los recorridos guiados' },
            {
                t: 'p',
                md: 'Un recorrido oscurece la pantalla e ilumina una parte por vez, con un globo que explica qué es («3 de 13»). Avanzas con **Siguiente** o las flechas, vuelves con **Anterior** y cortas con **Saltar recorrido** o Escape. Algunos pasos te piden que hagas clic en algo; si prefieres, toca **Hacerlo por mí**. Hay recorridos de listas y registros, crear una lista, importar, vistas, la ficha, invitar al equipo, automatizaciones, tableros, formularios, portal, marca, instalar la app, búsqueda y el asistente.',
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'La primera vez que entras a una empresa te ofrecemos **«¿Te muestro la app en 2 minutos?»**. Si dijiste «Ahora no», lo encuentras en Ayuda → **Recorrido por la app**.',
            },
            { t: 'h', text: 'Novedades' },
            {
                t: 'p',
                md: 'El **megáfono** de la barra superior muestra un número cuando hay novedades sin ver. Ábrelo para ver lo nuevo por mes, con **Ver más** y **Pruébalo** (te lleva a la función o arranca su recorrido). La página completa está en **Novedades**, con filtro por tipo: **Nueva función**, **Mejora**, **Corrección** y **Aviso**. A veces una novedad importante aparece sola en una ventana una vez, y los avisos de la plataforma (un mantenimiento, por ejemplo) se muestran en una franja hasta que los cierras.',
            },
            { t: 'h', text: 'El asistente IA' },
            {
                t: 'p',
                md: 'El botón **✨** abre el asistente: le preguntas en tus palabras («¿cuántas facturas vencen esta semana?») o le pides que arme algo («crea una lista de proveedores con NIT y días de entrega»). Siempre te muestra una **propuesta** y no cambia nada hasta que tocas **Aplicar**.',
            },
            {
                t: 'example',
                title: 'Una persona nueva en el equipo',
                md: 'El primer día hace el **Recorrido por la app** (2 minutos), completa sus **Primeros pasos** (deja un comentario, mira Mi trabajo, ancla su vista) y guarda en favoritos este centro. Cuando se traba con algo, abre **?** y mira **En esta pantalla**.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo el contacto de soporte.', a: 'Aparece sólo si quien opera la plataforma lo configuró. Si no, consulta a quien administra tu empresa.' },
                    { q: '¿Puedo repetir un recorrido?', a: 'Sí, todas las veces que quieras, desde Ayuda → Guías por tema → Recorridos guiados.' },
                    { q: '¿Las guías dependen de mi rol?', a: 'Puedes leerlas todas. Las de tareas que hace un administrador lo indican, para que sepas qué pedir.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Hacer el recorrido por la app', tour: 'welcome' },
                    { label: 'Ver las novedades', to: '/novedades' },
                    { label: 'Usar el asistente', tour: 'assistant' },
                ],
            },
        ],
    },
];
