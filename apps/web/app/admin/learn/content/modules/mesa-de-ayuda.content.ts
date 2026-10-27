import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mesa-que-es',
        route: '/lists',
        related: ['mesa-conectar-buzon', 'mesa-tickets', 'mesa-sla'],
        blocks: [
            {
                t: 'p',
                md: 'Si tus clientes te escriben a **soporte@tuempresa.com**, la mesa de ayuda convierte cada correo en un **ticket**: un registro de una lista, con número, estado, prioridad y responsable. Cuando el cliente contesta, su respuesta se suma al **mismo ticket**. El equipo responde desde la ficha, sin abrir el correo, y un reloj de **SLA** avisa antes de que se venza el tiempo prometido.',
            },
            { t: 'anim', key: 'mesa-hero', caption: 'Llega un correo al buzón de soporte y aparece como ticket nuevo en la lista, con su número.' },
            { t: 'h', text: 'El recorrido de un ticket' },
            {
                t: 'steps',
                items: [
                    'El cliente escribe a tu dirección de soporte. Cada minuto la app revisa el buzón y el correo nuevo se vuelve un **ticket** en la lista.',
                    'Alguien del equipo lo toma (o una automatización lo asigna) y le pone la **prioridad**.',
                    'Desde la ficha del ticket toca **Responder por correo**: el cliente recibe la respuesta en su bandeja, con el número del ticket en el asunto.',
                    'Si el cliente contesta, su respuesta llega como comentario al **mismo ticket**, y si estaba cerrado, se reabre.',
                    'Al resolverlo, cambias el estado a **Cerrado** (o lo eliges al enviar la última respuesta). El SLA marca si se cumplió a tiempo.',
                ],
            },
            { t: 'anim', key: 'mesa-thread', caption: 'El número del ticket en el asunto mantiene unida toda la conversación.' },
            {
                t: 'cards',
                items: [
                    { icon: 'Inbox', title: 'El buzón no cambia', md: 'La app sólo lee: no borra ni mueve correos. Tu buzón sigue igual que siempre.', tone: 'blue' },
                    { icon: 'Ticket', title: 'Tickets numerados', md: 'Con un campo de ID automático cada ticket lleva un número como TCK-0042.', tone: 'rose' },
                    { icon: 'Send', title: 'Responder desde la ficha', md: 'Con respuestas guardadas, firma y el estado en que queda el ticket.', tone: 'mint' },
                    { icon: 'Timer', title: 'SLA en horas hábiles', md: 'Objetivos por prioridad, avisos de riesgo y escalamiento al vencer.', tone: 'amber' },
                ],
            },
            { t: 'h', text: 'La forma más rápida: la plantilla' },
            {
                t: 'p',
                md: 'Al crear una lista, en la galería de plantillas elige **Mesa de ayuda / Tickets**. Trae todo armado: asunto, número de ticket automático, solicitante, correo, canal, estado, prioridad, responsable, fecha de llegada, las columnas del SLA, satisfacción, descripción y adjuntos; las vistas **Tabla**, **Por estado** y **Por SLA**, y los objetivos de SLA ya cargados. Sólo te falta **conectar el buzón**.',
            },
            {
                t: 'settings',
                title: 'Objetivos que trae la plantilla (en horas hábiles)',
                rows: [
                    { name: 'Urgente', what: 'Primera respuesta en 1 hora, resolución en 4.' },
                    { name: 'Alta', what: 'Primera respuesta en 4 horas, resolución en 8.' },
                    { name: 'Normal', what: 'Primera respuesta en 8 horas, resolución en 24.' },
                    { name: 'Baja', what: 'Primera respuesta en 24 horas, resolución en 72.' },
                ],
            },
            {
                t: 'example',
                title: 'El soporte de una empresa de software contable',
                md: 'Cinco personas atienden a 800 clientes que escriben a **soporte@contaplus.co**. Con la mesa de ayuda, cada correo es un ticket en la lista **Soporte**. Una automatización le contesta al cliente «Recibimos tu solicitud, tu número es TCK-0137» y otra asigna los que dicen «factura electrónica» a Laura. La líder mira el kanban **Por SLA** cada mañana y se entera de lo que está en riesgo antes de que el cliente llame molesto.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'También sirve con tickets creados a mano',
                md: 'Si un cliente llama por teléfono, crea el ticket a mano en la misma lista. Mide el SLA igual. Para responderle por correo, completa su campo de correo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Necesito una lista especial?', a: 'No. Cualquier lista puede recibir correos: conectas el buzón en sus ajustes y eliges a qué campo va cada parte del correo. La plantilla te ahorra armar los campos.' },
                    { q: '¿Puedo tener varias mesas de ayuda?', a: 'Sí, una por lista: por ejemplo **Soporte** con soporte@ y **Garantías** con garantias@, cada una con su buzón y su SLA.' },
                    { q: '¿El cliente necesita una cuenta?', a: 'No. Escribe y recibe respuestas por correo, como siempre. Si además quieres que vea sus tickets en línea, dale acceso al portal del cliente.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Conectar el buzón', article: 'mesa-conectar-buzon' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mesa-conectar-buzon',
        route: '/lists',
        related: ['mesa-tickets', 'mesa-que-es', 'ajustes-empresa-correo'],
        blocks: [
            {
                t: 'p',
                md: 'El buzón se conecta **por lista**, en los ajustes de la lista que recibirá los tickets, pestaña **Correo entrante**. La app entra al buzón con los mismos datos que usaría un programa de correo y lo revisa **cada minuto**. Sólo lee: no borra, no mueve y, salvo que lo pidas, ni siquiera marca los correos como leídos.',
            },
            { t: 'demo', key: 'mesa-buzon', caption: 'Conectar el buzón de soporte en los ajustes de la lista.', fallback: 'mesa-hero' },
            { t: 'h', text: 'Antes de empezar: la contraseña de aplicación' },
            {
                t: 'p',
                md: 'Gmail, Google Workspace y Zoho no dejan entrar a otros programas con tu contraseña normal: piden una **contraseña de aplicación**, una clave especial que se crea en la cuenta y sólo sirve para esto. Al elegir el proveedor, el panel te muestra los pasos para crearla.',
            },
            {
                t: 'settings',
                title: 'Proveedores',
                rows: [
                    { name: 'Gmail / Google Workspace', what: 'Servidor imap.gmail.com, puerto 993. Activa la verificación en dos pasos y crea la contraseña de aplicación en tu cuenta de Google.', tip: 'En Workspace, el administrador puede tener que habilitar el acceso IMAP.' },
                    { name: 'Outlook / Microsoft 365', what: 'Servidor outlook.office365.com, puerto 993.', tip: 'Microsoft ya no permite entrar con contraseña en la mayoría de cuentas. Si no conecta, reenvía los correos de soporte a un buzón de Gmail o Zoho y conecta ese.' },
                    { name: 'Zoho Mail', what: 'imap.zoho.com (o imappro.zoho.com en cuentas de pago; .eu o .in según la región de tu cuenta).' },
                    { name: 'Otro proveedor (hosting, cPanel…)', what: 'Los datos IMAP que te dé tu proveedor de correo.' },
                ],
            },
            { t: 'h', text: 'Los datos del buzón' },
            {
                t: 'settings',
                rows: [
                    { name: 'Dirección de soporte', what: 'La que ven tus clientes y a la que escriben. Las respuestas salen con esta dirección.' },
                    { name: 'Usuario del buzón', what: 'Casi siempre, la misma dirección de correo.' },
                    { name: 'Contraseña de aplicación', what: 'Se guarda cifrada y no vuelve a mostrarse.' },
                    { name: 'Carpeta', what: 'De dónde se leen los correos. Por defecto INBOX (la bandeja de entrada).', tip: 'Si usas un filtro que manda el soporte a otra carpeta, escribe su nombre.' },
                    { name: 'Servidor IMAP, Seguridad y Puerto', what: 'Se completan solos con el proveedor. Seguridad SSL/TLS con el puerto 993 es lo habitual.' },
                    { name: 'Marcar como leídos los correos que se conviertan en ticket', what: 'Apagado por defecto. Enciéndelo si el equipo también mira el buzón y quiere ver qué ya se procesó.' },
                    { name: 'Leer el buzón', what: 'Apágalo para pausar la lectura sin perder la configuración.' },
                ],
            },
            { t: 'h', text: 'Probar y conectar' },
            {
                t: 'steps',
                items: [
                    'Toca **Probar conexión**. La app recorre los pasos uno por uno: **Servidor**, **Conexión**, **Seguridad (TLS)**, **Usuario y contraseña** y **Carpeta**. Si algo falla, te dice en cuál y por qué.',
                    'Cuando todo sale bien, toca **Conectar el buzón**.',
                    'Desde ese momento llegan como tickets los correos **nuevos**: los que ya estaban en el buzón no se importan.',
                ],
            },
            {
                t: 'settings',
                title: 'Estados del buzón',
                rows: [
                    { name: 'Conectado', what: 'Se revisa cada minuto. Con **Revisar ahora** no esperas al minuto siguiente.' },
                    { name: 'En pausa', what: 'Apagaste **Leer el buzón**.' },
                    { name: 'Con problemas', what: 'No se pudo entrar (por ejemplo, cambiaron la contraseña). Además se abre un aviso en Problemas.' },
                    { name: 'Correos en espera', what: 'Llegaron correos pero no se pudieron crear tickets, por ejemplo porque se llegó al límite de registros del plan. Esperan en el buzón y entran solos cuando hay lugar.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Lo que llegó, a la vista',
                md: 'Debajo del buzón, **Últimos correos** muestra qué pasó con cada uno: **Ticket nuevo**, **Respuesta del cliente**, **Ignorado** (con el motivo), **No se pudo procesar** o **Respuesta enviada**. Es lo primero que conviene mirar si un cliente dice que escribió y no ves su ticket.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Y para enviar las respuestas?', a: 'Salen por el correo configurado de la empresa (el de la plataforma, tu SMTP o tu cuenta de Google o Microsoft), con la dirección de soporte como remitente o como dirección de respuesta.' },
                    { q: 'Cambié la contraseña del correo y dejaron de llegar tickets', a: 'Crea una contraseña de aplicación nueva, toca **Cambiar la conexión**, pégala y vuelve a probar. Los correos que llegaron mientras tanto entran en la próxima revisión.' },
                    { q: '¿Qué pasa si desconecto el buzón?', a: 'Deja de leer. Los tickets que ya existen quedan con todo su historial.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Cómo se crea cada ticket', article: 'mesa-tickets' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mesa-tickets',
        route: '/lists',
        related: ['mesa-conectar-buzon', 'mesa-responder', 'fichas-comentarios'],
        blocks: [
            {
                t: 'p',
                md: 'Debajo del buzón, en la misma pestaña **Correo entrante**, decides **qué parte del correo va a cada campo** de la lista, con qué estado nace cada ticket y qué protecciones aplicar. Si usaste la plantilla, ya está todo puesto.',
            },
            { t: 'demo', key: 'mesa-tickets-config', caption: 'Cómo se crea cada ticket, sus estados y las respuestas guardadas.', fallback: 'mesa-thread' },
            { t: 'h', text: 'Qué parte del correo va a cada campo' },
            {
                t: 'settings',
                title: 'Cómo se crea cada ticket',
                rows: [
                    { name: 'Asunto', what: 'Va al título del registro.' },
                    { name: 'Nombre del cliente', what: 'El nombre que aparece en el correo de quien escribe.' },
                    { name: 'Correo del cliente', what: 'Su dirección. Es la que se usa para responderle y para reconocer sus respuestas.' },
                    { name: 'Fecha de llegada', what: 'Un campo de fecha y hora con el momento en que llegó.' },
                    { name: 'Texto del correo', what: 'Una copia en texto plano. El correo con su formato completo queda en la descripción del ticket.' },
                    { name: 'Adjuntos', what: 'Un campo de archivo. Los archivos cuentan para el almacenamiento del plan.' },
                    { name: 'Vincular al contacto', what: 'Si tienes una lista de clientes, el ticket se vincula al contacto con ese correo.', tip: 'En **Buscar el contacto por** eliges el campo de correo de esa lista.' },
                ],
            },
            { t: 'h', text: 'Los estados del ticket' },
            {
                t: 'settings',
                title: 'Estados del ticket',
                rows: [
                    { name: 'Campo de estado', what: 'El campo de selección que marca en qué va el ticket.' },
                    { name: 'Estado de un ticket nuevo', what: 'Con qué estado nace, por ejemplo **Abierto**.' },
                    { name: 'Esperando al cliente', what: 'Los estados en que la pelota la tiene el cliente. Mientras el ticket está así, el reloj del SLA se detiene.' },
                    { name: 'Cerrado', what: 'Los estados que dan el ticket por terminado.' },
                    { name: 'Si el cliente responde a un ticket cerrado o en espera, pasa a', what: 'El estado al que vuelve cuando el cliente contesta, por ejemplo **En proceso**.' },
                ],
            },
            { t: 'h', text: 'Cómo se mantiene el hilo' },
            { t: 'anim', key: 'mesa-thread', caption: 'La respuesta del cliente vuelve al mismo ticket gracias al número en el asunto.' },
            {
                t: 'p',
                md: 'Cuando el equipo responde, el asunto lleva el número del ticket entre corchetes, por ejemplo **[TCK-0042]** (o **[#123]** si la lista no tiene un campo de ID automático). Cuando el cliente contesta, la app reconoce el hilo por las cabeceras del correo o por ese número, y suma la respuesta al ticket como **comentario visible para el cliente**. Si el ticket estaba cerrado o esperando al cliente, cambia al estado que elegiste.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Numera los tickets',
                md: 'Agrega a la lista un campo **ID automático** con el prefijo TCK. Además de un número fácil de dictar por teléfono, el asunto queda como «Re: Error al facturar [TCK-0042]» y el cliente reconoce su caso.',
            },
            { t: 'h', text: 'Protecciones contra correo basura' },
            {
                t: 'settings',
                title: 'Protecciones',
                rows: [
                    { name: 'Respuestas automáticas', what: 'Los «estoy de vacaciones», los rebotes y los envíos masivos se ignoran solos: no crean tickets ni bucles de correos.' },
                    { name: 'Tickets nuevos por remitente en una hora', what: 'Si alguien manda más que eso, el resto se ignora (con el motivo en **Últimos correos**).' },
                    { name: 'Tamaño máximo (MB)', what: 'Los correos más pesados no crean ticket.' },
                    { name: 'Remitentes bloqueados', what: 'Direcciones completas o dominios enteros, como **@publicidad.com**.' },
                ],
            },
            {
                t: 'example',
                title: 'Garantías de una tienda de electrodomésticos',
                md: 'La lista **Garantías** recibe los correos de garantias@electrohogar.co. El asunto va al título, las fotos del daño a **Adjuntos** y cada ticket se vincula al cliente de la lista **Clientes** por su correo. Así, en la ficha del cliente se ven todas sus garantías, y en el ticket, la ciudad y el teléfono del cliente sin buscarlos.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'El cliente respondió desde otra dirección y se creó un ticket nuevo', a: 'Si el asunto conserva el número del ticket, se suma al mismo. Si escribió un correo nuevo sin número, es un ticket aparte: puedes cerrarlo y dejar un comentario con el enlace al original.' },
                    { q: '¿Qué pasa si se llega al límite de registros del plan?', a: 'Los correos esperan en el buzón y entran solos cuando hay lugar. Mientras tanto, el buzón figura con **Correos en espera** y hay un aviso en Problemas.' },
                    { q: '¿Las respuestas del cliente también se miden en el SLA?', a: 'Sí: reabren el ticket y el reloj vuelve a contar desde donde estaba.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Responder por correo', article: 'mesa-responder' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mesa-responder',
        route: '/lists',
        related: ['mesa-tickets', 'mesa-sla', 'fichas-comentarios'],
        blocks: [
            {
                t: 'p',
                md: 'En la ficha de un ticket, junto a los comentarios, ves el número, el cliente y cómo va el SLA. Con **Responder por correo** le contestas sin salir de la app: la respuesta sale desde la dirección de soporte, en la misma conversación del cliente, y queda guardada en el ticket.',
            },
            { t: 'demo', key: 'mesa-responder', caption: 'Responder un ticket por correo desde la ficha.', fallback: 'mesa-reply' },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'Abre el ticket y toca **Responder por correo**.',
                    'Revisa **Para** (el correo del cliente) y, si hace falta, agrega **Cc**. El **Asunto** ya lleva el número del ticket.',
                    'Escribe la **Respuesta**, o elige una en **Insertar una respuesta guardada…**: se completa con el nombre del cliente y el número del ticket.',
                    'Deja marcado **Agregar mi firma** si quieres que vaya tu firma.',
                    'En **Después, poner el estado en** elige cómo queda el ticket: por ejemplo **Esperando al cliente** si le hiciste una pregunta, o **Cerrado** si ya está resuelto.',
                    'Toca **Enviar**.',
                ],
            },
            { t: 'anim', key: 'mesa-reply', caption: 'Respuesta guardada, firma, estado y enviar. La nota interna nunca sale por correo.' },
            { t: 'h', text: 'Respuestas guardadas' },
            {
                t: 'p',
                md: 'Son los textos que el equipo repite todos los días: acuse de recibo, «necesitamos una captura», «ya está resuelto». Se crean en los ajustes de la lista → **Correo entrante**, sección **Respuestas guardadas**, con un nombre y el texto. Al guardarlas puedes marcar **Agregar la firma de quien responde**.',
            },
            {
                t: 'settings',
                title: 'Variables de las respuestas guardadas',
                rows: [
                    { name: '{{cliente.nombre}}', what: 'El nombre de quien escribió.' },
                    { name: '{{cliente.correo}}', what: 'Su dirección de correo.' },
                    { name: '{{ticket.numero}}', what: 'El número del ticket, por ejemplo TCK-0042.' },
                    { name: '{{ticket.asunto}}', what: 'El asunto del ticket.' },
                    { name: '{{agente.nombre}}', what: 'El nombre de quien responde.' },
                    { name: 'Cualquier campo', what: 'También puedes usar los campos de la lista, como la prioridad o la fecha de compra.' },
                ],
            },
            {
                t: 'example',
                title: 'Una respuesta guardada que ahorra minutos',
                md: '«Hola {{cliente.nombre}}, gracias por escribirnos. Para revisar tu caso {{ticket.numero}} necesitamos una captura de la pantalla donde aparece el error. Con eso lo resolvemos hoy mismo.» Se elige en dos clics, y el ticket pasa a **Esperando al cliente**: el reloj del SLA se detiene hasta que conteste.',
            },
            { t: 'h', text: 'Respuesta al cliente o nota interna' },
            {
                t: 'cards',
                items: [
                    { icon: 'Send', title: 'Responder por correo', md: 'Sale al cliente y queda en el ticket como comentario visible para él. Cuenta como **primera respuesta** del SLA (también un comentario visible para el cliente escrito desde la ficha).', tone: 'mint' },
                    { icon: 'Lock', title: 'Comentario interno', md: 'Lo escribe el equipo para el equipo, con menciones. **Nunca** sale por correo.', tone: 'slate' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Sin buzón no hay respuesta por correo',
                md: 'El botón aparece cuando la lista tiene un buzón conectado y el ticket tiene el correo del cliente. Si el ticket se creó a mano, completa primero su campo de correo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿El cliente ve quién le respondió?', a: 'Ve la dirección de soporte como remitente y, si agregaste tu firma, tu nombre al final.' },
                    { q: '¿Puedo adjuntar archivos?', a: 'Las respuestas desde la ficha van como texto. Si necesitas mandar un documento, súbelo a la ficha y comparte el enlace, o genera un PDF con una automatización.' },
                    { q: '¿Una respuesta automática cuenta como primera respuesta?', a: 'No. Las respuestas de una automatización se marcan como automáticas y el SLA sigue esperando a que conteste una persona.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Configurar el SLA', article: 'mesa-sla' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mesa-sla',
        route: '/lists',
        related: ['mesa-automatizaciones', 'mesa-responder', 'vistas-kanban'],
        blocks: [
            {
                t: 'p',
                md: 'El **SLA** es el tiempo que te comprometes a cumplir: responder en cierta cantidad de horas y resolver en otra. La app lo mide en **horas hábiles** —de noche, los fines de semana y los festivos el reloj no corre—, lo detiene mientras esperas al cliente y te avisa **antes** de que se venza.',
            },
            { t: 'anim', key: 'mesa-sla', caption: 'El reloj corre en horario hábil, se detiene esperando al cliente, avisa en riesgo y escala al vencer.' },
            { t: 'h', text: 'Activarlo' },
            {
                t: 'steps',
                items: [
                    'En los ajustes de la lista, abre la pestaña **SLA**.',
                    'Enciende **Medir el SLA de los tickets de esta lista**.',
                    'Pon los **Objetivos**, el **Horario hábil** y los **Avisos y escalamiento**.',
                    'Toca **Crear las columnas del SLA** si la lista todavía no las tiene.',
                    'Toca **Guardar el SLA**.',
                ],
            },
            { t: 'demo', key: 'mesa-sla', caption: 'Los objetivos por prioridad y las columnas del SLA.', fallback: 'mesa-sla' },
            {
                t: 'settings',
                title: 'Objetivos',
                rows: [
                    { name: 'Según la prioridad', what: 'Un par de objetivos por cada opción del campo de prioridad (urgente, alta, normal, baja).' },
                    { name: 'Un solo objetivo para todos', what: 'Los mismos tiempos para todos los tickets.' },
                    { name: 'Primera respuesta (horas)', what: 'Cuánto puede pasar hasta que una persona del equipo conteste.', tip: 'Acepta decimales: «1,5» es hora y media.' },
                    { name: 'Resolución (horas)', what: 'Cuánto puede pasar hasta que el ticket quede cerrado.' },
                ],
            },
            {
                t: 'settings',
                title: 'Horario hábil',
                rows: [
                    { name: 'Días hábiles', what: 'Por ejemplo, de lunes a viernes.' },
                    { name: 'Desde / Hasta', what: 'La jornada, por ejemplo de 8:00 a 18:00, en la zona horaria de la empresa.' },
                    { name: 'Festivos', what: '**De Colombia** o **Ninguno**. Con los de Colombia, un lunes festivo no cuenta.' },
                ],
            },
            {
                t: 'example',
                title: 'Cómo se cuenta',
                md: 'Un ticket de prioridad **Alta** (resolución en 8 horas hábiles) llega el viernes a las 16:00, con horario de 8:00 a 18:00. El viernes cuentan 2 horas; el sábado y el domingo no cuentan; el lunes es festivo. Vence el **martes a las 14:00**. Si el martes a las 9:00 le preguntas algo al cliente y lo pones en **Esperando al cliente**, el reloj se detiene hasta que conteste.',
            },
            { t: 'h', text: 'Avisos y escalamiento' },
            {
                t: 'settings',
                rows: [
                    { name: 'Avisar «en riesgo» al', what: 'El porcentaje del tiempo consumido en que llega el aviso. La plantilla usa 75 %.' },
                    { name: 'A quién avisar', what: '**Personas**, **Roles** o **Equipos**, y además **Y al responsable del ticket**.' },
                    { name: 'Al vencer, escalar a', what: 'Quién recibe el aviso cuando se vence, por ejemplo la líder de soporte.' },
                    { name: 'Y además, cambiar el campo … a …', what: 'Por ejemplo, subir la prioridad a **Urgente** al vencer.' },
                ],
            },
            {
                t: 'p',
                md: 'Cada aviso llega **una sola vez por ticket** y por umbral, por la campana, el correo y las notificaciones del teléfono, según las preferencias de cada persona. Nunca les llega a los clientes ni a los invitados.',
            },
            { t: 'h', text: 'Las columnas del SLA' },
            {
                t: 'settings',
                rows: [
                    { name: 'Vence primera respuesta', what: 'La fecha y hora límite para contestar.' },
                    { name: 'Vence resolución', what: 'La fecha y hora límite para cerrar.' },
                    { name: 'Estado del SLA', what: '**A tiempo**, **En riesgo**, **Vencido**, **Cumplido** o **Pausado**.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'El kanban «Por SLA»',
                md: 'Agrupa los tickets por **Estado del SLA** y tienes la foto del día: lo vencido a la izquierda, lo que está en riesgo al lado. Las columnas del SLA se filtran, se ordenan y se agrupan, pero la app las mantiene: no se editan a mano ni se arrastran tarjetas entre ellas.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Cambié la prioridad de un ticket, ¿se recalcula?', a: 'Sí: los vencimientos se calculan otra vez con los objetivos de la nueva prioridad.' },
                    { q: '¿Qué pasa con los registros que ya existían al activar el SLA?', a: 'Se miden desde que se crearon. Los que ya pasaron su objetivo quedan como vencidos y avisan una vez. Si tienes muchos casos viejos abiertos, ciérralos antes de activar el SLA para no llenar de avisos al equipo.' },
                    { q: '¿Puedo tener otro horario los sábados?', a: 'El horario es uno para todos los días hábiles. Si atienden los sábados, inclúyelos en los días hábiles.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Automatizar con el SLA', article: 'mesa-automatizaciones' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mesa-automatizaciones',
        route: '/lists',
        related: ['mesa-sla', 'automatizaciones-disparadores', 'mesa-responder'],
        blocks: [
            {
                t: 'p',
                md: 'La mesa de ayuda trae dos disparadores y una acción propios. Con ellos el acuse de recibo, la asignación por tema y el aviso a la gerencia salen solos, sin que nadie tenga que acordarse.',
            },
            { t: 'anim', key: 'mesa-hero', caption: 'Cada correo que llega puede disparar una automatización.' },
            { t: 'h', text: 'Disparador «Cuando llega un correo»' },
            {
                t: 'settings',
                title: 'Qué correos',
                rows: [
                    { name: 'Cualquier correo (ticket nuevo o respuesta)', what: 'Se dispara con todo lo que llega.' },
                    { name: 'Sólo cuando se abre un ticket nuevo', what: 'Ideal para el acuse de recibo y la asignación.' },
                    { name: 'Sólo cuando el cliente responde un ticket', what: 'Para avisar al responsable de que el cliente contestó.' },
                ],
            },
            {
                t: 'p',
                md: 'Variables disponibles: **{{correo.de}}**, **{{correo.nombre}}**, **{{correo.asunto}}**, **{{correo.texto}}** y **{{correo.tipo}}**, además de todos los campos del ticket.',
            },
            { t: 'h', text: 'Disparador «Cuando un SLA está en riesgo o se vence»' },
            {
                t: 'settings',
                rows: [
                    { name: 'Qué alerta', what: '**Cuando queda en riesgo** o **Cuando se vence**.' },
                    { name: 'De qué objetivo', what: '**Primera respuesta** o **Resolución**.' },
                ],
            },
            {
                t: 'p',
                md: 'Cada alerta dispara una sola vez por ticket; si el ticket se reabre, el SLA vuelve a contar y puede avisar de nuevo. Variables: **{{sla.alerta}}**, **{{sla.objetivo}}**, **{{sla.vence}}**, **{{sla.prioridad}}** y **{{sla.estado}}**.',
            },
            { t: 'h', text: 'Acción «Responder por correo al hilo del registro»' },
            {
                t: 'p',
                md: 'Contesta en el hilo del ticket, desde el buzón de soporte, a quien escribió. Puedes **Partir de una plantilla de respuesta** (una de tus respuestas guardadas) o escribir la **Respuesta**, cambiar el **Asunto (opcional)** y agregar **Con copia**. El número del ticket se agrega solo al asunto. Sale marcada como respuesta automática: **no cuenta como primera respuesta** del SLA.',
            },
            { t: 'anim', key: 'mesa-reply', caption: 'La misma respuesta que escribe una persona, pero enviada por una automatización.' },
            { t: 'h', text: 'Recetas listas' },
            {
                t: 'example',
                title: 'Acuse de recibo',
                md: 'Cuando llega un correo → **Sólo cuando se abre un ticket nuevo** → **Responder por correo al hilo del registro** con «Hola {{cliente.nombre}}, recibimos tu solicitud. Tu número es {{ticket.numero}} y te respondemos en menos de 8 horas hábiles.»',
            },
            {
                t: 'example',
                title: 'Asignar por tema',
                md: 'Cuando llega un correo → ticket nuevo → **Si** el asunto contiene «factura» → **Actualizar un campo**: Asignado a = Laura; **si no**, si contiene «contraseña» → Asignado a = Jorge.',
            },
            {
                t: 'example',
                title: 'Escalar lo vencido',
                md: 'Cuando un SLA está en riesgo o se vence → **Cuando se vence** → **Resolución** → mandar un WhatsApp a la gerente con «El ticket {{ticket.numero}} de {{cliente.nombre}} venció su resolución ({{sla.vence}})» y comentar en el ticket mencionando al responsable.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Prueba antes de activar',
                md: 'Con **Probar** del editor ves qué haría la automatización con un ticket real, sin enviar ningún correo.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'El acuse de recibo, ¿no hace que el cliente vuelva a escribir?', a: 'No crea bucles: las respuestas automáticas de los clientes («estoy fuera de la oficina») se ignoran, y tu acuse va en el mismo hilo.' },
                    { q: '¿Puedo usar un campo con IA para clasificar los tickets?', a: 'Sí. Un campo con IA que lea el texto del correo puede elegir la categoría o la prioridad, y una automatización puede asignar según esa categoría.' },
                    { q: 'Al elegir el disparador aparece un aviso', a: 'Te avisa que a la lista le falta algo: un buzón conectado (para los de correo y la acción de responder) o el SLA activado (para el de SLA). La automatización se puede guardar igual, pero no hará nada hasta que lo configures.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                ],
            },
        ],
    },
];
