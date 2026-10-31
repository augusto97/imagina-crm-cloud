import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'lote-hoja-de-calculo',
        route: '/lists',
        related: ['lote-copiar-pegar', 'lote-editar-en-lote', 'vistas-tabla'],
        blocks: [
            {
                t: 'p',
                md: 'La tabla de una lista funciona como una hoja de cálculo: haces clic en una celda y queda **elegida** (con un borde de color), te mueves con las flechas, escribes para cambiarla y eliges rangos con el mouse o el teclado. Lo que elijas lo puedes copiar, pegar, rellenar o borrar de una vez.\n\nPara cambiar muchos **registros** completos (por ejemplo, subir el precio de 300 productos) hay otra herramienta: **Editar en lote**. Las dos se combinan: eliges filas, editas en lote, y si algo quedó mal, lo corriges celda por celda.',
            },
            { t: 'anim', key: 'lote-seleccion', caption: 'Un clic elige la celda, Mayús + clic elige un rango y abajo aparecen la suma y el promedio.' },
            { t: 'h', text: 'Elegir y editar celdas' },
            {
                t: 'steps',
                items: [
                    'Haz **un clic** en una celda para elegirla. Todavía no se edita: así puedes copiarla o moverte sin cambiar nada por accidente.',
                    'Para editarla haz **doble clic**, pulsa **Enter** o **F2**, o simplemente **empieza a escribir**: lo que tecleas reemplaza el valor. En una selección, escribir abre el buscador de opciones con esa letra.',
                    '**Enter** guarda y baja a la celda de abajo. **Tab** guarda y va a la de la derecha. **Escape** descarta lo escrito.',
                    'La casilla de verificación y las estrellas de calificación se cambian con un solo clic.',
                    'Un clic en el **título** de la fila abre el registro. Con la celda del título elegida, **Enter** también lo abre.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: '¿Prefieres editar con un clic?',
                md: 'En **Personalizar vista → Mostrar** enciende **Editar con un click**: un clic abre el editor de la celda directamente. Con ese modo, para elegir celdas y copiar usa **Mayús + clic**, arrastra o haz clic derecho.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si escribes un valor que el campo no acepta (por ejemplo, letras en un monto), un globo junto a la celda lo avisa y no se guarda. Los números se escriben con el formato de tu empresa: «1.250.000» o «1.250,50».',
            },
            { t: 'h', text: 'Elegir rangos' },
            {
                t: 'p',
                md: '- **Mayús + clic** en otra celda: elige todo el rectángulo entre las dos.\n- **Arrastrar** con el mouse sobre las celdas.\n- **Mayús + flechas**: amplía el rango desde el teclado.\n- **Ctrl + A** (⌘ + A en Mac): elige toda la tabla.\n- **Escape**: suelta la selección.',
            },
            { t: 'h', text: 'La barra de la selección: suma y promedio' },
            {
                t: 'p',
                md: 'Cuando eliges varias celdas, abajo aparece una barra con cuántas celdas elegiste y, si hay números, su **Suma** y su **Promedio**, como en Excel. También recuerda los atajos: copiar, cortar, pegar y «clic derecho: más».',
            },
            {
                t: 'example',
                title: 'Una distribuidora de alimentos',
                md: 'El jefe de bodega elige con Mayús + clic la columna **Unidades** de los pedidos de la semana: la barra dice **Suma: 1.284**. Sin fórmulas ni exportar a Excel sabe cuánto tiene que despachar.',
            },
            { t: 'h', text: 'Elegir filas completas' },
            {
                t: 'p',
                md: 'Al pasar el mouse por una fila aparece una **casilla** a la izquierda: márcala para elegir el registro entero. La casilla del encabezado (**Seleccionar todos**) marca todas las filas de la página. Mientras haya filas marcadas, abajo aparece la **barra de acciones** con **Editar en lote**, **Mover**, **Duplicar**, **Eliminar** y, según la lista, **Asignar** y **Presionar** (para campos botón).',
            },
            { t: 'demo', key: 'lote-seleccionar-filas', caption: 'Marcar filas y abrir la barra de acciones.', fallback: 'lote-seleccion' },
            {
                t: 'keys',
                items: [
                    { keys: ['↑', '↓', '←', '→'], what: 'Moverte entre celdas' },
                    { keys: ['Tab'], what: 'A la celda de la derecha (Mayús + Tab, a la izquierda)' },
                    { keys: ['Inicio', 'Fin'], what: 'Al principio o al final de la fila' },
                    { keys: ['Enter'], what: 'Editar la celda (en el título, abrir el registro)' },
                    { keys: ['F2'], what: 'Editar la celda' },
                    { keys: ['Mayús', '↑ ↓ ← →'], what: 'Ampliar el rango elegido' },
                    { keys: ['Ctrl', 'A'], what: 'Elegir toda la tabla' },
                    { keys: ['Supr'], what: 'Vaciar las celdas elegidas' },
                    { keys: ['Esc'], what: 'Descartar la edición o soltar la selección' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué no puedo editar una columna?', a: 'Algunas columnas no se escriben a mano: los cálculos, las fórmulas, los resúmenes de otra lista, los ID automáticos, los campos con IA o lo que bloquea una tienda conectada. Al intentarlo, la app dice por qué.' },
                    { q: '¿Funciona en la vista agrupada?', a: 'Sí: eliges, copias, pegas y editas igual. Lo único distinto es que pegar no crea filas nuevas.' },
                    { q: '¿Y en el celular?', a: 'Un toque elige la celda y el segundo toque la edita.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Copiar, pegar y rellenar', article: 'lote-copiar-pegar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'lote-copiar-pegar',
        route: '/lists',
        related: ['lote-hoja-de-calculo', 'lote-editar-en-lote', 'lote-historial-deshacer'],
        blocks: [
            {
                t: 'p',
                md: 'Copiar y pegar es la forma más rápida de cargar o corregir datos que ya tienes en otro lado: una lista de precios en Excel, teléfonos de una planilla de Google, notas de un correo. La app entiende lo que pegas como lo leería una persona: «30/07/2026» es una fecha, «$ 1.250.000» es un monto, «Alta» es una opción y «Ana Pérez» es una persona del equipo.',
            },
            { t: 'anim', key: 'lote-pegar', caption: 'Un bloque copiado de Excel se pega en la tabla; lo que no encaja se revisa antes de aplicar.' },
            { t: 'h', text: 'Copiar y cortar' },
            {
                t: 'steps',
                items: [
                    'Elige una celda o un rango.',
                    'Pulsa **Ctrl + C** (⌘ + C en Mac) para copiar, o **Ctrl + X** para cortar. Lo cortado queda marcado con un borde punteado; Escape lo cancela.',
                    'Lo copiado se puede pegar en la misma tabla (conserva todo) o en Excel y Google Sheets: sale con las etiquetas de las opciones, las fechas y números con tu formato y los nombres de las personas.',
                ],
            },
            { t: 'h', text: 'Pegar, con revisión antes de aplicar' },
            {
                t: 'steps',
                items: [
                    'Elige la celda donde empieza el pegado (la de arriba a la izquierda).',
                    'Pulsa **Ctrl + V**. Si todo encaja, se pega al instante.',
                    'Si algo no encaja, se abre **Revisa antes de pegar**: dice «Pegaste un bloque de N × M» y lista, celda por celda, lo que no se puede pegar y por qué (un valor que el campo no acepta, una columna que no se escribe a mano, un valor repetido en un campo que no admite repetidos).',
                    'Si hay opciones que no existen en un campo de selección, puedes marcar **Agregar las opciones que no existen** (si tienes permiso sobre los campos).',
                    'Si el bloque trae más filas de las que hay debajo, la app ofrece **Pegar y crear N registros** con las filas sobrantes.',
                    'Toca **Pegar**. Lo que no se pudo queda marcado en rojo con el motivo y un resumen lo cuenta.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Una sola celda copiada llena todo el rango',
                md: 'Copia una celda («Pagada»), elige un rango de 40 celdas y pega: las 40 quedan «Pagada». Es la forma más rápida de poner el mismo valor en muchas filas.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'En una vista **agrupada** no se crean filas al pegar (quedarían en otro grupo). Para cargar filas nuevas, pega en la vista sin agrupar.',
            },
            { t: 'h', text: 'Rellenar hacia abajo y series' },
            { t: 'anim', key: 'lote-rellenar', caption: 'El asa de la esquina continúa la serie: Cuota 1, Cuota 2… y las fechas mes a mes.' },
            {
                t: 'p',
                md: 'En la esquina inferior derecha de la celda elegida hay un **asa** (un cuadradito). Arrástrala hacia abajo para rellenar: verás una vista previa antes de soltar. También puedes elegir el rango y pulsar **Ctrl + D**.\n\nSi eliges una sola celda, se copia. Si eliges dos o más que forman una serie, **la serie continúa**:\n\n- **Números**: 10, 20 → 30, 40, 50.\n- **Fechas**: día a día, mes a mes (respetando el fin de mes) y fecha con hora.\n- **Textos que terminan en número**: «Cuota 1», «Cuota 2» → «Cuota 3», «Cuota 4».',
            },
            { t: 'h', text: 'Deshacer y rehacer' },
            {
                t: 'p',
                md: 'Cada cambio en la tabla (una edición, un pegado, un relleno, un borrado) es un paso que se puede deshacer, **hasta 50 pasos**:\n\n- **Ctrl + Z**: deshace.\n- **Ctrl + Mayús + Z** o **Ctrl + Y**: rehace.\n\nDeshacer **no pisa** lo que otra persona cambió después en esas celdas: si alguien tocó un registro en el medio, esa parte se deja como está y un aviso lo dice. Dentro de un editor abierto, Ctrl + Z deshace lo que estás escribiendo.',
            },
            { t: 'h', text: 'El menú de la celda (clic derecho)' },
            {
                t: 'settings',
                title: 'Clic derecho sobre una celda o un rango',
                rows: [
                    { name: 'Editar celda', what: 'Abre el editor de la celda.' },
                    { name: 'Cortar · Copiar · Pegar', what: 'Lo mismo que Ctrl + X, C y V. La selección sigue marcada mientras el menú está abierto.' },
                    { name: 'Borrar contenido', what: 'Vacía las celdas elegidas (también con Supr).' },
                    { name: 'Rellenar hacia abajo', what: 'Copia o continúa la serie (Ctrl + D).' },
                    { name: 'Deshacer · Rehacer', what: 'El último cambio de la tabla.' },
                    { name: 'Abrir registro · Copiar enlace · Copiar ID', what: 'Del registro de esa fila.' },
                    { name: 'Crear subtarea · Duplicar', what: 'Una subtarea debajo de ese registro, o una copia al instante (con o sin sus subtareas, si tiene).' },
                    { name: 'Agregar una columna · Eliminar', what: 'Un campo nuevo, o mandar el registro a la papelera.' },
                ],
            },
            { t: 'demo', key: 'lote-menu-celda', caption: 'El menú de una celda con clic derecho.', fallback: 'lote-pegar' },
            {
                t: 'example',
                title: 'Una ferretería que actualiza precios',
                md: 'El proveedor manda la lista nueva en Excel. El encargado ordena la tabla de **Productos** igual que el archivo, copia la columna de precios en Excel y la pega en **Precio**. La revisión avisa que tres celdas dicen «consultar» (no es un número): las corrige a mano después. Si se equivocó de columna, Ctrl + Z.',
            },
            {
                t: 'example',
                title: 'Un colegio que carga cuotas',
                md: 'Para un estudiante nuevo, la secretaria escribe «Cuota 1» con su fecha y monto, elige esa fila y la de «Cuota 2», y arrastra el asa diez filas hacia abajo: quedan las 10 cuotas con su número y su fecha mes a mes.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'El navegador no me deja pegar desde el menú.', a: 'Algunos navegadores bloquean leer el portapapeles desde un menú. Usa Ctrl + V (⌘ + V) y funciona siempre.' },
                    { q: '¿Puedo pegar una persona por su nombre?', a: 'Sí, por su nombre o su email, si es del equipo. Si hay dos con el mismo nombre, la revisión te pide elegir en la celda.' },
                    { q: '¿Para cargar cientos de filas nuevas conviene pegar?', a: 'Para unas decenas, sí. Para muchas, usa **Importar** con el archivo completo: crea campos y avisa errores por fila.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Editar en lote', article: 'lote-editar-en-lote' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'lote-editar-en-lote',
        route: '/lists',
        related: ['lote-recetas', 'lote-historial-deshacer', 'lote-estructura'],
        blocks: [
            {
                t: 'p',
                md: '**Editar en lote** cambia muchos registros de una vez con operaciones que **parten del valor de cada uno**: «subir 10 %» sube cada precio un 10 %, no pone el mismo número en todos. Puedes encadenar varios cambios (subir, después redondear), ver una **vista previa** con el antes y el después, y aplicarlo a los registros elegidos o a **todos los que coinciden con la vista** (hasta 5.000).\n\nTodo queda en el historial y se puede deshacer.',
            },
            { t: 'anim', key: 'lote-editar', caption: 'Subir 10 % y redondear a «terminar en 900»: la vista previa muestra cada precio antes y después.' },
            { t: 'h', text: 'Cómo se hace' },
            {
                t: 'steps',
                items: [
                    'Marca las filas que quieres cambiar y toca **Editar en lote** en la barra de abajo. Para cambiar todo lo que coincide con los filtros, abre **Personalizar vista → Edición masiva**.',
                    'En **A qué registros** confirma: **Los N seleccionados** o **Todos los que coinciden con la vista (N)**.',
                    'Elige la **Columna** y **Qué hacer** con ella, y completa el valor.',
                    'Si quieres más cambios, toca **Agregar otro cambio**. Se aplican **en orden**: cada uno parte del resultado del anterior. Ordénalos con **Subir** y **Bajar**.',
                    'Toca **Ver vista previa**.',
                    'Revisa los números: **Van a cambiar**, **Ya estaban así** y **No se pueden cambiar** (con el motivo de cada uno), y la tabla **Así quedan** con **Antes** y **Después**.',
                    'Toca **Aplicar a N registros**. Se aplica en tandas con una barra de avance («Aplicando… 200 de 1.340»). No cierres la ventana hasta que termine.',
                    'Al final ves cuántos se actualizaron y un botón **Deshacer**, por si acaso.',
                ],
            },
            { t: 'demo', key: 'lote-edicion-masiva', caption: 'Subir un 10 % los precios de los productos elegidos.', fallback: 'lote-editar' },
            { t: 'h', text: 'Qué se puede hacer con cada tipo de columna' },
            {
                t: 'settings',
                title: 'Operaciones disponibles',
                rows: [
                    { name: 'Números, montos, porcentajes, duraciones', what: '**Poner este valor**, **Vaciar**, **Sumar**, **Restar**, **Multiplicar por**, **Dividir por**, **Subir o bajar un porcentaje**, **Redondear**, **Calcular con otras columnas** y **Copiar de otra columna**.' },
                    { name: 'Texto', what: '**Poner este valor**, **Vaciar**, **Agregar texto al inicio**, **Agregar texto al final**, **Buscar y reemplazar** (con **Distinguir mayúsculas y minúsculas**), **Mayúsculas y minúsculas**, **Quitar espacios de sobra** y **Copiar de otra columna**.' },
                    { name: 'Email, enlace, teléfono', what: 'Poner, vaciar, buscar y reemplazar, ajustar mayúsculas, quitar espacios y copiar (según el tipo).' },
                    { name: 'Selección', what: '**Poner este valor**, **Vaciar**, **Copiar de otra columna**.' },
                    { name: 'Varias opciones (etiquetas)', what: '**Agregar opciones** y **Quitar opciones** sin tocar las demás, además de poner y vaciar.', tip: 'Para sumar la etiqueta «VIP» a 80 clientes sin borrarles las que ya tienen.' },
                    { name: 'Casilla', what: '**Marcar o desmarcar** e **Invertir (marcado ↔ sin marcar)**.' },
                    { name: 'Fecha y fecha con hora', what: '**Poner este valor**, **Vaciar**, **Correr la fecha** (adelante o atrás en minutos, horas, días, semanas, meses o años), **Poner la fecha de hoy** y copiar.' },
                    { name: 'Persona', what: 'Poner a alguien, vaciar o copiar de otra columna.' },
                    { name: 'Equipo', what: 'Poner, vaciar, **Agregar equipos** o **Quitar equipos**.' },
                    { name: 'Relación', what: 'Poner, vaciar, **Vincular registros** y **Desvincular registros**.' },
                    { name: 'Archivo', what: '**Vaciar**.' },
                ],
            },
            { t: 'h', text: 'Redondear a una «grilla»' },
            {
                t: 'p',
                md: '**Redondear** lleva cada número al múltiplo más cercano que elijas, **hacia donde elijas**, y le suma un ajuste:\n\n- **Hacia dónde**: **Al más cercano**, **Hacia arriba** (nunca baja un precio) o **Hacia abajo**.\n- **a múltiplos de** 1.000 **más** −100 → cada precio queda terminado en 900 (24.320 → 24.900).\n\nHay atajos listos: **Terminar en 900**, **A miles**, **A cientos**, **Terminar en ,99** y **Sin decimales**.',
            },
            { t: 'h', text: 'Calcular con otras columnas' },
            {
                t: 'p',
                md: 'Con **Calcular con otras columnas** armas una cuenta con dos lados: **Primer valor** (una columna o un número), la **Operación** (+, −, ×, ÷) y el **Segundo valor**. Por ejemplo, **Precio** = **Costo** × 1,3. Se calcula con los valores de cada registro.',
            },
            { t: 'h', text: 'Lo que hay que saber' },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Un registro con error no se cambia a medias',
                md: 'Si un cambio no se puede aplicar a un registro (falta el dato para calcular, el resultado no es válido para el campo, la tienda conectada no lo permite), ese registro queda **igual en todas sus columnas** y aparece en **No se pueden cambiar** con el motivo.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Cada cambio pasa por las mismas reglas que una edición a mano: permisos de la lista, validaciones de los campos, la actividad del registro y las **automatizaciones** que se disparan al actualizar.',
            },
            { t: 'h', text: 'Actualizar desde un archivo' },
            {
                t: 'p',
                md: 'Si los cambios vienen en un Excel o CSV (la lista de precios del proveedor, el inventario contado), usa **Personalizar vista → Actualizar desde un archivo**. Cada fila del archivo se empareja con un registro por una columna clave (el **ID**, el SKU, el email…), y eliges qué columnas actualizar. También tiene vista previa (**Cambian**, **Ya estaban así**, **Sin registro**, **Con error**), la opción **Crear los que no existen** y queda en el historial para deshacer.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo editar en lote todos los registros de la lista?', a: 'Sí: quita los filtros de la vista y usa **Edición masiva** desde **Personalizar vista**, con «Todos los que coinciden con la vista». Hasta 5.000 por vez.' },
                    { q: '¿Quién puede editar en lote?', a: 'Para lo que elegiste, quien puede editar esos registros. Para «todos los que coinciden con la vista» hace falta el permiso de acciones masivas.' },
                    { q: '¿Y si me equivoqué?', a: 'Toca **Deshacer** al terminar, o búscalo después en **Historial de ediciones masivas** (30 días).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver recetas listas', article: 'lote-recetas' },
                    { label: 'El historial y Deshacer', article: 'lote-historial-deshacer' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'lote-recetas',
        route: '/lists',
        related: ['lote-editar-en-lote', 'lote-copiar-pegar', 'lote-historial-deshacer'],
        blocks: [
            {
                t: 'p',
                md: 'Estas son combinaciones de **Editar en lote** que resuelven tareas reales en minutos. Todas se arman con **Agregar otro cambio** y se revisan con **Ver vista previa** antes de aplicar.',
            },
            { t: 'anim', key: 'lote-recetas', caption: 'Precio = Costo × 1,35 y después «Terminar en 900»: un precio de lista nuevo para todo el catálogo.' },
            { t: 'h', text: 'Precios y montos' },
            {
                t: 'cards',
                items: [
                    { icon: 'TrendingUp', title: 'Subir precios por inflación', md: '**Precio** → **Subir o bajar un porcentaje** 8 → **Redondear** **Terminar en 900**. Cada precio sube un 8 % y queda «bonito».', tone: 'amber' },
                    { icon: 'Calculator', title: 'Precio desde el costo', md: '**Precio** → **Calcular con otras columnas**: **Costo** × 1,35 → **Redondear** **A cientos**, **Hacia arriba**.', tone: 'violet' },
                    { icon: 'Percent', title: 'Descuento de temporada', md: 'Filtra «Categoría es Invierno», y en **Precio rebajado** → **Copiar de otra columna** **Precio** → **Subir o bajar un porcentaje** −20.', tone: 'rose' },
                    { icon: 'DollarSign', title: 'Quitar decimales', md: '**Monto** → **Redondear** **Sin decimales**, al más cercano. Ideal tras importar montos en dólares convertidos.', tone: 'mint' },
                ],
            },
            {
                t: 'example',
                title: 'Una tienda de ropa',
                md: 'Antes de la temporada, la dueña filtra **Productos** por «Colección es Verano 2026», abre **Edición masiva** y encadena: **Precio** subir 12 %, **Precio** redondear hacia arriba a múltiplos de 1.000 más −100, y **Etiquetas** agregar «Nueva temporada». La vista previa muestra «Camiseta básica: $ 39.900 → $ 44.900». Aplica a 214 productos en menos de un minuto.',
            },
            { t: 'h', text: 'Fechas y plazos' },
            {
                t: 'cards',
                items: [
                    { icon: 'CalendarClock', title: 'Correr vencimientos', md: '**Vencimiento** → **Correr la fecha**, **Adelante** 15 **días**. Para dar una prórroga a todas las facturas de un cliente.', tone: 'blue' },
                    { icon: 'Calendar', title: 'Reprogramar un proyecto', md: 'Elige las tareas del proyecto → **Inicio** y **Entrega** → **Correr la fecha** **Adelante** 1 **semanas**.', tone: 'cyan' },
                    { icon: 'CheckCircle2', title: 'Cerrar con fecha de hoy', md: '**Estado** → **Poner este valor** «Cerrado» y **Fecha de cierre** → **Poner la fecha de hoy**.', tone: 'mint' },
                ],
            },
            { t: 'h', text: 'Textos y datos de contacto' },
            {
                t: 'cards',
                items: [
                    { icon: 'Type', title: 'Nombres prolijos', md: '**Nombre** → **Quitar espacios de sobra** → **Mayúsculas y minúsculas** **Cada Palabra Con Mayúscula**. «  ana  PÉREZ» queda «Ana Pérez».', tone: 'violet' },
                    { icon: 'Mail', title: 'Emails en minúscula', md: '**Email** → **Mayúsculas y minúsculas** **todo en minúsculas**. Evita duplicados por mayúsculas.', tone: 'blue' },
                    { icon: 'Hash', title: 'Un prefijo para los códigos', md: '**Código de cliente** → **Agregar texto al inicio** «CLI-». «0451» queda «CLI-0451».', tone: 'mint' },
                    { icon: 'PenLine', title: 'Cambiar un nombre en todos lados', md: '**Proyecto** → **Buscar y reemplazar** «Sede Norte» por «Sede Chapinero».', tone: 'amber' },
                ],
            },
            { t: 'h', text: 'Organizar y repartir' },
            {
                t: 'cards',
                items: [
                    { icon: 'Tag', title: 'Etiquetar sin borrar', md: '**Etiquetas** → **Agregar opciones** «VIP». Las que ya tenía cada cliente se conservan. **Quitar opciones** hace lo contrario.', tone: 'rose' },
                    { icon: 'UserCheck', title: 'Asignar a una persona', md: 'Elige las filas → **Asignar** en la barra (abre la edición con el campo de persona ya elegido).', tone: 'violet' },
                    { icon: 'Users', title: 'Pasar a un equipo', md: '**Equipo** → **Agregar equipos** «Soporte nivel 2».', tone: 'cyan' },
                    { icon: 'Link2', title: 'Vincular a un cliente', md: '**Cliente** → **Vincular registros**: elige el cliente y quedan vinculados todos los pedidos elegidos.', tone: 'blue' },
                ],
            },
            {
                t: 'example',
                title: 'Una academia de idiomas',
                md: 'Al empezar el semestre, la coordinadora filtra **Estudiantes** por «Nivel es A2 **Y** Aprobó es Sí» y encadena: **Nivel** poner «B1», **Etiquetas** quitar «Repite», **Inicio de clases** poner 03/02/2027. Cien estudiantes promovidos en una sola edición, y si se equivocó de filtro, **Deshacer**.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Primero filtra, después edita',
                md: 'La mejor edición masiva empieza con una buena vista: filtra exactamente los registros que quieres tocar, revisa el número en «Todos los que coinciden con la vista (N)» y recién después aplica.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'También se puede programar',
                md: 'Si un cambio se repite (subir precios cada mes, marcar como vencido lo atrasado cada noche), crea una automatización programada con la acción **Editar en lote**. Corre sola y también queda en el historial para deshacer.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué en la vista previa algunos dicen «Ya estaban así»?', a: 'Porque el resultado es igual al valor actual. No se tocan ni cuentan como cambio.' },
                    { q: '¿Qué pasa si una fila no tiene costo para calcular?', a: 'Esa fila aparece en **No se pueden cambiar** con el motivo, y queda como estaba.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Cómo se edita en lote', article: 'lote-editar-en-lote' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'lote-estructura',
        route: '/lists',
        related: ['lote-editar-en-lote', 'lote-papelera', 'fichas-subtareas-y-checklists'],
        blocks: [
            {
                t: 'p',
                md: 'Además de cambiar valores, la barra de acciones mueve, duplica, asigna y elimina muchos registros a la vez. Mover y eliminar tienen vista previa; duplicar es al instante. Todo se puede deshacer desde el historial.',
            },
            { t: 'anim', key: 'lote-estructura', caption: 'Tres tareas sueltas se mueven como subtareas de «Lanzamiento del sitio».' },
            { t: 'h', text: 'La barra de acciones' },
            {
                t: 'p',
                md: 'Marca las filas con sus casillas: abajo aparece la barra con **N seleccionados** y estas acciones. La **×** (Limpiar selección) las desmarca.',
            },
            {
                t: 'settings',
                title: 'Acciones de la barra',
                rows: [
                    { name: 'Editar en lote', what: 'Cambia valores con operaciones y vista previa.' },
                    { name: 'Asignar', what: 'Atajo de la edición masiva con el campo de persona ya elegido (por ejemplo, «Asignar «Responsable»»). Aparece si la lista tiene un campo de persona.' },
                    { name: 'Presionar', what: 'Presiona un campo **Botón** en todos los registros elegidos (por ejemplo, «Marcar como pagado»).' },
                    { name: 'Mover', what: 'Convierte los registros en **subtareas** de otro, o los saca al primer nivel.' },
                    { name: 'Duplicar', what: 'Crea las copias al instante, con sus subtareas. Un aviso dice cómo salió y trae **Deshacer**.' },
                    { name: 'Eliminar', what: 'Los manda a la papelera con sus subtareas.' },
                ],
            },
            { t: 'h', text: 'Mover como subtareas' },
            {
                t: 'steps',
                items: [
                    'Marca los registros y toca **Mover**.',
                    'En **¿Debajo de qué registro?** toca **Elegir un registro…** y búscalo. O elige **Sacarlos al primer nivel** para que dejen de ser subtareas.',
                    'Toca **Ver vista previa**: dice cuántos **Se mueven** y cuáles **No se pueden** y por qué.',
                    'Toca **Mover N registros**.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Un solo nivel de subtareas',
                md: 'Una subtarea no puede tener subtareas: el registro padre tiene que ser de primer nivel, y un registro que ya tiene subtareas no se puede mover debajo de otro. La vista previa lo avisa.',
            },
            { t: 'h', text: 'Duplicar' },
            {
                t: 'p',
                md: 'Toca **Duplicar** y listo: no hay pasos ni vista previa. Las copias aparecen en la tabla y un aviso abajo dice cuántas se crearon (y cuántas subtareas venían con ellas); se cierra solo. Si algo no se pudo, el aviso lo dice en rojo con el motivo, por ejemplo el límite de registros de tu plan. ¿Te equivocaste? Toca **Deshacer** en el mismo aviso: se borran las copias que nadie editó.\n\nSe copian los datos que se escriben a mano; los calculados se recalculan solos, y los archivos y los vínculos con otras listas no se copian. Una subtarea copiada queda debajo del mismo registro.\n\nPara copiar **un solo registro**, también sirve el clic derecho sobre la fila: **Duplicar**. Si el registro tiene subtareas, el menú ofrece **Duplicar con sus subtareas** y **Duplicar sin subtareas**.',
            },
            { t: 'anim', key: 'duplicar-rapido', caption: 'Clic derecho, «Duplicar»: la copia aparece y el aviso se cierra solo.' },
            {
                t: 'example',
                title: 'Una agencia que repite campañas',
                md: 'Cada mes la agencia arma la campaña de un cliente con las mismas 12 tareas y sus subtareas. Marca las del mes pasado y toca **Duplicar**: las 12 se copian con sus subtareas. Después, con **Editar en lote**, corre las fechas un mes y vacía el estado.',
            },
            { t: 'h', text: 'Eliminar en lote' },
            {
                t: 'p',
                md: 'Toca **Eliminar**, revisa la vista previa y confirma. Los registros (con sus subtareas) van a la **papelera** y se pueden recuperar durante 30 días, enteros: con sus subtareas, vínculos, archivos y comentarios. También se pueden recuperar todos juntos desde el historial de ediciones masivas.\n\nPara borrar **todo lo que coincide con un filtro** sin marcar fila por fila, usa **Personalizar vista → Eliminar lo que coincide**.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo mover registros a otra lista?', a: 'No con estas acciones: «Mover» los ordena como subtareas dentro de la misma lista. Para pasar datos a otra lista, exporta e importa.' },
                    { q: '¿Las listas de una tienda conectada se pueden reestructurar?', a: 'No: en esas listas la tienda manda, así que no se crean, borran ni mueven registros desde la app.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'La papelera', article: 'lote-papelera' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'lote-historial-deshacer',
        route: '/lists',
        related: ['lote-editar-en-lote', 'lote-papelera', 'lote-copiar-pegar'],
        blocks: [
            {
                t: 'p',
                md: 'Cada edición masiva —a mano, desde un archivo, una estructura en lote o una automatización programada— queda en el **Historial de ediciones masivas** de la lista durante **30 días**, con lo que cambió en cada registro. Desde ahí cualquiera se puede deshacer, aunque haya pasado una semana.',
            },
            { t: 'anim', key: 'lote-deshacer', caption: 'Deshacer «Precio: subir 10 %»: 219 registros vuelven atrás y el que alguien cambió después se respeta.' },
            { t: 'h', text: 'Abrir el historial' },
            {
                t: 'steps',
                items: [
                    'En la lista, abre **Personalizar vista** y toca **Historial de ediciones masivas**.',
                    'Verás cada edición en lenguaje claro («Precio: subir 10 % · Stock: sumar 5»), quién la hizo (o **Automatización**), cuándo y a cuántos registros.',
                    'Las que ya se deshicieron dicen **Deshecha** o **Deshecha en parte**.',
                ],
            },
            { t: 'demo', key: 'lote-historial', caption: 'El historial de ediciones masivas de una lista.', fallback: 'lote-deshacer' },
            { t: 'h', text: 'Deshacer sin pisar a nadie' },
            {
                t: 'steps',
                items: [
                    'Toca **Deshacer** en la edición. La app revisa cómo están hoy esos registros.',
                    'Ves cuántos **Vuelven atrás**, cuántos **Cambiaron después** (alguien los tocó después de la edición) y cuántos **Ya no existen**.',
                    'Los que cambiaron después **se dejan como están**, salvo que marques **Volverlos atrás igual** (se pierde lo que se cambió después en esas columnas).',
                    'Confirma con **Volver atrás N registros** (dice cuántos). Se aplica en tandas con avance y al final ves «Se volvieron atrás N registros».',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'También al terminar',
                md: 'Al terminar una edición masiva, el resumen trae su propio botón **Deshacer**. Es lo mismo que buscarla en el historial.',
            },
            {
                t: 'settings',
                title: 'Qué se puede deshacer',
                rows: [
                    { name: 'Edición masiva', what: 'Los valores vuelven a como estaban.' },
                    { name: 'Actualizar desde un archivo', what: 'Todo lo que cambió el archivo, y los registros que creó.' },
                    { name: 'Mover', what: 'Cada registro vuelve a su padre anterior (respetando al que alguien movió después).' },
                    { name: 'Duplicar', what: 'Se borran las copias que nadie tocó.' },
                    { name: 'Eliminar', what: 'Los registros vuelven enteros, con sus subtareas y vínculos.' },
                    { name: 'Automatización «Editar en lote»', what: 'Igual que una edición a mano; aparece con el autor «Automatización».' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Permisos',
                md: 'Tus propias ediciones las deshaces siempre. Las de otra persona, las de una automatización y las de una tienda conectada requieren el permiso de acciones masivas. Deshacer también deja su rastro en la bitácora.',
            },
            {
                t: 'example',
                title: 'Una cadena de cafeterías',
                md: 'El lunes alguien subió un 10 % los precios de **todos** los productos en vez de sólo los de la sede centro. El martes, al notarlo, la administradora abre el historial, toca **Deshacer** en esa edición y ve que 3 productos cambiaron después (se les corrigió el precio a mano): los deja como están. Los otros 219 vuelven a su precio anterior.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Las ediciones celda por celda aparecen aquí?', a: 'No: esas se deshacen con Ctrl + Z mientras estás en la tabla, y quedan en la actividad de cada registro con el **historial del campo** para restaurar un valor.' },
                    { q: '¿Qué pasa después de 30 días?', a: 'La edición sale del historial y ya no se puede deshacer en bloque.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'La papelera', article: 'lote-papelera' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'lote-papelera',
        route: '/settings?s=papelera',
        related: ['lote-historial-deshacer', 'lote-estructura', 'vistas-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'Nada se borra de verdad al instante. Lo que eliminas —registros, listas, campos, vistas, automatizaciones y tableros— va a la **papelera** y se queda ahí **30 días**. En ese tiempo se restaura **tal cual**: una lista vuelve con sus registros, campos, vistas y automatizaciones; un registro, con sus subtareas, vínculos, archivos y comentarios; un campo, con sus valores.',
            },
            { t: 'anim', key: 'lote-papelera', caption: 'Un registro eliminado va a la papelera y vuelve con «Restaurar», con todo lo suyo.' },
            { t: 'h', text: 'Deshacer al momento' },
            {
                t: 'p',
                md: 'Al borrar algo aparece un aviso: «El registro se movió a la papelera» (o el nombre de lo que borraste) con el botón **Deshacer**. Si fue sin querer, tócalo y vuelve al instante.',
            },
            { t: 'h', text: 'Abrir la papelera' },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Papelera**. Desde una lista también llegas con **Personalizar vista → Registros borrados** (abre la papelera filtrada por esa lista).',
                    'Usa **Buscar por nombre…** y los chips de tipo (**Todo**, **Registros**, **Listas**, **Campos**, **Vistas**, **Automatizaciones**, **Tableros**).',
                    'Cada elemento dice quién lo borró, hace cuánto y cuántos días le quedan («Quedan 12 días»).',
                    'Toca **Restaurar**. Si es un registro, **Ir a la lista** te lleva a verlo.',
                ],
            },
            { t: 'demo', key: 'lote-papelera-abrir', caption: 'La papelera de la empresa con lo borrado.', fallback: 'lote-papelera' },
            {
                t: 'settings',
                title: 'Lo que se puede hacer',
                rows: [
                    { name: 'Restaurar', what: 'Lo devuelve tal cual. Lo restaura quien lo borró o un administrador.', tip: 'Si mientras tanto otro tomó el mismo nombre interno, se le agrega un sufijo y el aviso lo dice.' },
                    { name: 'Borrar para siempre', what: 'Lo elimina definitivamente. Ya no se puede recuperar.' },
                    { name: 'Vaciar papelera', what: 'Borra para siempre todo lo que hay en la papelera de la empresa (también lo que borraron otros). Sólo administradores.' },
                ],
            },
            { t: 'h', text: 'Lo que hay que saber' },
            {
                t: 'callout',
                tone: 'info',
                md: 'Cada persona ve lo que borró y los registros borrados de las listas que puede ver. Al restaurar un registro se revisan sus permisos y el límite de registros del plan.',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Pasados los 30 días, lo que está en la papelera se borra para siempre de forma automática, incluidos los archivos que ya no usa nadie.',
            },
            {
                t: 'p',
                md: 'Mientras algo está en la papelera **no funciona**: una automatización borrada no corre, un tablero borrado no se envía ni se puede ver por su enlace público, un formulario de una lista borrada no recibe respuestas. Al restaurarlo vuelve a funcionar (una automatización que pasaría el límite del plan vuelve pausada).',
            },
            {
                t: 'example',
                title: 'Una veterinaria',
                md: 'Una auxiliar borra por error la lista **Vacunas** completa. El veterinario entra a **Ajustes → Papelera**, la encuentra con «con 1.240 registros», toca **Restaurar** y vuelve con sus registros, sus vistas y la automatización que avisa por WhatsApp cuando toca el refuerzo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo ampliar los 30 días?', a: 'No desde la app: el plazo es igual para toda la empresa.' },
                    { q: 'No encuentro algo que borró otra persona.', a: 'Si eres administrador lo ves; si no, ves sólo lo tuyo y los registros de las listas a las que tienes acceso. Pídeselo a quien lo borró o a un administrador.' },
                    { q: '¿Borrar un campo borra sus datos?', a: 'El campo va a la papelera con sus valores. Si lo restauras dentro de 30 días, los valores vuelven.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir la papelera', to: '/settings?s=papelera' },
                    { label: 'El historial de ediciones masivas', article: 'lote-historial-deshacer' },
                ],
            },
        ],
    },
];
