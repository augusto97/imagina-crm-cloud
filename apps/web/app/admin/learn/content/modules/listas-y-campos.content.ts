import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-crear',
        route: '/lists',
        related: ['listas-y-campos-ajustes', 'listas-y-campos-administrar', 'listas-y-campos-texto-numeros', 'primeros-pasos-empezar'],
        blocks: [
            {
                t: 'p',
                md: 'Una **lista** es una tabla para una cosa que manejas: clientes, oportunidades, facturas, tareas, productos, citas. Cada lista tiene sus **campos** (las columnas: nombre, teléfono, estado, valor…) y sus **registros** (las filas: cada cliente, cada factura). Casi todo lo demás —vistas, tableros, automatizaciones, formularios, el portal— se arma encima de las listas, así que vale la pena empezar bien.',
            },
            { t: 'anim', key: 'lc-nueva-lista', caption: 'Desde «Nueva lista» se elige la plantilla Facturación y aparecen dos listas vinculadas, listas para usar.' },
            { t: 'h', text: 'Dónde se crea' },
            {
                t: 'p',
                md: 'Hay dos puertas: el botón **Nueva lista** de la página **Listas** (el ícono de lista del riel) y el **+** junto a «Espacio de trabajo» en el panel lateral. Si tu empresa todavía no tiene ninguna lista, la app te recibe con **«Armemos tu espacio»**, donde además puedes describir tu negocio y dejar que la IA te proponga las listas. Crear listas lo hace un administrador; si no ves el botón, pídeselo a quien administra la empresa.',
            },
            { t: 'h', text: 'Las tres formas de crear una lista' },
            {
                t: 'cards',
                items: [
                    { icon: 'LayoutTemplate', title: 'Plantilla', md: 'La opción recomendada. Nace con los campos, las vistas (tabla, kanban, calendario), las automatizaciones y a veces un tablero, ya pensados para ese caso. Algunas plantillas traen **dos listas vinculadas** (por ejemplo Clientes y Facturas).', tone: 'violet' },
                    { icon: 'FileText', title: 'En blanco', md: 'Sólo le pones nombre y, si quieres, una descripción. Los campos los agregas después, uno por uno. Ideal cuando tu caso es muy particular.', tone: 'blue' },
                    { icon: 'Copy', title: 'Duplicar', md: 'Copia una lista que ya tienes, con sus campos y, si eliges, sus vistas, automatizaciones, ajustes y hasta 500 registros.', tone: 'mint' },
                ],
            },
            { t: 'demo', key: 'lc-crear', caption: 'El diálogo «Nueva lista» con sus tres pestañas: Plantilla, En blanco y Duplicar.', fallback: 'lc-nueva-lista' },
            { t: 'h', text: 'Crear desde una plantilla, paso a paso' },
            {
                t: 'steps',
                items: [
                    'Toca **Nueva lista**. Se abre en la pestaña **Plantilla**.',
                    'Busca por nombre en **Buscar plantillas** o filtra por categoría: **Ventas**, **Clientes**, **Proyectos**, **Operaciones**, **Finanzas**, **Personas** u **Otros**. En **Mis plantillas** están las que guardó tu empresa.',
                    'Toca una tarjeta. A la derecha ves qué trae: los **campos** con su ícono de tipo, las **vistas**, las **automatizaciones** y si incluye un **tablero**.',
                    'Escribe el **Nombre de la lista** (puedes dejar el que trae) y decide si marcas **Incluir los registros de ejemplo**.',
                    'Toca **Usar plantilla**. En segundos la lista aparece en el panel, lista para cargar datos.',
                ],
            },
            {
                t: 'settings',
                title: 'Algunas plantillas de la galería',
                rows: [
                    { name: 'CRM de clientes', what: 'Contactos y empresas con estado, responsable y seguimiento.', tip: 'La base de casi cualquier negocio de servicios.' },
                    { name: 'Pipeline de ventas', what: 'Oportunidades por etapa con monto, probabilidad y fecha de cierre, con kanban y tablero.' },
                    { name: 'Facturación', what: 'Dos listas: Clientes y Facturas, vinculadas, con saldo pendiente por cliente y aviso al vencer.' },
                    { name: 'Proyectos y tareas', what: 'Tareas con estado, prioridad, responsable y fecha límite, con kanban y subtareas.' },
                    { name: 'Mesa de ayuda / Tickets', what: 'Solicitudes de clientes con prioridad, estado y tiempos de respuesta.' },
                    { name: 'Inventario', what: 'Productos con SKU, existencias y alerta de stock bajo.' },
                    { name: 'Agenda de citas', what: 'Citas con clientes, lista para conectar una página de reservas.' },
                    { name: 'Y muchas más', what: 'Reclutamiento, eventos e invitados, control de gastos, contratos, inmobiliaria, activos, proveedores y compras, objetivos (OKR), contactos por WhatsApp…' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Los registros de ejemplo se quitan fácil',
                md: 'Si marcas **Incluir los registros de ejemplo**, la lista arranca con datos inventados para que veas cómo se usa. Cuando quieras empezar en serio, selecciónalos todos en la tabla y elimínalos: van a la papelera y la lista queda lista para tus datos.',
            },
            { t: 'h', text: 'Crear en blanco' },
            {
                t: 'p',
                md: 'En la pestaña **En blanco** escribes el **Nombre** (por ejemplo «Proveedores») y, opcionalmente, una **Descripción** para que el equipo sepa para qué sirve. Al tocar **Crear lista** se abre vacía: el siguiente paso es agregar sus campos (lo explicamos en «Agregar, ordenar y administrar campos»). Si tienes los datos en Excel, también puedes crear la lista y **importar** el archivo: el importador crea los campos solo, a partir de las columnas.',
            },
            { t: 'h', text: 'Duplicar una lista' },
            {
                t: 'p',
                md: 'En la pestaña **Duplicar** eliges la **Lista a duplicar**, le pones **Nombre de la copia** y decides qué incluir: **Vistas guardadas**, **Automatizaciones** (los enlaces de webhooks entrantes se renuevan), **Ajustes** (permisos, apariencia y plantillas de ficha; la publicación pública no se copia) y **Registros** (hasta 500; los archivos adjuntos no se copian). Sirve, por ejemplo, para abrir una lista igual a la de Bogotá para la sede de Medellín.',
            },
            {
                t: 'example',
                title: 'Un taller de mecánica',
                md: 'Empieza con la plantilla **CRM de clientes** para sus clientes y crea en blanco una lista «Vehículos» con placa, marca, modelo y kilometraje. Después conecta las dos con un campo de relación, así cada vehículo sabe de quién es y cada cliente muestra sus vehículos.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cuántas listas puedo tener?', a: 'No hay un límite de listas: el plan limita la cantidad de registros, no de listas. Lo recomendable es una lista por cada «cosa» distinta que manejas, y relacionarlas entre sí.' },
                    { q: '¿Puedo cambiar después lo que trajo la plantilla?', a: 'Sí, todo: renombrar, agregar o quitar campos, vistas y automatizaciones. La plantilla es sólo un punto de partida.' },
                    { q: '¿Puedo guardar mi lista como plantilla?', a: 'Sí, desde la configuración de la lista, en **General → Guardar como plantilla**. Queda en **Mis plantillas** para toda la empresa.' },
                    { q: '¿Las listas se pueden ordenar en carpetas?', a: 'Sí. En el panel lateral puedes crear carpetas y arrastrar las listas dentro.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Crear una lista ahora', to: '/lists' },
                    { label: 'Ver el recorrido «Crear una lista»', tour: 'create-list' },
                    { label: 'Siguiente: los ajustes de una lista', article: 'listas-y-campos-ajustes' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-ajustes',
        route: '/lists',
        related: ['listas-y-campos-crear', 'listas-y-campos-administrar', 'listas-y-campos-reglas'],
        blocks: [
            {
                t: 'p',
                md: 'Cada lista tiene su **configuración**. Se abre desde la lista con **Configurar lista** (arriba a la derecha) o desde el menú «…» de la lista en el panel lateral. Arriba ves una tira de pestañas; cada una ordena un tema y guarda lo suyo.',
            },
            { t: 'anim', key: 'lc-ajustes', caption: 'En «General» se cambia el ícono por un recibo y el color a verde; el cambio se ve también en el menú.' },
            { t: 'h', text: 'Las pestañas de la configuración' },
            {
                t: 'settings',
                rows: [
                    { name: 'Campos', what: 'El administrador de campos: crear, editar, ordenar y borrar las columnas de la lista.', tip: 'Es la pestaña que más vas a usar.' },
                    { name: 'General', what: 'Nombre, ícono y color, dirección web y descripción. También duplicar la lista, guardarla como plantilla y eliminarla.' },
                    { name: 'Apariencia', what: 'Cómo se ve la ficha de cada registro: **Ficha simple** (todos los campos, uno debajo del otro) o **Ficha diseñada** (portada, etapas, pestañas y gráficos).' },
                    { name: 'Permisos', what: 'Quién ve y quién edita los registros de esta lista, por rol, por equipo o por persona.' },
                    { name: 'Compartir', what: 'El portal del cliente y la publicación de la lista con un enlace público.' },
                    { name: 'Documentos', what: 'Plantillas de PDF (cotizaciones, cuentas de cobro) que se generan desde los registros.' },
                    { name: 'Formularios', what: 'Formularios públicos que crean registros en esta lista.' },
                    { name: 'Más pestañas', what: 'Según tu plan y lo que uses: **Agenda**, **Aprobaciones**, **Plantillas** de registro, **Correo entrante** y **SLA**.' },
                ],
            },
            { t: 'demo', key: 'lc-ajustes', caption: 'Las pestañas General, Apariencia y Permisos de una lista.', fallback: 'lc-ajustes' },
            { t: 'h', text: 'La pestaña General' },
            {
                t: 'settings',
                rows: [
                    { name: 'Nombre', what: 'El nombre que se ve en el menú lateral, en las búsquedas y en los tableros.', tip: 'Usa un nombre en plural y corto: «Clientes», «Facturas».' },
                    { name: 'Icono', what: 'Toca **Cambiar icono**: eliges un color y un ícono de un catálogo de más de 300, con buscador. Se ve junto al nombre en el menú.' },
                    { name: 'Dirección web', what: 'La parte final de la dirección de la lista en el navegador. Se completa sola a partir del nombre.', tip: 'Si la cambias, los enlaces viejos siguen funcionando.' },
                    { name: 'Descripción', what: 'Para qué sirve esta lista. Opcional, pero ayuda a quien llega nuevo al equipo.' },
                    { name: 'Duplicar o guardar como plantilla', what: '**Duplicar lista** crea una copia; **Guardar como plantilla** la deja en la galería de «Nueva lista» para toda la empresa.' },
                    { name: 'Eliminar esta lista', what: 'La manda a la **papelera** con todo lo que tiene adentro. Durante 30 días se puede restaurar tal cual.', tip: 'Antes de borrar, exporta los registros si quieres un respaldo propio.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Cada pestaña guarda lo suyo',
                md: 'En **General**, los cambios se aplican al tocar **Guardar cambios**. En **Campos**, cada campo se guarda al crearlo o editarlo. No hay un botón que guarde todas las pestañas a la vez: termina lo de una pestaña antes de pasar a la siguiente.',
            },
            { t: 'h', text: 'Ideas' },
            {
                t: 'example',
                title: 'Colores que ayudan a ubicarse',
                md: 'Una distribuidora usa azul para todo lo comercial (Clientes, Oportunidades), verde para lo financiero (Facturas, Pagos) y naranja para la operación (Pedidos, Inventario). Con un vistazo al menú, cada persona encuentra su lista.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo «Configurar lista».', a: 'La configuración la ve quien administra listas (normalmente el administrador de la empresa). Si necesitas un cambio, pídeselo a esa persona.' },
                    { q: '¿Qué pasa con las automatizaciones y tableros si renombro la lista?', a: 'Nada: todo apunta a la lista, no a su nombre. Puedes renombrar con tranquilidad.' },
                    { q: 'Borré una lista por error.', a: 'Ve a **Ajustes → Papelera** y restáurala. Vuelve con sus registros, campos, vistas y automatizaciones, siempre que no hayan pasado 30 días.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Administrar los campos', article: 'listas-y-campos-administrar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-administrar',
        route: '/lists',
        related: ['listas-y-campos-texto-numeros', 'listas-y-campos-reglas', 'listas-y-campos-ajustes', 'mi-dia-escaner'],
        blocks: [
            {
                t: 'p',
                md: 'Los **campos** son las columnas de una lista: cada uno guarda un tipo de dato (texto, número, fecha, una opción de una lista, una persona…). Elegir bien el tipo es lo que hace que después puedas filtrar, ordenar, sumar y automatizar sin problemas: un valor guardado como **Moneda** se puede sumar en el pie de la tabla; escrito en un campo de texto, no.',
            },
            { t: 'anim', key: 'lc-agregar-campo', caption: 'Con el «+» de la tabla se crea un campo Selección llamado Estado, con sus opciones de color.' },
            { t: 'h', text: 'Agregar un campo desde la tabla' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y toca el botón redondo **+** que está a la derecha de los títulos de las columnas (**Agregar columna**).',
                    'Se abre el panel **Campos**. Arriba, en **Populares**, están los tipos más usados; abajo, en **Todos**, el catálogo completo. Puedes buscar con **Buscar campos**.',
                    'Toca el tipo. Escribe el **Nombre** y completa lo que pida ese tipo (por ejemplo, las opciones de una selección o la moneda).',
                    'Opcional: marca **Obligatorio**, define un **Valor por defecto** o una **Validación**.',
                    'Toca **Crear campo**. La columna aparece en la tabla al instante.',
                ],
            },
            { t: 'demo', key: 'lc-agregar-campo', caption: 'El panel Campos: tipos populares, todos los tipos y el formulario de una Selección.', fallback: 'lc-agregar-campo' },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Reusa un campo que ya armaste',
                md: 'En el panel **Campos**, la pestaña **Copiar de otra lista** copia un campo de otra lista con su tipo, su configuración y sus opciones. Ideal para que «Ciudad» o «Estado» tengan las mismas opciones en todas partes.',
            },
            { t: 'h', text: 'El administrador de campos' },
            {
                t: 'p',
                md: 'En la configuración de la lista, la pestaña **Campos** muestra todos los campos agrupados por tipo. A la izquierda filtras **Todos los campos**, **Por tipo** o saltas a **Otras listas**; arriba, **Buscar un campo…** y **Nuevo campo**. Al tocar un campo se abren todos sus ajustes. Cada campo muestra insignias como **Título**, **Obligatorio**, **Sin repetidos** o **Código**.',
            },
            { t: 'demo', key: 'lc-campos', caption: 'El administrador de campos de la lista Clientes y los ajustes de un campo.', fallback: 'lc-agregar-campo' },
            {
                t: 'settings',
                title: 'Lo que puedes hacer con un campo (menú «…»)',
                rows: [
                    { name: 'Modificar', what: 'Abre todos sus ajustes: nombre, descripción, tipo, configuración, reglas y quién lo ve.' },
                    { name: 'Cambiar el nombre', what: 'Renombrarlo no rompe nada: las vistas, fórmulas, filtros y automatizaciones siguen funcionando.' },
                    { name: 'Usar como título', what: 'Ese campo pasa a ser el nombre de cada registro (lo que se ve en la ficha, en los enlaces y en las búsquedas). Sólo campos de texto.', tip: 'En una lista de clientes, «Razón social»; en tareas, «Tarea».' },
                    { name: 'Usar como código para escanear', what: 'El campo que busca la cámara del escáner (SKU, serial, número de boleta).' },
                    { name: 'Duplicar', what: 'Crea un campo igual, con su configuración, para ajustar sólo lo distinto.' },
                    { name: 'Eliminar de esta lista', what: 'Lo manda a la **papelera** con sus valores. Durante 30 días se puede restaurar.', tip: 'Si sólo quieres que no se vea, oculta la columna en la vista en lugar de borrarla.' },
                ],
            },
            { t: 'h', text: 'Ordenar los campos' },
            {
                t: 'p',
                md: 'En el administrador, **arrastra** un campo por su manija para cambiar el orden en que aparece en la ficha y en el alta de registros. El orden de las columnas en la tabla es de cada vista: allí puedes arrastrar los títulos o usar **Mover al inicio** y **Mover al final** desde el menú de la columna.',
            },
            { t: 'h', text: 'Cambiar el tipo de un campo' },
            {
                t: 'p',
                md: 'En los ajustes del campo, en **Tipo y nombre interno**, eliges otro tipo. La lista te avisa en cada opción si la conversión es **segura** o tiene **posible pérdida** de datos: pasar de texto a texto largo es seguro; de texto a número, lo que no sea un número queda vacío. Al convertir a **Selección**, las opciones se crean solas a partir de los valores que ya había. Los campos **Relación**, **Archivo** y los calculados no se pueden convertir.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Antes de una conversión con pérdida',
                md: 'Exporta la lista a Excel como respaldo. Si algo sale mal, puedes volver a cargar los valores con **Actualizar desde un archivo**.',
            },
            {
                t: 'example',
                title: 'Un consultorio odontológico',
                md: 'En «Pacientes» tenían «Plan» como texto libre y cada persona lo ponía distinto («Prepagada», «prepagada», «Medicina prepagada»). Convirtieron el campo a **Selección**: la app creó una opción por cada valor distinto, las unificaron en tres y ahora el tablero cuenta pacientes por plan sin errores.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué es el «nombre interno»?', a: 'Es cómo se llama el campo para las variables de automatizaciones y para las integraciones. Se completa solo; normalmente no hace falta tocarlo.' },
                    { q: '¿Un campo puede estar en dos listas a la vez?', a: 'No: cada campo es de una lista. Para mostrar datos de otra lista usa un campo de **Relación** y, si quieres, **Buscar en relación**.' },
                    { q: '¿Quién puede crear o cambiar campos?', a: 'Quien tiene permiso para administrar campos (normalmente el administrador de la empresa). El resto del equipo carga datos en los campos que ya existen.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Conocer los tipos de campo', article: 'listas-y-campos-texto-numeros' },
                    { label: 'Reglas: obligatorio y validaciones', article: 'listas-y-campos-reglas' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-texto-numeros',
        route: '/lists',
        related: ['listas-y-campos-fechas-personas', 'listas-y-campos-relaciones', 'listas-y-campos-formulas', 'listas-y-campos-administrar'],
        blocks: [
            {
                t: 'p',
                md: 'Cada tipo de campo guarda el dato a su manera y lo muestra como corresponde: la moneda con su símbolo y separadores, el teléfono con la bandera del país, la selección con chips de color. Aquí van los tipos «de todos los días»; en los artículos siguientes, fechas y personas, relaciones, fórmulas y los especiales.',
            },
            { t: 'anim', key: 'lc-tipos', caption: 'La ficha de un cliente con un campo de cada tipo.' },
            { t: 'h', text: 'Texto' },
            {
                t: 'settings',
                rows: [
                    { name: 'Texto', what: 'Una línea corta: nombre, razón social, NIT, ciudad, referencia.', tip: 'Es el único tipo (junto con Texto largo) que puede ser el **título** del registro.' },
                    { name: 'Texto largo', what: 'Párrafos sin límite: notas, observaciones, dirección completa.', tip: 'Para un documento con formato (títulos, listas, imágenes) usa la **descripción** de la ficha, no un campo.' },
                    { name: 'Email', what: 'Un correo electrónico; se revisa que tenga forma de correo y se puede usar para enviar correos desde automatizaciones.' },
                    { name: 'URL', what: 'Un enlace a una página. En **Mostrar como** eliges **Enlace** o **Imagen (miniatura)**: con «Imagen», la dirección de una foto (.jpg, .png, .webp) se ve como miniatura en la tabla y en la ficha.' },
                    { name: 'Teléfono', what: 'Un número con su indicativo de país y bandera. En **País por defecto** eliges qué país se asume cuando alguien escribe un número sin indicativo.', tip: 'Se guarda con el +57 completo, listo para WhatsApp y llamadas.' },
                ],
            },
            { t: 'h', text: 'Números' },
            {
                t: 'settings',
                rows: [
                    { name: 'Número', what: 'Cantidades, edades, unidades. En **Precisión decimal** eliges entero, 1, 2 o 4 decimales.' },
                    { name: 'Moneda', what: 'Dinero. En **Moneda** escribes el código de tres letras (COP, USD, MXN, PEN) y en **Decimales** cuántos mostrar.', tip: 'Los pesos colombianos suelen ir con 0 decimales.' },
                    { name: 'Porcentaje', what: 'De 0 a 100. Con **Mostrar barra de avance** se ve una barrita además del número.', tip: 'Perfecto para el avance de un proyecto.' },
                    { name: 'Duración', what: 'Un tiempo: se escribe de cualquier forma (90, 1:30, 1h 30m) y siempre se guarda en minutos. Eliges el **Formato** en que se muestra.' },
                    { name: 'Calificación', what: 'De 1 a 10 íconos (**Cantidad**) con forma de **Estrella**, **Corazón** o **Llama**. Se califica con un clic.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Separadores de miles y decimales',
                md: 'Cómo se ven los números (1.250.000 o 1,250,000) depende del **Formato regional** de la empresa, en **Ajustes**. Se puede escribir con puntos o comas: la app lo entiende.',
            },
            { t: 'h', text: 'Opciones' },
            {
                t: 'settings',
                rows: [
                    { name: 'Casilla', what: 'Sí o no: «Pagado», «Activo», «Firmó contrato». Se marca con un clic.' },
                    { name: 'Selección', what: 'UNA opción de una lista que tú defines, con su color: estado, prioridad, etapa, ciudad.', tip: 'Es el tipo ideal para agrupar en kanban y contar en tableros.' },
                    { name: 'Selección múltiple', what: 'VARIAS opciones a la vez: etiquetas, servicios contratados, intereses.' },
                ],
            },
            {
                t: 'steps',
                items: [
                    'En **Opciones**, escribe la **Etiqueta** que se ve (por ejemplo «En curso»). El **Valor interno** se completa solo.',
                    'Elige el **Color** (opcional) para que el chip se distinga de lejos.',
                    'Toca **Añadir opción** para la siguiente. Usa las flechas para ordenarlas: ese orden es el de las columnas del kanban y el de las listas desplegables.',
                ],
            },
            {
                t: 'example',
                title: 'Una tienda de ropa',
                md: '«Productos» tiene **Moneda** para precio y costo, **Número** para unidades en bodega, **Selección múltiple** para tallas disponibles, **URL** mostrado como imagen para la foto y **Calificación** para la valoración de las clientas. Con eso arma un kanban por categoría y un tablero que suma el valor del inventario.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Texto o Selección para «Ciudad»?', a: 'Si las ciudades son pocas y se repiten, **Selección**: evitas errores de escritura y puedes agrupar y contar. Si son muchísimas y variadas, **Texto**.' },
                    { q: '¿Puedo cambiar una opción sin perder lo que ya estaba marcado?', a: 'Sí: si cambias la etiqueta, los registros conservan su opción y muestran el nombre nuevo. Antes de borrar una opción, filtra la lista por ella para cambiar los registros que la usan.' },
                    { q: '¿Cómo creo una opción mientras cargo datos?', a: 'Si tienes permiso de administrar campos, en el desplegable de la celda escribe la opción nueva y elige **Crear**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Fechas, personas y archivos', article: 'listas-y-campos-fechas-personas' },
                    { label: 'Relacionar listas', article: 'listas-y-campos-relaciones' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-fechas-personas',
        route: '/lists',
        related: ['listas-y-campos-texto-numeros', 'listas-y-campos-especiales', 'mi-dia-mi-trabajo'],
        blocks: [
            {
                t: 'p',
                md: 'Las fechas y las personas son lo que convierte una lista en trabajo organizado: con una fecha de entrega y un responsable, cada registro aparece en el calendario, en **Mi trabajo** de quien corresponde y en los recordatorios automáticos.',
            },
            { t: 'anim', key: 'lc-fechas-personas', caption: 'Una fecha vencida en rojo se corrige con el calendario y a una tarea sin responsable se le asigna una persona.' },
            { t: 'h', text: 'Fechas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Fecha', what: 'Un día del calendario, sin hora: fecha de entrega, de vencimiento, de nacimiento.', tip: 'Se muestra en el formato de la empresa (por ejemplo 30/10/2026).' },
                    { name: 'Fecha y hora', what: 'Un momento exacto: la hora de una cita o de una llamada. Se muestra en la hora de quien mira, así una reunión entre Bogotá y Madrid se ve bien en los dos lados.' },
                    { name: 'Resaltar vencidas', what: 'Opción de ambos tipos: las fechas anteriores a hoy se muestran en rojo.', tip: 'Actívala en fechas límite, no en fechas de nacimiento.' },
                ],
            },
            {
                t: 'p',
                md: 'Al tocar una celda de fecha se abre el calendario. También puedes escribir la fecha a mano en el formato de la empresa, o usar los atajos (**Hoy**, mañana, la semana que viene). En una fecha se puede activar **Hacer recurrente** para que se repita (cada mes, cada año…).',
            },
            { t: 'h', text: 'Personas y equipos' },
            {
                t: 'settings',
                rows: [
                    { name: 'Usuario', what: 'Una persona de tu equipo: responsable, vendedor, técnico asignado. Se elige de una lista con buscador.', tip: 'Es lo que hace que el registro aparezca en **Mi trabajo** y en la campana de esa persona.' },
                    { name: 'Equipo', what: 'Uno de los equipos de la empresa (Ventas, Soporte). Con **Permitir varios equipos**, un registro puede estar a cargo de más de uno.', tip: 'Los equipos se crean en **Ajustes → Equipos**.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Escribe el nombre, no lo copies en texto',
                md: 'Un campo de texto con «Ana Gómez» no avisa a nadie. Un campo **Usuario** con Ana sí: le llega el aviso, el registro aparece en su trabajo y los permisos de «los asignados» funcionan.',
            },
            { t: 'h', text: 'Archivos' },
            {
                t: 'p',
                md: 'El campo **Archivo** guarda uno o varios archivos por registro: fotos, PDF, contratos firmados, la cédula escaneada. Se suben desde la celda o la ficha, se ven con un visor sin descargarlos (imágenes, PDF, video y texto) y la primera imagen puede ser la portada de la vista de tarjetas. El espacio que ocupan cuenta para el almacenamiento de tu plan.',
            },
            {
                t: 'example',
                title: 'Una constructora',
                md: '«Obras» tiene **Fecha** de inicio y **Fecha** de entrega con **Resaltar vencidas**, un **Usuario** como director de obra, un **Equipo** responsable y un campo **Archivo** con los planos y el acta de entrega. El calendario muestra las entregas del mes y cada director ve sus obras en Mi trabajo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo asignar un registro a varias personas?', a: 'Un campo **Usuario** guarda una persona. Si necesitas varias, crea más de un campo (por ejemplo «Responsable» y «Apoyo») o asigna a un **Equipo**.' },
                    { q: 'No aparece una persona para elegir.', a: 'Sólo se pueden elegir miembros de la empresa. Invítala primero desde **Ajustes → Miembros**.' },
                    { q: '¿Qué pasa con las fechas si alguien está en otro país?', a: 'Las fechas sin hora nunca se corren de día. Las de fecha y hora se muestran en la hora de quien mira.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Mi trabajo', to: '/my-work' },
                    { label: 'Relacionar listas', article: 'listas-y-campos-relaciones' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-relaciones',
        route: '/lists',
        related: ['listas-y-campos-formulas', 'listas-y-campos-texto-numeros', 'listas-y-campos-crear'],
        blocks: [
            {
                t: 'p',
                md: 'En un negocio las cosas están conectadas: un cliente tiene facturas, un proyecto tiene tareas, un pedido tiene productos. En lugar de copiar el nombre del cliente en cada factura, se **vincula**: así, si el cliente cambia de correo, todas sus facturas lo saben, y en la ficha del cliente ves sus facturas y cuánto debe.',
            },
            { t: 'anim', key: 'lc-relacion', caption: 'Una factura nueva se vincula a Café Bahía y su cantidad de facturas y su saldo se actualizan solos.' },
            { t: 'h', text: 'Los tres campos que trabajan juntos' },
            {
                t: 'cards',
                items: [
                    { icon: 'Link2', title: 'Relación', md: 'Vincula cada registro con uno o varios registros de otra lista. En cada factura eliges el cliente.', tone: 'blue' },
                    { icon: 'Search', title: 'Buscar en relación', md: 'Trae un dato del registro vinculado: en la factura, el email o el NIT del cliente. Se actualiza solo.', tone: 'mint' },
                    { icon: 'Calculator', title: 'Resumen de relación', md: 'Cuenta, suma, promedia o saca el mínimo o máximo de los vinculados: en el cliente, cuántas facturas tiene y su saldo.', tone: 'violet' },
                ],
            },
            { t: 'h', text: 'Paso 1: crear la relación' },
            {
                t: 'steps',
                items: [
                    'En la lista **Facturas**, agrega un campo de tipo **Relación** y llámalo «Cliente».',
                    'En **Lista relacionada** elige **Clientes**. El campo permitirá vincular registros de esa lista.',
                    'Toca **Crear campo**. En cada factura, la celda «Cliente» abre un buscador con los clientes; eliges uno y queda como un chip con enlace a su ficha.',
                ],
            },
            {
                t: 'p',
                md: 'La relación sirve en **los dos sentidos**: no hace falta crear otro campo en Clientes. La ficha de cada cliente muestra en «Vinculados» las facturas que apuntan a él, y los campos de resumen pueden contar desde el otro lado.',
            },
            { t: 'h', text: 'Paso 2: traer un dato con «Buscar en relación»' },
            {
                t: 'p',
                md: 'En **Facturas**, crea un campo **Buscar en relación (lookup)**. Elige la **Relación** (Cliente) y el **Campo de Clientes a mostrar** (por ejemplo «Email de facturación»). La columna muestra el email del cliente de cada factura y se lee del cliente en cada consulta: si allá cambia, aquí cambia. No se puede editar desde la factura.',
            },
            { t: 'h', text: 'Paso 3: resumir con «Resumen de relación»' },
            {
                t: 'settings',
                rows: [
                    { name: 'Relación', what: 'Por cuál relación mira. Aparecen las de esta lista y también las de otras listas que apuntan aquí («Facturas que apuntan aquí, por Cliente»).' },
                    { name: 'Operación', what: '**Contar registros**, **Sumar**, **Promediar**, **Mínimo (o fecha más antigua)** o **Máximo (o fecha más reciente)**.' },
                    { name: 'Campo', what: 'Sobre qué campo del otro lado opera (el «Valor» de cada factura, por ejemplo). Para contar no hace falta.' },
                    { name: 'Solo los registros que cumplan…', what: 'Un filtro opcional sobre la otra lista: sumar sólo las facturas en estado «Pendiente» da el **saldo pendiente**.', tip: 'Esta es la magia: un saldo que se calcula solo.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Un resumen se puede filtrar, ordenar y sumar',
                md: 'El resumen se calcula en cada consulta, así que puedes filtrar «Saldo pendiente mayor que 0» para ver quién debe, ordenar de mayor a menor deuda o sumar el total en el pie de la tabla y en un tablero.',
            },
            {
                t: 'example',
                title: 'Una academia de idiomas',
                md: '«Estudiantes» se vincula con «Pagos» y con «Cursos». En cada estudiante, un **Resumen de relación** suma los pagos del año y otro muestra la **fecha más reciente** de pago; un filtro «último pago hace más de 30 días» arma la lista de cobro del mes. En cada pago, **Buscar en relación** trae el teléfono del estudiante para el recordatorio por WhatsApp.',
            },
            {
                t: 'example',
                title: 'Proyectos de una agencia',
                md: '«Proyectos» cuenta sus tareas abiertas (resumen con filtro «Estado no es Hecho») y promedia el avance. El tablero de dirección ordena los proyectos por tareas abiertas para ver dónde hay cuello de botella.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo vincular un registro con varios de la otra lista?', a: 'Sí: un pedido puede tener varios productos. La celda muestra un chip por cada vinculado.' },
                    { q: 'Borré un cliente: ¿qué pasa con sus facturas?', a: 'Las facturas quedan, sin ese vínculo. Si restauras el cliente desde la papelera, el vínculo vuelve.' },
                    { q: 'Al crear el resumen dice que no hay relaciones.', a: 'Primero crea el campo **Relación** (en esta lista o en la que quieres conectar). Después ya aparece para elegir.' },
                    { q: '¿Quién no puede ver la otra lista ve el resumen?', a: 'No: si una persona no tiene acceso completo a la lista vinculada, los campos que traen o resumen sus datos se le ocultan.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Fórmulas y campos calculados', article: 'listas-y-campos-formulas' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-formulas',
        route: '/lists',
        related: ['listas-y-campos-relaciones', 'listas-y-campos-especiales', 'listas-y-campos-texto-numeros'],
        blocks: [
            {
                t: 'p',
                md: 'Un campo **Fórmula** calcula su valor solo, a partir de otros campos del registro, como en una hoja de cálculo pero en español: `SI({Total} > 1000000, "Grande", "Chico")`, `{Precio} * {Cantidad}`, `SUMAR_DIAS_HABILES({Radicado}, 15)`. Nadie lo escribe a mano y se actualiza cada vez que cambian los datos.',
            },
            { t: 'anim', key: 'lc-formula', caption: 'Se escribe una fórmula SI, la vista previa muestra el resultado con un registro real y la columna se llena sola.' },
            { t: 'h', text: 'Crear una fórmula' },
            {
                t: 'steps',
                items: [
                    'Agrega un campo y elige el tipo **Fórmula**. Ponle nombre, por ejemplo «Estado de pago».',
                    'En **Fórmula**, escribe. Al tipear `{` aparece la lista de campos de la lista; al empezar una palabra, las funciones que coinciden.',
                    'Debajo, un mensaje te dice si **la fórmula está bien** y qué tipo de dato da, o en qué parte hay un error.',
                    'En **Vista previa con** eliges un registro real y ves el resultado antes de crear el campo.',
                    'En **Mostrar el resultado como** eliges el formato: automático, número, moneda, porcentaje, duración, texto, fecha, fecha y hora o Sí / No.',
                    'Toca **Crear campo**.',
                ],
            },
            { t: 'demo', key: 'lc-formula', caption: 'Una fórmula sobre el saldo pendiente, con su vista previa.', fallback: 'lc-formula' },
            { t: 'h', text: 'Las funciones más útiles' },
            {
                t: 'settings',
                rows: [
                    { name: 'SI(condición, sí, no)', what: 'Elige un valor según una condición.', tip: '`SI({Saldo pendiente} > 0, "Debe", "Al día")`' },
                    { name: 'Y, O, NO', what: 'Combinan condiciones dentro de un SI.', tip: '`SI(Y({Pagado}, {Entregado}), "Cerrado", "Abierto")`' },
                    { name: 'SUMA, PROMEDIO, MAX, MIN', what: 'Operan sobre varios campos o valores.', tip: '`SUMA({Subtotal}, {IVA}, {Envío})`' },
                    { name: 'REDONDEAR', what: 'Redondea a los decimales que digas.', tip: '`REDONDEAR({Total} * 1.19, -2)` redondea a las centenas' },
                    { name: 'HOY, DIAS_ENTRE', what: 'La fecha de hoy y los días entre dos fechas.', tip: '`DIAS_ENTRE({Fecha de factura}, HOY())` = días de mora' },
                    { name: 'SUMAR_DIAS, SUMAR_MESES', what: 'Corren una fecha.', tip: '`SUMAR_MESES({Inicio}, 12)` = fin del contrato anual' },
                    { name: 'SUMAR_DIAS_HABILES', what: 'Suma días sin contar fines de semana ni festivos de Colombia.', tip: 'Para plazos legales y tiempos de respuesta.' },
                    { name: 'CONCATENAR, MAYUSC, IZQUIERDA', what: 'Unen y transforman textos.', tip: '`CONCATENAR({Nombre}, " ", {Apellido})`' },
                    { name: 'FORMATO_FECHA, TEXTO', what: 'Muestran una fecha o un número como texto con el formato que quieras.' },
                    { name: 'LETRAS, PESOS', what: 'Escriben un número en letras.', tip: '`PESOS({Total})` → «un millón doscientos cincuenta mil pesos»' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'La referencia completa está en el editor',
                md: 'Debajo de la fórmula, **Funciones y campos** despliega todas las funciones con un ejemplo de cada una. Toca una para insertarla.',
            },
            { t: 'h', text: 'Qué se puede hacer con una fórmula' },
            {
                t: 'p',
                md: 'La mayoría de las fórmulas se pueden **filtrar**, **ordenar**, **agrupar** y **sumar** en el pie de la tabla y en los tableros, igual que un campo común. Algunas funciones (como los días hábiles o el formato de fechas) sólo se muestran: el menú de la columna te avisa cuando una fórmula no se puede filtrar. Si renombras un campo que usa la fórmula, la fórmula se actualiza sola.',
            },
            { t: 'h', text: 'El campo Calculado' },
            {
                t: 'p',
                md: 'Antes de las fórmulas existía el tipo **Calculado**, con operaciones fijas: **Diferencia en meses**, **Diferencia en días**, **Suma**, **Producto**, **Resta**, **División**, **Concatenar texto** y **Valor absoluto**. Sigue funcionando y puedes convertirlo en fórmula cuando quieras. Para cualquier cálculo nuevo, conviene usar **Fórmula**: hace lo mismo y mucho más.',
            },
            {
                t: 'example',
                title: 'Una distribuidora',
                md: 'En «Pedidos»: `{Cantidad} * {Precio unitario}` como Subtotal (moneda), `REDONDEAR({Subtotal} * 0.19, 0)` como IVA y `SI({Subtotal} >= 500000, "Envío gratis", "Cobra envío")`. El tablero suma los subtotales del mes por vendedor.',
            },
            {
                t: 'example',
                title: 'Un despacho de abogados',
                md: 'En «Procesos»: `SUMAR_DIAS_HABILES({Fecha de notificación}, 10)` calcula el vencimiento del término, y `SI(DIAS_ENTRE(HOY(), {Vencimiento}) <= 2, "Urgente", "En tiempo")` marca lo que vence pronto.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Mi fórmula muestra «#ERROR».', a: 'Pasa el mouse por la celda para ver el motivo: un campo que se borró, una división por cero o un dato con el tipo equivocado.' },
                    { q: '¿Puedo usar comas o puntos y comas?', a: 'Los argumentos se separan con coma: `SI(condición, sí, no)`. Los decimales se escriben con punto: `0.19`.' },
                    { q: '¿Una fórmula puede usar otra fórmula?', a: 'Sí, siempre que no se forme un círculo (A usa B y B usa A): eso se rechaza al guardar.' },
                    { q: '¿Puedo sumar los valores de otra lista?', a: 'Para eso está el **Resumen de relación**. Luego puedes usar ese resumen dentro de una fórmula.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Relacionar listas', article: 'listas-y-campos-relaciones' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-reglas',
        route: '/lists',
        related: ['listas-y-campos-administrar', 'listas-y-campos-especiales', 'listas-y-campos-ajustes'],
        blocks: [
            {
                t: 'p',
                md: 'Los datos sólo sirven si están completos y bien escritos. Cada campo tiene reglas para lograrlo: que sea **obligatorio**, que **no se repita**, que tenga un **valor por defecto** o que pase una **validación** (un NIT con su dígito de verificación correcto, una placa con el formato de Colombia). Las reglas se revisan desde cualquier lado: la tabla, la ficha, el alta, los formularios, la importación, las automatizaciones y las integraciones.',
            },
            { t: 'anim', key: 'lc-validacion', caption: 'Un NIT con el dígito equivocado se rechaza con el mensaje propio; al corregirlo queda en verde.' },
            { t: 'h', text: 'Dónde se configuran' },
            {
                t: 'p',
                md: 'En la configuración de la lista, pestaña **Campos**, toca el campo. Las reglas están en **Configuración** (valor por defecto y validaciones) y en **Comportamiento** (obligatorio, sin repetidos y título). También se pueden poner al crear el campo.',
            },
            { t: 'demo', key: 'lc-reglas', caption: 'Los ajustes de un campo: valor por defecto, validaciones y comportamiento.', fallback: 'lc-validacion' },
            { t: 'h', text: 'Comportamiento' },
            {
                t: 'settings',
                rows: [
                    { name: 'Obligatorio', what: 'No se puede guardar un registro sin este dato. El campo aparece con un asterisco rojo.', tip: 'Úsalo con medida: demasiados obligatorios hacen lento cargar datos.' },
                    { name: 'Sin repetidos', what: 'Dos registros no pueden tener el mismo valor: NIT, cédula, número de factura, SKU, email.', tip: 'Evita clientes duplicados.' },
                    { name: 'Usar como título del registro', what: 'Este campo nombra cada registro. Sólo campos de texto.' },
                ],
            },
            { t: 'h', text: 'Valor por defecto' },
            {
                t: 'p',
                md: 'Se pone solo al crear un registro sin ese dato: desde el alta, un formulario, la importación, una automatización o una integración. Puede ser un valor fijo (el estado «Nuevo», la ciudad «Bogotá»), **Hoy** o **La fecha y hora en que se crea** en las fechas, o **Asignar a quien crea el registro** en un campo de persona. En el alta aparece ya puesto y se puede cambiar.',
            },
            { t: 'h', text: 'Validaciones' },
            {
                t: 'settings',
                rows: [
                    { name: 'Valor mínimo y máximo', what: 'En números, monedas, porcentajes y duraciones: un descuento entre 0 y 30, una edad mayor que 18.' },
                    { name: 'Fecha mínima y máxima', what: 'Que una fecha esté dentro de un rango.' },
                    { name: 'Largo mínimo y máximo (caracteres)', what: 'En textos: un código de exactamente 6 caracteres, una nota de máximo 200.' },
                    { name: 'Formato', what: '**NIT (con o sin dígito de verificación)**, **NIT con dígito de verificación** (que además lo revisa), **Cédula de ciudadanía**, **Placa de vehículo (Colombia)**, **Sólo números**, **Sólo letras** o **Expresión regular propia** para formatos especiales.' },
                    { name: 'Obligatorio sólo si…', what: 'El campo se exige sólo cuando otro campo **es**, **no es** o **tiene valor**: «Motivo de pérdida» obligatorio sólo si el estado es «Perdido».', tip: 'Así no le pides a nadie un dato que no aplica.' },
                    { name: 'Mensaje si no se cumple (opcional)', what: 'El texto que ve quien escribe un valor que no pasa: «Revisa el NIT: el dígito de verificación no coincide».' },
                    { name: 'Prueba un valor', what: 'Escribe un ejemplo y ves en el momento si cumple o no, antes de guardar la regla.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Los datos viejos no se bloquean',
                md: 'Si agregas una regla a un campo que ya tiene datos, los registros que no la cumplen siguen ahí y se pueden editar en otros campos. La regla se exige cuando alguien cambia ese campo o crea un registro nuevo.',
            },
            { t: 'h', text: 'Descripción y quién lo ve' },
            {
                t: 'settings',
                rows: [
                    { name: 'Descripción', what: 'Una ayuda corta que se muestra debajo del campo en los formularios: «Sin puntos ni dígito de verificación».' },
                    { name: 'Quién lo ve', what: 'Por cada rol, **Lo ve** u **Oculto**. Un campo oculto no se muestra en la tabla, la ficha, los filtros ni las exportaciones de ese rol.', tip: 'Ideal para el costo de un producto o el salario en una lista de personal.' },
                ],
            },
            {
                t: 'example',
                title: 'Una empresa de transporte',
                md: '«Vehículos» tiene la **Placa** con formato de placa de Colombia y **Sin repetidos**, el **SOAT vence** obligatorio, el **Conductor** con valor por defecto «quien crea el registro» y el **Valor del vehículo** oculto para los agentes. Al importar el listado del año pasado, las placas mal escritas aparecen como error de la fila y no entran.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué pasa si importo un archivo con datos que no cumplen?', a: 'Las filas con errores no se importan y el resultado te dice cuál fila y por qué, para que las corrijas y las vuelvas a subir.' },
                    { q: '¿Las reglas aplican a las automatizaciones?', a: 'Sí. Si una automatización intenta poner un valor que no cumple, ese campo se salta y el historial de la automatización lo dice.' },
                    { q: '¿Puedo hacer obligatorio un campo sólo en el formulario público?', a: 'En el formulario cada pregunta puede ser obligatoria por su cuenta, sin afectar el campo de la lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Campos especiales', article: 'listas-y-campos-especiales' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'listas-y-campos-especiales',
        route: '/lists',
        related: ['listas-y-campos-formulas', 'listas-y-campos-reglas', 'listas-y-campos-fechas-personas'],
        blocks: [
            {
                t: 'p',
                md: 'Además de los campos donde escribe el equipo, hay campos que **trabajan solos**: numeran, completan con inteligencia artificial, hacen algo con un clic o muestran datos que la app ya sabe (quién creó el registro, cuánto tiempo se le dedicó).',
            },
            { t: 'anim', key: 'lc-especiales', caption: 'Un ticket nuevo recibe su número solo, la IA lo clasifica y el botón abre WhatsApp con el mensaje escrito.' },
            { t: 'h', text: 'ID automático' },
            {
                t: 'p',
                md: 'Numera cada registro nuevo con un consecutivo propio: `TCK-0001`, `COT-2026-0042`. Nadie lo escribe y nunca se repite, aunque dos personas creen registros al mismo tiempo. Al agregarlo a una lista que ya tiene registros, los numera en el orden en que se crearon.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Prefijo', what: 'Las letras del principio. Se sugiere a partir del nombre de la lista (TCK para Tickets).' },
                    { name: 'Separador', what: 'Lo que va entre el prefijo y el número: guion, barra o nada.' },
                    { name: 'Dígitos', what: 'Cuántos dígitos con ceros a la izquierda: 4 da 0001.' },
                    { name: 'Empieza en', what: 'El número inicial, por ejemplo para seguir la numeración que traías de otro sistema.' },
                    { name: 'Incluir el año y reiniciar la numeración cada año', what: 'Da COT-2026-0001 y vuelve a 0001 el primero de enero.' },
                ],
            },
            { t: 'h', text: 'Campo con IA' },
            {
                t: 'p',
                md: 'Lee otros campos del registro —incluidos los PDF e imágenes de un campo Archivo— y escribe el resultado solo. Se recalcula cuando cambian los campos que lee. Es un texto: se filtra, se ordena y se exporta como cualquier otro.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Qué hace', what: '**Resumir** (una nota larga, un correo), **Clasificar** (elige UNA de las opciones que le des: prioridad, tema, sentimiento), **Extraer un dato** (el NIT de una factura), **Traducir** o **Personalizado** (le escribes qué hacer).' },
                    { name: 'Lee de estos campos', what: 'Los campos que usa como fuente.' },
                    { name: 'Largo de la respuesta', what: '**Corta**, **Media** o **Larga**.' },
                    { name: 'Modelo', what: '**Rápido (recomendado)** o **El del asistente**.' },
                    { name: 'Completar los vacíos / Recalcular todos', what: 'Para los registros que ya existen. Cada cálculo usa un pedido de IA, que cuenta para la cuota del plan si tu empresa usa la clave compartida.' },
                ],
            },
            { t: 'h', text: 'Botón' },
            {
                t: 'p',
                md: 'Un **Botón** no guarda un dato: hace algo al presionarlo, en la tabla o en la ficha. Puede **Abrir un enlace** (WhatsApp con el teléfono y el mensaje armados, llamar, escribir un correo, ver un mapa), **Cambiar campos** (marcar como pagado y poner la fecha de hoy), **Correr una automatización** o **Generar un PDF**. Las acciones van en orden; si una falla, las siguientes no corren. Puedes pedir confirmación antes, elegir **Quién puede presionarlo** y deshabilitarlo cuando el registro cumpla una condición (por ejemplo, «Ya está pagado»).',
            },
            {
                t: 'example',
                title: 'Una clínica estética',
                md: 'En «Citas», un botón **Confirmar por WhatsApp** abre el chat de la paciente con «Hola {{nombre}}, te esperamos el {{fecha}}». Otro botón **Llegó** pone el estado «En atención» y la hora de llegada. El **ID automático** numera cada cita y un **Campo con IA** resume las notas de la valoración en una línea.',
            },
            { t: 'h', text: 'Los datos que la app llena sola' },
            {
                t: 'settings',
                rows: [
                    { name: 'Fecha de creación y Última modificación', what: 'Cuándo se creó y cuándo se cambió por última vez cada registro.' },
                    { name: 'Creado por y Modificado por', what: 'Quién lo creó y quién lo cambió por última vez. Se filtran como cualquier campo de persona.' },
                    { name: 'Tiempo registrado', what: 'Suma el tiempo que el equipo carga en cada registro, con el cronómetro o a mano desde la ficha.' },
                    { name: 'Progreso del checklist', what: 'De 0 a 100: cuánto de los checklists del registro está hecho.' },
                    { name: 'Aprobación', what: 'El estado de la última solicitud de aprobación del registro: pendiente, aprobada o rechazada.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Todos se pueden usar en vistas y tableros',
                md: 'Agrupa un tablero por «Creado por» para ver cuántos registros carga cada vendedor, o filtra «Última modificación hace más de 15 días» para encontrar oportunidades olvidadas.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo cambiar el número de un ID automático?', a: 'No, a propósito: así el consecutivo es confiable. Puedes cambiar el formato y el número inicial para los registros nuevos; los que ya tienen su ID lo conservan.' },
                    { q: '¿El campo con IA funciona sin configurar nada?', a: 'Necesita que el asistente de IA esté habilitado para tu empresa. Si no lo está, el campo te dice qué falta.' },
                    { q: '¿Un botón puede mandar un correo?', a: 'Sí, a través de una automatización con el disparador «Al presionar el botón». Desde el editor del botón puedes crearla.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Fórmulas', article: 'listas-y-campos-formulas' },
                    { label: 'Volver al principio: crear una lista', article: 'listas-y-campos-crear' },
                ],
            },
        ],
    },
];
