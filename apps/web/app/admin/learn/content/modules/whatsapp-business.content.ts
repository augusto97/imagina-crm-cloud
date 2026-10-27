import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'wab-cual-elegir',
        route: '/settings?s=conectores',
        related: ['wab-conectar', 'integraciones-mensajeria', 'wab-plantillas'],
        blocks: [
            {
                t: 'p',
                md: 'La app puede mandar WhatsApp de dos maneras. **WhatsApp (WAS)** usa un número normal a través del servicio WAS: se conecta en dos minutos, pero no es la API oficial. **WhatsApp Business (oficial)** usa la API oficial de Meta (la «Cloud API»): pide un trámite inicial en Meta, y a cambio trae **plantillas aprobadas**, te entera de **lo que te escriben tus clientes** y te dice si cada mensaje se **entregó o se leyó**.',
            },
            { t: 'anim', key: 'wab-hero', caption: 'Con la API oficial, el registro muestra el último mensaje (tuyo o del cliente) y si se entregó y se leyó.' },
            { t: 'h', text: 'Las diferencias, una por una' },
            {
                t: 'settings',
                title: 'WhatsApp (WAS) frente a WhatsApp Business (oficial)',
                rows: [
                    { name: 'Cómo se conecta', what: 'WAS: pegas una clave y eliges el número. Oficial: creas una app en Meta, un usuario del sistema con un token permanente y copias tres datos más.', tip: 'Si nunca entraste a developers.facebook.com, pide ayuda para el oficial la primera vez: después no hay que tocarlo.' },
                    { name: 'Avisos que inicias tú', what: 'WAS: cualquier texto. Oficial: sólo **plantillas aprobadas por Meta** cuando el cliente no te escribió en las últimas 24 horas.' },
                    { name: 'Respuestas de tus clientes', what: 'WAS: no llegan a la app. Oficial: cada mensaje que te escriben encuentra (o crea) el registro del contacto y puede disparar una automatización.' },
                    { name: 'Estado de cada envío', what: 'WAS: sólo te enteras de si el servicio lo aceptó. Oficial: **Enviado, Entregado, Leído o Fallido**, en una columna del registro.' },
                    { name: 'Costo', what: 'WAS: tu plan del servicio WAS. Oficial: Meta cobra por conversación a **tu** cuenta de Meta, según el país y el tipo de plantilla.' },
                    { name: 'Riesgo de bloqueo', what: 'Con un número no oficial, los envíos masivos pueden hacer que WhatsApp bloquee el número. La API oficial es la vía que Meta permite para empresas.' },
                    { name: 'Cuenta verificada', what: 'Oficial: tu número muestra el nombre de la empresa y puede tener el distintivo verificado.' },
                ],
            },
            {
                t: 'cards',
                items: [
                    { icon: 'Zap', title: 'Elige WAS si…', md: 'Quieres empezar hoy, mandas pocos mensajes y no necesitas leer las respuestas en la app.', tone: 'amber' },
                    { icon: 'ShieldCheck', title: 'Elige el oficial si…', md: 'Mandas avisos a muchos clientes, quieres ver quién leyó y que lo que te escriben llegue a tus registros.', tone: 'mint' },
                ],
            },
            {
                t: 'p',
                md: 'Puedes tener **las dos** conectadas a la vez: por ejemplo, WAS para avisos internos al equipo y el oficial para los clientes. En cada automatización eliges cuál usar.',
            },
            {
                t: 'example',
                title: 'Un gimnasio con 1.200 socios',
                md: 'Empezaron con WAS para recordar la renovación de membresías. Cuando pasaron de 50 a 400 avisos por semana, migraron al oficial: la plantilla «renovacion_membresia» tiene un botón para pagar, la columna **Estado del último envío** les muestra quién la leyó y quién no, y cuando un socio contesta «¿puedo congelar mi plan?», su ficha se actualiza y la recepción lo ve en la vista «Escribieron hoy».',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo usar el mismo número en WhatsApp Business (la app del celular) y en la API oficial?', a: 'Hoy Meta permite usar algunos números en las dos, pero depende del país y de tu cuenta. Si no, el número queda sólo en la API: los mensajes se ven en la app y no en el celular. Consúltalo en tu cuenta de Meta antes de migrar un número que ya usas.' },
                    { q: '¿La app guarda toda la conversación?', a: 'No. En el registro queda sólo el último mensaje. La conversación completa sigue en WhatsApp.' },
                    { q: '¿Cuánto cobra Meta?', a: 'Depende del país del cliente y del tipo de plantilla (utilidad, marketing, autenticación). Los precios están en la documentación de Meta y se cobran a tu tarjeta en tu cuenta de Meta, no a través de la app.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Conectar WhatsApp oficial', article: 'wab-conectar' },
                    { label: 'Conectar WhatsApp (WAS)', article: 'integraciones-mensajeria' },
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'wab-conectar',
        route: '/settings?s=conectores',
        related: ['wab-recibir-mensajes', 'wab-cual-elegir', 'integraciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'Conectar la API oficial es un trámite de una sola vez: se hace en el administrador de Meta y después la app no vuelve a pedir nada. Necesitas **cuatro datos**: un token permanente, el identificador del número, el de la cuenta de WhatsApp Business y la clave secreta de la app de Meta. Este artículo te dice dónde está cada uno.',
            },
            { t: 'anim', key: 'wab-setup', caption: 'Cuatro datos de Meta y un paso de avisos: la conexión queda verificada.' },
            { t: 'h', text: 'Antes de empezar' },
            {
                t: 'p',
                md: '- Una cuenta en **business.facebook.com** (Meta Business) de la empresa.\n- Una **app de Meta** con el producto **WhatsApp** en developers.facebook.com, y tu número ya registrado en la Cloud API.\n- Permiso de administrador en las dos.',
            },
            { t: 'h', text: 'Sacar los datos en Meta' },
            {
                t: 'steps',
                items: [
                    'En **business.facebook.com → Configuración del negocio → Usuarios del sistema**, crea un usuario del sistema **administrador**.',
                    'Asígnale tu app y tu cuenta de WhatsApp con **control total**.',
                    'Genera un token para ese usuario con los permisos **whatsapp_business_messaging** y **whatsapp_business_management** y vencimiento **Nunca**. Cópialo: es el **Token de acceso permanente**.',
                    'En **developers.facebook.com → tu app → WhatsApp → Configuración de la API**, copia el **Phone number ID** (es el **Identificador del número de teléfono**: no es el número, es un número largo que lo identifica) y el **WhatsApp Business Account ID** (el **Identificador de la cuenta de WhatsApp Business**).',
                    'En **tu app → Configuración → Básica**, copia la **Clave secreta de la app**.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'El token del usuario del sistema, no el temporal',
                md: 'La pantalla de la API de WhatsApp muestra un «token de acceso temporal» que vence en 24 horas. **No uses ese**: la conexión dejaría de funcionar al día siguiente. Usa el del usuario del sistema con vencimiento «Nunca».',
            },
            { t: 'h', text: 'Pegarlos en la app' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Integraciones**, toca **Conectar** en **WhatsApp Business (oficial)**.',
                    'Pega el **Token de acceso permanente**, el **Identificador del número de teléfono**, el **Identificador de la cuenta de WhatsApp Business** y la **Clave secreta de la app**.',
                    'Toca **Conectar**. La app comprueba los datos con Meta: si el token venció, le falta un permiso, el identificador es de otra cuenta o la clave secreta no corresponde, te lo dice y no guarda nada.',
                    'Si todo está bien, la conexión queda con el número y el nombre verificado de tu empresa. En su fila aparece el botón **Configurar WhatsApp**: ahí sigue el paso de los avisos.',
                ],
            },
            { t: 'demo', key: 'wab-conectar', caption: 'El cuadro de conexión de WhatsApp Business oficial.', fallback: 'wab-setup' },
            {
                t: 'settings',
                title: 'Para qué sirve cada dato',
                rows: [
                    { name: 'Token de acceso permanente', what: 'Con él la app manda los mensajes y lee tus plantillas. Se guarda cifrado.' },
                    { name: 'Identificador del número de teléfono', what: 'Desde qué número salen los mensajes.' },
                    { name: 'Identificador de la cuenta de WhatsApp Business', what: 'Con él se leen tus plantillas aprobadas.' },
                    { name: 'Clave secreta de la app', what: 'Con ella la app comprueba que cada aviso que llega viene de verdad de Meta. Sin ella, los avisos se rechazan. Se guarda cifrada.' },
                ],
            },
            {
                t: 'example',
                title: 'Una óptica con dos sedes',
                md: 'Tienen dos números de WhatsApp Business, uno por sede. Los conectan los dos (la tarjeta dice **Conectar otra cuenta** después del primero). Cada automatización elige desde qué número sale: los avisos de «tus lentes están listos» salen por el número de la sede donde se hizo el pedido.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Meta dice que mi número no está registrado en la Cloud API.', a: 'El número tiene que estar dado de alta en tu app de Meta → WhatsApp → Configuración de la API. Ese registro se hace en Meta, antes de conectar.' },
                    { q: '¿Qué pasa si el token deja de servir?', a: 'Si alguien borra el usuario del sistema o le quita permisos, los envíos fallan con el motivo de Meta y se abre un problema en **Ajustes → Problemas**. Genera un token nuevo y cárgalo con **Actualizar clave**: el problema se cierra solo cuando vuelve a funcionar.' },
                    { q: '¿Quién puede ver el token?', a: 'Nadie, ni siquiera quien lo pegó: se guarda cifrado y no vuelve a mostrarse.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Siguiente: recibir mensajes', article: 'wab-recibir-mensajes' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'wab-recibir-mensajes',
        route: '/settings?s=conectores',
        related: ['wab-conectar', 'wab-automatizaciones', 'wab-estados-privacidad'],
        blocks: [
            {
                t: 'p',
                md: 'Para enterarte de lo que te escriben tus clientes y de si tus mensajes se entregaron, Meta tiene que **avisarle** a la app. Eso se configura una sola vez, en la pantalla **Configurar WhatsApp** de tu conexión (en **Ajustes → Integraciones**, en la fila de WhatsApp Business oficial).',
            },
            { t: 'anim', key: 'wab-inbound', caption: 'Un cliente nuevo escribe: se crea su registro, queda su último mensaje y se dispara la automatización.' },
            { t: 'h', text: 'La pantalla de la conexión' },
            {
                t: 'settings',
                rows: [
                    { name: 'Contactos que escribieron', what: 'Cuántos contactos te escribieron por este número.' },
                    { name: 'Con la ventana de 24 h abierta', what: 'A cuántos puedes mandarles texto libre ahora mismo.' },
                    { name: 'Plantillas aprobadas', what: 'Cuántas plantillas tienes listas para usar.' },
                    { name: 'Calidad alta / media / baja', what: 'La calidad que Meta le da a tu número según cómo reaccionan los clientes (bloqueos, reportes).', tip: 'Si baja, Meta puede limitar tus envíos: revisa que tus plantillas sean útiles y no se manden a quien no las pidió.' },
                    { name: 'Ideas para usarlo', what: 'Un recordatorio de las cuatro formas de usar el canal: avisos automáticos, responder, reaccionar a lo que escriben y resumir con IA.' },
                ],
            },
            { t: 'h', text: 'Paso 1: la dirección de avisos en Meta' },
            {
                t: 'steps',
                items: [
                    'En la sección **Recibir mensajes y estados**, copia la **URL de devolución de llamada** y el **token de verificación** (cada uno con su botón **Copiar**).',
                    'En developers.facebook.com abre tu app → **WhatsApp → Configuración → Webhook → Editar**.',
                    'Pega la URL de devolución de llamada, pega el token de verificación y toca **Verificar y guardar**.',
                    'En **Campos del webhook**, suscríbete a **messages** (por ahí llegan los mensajes y los estados).',
                    'De vuelta en la app, toca **Suscribir la cuenta**. Aparece la etiqueta **Cuenta suscrita**.',
                    'Cuando llegue el primer aviso, la sección muestra **Último aviso** con la fecha y hora.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: '¿Tu app de Meta ya avisa a otro sistema?',
                md: 'Si tu app de Meta ya manda sus avisos a otro lado (otro CRM, un chatbot), usa **Usar esta URL sólo para esta cuenta**: Meta usará la dirección de la app sólo para este número, sin cambiar la de tu app. Igual hace falta suscribirse a **messages**.',
            },
            { t: 'h', text: 'Paso 2: dónde caen los mensajes' },
            {
                t: 'p',
                md: 'En **Dónde caen los mensajes** eliges la **Lista de contactos**: cuando alguien te escribe, la app lo busca **por su teléfono** en esa lista y deja en su registro el último mensaje. La búsqueda entiende el número con o sin indicativo y las variaciones que usan México y Argentina en sus celulares.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Lista de contactos', what: 'La lista donde se buscan los contactos (Clientes, Pacientes, Prospectos…). Con **Ninguna (sólo se abre la ventana de 24 h)**, los mensajes no se escriben en ningún registro, pero igual puedes contestar.', tip: 'La plantilla de lista **Contactos por WhatsApp** ya trae todas las columnas listas.' },
                    { name: 'Si el número no está en la lista, crear el registro', what: 'Un número nuevo crea un registro con el nombre que el contacto tiene en WhatsApp.', tip: 'Apágalo si sólo quieres registrar a quienes ya son clientes.' },
                ],
            },
            {
                t: 'settings',
                title: 'Columnas que se escriben',
                rows: [
                    { name: 'Teléfono', what: 'Con él se encuentra al contacto y se le manda. Es la única obligatoria: sin ella la app no sabe quién es quién.' },
                    { name: 'Último mensaje', what: 'El texto del último mensaje, entrante o saliente. Sólo el último.' },
                    { name: 'Fecha del último mensaje', what: 'Cuándo llegó o salió.' },
                    { name: 'Dirección', what: '**Entrante** (lo escribió el contacto) o **Saliente** (lo mandaste tú).' },
                    { name: 'Nombre en WhatsApp', what: 'El nombre que el contacto tiene en su perfil.' },
                    { name: 'Estado del último envío', what: '**Enviado, Entregado, Leído** o **Fallido**.' },
                    { name: 'Detalle del envío', what: 'Si falló, el motivo que dio Meta.' },
                ],
            },
            {
                t: 'p',
                md: 'Cada columna se puede apuntar a un campo que ya tengas o dejar en **— No escribir —**. El botón **Preparar columnas** crea en la lista los campos que falten, con el tipo correcto. Revisa y toca **Guardar**.',
            },
            {
                t: 'example',
                title: 'Una pastelería que vende por WhatsApp',
                md: 'Eligen la lista **Clientes** y encienden «crear el registro». Cada persona nueva que pregunta por una torta queda como cliente con su nombre de WhatsApp. Una vista **Escribieron hoy** (filtro: Fecha del último mensaje = hoy y Dirección = Entrante) es la bandeja de la mañana: nadie queda sin respuesta.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Un contacto escribió desde otro número, ¿se mezcla?', a: 'No: se busca por teléfono. Un número distinto es otro contacto (o crea uno nuevo si está encendida la opción).' },
                    { q: 'Me llegan avisos pero el registro no cambia.', a: 'Revisa que la lista elegida tenga la columna **Teléfono** apuntada al campo del número, y que el número de ese registro esté bien escrito (con indicativo).' },
                    { q: 'Dice «Falta la clave secreta de la app».', a: 'Sin ella no se puede comprobar que los avisos vienen de Meta y se rechazan. Cárgala con **Actualizar clave** en la fila de la conexión.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Automatizar las respuestas', article: 'wab-automatizaciones' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'wab-plantillas',
        route: '/settings?s=conectores',
        related: ['wab-automatizaciones', 'wab-cual-elegir', 'wab-estados-privacidad'],
        blocks: [
            {
                t: 'p',
                md: 'WhatsApp protege a las personas del spam con una regla: **la empresa sólo puede escribir libremente durante las 24 horas siguientes al último mensaje del cliente**. Fuera de esa ventana, sólo puedes mandar **plantillas**: mensajes que redactas una vez, Meta revisa y aprueba, y después puedes enviar cuando quieras con los datos de cada cliente.',
            },
            { t: 'anim', key: 'wab-window', caption: 'Dentro de la ventana sale texto libre; fuera, sólo plantillas aprobadas.' },
            { t: 'h', text: 'Qué es una plantilla' },
            {
                t: 'p',
                md: 'Una plantilla es un mensaje con huecos: «Hola {{1}}, tu pedido {{2}} salió hoy». Cada hueco es una **variable** que la app llena con un campo del registro. Puede tener un encabezado (texto, imagen, video o documento), el cuerpo, un pie y botones (un enlace, una llamada, respuestas rápidas). Meta las clasifica en **Utilidad** (avisos de pedidos, pagos, citas), **Marketing** (promociones) y **Autenticación** (códigos), y cada categoría tiene su precio.',
            },
            { t: 'h', text: 'Crear y traer plantillas' },
            {
                t: 'steps',
                items: [
                    'Abre **Configurar WhatsApp** en tu conexión y, en **Plantillas**, toca **Crear o editar en Meta**: se abre el administrador de WhatsApp de Meta.',
                    'Crea la plantilla, elige su categoría e idioma, y mándala a revisión. Meta suele aprobarla en minutos u horas.',
                    'Cuando esté aprobada, vuelve y toca **Actualizar plantillas** (igual se actualizan solas cada 6 horas).',
                    'La lista muestra cada plantilla con su estado: **Aprobada**, **En revisión**, **Rechazada** (con el motivo en lenguaje claro, por ejemplo «tiene contenido promocional en una categoría que no lo permite»), **Pausada** o **Desactivada**.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Plantillas que Meta aprueba rápido',
                md: '- Claras y útiles: «Tu cita es mañana a las {{1}}».\n- Las variables no van pegadas una a otra ni al principio o al final del mensaje.\n- Nada de promociones en una plantilla de **Utilidad**.',
            },
            { t: 'h', text: 'Mandar un WhatsApp a mano desde un registro' },
            { t: 'anim', key: 'wab-template-send', caption: 'Eliges la plantilla, sus variables se llenan con el registro y ves cómo le llega al cliente.' },
            {
                t: 'steps',
                items: [
                    'Abre el registro (en el modal, la página o la ficha diseñada) y toca **Enviar WhatsApp**.',
                    'Arriba ves si la ventana está **abierta hasta** una hora o **cerrada: sólo plantillas**, y el estado del último envío.',
                    'Elige **Enviar desde** (si tienes varios números) y revisa **Para**: se completa con el teléfono del registro.',
                    'Elige **Plantilla** o, si la ventana está abierta, **Mensaje** (texto libre, con variables como `{{nombre}}`).',
                    'En una plantilla, completa cada variable con texto o un campo. Si el encabezado es un documento o una imagen, pega su **enlace público (https)**.',
                    'Revisa la vista previa —así le llega al contacto— y toca **Enviar**.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Si la lista todavía no tiene las columnas de WhatsApp, el cuadro avisa «el mensaje sale, pero el estado no queda a la vista en la tabla» y ofrece **Preparar columnas**.',
            },
            {
                t: 'example',
                title: 'Un taller de motos',
                md: 'Plantilla de **Utilidad** «moto_lista»: «Hola {{1}}, tu {{2}} ya está lista. El total es {{3}}. Te esperamos hasta las 6 p. m.». El mecánico cambia el estado a **Lista** y la automatización la manda con el nombre del cliente, el modelo de la moto y el total. Si el cliente contesta «¿puedo pasar mañana?», la ventana se abre y el asesor le responde con texto libre desde la ficha.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué no aparece mi plantilla en la lista?', a: 'Sólo se pueden usar las **Aprobadas**. Si ya la aprobaron, toca **Actualizar plantillas**.' },
                    { q: '¿Puedo editar una plantilla aprobada?', a: 'En Meta sí, y vuelve a revisión. Mientras tanto, las automatizaciones que la usan fallan con el aviso «ya no está aprobada».' },
                    { q: '¿La ventana de 24 horas se cuenta desde mi mensaje o desde el del cliente?', a: 'Desde el **último mensaje del cliente**. Tus mensajes no la abren ni la alargan.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Automatizar los envíos', article: 'wab-automatizaciones' },
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'wab-automatizaciones',
        route: '/settings?s=conectores',
        related: ['wab-plantillas', 'wab-recibir-mensajes', 'integraciones-en-automatizaciones'],
        blocks: [
            {
                t: 'p',
                md: 'WhatsApp oficial trae **dos acciones** y **un disparador** para las automatizaciones. Con ellos armas los avisos que salen solos (pagos, citas, pedidos) y las respuestas automáticas a lo que te escriben.',
            },
            { t: 'anim', key: 'automation-whatsapp', caption: 'Un aviso automático: vence una factura, sigue pendiente y sale el WhatsApp.' },
            { t: 'h', text: 'Acción «Enviar plantilla de WhatsApp»' },
            {
                t: 'settings',
                rows: [
                    { name: 'Número de WhatsApp', what: 'Desde qué número sale (si conectaste más de uno).' },
                    { name: 'Para (teléfono del contacto)', what: 'Con indicativo. Lo normal es el campo teléfono del registro: el botón **Usar:** lo pone por ti.' },
                    { name: 'Plantilla', what: 'Sólo las aprobadas. **Ver plantillas** abre la lista de la conexión.', tip: 'Si una plantilla deja de estar aprobada, la tarjeta lo dice: la acción falla hasta que elijas otra.' },
                    { name: 'Variables de la plantilla', what: 'Una fila por variable, con el ejemplo que diste en Meta. Llénalas con campos: `{{nombre}}`, `{{total}}`, `{{fecha|larga}}`.' },
                    { name: 'Enlace del documento (https)', what: 'Para plantillas con un documento en el encabezado. Puedes usar el PDF que generó un paso anterior: `{{pdf.link}}`. Y un **nombre del archivo** opcional, como «Factura {{numero}}.pdf».' },
                    { name: 'Vista previa', what: '«Así lo verá el contacto»: el mensaje con las variables completadas. Si falta una, dice cuál.' },
                    { name: 'Probar ahora (se envía de verdad)', what: 'Manda la plantilla a tu número con los datos del último registro de la lista que puedes ver. **Ver lo que se envió a Meta y su respuesta** muestra el detalle.' },
                ],
            },
            { t: 'h', text: 'Acción «Enviar mensaje de texto de WhatsApp»' },
            {
                t: 'p',
                md: 'Texto libre, con variables y la opción **Mostrar la vista previa de los enlaces**. **Sólo sale si el contacto escribió en las últimas 24 horas**: si no, la acción falla con «La ventana de 24 h está cerrada: usa una plantilla» y no se envía nada. Úsala para respuestas a algo que el cliente acaba de escribir, nunca para avisos que inicias tú.',
            },
            { t: 'h', text: 'Disparador «Cuando llega un mensaje de WhatsApp»' },
            {
                t: 'p',
                md: 'Corre cada vez que un contacto le escribe a tu número. Para que se dispare en una lista, **esa lista tiene que ser la elegida en «Dónde caen los mensajes»**. Cuando corre, el registro del contacto ya se encontró (o se creó) y tiene el último mensaje. Puedes elegir **Número de WhatsApp: Cualquiera de la empresa** o uno en particular.',
            },
            { t: 'demo', key: 'wab-disparador', caption: 'Elegir el disparador «Cuando llega un mensaje de WhatsApp».', fallback: 'wab-inbound' },
            {
                t: 'settings',
                title: 'Variables del disparador',
                rows: [
                    { name: '{{whatsapp.texto}}', what: 'El texto del mensaje.' },
                    { name: '{{whatsapp.de}}', what: 'El número del contacto.' },
                    { name: '{{whatsapp.nombre}}', what: 'El nombre del contacto en WhatsApp.' },
                    { name: '{{whatsapp.tipo}}', what: 'El tipo de mensaje (texto, imagen, audio…).' },
                    { name: '{{whatsapp.fecha}}', what: 'Fecha y hora del mensaje.' },
                    { name: '{{whatsapp.conexion}}', what: 'El número de la empresa que lo recibió.' },
                ],
            },
            { t: 'h', text: 'Recetas listas para copiar' },
            {
                t: 'cards',
                items: [
                    { icon: 'Receipt', title: 'Recordatorio de pago', md: 'Cuando se alcanza la fecha de vencimiento y el estado es «Pendiente» → **Enviar plantilla** «recordatorio_pago» con `{{cliente}}`, `{{saldo}}` y el link de pago.', tone: 'amber' },
                    { icon: 'CalendarCheck', title: 'Cita confirmada', md: 'Cuando se agenda una cita → plantilla «cita_confirmada» con la fecha en palabras `{{fecha|larga}}` y la hora.', tone: 'violet' },
                    { icon: 'Package', title: 'Pedido en camino', md: 'Cuando el estado cambia a «Enviado» → plantilla con el número de guía y un botón para rastrearlo.', tone: 'blue' },
                    { icon: 'MessageCircle', title: 'Respuesta fuera de horario', md: 'Cuando llega un mensaje y son más de las 6 p. m. → **Enviar mensaje de texto**: «Gracias por escribirnos, mañana a las 8 te respondemos».', tone: 'mint' },
                    { icon: 'Bot', title: 'Clasificar y asignar', md: 'Cuando llega un mensaje → **Pedirle a un agente** que lea `{{whatsapp.texto}}`, ponga la intención y asigne al vendedor.', tone: 'rose' },
                ],
            },
            {
                t: 'example',
                title: 'Una clínica veterinaria',
                md: 'Recordatorio de vacunas: un disparador **Cuando se alcanza una fecha** sobre «Próxima vacuna», 3 días antes, manda la plantilla «vacuna_pendiente» con el nombre de la mascota. Cuando el dueño contesta «quiero agendar», el disparador de mensajes entrantes lo pasa a **Por agendar** y le avisa a la recepción en Slack.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'La automatización falló con «La ventana de 24 h está cerrada».', a: 'Usaste **Enviar mensaje de texto** con un contacto que no te escribió en el último día. Cámbiala por **Enviar plantilla de WhatsApp**.' },
                    { q: '¿Qué disparador uso para reaccionar a lo que escribe el cliente?', a: '**Cuando llega un mensaje de WhatsApp**: es el que corre con cada mensaje y trae las variables `{{whatsapp.*}}`. Los disparadores de cambios de registro no son la forma de reaccionar a los mensajes.' },
                    { q: '¿Puedo mandar a muchos clientes a la vez?', a: 'Sí, con una automatización programada que recorra los registros que cumplan una condición, siempre con plantillas aprobadas y respetando los límites de envío de tu número en Meta.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                    { label: 'Plantillas y la ventana de 24 h', article: 'wab-plantillas' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'wab-estados-privacidad',
        route: '/settings?s=conectores',
        related: ['wab-recibir-mensajes', 'wab-automatizaciones', 'wab-cual-elegir'],
        blocks: [
            {
                t: 'p',
                md: 'Cada mensaje que mandas pasa por estados: **Enviado** (Meta lo aceptó), **Entregado** (llegó al teléfono), **Leído** (el cliente lo abrió) o **Fallido** (no llegó, con el motivo). Meta le avisa a la app de cada cambio y la columna **Estado del último envío** del registro se actualiza sola, sin volver atrás (un aviso viejo de «entregado» no pisa un «leído»).',
            },
            { t: 'anim', key: 'wab-hero', caption: 'El estado del envío pasa de Enviado a Entregado y a Leído en el registro.' },
            { t: 'h', text: 'Usar los estados' },
            {
                t: 'cards',
                items: [
                    { icon: 'Filter', title: 'Una vista de fallidos', md: 'Filtra **Estado del último envío = Fallido**: ahí están los números mal escritos o que no tienen WhatsApp. **Detalle del envío** dice el motivo de Meta.', tone: 'rose' },
                    { icon: 'Eye', title: 'Quién no leyó', md: 'Filtra **Entregado** (y no Leído) con más de 2 días: llama a esos clientes en vez de mandar otro mensaje.', tone: 'amber' },
                    { icon: 'KanbanSquare', title: 'Tablero por estado', md: 'Un kanban agrupado por **Estado del último envío** muestra de un vistazo cómo va una campaña de avisos.', tone: 'blue' },
                ],
            },
            { t: 'h', text: 'Resumir o clasificar con IA' },
            {
                t: 'p',
                md: 'Agrega a la lista un **Campo con IA** que lea la columna **Último mensaje de WhatsApp**: puede **resumirlo** o **clasificarlo** en tus opciones (consulta, reclamo, pedido, cotización…). Se recalcula solo cada vez que llega un mensaje. Con la clasificación puedes filtrar, agrupar y disparar automatizaciones: «si la intención es Reclamo, avisar al supervisor».',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Lo que no se guarda',
                md: '- **La conversación no se guarda**: en el registro queda sólo el último mensaje. El historial completo sigue en WhatsApp.\n- **Los archivos que te mandan no se descargan**: una foto o un audio quedan en WhatsApp; el registro dice el tipo de mensaje.\n- **La actividad del registro anota el hecho** («llegó un mensaje de WhatsApp», «se envió la plantilla…») **sin el texto**: quienes siguen el registro no reciben el contenido del mensaje.',
            },
            { t: 'h', text: 'Cuando la conexión falla' },
            {
                t: 'p',
                md: 'Si Meta rechaza el token (alguien lo revocó o borró el usuario del sistema), los envíos fallan con el motivo de Meta, la página de la conexión dice **La conexión está fallando** y se abre un problema en **Ajustes → Problemas** que les avisa al administrador y a quien creó la automatización. Genera un token nuevo y cárgalo con **Actualizar clave**: el problema se cierra solo cuando vuelve a funcionar.',
            },
            {
                t: 'example',
                title: 'Una aseguradora de motos',
                md: 'Cada mes mandan la plantilla de renovación del SOAT a 800 clientes. Al día siguiente revisan la vista **Fallidos** (30 números mal escritos, que corrigen) y la de **Entregados sin leer** (que llaman por teléfono). Un campo con IA clasifica las respuestas en «Quiere renovar», «Pregunta precio» y «Ya renovó», y cada grupo tiene su automatización.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué un mensaje quedó en Enviado y nunca pasó a Entregado?', a: 'El teléfono del cliente puede estar apagado o sin internet. Meta reintenta por un tiempo; si no lo logra, pasa a **Fallido** con el motivo.' },
                    { q: '¿El cliente puede saber que uso un sistema?', a: 'No: ve el mensaje desde el número y el nombre de tu empresa, como cualquier mensaje de WhatsApp Business.' },
                    { q: '¿La IA lee mis conversaciones?', a: 'Sólo el último mensaje, y sólo si agregaste un campo con IA que lo use. Funciona con la configuración de IA de tu empresa.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver los problemas', to: '/settings?s=problemas' },
                    { label: 'Recibir mensajes', article: 'wab-recibir-mensajes' },
                ],
            },
        ],
    },
];
