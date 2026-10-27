import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'fichas-abrir',
        route: '/lists',
        related: ['fichas-descripcion', 'fichas-comentarios', 'fichas-acciones', 'fichas-disenar'],
        blocks: [
            {
                t: 'p',
                md: 'La **ficha** es la pantalla de un registro: todo lo de un cliente, una tarea, una factura o una venta en un solo lugar. Arriba está el **título**; debajo, la **descripción** (un documento libre) y los **campos**; más abajo, las subtareas, los checklists, las dependencias y el tiempo; y al costado, la **conversación** y la **actividad**.\n\nSe abre de dos formas: como un **modal** encima de la lista (para revisar rápido y volver) o en **página completa** (para trabajar un rato largo o compartir el enlace).',
            },
            { t: 'anim', key: 'ficha-abrir', caption: 'Un clic en el título abre la ficha; J y K pasan al registro siguiente o anterior sin cerrarla.' },
            { t: 'h', text: 'Abrir un registro' },
            {
                t: 'steps',
                items: [
                    'En la tabla, haz clic en el **título** de la fila (la primera columna). En el Kanban, el calendario o las tarjetas, haz clic en la tarjeta o el evento.',
                    'Se abre el modal. La dirección de la página incluye el número del registro, así que puedes copiarla y mandarla: abre la lista con ese registro abierto.',
                    'Para verla en página completa toca **Abrir página completa** (el ícono de la flecha que sale de un cuadro, arriba a la derecha).',
                    'Para cerrar, toca la **×** o pulsa Escape.',
                ],
            },
            { t: 'demo', key: 'ficha-abrir-registro', caption: 'Abrir un registro desde la tabla.', fallback: 'ficha-abrir' },
            { t: 'h', text: 'Pasar al registro siguiente' },
            {
                t: 'p',
                md: 'Arriba a la izquierda del modal hay dos flechas: **Registro anterior** y **Registro siguiente**. Recorren los registros en el orden de la vista (con sus filtros), así que puedes revisar «las 20 facturas vencidas» una tras otra sin volver a la lista.',
            },
            {
                t: 'keys',
                items: [
                    { keys: ['J'], what: 'Registro siguiente (también ↓)' },
                    { keys: ['K'], what: 'Registro anterior (también ↑)' },
                    { keys: ['Esc'], what: 'Cerrar la ficha' },
                ],
            },
            { t: 'h', text: 'El título y los campos' },
            {
                t: 'p',
                md: 'El **título** grande de arriba es el campo de título de la lista (por ejemplo, el nombre del cliente). Se edita ahí mismo. Debajo están **Creado** y **Actualizado**, y la sección **Campos** con un renglón por campo y su ícono de tipo.\n\nEn la ficha simple, los cambios de los campos se guardan con **Guardar cambios** (abajo a la derecha). Si intentas cerrar con cambios sin guardar, la app pregunta si quieres descartarlos. En la **ficha diseñada** cada campo **se guarda solo** al cambiarlo. La descripción, los comentarios, los checklists y el tiempo se guardan siempre solos.',
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Pasa el mouse por el nombre de un campo y aparece el ícono de **historial**: ves quién lo cambió, cuándo y de qué a qué, y puedes **Restaurar** un valor anterior.',
            },
            { t: 'h', text: 'La barra de arriba' },
            {
                t: 'settings',
                title: 'Botones de la ficha',
                rows: [
                    { name: 'Seguir (el ojo)', what: 'Te avisa de los comentarios y cambios de este registro en la campana.' },
                    { name: 'Recordarme (el reloj)', what: 'Un recordatorio para ti sobre este registro: en 1 hora, mañana, el lunes…' },
                    { name: 'Generar PDF', what: 'Un documento PDF con los datos del registro (una cuenta de cobro, una cotización).' },
                    { name: 'Enviar WhatsApp', what: 'Aparece si la empresa tiene WhatsApp Business conectado.' },
                    { name: 'Guardar como plantilla', what: 'Convierte este registro en una plantilla para crear otros iguales.' },
                    { name: 'Compartir este registro', what: 'Invita a alguien de afuera a ver sólo este registro.' },
                    { name: 'Abrir página completa', what: 'Pasa del modal a la página del registro.' },
                ],
            },
            {
                t: 'p',
                md: 'En el costado derecho del modal está el panel de **Comentarios** y **Actividad**. Con **Contraer** lo escondes para tener más espacio, y con **Ampliar** vuelve. Abajo a la izquierda está **Eliminar**: el registro (con sus subtareas) va a la papelera y se puede recuperar durante 30 días.',
            },
            { t: 'h', text: 'En el celular' },
            {
                t: 'p',
                md: 'En el teléfono la ficha ocupa toda la pantalla y tiene tres pestañas: **Detalles**, **Comentarios** y **Actividad**, una por vez. **Guardar** queda fijo abajo en **Detalles**, y en los campos la etiqueta va arriba del valor para que se lean enteros.',
            },
            {
                t: 'example',
                title: 'Una distribuidora que cobra',
                md: 'La encargada de cartera filtra **Facturas** por «Estado es Vencida», abre la primera y va pasando con **J**: en cada ficha deja un comentario con lo que le dijo el cliente, pone un **Recordarme** para el jueves si prometió pagar, y cambia el estado de las que ya pagaron. Revisa 30 facturas sin volver una sola vez a la lista.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué mi ficha se ve distinta a la de otra lista?', a: 'Cada lista elige su apariencia: la ficha simple (los campos uno debajo del otro) o una ficha diseñada con pestañas, portada y gráficos. Se cambia en **Configurar lista → Apariencia**.' },
                    { q: '¿Puedo abrir un registro desde la búsqueda?', a: 'Sí: el buscador de arriba (Ctrl + K) busca registros en todas las listas y los abre directo.' },
                    { q: 'No puedo editar nada en la ficha.', a: 'Tu rol puede ver la lista pero no editarla, o sólo editar lo tuyo. Pídele permiso a quien administra la lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Recorrido por la ficha', tour: 'record' },
                    { label: 'La descripción', article: 'fichas-descripcion' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'fichas-descripcion',
        route: '/lists',
        related: ['fichas-abrir', 'fichas-comentarios', 'fichas-subtareas-y-checklists'],
        blocks: [
            {
                t: 'p',
                md: 'Cada registro tiene una **descripción**: un documento libre arriba de los campos, como el cuerpo de una tarea. Sirve para lo que no entra en un campo: el brief de un proyecto, la historia de un cliente, el protocolo de un procedimiento, el acta de una reunión.\n\nSe escribe como en un editor moderno: con el menú **«/»** insertas títulos, listas, tablas, columnas, videos y archivos; al seleccionar texto aparece una barra de formato. **Se guarda solo** mientras escribes («Guardando…» → «Guardado»).',
            },
            { t: 'anim', key: 'ficha-descripcion', caption: 'Escribir «/» abre el menú de bloques: una lista de control aparece lista para marcar.' },
            { t: 'h', text: 'El menú «/»' },
            {
                t: 'p',
                md: 'Escribe **/** en una línea vacía (o en cualquier lugar) y aparece el menú. Sigue escribiendo para filtrar («/tab» → **Tabla**) y elige con las flechas y Enter, o con el mouse.',
            },
            {
                t: 'settings',
                title: 'Lo que se puede insertar',
                rows: [
                    { name: 'Texto → Texto normal, Título 1, Título 2, Título 3', what: 'Párrafos y títulos de sección.' },
                    { name: 'Listas → Lista con viñetas, Lista numerada, Lista de control', what: 'La lista de control tiene casillas para marcar.', tip: 'Para pasos sueltos dentro del documento. Si quieres progreso, responsable y fecha por paso, usa un **checklist**.' },
                    { name: 'Bloques → Cita, Bloque de código, Divisor, Tabla', what: 'Un texto destacado, código con ancho fijo, una línea separadora o una tabla de 3×3 con cabecera.' },
                    { name: 'Menciones → Mencionar persona', what: 'Le avisa en su campana.' },
                    { name: 'Menciones → Mencionar registro', what: 'Inserta un enlace a otro registro de cualquier lista; al clickearlo, se abre.' },
                    { name: 'Archivos → Imagen, Adjunto', what: 'Sube una imagen (se ve en el documento) o un archivo (con su nombre, para abrirlo o descargarlo).' },
                    { name: 'Insertar → Insertar contenido', what: 'Pega el enlace de **YouTube**, **Loom**, **Figma**, **Google Drive** o **Vimeo** y se ve dentro del documento.' },
                    { name: 'Subtarea', what: 'Crea una subtarea de verdad (un registro hijo) y deja su enlace en el texto.' },
                    { name: 'Estructura → Columnas, Índice', what: 'Dos columnas lado a lado, o un índice con los títulos del documento que se arma solo.' },
                ],
            },
            { t: 'demo', key: 'ficha-menu-barra', caption: 'El menú «/» de la descripción.', fallback: 'ficha-descripcion' },
            { t: 'h', text: 'La barra de formato' },
            {
                t: 'p',
                md: 'Selecciona un texto y aparece una barra flotante con **Negrita**, **Cursiva**, **Subrayado**, **Tachado**, **Código**, **Color del texto**, **Resaltado**, **Enlace** (y **Quitar enlace**) y **Borrar formato**.',
            },
            { t: 'h', text: 'Atajos mientras escribes' },
            {
                t: 'keys',
                items: [
                    { keys: ['#', 'espacio'], what: 'Título 1 (## para Título 2, ### para Título 3)' },
                    { keys: ['-', 'espacio'], what: 'Lista con viñetas' },
                    { keys: ['1.', 'espacio'], what: 'Lista numerada' },
                    { keys: ['>', 'espacio'], what: 'Cita' },
                    { keys: ['```'], what: 'Bloque de código' },
                    { keys: ['@'], what: 'Mencionar a una persona o un equipo' },
                    { keys: ['/'], what: 'Abrir el menú de bloques' },
                    { keys: ['Ctrl', 'B'], what: 'Negrita (Ctrl + I cursiva, Ctrl + U subrayado)' },
                ],
            },
            { t: 'h', text: 'Menciones' },
            {
                t: 'p',
                md: 'Escribe **@** y elige a alguien de **Mencionar persona o equipo**. Queda un chip con su nombre y le llega un aviso. Si mencionas un **equipo**, avisa a cada persona del equipo que puede ver el registro. Si después borras la mención del texto, sale también de su campana.',
            },
            {
                t: 'example',
                title: 'Una agencia de diseño',
                md: 'Cada **Proyecto** tiene en su descripción el brief del cliente: un **Índice** arriba, títulos para «Objetivo», «Público» y «Entregables», el **Figma** insertado para ver el diseño sin salir, el video de **Loom** donde el cliente explica lo que quiere, y una **Lista de control** con lo que falta pedirle. Las tareas que salen de ahí se crean con **/Subtarea**.',
            },
            {
                t: 'example',
                title: 'Una clínica',
                md: 'En la ficha de cada **Procedimiento**, la descripción es el protocolo: los pasos numerados, una **Tabla** de dosis y una **Cita** con las contraindicaciones, más el PDF del consentimiento como **Adjunto**.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'El buscador de la lista también encuentra palabras escritas en la descripción, y en la tabla un ícono junto al título avisa que el registro tiene descripción.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo insertar un video de cualquier página?', a: 'Sólo de YouTube, Vimeo, Loom, Figma y Google Drive (documentos, hojas y presentaciones). Otro enlace se puede insertar como enlace normal.' },
                    { q: '¿Abrir la ficha cambia la descripción?', a: 'No: sólo se guarda cuando escribes de verdad.' },
                    { q: '¿Se ve la descripción en el portal del cliente?', a: 'Sólo si el diseño del portal la incluye.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Comentarios y menciones', article: 'fichas-comentarios' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'fichas-comentarios',
        route: '/lists',
        related: ['fichas-actividad-historial', 'fichas-descripcion', 'fichas-acciones'],
        blocks: [
            {
                t: 'p',
                md: 'Cada registro tiene su **conversación**: lo que se habla del cliente, la tarea o el pedido queda pegado a él, no perdido en un chat. Puedes mencionar a alguien para que le llegue el aviso, responder en hilos, reaccionar con un emoji y, si la lista tiene portal, decidir si el **cliente** también lo ve.',
            },
            { t: 'anim', key: 'ficha-comentarios', caption: 'Un comentario con @Juan, una reacción y una respuesta en hilo.' },
            { t: 'h', text: 'Comentar' },
            {
                t: 'steps',
                items: [
                    'En el panel de la derecha, pestaña **Comentarios**, escribe en «Escribe un comentario… Usa @ para mencionar.».',
                    'Escribe **@** y el nombre para mencionar a una persona o un **equipo**. Le llega un aviso a la campana (y por correo o al celular si lo tiene encendido).',
                    'Toca **Enviar**.',
                ],
            },
            { t: 'demo', key: 'ficha-comentar', caption: 'Dejar un comentario en un registro.', fallback: 'ficha-comentarios' },
            { t: 'h', text: 'Responder, reaccionar, editar' },
            {
                t: 'settings',
                title: 'Lo que se puede hacer con un comentario',
                rows: [
                    { name: 'Responder', what: 'Abre un hilo debajo del comentario. Las respuestas avisan al autor del comentario y a quienes ya respondieron.' },
                    { name: 'Reaccionar', what: 'Un emoji: 👍 ❤️ 😄 🎉 👀 🙏 ✅ 🔥. Al pasar el mouse por una reacción ves quién reaccionó.', tip: 'Un ✅ dice «hecho» sin llenar la conversación de mensajes.' },
                    { name: 'Editar', what: 'Corrige tu comentario. Queda la marca «(editado)».' },
                    { name: 'Eliminar comentario', what: 'Lo borra. Si tenía respuestas, se conservan y en su lugar queda «Comentario eliminado».' },
                ],
            },
            { t: 'h', text: 'Lo que ve el cliente' },
            {
                t: 'p',
                md: 'Si la lista tiene **portal del cliente**, el cuadro de comentar trae la casilla **Visible para el cliente**:\n\n- **Sin marcar** (lo normal): es una **nota interna**, sólo la ve el equipo.\n- **Marcada**: el cliente la ve en su portal y puede responder. Esos comentarios llevan la marca **Del cliente** o se ven como visibles.\n\nUna respuesta toma la visibilidad del comentario de arriba: «El cliente también verá tu respuesta» o «Respuesta interna: sólo la ve el equipo».',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Revisa la casilla antes de enviar: lo que marques como visible lo lee el cliente. Para hablar del cliente entre ustedes, deja la casilla sin marcar.',
            },
            { t: 'h', text: 'Llamadas, correos y reuniones (ficha diseñada)' },
            {
                t: 'p',
                md: 'En una ficha diseñada, la caja de comentar tiene cuatro modos: **Nota**, **Llamada** (con **Duración (min)** y **Resultado**), **Email** (con **Para** y **Asunto**) y **Reunión** (con **Asistentes** y **Cuándo**). Así el historial de contacto con un cliente queda completo, con un ícono por tipo. Arriba, un filtro deja ver **Todo**, sólo **Comentarios** o sólo **Cambios**.',
            },
            {
                t: 'example',
                title: 'Un despacho de abogados',
                md: 'En cada **Caso**, los abogados se dejan notas internas («@Laura revisa el poder antes del viernes») y, con **Visible para el cliente**, le cuentan al cliente el avance: «Radicamos la demanda hoy». El cliente responde desde su portal y la respuesta llega a la conversación del caso.',
            },
            {
                t: 'example',
                title: 'Un equipo de ventas',
                md: 'Después de cada llamada, el vendedor registra una **Llamada** de 15 minutos con el resultado «Pide propuesta». Al revisar una oportunidad, el gerente ve todos los contactos ordenados en el tiempo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿A quién le llega un aviso de un comentario?', a: 'A quien mencionas, a quien sigue el registro y, en un hilo, a los que participan. Nadie recibe aviso de lo que escribió él mismo.' },
                    { q: 'No me deja comentar.', a: 'Puedes ver el registro pero tu acceso no incluye comentar. La app lo dice debajo de los comentarios.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'La actividad y el historial', article: 'fichas-actividad-historial' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'fichas-actividad-historial',
        route: '/lists',
        related: ['fichas-comentarios', 'lote-historial-deshacer', 'fichas-abrir'],
        blocks: [
            {
                t: 'p',
                md: 'Cada cambio en un registro queda anotado: quién, cuándo, qué campo y de qué valor a qué valor. Lo ves en la pestaña **Actividad** de la ficha, en lenguaje claro («Ana cambió Estado de ~~Pendiente~~ a Pagada»), y por cada campo puedes abrir su **historial** y **restaurar** un valor anterior.',
            },
            { t: 'anim', key: 'ficha-historial', caption: 'El historial de «Monto»: tres cambios, y «Restaurar» vuelve a poner el de ayer.' },
            { t: 'h', text: 'La pestaña Actividad' },
            {
                t: 'p',
                md: 'En el panel de la derecha, toca **Actividad**. Cada entrada tiene el avatar de quien hizo el cambio, la frase del cambio (estableció, cambió o vació) con los valores en su formato real —fechas y montos con el formato de tu empresa, opciones con su color— y la hora («hace 2 horas»; al pasar el mouse, la hora exacta). Los cambios seguidos de una misma persona se juntan en una entrada.\n\nTambién aparecen los cambios que hizo una **automatización**, un **agente de IA** o una edición masiva.',
            },
            { t: 'h', text: 'El historial de un campo' },
            {
                t: 'steps',
                items: [
                    'En la ficha, pasa el mouse por el nombre de un campo (en el celular aparece tenue siempre) y toca el ícono de **historial** («Ver historial»).',
                    'Se abre **Historial de «Campo»**: el **Valor actual** arriba y cada cambio de lo más nuevo a lo más viejo, con quién y cuándo.',
                    'En un valor anterior toca **Restaurar este valor**. Se guarda como un cambio más (también queda en la actividad).',
                    'Si hay muchos cambios, **Ver cambios anteriores** carga más.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Cuándo no se puede restaurar',
                md: 'Si el valor viejo ya no es válido (por ejemplo, una opción que se borró del campo, o el campo cambió de tipo), el botón dice **No se puede restaurar** y explica por qué.',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria',
                md: 'Un cliente reclama que le dijeron otro precio. La asesora abre el historial de **Valor** del inmueble: el 12/09 Pedro lo cambió de $ 420.000.000 a $ 398.000.000 y el 20/09 volvió a $ 420.000.000. Con eso aclara el malentendido en dos minutos.',
            },
            {
                t: 'example',
                title: 'Una bodega',
                md: 'Alguien pegó por error una columna de stock en la de stock mínimo de un producto. En vez de reconstruir el valor, el encargado abre el historial de **Stock mínimo** y toca **Restaurar este valor** en el anterior.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Se puede borrar la actividad?', a: 'No: es un registro de lo que pasó. Sí se pueden borrar los comentarios propios.' },
                    { q: '¿Veo cambios de campos que no puedo ver?', a: 'No: la actividad y el historial respetan los campos ocultos de tu rol.' },
                    { q: '¿Y si quiero deshacer un cambio a muchos registros?', a: 'Usa el **Historial de ediciones masivas** de la lista: deshace la edición completa.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Deshacer una edición masiva', article: 'lote-historial-deshacer' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'fichas-subtareas-y-checklists',
        route: '/lists',
        related: ['fichas-plantillas', 'vistas-gantt', 'fichas-tiempo-y-archivos'],
        blocks: [
            {
                t: 'p',
                md: 'Un registro grande se divide de tres formas, según qué tan grande sea cada parte:\n\n- **Subtareas**: partes que son registros propios, con sus campos, su responsable y su estado. «Diseñar el logo» dentro de «Lanzamiento de marca».\n- **Checklists**: pasos chicos dentro del registro, con casilla, responsable y fecha. «Pedir el RUT», «Enviar contrato», «Recibir anticipo».\n- **Dependencias**: qué registros tienen que terminar antes de que éste pueda avanzar.',
            },
            { t: 'anim', key: 'ficha-checklist', caption: 'Marcar los ítems del checklist llena la barra de progreso; en la tabla se ve «☑ 3/4».' },
            { t: 'h', text: 'Subtareas' },
            {
                t: 'steps',
                items: [
                    'En la ficha, baja a **Subtareas** y escribe en «Nombre de la subtarea y Enter». Se crea al instante.',
                    'Cada subtarea es un registro de la misma lista: haz clic para abrir su ficha. Arriba de ella verás **Subtarea de** con el enlace al registro padre.',
                    'En la tabla, el registro padre muestra una flecha para desplegar sus subtareas debajo.',
                    'También se crean desde el menú de una fila (**Crear subtarea**), desde la descripción (**/Subtarea**) o convirtiendo un ítem de checklist.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Hay **un solo nivel**: una subtarea no puede tener subtareas. Al borrar un registro, sus subtareas van con él a la papelera (y vuelven con él).',
            },
            { t: 'h', text: 'Checklists' },
            {
                t: 'steps',
                items: [
                    'En **Checklists**, escribe en «Agregar un checklist: pasos, requisitos, lo que falta…» y ponle nombre.',
                    'Agrega ítems: **Enter** agrega el siguiente. Si **pegas varias líneas**, se crea un ítem por línea.',
                    'En cada ítem puedes marcar la casilla, **Asignar responsable** (o **Asignármelo**), **Poner fecha** y, en su menú, **Editar el texto**, **Convertir en subtarea** o **Eliminar ítem**.',
                    'Arrastra los ítems para reordenarlos. **Ocultar hechos** / **Mostrar hechos (N)** limpia la vista.',
                    'En el menú del checklist: **Cambiar el nombre**, **Subir**, **Bajar**, **Guardar como plantilla** y **Eliminar checklist**.',
                ],
            },
            {
                t: 'p',
                md: 'Cada checklist tiene su barra de **Progreso**. Cuando un ítem tiene responsable, a esa persona le llega un aviso y el ítem aparece en su **Mi trabajo**. Para ver el avance en la tabla y en los tableros, agrega a la lista un campo **Progreso del checklist** (de 0 a 100).',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Checklists listos para usar',
                md: 'Si siempre usas los mismos pasos («Alta de cliente nuevo»), guárdalos como plantilla desde el menú del checklist. Después, en cualquier registro, el botón **Desde una plantilla** los agrega con un clic.',
            },
            { t: 'h', text: 'Dependencias' },
            { t: 'anim', key: 'ficha-dependencias', caption: '«Instalar el piso» está bloqueado por «Secado del cemento»; al intentar cerrarlo, la app avisa.' },
            {
                t: 'p',
                md: 'En la sección **Dependencias** hay dos listas: **Bloqueado por** (lo que tiene que terminar antes) y **Bloquea a** (lo que espera por este). Toca **Agregar**, busca el registro y, si quieres, pon un **Desfase en días**. Cada uno muestra su estado (**Abierto** o **Terminado**); quítalo con la ×.\n\nMientras algo que lo bloquea siga abierto, el registro muestra un **candado** en la tabla y en el tablero. Si intentas cerrarlo igual, la app pregunta: «Todavía está bloqueado por… ¿Cerrar igual?».',
            },
            {
                t: 'p',
                md: 'Las dependencias también se dibujan como flechas en la vista **Gantt**, donde además se crean tirando de una barra a otra. Con la regla **Reprogramar en cadena** encendida, correr la fecha de un registro corre las de los que dependen de él.',
            },
            {
                t: 'example',
                title: 'Una constructora',
                md: 'La actividad **Instalación eléctrica del piso 3** tiene un checklist «Antes de empezar» (planos aprobados, material en obra, permiso de altura) con responsable y fecha por ítem, dos subtareas para los subcontratistas y está **Bloqueada por** «Muros del piso 3». En el Gantt se ve la flecha entre las dos.',
            },
            {
                t: 'example',
                title: 'Un estudio contable',
                md: 'Cada **Cliente** tiene un checklist mensual «Cierre del mes» que sale de una plantilla: recibir extractos, conciliar, liquidar IVA, enviar estados financieros. La barra de progreso en la tabla muestra a la socia qué clientes van atrasados.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cuándo uso subtarea y cuándo checklist?', a: 'Si la parte necesita sus propios campos, fechas, comentarios o su propia ficha, es una subtarea. Si es un paso para marcar, es un ítem de checklist.' },
                    { q: '¿Puedo crear dependencias con registros de otra lista?', a: 'Desde la ficha, las dependencias son entre registros de la misma lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Plantillas de checklist', article: 'fichas-plantillas' },
                    { label: 'La vista Gantt', article: 'vistas-gantt' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'fichas-tiempo-y-archivos',
        route: '/lists',
        related: ['fichas-subtareas-y-checklists', 'vistas-carga-de-trabajo', 'fichas-abrir'],
        blocks: [
            {
                t: 'p',
                md: 'Dos herramientas de la ficha para el trabajo del día a día: el **registro de tiempo**, para saber cuántas horas se le dedican a cada cliente o proyecto, y los **archivos**, que se suben, se ven y se descargan sin salir del registro.',
            },
            { t: 'anim', key: 'ficha-tiempo', caption: 'El cronómetro corre mientras trabajas; al detenerlo queda una entrada y el total se actualiza.' },
            { t: 'h', text: 'El cronómetro' },
            {
                t: 'steps',
                items: [
                    'En la sección **Registro de tiempo** de la ficha, toca **Iniciar cronómetro**.',
                    'Trabaja tranquilo: arriba de la app aparece un chip con el cronómetro en curso, aunque cambies de pantalla o de pestaña.',
                    'Toca **Detener**. Queda una entrada con tu nombre, la fecha y la duración.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Cada persona tiene **un solo cronómetro** en curso en toda la empresa. Si inicias otro en un registro distinto, el anterior se detiene y se guarda solo.',
            },
            { t: 'h', text: 'Cargar tiempo a mano' },
            {
                t: 'p',
                md: 'Si olvidaste prender el cronómetro, toca **Registrar tiempo** y completa **Fecha**, **Duración** (se escribe como «1h 30m», «45m» o «1:30») y una **Nota** opcional («qué hiciste»). Cada entrada se puede **Editar** o eliminar: las tuyas siempre, las de otros si eres administrador o gerente.\n\nLa sección muestra el **Tiempo registrado** total y el total **Por persona**. Con **Exportar el tiempo de la lista (CSV)** descargas todas las entradas de la lista para facturar o liquidar.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Sumar horas en la tabla',
                md: 'Agrega a la lista un campo **Tiempo registrado**: muestra el total de cada registro, se ordena y se suma al pie de la tabla y en los tableros. La vista **Carga de trabajo** también puede medir el tiempo registrado.',
            },
            {
                t: 'example',
                title: 'Una agencia que factura por horas',
                md: 'Cada diseñador prende el cronómetro en el **Proyecto** en que trabaja. A fin de mes, la tabla de proyectos con la columna **Tiempo registrado** y el pie sumando dice cuántas horas facturarle a cada cliente, y el CSV va al contador.',
            },
            { t: 'h', text: 'Archivos' },
            {
                t: 'p',
                md: 'Los archivos se guardan en campos de tipo **Archivo** (por ejemplo «Contrato», «Fotos», «Soportes»). En la ficha, toca **Subir archivo** o arrastra el archivo encima («o arrástralo aquí»). Cada archivo puede pesar hasta 20 MB, y el campo puede tener un máximo de archivos. **Agregar otro** suma más; la × lo quita.\n\nTambién puedes poner imágenes y adjuntos dentro de la **descripción** con el menú «/».',
            },
            { t: 'anim', key: 'ficha-archivos', caption: 'Un clic en el archivo abre el visor: el PDF se lee sin descargarlo.' },
            { t: 'h', text: 'El visor de archivos' },
            {
                t: 'p',
                md: 'Haz clic en un archivo (en la tabla, la ficha o la descripción) y se abre el **visor** a pantalla completa. Se ven imágenes (con **Acercar**, **Alejar**, **Ver al 100 %** y **Ajustar a la pantalla**), PDF, videos, audios y archivos de texto. Las flechas **←** y **→** pasan al archivo **Anterior** o **Siguiente**; **Descargar** y **Abrir en otra pestaña** están arriba; **Escape** lo cierra. Con **Ctrl + clic** (⌘ + clic) el archivo se abre directo en otra pestaña.',
            },
            {
                t: 'example',
                title: 'Un taller de carros',
                md: 'En cada **Orden de trabajo**, el mecánico sube desde el celular las fotos del vehículo al recibirlo y la cotización del repuesto en PDF. El asesor las revisa en el visor desde su computador mientras habla con el cliente, sin descargar nada.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué archivos se ven sin descargar?', a: 'Imágenes, PDF, videos, audios y texto (CSV y similares). Los demás muestran «Este tipo de archivo no tiene vista previa» y se descargan.' },
                    { q: '¿Los archivos cuentan para mi plan?', a: 'Sí, según el almacenamiento de tu plan, salvo que la empresa guarde los archivos en su propio almacenamiento.' },
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
        id: 'fichas-plantillas',
        route: '/lists',
        related: ['fichas-subtareas-y-checklists', 'fichas-abrir', 'lote-estructura'],
        blocks: [
            {
                t: 'p',
                md: 'Una **plantilla de registro** crea un registro que nace con todo puesto: sus valores, sus **subtareas** y sus **checklists**, con fechas que se calculan solas («en 3 días hábiles») y responsables («quien crea el registro»). Una **plantilla de checklist** es una lista de pasos lista para agregar a cualquier registro.\n\nSirven para todo lo que se repite: alta de un cliente, un proyecto tipo, un pedido estándar, un caso de soporte.',
            },
            { t: 'anim', key: 'ficha-plantilla', caption: '«Nuevo registro ▾ → Desde una plantilla»: el registro nace con sus subtareas y su checklist.' },
            { t: 'h', text: 'Crear un registro desde una plantilla' },
            {
                t: 'steps',
                items: [
                    'En la lista, toca la flecha de **Nuevo registro** y, en **Desde una plantilla**, elige la plantilla.',
                    'Se abre el alta con los valores ya puestos. Lo que escribas ahí **pisa** lo de la plantilla.',
                    'Toca **Crear desde la plantilla**. Nacen el registro, sus subtareas y sus checklists de una vez.',
                ],
            },
            {
                t: 'p',
                md: 'En el alta normal también hay un selector **Plantilla** (con **Sin plantilla**) que dice qué trae cada una («Trae: 3 valores, 4 subtareas, 1 checklist»). Las plantillas también se usan en los **formularios**, en la acción de automatización **Crear subtareas desde una plantilla** y al crear registros desde el asistente.',
            },
            { t: 'h', text: 'Guardar un registro como plantilla' },
            {
                t: 'steps',
                items: [
                    'Abre un registro que esté como quieres repetirlo y toca **Guardar como plantilla** (el ícono del marcador con +).',
                    'Ponle **Nombre** y, si quieres, una **Descripción (opcional)**.',
                    'En **Incluir** marca qué lleva: **Los valores de los campos** (las fechas pasan a ser relativas a hoy: +N días), **Sus subtareas** (con responsable y fechas), **Sus checklists** (los ítems quedan sin marcar) y **La descripción**.',
                    'Toca **Guardar plantilla**.',
                ],
            },
            { t: 'h', text: 'Editar las plantillas' },
            {
                t: 'p',
                md: 'Las plantillas de una lista se administran en **Configurar lista → Plantillas** (o en **Administrar plantillas…** desde el menú de **Nuevo registro**). Hay dos grupos: **Plantillas de registro** y **Plantillas de checklist**, cada uno con **Nueva plantilla**.',
            },
            {
                t: 'settings',
                title: 'El editor de una plantilla de registro',
                rows: [
                    { name: 'Valores del registro', what: 'Lo que el registro trae puesto al nacer. **+ Agregar un valor…** elige el campo.' },
                    { name: 'Fechas → Tipo de fecha', what: '**Relativa** («3 días hábiles desde que se crea», con hora si el campo la tiene) o **Fija**. Los días pueden ser **días** o **días hábiles** (sin fines de semana ni festivos de Colombia).', tip: 'Un vencimiento «+30 días» o una primera llamada «+1 día hábil a las 9:00».' },
                    { name: 'Personas → Responsable', what: '**Sin responsable**, **Quien crea el registro**, **El de** otro campo de persona, o **Una persona fija…**.' },
                    { name: 'Subtareas', what: 'Cada una nace como un registro hijo, con su título, su responsable y su fecha relativa.' },
                    { name: 'Checklists', what: 'Con sus ítems; cada ítem puede llevar responsable y fecha relativa.' },
                ],
            },
            {
                t: 'example',
                title: 'Una agencia de viajes',
                md: 'La plantilla **Viaje a Europa** crea el registro con «Estado: Cotizando», tres subtareas (reservar vuelos +2 días hábiles, hoteles +5, seguro +7, todas asignadas a quien crea el viaje) y el checklist «Documentos» (pasaporte vigente, visa, carta laboral). La asesora arma un viaje nuevo en un clic.',
            },
            {
                t: 'example',
                title: 'Una empresa de soporte técnico',
                md: 'Cada tipo de caso (instalación, garantía, mantenimiento) tiene su plantilla con el checklist de diagnóstico. Desde el formulario público de solicitudes, el caso nace con la plantilla según el servicio elegido.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Si cambio una plantilla, ¿cambian los registros que ya salieron de ella?', a: 'No. La plantilla sólo se usa al crear; los registros existentes no cambian.' },
                    { q: '¿Quién puede crear plantillas?', a: 'Quien puede administrar la lista. Usarlas, cualquiera que pueda crear registros.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Subtareas y checklists', article: 'fichas-subtareas-y-checklists' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'fichas-acciones',
        route: '/my-work',
        related: ['fichas-abrir', 'fichas-comentarios', 'fichas-disenar'],
        blocks: [
            {
                t: 'p',
                md: 'La barra de arriba de la ficha reúne las acciones que se hacen **sobre** el registro: seguirlo para enterarte de todo, pedir que la app te lo recuerde, generar un PDF, compartirlo con alguien de afuera, darle acceso al cliente a su portal y pedir una aprobación.',
            },
            { t: 'anim', key: 'ficha-acciones', caption: 'Seguir el registro, programar un recordatorio y generar su PDF desde la barra de la ficha.' },
            { t: 'h', text: 'Seguir un registro' },
            {
                t: 'p',
                md: 'Toca el **ojo** («Seguir: avísame de comentarios y cambios»). Desde ese momento te llegan a la campana los comentarios y cambios de ese registro. El ojo queda del color de la marca y dice cuántas personas lo siguen; tócalo de nuevo para dejar de seguir.\n\nNo hace falta seguir todo a mano: sigues **solo** lo que creas, lo que comentas y lo que tienes asignado. Lo que sigues aparece en **Mi trabajo → Siguiendo**.',
            },
            { t: 'h', text: 'Recordarme' },
            {
                t: 'steps',
                items: [
                    'Toca el **reloj** (**Recordarme**).',
                    'Elige cuándo: **En 1 hora**, **Hoy a las 17:00**, **Mañana a las 9:00**, **En 3 días**, **El lunes a las 9:00** u **Otra fecha…**.',
                    'Si quieres, escribe una nota («Nota (opcional): qué tienes que hacer») y toca **Recordarme**. Abajo ves la fecha y hora exactas del aviso.',
                    'A esa hora te llega el aviso a la campana (y por correo o al celular, si lo tienes encendido). Tus recordatorios pendientes se ven en **Mi trabajo → Recordatorios**.',
                ],
            },
            { t: 'demo', key: 'ficha-recordarme', caption: 'Programar un recordatorio desde la ficha.', fallback: 'ficha-acciones' },
            { t: 'h', text: 'Generar PDF' },
            {
                t: 'p',
                md: 'Toca **Generar PDF** y elige la plantilla de documento (una cuenta de cobro, una cotización, un recibo). Para cada una puedes **Ver** (revisar sin emitir número), **Descargar** (la primera vez lo emite y lo congela), **Copiar enlace (30 días)** o **Guardar en** un campo de archivo. Las plantillas se diseñan en **Configurar lista → Documentos**.',
            },
            { t: 'h', text: 'Compartir este registro con alguien de afuera' },
            {
                t: 'p',
                md: 'El ícono de la persona con **+** abre **Compartir este registro**: invitas por email a alguien que no es de tu equipo (un proveedor, un socio) a ver **sólo** ese registro, sin nada más de la empresa. No ocupa un usuario de tu plan. Desde ahí también le cambias el nivel o le quitas el acceso.',
            },
            { t: 'h', text: 'Acceso al portal del cliente' },
            {
                t: 'p',
                md: 'Si la lista tiene **portal** activo, la ficha tiene la tarjeta **Acceso al portal del cliente**. Escribe el email del cliente y toca **Dar acceso**: le llega un enlace para entrar a su portal y ver este registro. La tarjeta muestra quién tiene acceso, su **Última entrada** (o «Todavía no entró»), **Reenviar enlace**, **Copiar enlace de entrada al portal** y **Quitar acceso**.',
            },
            { t: 'h', text: 'Aprobaciones' },
            {
                t: 'p',
                md: 'Si la lista tiene flujos de aprobación, la ficha muestra la sección **Aprobación** con **Pedir aprobación** y, a quien le toca decidir, el aviso **Pendiente de tu aprobación** con sus botones. Los flujos se configuran en **Configurar lista → Aprobaciones**.',
            },
            {
                t: 'example',
                title: 'Una empresa de mantenimiento',
                md: 'El jefe de operaciones **sigue** los contratos de sus tres clientes más grandes, así se entera de cada novedad sin estar asignado. En un contrato que vence pone **Recordarme** «En 3 días» con la nota «Llamar para renovar». Cuando el cliente acepta, genera el PDF de la cotización y le da **acceso al portal** para que la descargue y la firme.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo el botón de WhatsApp.', a: 'Aparece sólo si la empresa conectó WhatsApp Business en Integraciones.' },
                    { q: '¿Puedo poner un recordatorio para otra persona?', a: 'Los recordatorios son personales. Para que otra persona se acuerde, asígnale el registro o un ítem de checklist con fecha.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Mi trabajo', to: '/my-work' },
                    { label: 'Diseñar la ficha', article: 'fichas-disenar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'fichas-disenar',
        route: '/lists',
        related: ['fichas-abrir', 'fichas-acciones', 'vistas-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'Cada lista elige cómo se ve la ficha de sus registros. La **ficha simple** muestra todos los campos uno debajo del otro. La **ficha diseñada** es una página armada: una **portada** con el título y los datos clave, **etapas** clickeables, **pestañas**, secciones en columnas, cada campo con la forma que mejor lo muestra (una cifra grande, un anillo de avance, una cuenta regresiva) y **gráficos y tablas de lo vinculado** («las facturas de este cliente por estado»).\n\nLa ficha diseñada **se guarda sola** campo por campo.',
            },
            { t: 'anim', key: 'ficha-disenar', caption: 'En el editor, un gráfico de las facturas del cliente se arrastra a la ficha y se ve con datos reales.' },
            { t: 'h', text: 'Elegir la apariencia' },
            {
                t: 'steps',
                items: [
                    'En la lista toca **Configurar lista** y abre **Apariencia**.',
                    'Elige **Ficha simple** o **Ficha diseñada**.',
                    'Con la ficha diseñada, elige una **Plantilla**. Todas se arman solas con tus campos y relaciones.',
                    'Si quieres retocarla, toca **Abrir el editor** (o **Editar diseño** si ya la personalizaste).',
                ],
            },
            {
                t: 'settings',
                title: 'Las plantillas de la ficha diseñada',
                rows: [
                    { name: 'Automática', what: 'Una banda con los números clave, los detalles y un adelanto de lo vinculado (por estado y los últimos).', tip: 'Buen punto de partida para cualquier lista.' },
                    { name: 'Contacto', what: 'Perfil de la persona: botones para escribir o llamar, sus datos al costado y lo que tiene con la empresa como tarjetas.', tip: 'Clientes, pacientes, estudiantes.' },
                    { name: 'Venta / Oportunidad', what: 'El valor del negocio en grande, el cierre en cuenta regresiva, lo vinculado como tablero y el historial a lo ancho.' },
                    { name: 'Tarea', what: 'Plana y sin portada: el trabajo y la conversación al centro, entrega y propiedades en un panel al costado.' },
                    { name: 'Soporte', what: 'Una franja de SLA (prioridad, vencimiento, estado), la conversación como protagonista y el historial del cliente.' },
                    { name: 'Personalizada', what: 'La que armas con el editor visual.' },
                ],
            },
            { t: 'demo', key: 'ficha-apariencia', caption: 'Elegir la apariencia de la ficha en la configuración de la lista.', fallback: 'ficha-disenar' },
            { t: 'h', text: 'El editor de la ficha' },
            {
                t: 'p',
                md: 'El editor tiene tres partes:\n\n- **A la izquierda**, la pestaña **Bloques** (con buscador: arrastra un bloque a la ficha o haz clic para agregarlo debajo de lo elegido) y la pestaña **Estructura** (las **Pestañas** de la ficha —crear, renombrar, ordenar, eliminar— y el esquema de cada página).\n- **Al centro**, **la ficha real** con los datos de un registro que eliges arriba. Cada sección tiene su barra (columnas, subir, bajar, duplicar, eliminar) y cada columna su **+ Bloque**. Abajo, **Agregar una sección**.\n- **A la derecha**, los ajustes de lo que elegiste.',
            },
            {
                t: 'settings',
                title: 'Los bloques',
                rows: [
                    { name: 'Datos del registro', what: '**Propiedades** (varios campos editables, en lista o grilla), **Un campo destacado**, **Etapas**, **Descripción**, **Archivos**, **Subtareas**, **Checklists**, **Dependencias**, **Aprobación**, **Registro de tiempo**, **Resumen de actividad**, **Botón de acción**.' },
                    { name: 'Registros vinculados', what: '**Tabla de vinculados**, **Tabla editable** (ítems de una cotización con totales), **Tarjetas**, **Tablero por estado**, **Línea de tiempo**, **Lista compacta**, **Galería**.' },
                    { name: 'Gráficos', what: '**Indicador**, **Barras**, **Dona**, **Líneas**, **Área**, **Embudo**, **Medidor** y **Tabla resumen**, calculados sobre lo vinculado a ese registro.', tip: '«Total facturado» y una dona de las facturas por estado en la ficha de cada cliente.' },
                    { name: 'Conversación', what: '**Actividad y comentarios**, **Comentarios**, **Acceso al portal**, **Pagos**.' },
                    { name: 'Contenido', what: '**Título**, **Texto**, **Aviso**, **Imagen**, **Galería de imágenes**, **Botón**, **Video o documento**, **Enlace de un campo**, **Divisor**, **Espacio**.' },
                ],
            },
            {
                t: 'p',
                md: 'Al elegir **Un campo destacado**, en **Forma de mostrarlo** cambias cómo se ve según su tipo: un monto como **Cifra grande** o **Barra hacia una meta**; un porcentaje como **Anillo** o **Medidor**; una fecha como **Cuenta regresiva** u **Hoja de calendario**; una selección como **Etapas**.',
            },
            {
                t: 'settings',
                title: 'La cabecera y el tema',
                rows: [
                    { name: 'Cabecera → Datos', what: 'El título, una **Línea bajo el título** (hasta 4 campos), **Propiedades clave** (hasta 8, como chips editables), **Etapas** (un campo de selección como pasos) y **Mostrar creado y actualizado**.' },
                    { name: 'Cabecera → Portada y Avatar', what: 'Portada en degradé, color o imagen; avatar con iniciales, una imagen o ninguno.' },
                    { name: 'Tema de la ficha', what: '**Clásico**, **Minimal**, **Corporativo**, **Fresco** o **Cálido**, con **Color de acento**, **Esquinas**, **Espacio entre bloques** y **Aspecto de los bloques** (Tarjetas, Con borde, Planos).' },
                    { name: 'Sección', what: 'Título opcional, **Columnas** (en el celular se apilan solas) y **Banda** o **Fondo**.' },
                ],
            },
            {
                t: 'p',
                md: 'Arriba del editor: **Deshacer** (Ctrl + Z) y **Rehacer** (Ctrl + Mayús + Z), la **Vista previa** en **Escritorio** o **Celular**, el registro con el que se ve, **Plantillas** para arrancar de otra, **Automático** para volver al diseño que arma la app, y **Guardar** (Ctrl + S). Si sales sin guardar, la app te avisa.',
            },
            {
                t: 'example',
                title: 'Una empresa de software (clientes)',
                md: 'La ficha de cada **Cliente** tiene una pestaña **Resumen** con una banda de indicadores (total facturado, saldo pendiente, días desde el último pago), una dona de sus facturas por estado y las últimas cinco facturas; otra pestaña **Soporte** con sus tickets como tablero por estado; y **Contrato** con los archivos y la fecha de renovación en cuenta regresiva.',
            },
            {
                t: 'example',
                title: 'Una academia',
                md: 'La ficha de cada **Estudiante** usa la plantilla **Contacto**: botones para escribirle o llamar al acudiente, sus datos al costado, y sus **Pagos** y **Notas** de otras listas como tarjetas.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quién puede diseñar la ficha?', a: 'Quien administra la lista. El diseño se ve igual para todo el equipo.' },
                    { q: '¿Si cambio de plantilla pierdo mi diseño?', a: 'Elegir otra plantilla reemplaza el diseño hecho en el editor; la app pide confirmación antes.' },
                    { q: '¿Puedo diseñar lo que ve el cliente en su portal?', a: 'Sí, con el mismo editor desde la configuración del portal de la lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Abrir un registro', article: 'fichas-abrir' },
                ],
            },
        ],
    },
];
