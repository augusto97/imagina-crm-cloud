import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'formularios-que-son',
        route: '/lists',
        related: ['formularios-constructor', 'formularios-publicar', 'formularios-automatizar', 'agenda-que-es'],
        blocks: [
            {
                t: 'p',
                md: 'Un **formulario** es una página pública que cualquier persona puede llenar desde su celular o su computadora, sin tener cuenta en la app. Cada vez que alguien lo envía, la respuesta llega **sola** como un **registro nuevo** en una de tus listas: no hay que copiar nada de un correo a una hoja de cálculo, ni pasar datos a mano.\n\nPor ejemplo, una clínica veterinaria publica el formulario «Pide tu cita» en su Instagram; cada respuesta aparece en la lista **Solicitudes** con el nombre del dueño, la mascota, el teléfono y el motivo, lista para que la recepción la atienda.',
            },
            { t: 'anim', key: 'form-hero', caption: 'Alguien llena el formulario en su celular y la respuesta aparece como una fila nueva en la lista.' },
            { t: 'h', text: 'Para qué lo usan los negocios' },
            {
                t: 'cards',
                items: [
                    { icon: 'Inbox', title: 'Contacto y cotizaciones', md: 'El botón «Escríbenos» de tu sitio crea un prospecto en **Oportunidades** con lo que pidió y de dónde llegó.', tone: 'blue' },
                    { icon: 'Ticket', title: 'Solicitudes de soporte', md: 'Tus clientes reportan un problema con foto adjunta y nace un ticket con prioridad y estado.', tone: 'rose' },
                    { icon: 'Users', title: 'Inscripciones con cupo', md: 'Un taller de cocina con 30 cupos: el formulario se cierra solo al llegar a 30 respuestas.', tone: 'mint' },
                    { icon: 'Star', title: 'Encuestas de satisfacción', md: 'Calificación con estrellas y comentarios que después sumas y promedias en un tablero.', tone: 'amber' },
                    { icon: 'Briefcase', title: 'Hojas de vida', md: 'Los candidatos suben su PDF y quedan en la lista **Candidatos** de la vacante.', tone: 'violet' },
                    { icon: 'ClipboardList', title: 'Pedidos y reservas', md: 'Un restaurante recibe pedidos para eventos con fecha, número de personas y menú elegido.', tone: 'cyan' },
                ],
            },
            { t: 'h', text: 'Cómo se crea el primero' },
            {
                t: 'p',
                md: 'Los formularios viven **dentro de cada lista**, porque cada respuesta se guarda en esa lista. Si quieres recibir solicitudes de soporte, el formulario va en la lista **Tickets**; si quieres recibir prospectos, en **Oportunidades**.',
            },
            {
                t: 'steps',
                items: [
                    'Abre la lista que va a recibir las respuestas y toca **Configurar lista** (arriba a la derecha).',
                    'Entra a la pestaña **Formularios**.',
                    'Toca **Nuevo formulario**. La app arma uno con **todos los campos que se pueden preguntar** ya puestos, en el orden de la lista.',
                    'Se abre el constructor a pantalla completa: saca las preguntas que no quieras hacer, cambia los textos y revisa la vista previa.',
                    'Toca **Guardar** y, cuando esté listo, enciende el interruptor **Sin publicar** para que pase a **Publicado**.',
                    'Copia el enlace con **Compartir** y mándalo por WhatsApp, ponlo en tus redes o insértalo en tu página web.',
                ],
            },
            { t: 'demo', key: 'form-crear', caption: 'Crear un formulario en la lista de tickets y abrir el constructor.', fallback: 'form-builder' },
            { t: 'h', text: 'La lista de formularios de cada lista' },
            {
                t: 'p',
                md: 'Una misma lista puede tener **varios formularios**: uno corto para el sitio web, otro más completo para clientes empresariales, otro para una campaña puntual. Todos guardan en la misma lista. En **Configurar lista → Formularios** ves cada uno con su estado y sus números:',
            },
            {
                t: 'settings',
                title: 'Lo que ves en cada formulario',
                rows: [
                    { name: 'Publicado / Sin publicar', what: 'Si el enlace está recibiendo respuestas o no. Uno sin publicar responde «no disponible».', tip: 'Puedes dejarlo sin publicar mientras lo armas: nadie lo ve.' },
                    { name: 'Preguntas · respuestas', what: 'Cuántas preguntas visibles tiene, cuántas respuestas llegaron en total y cuándo llegó la última.', tip: 'Si la última respuesta es de hace semanas, revisa que el enlace siga en tu sitio.' },
                    { name: 'Editar', what: 'Abre el constructor para cambiar preguntas y ajustes.' },
                    { name: 'Copiar enlace', what: 'Copia la dirección pública del formulario (sólo si está publicado).' },
                    { name: 'Abrir', what: 'Abre el formulario en otra pestaña, tal como lo ve quien responde.' },
                    { name: 'Publicar', what: 'Aparece en los que están sin publicar: lo pone en línea sin entrar al constructor.', tip: 'Está apagado si el formulario no tiene ninguna pregunta.' },
                    { name: 'Eliminar', what: 'Borra el formulario (pide confirmación): el enlace deja de funcionar. Los registros que ya llegaron se conservan.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Qué se puede preguntar',
                md: 'Texto, texto largo, número, moneda, selección (una o varias opciones), fecha, fecha y hora, casilla, correo, enlace, teléfono con indicativo, calificación con estrellas, porcentaje, duración, archivos y equipo. Las **personas del equipo**, las **relaciones** con otras listas y los **campos calculados** no se preguntan en un formulario público: esos los completa tu equipo o una automatización.',
            },
            {
                t: 'example',
                title: 'Una ferretería que recibe cotizaciones',
                md: 'Ferretería El Tornillo, en Pereira, tenía su WhatsApp lleno de «¿cuánto vale…?». Creó en **Oportunidades** el formulario «Pide tu cotización» con nombre, empresa, teléfono, qué necesita y una foto opcional. Lo puso en su perfil de Instagram y en su sitio. Ahora cada pedido aparece en el tablero de ventas en la etapa **Nuevo**, con el origen marcado, y una automatización le avisa al vendedor de turno.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Quién puede crearlos',
                md: 'Crear y editar formularios lo hace quien administra la lista (o un rol con el permiso de formularios). Si no ves la pestaña **Formularios**, pídele acceso a un administrador. Las listas que llena una tienda en línea no pueden tener formularios, porque sus registros nacen en la tienda.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quien responde necesita una cuenta?', a: 'No. El formulario es público: lo abre cualquiera con el enlace, sin registrarse ni iniciar sesión.' },
                    { q: '¿Cuántos formularios puedo tener?', a: 'Los que necesites, en cada lista. Cada respuesta cuenta como un registro dentro del límite de registros de tu plan.' },
                    { q: '¿Qué pasa si el plan llegó al límite de registros?', a: 'El formulario deja de aceptar respuestas hasta que liberes espacio o cambies de plan. Si la empresa está en solo lectura por un pago pendiente, también se cierra.' },
                    { q: '¿Puedo cambiar el formulario después de publicarlo?', a: 'Sí. Edítalo y toca **Guardar**: el cambio se ve al instante en el mismo enlace, y lo que ya llegó no se toca.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido de formularios', tour: 'forms' },
                    { label: 'Siguiente: el constructor', article: 'formularios-constructor' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'formularios-constructor',
        route: '/lists',
        related: ['formularios-que-son', 'formularios-condiciones-pasos', 'formularios-ajustes'],
        blocks: [
            {
                t: 'p',
                md: 'El constructor es la pantalla donde armas el formulario. Se abre a pantalla completa y tiene **tres zonas**: a la izquierda lo que puedes agregar y el orden de las preguntas, en el centro **la página real** que verá quien responde, y a la derecha los ajustes de lo que elegiste. Lo que ves en el centro es exactamente lo que se publica.',
            },
            { t: 'anim', key: 'form-builder', caption: 'Agregar una pregunta desde los campos de la lista, elegirla en la vista previa y marcarla como obligatoria.' },
            { t: 'h', text: 'Las tres zonas de la pantalla' },
            {
                t: 'settings',
                title: 'Lo que hay en cada zona',
                rows: [
                    { name: 'Barra de arriba', what: 'El nombre del formulario, el interruptor **Publicado / Sin publicar**, **Deshacer** y **Rehacer**, el botón de modo claro u oscuro, **Compartir** y **Guardar**.', tip: 'El nombre de arriba es interno: sólo lo ve tu equipo. Lo que lee el público es el **Título** de los ajustes.' },
                    { name: 'Pestaña Agregar', what: 'Los **Campos de la lista** que todavía no están en el formulario (cada uno con su ícono y la marca «obligatorio» si la lista lo exige) y el **Contenido**: **Título de sección**, **Texto o aclaración** y **Salto de página**.' },
                    { name: 'Pestaña Preguntas', what: 'Todas las piezas del formulario en orden. Se reordenan arrastrando o con las flechas **Subir** y **Bajar**. Un ojo tachado marca las ocultas y «si…» las que tienen condición.' },
                    { name: 'Vista previa (centro)', what: 'La página real. Toca cualquier pregunta para editarla. Arriba a la derecha cambias entre **Computadora** y **Celular**.', tip: 'Revisa siempre la vista de celular: casi todas las respuestas llegan desde un teléfono.' },
                    { name: 'Panel derecho', what: 'Sin nada elegido muestra los **Ajustes del formulario**; con una pregunta elegida, sus opciones.' },
                ],
            },
            { t: 'h', text: 'Agregar, quitar y ordenar preguntas' },
            {
                t: 'steps',
                items: [
                    'En **Agregar**, toca un campo de **Campos de la lista**: la pregunta aparece debajo de la que tengas elegida (o al final).',
                    'Para sumar un título que separe bloques («Datos de la empresa») toca **Título de sección**; para una aclaración larga, **Texto o aclaración**.',
                    'En la pestaña **Preguntas**, arrastra cada pieza por su asa hasta el lugar que quieras.',
                    'Para sacar una pregunta, elígela y toca **Quitar del formulario** al final de su panel. El campo sigue existiendo en la lista; sólo deja de preguntarse.',
                    'Toca **Guardar**. Mientras no guardes, el formulario publicado sigue como estaba.',
                ],
            },
            { t: 'h', text: 'Las opciones de cada pregunta' },
            {
                t: 'p',
                md: 'Toca una pregunta en la vista previa (o en la pestaña **Preguntas**) y el panel derecho muestra sus opciones. Cada pregunta dice arriba **Se guarda en el campo** y el nombre del campo de la lista donde cae la respuesta.',
            },
            {
                t: 'settings',
                title: 'Opciones de una pregunta',
                rows: [
                    { name: 'Pregunta', what: 'El texto que ve quien responde. Vacío = el nombre del campo.', tip: 'Escríbela como la dirías en voz alta: «¿A qué correo te respondemos?» en vez de «Email».' },
                    { name: 'Ayuda', what: 'Una línea más chica que aparece debajo de la pregunta.', tip: 'Úsala para aclarar el formato: «Con indicativo, por ejemplo +57 300 123 4567».' },
                    { name: 'Texto de ejemplo', what: 'Lo que se ve dentro de la casilla vacía, en gris, antes de escribir.' },
                    { name: 'Cómo se elige', what: 'Sólo en preguntas de selección: **Automático**, **Botones** (todas las opciones a la vista) o **Lista** (desplegable).', tip: '**Automático** muestra botones con pocas opciones y una lista desplegable con muchas.' },
                    { name: 'Tipos de archivo', what: 'Sólo en preguntas de archivo: cualquier archivo, imágenes, PDF, imágenes o PDF, o documentos (PDF, Word, Excel, texto).', tip: 'Los programas y las páginas web nunca se aceptan. Cada archivo puede pesar hasta 20 MB.' },
                    { name: 'Obligatoria', what: 'No deja enviar sin responderla. Si la lista exige ese campo, ya viene marcada y no se puede apagar.' },
                    { name: 'Oculta: se completa desde la dirección', what: 'La pregunta no se muestra; su valor llega en el enlace. Sirve para saber de dónde vino cada respuesta.', tip: 'Lo explicamos en detalle en «Preguntas que aparecen solas, formularios por pasos y datos ocultos».' },
                    { name: 'Mostrar sólo si…', what: 'La pregunta aparece únicamente cuando otra respuesta cumple una condición.' },
                ],
            },
            { t: 'demo', key: 'form-crear', caption: 'Elegir una pregunta, cambiar su texto y cómo se eligen sus opciones.', fallback: 'form-builder' },
            {
                t: 'callout',
                tone: 'warn',
                title: 'El aviso amarillo de los campos obligatorios',
                md: 'Si la lista exige un campo (por ejemplo **Asunto** en Tickets) y el formulario puede llegar sin él —porque no está, está oculto o tiene condición—, los ajustes muestran el aviso **La lista exige…**. Esas respuestas no se podrían guardar. Agrega esa pregunta visible y sin condición, o quítale el «obligatorio» al campo en la lista.',
            },
            { t: 'h', text: 'Títulos y textos para guiar a la persona' },
            {
                t: 'p',
                md: 'Un formulario largo se responde mejor si está dividido en bloques con nombre. Un **Título de sección** («Tus datos», «Sobre el evento») ordena la vista; un **Texto o aclaración** explica algo importante antes de una pregunta: «Si eres empresa, ten a mano el RUT». En el texto, una línea en blanco separa párrafos.',
            },
            {
                t: 'example',
                title: 'Una academia de inglés',
                md: 'English House, en Medellín, armó «Inscripción a cursos» en su lista **Estudiantes**: un título «Tus datos» (nombre, documento, celular, correo), otro «Tu nivel» con una selección de botones (Básico, Intermedio, Avanzado) y un texto que dice «Si no conoces tu nivel, te hacemos una prueba gratis», y al final la pregunta de archivo «Certificado anterior (opcional)» que acepta **Imágenes o PDF**.',
            },
            { t: 'h', text: 'Deshacer, guardar y salir' },
            {
                t: 'keys',
                items: [
                    { keys: ['Ctrl', 'Z'], what: 'Deshacer el último cambio del formulario.' },
                    { keys: ['Ctrl', 'Shift', 'Z'], what: 'Rehacer (también Ctrl + Y).' },
                ],
            },
            {
                t: 'p',
                md: 'Si intentas cerrar con cambios sin guardar, la app te pregunta **¿Salir sin guardar?** para que no pierdas nada por error. En el celular el constructor se divide en tres pestañas: **Preguntas**, **Vista previa** y **Ajustes**.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo preguntar algo que no es un campo de la lista?', a: 'Cada pregunta guarda su respuesta en un campo. Si necesitas una pregunta nueva, primero crea el campo en **Configurar lista → Campos** (o con «+ Agregar columna» en la tabla) y después agrégalo al formulario.' },
                    { q: '¿Cambiar el texto de la pregunta cambia el nombre del campo?', a: 'No. El texto de la pregunta es sólo del formulario; en la lista el campo conserva su nombre.' },
                    { q: '¿Y si renombro o reordeno los campos de la lista?', a: 'El formulario no se rompe: cada pregunta apunta al campo, no a su nombre.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Siguiente: condiciones y pasos', article: 'formularios-condiciones-pasos' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'formularios-condiciones-pasos',
        route: '/lists',
        related: ['formularios-constructor', 'formularios-publicar', 'formularios-automatizar'],
        blocks: [
            {
                t: 'p',
                md: 'Un buen formulario sólo pregunta lo necesario. Con tres herramientas lo logras: **preguntas condicionales** que aparecen según otra respuesta, **saltos de página** para responder por pasos, y **preguntas ocultas** que se llenan solas desde el enlace (para saber, por ejemplo, si la persona llegó desde Instagram o desde Facebook).',
            },
            { t: 'anim', key: 'form-conditional', caption: 'Al elegir «Empresa», aparece la pregunta del NIT; con «Persona», no.' },
            { t: 'h', text: 'Preguntas que aparecen según otra respuesta' },
            {
                t: 'steps',
                items: [
                    'Elige la pregunta que quieres mostrar sólo a veces (por ejemplo **NIT**).',
                    'En su panel, baja hasta **Mostrar sólo si…** y toca **Agregar una condición**.',
                    'En **Pregunta que controla** elige la que decide (por ejemplo **Tipo de cliente**). Tiene que estar **antes** en el formulario.',
                    'Elige la **Comparación** y el **Valor**: «es» → «Empresa».',
                    'Mira la vista previa: la pregunta aparece con una marca de «condicional». Prueba la condición respondiendo en la misma vista previa.',
                ],
            },
            { t: 'demo', key: 'form-condicion', caption: 'Agregar una condición a una pregunta.', fallback: 'form-conditional' },
            {
                t: 'settings',
                title: 'Comparaciones disponibles',
                rows: [
                    { name: 'es / no es', what: 'La respuesta es (o no es) exactamente un valor. En una casilla se elige **Marcada** o **Sin marcar**.' },
                    { name: 'es alguno de', what: 'La respuesta es cualquiera de varias opciones.', tip: 'Ideal para «Muéstralo si el servicio es Instalación o Mantenimiento».' },
                    { name: 'contiene', what: 'El texto escrito incluye una palabra.' },
                    { name: 'es mayor que / es menor que', what: 'Para números, montos y fechas.', tip: '«Si el presupuesto es mayor que 5.000.000, pregunta el cargo de quien decide».' },
                    { name: 'está vacío / tiene respuesta', what: 'Según si la otra pregunta se respondió o no.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Las condiciones se encadenan',
                md: 'Una pregunta condicional puede controlar a otra. Si la primera desaparece, la que depende de ella también. Y el servidor no le cree al navegador: al recibir la respuesta revisa otra vez qué preguntas tenían que verse, así nadie puede colar datos en preguntas que no correspondían.',
            },
            { t: 'h', text: 'Formularios por pasos' },
            { t: 'anim', key: 'form-pages', caption: 'Un formulario en tres pasos con barra de progreso.' },
            {
                t: 'p',
                md: 'Si el formulario es largo, divídelo con **Salto de página** (en **Agregar → Contenido**). Lo que viene después de cada salto se muestra en un paso aparte, con «Paso 2 de 3», una barra de progreso y los botones **Anterior** y **Siguiente**.',
            },
            {
                t: 'settings',
                title: 'Cómo se comporta un formulario por pasos',
                rows: [
                    { name: 'Título de la página que empieza aquí', what: 'Opcional en cada salto: «Datos de la empresa», «Tu pedido».' },
                    { name: 'Validación por página', what: 'No se puede pasar a la siguiente sin completar las obligatorias de la página actual.' },
                    { name: 'Páginas vacías', what: 'Una página cuyas preguntas están todas escondidas por sus condiciones se salta sola, y el total de pasos se ajusta.', tip: 'Así puedes tener una página entera sólo para empresas.' },
                    { name: 'En la pestaña Preguntas', what: 'Cada salto se ve como un separador con su número de página.' },
                ],
            },
            { t: 'h', text: 'Preguntas ocultas: datos que llegan en el enlace' },
            { t: 'anim', key: 'form-prefill', caption: 'El mismo formulario con «?origen=instagram» en el enlace: el registro llega con el origen marcado.' },
            {
                t: 'p',
                md: 'Una pregunta marcada **Oculta: se completa desde la dirección** no se ve, pero su valor viaja al final del enlace. Por ejemplo, si el campo **Origen** tiene el nombre interno `origen`, el enlace que pones en Instagram termina en `?origen=instagram` y el de Facebook en `?origen=facebook`. Cada respuesta llega con su origen, y en un tablero ves qué canal te trae más clientes.',
            },
            {
                t: 'steps',
                items: [
                    'Agrega al formulario la pregunta del campo que quieres llenar solo (por ejemplo **Origen**) y márcala **Oculta: se completa desde la dirección**.',
                    'En los ajustes del formulario, deja encendida **Completar respuestas desde la dirección** (sección **Insertar en tu sitio**).',
                    'Busca el **nombre interno** del campo en **Configurar lista → Campos** (es la etiqueta del campo en minúsculas y sin espacios, por ejemplo `origen`).',
                    'Arma un enlace por canal: el enlace del formulario + `?origen=instagram`. Para varios datos, únelos con `&`: `?origen=feria&vendedor=ana`.',
                    'En una selección, el valor del enlace tiene que ser el valor interno de la opción (el que ves al editar las opciones del campo).',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Completar desde la dirección también sirve con preguntas visibles: el enlace que mandas a un cliente conocido puede llevar su nombre ya escrito (`?nombre=Ana`), y la persona sólo revisa y envía.',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria con tres canales',
                md: 'Inmobiliaria Horizonte, en Barranquilla, tiene un solo formulario «Quiero visitar este inmueble» en su lista **Interesados**. La primera pregunta es «¿Buscas comprar o arrendar?»; si dice **Comprar**, aparece «¿Ya tienes crédito aprobado?», y si dice **Arrendar**, «¿Tienes codeudor?». Además, cada aviso de su página lleva el enlace con `?inmueble=apto-302&origen=portal`, así cada interesado llega con el inmueble y el canal sin preguntárselo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Una pregunta puede depender de una que está después?', a: 'No: la pregunta que controla tiene que estar antes. Si la mueves más abajo, la app te lo avisa en el panel.' },
                    { q: '¿Puedo poner una condición sobre un título o un texto?', a: 'Sí. Los títulos de sección y los textos también aceptan **Mostrar sólo si…**, así un bloque completo aparece sólo cuando corresponde.' },
                    { q: '¿Qué pasa si alguien cambia el valor del enlace a mano?', a: 'El valor se valida como cualquier respuesta: si no es una opción válida del campo o tiene un formato equivocado, no se guarda. Usa preguntas ocultas para datos de seguimiento, no para cosas que la persona no debería poder cambiar.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Siguiente: ajustes del formulario', article: 'formularios-ajustes' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'formularios-ajustes',
        route: '/lists',
        related: ['formularios-constructor', 'formularios-correo-seguridad', 'formularios-publicar'],
        blocks: [
            {
                t: 'p',
                md: 'Con ninguna pregunta elegida, el panel derecho del constructor muestra los **Ajustes del formulario**: los textos de la página, qué pasa al enviar, hasta cuándo recibe respuestas, con qué datos nace el registro y cómo se ve. Aquí están todos, sección por sección.',
            },
            { t: 'anim', key: 'form-closing', caption: 'Con un cupo de 30, el formulario se cierra solo al llegar a 30 respuestas.' },
            { t: 'h', text: 'Textos de la página' },
            {
                t: 'settings',
                rows: [
                    { name: 'Nombre interno', what: 'Cómo se llama el formulario dentro de la app. Sólo lo ve tu equipo.', tip: 'Ponle algo que lo distinga si tienes varios: «Cotizaciones · sitio web».' },
                    { name: 'Título', what: 'El título grande que ve quien responde. Al crear el formulario trae el nombre de la lista; vacío = el nombre interno.' },
                    { name: 'Descripción', what: 'Un texto debajo del título para explicar de qué se trata y cuánto tarda.', tip: '«Te respondemos en menos de 24 horas hábiles» genera confianza.' },
                    { name: 'Texto del botón', what: 'Lo que dice el botón de enviar. Por defecto, «Enviar».', tip: 'Que diga lo que pasa: «Pedir mi cotización», «Inscribirme».' },
                ],
            },
            { t: 'h', text: 'Después de enviar' },
            {
                t: 'settings',
                rows: [
                    { name: 'Título del agradecimiento', what: 'El título de la pantalla final. Por defecto, «¡Gracias!».' },
                    { name: 'Mensaje', what: 'El texto de esa pantalla. Por defecto, «Recibimos tu respuesta.».', tip: 'Di qué sigue: «Te escribimos por WhatsApp hoy mismo».' },
                    { name: 'O llevar a esta dirección', what: 'En vez del mensaje, lleva a la persona a una página tuya (por ejemplo, una página de gracias en tu sitio). Tiene que empezar con https://.' },
                    { name: 'Ofrecer «Enviar otra respuesta»', what: 'Muestra un botón para llenar el formulario de nuevo.', tip: 'Útil en una feria, donde una misma tableta inscribe a muchas personas. Apágalo en encuestas de una sola respuesta.' },
                ],
            },
            { t: 'h', text: 'Registro que se crea' },
            {
                t: 'p',
                md: 'En **Desde una plantilla** puedes elegir una **plantilla de registro** de la lista. Cada respuesta nace con los valores, las subtareas y los checklists de esa plantilla, y lo que responde la persona pisa los valores de la plantilla. Por ejemplo, una solicitud de mudanza nace con el checklist «Visita técnica, Cotización, Contrato» y el estado **Nuevo**, aunque el formulario no lo pregunte.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Las plantillas de registro se crean en **Configurar lista → Plantillas**. Si la lista no tiene ninguna, esta sección no aparece.',
            },
            { t: 'h', text: 'Cuándo recibe respuestas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Hasta el día', what: 'Último día en que se aceptan respuestas (inclusive). Vacío = sin fecha de cierre.', tip: 'Inscripciones a un evento: ciérralo el día anterior.' },
                    { name: 'Hasta un máximo de respuestas', what: 'Al llegar a ese número, el formulario se cierra solo. Vacío = sin límite.', tip: 'Cupos de un taller, de una promoción o de una preventa.' },
                    { name: 'Mensaje cuando está cerrado', what: 'Lo que ve quien abre el enlace después del cierre. Por defecto, «Este formulario ya no está recibiendo respuestas.».', tip: 'Ofrece una salida: «Se agotaron los cupos. Escríbenos para la próxima fecha».' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Si activas la confirmación por correo (en «Correo de quien responde»), una respuesta cuenta para el cupo recién cuando la persona la confirma. Así un cupo no se gasta con correos falsos.',
            },
            { t: 'h', text: 'Apariencia' },
            {
                t: 'settings',
                rows: [
                    { name: 'Color', what: 'El color de la franja de arriba, del botón y de los detalles. Vacío = **El de tu marca**.' },
                    { name: 'Mostrar el logo de la empresa', what: 'Pone tu logo arriba del título. El logo y el color de la marca se configuran en **Ajustes → Marca**.' },
                ],
            },
            {
                t: 'p',
                md: 'El formulario siempre se ve en modo claro, con la tipografía de la app, y se adapta solo al ancho del teléfono. Las secciones **Correo de quien responde**, **Verificación anti-robots**, **Datos personales** e **Insertar en tu sitio** tienen su propio artículo.',
            },
            {
                t: 'example',
                title: 'Un taller de repostería con cupos',
                md: 'Dulce Taller, en Cali, abre cada mes un curso de 20 cupos. Su formulario «Inscripción curso de tortas» tiene **Hasta un máximo de respuestas** en 20, **Hasta el día** el viernes antes del curso, y el **Mensaje cuando está cerrado** dice «¡Se llenó! Déjanos tu WhatsApp en nuestro Instagram para el próximo». Al enviar, lleva a una página de su sitio con las instrucciones de pago.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo reabrir un formulario que se cerró por cupo?', a: 'Sí: sube el número en **Hasta un máximo de respuestas** o déjalo vacío y guarda.' },
                    { q: '¿El cupo cuenta las respuestas que borré de la lista?', a: 'El cupo cuenta las respuestas recibidas por el formulario. Si borraste registros y quieres liberar lugares, sube el máximo.' },
                    { q: '¿Puedo usar otro color en cada formulario?', a: 'Sí. Cada formulario tiene su **Color**; si lo dejas vacío, toma el de tu marca.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Configurar la marca', to: '/settings?s=marca' },
                    { label: 'Siguiente: correo y seguridad', article: 'formularios-correo-seguridad' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'formularios-correo-seguridad',
        route: '/settings?s=portal',
        related: ['formularios-ajustes', 'formularios-publicar', 'portal-marca-datos'],
        blocks: [
            {
                t: 'p',
                md: 'Un formulario público está expuesto a cualquiera: personas que escriben mal su correo, robots que mandan basura y la obligación legal de pedir permiso para guardar datos personales. El constructor trae tres secciones para eso: **Correo de quien responde**, **Verificación anti-robots** y **Datos personales**.',
            },
            { t: 'anim', key: 'form-double-optin', caption: 'La respuesta queda pendiente hasta que la persona confirma desde su correo; recién ahí nace el registro.' },
            { t: 'h', text: 'Confirmar el correo con un clic' },
            {
                t: 'p',
                md: 'Primero, en **Correo de quien responde → Pregunta con el correo**, elige la pregunta de tipo correo donde la persona escribe su dirección. Esa pregunta pasa a ser obligatoria y siempre visible. Con eso se habilitan dos opciones:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Confirmar el correo con un clic', what: 'La respuesta queda **pendiente** y a la persona le llega un correo con tu marca para confirmarla. Recién al confirmar se crea el registro, corren las automatizaciones y cuenta para el cupo. Si no confirma en 48 horas, se descarta sola.', tip: 'Úsalo en inscripciones, sorteos y listas de correo: sólo entran direcciones reales.' },
                    { name: 'Enviarle una copia de sus respuestas', what: 'Le llega un correo con lo que respondió.', tip: 'Útil en solicitudes formales («Radicaste tu solicitud con estos datos…»).' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Estos correos salen por el correo de tu empresa (**Ajustes → Correo**) y cuentan en su cuota mensual de correos. Quien responde ve la pantalla «Revisa tu correo» con el aviso de que el enlace vence en 48 horas y que revise la carpeta de spam.',
            },
            { t: 'h', text: 'Verificación anti-robots (captcha)' },
            {
                t: 'p',
                md: 'Todos los formularios ya traen protecciones invisibles: una trampa que sólo llenan los robots, un tiempo mínimo entre abrir y enviar, y un límite de envíos por conexión. Si igual te llega basura, enciende **Pedir verificación anti-robots**: aparece una verificación al final del formulario, antes del botón de enviar.',
            },
            {
                t: 'steps',
                items: [
                    'Un administrador entra a **Ajustes → Portal y formularios** y, en **Verificación anti-robots (captcha)**, elige el **Proveedor**: **Cloudflare Turnstile** (recomendado, casi siempre invisible), **hCaptcha** o **Google reCAPTCHA v2**.',
                    'Toca **Cómo conseguir las llaves** y **Abrir el panel de** ese proveedor; crea un sitio gratis y copia la **Llave del sitio** y la **Llave secreta**.',
                    'Pégalas y toca **Guardar llaves**. La llave secreta se guarda cifrada y nunca se vuelve a mostrar.',
                    'En cada formulario que lo necesite, enciende **Pedir verificación anti-robots** en su sección del constructor.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Si tu empresa no carga llaves, se usan las de la plataforma (si el operador las configuró). Si no hay llaves en ningún lado, la opción se ve apagada con el motivo y el enlace para cargarlas.',
            },
            { t: 'h', text: 'Autorización de tratamiento de datos (Ley 1581)' },
            {
                t: 'p',
                md: 'En Colombia, antes de guardar datos personales hay que pedir una autorización previa, expresa e informada. La app la resuelve con una **casilla obligatoria** al final del formulario, con el texto de tu empresa y un enlace «Ver la autorización completa». Sin marcarla no se puede enviar, y cada respuesta guarda la **prueba**: qué versión del texto aceptó, cuándo y desde dónde.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Pedir la autorización de tratamiento de datos', what: 'Muestra la casilla en este formulario. Viene encendida si tu empresa ya tiene el texto.', tip: 'Apágala sólo si el formulario no recoge datos personales o si ya obtienes la autorización por otro medio.' },
                    { name: 'El texto', what: 'Se escribe una sola vez para toda la empresa en **Ajustes → Datos personales**, con una plantilla sugerida y versiones.', tip: 'La plantilla es un punto de partida: conviene que la revise tu abogado.' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Si tu empresa todavía no configuró el texto, la opción se ve apagada con el aviso **Tu empresa todavía no tiene el texto de la autorización** y el enlace a **Ajustes → Datos personales**.',
            },
            {
                t: 'example',
                title: 'Un gimnasio con una promoción en redes',
                md: 'Gimnasio Fuerza, en Bucaramanga, lanzó «Primera semana gratis» en TikTok y le llegaron cientos de respuestas con correos inventados. Encendió **Confirmar el correo con un clic** y **Pedir verificación anti-robots** con Cloudflare Turnstile: ahora sólo entran las personas que confirman, cada registro guarda la autorización de datos y el equipo comercial deja de perder tiempo con contactos falsos.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué ve la persona si no confirma su correo?', a: 'Nada cambia en tu lista: la respuesta queda pendiente 48 horas y después se descarta. Si confirma, nace el registro como si acabara de enviarla.' },
                    { q: '¿El captcha molesta a la gente?', a: 'Cloudflare Turnstile casi nunca pide nada: la mayoría de las personas ni lo notan. hCaptcha y reCAPTCHA a veces piden elegir imágenes.' },
                    { q: '¿Dónde veo las autorizaciones guardadas?', a: 'En **Ajustes → Datos personales** está el listado con filtros y la descarga, y cada registro muestra en su ficha cuándo y con qué versión se aceptó.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Cargar llaves de captcha', to: '/settings?s=portal' },
                    { label: 'Configurar la autorización de datos', to: '/settings?s=privacidad' },
                    { label: 'Siguiente: publicar y compartir', article: 'formularios-publicar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'formularios-publicar',
        route: '/lists',
        related: ['formularios-que-son', 'formularios-condiciones-pasos', 'compartir-opciones'],
        blocks: [
            {
                t: 'p',
                md: 'Un formulario nace **Sin publicar**: puedes armarlo con calma porque nadie lo ve. Cuando esté listo, lo publicas y tienes dos formas de llevarlo a la gente: **el enlace** (para WhatsApp, redes, correos, un código QR) y **el código para insertarlo** dentro de tu página web, donde se ve como parte del sitio.',
            },
            { t: 'anim', key: 'form-embed', caption: 'El formulario insertado en el sitio web de la empresa, como una parte más de la página.' },
            { t: 'h', text: 'Publicar' },
            {
                t: 'steps',
                items: [
                    'En el constructor, toca el interruptor **Sin publicar** de la barra de arriba. Se guarda y pasa a **Publicado**.',
                    'Se abre solo el panel **Compartir el formulario** con el **Enlace** y el código para **Insertar en tu sitio**, cada uno con su botón **Copiar**.',
                    'Toca **Abrir en otra pestaña** y llénalo tú una vez para ver llegar la respuesta a la lista.',
                    'Para dejar de recibir respuestas, toca **Publicado**: el enlace pasa a responder «no disponible» y lo que ya llegó se conserva.',
                ],
            },
            { t: 'demo', key: 'form-publicar', caption: 'Publicar el formulario y copiar el enlace o el código para el sitio.', fallback: 'form-embed' },
            {
                t: 'callout',
                tone: 'info',
                md: 'No se puede publicar un formulario sin preguntas: la app avisa **Agrega al menos una pregunta**. También puedes publicar desde la lista de formularios con el botón **Publicar**, y copiar el enlace con el ícono de cadena.',
            },
            { t: 'h', text: 'Dónde poner el enlace' },
            {
                t: 'cards',
                items: [
                    { icon: 'MessageCircle', title: 'WhatsApp', md: 'En tu mensaje de bienvenida o en las respuestas rápidas: «Para cotizar, llena este formulario».', tone: 'mint' },
                    { icon: 'Smartphone', title: 'Redes sociales', md: 'En la biografía de Instagram o TikTok, con `?origen=instagram` para medir de dónde llega cada uno.', tone: 'violet' },
                    { icon: 'QrCode', title: 'Un código QR', md: 'Conviértelo en QR con cualquier generador e imprímelo en el mostrador, la factura o un volante.', tone: 'amber' },
                    { icon: 'Mail', title: 'Correos y firmas', md: 'Un botón «Agenda una visita» o «Cuéntanos qué te pareció» en tus correos.', tone: 'blue' },
                ],
            },
            { t: 'h', text: 'Insertarlo en tu página web' },
            {
                t: 'p',
                md: 'El código de **Insertar en tu sitio** es un pedacito de código que se pega en tu página (WordPress, Wix, Shopify o cualquier editor que permita insertar código HTML). El formulario aparece dentro del sitio y las respuestas llegan igual a tu lista.',
            },
            {
                t: 'settings',
                title: 'Sección «Insertar en tu sitio» del constructor',
                rows: [
                    { name: 'Completar respuestas desde la dirección', what: 'Permite que el enlace traiga respuestas ya escritas (`?nombre=Ana&origen=instagram`).', tip: 'Necesario para las preguntas ocultas que marcan de dónde vino cada respuesta.' },
                    { name: 'Sitios que pueden insertarlo', what: 'Uno por renglón (ej.: tusitio.com). Vacío = cualquier sitio.', tip: 'Ponle tu dominio para que nadie copie tu formulario en otra página.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'La restricción de sitios sólo aplica a insertarlo: el enlace directo se abre igual desde cualquier lugar. Si quieres que el formulario deje de funcionar del todo, despublícalo.',
            },
            {
                t: 'example',
                title: 'Un consultorio odontológico',
                md: 'Sonrisa Clara, en Bogotá, insertó «Pide tu valoración» en la página de inicio de su sitio en WordPress, y en **Sitios que pueden insertarlo** escribió `sonrisaclara.com`. En Instagram usa el enlace con `?origen=instagram` y en el volante del consultorio, un QR con `?origen=volante`. A fin de mes, un tablero le muestra cuántas valoraciones llegaron por cada canal.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿El enlace cambia si edito el formulario?', a: 'No. Mientras el formulario exista, el enlace es el mismo; los cambios que guardes se ven al instante en él y en el sitio donde lo insertaste.' },
                    { q: '¿Se ve bien en el celular?', a: 'Sí. La página se adapta sola al ancho de la pantalla. Revísalo con el botón **Celular** de la vista previa.' },
                    { q: '¿Puedo ver cuántas respuestas lleva?', a: 'En **Configurar lista → Formularios** cada formulario muestra cuántas respuestas recibió y cuándo llegó la última. Las respuestas mismas son los registros de la lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido de formularios', tour: 'forms' },
                    { label: 'Siguiente: automatizar respuestas', article: 'formularios-automatizar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'formularios-automatizar',
        route: '/lists',
        related: ['formularios-que-son', 'formularios-correo-seguridad', 'portal-dar-acceso'],
        blocks: [
            {
                t: 'p',
                md: 'Que la respuesta llegue a la lista es la mitad del trabajo. La otra mitad es **reaccionar rápido**: avisarle al equipo, contestarle a la persona, asignar a alguien, poner una fecha límite. Para eso está el disparador de automatización **Cuando se envía un formulario**: corre cada vez que llega una respuesta, con el registro ya creado.',
            },
            { t: 'anim', key: 'form-automation', caption: 'Llega una respuesta, la automatización responde por correo y avisa al equipo.' },
            { t: 'h', text: 'Cómo se arma' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y toca **Automatizaciones** (arriba a la derecha) y después crea una nueva.',
                    'En **Cuando**, elige **Cuando se envía un formulario**.',
                    'En **Formulario**, deja **Cualquier formulario de esta lista** o elige uno en particular (por ejemplo sólo «Cotizaciones · sitio web»).',
                    'Agrega las acciones: **Enviar email**, **Actualizar un campo**, **Crear un registro**, un mensaje de WhatsApp de una app conectada, **Pedirle a un agente**…',
                    'Usa las variables de las respuestas, por ejemplo `{{nombre}}` o `{{formulario.nombre}}` (el nombre del formulario que llenaron).',
                    'Guarda y actívala. Haz una prueba respondiendo tú el formulario.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si el formulario confirma el correo con un clic, la automatización corre recién cuando la persona confirma. Y como el disparador es de esa lista, también reacciona igual que **Cuando se crea un registro**, pero sólo para lo que llegó por un formulario: lo que crea tu equipo a mano no lo dispara.',
            },
            { t: 'h', text: 'Recetas listas para copiar' },
            {
                t: 'cards',
                items: [
                    { icon: 'Mail', title: 'Respuesta automática', md: '**Enviar email** a `{{email}}`: «Hola {{nombre}}, recibimos tu solicitud. Te contactamos en menos de 24 horas».', tone: 'blue' },
                    { icon: 'BellRing', title: 'Aviso al equipo', md: '**Enviar email** al correo de ventas con el resumen, o un mensaje a un canal de Slack conectado.', tone: 'amber' },
                    { icon: 'UserCheck', title: 'Asignar un responsable', md: '**Actualizar un campo**: Responsable = la vendedora de esa zona, con una condición por ciudad.', tone: 'violet' },
                    { icon: 'CalendarClock', title: 'Fecha límite', md: '**Actualizar un campo**: «Responder antes de» = `{{date.today|+1d}}`.', tone: 'rose' },
                    { icon: 'MessageCircle', title: 'WhatsApp de bienvenida', md: 'Si tienes WhatsApp conectado, una plantilla de bienvenida al `{{telefono}}` que dejaron.', tone: 'mint' },
                    { icon: 'Sparkles', title: 'Clasificar con IA', md: '**Pedirle a un agente** que lea la solicitud y ponga la prioridad y la categoría.', tone: 'cyan' },
                ],
            },
            { t: 'h', text: 'Sin automatizaciones también te enteras' },
            {
                t: 'p',
                md: 'Cada respuesta es un registro común: aparece al instante en la tabla y en los tableros para todos los que tengan la lista abierta, y si ordenas por fecha de creación ves lo último arriba. Si quieres que alguien se entere sin abrir la lista, usa una automatización de aviso al equipo, o un tablero con un indicador de las respuestas de hoy.',
            },
            {
                t: 'example',
                title: 'Una agencia de seguros',
                md: 'Seguros Andinos, en Quito, recibe cotizaciones de seguros de auto. Su automatización **Cuando se envía un formulario** hace tres cosas: (1) envía un correo a `{{correo}}` con «Hola {{nombre}}, tu cotización para el {{marca}} {{modelo}} está en proceso»; (2) si el **Valor del vehículo** es mayor que 80.000.000, pone **Prioridad = Alta** y asigna a la asesora senior; (3) si no, asigna por turno. El tiempo de primera respuesta bajó de un día a una hora.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo contestarle a la persona desde la ficha del registro?', a: 'Sí, con una automatización que envía un correo o, si conectaste un buzón de soporte, con **Responder por correo** desde la ficha. Un correo a mano también sirve: el correo de la persona queda en el registro.' },
                    { q: '¿La automatización ve los archivos que subieron?', a: 'Sí: quedan en el campo de archivos del registro, y puedes adjuntarlos o mencionarlos en las acciones que lo permiten.' },
                    { q: '¿Puedo darle acceso a su portal apenas llena el formulario?', a: 'El acceso al portal se da desde la ficha del registro, con su correo. Lo explicamos en «Dar acceso a un cliente».' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Volver al inicio del módulo', article: 'formularios-que-son' },
                ],
            },
        ],
    },
];
