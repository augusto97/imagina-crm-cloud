import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'integraciones-que-son',
        route: '/settings?s=conectores',
        related: ['integraciones-en-automatizaciones', 'integraciones-mensajeria', 'integraciones-api-personalizada'],
        blocks: [
            {
                t: 'p',
                md: 'Una **integración** es una app que tu empresa ya usa —WhatsApp, Gmail, Slack, tu calendario, tu tienda en línea— y que la app puede usar por ti. La conectas **una sola vez** en **Ajustes → Integraciones**: pegas su clave o autorizas con tu cuenta, y desde ese momento cualquier automatización puede mandar un WhatsApp, avisar en un canal de Slack o crear un evento en tu calendario sin que nadie vuelva a escribir contraseñas.',
            },
            { t: 'anim', key: 'integ-hero', caption: 'Cada app se conecta una vez a tu espacio y queda lista para todas las automatizaciones.' },
            { t: 'h', text: 'Conectar una vez, usar en todos lados' },
            {
                t: 'p',
                md: 'La conexión es un objeto aparte de las automatizaciones: guarda la clave **cifrada** y le pone nombre («WhatsApp (WAS) · +57 300…»). Las automatizaciones sólo dicen «usa esta conexión». Eso tiene tres ventajas:\n- **Nadie copia claves** dentro de cada automatización (y nadie las ve: después de guardarla, la clave nunca vuelve a mostrarse).\n- **Si cambias la clave**, la cambias en un solo lugar con **Actualizar clave** y todas las automatizaciones siguen funcionando.\n- **Ves quién la usa**: cada conexión dice cuántas acciones de automatización dependen de ella.',
            },
            { t: 'anim', key: 'integ-connect-once', caption: 'Una conexión de WhatsApp, tres automatizaciones que la usan.' },
            { t: 'h', text: 'Cómo se conecta una app' },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Integraciones**. Arriba ves las apps que ya conectaste (**Conectadas**) y abajo la galería (**Apps**), ordenada por tipo: Mensajería, Correo, Calendario, Hojas de cálculo, Tiendas online, Cobros y pagos, Bases de datos y Almacenamiento.',
                    'En la tarjeta de la app que quieres, toca **Conectar**.',
                    'Si es una app de **Google, Microsoft o Slack**, se abre su pantalla de permisos: eliges tu cuenta, tocas **Permitir** y vuelves sola a la app con el aviso «¡Listo! La app quedó conectada…».',
                    'Si es una app **con clave** (WhatsApp, Telegram, WooCommerce, Mercado Pago, Wompi, SQL Server, S3), se abre un cuadro con los pasos para sacar la clave en ese servicio. La pegas, y cuando la app lo permite te mandas un **mensaje de prueba** antes de tocar **Conectar**.',
                    'La app aparece en **Conectadas** con la cuenta con la que quedó (por ejemplo, el correo de Gmail o el número de WhatsApp) y la etiqueta **Conectada**.',
                ],
            },
            { t: 'demo', key: 'integ-galeria', caption: 'Conectar WhatsApp (WAS) desde la galería: la clave y el mensaje de prueba.', fallback: 'integ-key-test' },
            { t: 'h', text: 'Lo que ves en cada app conectada' },
            {
                t: 'settings',
                title: 'La fila de una app en «Conectadas»',
                rows: [
                    { name: 'Nombre y cuenta', what: 'El nombre de la app y con qué cuenta quedó: el correo de Google, el número de WhatsApp, el nombre de la tienda o del bot.', tip: 'Si conectas dos cuentas de la misma app (dos números de WhatsApp), así las distingues.' },
                    { name: 'Conectada / Hay que volver a conectarla', what: 'El estado de la conexión. En rojo cuando la autorización venció, alguien la revocó en el otro servicio o la clave guardada ya no se puede leer.', tip: 'Mientras esté en rojo, las acciones que la usan fallan. Arréglala con «Reconectar» o «Actualizar clave».' },
                    { name: 'Solo tú', what: 'Aparece cuando es una conexión privada: la conectó una persona para ella sola, no para todo el equipo.' },
                    { name: 'La usan N acciones de automatización', what: 'Cuántas acciones de automatización dependen de esta conexión.', tip: 'Antes de desconectar, mira este número: esas acciones van a fallar.' },
                    { name: 'Reconectar / Actualizar clave', what: 'Vuelve a autorizar la cuenta (apps de Google, Microsoft y Slack) o carga una clave nueva (apps con clave). La conexión es la misma: las automatizaciones no se tocan.' },
                    { name: 'Desconectar', what: 'Borra la conexión. Si alguna automatización la usa, te avisa cuántas acciones van a fallar y te pide confirmar.' },
                    { name: 'Botones propios', what: 'Algunas apps traen su propia pantalla: **Sincronizar tienda** (WooCommerce), **Cobros** (Mercado Pago y Wompi), **Configurar WhatsApp** (WhatsApp oficial), **Sincronizaciones** (SQL Server) y **Almacenamiento** (Google Drive y S3).' },
                ],
            },
            { t: 'h', text: 'Quién puede conectar apps' },
            {
                t: 'p',
                md: 'Las apps del **equipo** las conecta el **administrador** del espacio de trabajo: la conexión puede gastar dinero o hablar en nombre de la empresa (un WhatsApp, un correo), así que la decisión es suya. Quien arma automatizaciones ve la galería y **usa** las apps conectadas, pero no las conecta.\n\nSi el administrador enciende **Permitir conexiones privadas** (al final de **Avanzado: API personalizada**), cada persona que arma automatizaciones puede conectar su propia cuenta, marcada **Solo tú**. Una automatización compartida que use una conexión privada sigue funcionando para todo el equipo; lo que no puede hacer nadie más es editar esa conexión.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: '¿No ves Gmail, Outlook, Google Calendar o Slack?',
                md: 'Las apps que se autorizan con una cuenta de Google, Microsoft o Slack necesitan que el operador de la plataforma las haya habilitado una vez. Si no aparecen en tu galería, todavía no lo hizo: pídeselo a quien te dio acceso a la app.',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'MessageCircle', title: 'Mensajería', md: 'WhatsApp (WAS), WhatsApp Business oficial, Telegram y Slack.', tone: 'mint' },
                    { icon: 'Mail', title: 'Correo y calendario', md: 'Gmail, Outlook (correo y calendario) y Google Calendar.', tone: 'blue' },
                    { icon: 'FileSpreadsheet', title: 'Hojas de cálculo', md: 'Google Sheets: una fila nueva por cada cosa que pase.', tone: 'mint' },
                    { icon: 'Store', title: 'Tienda y cobros', md: 'WooCommerce, Mercado Pago y Wompi, con pantallas propias.', tone: 'violet' },
                    { icon: 'Database', title: 'Bases de datos', md: 'SQL Server y Azure SQL: trae datos a una lista sin duplicar.', tone: 'rose' },
                    { icon: 'Cloud', title: 'Almacenamiento', md: 'Google Drive o un bucket S3 para tus archivos.', tone: 'amber' },
                ],
            },
            {
                t: 'example',
                title: 'Una clínica odontológica',
                md: 'La administradora conecta una vez el WhatsApp de la recepción y el Google Calendar de la clínica. Después arma tres automatizaciones: confirmación de cita al agendar, recordatorio la víspera y encuesta de satisfacción al día siguiente. Cuando cambian el número de WhatsApp, toca **Actualizar clave** en un solo lugar y las tres siguen funcionando.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Es seguro guardar la clave aquí?', a: 'Sí. Se guarda cifrada y nunca vuelve a mostrarse, ni siquiera a quien la pegó: a lo sumo verás sus últimos cuatro caracteres. Para cambiarla, pegas una nueva.' },
                    { q: '¿Puedo conectar dos cuentas de la misma app?', a: 'Sí. Cuando una app ya está conectada, su tarjeta dice **Conectar otra cuenta**. Cada conexión aparece por separado y en la automatización eliges cuál usar.' },
                    { q: 'Si desconecto una app, ¿se borran mis datos?', a: 'No. Se borra la conexión (la clave o la autorización). Las automatizaciones quedan, pero sus acciones con esa app fallan hasta que la vuelvas a conectar. En una tienda o una base de datos sincronizada, lo que ya se trajo a tus listas se queda.' },
                    { q: '¿Las apps conectadas cuestan algo?', a: 'Conectar no cuesta. Lo que cobra cada servicio (los mensajes de WhatsApp oficial, los cobros de Mercado Pago) se lo pagas a ese servicio, con tu cuenta.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Usar una app en una automatización', article: 'integraciones-en-automatizaciones' },
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'integraciones-mensajeria',
        route: '/settings?s=conectores',
        related: ['integraciones-que-son', 'integraciones-en-automatizaciones', 'wab-cual-elegir'],
        blocks: [
            {
                t: 'p',
                md: 'Los mensajes son lo que más se automatiza: el recordatorio de pago que sale solo, el aviso al equipo cuando entra un pedido grande, la confirmación de una cita. La galería trae tres apps de mensajería que se conectan con una clave o una autorización, y una cuarta, **WhatsApp Business (oficial)**, que tiene su propio módulo.',
            },
            { t: 'anim', key: 'integ-key-test', caption: 'Pegas la clave, eliges la cuenta, te mandas una prueba y, si llega, conectas.' },
            { t: 'h', text: 'WhatsApp (WAS)' },
            {
                t: 'p',
                md: '**WhatsApp (WAS)** usa tu cuenta del servicio WAS, que manda mensajes desde un número de WhatsApp normal. Es la forma más rápida de empezar: no pide trámites con Meta. No es la API oficial, así que no tiene plantillas aprobadas ni te entera de las respuestas de tus clientes; para eso está [WhatsApp Business oficial](/aprende/whatsapp-business/wab-cual-elegir).',
            },
            {
                t: 'steps',
                items: [
                    'En tu panel de WAS ve a **Herramientas → Claves de API** y copia la clave.',
                    'En **Ajustes → Integraciones**, toca **Conectar** en **WhatsApp (WAS)** y pega la clave en **Clave de API**.',
                    'Toca **Buscar mis cuentas** y elige el número en **Cuenta de WhatsApp**. Si tu clave no tiene permiso para listar cuentas, escribe a mano el identificador de la cuenta (el mismo que ya usas en tus envíos): no es un error, las claves de WAS pueden tener permiso para enviar y no para listar.',
                    'En **Número para el mensaje de prueba** escribe tu propio número con indicativo (+57 300…) y toca **Enviar prueba**. Llega un WhatsApp real.',
                    'Si te llegó, toca **Conectar**.',
                ],
            },
            {
                t: 'settings',
                title: 'Las acciones de WhatsApp (WAS)',
                rows: [
                    { name: 'Enviar mensaje de WhatsApp', what: '**Número de destino** (con indicativo; usa el campo teléfono del registro, por ejemplo `{{telefono}}`) y **Mensaje**, que acepta variables del registro.', tip: 'El campo Teléfono de la app ya guarda el número con indicativo: úsalo y te ahorras errores de formato.' },
                    { name: 'Enviar archivo por WhatsApp', what: 'Un archivo con un texto opcional: **Enlace del archivo** (una dirección pública https), **Tipo de archivo** (Imagen, Video, Audio o Documento PDF) y **Texto que lo acompaña**.', tip: 'Combínalo con «Generar un PDF»: el enlace `{{pdf.link}}` manda la cuenta de cobro recién armada.' },
                    { name: 'Servidor (opciones avanzadas)', what: 'Sólo si usas un servidor de WAS propio. Casi nadie lo cambia.' },
                ],
            },
            { t: 'h', text: 'Telegram' },
            {
                t: 'steps',
                items: [
                    'En Telegram abre **@BotFather**, escribe `/newbot`, elige un nombre y copia el token que te devuelve.',
                    'Agrega el bot al grupo o canal donde quieres los avisos.',
                    'En la galería toca **Conectar** en **Telegram** y pega el **Token del bot**.',
                    'En **Chat para el mensaje de prueba** escribe el identificador del chat (por ejemplo `-1001234567890`) o el `@nombre` de un canal público, y toca **Enviar prueba**.',
                    'Si el mensaje llegó al grupo, toca **Conectar**. La conexión queda con el nombre del bot («@avisos_cafeaurora_bot»).',
                ],
            },
            {
                t: 'p',
                md: 'La acción **Enviar mensaje de Telegram** pide el **Chat, grupo o canal**, el **Mensaje** y la opción **Enviar sin sonido** (útil para avisos que no son urgentes, como el resumen del día).',
            },
            { t: 'h', text: 'Slack' },
            {
                t: 'p',
                md: 'Slack se conecta con un clic: **Conectar**, eliges tu espacio de Slack y tocas **Permitir**. La acción **Enviar mensaje a Slack** pide el **Canal** (el nombre, como `#ventas`, o su identificador) y el **Mensaje**.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Canales privados',
                md: 'En un canal privado, primero invita la app con `/invite` dentro del canal. Si no está adentro, Slack responde con un error y la corrida de la automatización queda **fallida** con el motivo («la app no está en ese canal»): no se pierde en silencio.',
            },
            {
                t: 'example',
                title: 'Una distribuidora de alimentos',
                md: '- **WhatsApp (WAS)** para los clientes: cuando una factura vence y sigue pendiente, sale el recordatorio con el link de pago.\n- **Slack** para el equipo comercial: cuando entra una oportunidad de más de $ 20.000.000, se avisa en `#ventas-grandes` con el nombre del cliente y el vendedor.\n- **Telegram** para el dueño: un mensaje **sin sonido** cada mañana con el total vendido ayer.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'El mensaje de prueba de WAS no llegó, ¿qué reviso?', a: 'Que el número de prueba tenga indicativo de país, que la cuenta elegida esté conectada en tu panel de WAS y que la clave tenga permiso para enviar. Si WAS responde con un error, el cuadro lo muestra tal cual.' },
                    { q: '¿Puedo mandar a un grupo de WhatsApp?', a: 'La acción manda a un número. Para avisos internos a un grupo, Telegram o Slack son más cómodos.' },
                    { q: '¿Cuántos mensajes puedo mandar?', a: 'La app no pone un tope propio a los mensajes: el límite lo pone cada servicio (tu plan de WAS, las reglas de Telegram o de Slack).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'WhatsApp oficial vs. WAS', article: 'wab-cual-elegir' },
                    { label: 'Usar las apps en automatizaciones', article: 'integraciones-en-automatizaciones' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'integraciones-google-microsoft',
        route: '/settings?s=conectores',
        related: ['integraciones-que-son', 'integraciones-almacenamiento', 'integraciones-en-automatizaciones'],
        blocks: [
            {
                t: 'p',
                md: 'Gmail, Outlook, Google Calendar y Google Sheets no piden claves: se conectan **autorizando con tu cuenta**, igual que cuando entras a otra app con «Iniciar sesión con Google». La app sólo recibe el permiso para lo que necesita (mandar correos, crear eventos, escribir en planillas) y la autorización **se renueva sola**.',
            },
            { t: 'anim', key: 'integ-oauth', caption: 'Conectar Gmail: tocas Conectar, eliges tu cuenta y das permiso, y vuelves con la app conectada.' },
            { t: 'h', text: 'Autorizar con tu cuenta' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Integraciones**, toca **Conectar** en la app.',
                    'Se abre la pantalla de Google o de Microsoft. Elige la cuenta de la empresa (por ejemplo `ventas@tuempresa.com`) y toca **Permitir**.',
                    'Vuelves a la app con el aviso verde y la app en **Conectadas**, con la cuenta al lado.',
                    'Si algún día la autorización se vence o alguien la quita desde la cuenta de Google o Microsoft, la fila dice **Hay que volver a conectarla**: toca **Reconectar**.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Usa una cuenta de la empresa',
                md: 'Conecta un buzón compartido (ventas@, facturacion@) y no tu cuenta personal: si la persona se va de la empresa, la conexión sigue funcionando.',
            },
            { t: 'h', text: 'Gmail y Outlook: correos desde tu dirección' },
            {
                t: 'settings',
                title: 'Acciones «Enviar correo con Gmail» y «Enviar correo con Outlook»',
                rows: [
                    { name: 'Para', what: 'Uno o varios correos separados por coma. Acepta variables, como `{{email}}`.' },
                    { name: 'Asunto', what: 'El asunto del correo. Acepta variables: «Tu factura {{numero}}».' },
                    { name: 'Mensaje', what: 'El cuerpo del correo.' },
                    { name: 'Cc y Cco', what: 'Copia y copia oculta.', tip: 'Pon a tu contador en Cco para que reciba copia de cada factura enviada.' },
                    { name: 'El mensaje es HTML', what: 'Si está en **Sí**, el mensaje se interpreta como HTML (con formato). Los valores del registro se escapan: nadie puede meter enlaces falsos desde un formulario.' },
                ],
            },
            {
                t: 'p',
                md: 'El correo sale **desde tu dirección** y queda en tus **Enviados**, como si lo hubieras mandado a mano. La misma conexión de Gmail u Outlook también puede ser **el correo de toda la empresa** (los avisos, los enlaces del portal): eso se elige en **Ajustes → Correo**.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Los límites del proveedor',
                md: 'Google y Microsoft limitan cuántos correos manda una cuenta por día (una cuenta personal de Gmail unos 500; Google Workspace unos 2.000). No es una herramienta de campañas masivas: si pasas el límite, el proveedor bloquea el envío hasta 24 horas.',
            },
            { t: 'h', text: 'Google Calendar y Outlook: eventos desde tus fechas' },
            {
                t: 'settings',
                title: 'Acciones «Crear evento en Google Calendar» y «Crear evento en Outlook»',
                rows: [
                    { name: 'Calendario', what: 'Sólo en Google Calendar. Vacío = tu calendario principal; para otro, su identificador (está en la configuración del calendario).' },
                    { name: 'Título', what: 'El nombre del evento: «Visita · {{cliente}}».' },
                    { name: 'Fecha', what: 'AAAA-MM-DD o una variable como `{{fecha}}`. Si el campo trae hora, el evento se crea a esa hora.' },
                    { name: 'Hora de inicio', what: 'HH:MM en 24 horas. Vacío = evento de todo el día.' },
                    { name: 'Duración (minutos)', what: 'Cuánto dura. Por defecto, 60.' },
                    { name: 'Zona horaria', what: 'En qué hora están la fecha y la hora (Bogotá, Ciudad de México, Santiago…).', tip: 'Si tu campo es «Fecha y hora», la hora ya viaja exacta y la zona sólo importa para fechas sin hora.' },
                    { name: 'Descripción', what: 'El detalle del evento.' },
                    { name: 'Invitados', what: 'Correos separados por coma. Reciben la invitación del calendario.' },
                ],
            },
            { t: 'h', text: 'Google Sheets: una fila por cada cosa que pase' },
            {
                t: 'p',
                md: 'La acción **Agregar fila en Google Sheets** suma una fila al final de una planilla. Pide la **Hoja de cálculo** (pegas el enlace de la planilla), la **Pestaña** (vacío = la primera) y los **Valores de la fila**: uno por renglón, en el orden de las columnas A, B, C…\n\nUn valor que empieza con `=`, `+` o `@` se escribe como texto, nunca como fórmula: un dato de un cliente no puede meterle cálculos a tu planilla (y un teléfono no pierde su `+`).',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria',
                md: 'Cuando una visita pasa a **Agendada**, la automatización crea el evento en el **Google Calendar** del asesor con la dirección del inmueble en la descripción e invita al cliente. Cuando un arriendo se firma, agrega una fila en la planilla **Contratos 2026** que lleva el contador: fecha, inquilino, canon y comisión.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿La app puede leer mis correos o mi calendario?', a: 'No. Pide sólo el permiso para enviar correos, crear eventos o escribir en planillas. No lee tu bandeja de entrada ni tus otros archivos.' },
                    { q: '¿Qué pasa si cambio la contraseña de mi cuenta de Google?', a: 'Google puede cortar las autorizaciones. Si pasa, la fila dice **Hay que volver a conectarla** y te llega un aviso en **Problemas**: toca **Reconectar**.' },
                    { q: '¿Puedo conectar la planilla de otra persona?', a: 'Sí, si la cuenta que conectaste tiene permiso para editarla. La planilla se comparte desde Google Sheets como siempre.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'El correo de la empresa', to: '/settings?s=correo' },
                    { label: 'Usar las apps en automatizaciones', article: 'integraciones-en-automatizaciones' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'integraciones-almacenamiento',
        route: '/settings?s=almacenamiento',
        related: ['integraciones-que-son', 'integraciones-google-microsoft'],
        blocks: [
            {
                t: 'p',
                md: 'Por defecto, los archivos que subes (fotos, contratos, adjuntos de tickets) y los PDF que la app guarda ocupan el **espacio de tu plan** en el servidor de la plataforma. Si manejas mucho volumen, puedes guardarlos en **tu propio almacenamiento**: tu **Google Drive** o un **bucket compatible con S3** (Amazon S3, Backblaze, Cloudflare R2, Wasabi, DigitalOcean Spaces, MinIO). Ahí no cuentan para el plan: lo cobra tu proveedor.',
            },
            { t: 'anim', key: 'integ-storage', caption: 'Con tu Drive elegido, los archivos van a la carpeta de la empresa y la barra del plan no se mueve.' },
            { t: 'h', text: 'Paso 1: conectar el almacenamiento' },
            {
                t: 'p',
                md: '**Google Drive** se conecta con **Conectar** y la cuenta de Google de la empresa. La app pide un permiso mínimo: sólo ve los archivos que ella misma crea, dentro de una carpeta propia en tu Drive. El resto de tu Drive queda fuera de su alcance.\n\n**Almacenamiento S3** se conecta con una clave:',
            },
            {
                t: 'settings',
                title: 'Los datos de «Almacenamiento S3»',
                rows: [
                    { name: 'Dirección del servicio', what: 'Vacío = Amazon S3. Para otros: Backblaze `https://s3.<región>.backblazeb2.com`, Cloudflare R2 `https://<cuenta>.r2.cloudflarestorage.com`, Wasabi `https://s3.<región>.wasabisys.com`, DigitalOcean `https://<región>.digitaloceanspaces.com`.' },
                    { name: 'Región', what: 'La del bucket (us-east-1, eu-central-1…). En Cloudflare R2, «auto».' },
                    { name: 'Bucket', what: 'El nombre del bucket. Créalo **privado**: los archivos se entregan con enlaces temporales.' },
                    { name: 'ID de la clave de acceso y Clave secreta', what: 'Una clave que pueda leer, escribir y borrar en ese bucket. En Backblaze se llaman keyID y applicationKey.' },
                    { name: 'Carpeta dentro del bucket', what: 'Opcional: los archivos se guardan bajo esa carpeta (por ejemplo `empresa/`).' },
                    { name: 'Estilo de ruta', what: 'Enciéndelo sólo para MinIO o servidores propios. Amazon, Backblaze, R2 y Wasabi funcionan apagado.' },
                ],
            },
            {
                t: 'p',
                md: 'Al conectar, la app **sube, lee y borra un archivo chiquito** de prueba. Si algo falla (bucket inexistente, clave sin permiso), no se guarda y te dice por qué.',
            },
            { t: 'h', text: 'Paso 2: elegirlo en Ajustes → Almacenamiento' },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Almacenamiento**. Ahí ves cuánto ocupa cada lugar y cuál está en uso.',
                    'En **Elige dónde guardar los archivos**, elige tu Google Drive o tu bucket. Antes de aceptarlo, la app vuelve a probar subir, leer y borrar.',
                    'Confirma **Usar este almacenamiento**. Lo que se suba desde ahora va ahí.',
                    'Lo que ya tenías sigue donde estaba y se sigue viendo. Si quieres, usa el botón para **mover** esos archivos: se mudan por tandas, con avance, y los que no se pueden mover quedan donde estaban y se listan.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Cada archivo recuerda dónde quedó',
                md: 'Puedes cambiar de almacenamiento cuando quieras: los archivos viejos no se rompen, porque cada uno sabe en qué lugar está guardado. Para volver al servidor de la plataforma, elige esa opción: lo nuevo vuelve a contar para el plan.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Nada cae en silencio',
                md: 'Si tu bucket o tu Drive no responde, la subida **falla** con el motivo en vez de guardarse en otro lado. Y una conexión de almacenamiento que está en uso o que tiene archivos no se puede desconectar ni cambiar de bucket: primero mueve los archivos.',
            },
            {
                t: 'example',
                title: 'Una constructora',
                md: 'Cada obra sube decenas de fotos diarias y planos pesados. Con un bucket de Backblaze, pagan centavos por gigabyte, el plan deja de llenarse y las fotos se siguen viendo en la ficha de cada obra como siempre.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Los archivos de Drive se ven en la app?', a: 'Sí, igual que antes: en la tabla, la ficha y el portal. Se descargan pasando por la app con la autorización de tu cuenta.' },
                    { q: '¿Puedo borrar los archivos desde mi Drive?', a: 'Si los borras allá, la app ya no los encuentra. Bórralos desde la app (en el campo o en el registro).' },
                    { q: '¿Borrar la empresa borra mi bucket?', a: 'No. La app nunca toca tu bucket ni tu Drive más allá de los archivos que ella guardó.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Almacenamiento', to: '/settings?s=almacenamiento' },
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'integraciones-otras-apps',
        route: '/settings?s=conectores',
        related: ['tienda-conectar', 'wab-conectar', 'sql-conectar', 'integraciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'Cinco apps de la galería hacen más que una acción en una automatización: traen datos, mantienen listas al día o reciben avisos de pago. Se conectan igual que las demás (con **Conectar** y su clave), pero después tienen su propia pantalla, a la que entras con el botón que aparece en su fila de **Conectadas**.',
            },
            { t: 'anim', key: 'integ-hero', caption: 'Cada app conectada queda disponible para tus listas y automatizaciones.' },
            { t: 'h', text: 'WooCommerce: tu tienda en línea' },
            {
                t: 'p',
                md: 'Pegas la **Dirección de la tienda** (con HTTPS), la **Clave del cliente** (ck_…) y la **Clave secreta** (cs_…) que generas en WordPress → WooCommerce → Ajustes → Avanzado → API REST. Después, **Sincronizar tienda** trae clientes, productos con sus variaciones y pedidos a tres listas que se mantienen al día solas, con tableros de ventas e inventario. Todo está en el módulo [Tiendas WooCommerce](/aprende/tiendas-woocommerce/tienda-conectar).',
            },
            { t: 'h', text: 'Mercado Pago y Wompi: cobrar y enterarte cuando te pagan' },
            {
                t: 'p',
                md: 'Con el **Access Token** de Mercado Pago, o las llaves de Wompi (**Llave pública**, **Llave privada** y **Secreto de eventos**), puedes crear links de pago desde un registro o una automatización, y la lista se actualiza sola cuando el cliente paga. El dinero va a **tu** cuenta. La pantalla **Cobros** de cada conexión tiene la dirección de eventos para Wompi y el resumen de lo cobrado.',
            },
            { t: 'h', text: 'SQL Server y Azure SQL: datos de tu sistema contable o ERP' },
            {
                t: 'p',
                md: 'Con el **Servidor**, la **Base de datos**, un **Usuario** de solo lectura y su **Contraseña**, la app trae el resultado de una consulta a una lista cada cierto tiempo, actualizando por una columna clave (el NIT, el número de factura) en vez de duplicar. Se arma en **Sincronizaciones**. Todo está en el módulo [Bases de datos SQL](/aprende/bases-de-datos-sql/sql-que-es).',
            },
            { t: 'h', text: 'WhatsApp Business (oficial)' },
            {
                t: 'p',
                md: 'La API oficial de Meta: plantillas aprobadas, los mensajes que te escriben tus clientes y el estado de cada envío (entregado, leído). Pide un token permanente, los identificadores del número y de la cuenta y la clave secreta de la app de Meta. Después, **Configurar WhatsApp** muestra la dirección de avisos y las plantillas. Todo está en el módulo [WhatsApp Business oficial](/aprende/whatsapp-business/wab-conectar).',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'Store', title: 'WooCommerce', md: 'Botón **Sincronizar tienda**: listas de clientes, productos y pedidos al día.', tone: 'violet' },
                    { icon: 'Wallet', title: 'Mercado Pago y Wompi', md: 'Botón **Cobros**: links de pago y el estado de cada cobro.', tone: 'blue' },
                    { icon: 'Database', title: 'SQL Server', md: 'Botón **Sincronizaciones**: tu ERP o contabilidad en una lista.', tone: 'rose' },
                    { icon: 'MessageCircle', title: 'WhatsApp oficial', md: 'Botón **Configurar WhatsApp**: avisos de Meta, contactos y plantillas.', tone: 'mint' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Estas conexiones **comprueban los datos antes de guardar**: si la tienda no responde, la base de datos rechaza el usuario o Meta no reconoce el token, no se guardan y el mensaje dice qué revisar.',
            },
            {
                t: 'example',
                title: 'Una tienda de ropa deportiva',
                md: 'Conectan WooCommerce (pedidos e inventario), Mercado Pago (para los pedidos por WhatsApp que se pagan con link) y WhatsApp oficial (para avisar «tu pedido salió» con una plantilla aprobada). Las tres viven en **Ajustes → Integraciones** y se combinan en las automatizaciones.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Necesito ser técnico para estas?', a: 'Para WooCommerce, Mercado Pago y Wompi no: copias y pegas claves siguiendo los pasos del cuadro. SQL Server y WhatsApp oficial piden algo de ayuda de quien administra tu base de datos o tu cuenta de Meta.' },
                    { q: 'Si desconecto la tienda o la base, ¿pierdo lo que se trajo?', a: 'No. Dejan de actualizarse, pero las listas y sus registros se quedan en tu espacio de trabajo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Tiendas WooCommerce', article: 'tienda-conectar' },
                    { label: 'Bases de datos SQL', article: 'sql-que-es' },
                    { label: 'WhatsApp Business oficial', article: 'wab-cual-elegir' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'integraciones-en-automatizaciones',
        route: '/settings?s=conectores',
        related: ['integraciones-que-son', 'integraciones-mensajeria', 'integraciones-webhooks'],
        blocks: [
            {
                t: 'p',
                md: 'Una app conectada no hace nada sola: la usa una **automatización**. Cada app trae **acciones ya armadas** («Enviar mensaje de WhatsApp», «Crear evento en Google Calendar», «Agregar fila en Google Sheets») que aparecen en el menú de acciones con su logo. Tú sólo llenas los datos, casi siempre con variables del registro.',
            },
            { t: 'anim', key: 'automation-whatsapp', caption: 'Una factura vence, sigue pendiente, y sale un WhatsApp al cliente con el link de pago.' },
            { t: 'h', text: 'Agregar una acción de una app' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y entra a sus **Automatizaciones**; crea una o abre una existente.',
                    'Toca **Añadir acción** (o el **+** entre dos pasos).',
                    'Baja hasta **Apps conectadas**: cada acción tiene el logo de su app y, si conectaste dos cuentas de la misma app, el nombre de la conexión al lado.',
                    'Elige la acción. Se abre un formulario con sus datos: los marcados con asterisco son obligatorios.',
                    'Llena cada dato con texto fijo o con **variables** del registro (`{{telefono}}`, `{{nombre}}`, `{{total}}`) usando el botón de variables.',
                    'Toca **Probar ahora**: la acción corre con un registro real de la lista y ves qué se envió y qué respondió el servicio, con las claves tapadas.',
                    'Guarda la automatización.',
                ],
            },
            { t: 'demo', key: 'integ-acciones-apps', caption: 'Las acciones de tus apps aparecen al final del menú de acciones.', fallback: 'integ-connect-once' },
            {
                t: 'callout',
                tone: 'tip',
                title: '¿Te falta una app?',
                md: 'Al final del menú está **Conectar una app**: abre la galería en otra pestaña para que no pierdas lo que estabas armando. Cuando vuelvas, la app ya aparece en el menú.',
            },
            { t: 'h', text: 'Variables útiles' },
            {
                t: 'settings',
                rows: [
                    { name: '{{campo}}', what: 'El valor de un campo del registro, como se ve en la ficha (montos con separadores de miles, fechas en el formato de tu empresa).' },
                    { name: '{{campo|label}}', what: 'La etiqueta de una opción en vez de su valor interno: «Pendiente de pago» en vez de «pendiente».', tip: 'Úsalo en mensajes para personas; el valor interno, para otros sistemas.' },
                    { name: '{{before.campo}}', what: 'El valor que tenía el campo antes del cambio (en los disparadores de cambio).' },
                    { name: '{{pdf.link}}', what: 'El enlace del PDF que generó un paso anterior «Generar un PDF».', tip: 'Ideal para «Enviar archivo por WhatsApp».' },
                    { name: '{{fecha|larga}}, {{total|pesos}}', what: 'Una fecha en palabras («8 de octubre de 2026») o un monto en letras («un millón doscientos mil pesos»).' },
                ],
            },
            { t: 'h', text: 'Cuando una conexión falla' },
            {
                t: 'p',
                md: 'Una conexión puede dejar de funcionar: la autorización de Google venció, alguien quitó el permiso desde la cuenta de Slack, cambiaste la clave en el otro servicio o la clave guardada ya no se puede leer. La app **no manda nada sin credencial** ni falla en silencio:\n- La corrida de la automatización queda **fallida**, con el motivo («la conexión ya no existe», «la app no está en ese canal»), en su **Historial**.\n- Se abre un **problema** en **Ajustes → Problemas** y aparece la pastilla roja «N problemas» arriba: le llega un aviso al administrador y a quien creó la automatización.\n- La fila de la app en **Integraciones** dice **Hay que volver a conectarla**.\n\nArréglala con **Reconectar** o **Actualizar clave**. El problema se cierra solo cuando la acción vuelve a funcionar, o lo cierras tú con **Ya lo arreglé**.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Algunos servicios responden «bien» con un error adentro',
                md: 'Slack, Telegram y WAS a veces contestan «OK» pero con un error en el mensaje. La app revisa la respuesta: si dice error, la corrida queda **fallida** con ese motivo, no como «enviada».',
            },
            {
                t: 'example',
                title: 'Una academia de idiomas',
                md: 'Cuando un estudiante se inscribe (formulario de la web), la automatización: 1) crea el evento de la clase de nivelación en el **Google Calendar** del profesor; 2) le manda un **WhatsApp** de bienvenida con el horario; 3) suma una fila en la planilla **Inscripciones 2026** de **Google Sheets** que usa la directora para sus reportes.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿«Probar ahora» manda de verdad el mensaje?', a: 'Sí: la prueba es real, con los datos del último registro de la lista que puedes ver. Usa tu propio número o un canal de pruebas mientras armas la automatización.' },
                    { q: '¿Puedo usar dos apps en la misma automatización?', a: 'Sí, todas las que quieras, una acción detrás de otra, incluso con condiciones por acción o ramas «Si / Si no».' },
                    { q: '¿Quién recibe el aviso de que algo falló?', a: 'Los administradores y la persona que creó la automatización, en la campana y por correo (una vez; si sigue fallando, a lo sumo un recordatorio por día).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                    { label: 'Ver los problemas', to: '/settings?s=problemas' },
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'integraciones-api-personalizada',
        route: '/settings?s=conectores',
        related: ['integraciones-webhooks', 'integraciones-en-automatizaciones', 'integraciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'Si el servicio que usas no está en la galería (tu sistema de facturación, una plataforma de mensajes de texto, el sistema de tu transportadora), puedes conectarlo igual con una **API personalizada**. Es la opción para quien conoce un poco de APIs —o para que lo arme tu proveedor una vez— y después el resto del equipo la usa como cualquier otra app: con acciones con nombre y un formulario simple.',
            },
            { t: 'anim', key: 'integ-api-custom', caption: 'Lo técnico se configura una vez; en la automatización queda una acción con nombre y sus datos.' },
            { t: 'h', text: 'Crear la conexión' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Integraciones**, al final, abre **Avanzado: API personalizada**.',
                    'Toca **Nueva conexión**.',
                    'Ponle un **Nombre** que el equipo reconozca («Mi sistema de facturación»).',
                    'Escribe la **URL base**: la parte común de todas las direcciones del servicio (`https://api.mifactura.co/v1`).',
                    'Elige la **Autenticación** y pega la clave.',
                    'Toca **Probar conexión**: la app llama al servicio y te muestra si respondió, el código (HTTP 200) y lo que se envió, con la clave tapada.',
                    'Toca **Guardar**.',
                ],
            },
            { t: 'demo', key: 'integ-api-personalizada', caption: 'Crear una API personalizada.', fallback: 'integ-api-custom' },
            {
                t: 'settings',
                title: 'Tipos de autenticación',
                rows: [
                    { name: 'Sin autenticación', what: 'El servicio no pide clave.' },
                    { name: 'Token Bearer', what: 'La clave va en la cabecera `Authorization: Bearer …`. Es lo más común.' },
                    { name: 'Cabecera personalizada', what: 'La clave va en una cabecera con el nombre que pide el servicio (por ejemplo `X-Api-Key`). Escribes el **Nombre de la cabecera** y la clave.' },
                    { name: 'Usuario y contraseña (Basic)', what: 'Pide **Usuario** y **Contraseña**.' },
                    { name: 'Parámetro en la URL', what: 'La clave viaja en la dirección (`?token=…`). Escribes el **Nombre del parámetro**.' },
                    { name: 'Campo del cuerpo', what: 'La clave se agrega como un campo más de los datos enviados (algunos gateways de WhatsApp o SMS la piden así). Escribes el **Nombre del campo**.' },
                    { name: 'OAuth 2.0 (autorizar con el proveedor)', what: 'Para servicios que se autorizan con una cuenta (HubSpot, Zoho, GitHub…). Ver más abajo.' },
                ],
            },
            {
                t: 'settings',
                title: 'Otros datos de la conexión',
                rows: [
                    { name: 'Secreto de firma (opcional)', what: 'Si el servicio lo pide, cada envío lleva una firma calculada con este secreto para que el otro lado sepa que vino de ti.' },
                    { name: 'Quién la usa', what: '**Todo el equipo** o **Sólo yo** (si están permitidas las conexiones privadas).' },
                    { name: 'Credencial ilegible', what: 'Una etiqueta roja que aparece si la clave guardada ya no se puede leer. Vuelve a pegarla con **Editar**.' },
                ],
            },
            { t: 'h', text: 'Acciones con nombre' },
            {
                t: 'p',
                md: 'Una conexión puede tener **acciones con nombre** («Emitir factura», «Enviar SMS»). Son lo que hace usable la conexión: quien arma una automatización elige «Emitir factura» en el menú y llena un formulario con etiquetas claras, sin saber de métodos ni rutas. En **Acciones de esta conexión** toca **Agregar acción**:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Nombre', what: 'Lo que se ve en el menú de acciones.' },
                    { name: 'Clave interna', what: 'Se propone sola a partir del nombre. Las automatizaciones guardan esta clave: puedes renombrar la acción sin desconectar nada, pero **cambiar la clave las desconecta**.' },
                    { name: 'Descripción (opcional)', what: 'Una línea que aparece debajo del nombre en el menú.' },
                    { name: 'Método y Ruta', what: 'Qué pide al servicio (GET, POST…) y en qué dirección, a partir de la URL base (`/facturas`). En la ruta puedes usar `{clave}` para insertar un dato.' },
                    { name: 'Tipo de contenido y Cuerpo', what: 'En qué formato van los datos. En formatos de texto libre puedes escribir el cuerpo a mano usando `{clave}` para insertar un campo.' },
                ],
            },
            {
                t: 'settings',
                title: 'Campos que se completan al usarla',
                rows: [
                    { name: 'Etiqueta', what: 'Cómo se llama el dato en el formulario («Destinatario»).' },
                    { name: 'Clave que espera el servicio', what: 'Cómo lo llama el servicio (`recipient`).' },
                    { name: 'Tipo', what: 'Texto, Texto largo, Número, Lista de opciones o Sí / No.', tip: 'Una lista de opciones evita errores de tipeo: «Tipo de documento: Factura, Nota crédito».' },
                    { name: 'Dónde viaja', what: 'En el cuerpo, En la URL (?clave=valor), En una cabecera o En la ruta ({clave}).' },
                    { name: 'Valor por defecto', what: 'Se usa si quien arma la automatización lo deja vacío.' },
                    { name: 'Obligatorio', what: 'Sin ese dato la acción no se ejecuta y la corrida lo dice. Un dato opcional vacío no se envía.' },
                ],
            },
            { t: 'h', text: 'OAuth 2.0 con tu propia app' },
            {
                t: 'p',
                md: 'Si eliges **OAuth 2.0**, el formulario pide el **Proveedor** (Google, Microsoft 365 / Entra ID, Slack, GitHub, HubSpot, Zoho u **Otro (configurar a mano)**), el **Client ID**, el **Client Secret**, los **Permisos (scopes)**, la **URL de autorización** y la **URL de tokens**. Copia la **URI de redirección** con **Copiar** y regístrala en la consola del proveedor. Guarda la conexión y toca **Autorizar** en su fila: se abre el proveedor, das permiso y la conexión queda **Autorizada** y **se renueva sola**.',
            },
            { t: 'h', text: 'Claves escritas dentro de las automatizaciones' },
            {
                t: 'p',
                md: 'Si alguien pegó una clave directamente dentro de una acción «Llamar webhook externo», arriba de la API personalizada aparece la tarjeta **Hay credenciales escritas dentro de tus automatizaciones**. Esas claves quedan sin cifrar y hay que cambiarlas una por una. Revisa el nombre propuesto para cada servicio y toca **Convertir todo a conexiones**: la app crea las conexiones cifradas y reescribe las acciones para usarlas. Las automatizaciones siguen funcionando igual.',
            },
            {
                t: 'example',
                title: 'Una empresa de mensajería urbana',
                md: 'Su proveedor de SMS no está en la galería. El técnico crea la conexión «SMS Express» (URL base, Token Bearer) con una acción **Enviar SMS** y dos campos: **Número** y **Texto**. Desde ese día, la coordinadora arma solita la automatización «Tu pedido va en camino» eligiendo **Enviar SMS** y poniendo `{{telefono}}` y el mensaje.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo borrar una conexión que se está usando?', a: 'La papelera de su fila te avisa: «Está en uso: si la borras, esas automatizaciones van a fallar». Hay que tocarla otra vez para confirmar.' },
                    { q: '¿Y si renombro una acción?', a: 'No pasa nada: las automatizaciones guardan la clave interna. Si borras la acción o cambias su clave, las automatizaciones que la usaban fallan y lo dicen en su tarjeta.' },
                    { q: '¿Qué pasa si el servicio está caído?', a: 'La corrida queda fallida con la respuesta del servicio, y si se repite se abre un problema en **Ajustes → Problemas**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Webhooks: recibir y enviar datos', article: 'integraciones-webhooks' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'integraciones-webhooks',
        route: '/settings?s=conectores',
        related: ['integraciones-api-personalizada', 'integraciones-en-automatizaciones'],
        blocks: [
            {
                t: 'p',
                md: 'Un **webhook** es una dirección de internet a la que un sistema le manda datos a otro cuando pasa algo. Sirve en las dos direcciones:\n- **Recibir**: el formulario de tu sitio web, tu tienda, Zapier o Make le mandan datos a la app y se crea o actualiza un registro.\n- **Enviar**: cuando pasa algo en una lista, la app le avisa a otro sistema (tu ERP, una plataforma de mensajes, un servicio propio).',
            },
            { t: 'anim', key: 'integ-webhook-in', caption: 'El formulario de tu sitio web manda los datos a la URL pública y la automatización crea el registro.' },
            { t: 'h', text: 'Recibir datos: el disparador «Webhook entrante»' },
            {
                t: 'steps',
                items: [
                    'Crea una automatización en la lista donde deben caer los datos y elige el disparador **Webhook entrante (URL pública)**.',
                    'Agrega las acciones (por ejemplo **Crear un registro**) y **Guarda**: al guardar se genera la **URL pública del webhook**, única para esa automatización.',
                    'Toca **Copiar** y pega esa dirección en el otro sistema: la configuración de tu formulario, tu tienda, el paso «Webhook» de Zapier o Make.',
                    'Para ver qué llega, toca **Escuchar datos de prueba** y manda un envío de prueba desde el otro sistema. En segundos aparece cada dato con su valor y su variable lista para copiar.',
                    'Usa esas variables en las acciones. Los datos cuyo nombre coincide con un campo de la lista se usan directo (`{{nombre}}`); el resto queda como `{{payload.dato}}`, también con niveles (`{{payload.contacto.telefono}}`).',
                ],
            },
            { t: 'demo', key: 'integ-webhook-entrante', caption: 'La URL pública de una automatización y los datos de prueba que llegaron.', fallback: 'integ-webhook-in' },
            {
                t: 'callout',
                tone: 'warn',
                title: 'La URL es la llave',
                md: 'Cualquiera que tenga la dirección puede mandar datos. No la publiques en lugares abiertos. Si se filtró, usa **Regenerar URL** y guarda: la dirección vieja deja de funcionar al instante.',
            },
            {
                t: 'settings',
                title: 'Lo que hay que saber del webhook entrante',
                rows: [
                    { name: 'Condiciones', what: 'Puedes poner filtros como en cualquier disparador: la automatización sólo sigue si los datos cumplen las condiciones.' },
                    { name: 'Respuesta inmediata', what: 'La app responde enseguida que recibió los datos y procesa la automatización en segundo plano: el otro sistema nunca queda esperando.' },
                    { name: 'Tope de envíos', what: 'Cada dirección acepta hasta 60 envíos por minuto y 2.000 por hora, para frenar abusos.' },
                    { name: 'Empresa impaga', what: 'Si la empresa está en solo-lectura por falta de pago, los envíos se rechazan hasta que se ponga al día.' },
                    { name: 'Capturas de prueba', what: 'Se guardan las últimas 5 durante 24 horas, sólo para que veas qué llega.' },
                ],
            },
            { t: 'h', text: 'Enviar datos: la acción «Llamar webhook externo»' },
            {
                t: 'p',
                md: 'La acción **Llamar webhook externo** le hace un pedido a otro sistema con los datos del registro. Tiene un constructor visual: el método, el tipo de contenido (formulario, texto, XML y otros formatos), filas clave/valor para el cuerpo, las cabeceras y los parámetros de la dirección, cada uno con variables. Puede usar una **API personalizada** para no escribir la clave adentro, firmar cada envío con un secreto y, con **Probar ahora**, mostrarte lo que se envió y lo que contestaron.\n\nLa respuesta del otro sistema queda disponible para los pasos siguientes: `{{webhook.status}}` y los datos de la respuesta, por ejemplo `{{webhook.body.numero_guia}}`. Los detalles están en el módulo de automatizaciones.',
            },
            {
                t: 'example',
                title: 'Un hotel boutique',
                md: '- **Recibir**: el formulario «Reserva tu estadía» de su sitio web manda nombre, correo, fechas y número de huéspedes a la URL pública; la automatización crea la solicitud en la lista **Reservas** y le manda un WhatsApp de confirmación al huésped.\n- **Enviar**: cuando la reserva pasa a **Confirmada**, **Llamar webhook externo** registra la estadía en el sistema de la recepción y guarda el número de reserva que devuelve en el registro, con `{{webhook.body.reserva_id}}`.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo actualizar un registro existente con un webhook?', a: 'El webhook entrante no trae un registro propio: sirve para **crear** registros nuevos, mandar avisos o llamar a otro sistema con los datos que llegan. Para mantener una lista al día con otro sistema, mira las sincronizaciones de tienda o de base de datos.' },
                    { q: 'Mi sistema manda los datos en otro formato, ¿sirve?', a: 'El webhook entrante recibe el formato estándar que usan Zapier, Make y la mayoría de las plataformas. Toca **Escuchar datos de prueba** y mira qué llega: si aparece cada dato con su valor, está todo bien.' },
                    { q: '¿Necesito una automatización activa para escuchar?', a: 'Para ver las capturas de prueba basta con guardarla; para que las acciones corran de verdad, tiene que estar **Activa**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                    { label: 'API personalizada', article: 'integraciones-api-personalizada' },
                ],
            },
        ],
    },
];
