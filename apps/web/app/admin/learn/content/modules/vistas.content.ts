import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-que-son',
        route: '/lists',
        related: ['vistas-personalizar', 'vistas-filtros-y-orden', 'vistas-tabla', 'vistas-kanban'],
        blocks: [
            {
                t: 'p',
                md: 'Una **vista** es una forma guardada de mirar una lista. Los registros son siempre los mismos; lo que cambia es **cómo** los ves: qué columnas aparecen, qué filtros se aplican, en qué orden salen y si se ven como tabla, tablero, calendario o línea de tiempo.\n\nPiensa en una lista de **Tareas**. El gerente quiere ver todo; cada persona quiere ver sólo lo suyo; el viernes alguien revisa lo vencido. En lugar de armar el filtro cada vez, guardas tres vistas: **Todo**, **Mis tareas** y **Vencidas**. Cambiar de vista es un clic, y lo que cambias en un registro se ve en todas.',
            },
            { t: 'anim', key: 'vistas-pestanas', caption: 'Las vistas son pestañas arriba de la lista: se crean con «+ Vista», se renombran con doble clic y se reordenan arrastrando.' },
            { t: 'h', text: 'Las pestañas de la lista' },
            {
                t: 'p',
                md: 'Arriba de cada lista hay una fila de pestañas. La primera siempre es **Todos**: muestra todos los registros sin filtros ni orden especial, y no se puede borrar ni cambiar. Las demás son las vistas guardadas de la lista. La que tiene la **estrella** es la **vista por defecto**: la lista se abre en ella.\n\nCada pestaña muestra el ícono de su tipo (tabla, tablero, calendario…) o el ícono y el color que le elijas. Una vista **privada** lleva un candado y una **protegida**, un escudo.',
            },
            { t: 'h', text: 'Crear una vista nueva' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y toca **+ Vista**, al final de las pestañas.',
                    'En **Nombre** escribe algo que diga para qué sirve: «Vencidas esta semana», «Por vendedor», «Entregas».',
                    'Elige el **Tipo de vista**: **Lista (tabla)**, **Hoja de cálculo (estilo Excel)**, **Kanban**, **Calendario**, **Tarjetas**, **Gantt (línea de tiempo)** o **Carga de trabajo (por persona)**.',
                    'Según el tipo, la app te pide el campo que necesita: **Agrupar por** para el Kanban, **Campo de fecha** para el calendario, **Fecha de inicio** y **Fecha de fin** para el Gantt, y **Persona asignada** para la carga de trabajo.',
                    'Si quieres que la lista se abra siempre así, marca **Establecer como vista por defecto**.',
                    'Toca **Guardar vista**. La pestaña aparece y queda elegida.',
                ],
            },
            { t: 'demo', key: 'vistas-crear-vista', caption: 'Crear una vista de tablero desde «+ Vista».', fallback: 'vistas-pestanas' },
            {
                t: 'callout',
                tone: 'info',
                title: 'Algunos tipos necesitan un campo',
                md: 'El **Kanban** necesita al menos un campo de selección (o de persona, o una casilla). El **calendario** y el **Gantt** necesitan un campo de fecha. La **carga de trabajo** necesita un campo **Persona** y uno de fecha. Si la lista no los tiene, la opción aparece deshabilitada con el motivo: crea el campo en **Configurar lista** y vuelve.',
            },
            { t: 'h', text: 'Guardar o descartar los cambios' },
            {
                t: 'p',
                md: 'Cuando estás en una vista y cambias un filtro, el orden, una columna o la agrupación, la app no lo guarda sola: junto a las pestañas aparece **Cambios sin guardar** con tres botones.\n\n- **Guardar**: reemplaza la vista con lo que estás viendo.\n- **Descartar**: vuelve a como estaba guardada.\n- **Guardar como vista…**: deja la vista original como estaba y crea otra nueva con estos ajustes.\n\nSi en la pestaña **Todos** armas un filtro, lo único que puedes hacer es **Guardar como vista…**: así nace una vista nueva sin tocar la vista neutra.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Guardar automáticamente',
                md: 'Si una vista la usas sólo tú y siempre quieres que recuerde lo último, enciende **Guardar automáticamente** en su menú. Los cambios de filtros, orden y columnas se guardan solos un instante después de hacerlos.',
            },
            { t: 'h', text: 'El menú de cada pestaña' },
            {
                t: 'p',
                md: 'Pasa el mouse por una pestaña y toca **···**, o haz **clic derecho** sobre ella. En el celular, mantenla presionada. Desde ahí haces todo lo que se puede con una vista. Para cambiarle el nombre más rápido, haz **doble clic** sobre él, escribe y pulsa Enter (Escape cancela).',
            },
            {
                t: 'settings',
                title: 'Opciones del menú de una vista',
                rows: [
                    { name: 'Marcar como favorito', what: 'La vista aparece en **Favoritos** (en el menú de la izquierda) y abre la lista directamente en ella.', tip: 'Ideal para la vista que revisas todos los días, como «Mis pendientes».' },
                    { name: 'Cambiar el nombre', what: 'Pone el nombre en modo edición. También funciona con doble clic sobre la pestaña.' },
                    { name: 'Copiar vínculo a la vista', what: 'Copia un enlace que abre la lista justo en esa vista.', tip: 'Pégalo en un chat del equipo: quien tenga permiso sobre la lista llega directo.' },
                    { name: 'Personalizar vista', what: 'Abre el panel con densidad, columnas, colores, filtros y agrupación de esa vista.' },
                    { name: 'Color e ícono', what: 'Elige un ícono y un color para la pestaña.', tip: 'Útil cuando hay muchas vistas: el rojo para «Vencidas», el verde para «Pagadas».' },
                    { name: 'Editar configuración / Configurar calendario / Configurar carga', what: 'En Kanban, Calendario, Gantt, Tarjetas y Carga de trabajo, abre la configuración propia de ese tipo.' },
                    { name: 'Vista privada', what: 'Sólo la ve quien la creó. Una vista privada no puede ser la vista por defecto.', tip: 'Para tus filtros personales, sin llenar de pestañas a los demás.' },
                    { name: 'Proteger vista', what: 'Sólo quien la creó (o un administrador) puede cambiarla o borrarla. Los demás pueden filtrar y ordenar en su pantalla, pero sus cambios no se guardan.', tip: 'Para la vista oficial que usa todo el equipo, como «Pipeline» o «Agenda del día».' },
                    { name: 'Guardar automáticamente', what: 'Los cambios de filtros, orden y columnas se guardan solos.' },
                    { name: 'Vista por defecto', what: 'La lista se abre en esta vista para todo el equipo. Lleva la estrella en la pestaña.' },
                    { name: 'Exportar vista', what: 'Descarga los registros de la vista (con sus filtros, búsqueda y orden) en Excel o CSV.' },
                    { name: 'Duplicar vista', what: 'Crea una copia con el nombre «(copia)» lista para renombrar.', tip: 'Para armar una variante sin tocar la original.' },
                    { name: 'Eliminar vista', what: 'Pide confirmación y manda la vista a la papelera. Los registros no se tocan, y la vista se puede recuperar durante 30 días.' },
                    { name: 'Mover a la izquierda / Mover a la derecha', what: 'En el celular, donde no se puede arrastrar, cambia el orden de las pestañas.' },
                    { name: 'Uso compartido y permisos', what: 'Abre el diálogo para compartir la lista con tu equipo o publicarla hacia afuera.' },
                ],
            },
            { t: 'demo', key: 'vistas-menu-pestana', caption: 'El menú de una vista, con clic derecho sobre la pestaña.', fallback: 'vistas-pestanas' },
            { t: 'h', text: 'Ordenar las pestañas' },
            {
                t: 'p',
                md: 'Arrastra una pestaña hacia la izquierda o la derecha: una línea marca dónde va a caer. El orden es el mismo para todo el equipo. Si una vista está protegida y no es tuya, no puedes moverla.',
            },
            {
                t: 'example',
                title: 'Una clínica odontológica',
                md: 'La lista **Citas** tiene cinco vistas: **Agenda** (calendario por semana, la vista por defecto), **Hoy** (tabla filtrada por «Fecha en Hoy»), **Por profesional** (carga de trabajo), **Sin confirmar** (tabla con «Estado es Pendiente», en rojo) y **Mis citas** (privada de cada odontólogo, con «Profesional es Yo»). La recepcionista vive en **Agenda**; cada doctor abre su favorita desde el menú.',
            },
            {
                t: 'example',
                title: 'Una ferretería',
                md: 'En **Productos**: una vista **Catálogo** con tarjetas y foto, otra **Para reponer** con «Stock < Stock mínimo» agrupada por proveedor, y una protegida **Precios** que sólo el dueño puede cambiar.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Si borro un registro en una vista, desaparece de las demás?', a: 'Sí. Las vistas sólo cambian cómo se ven los datos; el registro es uno solo. Va a la papelera y se puede recuperar durante 30 días.' },
                    { q: '¿Cuántas vistas puedo tener?', a: 'Las que necesites. Si son muchas, usa íconos y colores, y marca como favoritas las que más usas.' },
                    { q: '¿Otra persona ve mis vistas?', a: 'Sí, salvo que la marques como **Vista privada**. Las vistas privadas de los demás no las ves tú.' },
                    { q: '¿Una vista sirve como permiso para ocultar datos?', a: 'No. Una vista ordena y filtra, pero cualquiera con acceso a la lista puede ver todo desde **Todos**. Para limitar qué ve cada persona usa los **Permisos** de la lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Recorrido por las vistas', tour: 'views' },
                    { label: 'Personalizar una vista', article: 'vistas-personalizar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-tabla',
        route: '/lists',
        related: ['vistas-agrupar-y-calcular', 'vistas-personalizar', 'vistas-filtros-y-orden'],
        blocks: [
            {
                t: 'p',
                md: 'La **tabla** es la vista de todos los días: una fila por registro y una columna por campo. Es también la más ajustable: decides qué columnas se ven, en qué orden y con qué ancho, cuáles quedan fijas al desplazarte, qué tan apretadas van las filas, de qué tamaño es la letra y hasta de qué color se pinta cada fila según sus datos.\n\nTodo lo que ajustes se guarda en la vista. Así una persona puede tener una tabla ancha con todas las columnas y otra una compacta con sólo lo esencial, sobre los mismos registros.',
            },
            { t: 'anim', key: 'vistas-tabla', caption: 'Ocultar una columna, fijar la primera y pasar a densidad compacta: la misma tabla, más clara.' },
            { t: 'h', text: 'Columnas: cuáles, en qué orden y con qué ancho' },
            {
                t: 'steps',
                items: [
                    'Abre **Personalizar vista** (el botón con controles, a la derecha del buscador) y toca **Campos**. Verás «N en pantalla».',
                    'En **Configurar columnas**, toca el ojo de una columna para ocultarla o mostrarla. Hay atajos para **Mostrar todas** y **Ocultar todas**.',
                    'Arrastra las columnas para cambiar su orden (o usa **Subir** y **Bajar**). **Reset orden** y **Reset visibilidad** vuelven a lo inicial.',
                    'Toca **Aplicar**.',
                    'Para el ancho, arrastra el borde derecho del encabezado de la columna en la tabla.',
                ],
            },
            {
                t: 'p',
                md: 'También puedes trabajar directo desde el **encabezado de cada columna**: tócalo para ordenar (un clic ascendente, otro descendente, otro sin orden) o abre su menú con la flecha o con **clic derecho**.',
            },
            {
                t: 'settings',
                title: 'El menú del encabezado de una columna',
                rows: [
                    { name: 'Ordenar ascendente / Ordenar descendente', what: 'Ordena toda la vista por esa columna.', tip: 'Mantén Mayús al hacer clic en otro encabezado para sumar un segundo orden.' },
                    { name: 'Modificar el campo / Cambiar el nombre', what: 'Edita el campo (tipo, opciones, reglas) o sólo su nombre.' },
                    { name: 'Privacidad y permisos', what: 'Abre los permisos del campo: qué roles no lo ven.' },
                    { name: 'Fijar hasta esta columna / Dejar de fijar', what: 'Deja fijas esa columna y las que tiene a la izquierda: quedan a la vista al desplazarte hacia los lados.' },
                    { name: 'Colorear filas según esta columna…', what: 'Abre las reglas de color con esa columna ya elegida.' },
                    { name: 'Mover al inicio / Mover al final', what: 'Lleva la columna a un extremo de la tabla.' },
                    { name: 'Calcular', what: 'Abre el cálculo del pie de esa columna (suma, promedio, recuento…).' },
                    { name: 'Automatizar', what: 'Abre una automatización nueva que ya trae el paso «Actualizar un campo» con esa columna.' },
                    { name: 'Ocultar columna', what: 'La saca de esta vista. Vuelve desde **Campos**.' },
                    { name: 'Duplicar / Copiar ID de campo / Eliminar', what: 'Crea una copia del campo, copia su identificador o lo manda a la papelera con sus valores (recuperable 30 días).' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Agregar una columna sin salir de la tabla',
                md: 'El botón redondo **+** que flota en el extremo derecho del encabezado abre el panel para crear un campo nuevo. La columna aparece al instante.',
            },
            { t: 'h', text: 'Densidad, letra y columnas fijas' },
            {
                t: 'settings',
                title: 'En «Personalizar vista» → Densidad y letra y Mostrar',
                rows: [
                    { name: 'Compacta · Normal · Cómoda', what: 'La altura de cada fila.', tip: 'Compacta para revisar cientos de registros; Cómoda si los campos tienen chips grandes.' },
                    { name: 'Letra Chica · Normal · Grande', what: 'El tamaño del texto de la tabla.' },
                    { name: 'Ajustar texto', what: 'Muestra el contenido completo en varias líneas en vez de cortarlo con «…». La fila crece.', tip: 'Para columnas de notas o direcciones largas.' },
                    { name: 'Hoja de cálculo', what: 'Numera las filas y dibuja la cuadrícula completa, como en Excel.' },
                    { name: 'Editar con un click', what: 'Encendido, un clic abre el editor de la celda. Apagado (lo normal), un clic sólo elige la celda, como en Excel, y se edita con doble clic, Enter o escribiendo.', tip: 'Enciéndelo si casi siempre editas de a una celda; apágalo si copias y pegas mucho.' },
                    { name: 'Columna de número', what: 'Muestra u oculta la columna con el identificador de cada registro.' },
                    { name: 'Columnas fijas', what: '**Sólo la primera** o **Las primeras N**: quedan a la vista al desplazarte hacia los lados.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Encabezados que no se pierden',
                md: 'Al desplazarte hacia abajo, la cabecera de la lista, las pestañas y los nombres de las columnas quedan fijos arriba. Al desplazarte hacia los lados, la barra horizontal queda siempre al fondo de la pantalla.',
            },
            { t: 'h', text: 'Colores según los datos' },
            {
                t: 'p',
                md: 'Con **Colorear filas** pintas lo importante sin tener que leerlo: lo vencido en rojo, lo pagado en verde, lo urgente en ámbar. Cada **regla** tiene una condición (la misma que un filtro), un **Color** de una paleta de once y **Qué se pinta**: **La fila entera** o **Una celda** (eliges la **Columna que se pinta**).',
            },
            { t: 'anim', key: 'vistas-colores', caption: 'Una regla «Vencimiento antes de hoy» pinta en rojo las facturas atrasadas.' },
            {
                t: 'steps',
                items: [
                    'En **Personalizar vista** toca **Colorear filas** (o, en el encabezado de una columna, **Colorear filas según esta columna…**).',
                    'Toca **Agregar regla de color** y arma la condición, por ejemplo «Estado es Vencida».',
                    'Elige el color y si se pinta la fila o una celda.',
                    'Agrega más reglas si quieres. Si un registro cumple varias, **gana la de arriba**: ordénalas con las flechas de subir y bajar. Cada regla se puede apagar sin borrarla.',
                ],
            },
            { t: 'h', text: 'Subtareas y señales en la primera columna' },
            {
                t: 'p',
                md: 'La primera columna (el título) muestra señales del registro:\n\n- Una **flecha** a la izquierda si tiene subtareas: tócala para desplegarlas debajo, con sangría.\n- Un ícono de **descripción** si tiene texto en su documento.\n- **☑ 3/8** si tiene checklists: cuántos ítems están hechos.\n- Un **candado** si está bloqueado por otro registro que sigue abierto.\n- Un aviso si tiene una **aprobación pendiente**.',
            },
            {
                t: 'example',
                title: 'Una agencia de marketing',
                md: 'La vista **Producción** de la lista **Piezas** fija las dos primeras columnas (pieza y cliente), usa densidad compacta y letra chica para ver 40 piezas por pantalla, y tiene dos reglas: «Fecha de entrega antes de hoy» pinta la fila en rojo y «Estado es Aprobado por cliente» pinta sólo la celda de estado en verde.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Ocultar una columna borra los datos?', a: 'No. Sólo deja de verse en esta vista. Los datos siguen en el registro y en las demás vistas.' },
                    { q: '¿Por qué no puedo ordenar por una columna?', a: 'Algunos campos no se ordenan (archivos, botones, relaciones). Su menú lo indica con «No se puede ordenar ni filtrar».' },
                    { q: '¿Los colores los ven todos?', a: 'Sí: las reglas se guardan en la vista. Si quieres colores sólo para ti, crea una vista privada.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Agrupar y calcular totales', article: 'vistas-agrupar-y-calcular' },
                    { label: 'El panel Personalizar vista', article: 'vistas-personalizar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-agrupar-y-calcular',
        route: '/lists',
        related: ['vistas-tabla', 'vistas-filtros-y-orden', 'vistas-kanban'],
        blocks: [
            {
                t: 'p',
                md: '**Agrupar** junta las filas que comparten un valor bajo un encabezado: todas las facturas «Pendientes» juntas, todas las «Pagadas» juntas. **Calcular** pone al pie de cada columna un número que resume lo que ves: la suma de los montos, el promedio de la calificación, cuántos tienen fecha.\n\nCombinados, una tabla larga se vuelve un informe: cuánto debe cada cliente, cuántas tareas tiene cada persona, cuánto se vendió por mes.',
            },
            { t: 'anim', key: 'vistas-agrupar', caption: 'Las facturas se agrupan por estado y cada grupo suma su monto al pie.' },
            { t: 'h', text: 'Agrupar por uno o dos campos' },
            {
                t: 'steps',
                items: [
                    'Abre **Personalizar vista** y busca **Agrupar por** (en la sección **Qué se ve y en qué orden**).',
                    'Elige el campo: una selección, una persona, una fecha, una casilla, un equipo… **Sin agrupar** lo quita.',
                    'Para un segundo nivel elige **Y luego por**. Por ejemplo, por **Vendedor** y luego por **Etapa**. **Un solo nivel** lo quita.',
                    'Guarda la vista para que quede así.',
                ],
            },
            {
                t: 'p',
                md: 'Cada grupo tiene un encabezado con el **chip** del valor (con su color real) y la cantidad de registros. Tócalo para **plegarlo**. Al desplazarte, el encabezado del grupo que estás recorriendo queda fijo arriba.\n\nEl **+ Agregar** dentro de un grupo crea un registro que ya trae ese valor puesto (y el del subgrupo, si hay dos niveles).',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Agrupar por varias opciones',
                md: 'Si agrupas por un campo de varias opciones (etiquetas), cada **combinación** es un grupo: «VIP + Mayorista» es un grupo distinto de «VIP». Así cada registro aparece una sola vez y la suma de los grupos es el total.',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Si eliges un campo con muchísimos valores distintos (como el nombre), la app muestra los primeros 300 grupos y te avisa. Agrupa por un campo con menos valores, o filtra antes.',
            },
            { t: 'h', text: 'Los cálculos al pie' },
            {
                t: 'p',
                md: 'Al final de cada columna hay una celda **Calcular**. Tócala y elige qué resumir. El cálculo se hace sobre **todos** los registros que coinciden con la vista (filtros y búsqueda incluidos), no sólo los que se ven en pantalla. Con grupos, cada grupo tiene su propio pie.',
            },
            {
                t: 'settings',
                title: 'Qué se puede calcular',
                rows: [
                    { name: 'Recuento → Valores del recuento', what: 'Cuántos registros tienen algo escrito en esa columna.' },
                    { name: 'Recuento → Contar valores únicos', what: 'Cuántos valores distintos hay.', tip: 'Por ejemplo, cuántos clientes distintos compraron este mes.' },
                    { name: 'Recuento → Recuento vacío', what: 'Cuántos registros tienen esa columna vacía.', tip: 'Para ver cuántos clientes no tienen email.' },
                    { name: 'Porcentual → Porcentaje vacío / Porcentaje no vacío', what: 'Lo mismo, en porcentaje.' },
                    { name: 'Números → Suma, Promedio, Mínimo, Máximo, Intervalo', what: 'Para números, montos, porcentajes y duraciones. El intervalo es la diferencia entre el mayor y el menor.' },
                    { name: 'Fechas → Fecha más antigua, Fecha más reciente, Intervalo de fechas', what: 'Para columnas de fecha.' },
                    { name: 'Quitar cálculo', what: 'Deja la celda vacía.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Los montos al pie usan los decimales configurados en el campo y el formato de tu empresa ($ 1.250.000). Las duraciones se leen como «12h 30m».',
            },
            {
                t: 'example',
                title: 'Una constructora',
                md: 'En **Gastos de obra**, la vista **Por proyecto** agrupa por **Proyecto** y luego por **Categoría** (materiales, mano de obra, transporte). El pie de **Valor** suma cada subgrupo: de un vistazo sabe que la obra «Torre Norte» lleva $ 184.300.000 en materiales.',
            },
            {
                t: 'example',
                title: 'Un colegio',
                md: 'En **Pensiones**, agrupando por **Curso** y con «Recuento vacío» en **Fecha de pago**, la secretaría ve cuántos estudiantes de cada curso no han pagado.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo pegar datos en una tabla agrupada?', a: 'Sí, para cambiar celdas. Lo que no se hace es crear filas nuevas al pegar, porque quedarían en otro grupo: para eso usa la vista sin agrupar.' },
                    { q: '¿Por qué el total del pie no coincide con lo que veo?', a: 'Porque suma todos los registros que pasan los filtros, incluidos los de las páginas siguientes.' },
                    { q: '¿Puedo agrupar por fecha?', a: 'Sí. Los registros se agrupan por la fecha guardada en ese campo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Filtrar y ordenar', article: 'vistas-filtros-y-orden' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-filtros-y-orden',
        route: '/lists',
        related: ['vistas-que-son', 'vistas-agrupar-y-calcular', 'vistas-tabla'],
        blocks: [
            {
                t: 'p',
                md: 'Un **filtro** deja a la vista sólo los registros que cumplen una condición: «Estado es Pendiente», «Vencimiento en esta semana», «Responsable es Yo». Varias condiciones se combinan con **Y** (deben cumplirse todas) o con **O** (basta una), y se pueden armar **grupos** para casos más finos.\n\nGuardado en una vista, el filtro se vuelve un tablero de trabajo: «Por cobrar este mes», «Mis tickets abiertos», «Clientes sin contacto en 30 días».',
            },
            { t: 'anim', key: 'vistas-filtros', caption: 'Al agregar «Estado es Pendiente» y «Vence esta semana», la lista pasa de 16 a 4 registros.' },
            { t: 'h', text: 'Agregar un filtro' },
            {
                t: 'steps',
                items: [
                    'Toca **Filtrar**, debajo de las pestañas.',
                    'Toca **Agregar filtro**.',
                    'Elige el **Campo**, la condición (por ejemplo «es», «contiene», «desde») y el **Valor**.',
                    'Para opciones, personas y equipos no se escribe: aparece un buscador con casillas para elegir una o varias.',
                    'La tabla se actualiza al instante. El botón muestra cuántos filtros hay activos; **Borrar todo** los quita.',
                ],
            },
            { t: 'demo', key: 'vistas-filtrar', caption: 'Filtrar las tareas pendientes.', fallback: 'vistas-filtros' },
            { t: 'h', text: 'Las condiciones de cada tipo de campo' },
            {
                t: 'settings',
                title: 'Condiciones disponibles',
                rows: [
                    { name: 'Texto, texto largo, email, enlace, teléfono', what: '**contiene**, **no contiene**, **es**, **no es**, **empieza con**, **termina con**, **está establecido**, **no está establecido**.', tip: 'En un CRM, «Teléfono empieza con +57» separa los clientes de Colombia.' },
                    { name: 'Número, moneda, porcentaje, calificación, duración', what: '**=**, **≠**, **>**, **≥**, **<**, **≤**, **está establecido**, **no está establecido**.' },
                    { name: 'Fecha y fecha con hora', what: '**es**, **no es**, **desde**, **hasta**, **en** (un rango que se actualiza solo), **está establecido**, **no está establecido**.' },
                    { name: 'Selección', what: '**es**, **no es**, **es alguno de**, **no es ninguno de**, **está establecido**, **no está establecido**.' },
                    { name: 'Varias opciones (etiquetas)', what: '**incluye**, **no incluye**, **incluye alguno de**, **no incluye ninguno de**, **tiene opciones**, **sin opciones**.' },
                    { name: 'Persona', what: '**es**, **no es**, **es alguno de**, **no es ninguno de**, **está asignado**, **sin asignar**.' },
                    { name: 'Equipo', what: '**es**, **no es**, **es alguno de**, **no es ninguno de**, **tiene equipo**, **sin equipo**.' },
                    { name: 'Casilla', what: '**es** marcado o no marcado.' },
                    { name: 'Archivo', what: '**tiene archivos** o **sin archivos**.' },
                    { name: 'Relación', what: '**vinculado a** (eliges el registro), **no vinculado a**, **tiene vínculos**, **sin vínculos**.' },
                ],
            },
            { t: 'h', text: 'Fechas que se actualizan solas' },
            {
                t: 'p',
                md: 'Con la condición **en** eliges un rango relativo en vez de fechas fijas, y la vista sigue funcionando la semana siguiente sin tocarla. Debajo de cada filtro de fecha también aparecen **Rangos rápidos** para elegirlos con un clic.\n\nLos rangos son: **Hoy**, **Ayer**, **Esta semana**, **Semana pasada**, **Este mes**, **Mes pasado**, **Últimos 7 días**, **Últimos 15 días**, **Últimos 30 días**, **Últimos 90 días**, **Próximos 7 días**, **Próximos 30 días**, **De hoy en adelante**, **Este trimestre**, **Trimestre pasado**, **Este año**, **Año pasado** y **Personalizado**.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: '«Hoy» se calcula en la **zona horaria de tu empresa** (Ajustes → Formato regional), no la del computador de cada persona. Así todo el equipo ve lo mismo.',
            },
            { t: 'h', text: '«Yo» y «Mis equipos»: una vista para cada persona' },
            {
                t: 'p',
                md: 'En un filtro de **Persona**, la primera opción es **Yo (mi usuario)**. En uno de **Equipo**, **Mis equipos (los de quien mira)**. La vista se resuelve con quien la abre: una sola vista «Mis tareas» con «Responsable es Yo» le muestra a cada persona lo suyo.',
            },
            { t: 'h', text: 'Combinar con Y / O y grupos anidados' },
            {
                t: 'p',
                md: 'Entre las condiciones aparece **Y** u **O**: tócalo para cambiarlo. Con **Agregar filtro anidado** armas un grupo dentro de otro, que tiene su propio Y/O.\n\nEjemplo: «Estado es Pendiente **Y** (Monto > 1.000.000 **O** Cliente es VIP)». Sin el grupo, la condición se leería distinto.',
            },
            { t: 'h', text: 'Filtros guardados' },
            {
                t: 'p',
                md: 'En el panel de filtros, **Filtros guardados** guarda la combinación actual con un nombre para reusarla en cualquier vista de la lista. Al guardarlo eliges si es **Personal** o **Compartido** con el **Entorno de trabajo**. Es distinto de una vista: un filtro guardado sólo trae las condiciones, no las columnas ni el tipo de vista.',
            },
            { t: 'h', text: 'Ordenar' },
            {
                t: 'p',
                md: 'Toca el nombre de una columna para ordenar: primero de menor a mayor, después de mayor a menor y después sin orden. Con **Mayús** presionado, el clic suma un segundo criterio (por ejemplo, por estado y dentro de cada estado por fecha). El orden también se guarda en la vista. Las fechas vacías y los valores vacíos van al final.',
            },
            { t: 'h', text: 'Buscar' },
            {
                t: 'p',
                md: 'El cuadro **Buscar…** encuentra registros por cualquier palabra de sus campos de texto, email, enlace y teléfono, **y también dentro de la descripción** del registro. No importan mayúsculas ni acentos. La búsqueda se combina con los filtros de la vista y también se puede guardar en ella.\n\nPara buscar en toda la app (todas las listas a la vez) usa el buscador de arriba o **Ctrl + K**.',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria',
                md: 'La vista **Para llamar hoy** de **Interesados** filtra «Próximo contacto en Hoy **Y** Asesor es Yo **Y** (Estado es Nuevo **O** Estado es En seguimiento)». Cada asesor abre la misma vista y ve sólo sus llamadas del día; mañana se actualiza sola.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué no puedo filtrar por un campo?', a: 'Algunos campos calculados no se pueden filtrar (por ejemplo, una fórmula que no tiene equivalente directo). El selector los muestra con «(no se puede filtrar)».' },
                    { q: '¿El filtro cambia lo que ven los demás?', a: 'Sólo si guardas la vista. Mientras no la guardes, el filtro es sólo tuyo y desaparece al recargar.' },
                    { q: '¿Cómo encuentro registros sin responsable?', a: 'Filtra **Responsable** con **sin asignar**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Búsqueda y atajos', tour: 'search-and-shortcuts' },
                    { label: 'Guardar una vista', article: 'vistas-que-son' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-personalizar',
        route: '/lists',
        related: ['vistas-que-son', 'vistas-tabla', 'vistas-agrupar-y-calcular'],
        blocks: [
            {
                t: 'p',
                md: '**Personalizar vista** es el panel donde está todo lo que se ajusta de una vista, en un solo lugar. Se abre con el botón de controles que está a la derecha del buscador, o desde el menú de la pestaña. Lo que ves depende del tipo de vista: en una tabla aparecen la densidad, la letra y las columnas; en un calendario, sus fechas; en un Kanban, su tablero.',
            },
            { t: 'anim', key: 'vistas-personalizar', caption: 'El panel se abre al costado y cada ajuste se ve aplicado en vivo.' },
            { t: 'demo', key: 'vistas-panel-personalizar', caption: 'Abrir «Personalizar vista» y cambiar la densidad.', fallback: 'vistas-personalizar' },
            { t: 'h', text: 'Lo que tiene el panel' },
            {
                t: 'settings',
                title: 'Secciones de «Personalizar vista»',
                rows: [
                    { name: 'Densidad y letra', what: 'Compacta, Normal o Cómoda; letra Chica, Normal o Grande. Sólo en tablas.' },
                    { name: 'Mostrar', what: 'Ajustar texto, Hoja de cálculo, Editar con un click, Columna de número y Columnas fijas. Sólo en tablas.' },
                    { name: 'Colores → Colorear filas', what: 'Las reglas de color condicional.' },
                    { name: 'Qué se ve y en qué orden → Campos', what: 'Qué columnas se ven, en qué orden («N en pantalla»).' },
                    { name: 'Calendario / Tablero / Gantt / Carga de trabajo', what: 'La configuración propia de esos tipos de vista.' },
                    { name: 'Filtro', what: 'Los filtros de la vista, sin salir del panel.' },
                    { name: 'Agrupar por / Y luego por', what: 'Uno o dos niveles de grupos.' },
                    { name: 'Esta vista', what: '**Abrir esta vista por defecto**, **Copiar enlace de la vista** y **Eliminar vista**.' },
                    { name: 'La lista', what: '**Exportar registros**, **Exportar tiempo registrado**, **Edición masiva**, **Actualizar desde un archivo**, **Eliminar lo que coincide**, **Historial de ediciones masivas**, **Importar registros**, **Registros borrados**, **Automatizaciones** y **Configurar la lista**.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si estás en la pestaña **Todos**, el panel te recuerda que estás viendo todos los registros: guarda tus ajustes como una vista para volver a ellos.',
            },
            { t: 'h', text: 'Compartir una vista' },
            {
                t: 'p',
                md: 'Hay varias formas de hacer que otra persona vea lo mismo que tú:\n\n- **Copiar vínculo a la vista** (en el menú de la pestaña) o **Copiar enlace de la vista** (en el panel): el enlace abre la lista en esa vista. Sirve para quien ya tiene acceso a la lista.\n- **Marcar como favorito**: la vista queda en tu menú de **Favoritos** con su ícono.\n- **Compartir** (arriba a la derecha de la lista) → **Con tu equipo**: copia el enlace de la lista; **Con cualquiera**: publica la lista o **una vista** en una página de sólo lectura que se puede abrir sin cuenta, con fecha de vencimiento y los campos que elijas.\n- **Exportar vista**: un archivo Excel o CSV con los registros de la vista.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Un enlace no da permiso',
                md: 'El vínculo de una vista sólo lo abre quien ya tiene acceso a la lista. Para que alguien de afuera vea los datos tienes que publicarlos desde **Compartir → Con cualquiera**, o compartir la lista con un invitado.',
            },
            { t: 'h', text: 'Exportar lo que ves' },
            {
                t: 'settings',
                title: 'El diálogo de exportar',
                rows: [
                    { name: 'Formato', what: '**Excel (.xlsx)** con montos, fechas y porcentajes como números reales de Excel (hasta 100.000 registros) o **CSV**, texto plano para otros sistemas.' },
                    { name: 'Columnas', what: 'Cuáles salen, en el orden de la vista. **Todas** / **Ninguna** para empezar rápido.' },
                    { name: 'Incluir subtareas', what: 'Agrega las columnas «ID» y «Subtarea de» para volver a importar la jerarquía.' },
                    { name: 'Incluir el ID de cada registro', what: 'Sirve para editar el archivo y cargarlo de vuelta con **Actualizar desde un archivo**.' },
                    { name: 'Separador y Codificación (CSV)', what: 'Coma o punto y coma; **UTF-8 con BOM** para que Excel no rompa los acentos.' },
                ],
            },
            {
                t: 'example',
                title: 'Un distribuidor de café',
                md: 'El gerente comercial arma la vista **Cartera vencida** en **Facturas**, la protege, copia su vínculo y lo fija en el chat del equipo. El contador la exporta a Excel cada viernes, con el ID incluido, para conciliar.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué no veo «Densidad y letra»?', a: 'Porque esos ajustes son de la tabla. En Kanban, calendario, Gantt, carga de trabajo y tarjetas el panel muestra sólo lo que aplica.' },
                    { q: '¿Los cambios del panel se guardan solos?', a: 'Se aplican al instante en tu pantalla. Para que queden en la vista, toca **Guardar** en la barra de pestañas (o enciende **Guardar automáticamente**).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Qué es una vista', article: 'vistas-que-son' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-kanban',
        route: '/lists',
        related: ['vistas-que-son', 'vistas-agrupar-y-calcular', 'vistas-tarjetas'],
        blocks: [
            {
                t: 'p',
                md: 'El **Kanban** muestra los registros como **tarjetas en columnas**. Cada columna es un valor de un campo: las etapas de una venta, los estados de una tarea, cada vendedor. Mover un registro de etapa es arrastrar su tarjeta a otra columna, y el valor del campo cambia solo.\n\nArriba de cada columna ves cuántas tarjetas tiene y, si lo eliges, cuánto suman. Es la vista ideal para un embudo de ventas, una cola de soporte o el avance de pedidos.',
            },
            { t: 'anim', key: 'kanban-drag', caption: 'Arrastrar una oportunidad a la etapa siguiente actualiza los totales de cada columna.' },
            { t: 'h', text: 'Armar el tablero' },
            {
                t: 'steps',
                items: [
                    'Toca **+ Vista**, elige **Kanban** y en **Agrupar por** el campo de las columnas (por ejemplo **Etapa**).',
                    'Toca **Guardar vista**.',
                    'Arriba del tablero tienes **Carriles**, **Totales** y **Configurar tablero** para ajustarlo sin salir.',
                ],
            },
            {
                t: 'p',
                md: 'Las columnas salen de las opciones del campo, **en el mismo orden** y con sus colores. Los registros sin valor van a **Sin valor**, al final. Si cambias el orden de las opciones del campo, cambia el de las columnas.',
            },
            { t: 'h', text: 'Carriles, totales y límites' },
            { t: 'anim', key: 'vistas-kanban', caption: 'Carriles por vendedor, la suma de cada columna y una columna que pasa su límite se marca en rojo.' },
            {
                t: 'settings',
                title: '«Configurar tablero»',
                rows: [
                    { name: 'Columnas por', what: 'El campo de las columnas: una selección, una persona o una casilla.' },
                    { name: 'Carriles por', what: 'Filas horizontales por un segundo campo (vendedor, prioridad). Arrastrar una tarjeta a otro carril cambia los dos campos a la vez.', tip: 'Un tablero de ventas con carriles por vendedor muestra el embudo de cada uno.' },
                    { name: 'Total por columna', what: '**Sólo la cantidad de tarjetas**, o la **Suma** o el **Promedio** de un campo numérico. Se calcula sobre todos los registros de la vista, no sólo las tarjetas cargadas.' },
                    { name: 'Ordenar tarjetas por', what: 'Un campo y su **Dirección**, o **Actualizadas recientemente primero**.' },
                    { name: 'Tarjetas → Título', what: 'Qué campo es el título de la tarjeta (**Automático** usa el título de la lista).' },
                    { name: 'Tarjetas → Portada', what: 'Una imagen arriba de la tarjeta: un campo de archivo o un enlace de imagen.' },
                    { name: 'Tarjetas → Tamaño', what: '**Normal** o **Compacta**.' },
                    { name: 'Campos visibles en la tarjeta', what: 'Qué datos se muestran debajo del título, en su formato real (montos, fechas, chips).' },
                    { name: 'Ocultar las columnas y carriles sin tarjetas', what: 'Esconde lo vacío para que el tablero respire.' },
                    { name: 'Columna → Visible / Límite / Al mover aquí, pedir', what: 'Por cada columna: si se muestra, su límite de tarjetas y qué campos se piden al mover una tarjeta a ella.' },
                ],
            },
            {
                t: 'p',
                md: 'Desde el menú **···** de cada columna también puedes **Agregar tarjeta** (nace con ese valor), **Plegar columna**, **Ocultar columna** y abrir **Límite y campos a pedir…**.\n\nEl **límite** marca la columna en rojo cuando lo supera («45/40»), pero no impide mover tarjetas: es un aviso para no acumular trabajo en una etapa.',
            },
            { t: 'h', text: 'Pedir datos al mover' },
            {
                t: 'p',
                md: 'En **Al mover una tarjeta aquí, pedir** eliges campos que deben estar completos para entrar a esa columna. Si alguno está vacío, al soltar la tarjeta se abre un formulario: «Para pasar a Perdido completa: Motivo de pérdida». Si cancelas, la tarjeta vuelve a su lugar.',
            },
            {
                t: 'example',
                title: 'El embudo de una empresa de software',
                md: 'En **Oportunidades**: columnas por **Etapa**, carriles por **Vendedor**, total con la **Suma** de **Monto**. La columna **Propuesta** tiene límite 8 (más de eso significa que nadie está haciendo seguimiento). Al pasar a **Ganado** se pide **Fecha de cierre** y **Monto final**; al pasar a **Perdido**, **Motivo de pérdida**. A fin de mes, el informe de por qué se pierden ventas sale solo.',
            },
            {
                t: 'example',
                title: 'Un taller de mecánica',
                md: 'En **Órdenes de trabajo**, columnas por **Estado** (Recibido, Diagnóstico, Esperando repuesto, En reparación, Listo) y portada con la foto del vehículo. Al pasar a **Listo** se pide **Valor final** para poder avisar al cliente.',
            },
            { t: 'h', text: 'En el celular' },
            {
                t: 'p',
                md: 'En una pantalla táctil no hace falta arrastrar: abre el menú de la tarjeta y usa **Mover a…** (y **Mover a carril…** si hay carriles). Cada columna carga 25 tarjetas y **Mostrar más** trae las siguientes.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué no puedo arrastrar?', a: 'Necesitas permiso para editar los registros de la lista. Sin él, el tablero es de sólo lectura.' },
                    { q: '¿Puedo ocultar una columna sólo para mí?', a: 'Si no puedes editar la vista, plegar y ocultar columnas queda sólo en tu pantalla.' },
                    { q: '¿Puedo hacer columnas por persona?', a: 'Sí: elige un campo **Persona** en **Columnas por**. Cada persona del equipo es una columna.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Crear una vista', article: 'vistas-que-son' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-calendario',
        route: '/lists',
        related: ['vistas-gantt', 'vistas-que-son', 'vistas-carga-de-trabajo'],
        blocks: [
            {
                t: 'p',
                md: 'El **calendario** ubica cada registro en el día (y la hora) de un campo de fecha: las citas en su hora, las facturas en su vencimiento, las tareas en su entrega. Se ve por **Mes**, **Semana**, **Día** o como **Agenda** (una lista por días), y se reprograma arrastrando.',
            },
            { t: 'anim', key: 'vistas-calendario', caption: 'Arrastrar una cita al jueves la reprograma; estirar su borde cambia cuánto dura.' },
            { t: 'h', text: 'Moverte por el calendario' },
            {
                t: 'keys',
                items: [
                    { keys: ['M'], what: 'Ver el mes' },
                    { keys: ['S'], what: 'Ver la semana' },
                    { keys: ['D'], what: 'Ver el día' },
                    { keys: ['A'], what: 'Ver la agenda' },
                    { keys: ['H'], what: 'Volver a hoy' },
                    { keys: ['←', '→'], what: 'Período anterior o siguiente' },
                    { keys: ['Ctrl', 'Z'], what: 'Deshacer el último movimiento' },
                ],
            },
            {
                t: 'p',
                md: 'En el **mes**, los eventos de varios días son barras y, si un día tiene más de los que entran, **+N más** abre ese día completo. En la **semana** y el **día** hay una grilla por horas, una franja **Todo el día** arriba y una línea en la hora actual. La **agenda** muestra los días con eventos uno debajo del otro y carga más al llegar al final.',
            },
            { t: 'h', text: 'Reprogramar, estirar y crear' },
            {
                t: 'steps',
                items: [
                    '**Mover**: arrastra un evento a otro día (en el mes conserva la hora) o a otra hora (en semana y día encaja cada 15 minutos).',
                    '**Estirar**: arrastra el borde inferior para cambiar el fin o la duración. Hace falta que la fuente tenga un campo de fin o de duración.',
                    '**Crear**: haz clic en un hueco y se abre el alta con la fecha (y la hora) puestas. En semana y día, arrastra sobre un hueco para crear con inicio y fin.',
                    '**Deshacer**: el aviso que aparece tiene **Deshacer**, o usa Ctrl + Z. Si otra persona cambió el registro mientras tanto, no se pisa su cambio.',
                ],
            },
            { t: 'demo', key: 'vistas-calendario-semana', caption: 'La agenda de citas por semana.', fallback: 'vistas-calendario' },
            { t: 'h', text: 'Varias fechas en un mismo calendario' },
            {
                t: 'p',
                md: 'Un calendario puede mostrar más de un campo de fecha a la vez. Cada **fuente** es un campo de fecha con su **Etiqueta** y su color: «Vencimiento» y «Próximo contacto», por ejemplo. Arriba del calendario hay un chip por fuente para mostrarla u ocultarla con un toque.',
            },
            {
                t: 'settings',
                title: '«Configurar calendario»',
                rows: [
                    { name: 'Fechas que se muestran', what: 'Cada fuente: su **Inicio**, si es **con hora**, su **Fin** (otro campo), **Sin fin** o una **Duración** (un campo de duración), la **Etiqueta** y si está **Visible**. **Agregar otra fecha** suma una fuente.' },
                    { name: 'Un evento con hora y sin fin dura', what: 'Cuánto ocupa en la grilla un evento sin fin: de 15 minutos a 8 horas, o **Todo el día** (lo muestra arriba, en la franja del día).' },
                    { name: 'Color de los eventos', what: '**Automático**, **El color de cada fuente de fecha**, **El color de la opción de un campo de selección**, **Un solo color** o las **Reglas de color** de la vista.', tip: 'Por estado: las citas confirmadas en verde y las pendientes en ámbar.' },
                    { name: 'Abre en', what: 'Mes, Semana, Día o Agenda.' },
                    { name: 'La semana empieza el', what: 'Lunes, Domingo o Sábado.' },
                    { name: 'Horario visible (semana y día)', what: 'Desde qué hora hasta qué hora se ve la grilla. Lo que queda fuera se avisa arriba o abajo.' },
                    { name: 'Mostrar sábados y domingos', what: 'Apágalo si tu negocio no abre el fin de semana.' },
                ],
            },
            { t: 'h', text: 'La zona horaria' },
            {
                t: 'p',
                md: 'El calendario muestra y mueve las horas en la **zona horaria de la empresa**. Si tu equipo está en otra zona, un aviso lo dice. Una fecha **sin hora** es el mismo día en cualquier lugar: nunca se corre.',
            },
            {
                t: 'example',
                title: 'Un centro de estética',
                md: 'En **Citas**, el calendario abre en **Semana**, con horario visible de 8:00 a 19:00 y los domingos ocultos. El color sale de **Servicio** (facial, uñas, masajes). La recepcionista arrastra una cita del martes al jueves cuando la clienta llama, y estira la de masaje cuando piden 30 minutos más.',
            },
            {
                t: 'example',
                title: 'Una empresa de mantenimiento',
                md: 'En **Equipos de clientes**, dos fuentes: **Próximo mantenimiento** (azul) y **Vence la garantía** (rojo). En el mes se ve a la vez qué visitas hay que agendar y qué garantías están por terminar.',
            },
            { t: 'h', text: 'En el celular' },
            {
                t: 'p',
                md: 'En el teléfono el calendario abre en **Agenda** (una semana de siete columnas no entra), se pasa de día deslizando y los eventos se mueven con **Mover a…** desde su menú.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo un registro en el calendario.', a: 'Revisa que tenga fecha en el campo de la fuente, que esa fuente esté visible y que pase los filtros de la vista.' },
                    { q: 'No puedo estirar un evento.', a: 'La fuente necesita un campo de fin o de duración. Agrégalo en **Configurar calendario**.' },
                    { q: 'Aparece «Hay más eventos de los que entran en este rango».', a: 'Hay demasiados registros en ese período. Usa filtros para acotar la vista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'La vista Gantt', article: 'vistas-gantt' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-gantt',
        route: '/lists',
        related: ['vistas-calendario', 'vistas-carga-de-trabajo', 'vistas-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'El **Gantt** dibuja cada registro como una **barra** desde su fecha de inicio hasta su fecha de fin, sobre una línea de tiempo. Se ve de una mirada qué se hace cuándo, qué se superpone y qué depende de qué. Es la vista de un cronograma de obra, el lanzamiento de un producto o un evento.\n\nUn registro con una sola fecha se dibuja como un **hito** (un rombo): la entrega al cliente, la inauguración.',
            },
            { t: 'anim', key: 'vistas-gantt', caption: 'Al correr una tarea, las que dependen de ella se corren solas; la línea base muestra dónde estaban.' },
            { t: 'h', text: 'Armar el Gantt' },
            {
                t: 'steps',
                items: [
                    'Toca **+ Vista**, elige **Gantt (línea de tiempo)** y los campos de **Fecha de inicio** y **Fecha de fin** (o **Sin fecha de fin (hitos)**).',
                    'Toca **Guardar vista**.',
                    'Con **Configurar** ajusta agrupación, colores, columnas y qué se dibuja.',
                ],
            },
            { t: 'h', text: 'Mover, estirar y conectar' },
            {
                t: 'p',
                md: '- **Mover**: arrastra la barra completa; inicio y fin se corren juntos.\n- **Estirar**: arrastra un extremo para cambiar sólo el inicio o sólo el fin.\n- **Dependencia**: tira desde el circulito del borde de una barra y suéltalo sobre otro registro: «A bloquea a B». Aparece una **flecha** entre las dos. Haz clic en la flecha para quitarla. La app no deja crear un ciclo.\n- **Deshacer**: el aviso tiene **Deshacer**, y también funciona **Ctrl + Z**.\n\nUna flecha roja avisa que algo **empieza antes de que termine lo que lo bloquea**.',
            },
            { t: 'h', text: 'Reprogramar en cadena' },
            {
                t: 'p',
                md: 'En **Configurar** puedes encender **Reprogramar en cadena**: al correr el fin de un registro, se corre lo mismo a los que dependen de él (y a los que dependen de esos). Es una regla de toda la lista: vale en cualquier vista, en la ficha y en las automatizaciones. Cada registro corrido deja su cambio en la actividad, y un aviso dice cuántos se movieron.',
            },
            { t: 'h', text: 'Zoom, línea base, sin programar y PDF' },
            {
                t: 'settings',
                title: 'La barra del Gantt',
                rows: [
                    { name: 'Zoom', what: '**Día**, **Semana**, **Mes** o **Trimestre**.', tip: 'Semana para el día a día; Trimestre para mostrar el plan del año a un cliente.' },
                    { name: 'Ir a hoy', what: 'Lleva la línea de tiempo a la fecha actual (una línea marca hoy).' },
                    { name: 'Sin programar (N)', what: 'Los registros que todavía no tienen fecha. Arrástralos hasta el día en que empiezan para darles fecha.' },
                    { name: 'Línea base → Guardar línea base', what: 'Congela las fechas de hoy. Después, debajo de cada barra se ve en gris dónde estaba, para comparar cuánto se movió el plan.', tip: 'Guárdala al aprobar el cronograma con el cliente.' },
                    { name: 'Línea base → Mostrar / Ocultar / Quitar', what: 'Muestra u oculta la comparación, o la borra (los registros no cambian). **Guardar de nuevo** reemplaza la anterior.' },
                    { name: 'Exportar a PDF', what: 'Un PDF del Gantt con el orden de la vista, para mandar o imprimir.' },
                ],
            },
            {
                t: 'settings',
                title: '«Configurar Gantt»',
                rows: [
                    { name: 'Agrupar por', what: 'Grupos plegables por persona, estado u otra opción.' },
                    { name: 'Zoom al abrir', what: 'Con qué zoom se abre la vista.' },
                    { name: 'Orden de las filas', what: 'Por la fecha de inicio u otro campo, ascendente o descendente.' },
                    { name: 'Color de las barras', what: '**Por un campo de selección** (cada barra toma el color de su opción), **Por reglas de color** o **Sin color**.' },
                    { name: 'Panel de la izquierda', what: 'Además del título, hasta 6 columnas. Los anchos se ajustan arrastrando el borde de cada encabezado.' },
                    { name: 'Qué se dibuja', what: '**Subtareas debajo de su registro**, **Flechas de las dependencias**, **Línea base** y la regla **Reprogramar en cadena**.' },
                ],
            },
            {
                t: 'example',
                title: 'Una constructora',
                md: 'En **Actividades de obra**, el Gantt agrupa por **Frente** (estructura, eléctrico, acabados), colorea por **Estado** y tiene las dependencias: «Fundición de placa» bloquea a «Muros del piso 2». Con **Reprogramar en cadena** encendido, cuando la lluvia retrasa la fundición tres días, las doce actividades que dependen de ella se corren solas. La línea base guardada al firmar el contrato muestra al cliente cuánto se movió cada frente.',
            },
            {
                t: 'example',
                title: 'Una agencia de eventos',
                md: 'Para un congreso: tareas con fechas, y como hitos «Contrato con el hotel», «Cierre de inscripciones» y «Día del evento». El PDF del Gantt va adjunto en el informe semanal al cliente.',
            },
            { t: 'h', text: 'En el celular' },
            {
                t: 'p',
                md: 'En el teléfono el Gantt es de lectura: se desplaza y se consulta, y las fechas se cambian con **Mover fechas…** desde el menú de cada registro.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Las dependencias se ven en otros lugares?', a: 'Sí. En la ficha de cada registro, en la sección **Dependencias** («Bloqueado por» y «Bloquea a»), y con un candado en la tabla y el tablero mientras lo que bloquea siga abierto.' },
                    { q: '¿Puedo conectar registros de listas distintas?', a: 'Desde la interfaz, las dependencias son entre registros de la misma lista.' },
                    { q: '¿Qué pasa si no tengo permiso para editar?', a: 'Ves el Gantt pero no puedes mover barras ni crear dependencias.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'La carga de trabajo', article: 'vistas-carga-de-trabajo' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-carga-de-trabajo',
        route: '/lists',
        related: ['vistas-gantt', 'vistas-calendario', 'vistas-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'La **carga de trabajo** responde una pregunta: **¿quién está muy ocupado y quién tiene espacio?** Muestra una fila por persona del equipo y una columna por día, semana o mes. Cada celda dice cuánto trabajo tiene esa persona en ese período, frente a su **capacidad**, con un color: verde si está libre, ámbar si está cerca del límite, rojo si se pasó.\n\nPara repartir mejor, arrastra un registro de la fila de una persona a la de otra: queda reasignado.',
            },
            { t: 'anim', key: 'vistas-carga', caption: 'Ana está por encima de su capacidad esta semana; al pasarle una tarea a Juan, las dos celdas vuelven al verde.' },
            { t: 'h', text: 'Armar la vista' },
            {
                t: 'steps',
                items: [
                    'Toca **+ Vista** y elige **Carga de trabajo (por persona)**. Necesitas un campo **Persona** y uno de fecha.',
                    'Elige la **Persona asignada** y las fechas: **Fecha de inicio** y **Fecha de fin**, o una sola fecha (por ejemplo, el vencimiento).',
                    'Toca **Guardar vista** y después **Configurar carga** para elegir qué se mide.',
                ],
            },
            { t: 'h', text: 'Qué se mide' },
            {
                t: 'cards',
                items: [
                    { icon: 'ListChecks', title: 'Registros', md: 'Cuántos registros tiene cada persona en cada período, frente a sus **registros por semana**.', tone: 'blue' },
                    { icon: 'Gauge', title: 'Esfuerzo estimado', md: 'La suma de un campo de horas o de duración, **repartida en los días hábiles** de cada registro. Eliges el **Campo de estimación** y la **Unidad** (horas o minutos).', tone: 'violet' },
                    { icon: 'Timer', title: 'Tiempo registrado', md: 'Las horas que cada persona cargó de verdad con el cronómetro o a mano. Aquí la fila es de quien cargó el tiempo.', tone: 'mint' },
                ],
            },
            { t: 'h', text: 'La capacidad de cada persona' },
            {
                t: 'p',
                md: 'Junto al nombre de cada persona hay un medidor: tócalo para ajustar su **capacidad**. Se define en **Horas por día** y **Días laborables** (para medir esfuerzo o tiempo), o en **Registros por semana**. La capacidad es de la persona, no de la vista: vale para todas las vistas de carga de la empresa. La ajusta un administrador o un gerente.',
            },
            {
                t: 'settings',
                title: 'Los colores de cada celda',
                rows: [
                    { name: 'Libre', what: 'No tiene nada en ese período.' },
                    { name: 'Con espacio', what: 'Tiene trabajo, pero bastante por debajo de su capacidad.' },
                    { name: 'Cerca del límite', what: 'Está por llegar a su capacidad.' },
                    { name: 'Por encima de la capacidad', what: 'Tiene más de lo que puede: conviene reasignar o mover fechas.' },
                ],
            },
            { t: 'h', text: 'Ver y reasignar' },
            {
                t: 'steps',
                items: [
                    'Haz clic en una celda (o en una fila) para abrir el panel con sus registros.',
                    'Arrastra un registro a la fila de otra persona, o usa **Reasignar a…**. Se cambia la persona del registro en el acto.',
                    'Si te equivocas, toca **Deshacer** en el aviso o usa Ctrl + Z.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'En **Tiempo registrado** no se reasigna desde aquí: la fila es de quien cargó el tiempo. Cambia a **Registros** o **Esfuerzo** para repartir.',
            },
            {
                t: 'settings',
                title: '«Configurar carga» → Qué se ve',
                rows: [
                    { name: 'Zoom al abrir', what: 'Día, Semana o Mes.' },
                    { name: 'Ocultar terminados', what: 'Los registros cuyo estado dice terminado, completado o cerrado no cuentan.' },
                    { name: 'Mostrar la fila «Sin asignar»', what: 'Una fila con lo que no tiene persona: lo que hay que repartir.' },
                    { name: 'Equipo', what: 'Sólo las personas de un equipo (quien entra o sale del equipo aparece o desaparece solo).' },
                    { name: 'Personas visibles', what: 'Elegir a mano quiénes se ven, o **Todas las que pueden ver la lista**.' },
                ],
            },
            {
                t: 'example',
                title: 'Un estudio de arquitectura',
                md: 'En **Entregables**, cada plano tiene **Responsable**, **Inicio**, **Entrega** y **Horas estimadas**. La carga por semana, medida en esfuerzo, muestra que el dibujante senior tiene 52 horas la semana del concurso y la junior 18. La directora arrastra dos planos de uno a otro antes de que se atrase nada.',
            },
            {
                t: 'example',
                title: 'Una mesa de soporte',
                md: 'Medido en **Registros** con capacidad de 25 tickets por semana, el equipo de soporte ve quién está saturado y le pasa tickets de la fila **Sin asignar** a quien está en verde.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué una persona no aparece?', a: 'Sólo aparecen las personas que pueden ver la lista (y del equipo elegido, si filtraste por equipo).' },
                    { q: '¿Cómo se reparte el esfuerzo de una tarea de varios días?', a: 'En partes iguales entre los días hábiles del tramo, según los días laborables de la persona.' },
                    { q: 'El celular muestra tarjetas en vez de la grilla.', a: 'En el teléfono hay una tarjeta por persona con el uso de la semana.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'La vista Gantt', article: 'vistas-gantt' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'vistas-tarjetas',
        route: '/lists',
        related: ['vistas-kanban', 'vistas-que-son', 'vistas-personalizar'],
        blocks: [
            {
                t: 'p',
                md: 'La vista de **Tarjetas** muestra cada registro como una tarjeta en una grilla, con una **imagen de portada** arriba y algunos datos debajo. Es como un catálogo: perfecta para productos, inmuebles, vehículos, platos de un menú, empleados o proyectos con foto.',
            },
            { t: 'anim', key: 'vistas-tarjetas', caption: 'Un catálogo de productos como tarjetas con foto, precio y stock.' },
            { t: 'h', text: 'Crear la vista de tarjetas' },
            {
                t: 'steps',
                items: [
                    'Toca **+ Vista**, elige **Tarjetas** y ponle un nombre (por ejemplo, «Catálogo»).',
                    'Toca **Guardar vista**.',
                    'En el menú de la pestaña toca **Editar configuración** para elegir la portada y los campos.',
                ],
            },
            {
                t: 'settings',
                title: 'Configuración de las tarjetas',
                rows: [
                    { name: 'Campos en la tarjeta', what: 'Qué datos aparecen debajo del título. El título es siempre el campo de título de la lista.', tip: 'Dos o tres datos bastan: precio y stock en un catálogo; barrio y valor en una inmobiliaria.' },
                    { name: 'Imagen de portada (opcional)', what: 'Un campo **Archivo** con la foto, o un campo **Enlace** que se muestre como imagen. Sin portada, la tarjeta muestra un avatar con color.' },
                    { name: 'Densidad del grid', what: '**Compacta**, **Normal** o **Espaciada**: cuántas tarjetas entran por fila.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Fotos desde un enlace',
                md: 'Si las fotos están en internet (tu tienda en línea, por ejemplo), crea un campo **Enlace** y en su configuración elige **Mostrar como: Imagen**. Así sirve de portada sin subir archivos.',
            },
            {
                t: 'p',
                md: 'Haz clic en una tarjeta para abrir el registro. Las tarjetas respetan los filtros, la búsqueda y el orden de la vista, así que puedes tener un «Catálogo» con todo y un «Agotados» filtrado por «Stock = 0».',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria',
                md: 'La vista **Vitrina** de **Inmuebles** usa la foto de fachada como portada y muestra **Barrio**, **Habitaciones** y **Valor**. Filtrada por «Estado es Disponible», es lo que el asesor le muestra al cliente en la tableta durante la visita.',
            },
            {
                t: 'example',
                title: 'Un restaurante',
                md: 'En **Platos**, las tarjetas con la foto, el **Precio** y la **Categoría** ayudan al equipo de cocina a reconocer cada plato y a revisar qué falta fotografiar (los que tienen avatar en vez de foto).',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo mover tarjetas entre columnas?', a: 'No: la vista de tarjetas es una galería. Si quieres columnas por etapa, usa el **Kanban**, que también puede tener portada.' },
                    { q: 'No me aparece ningún campo para la portada.', a: 'Necesitas un campo de tipo **Archivo**, o un **Enlace** que se muestre como imagen.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'El Kanban', article: 'vistas-kanban' },
                ],
            },
        ],
    },
];
