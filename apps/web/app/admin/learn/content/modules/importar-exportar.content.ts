import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'importar-exportar-desde-archivo',
        route: '/lists/new/file',
        related: ['importar-exportar-importar', 'listas-y-campos-crear', 'importar-exportar-actualizar'],
        blocks: [
            {
                t: 'p',
                md: 'Si tus datos ya están en una planilla (facturas, clientes, proyectos, inventario), no hace falta diseñar la lista campo por campo: súbela y la app arma **una propuesta completa** que revisas antes de crear nada. Mira los datos de cada columna, no sólo su nombre, y te dice por qué eligió cada cosa.',
            },
            { t: 'anim', key: 'archivo-a-lista', caption: 'De una planilla de facturas sale un plan columna por columna, la IA junta «PAGADO» y «pagada», y quedan dos listas vinculadas: Facturas y Clientes.' },
            { t: 'h', text: 'Dónde está' },
            {
                t: 'p',
                md: 'Toca **Nueva lista** y elige **Desde un archivo**. Si tu empresa todavía no tiene listas, la bienvenida también ofrece **Subir un Excel o CSV**. Desde el botón **Nueva lista aquí** de una carpeta, las listas nacen dentro de esa carpeta.',
            },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'Sube tu archivo .xlsx o .csv (arrástralo o haz clic). La primera fila tiene que traer los nombres de las columnas. En un Excel se leen todas las hojas visibles con datos, hasta 5.',
                    'Al instante ves el plan: cada columna con su **tipo** (fecha, moneda, teléfono, correo, selección con colores…), el **motivo** y cómo van a quedar sus primeros valores. Lo que no encaje se marca en color.',
                    'Revisa las columnas que se proponen **descartar** (vacías, repetidas, números de fila, fórmulas sueltas): están plegadas al final y vuelven con un clic.',
                    'Si aparece **Separar «Cliente» en su propia lista**, decide si lo quieres: cada fila queda conectada con su cliente y los datos del cliente (correo, teléfono) se van con él.',
                    'Si quieres, toca **Mejorar con IA** (abajo te explicamos qué viaja). Después toca **Crear la lista** (o **Crear las listas**).',
                ],
            },
            { t: 'h', text: 'Lo que la app decide por ti' },
            {
                t: 'settings',
                rows: [
                    { name: 'El tipo de cada columna', what: 'Según los valores: fechas en el orden de tu país, montos con punto o coma de miles, teléfonos con su indicativo, correos y enlaces. Un encabezado como «Valor» o «Teléfono» ayuda a decidir.', tip: 'Puedes cambiar el tipo de cualquier columna: la vista previa muestra al instante cómo quedan los valores.' },
                    { name: 'Opciones limpias', what: 'Una columna con pocos valores repetidos pasa a ser una selección con colores, y lo escrito distinto («PAGADO», «pagada») se junta en una sola opción.' },
                    { name: 'El título de cada registro', what: 'Se elige la columna que mejor identifica cada fila (un nombre o un número de factura). Puedes elegir otra.' },
                    { name: 'Filas repetidas', what: 'Si el archivo trae filas idénticas, se ofrece saltarlas.' },
                    { name: 'Celdas que no encajan', what: 'Un valor que no es lo que pide su columna (un texto en una fecha) no frena nada: la fila entra igual, esa celda queda vacía y al final ves la lista de esas celdas.' },
                    { name: 'Moneda y país', what: 'Se toman de la zona horaria de tu empresa; puedes cambiarlos por columna.' },
                ],
            },
            { t: 'h', text: 'Listas vinculadas' },
            {
                t: 'p',
                md: 'Dos casos se resuelven solos. **Algo repetido con sus propios datos**: en una hoja de facturas donde cada cliente aparece varias veces siempre con el mismo correo y teléfono, la app propone una lista de **Clientes** aparte; cada factura queda vinculada a su cliente. **Un Excel con varias hojas**: cada hoja se convierte en una lista, y una columna que nombra registros de otra hoja (la columna «Proyecto» de la hoja de tareas) queda conectada. Si se crea más de una lista, van juntas en una carpeta.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Si un valor no encuentra su registro',
                md: 'Una tarea que nombra un proyecto que no está en la otra hoja entra igual, sin vínculo, y al final te dice cuál fue para que lo corrijas a mano.',
            },
            { t: 'h', text: 'Mejorar con IA' },
            {
                t: 'p',
                md: 'La IA revisa la propuesta y la afina: nombres más claros, opciones que estaban escritas de varias formas, tipos mejor elegidos y columnas que no hacen falta. Lo que ya cambiaste a mano se respeta, y con **Deshacer la mejora** vuelves a como estaba. Las columnas que cambió quedan marcadas con ✦.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Qué viaja al proveedor de IA',
                md: 'Sólo un **resumen protegido**: los nombres de las columnas, el tipo que parece tener cada una y ejemplos donde los correos, teléfonos, documentos y nombres de personas o empresas van **ocultos**. Los valores de categorías (estados, ciudades, tipos) sí se envían, para poder ordenarlos. El archivo completo nunca sale de tu navegador, y antes de usarla marcas que estás de acuerdo.',
            },
            { t: 'h', text: 'Al terminar: recomendaciones' },
            { t: 'anim', key: 'archivo-recomendaciones', caption: 'Tras crear las listas, se aprueba un tablero por estado y un tablero de cartera con un clic.' },
            {
                t: 'p',
                md: 'Con las listas creadas, la app te recomienda lo que suele servir para esos datos: un **tablero por estado** para mover las tarjetas, un **calendario** por la fecha de vencimiento, un **tablero de gráficos** que encaja con tus columnas y **automatizaciones** de la galería de ideas (por ejemplo, un recordatorio de pago para facturas). Nada se crea solo: apruebas las que te sirvan y todo se puede cambiar o borrar después.',
            },
            {
                t: 'settings',
                title: 'Límites',
                rows: [
                    { name: 'Filas', what: 'Hasta 5.000 por hoja y 60 columnas. Si el archivo trae más, se avisa y se toman las primeras.' },
                    { name: 'Registros del plan', what: 'Si el archivo trae más registros de los que le quedan a tu plan, te avisa antes de crear nada y puedes importar sólo los que entran.' },
                    { name: 'Análisis con IA', what: 'Cada empresa tiene algunos análisis con IA al mes para esto (la cantidad aparece junto al botón), aparte de lo que use el asistente. Con una clave de IA propia no hay límite.' },
                    { name: 'Formatos', what: 'Excel moderno (.xlsx) y CSV. Un Excel antiguo (.xls) o protegido con contraseña: ábrelo y guárdalo como .xlsx.' },
                ],
            },
            {
                t: 'example',
                title: 'Una distribuidora que deja su Excel de cartera',
                md: 'Subió «cartera.xlsx» con N° factura, Cliente, Correo, Teléfono, Fecha, Vence, Valor y Estado. La app propuso Valor como moneda, las fechas en día/mes/año, Estado como selección (juntó «PAGADO», «pagada» y «Pagada») y una lista de Clientes aparte con su correo y teléfono. Al terminar aprobó el tablero por estado y el tablero «Cartera y cobros»: en cinco minutos tenía la cartera ordenada y sus números a la vista.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Y si quiero agregar registros a una lista que ya tengo?', a: 'Para eso está **Importar registros** dentro de la lista: emparejas las columnas con los campos que ya existen.' },
                    { q: 'No veo «Mejorar con IA».', a: 'Hace falta que la IA esté disponible para tu empresa. Si no lo está, el plan igual se arma con las reglas automáticas y puedes ajustarlo a mano.' },
                    { q: '¿Se disparan automatizaciones al crear la lista?', a: 'No: las listas son nuevas y todavía no tienen automatizaciones. Las que apruebes al final empiezan a funcionar con los registros que lleguen después.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Crear desde un archivo', to: '/lists/new/file' },
                    { label: 'Importar a una lista que ya tengo', article: 'importar-exportar-importar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'importar-exportar-importar',
        route: '/lists',
        related: ['importar-exportar-actualizar', 'importar-exportar-exportar', 'listas-y-campos-crear', 'listas-y-campos-reglas'],
        blocks: [
            {
                t: 'p',
                md: 'Si tus clientes, productos o tareas ya viven en Excel, en Google Sheets o en otra herramienta (ClickUp, Airtable), no hace falta copiarlos uno por uno: el **importador** los trae en un solo paso. Lee archivos **Excel (.xlsx)** y **CSV**, entiende las fechas, los montos y los porcentajes, y puede crear los campos que la lista todavía no tiene.',
            },
            { t: 'anim', key: 'ie-importar', caption: 'Se arrastra un Excel, cada columna se empareja con un campo, se crea el campo Ciudad y llegan tres registros.' },
            { t: 'h', text: 'Dónde está' },
            {
                t: 'p',
                md: 'Abre la lista y toca **Personalizar** (el ícono de ajustes junto al buscador): al final, en «La lista», está **Importar registros**. En una lista vacía, el botón **Importar CSV / Excel** aparece en el centro. También se llega desde el menú «…» de la lista en el panel lateral.',
            },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'Toca **Importar registros** y elige el archivo (o arrástralo). Si es un Excel con varias hojas, eliges cuál con **Usar esta hoja**.',
                    'La app muestra cuántas filas y columnas detectó. Por cada **Columna del archivo** eliges el **Campo destino**: las que se llaman igual que un campo ya vienen emparejadas.',
                    'Para una columna que la lista no tiene, elige **+ Crear campo nuevo**: escribe su nombre y revisa el tipo, que se sugiere a partir de los datos (fecha, número, selección…).',
                    'Las columnas que no te interesan quedan en **— Ignorar —**. Si alguna tiene datos y no la emparejaste, un aviso te lo dice para que no pierdas información.',
                    'Toca **Importar**. Al terminar ves cuántos registros entraron, cuántos se omitieron y por qué.',
                ],
            },
            { t: 'demo', key: 'ie-importar', caption: 'El importador: elegir el archivo, emparejar columnas y crear un campo nuevo.', fallback: 'ie-importar' },
            { t: 'h', text: 'Lo que el importador hace por ti' },
            {
                t: 'settings',
                rows: [
                    { name: 'Fechas y montos de Excel', what: 'Se leen como lo que son: una fecha queda como fecha y un monto como número, con el formato de tu empresa.', tip: 'En CSV, escribe las fechas como en tu país (30/10/2026) o como 2026-10-30.' },
                    { name: 'Títulos arriba de la tabla', what: 'Si la hoja tiene un título o un logo antes de los encabezados, se salta solo.' },
                    { name: 'Fórmulas de Excel', what: 'Se importa el resultado calculado, no la fórmula.' },
                    { name: 'Selecciones', what: 'Un valor que todavía no es opción del campo se agrega como opción nueva (si puedes administrar campos). Sólo se crean las opciones que usan las filas que de verdad entran.' },
                    { name: 'Personas', what: 'En un campo de tipo Usuario, la celda puede traer el nombre o el email de la persona.' },
                    { name: 'Teléfonos', what: 'Si el número no trae indicativo, se usa el país por defecto del campo.' },
                    { name: 'Lista vacía', what: 'Si la lista todavía no tiene campos, todas las columnas vienen marcadas para crear un campo nuevo: creas la lista desde el Excel en un solo paso.' },
                ],
            },
            { t: 'h', text: 'Subtareas en el archivo' },
            {
                t: 'p',
                md: 'Si tu archivo tiene tareas y subtareas, usa dos columnas: una con un identificador de cada fila (emparéjala con **ID de la fila (para referenciarla)**) y otra que diga de qué fila es subtarea (emparéjala con **Subtarea de…**). Es el mismo formato que trae la exportación de una lista con subtareas, así que puedes exportar, editar y volver a importar.',
            },
            { t: 'h', text: 'Si algo sale mal' },
            {
                t: 'p',
                md: 'Las filas con errores (un NIT que no pasa la validación, un campo obligatorio vacío, un valor repetido en un campo **Sin repetidos**) no se importan; el resultado te dice qué fila y por qué. Las demás entran igual. Corrige esas filas en el archivo y súbelas de nuevo: sólo esas, para no duplicar las que ya entraron.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Importar siempre crea registros nuevos',
                md: 'Si subes dos veces el mismo archivo, tendrás todo duplicado. Para cambiar registros que ya existen (precios, cuotas, stock) usa **Actualizar desde un archivo**; con su opción **Crear los que no existen** sirve también para cargar «lo nuevo y lo cambiado» de una vez.',
            },
            {
                t: 'settings',
                title: 'Límites',
                rows: [
                    { name: 'Filas por importación', what: 'Hasta 5.000. Para más, parte el archivo en varios.' },
                    { name: 'Tamaño de un Excel', what: 'Hasta 15 MB.' },
                    { name: 'Registros del plan', what: 'Si el archivo supera los registros que quedan disponibles en tu plan, la importación no se hace y te dice el motivo, antes de cargar nada.' },
                    { name: 'Formatos', what: 'Excel moderno (.xlsx) y CSV. Un Excel antiguo (.xls) o protegido con contraseña: ábrelo y guárdalo como .xlsx.' },
                ],
            },
            {
                t: 'example',
                title: 'Una inmobiliaria que llega desde Excel',
                md: 'Tenía 1.800 inmuebles en una hoja con columnas Código, Dirección, Barrio, Estrato, Precio, Estado y Asesor. Creó una lista en blanco «Inmuebles», importó el Excel con todas las columnas como campos nuevos (Estrato y Estado quedaron como selección, Precio como moneda) y en la columna Asesor puso el email de cada asesor, que quedó asignado como persona.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo «Importar registros».', a: 'Importar necesita el permiso de importar registros. Si no lo tienes, pídeselo al administrador de la empresa.' },
                    { q: 'No me deja crear campos nuevos desde el importador.', a: 'Crear campos es de quien administra campos. Puedes importar a los campos que ya existen o pedir que creen los que faltan.' },
                    { q: 'Mi CSV sale con caracteres raros en las tildes.', a: 'Guárdalo con codificación UTF-8. Desde Excel: «Guardar como → CSV UTF-8». O mejor, sube directamente el .xlsx.' },
                    { q: '¿Se disparan las automatizaciones al importar?', a: 'No. Importar no activa las automatizaciones de «cuando se crea un registro»: así puedes cargar miles de clientes sin mandarle a cada uno el correo de bienvenida. Lo que sí se aplica son los valores por defecto y las validaciones de cada campo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido «Importar»', tour: 'import' },
                    { label: 'Actualizar desde un archivo', article: 'importar-exportar-actualizar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'importar-exportar-actualizar',
        route: '/lists',
        related: ['importar-exportar-importar', 'importar-exportar-exportar', 'listas-y-campos-reglas'],
        blocks: [
            {
                t: 'p',
                md: '«Llegó la lista de precios del proveedor», «el depósito mandó el conteo de stock», «cambian las cuotas del próximo mes». Para esto está **Actualizar desde un archivo**: cada fila del archivo se empareja con un registro que ya existe y le cambia sólo las columnas que elijas. Nada se duplica y, antes de aplicar, ves exactamente qué va a cambiar.',
            },
            { t: 'anim', key: 'ie-actualizar', caption: 'La lista de precios se empareja por SKU: tres precios cambian, uno ya estaba igual y un SKU nuevo queda sin registro.' },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'Abre la lista, toca **Personalizar** y elige **Actualizar desde un archivo** (también hay un enlace dentro del importador).',
                    'Elige el archivo Excel o CSV. Hasta 5.000 filas.',
                    'En **¿Cómo se reconoce cada registro?** eliges qué **Columna del archivo** identifica cada fila y con qué campo **Coincide con**: **El ID del registro** o un campo único como el SKU, el NIT o el email. Se sugiere solo.',
                    'En **Qué columnas actualizar**, por cada columna eliges el campo que **Actualiza**. Las que no tocas quedan en **— No tocar —**.',
                    'Decide las dos opciones: **Una celda vacía vacía el campo** (si no la marcas, una celda vacía deja el valor como está) y **Crear los que no existen** (las filas sin registro se agregan como registros nuevos).',
                    'Toca **Ver vista previa**. Todavía no cambia nada.',
                    'Revisa los números y los ejemplos y toca **Aplicar a N registros**.',
                ],
            },
            { t: 'demo', key: 'ie-actualizar', caption: 'Emparejar por NIT, elegir qué columna actualiza qué campo y ver la vista previa.', fallback: 'ie-actualizar' },
            { t: 'h', text: 'La vista previa' },
            {
                t: 'settings',
                rows: [
                    { name: 'Cambian', what: 'Registros encontrados en los que algo es distinto. Debajo, **Así quedan**: ejemplos con el valor anterior tachado y el nuevo.' },
                    { name: 'Ya estaban así', what: 'Registros encontrados que ya tenían esos valores. No se tocan.' },
                    { name: 'Sin registro', what: 'Filas cuya clave no coincide con ningún registro. Se listan con su número de fila; no se tocan (o se crean, si marcaste **Crear los que no existen**).' },
                    { name: 'Con error', what: 'Filas que no se pueden aplicar: un valor que el campo no acepta, una clave repetida en el archivo («ya aparece en la fila 3») o una clave que coincide con varios registros.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'La forma más segura: exportar, editar y volver a subir',
                md: 'Exporta la lista marcando **Incluir el ID de cada registro**, cambia en Excel lo que necesites y súbela con **Actualizar desde un archivo** emparejando por el ID. Es la manera más confiable de editar cientos de registros a la vez.',
            },
            { t: 'h', text: 'Cómo se comparan las claves' },
            {
                t: 'p',
                md: 'La comparación no distingue mayúsculas ni espacios: «caf-500 » encuentra a «CAF-500». En teléfonos sólo cuentan los números, así que «+57 310 456 7890» encuentra a «3104567890» si el campo tiene a Colombia como país. Sólo se emparejan registros que tú puedes editar.',
            },
            { t: 'h', text: 'Deshacer' },
            {
                t: 'p',
                md: 'Cada actualización queda en el **historial de ediciones masivas** de la lista (en **Personalizar → Historial de ediciones masivas**) y se puede **Deshacer** completa desde el resultado o desde ese historial, durante 30 días. Si alguien cambió un registro después, ese no se pisa: la vista previa del deshacer te lo muestra.',
            },
            {
                t: 'example',
                title: 'Una distribuidora de café',
                md: 'Cada mes el tostador manda «precios-noviembre.xlsx» con SKU y precio. En **Productos**, el SKU es **Sin repetidos**. Suben el archivo emparejando SKU con SKU y la columna precio con «Precio de venta»: 312 productos cambian, 40 siguen igual y 3 SKU nuevos aparecen como «Sin registro» para crearlos a mano con su foto y descripción.',
            },
            {
                t: 'example',
                title: 'Un gimnasio que ajusta cuotas',
                md: 'En enero exportan los socios con su ID, aplican el 8 % en Excel a la columna «Cuota» y la vuelven a subir. Antes de aplicar ven que 3 filas tienen error (celdas con texto en lugar de número) y las corrigen.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué campos sirven como clave?', a: 'El ID del registro (la columna «ID» de la exportación) o un campo de texto, email, teléfono, enlace o número. Lo ideal es que esté marcado **Sin repetidos**.' },
                    { q: '¿Disparan automatizaciones los cambios?', a: 'Sí: cada registro que cambia es una edición normal y puede activar automatizaciones de «cuando se actualiza».' },
                    { q: '¿Funciona en una lista conectada a una tienda en línea?', a: 'Sí, para lo que la tienda permite editar (precios y stock, por ejemplo): los cambios viajan a la tienda. Crear registros nuevos ahí no se puede.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Exportar con el ID', article: 'importar-exportar-exportar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'importar-exportar-exportar',
        route: '/lists',
        related: ['importar-exportar-actualizar', 'importar-exportar-importar', 'importar-exportar-duplicar'],
        blocks: [
            {
                t: 'p',
                md: 'Tus datos son tuyos y salen cuando quieras: para mandar un reporte al contador, hacer un respaldo propio, cruzar información en Excel o cargarla en otro sistema. La exportación descarga **lo que ves en la vista**: con sus filtros, su búsqueda, su orden y sus columnas.',
            },
            { t: 'anim', key: 'ie-exportar', caption: 'Se elige Excel, se incluye el ID y se descarga un archivo con montos y fechas reales.' },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y deja la vista como la quieres: filtra (por ejemplo, «Estado es Pendiente»), busca u ordena.',
                    'Toca **Personalizar** y elige **Exportar registros**. También puedes usar **Exportar vista** desde el menú «…» de la pestaña de la vista.',
                    'Elige el **Formato**: **Excel (.xlsx)** o **CSV**.',
                    'En **Columnas** marca cuáles salen (**Todas** · **Ninguna**). Salen en el orden de la vista.',
                    'Marca si quieres **Incluir subtareas** y **Incluir el ID de cada registro**.',
                    'Toca **Descargar Excel** (o **Descargar CSV**).',
                ],
            },
            { t: 'demo', key: 'ie-exportar', caption: 'El diálogo de exportar, en Excel y en CSV.', fallback: 'ie-exportar' },
            { t: 'h', text: 'Excel o CSV' },
            {
                t: 'cards',
                items: [
                    { icon: 'FileSpreadsheet', title: 'Excel (.xlsx)', md: 'Para personas. Montos, fechas y porcentajes quedan como números y fechas reales (se pueden sumar y filtrar en Excel), encabezado fijo con filtro y enlaces que se pueden abrir. Hasta 100.000 registros.', tone: 'mint' },
                    { icon: 'FileText', title: 'CSV', md: 'Para otros sistemas. Texto plano, sin límite de registros. Eliges el **Separador** (coma o punto y coma) y la **Codificación** UTF-8 con BOM, que hace que Excel muestre bien las tildes.', tone: 'blue' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'CSV para abrir en Excel en español',
                md: 'Si tu Excel usa la coma como decimal (lo normal en Latinoamérica), elige **Punto y coma** como separador y deja marcada **UTF-8 con BOM**.',
            },
            { t: 'h', text: 'Cómo salen los datos' },
            {
                t: 'settings',
                rows: [
                    { name: 'Selecciones', what: 'Con su etiqueta («En curso»), no con el valor interno.' },
                    { name: 'Personas y equipos', what: 'Con su nombre.' },
                    { name: 'Relaciones', what: 'Con el título del registro vinculado («Café Bahía»).' },
                    { name: 'Calculados, fórmulas y resúmenes', what: 'Con el valor que se ve en la tabla.' },
                    { name: 'Casillas', what: 'Sí / No.' },
                    { name: 'Archivos', what: 'Con el nombre de cada archivo.' },
                    { name: 'Campos ocultos para tu rol', what: 'No salen: la exportación respeta los permisos de quien exporta.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Textos que parecen fórmulas',
                md: 'Si una celda empieza con =, +, - o @, en Excel sale como texto, nunca como fórmula. Es una protección para que nadie pueda esconder una fórmula dañina en un registro.',
            },
            {
                t: 'example',
                title: 'El cierre de mes para el contador',
                md: 'La vista «Facturas de octubre» filtra por fecha y estado «Pagada». Al final del mes, la administradora exporta esa vista a Excel con las columnas número, cliente, NIT, valor e IVA, y se la manda al contador: los valores ya vienen como números y él puede sumarlos directamente.',
            },
            { t: 'h', text: 'Tu propio respaldo' },
            {
                t: 'p',
                md: 'Si quieres tener una copia propia de tus datos clave, crea una vista «Todos» sin filtros con todas las columnas y expórtala a Excel cada mes. Marca **Incluir el ID de cada registro** y **Incluir subtareas**: así, si alguna vez necesitas corregir datos en bloque, el mismo archivo sirve para **Actualizar desde un archivo**, y si hubiera que reconstruir la lista, para importarla con su jerarquía.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Exporté y faltan registros.', a: 'Se exporta lo que muestra la vista: revisa que no tenga un filtro o una búsqueda activos. Para todo, usa una vista sin filtros como «Todos».' },
                    { q: '¿Puedo exportar más de 100.000 registros?', a: 'En Excel no; filtra por partes (por ejemplo, por año) o usa CSV, que no tiene límite.' },
                    { q: '¿Puedo exportar el tiempo registrado?', a: 'Sí: en **Personalizar** está **Exportar tiempo registrado**, con las entradas de tiempo de los registros de la vista.' },
                    { q: '¿Quién puede exportar?', a: 'Quien puede ver la lista. Cada persona exporta sólo lo que puede ver.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Actualizar desde un archivo', article: 'importar-exportar-actualizar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'importar-exportar-plantillas',
        route: '/lists',
        related: ['importar-exportar-duplicar', 'listas-y-campos-crear', 'listas-y-campos-ajustes'],
        blocks: [
            {
                t: 'p',
                md: 'Cuando una lista funciona bien —sus campos, sus vistas, sus automatizaciones—, conviértela en **plantilla**. Así, cualquier persona que administre listas en tu empresa puede crear otra igual en segundos desde **Nueva lista**, sin rearmar nada. Es la forma de que todas las sedes, todos los clientes o todos los proyectos trabajen con la misma estructura.',
            },
            { t: 'anim', key: 'ie-plantilla', caption: 'Se guarda una lista como plantilla y aparece en «Mis plantillas» al crear una lista nueva.' },
            { t: 'h', text: 'Guardar una lista como plantilla' },
            {
                t: 'steps',
                items: [
                    'Abre la configuración de la lista (**Configurar lista**) y ve a la pestaña **General**. También puedes usar el menú «…» de la lista en el panel lateral.',
                    'En «Duplicar o guardar como plantilla», toca **Guardar como plantilla**.',
                    'Escribe el **Nombre de la plantilla**, una **Descripción (opcional)** que diga para qué sirve y elige la **Categoría** (Ventas, Clientes, Proyectos, Operaciones, Finanzas, Personas u Otros).',
                    'En **Incluir** marca qué viaja: **Vistas guardadas**, **Automatizaciones**, **Ajustes** (permisos, apariencia y plantillas de ficha) y, si quieres, **Registros como datos de ejemplo** (hasta 500).',
                    'Toca **Guardar plantilla**.',
                ],
            },
            { t: 'demo', key: 'ie-plantilla', caption: 'Guardar como plantilla desde la pestaña General de la lista.', fallback: 'ie-plantilla' },
            { t: 'h', text: 'Usar la plantilla' },
            {
                t: 'p',
                md: 'En **Nueva lista**, pestaña **Plantilla**, toca el filtro **Mis plantillas**: ahí están las de tu empresa, junto a las de la galería general. Eliges una, revisas lo que trae, le pones nombre y decides si incluyes los registros de ejemplo. Desde la misma galería, una plantilla tuya se puede borrar con **Borrar plantilla**.',
            },
            { t: 'h', text: 'Qué viaja y qué no' },
            {
                t: 'settings',
                rows: [
                    { name: 'Campos', what: 'Siempre, con su tipo, sus opciones, sus reglas y sus fórmulas. Las relaciones, fórmulas y resúmenes apuntan a los campos de la lista nueva.' },
                    { name: 'Vistas, automatizaciones y ajustes', what: 'Si los marcaste. Las automatizaciones con webhook entrante reciben un enlace nuevo.' },
                    { name: 'Registros de ejemplo', what: 'Si los marcaste, hasta 500. Quien use la plantilla elige si los incluye.' },
                    { name: 'Lo que no viaja', what: 'La publicación pública de la lista y los archivos adjuntos.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Una plantilla no se actualiza sola',
                md: 'La plantilla es una foto de la lista en el momento de guardarla. Si después mejoras la lista, guárdala de nuevo como plantilla (y borra la versión vieja) para que las listas nuevas salgan con las mejoras. Las listas ya creadas no cambian.',
            },
            {
                t: 'example',
                title: 'Una consultora con un proyecto por cliente',
                md: 'Armaron una lista «Proyecto — Cliente X» con fases, entregables, responsables, un kanban y una automatización que avisa al vencer cada entregable. La guardaron como plantilla «Proyecto de consultoría». Cada cliente nuevo arranca con su lista en un minuto, idéntica a las demás, y el tablero de dirección compara todas con los mismos campos.',
            },
            { t: 'h', text: 'Buenas prácticas' },
            {
                t: 'cards',
                items: [
                    { icon: 'PenLine', title: 'Un nombre que diga para qué es', md: '«Proyecto de consultoría» dice más que «Lista 3». La descripción es lo que ve quien elige la plantilla en la galería.', tone: 'blue' },
                    { icon: 'ListChecks', title: 'Ejemplos que enseñen', md: 'Dos o tres registros de ejemplo bien llenados explican mejor que cualquier manual cómo se usa la lista.', tone: 'mint' },
                    { icon: 'Shield', title: 'Ajustes incluidos', md: 'Si la lista tiene permisos por rol o una ficha diseñada, incluye los **Ajustes**: la lista nueva nace igual de protegida y con la misma ficha.', tone: 'violet' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quién ve mis plantillas?', a: 'Todas las personas de tu empresa que pueden crear listas. No se comparten con otras empresas.' },
                    { q: '¿También hay plantillas de tableros y automatizaciones?', a: 'Sí, cada una en su sección: en **Nuevo dashboard** y en el botón **Desde plantilla** de las automatizaciones de una lista.' },
                    { q: '¿Puedo guardar como plantilla varias listas relacionadas juntas?', a: 'Desde la configuración se guarda una lista por vez. Las plantillas de la galería general sí traen packs de varias listas vinculadas (como Facturación).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Crear una lista desde plantilla', article: 'listas-y-campos-crear' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'importar-exportar-duplicar',
        route: '/lists',
        related: ['importar-exportar-plantillas', 'listas-y-campos-crear', 'importar-exportar-exportar'],
        blocks: [
            {
                t: 'p',
                md: '**Duplicar** crea una copia de una lista que ya tienes, con sus campos siempre y, si quieres, con sus vistas, automatizaciones, ajustes y registros. Es la forma más rápida de abrir una lista igual para una sede nueva, un año nuevo o una prueba, sin tocar la original.',
            },
            { t: 'anim', key: 'ie-duplicar', caption: 'Se duplica «Clientes Bogotá» como «Clientes Medellín», con vistas, automatizaciones y ajustes, sin los registros.' },
            { t: 'h', text: 'Tres caminos al mismo lugar' },
            {
                t: 'cards',
                items: [
                    { icon: 'Settings', title: 'Desde la configuración', md: 'Pestaña **General** → **Duplicar lista**.', tone: 'blue' },
                    { icon: 'List', title: 'Desde el panel lateral', md: 'Menú «…» de la lista → **Duplicar**.', tone: 'violet' },
                    { icon: 'Copy', title: 'Desde «Nueva lista»', md: 'Pestaña **Duplicar**, donde además eliges la **Lista a duplicar**.', tone: 'mint' },
                ],
            },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'Abre **Duplicar lista** por cualquiera de los tres caminos.',
                    'Escribe el **Nombre de la copia** (por defecto, el mismo nombre con «(copia)»).',
                    'En **Incluir**, marca lo que quieres llevar. Los campos van siempre.',
                    'Toca **Duplicar**. La copia aparece en el panel, en la misma carpeta que la original.',
                ],
            },
            { t: 'demo', key: 'ie-duplicar', caption: 'El diálogo de duplicar desde la configuración de la lista.', fallback: 'ie-duplicar' },
            {
                t: 'settings',
                title: 'Qué puedes incluir',
                rows: [
                    { name: 'Vistas guardadas', what: 'Las pestañas de vistas con sus filtros, columnas y agrupaciones.' },
                    { name: 'Automatizaciones', what: 'Todas las de la lista. Las de webhook entrante reciben un enlace nuevo, para que no se mezclen con las de la original.', tip: 'Revísalas en la copia: si mandan correos o mensajes, quizá quieras pausarlas mientras pruebas.' },
                    { name: 'Ajustes', what: 'Permisos por rol, apariencia y plantillas de ficha. La publicación pública no se copia.' },
                    { name: 'Registros', what: 'Hasta 500. Los archivos adjuntos no se copian.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: '¿Duplicar o plantilla?',
                md: '**Duplicar** sirve para una copia puntual, ahora. Si vas a crear la misma lista muchas veces (una por cliente, una por sede), guárdala como **plantilla**: queda en la galería para todo el equipo.',
            },
            {
                t: 'example',
                title: 'Una red de colegios',
                md: 'Tenían «Matrículas 2026» con sus campos, su kanban por estado y una automatización de bienvenida. Para el año siguiente la duplicaron como «Matrículas 2027» con vistas, automatizaciones y ajustes pero sin registros: el equipo empezó a recibir matrículas el mismo día, y la lista del año anterior quedó intacta para consultas.',
            },
            { t: 'h', text: 'Duplicar para probar sin riesgo' },
            {
                t: 'p',
                md: 'Antes de cambiar algo grande en una lista que usa todo el equipo —convertir el tipo de un campo, rehacer las automatizaciones, reorganizar el kanban—, duplícala con sus registros y prueba en la copia. Cuando el cambio funciona, lo haces en la original con la seguridad de que no rompes nada. Después mandas la copia a la papelera.',
            },
            {
                t: 'steps',
                items: [
                    'Duplica la lista marcando **Registros** (hasta 500) y, si vas a tocar automatizaciones, **Automatizaciones**.',
                    'En la copia, pausa las automatizaciones que mandan correos o mensajes, para que tus pruebas no les lleguen a los clientes.',
                    'Haz el cambio y revisa el resultado en la tabla, las vistas y los tableros.',
                    'Repite el cambio en la lista original y elimina la copia (queda 30 días en la papelera por si acaso).',
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿La copia queda vinculada a la original?', a: 'No: son independientes. Lo que cambies en una no afecta a la otra.' },
                    { q: 'Necesito copiar más de 500 registros.', a: 'Duplica sin registros, exporta la original a Excel e importa el archivo en la copia.' },
                    { q: '¿Se copian los formularios públicos?', a: 'La publicación pública no viaja. Revisa en la copia, en la pestaña **Formularios**, qué necesitas publicar de nuevo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Guardar como plantilla', article: 'importar-exportar-plantillas' },
                ],
            },
        ],
    },
];
