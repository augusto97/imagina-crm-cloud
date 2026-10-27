import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-marca',
        route: '/settings?s=marca',
        related: ['ajustes-empresa-dominio', 'ajustes-empresa-correo', 'ajustes-empresa-formato'],
        blocks: [
            {
                t: 'p',
                md: 'Cuando tu equipo abre la app, o cuando un cliente entra a su portal, lo primero que debería ver es **tu empresa**: tu nombre, tus colores y tu logo. Todo eso se configura en un solo lugar, **Ajustes → Marca**, y se aplica al instante en la app de tu equipo, en el portal de tus clientes, en las páginas públicas (formularios, agenda, listas compartidas) y en los correos de acceso que reciben tus clientes.\n\nEsta sección la ve y la cambia quien tiene el rol **Admin**. El resto del equipo simplemente ve el resultado.',
            },
            {
                t: 'anim',
                key: 'empresa-branding',
                caption: 'Cambias el nombre, eliges el color y subes el logo: la barra lateral, los botones y el portal se tiñen con tu marca.',
            },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes** y entra a **Marca** (en el grupo Empresa).',
                    'En **Nombre de la app** escribe cómo quieres que se llame la herramienta para tu gente: «Aurora CRM», «Portal Ferretería El Sol» o simplemente el nombre de tu empresa. Aparece arriba del menú, en la pestaña del navegador y en el portal.',
                    'En **Color primario** elige el color de tu marca. Puedes usar el selector o pegar el código, por ejemplo `#7A3E1D` para un café. Es el color de los botones, los enlaces y los acentos.',
                    'Si quieres, elige también un **Color de la barra lateral** (el menú de la izquierda). Si lo dejas vacío, la barra se tiñe sola con el color primario.',
                    'En **Logo** toca **Subir logo** y elige la imagen (mejor un PNG con fondo transparente, cuadrado o apaisado).',
                    'Toca **Guardar**. Verás el aviso «Marca guardada.» y la app cambia de inmediato, sin recargar.',
                ],
            },
            {
                t: 'demo',
                key: 'empresa-marca',
                caption: 'Ajustes → Marca: nombre, colores y logo de tu empresa.',
                fallback: 'empresa-branding',
            },
            {
                t: 'settings',
                title: 'Los ajustes de la marca',
                rows: [
                    {
                        name: 'Nombre de la app',
                        what: 'El nombre que ve tu equipo arriba del menú y en la pestaña del navegador, y tus clientes en el portal y en los correos de acceso.',
                        tip: 'Corto y reconocible. Si lo dejas vacío, se usa el nombre de tu empresa.',
                    },
                    {
                        name: 'Color primario',
                        what: 'Botones, enlaces, pestañas activas y acentos de toda la app, del portal y de las páginas públicas.',
                        tip: 'Elige un color con buen contraste: muy claro (amarillo pálido, gris claro) hace que el texto de los botones cueste leerse.',
                    },
                    {
                        name: 'Color de la barra lateral',
                        what: 'El fondo del menú de la izquierda. El texto se ajusta solo: claro sobre fondo oscuro, oscuro sobre fondo claro.',
                        tip: 'Muchas empresas usan acentos de color y una barra gris o carbón. Toca **Quitar** para que vuelva a seguir al color primario.',
                    },
                    {
                        name: 'Logo',
                        what: 'Se muestra en el menú, en la pantalla de entrada, en el portal, en los correos de acceso y como ícono de la pestaña del navegador.',
                        tip: 'Un logo cuadrado o casi cuadrado se ve mejor en el ícono de la pestaña.',
                    },
                    {
                        name: 'Restaurar valores por defecto',
                        what: 'Vuelve al nombre, color y logo de fábrica.',
                        tip: 'Útil si probaste combinaciones y quieres empezar de nuevo.',
                    },
                ],
            },
            { t: 'h', text: 'Dónde se ve tu marca' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Users',
                        title: 'App de tu equipo',
                        md: 'Menú, botones, pestaña del navegador y pantalla de entrada, en modo claro y oscuro (en oscuro el color se aclara un poco para que se lea bien).',
                        tone: 'blue',
                    },
                    {
                        icon: 'Globe',
                        title: 'Portal del cliente',
                        md: 'El cliente ve tu logo, tu nombre y tu color desde la pantalla de entrada. No aparece nada de la plataforma.',
                        tone: 'mint',
                    },
                    {
                        icon: 'Mail',
                        title: 'Correos de acceso',
                        md: 'El enlace para entrar al portal llega con tu logo, tu nombre en el asunto y el botón en tu color.',
                        tone: 'violet',
                    },
                    {
                        icon: 'Palette',
                        title: 'Páginas públicas',
                        md: 'Formularios, agenda de citas, listas y tableros públicos usan tu color y tu logo.',
                        tone: 'amber',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: Café Aurora',
                md: 'Café Aurora vende café de origen a cafeterías de Bogotá y Medellín. Pusieron **Nombre de la app**: «Aurora Pedidos», **Color primario** café tostado `#7A3E1D`, **Color de la barra lateral** carbón `#1F2937` y su logo de la taza. Ahora sus vendedores ven «Aurora Pedidos» en la pestaña del navegador y sus clientes entran a un portal que parece hecho a medida.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Cada persona elige su modo claro u oscuro',
                md: 'La marca es de la empresa, pero el modo claro u oscuro es de cada persona y de cada dispositivo. Tu color se adapta solo a los dos modos: no hace falta elegir dos colores.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo usar mi propio dominio, como crm.miempresa.com?',
                        a: 'Sí. Está en la misma sección, más abajo, en la tarjeta de dominio. Lo explicamos en «Tu propio dominio para el equipo y el portal».',
                    },
                    {
                        q: 'Cambié el logo pero sigo viendo el anterior.',
                        a: 'El navegador guarda el ícono de la pestaña un tiempo. Recarga la página; si sigue igual, cierra y vuelve a abrir la pestaña.',
                    },
                    {
                        q: '¿Los correos internos (avisos al equipo) también llevan mi marca?',
                        a: 'Los correos que salen con el correo de la empresa usan tu nombre como remitente. Para que salgan desde tu propia dirección, configura el correo de la empresa.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Ajustes → Marca', to: '/settings?s=marca' },
                    { label: 'Ver el recorrido de marca', tour: 'branding' },
                    { label: 'Conectar tu dominio', article: 'ajustes-empresa-dominio' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-dominio',
        route: '/settings?s=marca',
        related: ['ajustes-empresa-marca', 'ajustes-empresa-correo'],
        blocks: [
            {
                t: 'p',
                md: 'Tu empresa ya tiene una dirección propia sin configurar nada: un **subdominio incluido**, del estilo `tuempresa.` seguido del dominio de la plataforma. Lo ves en **Ajustes → Marca**, en la tarjeta **Subdominio incluido**, con un botón para copiarlo.\n\nSi quieres ir un paso más allá, puedes usar **tu propio dominio**: por ejemplo `crm.cafeaurora.co` para tu equipo y `clientes.cafeaurora.co` para el portal de tus clientes. Así nadie ve otra marca en la barra de direcciones, y los enlaces que la app manda por correo (accesos al portal, invitaciones) salen con tu dominio.',
            },
            {
                t: 'anim',
                key: 'empresa-domain',
                caption: 'Escribes el dominio, creas los registros en tu proveedor de DNS y la app verifica que es tuyo; después comprueba que ya responde.',
            },
            { t: 'h', text: 'Antes de empezar' },
            {
                t: 'p',
                md: 'Necesitas entrar al panel donde administras el dominio de tu empresa (GoDaddy, Hostinger, Cloudflare, Namecheap, el proveedor de tu hosting…). Ahí se crean dos «registros DNS»: uno que demuestra que el dominio es tuyo y otro que lo apunta a la plataforma. Si no manejas ese panel, pásale este artículo a la persona que te hizo la página web: es un trabajo de cinco minutos.',
            },
            { t: 'h', text: 'Conectar un dominio, paso a paso' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Marca** y baja hasta **Dominio personalizado** (para tu equipo) o **Dominio del portal de clientes** (para tus clientes). Son independientes: puedes usar uno, el otro o los dos.',
                    'Escribe el dominio completo, por ejemplo `crm.cafeaurora.co`, y toca **Guardar**. Queda **Pendiente**: hasta que verifiques que es tuyo, no se usa (así nadie puede tomar el dominio de otra empresa).',
                    'En **1. Verifica que el dominio es tuyo** la app te muestra un registro TXT con su **Nombre** y su **Valor**. Cópialos tal cual con el botón **Copiar** y créalo en tu panel de DNS.',
                    'Vuelve y toca **Verificar propiedad**. Si dice que todavía no aparece, espera unos minutos: los cambios de DNS a veces tardan en propagarse.',
                    'En **2. Apunta el dominio a la plataforma** crea el registro CNAME que te indica (el **Host** y el **Valor**) y toca **Comprobar apuntamiento**.',
                    'Cuando todo esté en **Configurado**, el administrador de la plataforma habilita el dominio en el servidor (le llega un aviso automático). Desde ese momento tu equipo y tus clientes entran por tu dominio.',
                ],
            },
            {
                t: 'settings',
                title: 'Qué significa cada estado',
                rows: [
                    {
                        name: 'Pendiente',
                        what: 'Pediste el dominio pero todavía no verificaste que es tuyo.',
                        tip: 'Crea el registro TXT y toca **Verificar propiedad**.',
                    },
                    {
                        name: 'Configurado',
                        what: 'El registro está bien y la app lo encontró.',
                        tip: 'Nada que hacer.',
                    },
                    {
                        name: 'Parcial',
                        what: 'Encontramos algo, pero no exactamente lo esperado (por ejemplo, apunta a otro lugar).',
                        tip: 'Compara con **Encontrado:** que se muestra debajo y corrige el valor.',
                    },
                    {
                        name: 'Falta',
                        what: 'El registro no existe todavía.',
                        tip: 'Créalo; si ya lo creaste, espera unos minutos y vuelve a comprobar.',
                    },
                    {
                        name: 'Desconocido',
                        what: 'El DNS no respondió en ese momento.',
                        tip: 'Prueba de nuevo en un rato. No es un error de tu configuración.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Dominios raíz (sin «crm.» adelante)',
                md: 'Si quieres usar `cafeaurora.co` sin nada adelante, muchos proveedores no aceptan un CNAME en la raíz. En ese caso usa un registro A hacia la IP de la plataforma (o el «alias»/«ANAME» que ofrezca tu DNS). Lo más simple es usar un subdominio: `crm.`, `app.` o `clientes.`.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Mientras tanto, nada se rompe',
                md: 'Hasta que tu dominio responda con un certificado válido, los enlaces siguen saliendo por el subdominio incluido. La app sólo empieza a usar tu dominio cuando comprueba que de verdad funciona.',
            },
            {
                t: 'example',
                title: 'Ejemplo: Ferretería El Sol',
                md: 'Ferretería El Sol tiene su web en `ferreteriaelsol.com`. Conectó `equipo.ferreteriaelsol.com` para sus vendedores y `clientes.ferreteriaelsol.com` para el portal donde sus clientes mayoristas ven sus pedidos y facturas. Ahora el correo «Tu acceso al portal de Ferretería El Sol» trae un enlace con su propio dominio.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Tengo que pagar algo extra por el certificado de seguridad (el candado)?',
                        a: 'No. Una vez habilitado, el certificado se emite y se renueva solo.',
                    },
                    {
                        q: 'Cambié de opinión, ¿cómo quito el dominio?',
                        a: 'Toca **Quitar dominio** en la misma tarjeta. Tu equipo y tus clientes vuelven a entrar por el subdominio incluido; avísales antes.',
                    },
                    {
                        q: '¿Puedo usar el mismo dominio para el equipo y para el portal?',
                        a: 'No: tienen que ser distintos. Lo habitual es `crm.` para el equipo y `clientes.` para el portal.',
                    },
                    {
                        q: '¿Cuánto tarda?',
                        a: 'Crear los registros toma minutos. La propagación del DNS suele ser rápida, aunque a veces tarda unas horas. Después, la habilitación en el servidor depende del administrador de la plataforma.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Ajustes → Marca', to: '/settings?s=marca' },
                    { label: 'Ajustar tu marca', article: 'ajustes-empresa-marca' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-correo',
        route: '/settings?s=correo',
        related: ['ajustes-empresa-plan', 'ajustes-empresa-problemas', 'ajustes-empresa-dominio'],
        blocks: [
            {
                t: 'p',
                md: 'La app manda correos en nombre de tu empresa todo el tiempo: los avisos de tus automatizaciones («Tu pedido salió a ruta»), los enlaces para que tus clientes entren al portal, los recordatorios de citas y las respuestas de la mesa de ayuda. En **Ajustes → Correo** decides **por dónde salen**. Hay tres formas y sólo una está activa a la vez.',
            },
            {
                t: 'anim',
                key: 'empresa-mail',
                caption: 'Eliges una de las tres formas de envío; la que está activa se marca «En uso».',
            },
            { t: 'h', text: 'Las tres formas de enviar' },
            {
                t: 'settings',
                title: 'Forma de envío',
                rows: [
                    {
                        name: 'Correo de la plataforma',
                        what: 'Listo sin configurar nada. Los correos salen por el servidor de la plataforma, con su dirección de remitente y tu nombre visible.',
                        tip: 'Perfecto para empezar. Consume la **cuota mensual de correos** de tu plan y las respuestas de tus clientes llegan a tu dirección (va como «responder a»).',
                    },
                    {
                        name: 'Tu cuenta de Google o Microsoft',
                        what: 'Los correos salen desde tu Gmail, Google Workspace u Outlook, con una conexión de **Integraciones**. Sin servidores ni contraseñas. **Recomendado.**',
                        tip: 'No consume la cuota del plan y quedan en «Enviados» de esa cuenta. Usa una casilla compartida (notificaciones@tuempresa.com), no la personal de alguien que mañana puede irse.',
                    },
                    {
                        name: 'Tu servidor SMTP',
                        what: 'Para Brevo, Amazon SES, Mailgun o el correo de tu hosting. Llenas **Host**, **Puerto**, **Usuario**, **Contraseña** y **Remitente (From)**.',
                        tip: 'La mejor opción si mandas muchos correos: no tiene cuota del plan y tú controlas la reputación del remitente.',
                    },
                ],
            },
            {
                t: 'demo',
                key: 'empresa-correo',
                caption: 'Ajustes → Correo: las tres formas de envío.',
                fallback: 'empresa-mail',
            },
            { t: 'h', text: 'Usar tu cuenta de Gmail u Outlook' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Correo**, en la opción **Tu cuenta de Google o Microsoft**, toca **Conectar Gmail** o **Conectar Outlook**. Te lleva a Integraciones.',
                    'Autoriza la cuenta como conexión **del equipo** (una conexión privada no sirve para los correos de toda la empresa).',
                    'Vuelve a **Ajustes → Correo**, marca la cuenta en **Elige con qué cuenta salen los correos** y confirma.',
                    'Verás **Enviando desde esta cuenta** y una barra **Enviados hoy desde la app** contra el límite diario aproximado de esa cuenta.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Los límites de Google y Microsoft',
                md: 'Cada proveedor limita cuántos correos manda una cuenta por día: unos **500** en Gmail personal, **2.000** en Google Workspace, hasta **5.000** en Outlook.com y **10.000 destinatarios** en Microsoft 365. Si te pasas, el proveedor bloquea el envío hasta 24 horas. La app te muestra el límite antes de elegir. No es una herramienta para campañas masivas: para eso usa un servidor SMTP de envío masivo.',
            },
            { t: 'h', text: 'Configurar tu servidor SMTP' },
            {
                t: 'steps',
                items: [
                    'Elige **Tu servidor SMTP** y completa **Host** (por ejemplo `smtp-relay.brevo.com`), **Puerto**, **Usuario**, **Contraseña** y **Remitente (From)**.',
                    'La casilla **Conexión segura (SSL/TLS, puerto 465)** se ajusta sola al puerto: encendida con 465, apagada con 587 o 2525. Si las descasas a mano, la app te avisa.',
                    'Toca **Guardar** y después **Probar envío**: te llega un correo de prueba.',
                    'Si falla, toca **Diagnosticar conexión**: prueba desde el servidor los puertos de correo y te dice qué pasa (el host no existe, el puerto está cerrado, la seguridad no corresponde al puerto…) con un consejo para cada caso.',
                    'Abre **Registros DNS (SPF / DKIM / DMARC)**: te muestra los registros exactos que conviene crear en tu dominio y los verifica en vivo.',
                ],
            },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'ShieldCheck',
                        title: 'SPF',
                        md: 'Le dice al mundo qué servidores pueden mandar correo con tu dominio. Sin él, tus correos caen en spam.',
                        tone: 'mint',
                    },
                    {
                        icon: 'Key',
                        title: 'DKIM',
                        md: 'Una firma que demuestra que el correo no se alteró. La clave la genera tu proveedor de correo.',
                        tone: 'blue',
                    },
                    {
                        icon: 'Lock',
                        title: 'DMARC',
                        md: 'Qué hacer con los correos que no pasan SPF o DKIM. La app sugiere uno de arranque que no bloquea nada.',
                        tone: 'violet',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: Clínica Norte',
                md: 'Clínica Norte manda unos 300 recordatorios de citas por semana. Empezó con el correo de la plataforma, pero quería que los pacientes vieran `citas@clinicanorte.co` como remitente. Conectó la cuenta de Google Workspace `citas@clinicanorte.co` como conexión del equipo y la eligió en **Ajustes → Correo**. Ahora los recordatorios salen de esa casilla, quedan en «Enviados» y las respuestas de los pacientes llegan ahí mismo.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Los correos de cuenta siempre salen por la plataforma',
                md: 'La verificación de correo, la recuperación de contraseña y las invitaciones a tu equipo no son de tu empresa sino de cada cuenta, así que salen siempre por el correo de la plataforma, sin importar lo que elijas aquí. Tampoco consumen tu cuota.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: 'Un cliente dice que no le llegó el correo.',
                        a: 'Pídele que revise spam. Si usas tu propio servidor, revisa los **Registros DNS (SPF / DKIM / DMARC)** en esta sección. Si el problema es de configuración, aparece en **Ajustes → Problemas** y te avisamos en la campana.',
                    },
                    {
                        q: '¿Qué pasa si se acaba la cuota mensual de correos?',
                        a: 'Con el correo de la plataforma, los correos que excedan la cuota no salen hasta el mes siguiente y queda un aviso. Con tu cuenta de Google o Microsoft o tu servidor SMTP no hay cuota del plan.',
                    },
                    {
                        q: 'Guardé el SMTP y dice «Connection timeout».',
                        a: 'Casi siempre es el puerto. Toca **Diagnosticar conexión**: si ningún puerto responde, el proveedor del servidor bloquea el correo saliente y hay que pedir el desbloqueo o usar el puerto 2525.',
                    },
                    {
                        q: '¿Puedo volver al correo de la plataforma?',
                        a: 'Sí, en cualquier momento, desde la misma pantalla. Tu configuración de SMTP queda guardada por si quieres volver a usarla.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Ajustes → Correo', to: '/settings?s=correo' },
                    { label: 'Ver tu cuota de correos', article: 'ajustes-empresa-plan' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-formato',
        route: '/settings?s=formato',
        related: ['ajustes-empresa-marca', 'ajustes-empresa-correo'],
        blocks: [
            {
                t: 'p',
                md: 'En Colombia escribimos un millón y medio como `1.500.000` y el 31 de diciembre como `31/12/2026`. En Estados Unidos es `1,500,000` y `12/31/2026`. Si la app mostrara los números al revés de como los lee tu equipo, cada cifra sería una duda. En **Ajustes → Formato regional** eliges cómo se ven los números, las fechas y la hora en **toda** la empresa: tablas, fichas, tableros, PDF, correos y el portal del cliente.',
            },
            {
                t: 'anim',
                key: 'empresa-format',
                caption: 'Al cambiar el formato, la vista previa se actualiza en vivo con la fecha de hoy, la hora actual y un número de ejemplo.',
            },
            { t: 'h', text: 'Cómo configurarlo' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Formato regional** (lo cambia un admin).',
                    'En **Números** elige `1.234.567,89 — punto para miles, coma decimal` (lo habitual en Colombia y la mayor parte de Latinoamérica), o el que usen en tu país.',
                    'En **Fecha** elige `DD/MM/AAAA (31/12/2026)` para el formato latino.',
                    'En **Hora** elige `24 horas (14:30)` o `12 horas (2:30 p. m.)`.',
                    'En **Zona horaria** busca tu país o ciudad, o toca **Usar la de este equipo**.',
                    'Mira la **Vista previa · ahora en …**: muestra la fecha de hoy y la hora actual en esa zona. Si se ve bien, toca **Guardar**.',
                ],
            },
            {
                t: 'demo',
                key: 'empresa-formato',
                caption: 'Ajustes → Formato regional, con la vista previa en vivo.',
                fallback: 'empresa-format',
            },
            {
                t: 'settings',
                title: 'Qué cambia cada ajuste',
                rows: [
                    {
                        name: 'Números',
                        what: 'Separador de miles y decimal en montos, cantidades, totales del pie, tableros, PDF y exportaciones a Excel.',
                        tip: 'También manda al **leer**: si escribes «12.500» en una celda de moneda, se entiende como doce mil quinientos.',
                    },
                    {
                        name: 'Fecha',
                        what: 'Cómo se muestran y se escriben las fechas en celdas, fichas, filtros, calendario y documentos.',
                        tip: 'Con DD/MM/AAAA, al escribir «05/03/2026» la app entiende 5 de marzo.',
                    },
                    {
                        name: 'Hora',
                        what: '24 horas o 12 horas con «a. m.» y «p. m.».',
                        tip: 'Solo cambia cómo se ve: la hora guardada es la misma.',
                    },
                    {
                        name: 'Zona horaria',
                        what: 'A qué hora corren las automatizaciones programadas, cuándo «vence» una fecha, qué es «hoy» en los filtros y los recordatorios.',
                        tip: 'Es lo más importante de esta pantalla: una automatización «todos los días a las 8:00» corre a las 8:00 de esta zona.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'La zona horaria cambia cuándo corren las cosas',
                md: 'Si tu empresa queda sin zona horaria, todo lo programado corre en hora universal (UTC): un recordatorio de las 8:00 llegaría a las 3:00 de la madrugada en Colombia. La primera vez que un admin entra, la app le propone la zona de su navegador; revisa que sea la correcta.',
            },
            {
                t: 'example',
                title: 'Ejemplo: una empresa con sede en Lima y vendedores en Bogotá',
                md: 'La empresa es de Perú, así que la zona es **Lima**. Bogotá tiene la misma hora, así que no hay diferencia. Pero si un vendedor viaja a Madrid, sus registros y vencimientos siguen calculándose en la hora de Lima, y la app le muestra un aviso cuando su equipo está en otra zona para que no se confunda en el calendario.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Cambiar el formato modifica mis datos?',
                        a: 'No. Sólo cambia cómo se muestran. Un monto guardado sigue siendo el mismo número.',
                    },
                    {
                        q: '¿Cada persona puede tener su propio formato?',
                        a: 'No: es uno por empresa, para que todos lean las cifras igual. Lo que sí es personal es el modo claro u oscuro.',
                    },
                    {
                        q: 'Cambié la zona horaria, ¿qué pasa con mis automatizaciones programadas?',
                        a: 'Se reprograman solas a la nueva zona, salvo las que tienen una zona propia elegida en su horario.',
                    },
                ],
            },
            { t: 'h', text: 'Dónde se nota' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Table',
                        title: 'Tablas y fichas',
                        md: 'Montos como «$ 1.250.000», fechas como «31/12/2026» y horas como «2:30 p. m.». Al escribir en una celda, la app lee en el mismo formato.',
                        tone: 'blue',
                    },
                    {
                        icon: 'BarChart3',
                        title: 'Tableros y PDF',
                        md: 'Las cifras de los indicadores, los ejes de los gráficos y los totales de las cotizaciones salen con tus separadores.',
                        tone: 'violet',
                    },
                    {
                        icon: 'Clock',
                        title: 'Automatizaciones',
                        md: 'Las programadas corren a la hora de tu zona, y «vence hoy» se calcula con la medianoche de tu país.',
                        tone: 'amber',
                    },
                    {
                        icon: 'Download',
                        title: 'Exportar e importar',
                        md: 'El Excel sale con fechas y números reales, y al importar se leen los números como los escribe tu equipo.',
                        tone: 'mint',
                    },
                ],
            },
            {
                t: 'actions',
                items: [{ label: 'Abrir Formato regional', to: '/settings?s=formato' }],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-almacenamiento',
        route: '/settings?s=almacenamiento',
        related: ['ajustes-empresa-plan', 'ajustes-empresa-problemas'],
        blocks: [
            {
                t: 'p',
                md: 'Los adjuntos de tus registros (facturas escaneadas, fotos de productos, contratos firmados), los logos, las imágenes de los correos y los PDF que guardas ocupan espacio. Por defecto viven en el **servidor de la plataforma** y cuentan para el espacio de tu plan. Si guardas mucho, puedes llevarlos a **tu propio almacenamiento**: el Google Drive de la empresa o un servicio compatible con S3 (Amazon S3, Backblaze B2, Cloudflare R2, Wasabi, DigitalOcean Spaces). Ahí no cuentan para el plan.\n\nTodo se maneja en **Ajustes → Almacenamiento** y lo cambia un admin.',
            },
            {
                t: 'anim',
                key: 'empresa-storage',
                caption: 'Eliges tu almacenamiento y mueves los archivos: el espacio del plan se libera y los enlaces que ya compartiste siguen funcionando.',
            },
            {
                t: 'settings',
                title: 'Dónde guardar',
                rows: [
                    {
                        name: 'Servidor de la plataforma',
                        what: 'Listo sin configurar nada. Cuenta para el espacio de tu plan.',
                        tip: 'Ideal mientras tus archivos entran holgados en el plan.',
                    },
                    {
                        name: 'Google Drive',
                        what: 'Los archivos van a una carpeta del Drive de tu empresa, con su nombre real. La app sólo ve lo que ella misma crea ahí.',
                        tip: 'Lo más simple: 15 GB gratis por cuenta (compartidos con Gmail) y más con Google Workspace.',
                    },
                    {
                        name: 'Almacenamiento S3',
                        what: 'Un «bucket» en Amazon S3, Backblaze B2, Cloudflare R2, Wasabi o similar. Los archivos se descargan directo de ahí, con enlaces temporales.',
                        tip: 'Para mucho volumen. Backblaze B2 y Cloudflare R2 son los más económicos; R2 no cobra la descarga.',
                    },
                ],
            },
            { t: 'h', text: 'Pasar a tu propio almacenamiento' },
            {
                t: 'steps',
                items: [
                    'Conecta el almacenamiento una vez en **Ajustes → Integraciones** como conexión **del equipo**: «Google Drive» o «Almacenamiento S3». Al conectar, la app prueba subir, leer y borrar un archivo chiquito; si algo falla, te dice qué.',
                    'Abre **Ajustes → Almacenamiento** y toca **Cambiar de almacenamiento**.',
                    'Elige la conexión y toca **Usar este almacenamiento**. Lo que se suba desde ahora va ahí.',
                    'Lo que ya estaba guardado sigue donde estaba. Para llevarlo, toca **Mover aquí los archivos que ya tienes** y sigue el avance: se copian a tu almacenamiento y se borran del servidor.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Los enlaces no se rompen',
                md: 'Cada archivo recuerda dónde quedó guardado. Si mueves los archivos o cambias de almacenamiento, los adjuntos de los registros, los logos y los enlaces que ya compartiste siguen funcionando.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Antes de desconectar tu almacenamiento',
                md: 'No se puede desconectar un almacenamiento que todavía tiene archivos, ni el que está en uso. Primero vuelve a **Guardar en el servidor** y toca **Traer los archivos que quedaron en tu almacenamiento** (entran mientras haya espacio en tu plan). Así no queda ningún adjunto huérfano.',
            },
            {
                t: 'example',
                title: 'Ejemplo: Inmobiliaria Los Andes',
                md: 'La inmobiliaria sube 20 fotos por inmueble y en tres meses llegó al límite de almacenamiento de su plan. Conectó un bucket de Backblaze B2 en Integraciones, lo eligió en **Ajustes → Almacenamiento** y tocó **Mover aquí los archivos que ya tienes**. En una tarde movió 8 GB, la barra de **Almacenamiento** del plan volvió casi a cero y paga unos pocos dólares al mes a su proveedor.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Qué pasa si mi Drive o mi bucket deja de funcionar?',
                        a: 'Las subidas fallan con el motivo, en vez de guardarse en otro lado sin avisar, y se abre un aviso en **Ajustes → Problemas**. Reconecta la integración y todo vuelve a funcionar.',
                    },
                    {
                        q: '¿Mis clientes del portal pueden descargar archivos guardados en mi Drive?',
                        a: 'Sí. La app les da un enlace seguro que pasa por ella; no tienen que tener acceso a tu Drive.',
                    },
                    {
                        q: '¿Puedo cambiar de bucket?',
                        a: 'Sí: conecta el nuevo, elígelo y mueve los archivos. Los del anterior se pueden traer igual.',
                    },
                ],
            },
            {
                t: 'settings',
                title: 'Botones de Ajustes → Almacenamiento',
                rows: [
                    {
                        name: 'Cambiar de almacenamiento',
                        what: 'Abre el selector **Dónde guardar** con las opciones disponibles.',
                        tip: 'Sólo aparecen las conexiones del equipo que pasaron la prueba.',
                    },
                    {
                        name: 'Mover aquí los archivos que ya tienes',
                        what: 'Copia lo que estaba en el servidor (o en el almacenamiento anterior) al elegido y lo borra del origen.',
                        tip: 'Puedes seguir trabajando mientras se mueve.',
                    },
                    {
                        name: 'Guardar en el servidor',
                        what: 'Vuelve a usar el servidor de la plataforma para lo que se suba desde ahora.',
                        tip: 'Lo ya guardado en tu almacenamiento sigue ahí y se sigue viendo.',
                    },
                    {
                        name: 'Traer los archivos que quedaron en tu almacenamiento',
                        what: 'Copia de vuelta al servidor lo que está en tu Drive o bucket.',
                        tip: 'Necesario antes de desconectar la integración.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    {
                        label: 'Abrir Ajustes → Almacenamiento',
                        to: '/settings?s=almacenamiento',
                    },
                    {
                        label: 'Ver el espacio de tu plan',
                        article: 'ajustes-empresa-plan',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-datos-personales',
        route: '/settings?s=privacidad',
        related: ['ajustes-empresa-problemas', 'ajustes-empresa-marca'],
        blocks: [
            {
                t: 'p',
                md: 'En Colombia, la **Ley 1581 de 2012** exige pedir una **autorización previa, expresa e informada** antes de recoger datos personales: nombre, cédula, teléfono, correo. Y si un día te la piden, tienes que poder demostrar que la tenías. La app resuelve las dos cosas desde **Ajustes → Datos personales**: armas el texto de tu empresa una vez, se pide con una casilla obligatoria en tus formularios públicos y en el portal del cliente, y cada aceptación queda guardada como evidencia.',
            },
            {
                t: 'anim',
                key: 'empresa-consent',
                caption:
                    'La persona marca la casilla de autorización en el formulario y la app guarda quién, cuándo, desde dónde y qué versión del texto aceptó.',
            },
            { t: 'h', text: 'Configurar la autorización' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Datos personales** (lo configura un admin).',
                    'En **Responsable del tratamiento** completa **Nombre o razón social**, **NIT o documento**, **Dirección**, **Ciudad**, **Correo para ejercer los derechos** y **Teléfono**. La ley exige que el titular sepa a quién y cómo contactar.',
                    'Agrega el **Enlace a tu política de tratamiento de datos** (debe empezar con `https://`).',
                    'En **Finalidades del tratamiento** escribe para qué usas los datos. Sé específico: la autorización sólo cubre lo que dice ahí. Puedes tocar **Usar las sugeridas** para arrancar.',
                    'Revisa el **Texto de la autorización**. Viene con una plantilla sugerida; las variables (como el nombre de tu empresa) se completan solas. Mira la **Vista previa: así lo ve quien responde**.',
                    'Prende **Pedir la autorización** y, si quieres, **Pedirla también en el portal del cliente**. Toca **Guardar cambios**.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Es un punto de partida',
                md: 'La plantilla sugerida sigue la Ley 1581 de 2012 y el Decreto 1377 de 2013, pero cada empresa tiene sus finalidades y su política. **Conviene que la revise tu abogado** antes de usarla.',
            },
            {
                t: 'settings',
                title: 'Dónde se pide y qué se guarda',
                rows: [
                    {
                        name: 'Formularios públicos',
                        what: 'Una casilla obligatoria con «Ver la autorización completa». Sin marcarla, el formulario no se envía.',
                        tip: 'Cada formulario la puede apagar en su constructor, por ejemplo si no recoge datos personales.',
                    },
                    {
                        name: 'Portal del cliente',
                        what: 'Se pide la primera vez que el cliente entra y cada vez que cambias el texto. Sin aceptarla no puede seguir usando el portal.',
                        tip: 'Útil si tu portal muestra o deja editar datos personales.',
                    },
                    {
                        name: 'Versiones del texto',
                        what: 'Cada vez que cambias el texto se crea una versión numerada. Cada autorización guarda la versión que la persona aceptó.',
                        tip: 'Si cambias el texto, las autorizaciones viejas siguen siendo válidas con su versión.',
                    },
                    {
                        name: 'Autorizaciones registradas',
                        what: 'La evidencia: quién, desde dónde, qué versión, cuándo, desde qué IP y navegador, y si la retiró.',
                        tip: 'Filtra por estado, origen o fechas y toca **Descargar CSV** si te la piden.',
                    },
                ],
            },
            { t: 'h', text: 'Cuando alguien retira su autorización' },
            {
                t: 'p',
                md: 'El titular puede retirarla en cualquier momento con el enlace que le llega en el correo de confirmación, o desde **Mis datos personales** en su portal. Si te lo pide por otro canal (un correo, una llamada, en persona), búscalo en **Autorizaciones registradas** y toca **Registrar retiro**: queda con tu nombre y la fecha. Los admins reciben un aviso en la campana.\n\nRetirar la autorización **no borra los datos** del registro: la ley te da un plazo y la decisión de qué hacer es de tu empresa. La ficha del registro muestra la línea en rojo para que nadie siga usando esos datos.',
            },
            {
                t: 'example',
                title: 'Ejemplo: Colegio Andino',
                md: 'El Colegio Andino recibe inscripciones por un formulario público con datos de padres y estudiantes. Configuró la autorización con su NIT, el correo `habeasdata@colegioandino.edu.co` y tres finalidades: proceso de admisión, comunicaciones académicas y facturación. Cuando una supervisora de la Secretaría de Educación pidió la evidencia, descargó el CSV con cada aceptación, su fecha y la versión del texto.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Esto aplica fuera de Colombia?',
                        a: 'La plantilla está pensada para Colombia, pero el mecanismo (texto, casilla, evidencia y retiro) sirve para leyes parecidas de otros países. Ajusta el texto con tu asesor.',
                    },
                    {
                        q: '¿La ficha del registro muestra la IP de la persona?',
                        a: 'No: la ficha muestra sólo la fecha, la versión y el origen. La IP y el navegador están en la evidencia de Ajustes, que sólo ve un admin.',
                    },
                    {
                        q: 'Dice «Incompleta», ¿qué falta?',
                        a: 'Debajo aparece **Para activarla falta:** con lo que hay que completar, normalmente un dato del responsable o el texto.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    {
                        label: 'Abrir Ajustes → Datos personales',
                        to: '/settings?s=privacidad',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-problemas',
        route: '/settings?s=problemas',
        related: ['ajustes-empresa-correo', 'ajustes-empresa-papelera'],
        blocks: [
            {
                t: 'p',
                md: 'Muchas cosas en la app trabajan solas, sin que nadie las mire: automatizaciones que mandan correos de noche, conexiones con tu tienda o tu Gmail, sincronizaciones con otros sistemas. Cuando una de ellas deja de funcionar, lo peor es enterarse una semana después. Por eso existe **Ajustes → Problemas**: apenas algo falla, te avisamos en la campana y por correo, y queda anotado ahí con qué falló, cuántas veces y cómo arreglarlo.\n\nY para saber **quién cambió algo** de la configuración, está **Ajustes → Registro de actividad**.',
            },
            {
                t: 'anim',
                key: 'empresa-problems',
                caption:
                    'Una automatización falla: aparece la pastilla «1 problema» arriba, el aviso en la campana y la fila en Problemas. Al arreglarla, se cierra sola.',
            },
            { t: 'h', text: 'Qué cuenta como un problema' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Zap',
                        title: 'Automatizaciones',
                        md: 'Una corrida que falló: un webhook que respondió con error, un correo sin destinatario, un campo que ya no existe.',
                        tone: 'amber',
                    },
                    {
                        icon: 'Mail',
                        title: 'Correo de la empresa',
                        md: 'La contraseña del SMTP ya no sirve, la cuenta de Gmail se desconectó o se acabó la cuota del mes.',
                        tone: 'rose',
                    },
                    {
                        icon: 'Plug',
                        title: 'Conectores',
                        md: 'Una integración cuya autorización venció o fue revocada, o una clave que ya no es válida.',
                        tone: 'violet',
                    },
                    {
                        icon: 'Repeat',
                        title: 'Sincronizaciones',
                        md: 'La tienda o la base de datos externa no responde, o rechazó cambios que hiciste en la app.',
                        tone: 'blue',
                    },
                ],
            },
            { t: 'h', text: 'Cómo se maneja' },
            {
                t: 'steps',
                items: [
                    'Cuando algo falla, aparece una pastilla roja **N problemas** en la barra superior y un aviso en la campana. A los admins (y a quien creó lo que falla) también les llega un correo.',
                    'Toca la pastilla o abre **Ajustes → Problemas**. Cada fila dice qué falló, el último error y **Falló N veces · la primera … · la última …**.',
                    'Toca **Ir a arreglarlo**: te lleva a la automatización, la conexión o el ajuste que hay que revisar.',
                    'Cuando vuelva a funcionar, el problema **se cierra solo** y pasa a **Resueltos**. Si lo arreglaste por otro lado, toca **Ya lo arreglé**.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'No te llena la bandeja',
                md: 'Las fallas repetidas de lo mismo se juntan en un solo problema que va sumando veces. Si sigue abierto, te recordamos como mucho una vez por día con «Sigue fallando…».',
            },
            { t: 'h', text: 'El registro de actividad' },
            {
                t: 'p',
                md: '**Ajustes → Registro de actividad** (sólo para admins) muestra quién cambió la configuración de la empresa o borró datos: quién creó o borró una lista, cambió permisos, publicó un formulario, invitó o quitó a alguien, cambió el plan, el correo o el dominio, importó datos o vació la papelera. Las acciones destructivas se marcan como **destructiva**. Los cambios de cada registro (quién movió una oportunidad de etapa) se ven en la actividad de su propia ficha.',
            },
            {
                t: 'example',
                title: 'Ejemplo: el webhook del lunes',
                md: 'Una distribuidora tiene una automatización que avisa a su sistema de despachos cada vez que se aprueba un pedido. El lunes, el sistema de despachos cambió de dirección y empezó a responder con error. A los cinco minutos apareció «1 problema» arriba y le llegó un correo al admin. Tocó **Ir a arreglarlo**, actualizó la dirección en la automatización y, con el siguiente pedido, el problema se cerró solo.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Quién ve los problemas?',
                        a: 'Los admins ven todos. El resto ve sólo los de lo que creó (por ejemplo, sus automatizaciones).',
                    },
                    {
                        q: '¿Puedo apagar el correo de los problemas?',
                        a: 'Sí, cada persona lo decide en **Ajustes → Avisos**, en «Algo dejó de funcionar». La campana siempre lo muestra.',
                    },
                    {
                        q: '¿El registro de actividad se puede borrar?',
                        a: 'No. Es una bitácora que sólo crece, justamente para que sirva de evidencia.',
                    },
                ],
            },
            {
                t: 'settings',
                title: 'Lo que ves en cada problema',
                rows: [
                    {
                        name: 'Qué falló',
                        what: 'El nombre de la automatización, la conexión o el ajuste, y el último error en lenguaje claro.',
                        tip: 'Si el error menciona un campo o un correo, revisa eso primero.',
                    },
                    {
                        name: 'Falló N veces',
                        what: 'Cuántas veces pasó, la primera y la última.',
                        tip: 'Muchas veces seguidas suele ser configuración; una sola, algo pasajero.',
                    },
                    {
                        name: 'Ir a arreglarlo',
                        what: 'Te lleva directo a lo que hay que revisar.',
                        tip: 'Arregla y deja que se cierre solo con el siguiente intento.',
                    },
                    {
                        name: 'Ya lo arreglé',
                        what: 'Lo cierra a mano.',
                        tip: 'Si vuelve a fallar, se abre de nuevo.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Problemas', to: '/settings?s=problemas' },
                    { label: 'Abrir Registro de actividad', to: '/settings?s=auditoria' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-plan',
        route: '/settings?s=plan',
        related: ['ajustes-empresa-almacenamiento', 'ajustes-empresa-correo', 'ajustes-empresa-papelera'],
        blocks: [
            {
                t: 'p',
                md: 'Tu plan define cuánto puedes guardar y usar: registros, usuarios, invitados, automatizaciones, espacio de archivos, correos al mes y pedidos al asistente. En **Ajustes → Plan y uso** ves en qué plan estás y cuánto llevas, y en **Ajustes → Suscripción** pagas o cambias de plan. Las dos secciones son para admins.',
            },
            {
                t: 'anim',
                key: 'empresa-plan',
                caption:
                    'Cada pago extiende la fecha de «Pagado hasta». Si vence, hay unos días de gracia y después la empresa pasa a solo lectura, sin perder nada.',
            },
            { t: 'h', text: 'Plan y uso' },
            {
                t: 'settings',
                title: 'Las barras de uso',
                rows: [
                    {
                        name: 'Registros',
                        what: 'Cuántos registros tienes en todas tus listas contra el límite del plan.',
                        tip: 'Lo que está en la papelera no cuenta.',
                    },
                    {
                        name: 'Usuarios',
                        what: 'Personas de tu equipo (incluidas las que tienen una invitación pendiente).',
                        tip: 'Los clientes del portal no ocupan usuario.',
                    },
                    {
                        name: 'Invitados',
                        what: 'Personas de afuera con las que compartiste una lista o un registro.',
                        tip: 'Tienen su propio límite, aparte de los usuarios.',
                    },
                    {
                        name: 'Automatizaciones',
                        what: 'Cuántas automatizaciones tienes creadas.',
                        tip: 'Si llegas al límite, pausa o borra las que ya no uses.',
                    },
                    {
                        name: 'Almacenamiento',
                        what: 'Espacio que ocupan tus archivos en el servidor de la plataforma.',
                        tip: 'Lo guardado en tu Drive o tu propio almacenamiento no cuenta.',
                    },
                    {
                        name: 'Correos este mes',
                        what: 'Correos enviados por el correo de la plataforma, contados por destinatario.',
                        tip: 'Con tu Gmail, Outlook o SMTP propio no hay cuota.',
                    },
                    {
                        name: 'Pedidos al asistente este mes',
                        what: 'Cuántas veces se usó el asistente de IA con la clave de la plataforma.',
                        tip: 'Con una clave propia de IA no hay cuota.',
                    },
                ],
            },
            {
                t: 'demo',
                key: 'empresa-plan',
                caption: 'Ajustes → Plan y uso: el plan actual y cuánto llevas usado.',
                fallback: 'empresa-plan',
            },
            { t: 'h', text: 'Pagar: por meses o con renovación automática' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Suscripción**. Arriba ves **Tu suscripción**: el plan y hasta cuándo está pagado («Pagado hasta el …, quedan N días»).',
                    'En **Pagar o cambiar de plan** elige el plan.',
                    'Elige la forma: **Pagar meses** (en **¿Cuántos meses?** eliges 1, 3, 6 o 12) o **Renovación automática** (un cobro mensual a tu tarjeta).',
                    'Toca el botón de pago. Con Mercado Pago puedes pagar con PSE, Nequi, tarjeta o efectivo; también puede estar PayPal según tu servidor.',
                    'Al volver, la app confirma el pago con el proveedor y extiende la fecha. Con PSE o efectivo puede tardar un rato.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Pagar antes no te hace perder días',
                md: 'Cada pago se suma desde donde termina lo que ya tenías pagado. Y la renovación automática arranca cuando vence lo pagado: nadie paga dos veces el mismo mes. En **Historial de pagos** ves cada pago con su medio y hasta cuándo dejó pagado.',
            },
            { t: 'h', text: 'Si un pago se atrasa' },
            {
                t: 'p',
                md: 'Unos días antes del vencimiento, al vencer y al pasar a solo lectura, los admins reciben un correo. Después de la fecha hay **5 días de gracia** en los que todo sigue igual. Si no se paga, la empresa pasa a **solo lectura**: puedes entrar, consultar y **exportar todo**, pero no crear ni cambiar nada, y las automatizaciones dejan de correr.\n\nTus datos **nunca se borran ni se secuestran** por un atraso: están intactos y al pagar se reactiva todo al instante. Incluso en solo lectura puedes pagar desde **Ajustes → Suscripción**.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Exportar siempre está disponible',
                md: 'Desde cada lista, **Exportar** descarga los registros en Excel o CSV, con lo que se ve en la vista. Funciona también en solo lectura, para que nunca dependas de pagar para tener tus datos.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Qué pasa si llego al límite de registros?',
                        a: 'Puedes seguir viendo y editando lo que tienes, pero no crear registros nuevos hasta que borres algunos o cambies de plan. La app te dice el motivo cuando pasa.',
                    },
                    {
                        q: '¿Cómo cancelo la renovación automática?',
                        a: 'En **Ajustes → Suscripción**, toca **Cancelar la renovación**. Lo ya pagado se conserva hasta su fecha.',
                    },
                    {
                        q: 'Mercado Pago dice que la renovación está en pausa.',
                        a: 'No pudo cobrar la tarjeta. Revisa el medio de pago en tu cuenta de Mercado Pago o paga por meses mientras tanto.',
                    },
                    {
                        q: '¿Me dan factura?',
                        a: 'El comprobante del pago te lo envía el proveedor (Mercado Pago o PayPal). Si necesitas factura, pídela al operador de tu plataforma.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Plan y uso', to: '/settings?s=plan' },
                    { label: 'Abrir Suscripción', to: '/settings?s=suscripcion' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'ajustes-empresa-papelera',
        route: '/settings?s=papelera',
        related: ['ajustes-empresa-problemas', 'ajustes-empresa-plan'],
        blocks: [
            {
                t: 'p',
                md: 'Borraste un cliente por error, o alguien eliminó una lista entera pensando que ya no servía. No pasa nada: lo que se borra en la app no desaparece de inmediato, va a la **papelera** y se queda ahí **30 días**. Durante ese tiempo vuelve tal cual, con un clic. Una lista vuelve con sus registros, campos, vistas y automatizaciones; un registro, con sus subtareas, vínculos, archivos y comentarios.',
            },
            {
                t: 'anim',
                key: 'empresa-trash',
                caption: 'Lo borrado aparece en la papelera con quién lo borró y cuántos días le quedan. «Restaurar» lo devuelve a su lugar.',
            },
            { t: 'h', text: 'Recuperar algo' },
            {
                t: 'steps',
                items: [
                    'Justo después de borrar, aparece el aviso **Se movió a la papelera** con un botón **Deshacer** durante unos segundos. Es lo más rápido.',
                    'Si ya pasó, abre **Ajustes → Papelera**. Todos los miembros del equipo pueden entrar.',
                    'Busca por nombre con **Buscar por nombre…** o filtra por tipo (registros, listas, campos, vistas, automatizaciones, tableros).',
                    'Cada fila dice **Lo borró … hace …** y cuánto le queda (**Quedan N días**). Toca **Restaurar**.',
                    'Listo: vuelve a su lista, con todo lo que tenía. Si otro elemento tomó su nombre mientras tanto, la app le agrega un sufijo y te avisa.',
                ],
            },
            {
                t: 'demo',
                key: 'empresa-papelera',
                caption: 'Ajustes → Papelera: buscar, ver quién lo borró y restaurar.',
                fallback: 'empresa-trash',
            },
            {
                t: 'settings',
                title: 'Quién puede hacer qué',
                rows: [
                    {
                        name: 'Restaurar',
                        what: 'Lo restaura quien lo borró o un admin.',
                        tip: 'Para un registro, además hay que poder ver esa fila según los permisos de la lista.',
                    },
                    {
                        name: 'Borrar para siempre',
                        what: 'Lo elimina sin vuelta atrás antes de los 30 días.',
                        tip: 'Úsalo con datos que de verdad no quieres conservar (por ejemplo, un registro duplicado con datos sensibles).',
                    },
                    {
                        name: 'Vaciar papelera',
                        what: 'Borra para siempre todo lo que hay en la papelera de la empresa, incluido lo que borraron otras personas.',
                        tip: 'Sólo admins. Queda en el Registro de actividad.',
                    },
                    {
                        name: 'Registros borrados de una lista',
                        what: 'En **Personalizar vista** de una lista hay un acceso directo a la papelera filtrada por esa lista.',
                        tip: 'Práctico cuando trabajas en una sola lista.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Mientras está en la papelera',
                md: 'Una automatización borrada no corre, un tablero borrado no se publica ni se envía por correo, y los registros borrados no cuentan para el límite de tu plan. Al restaurar, todo vuelve a funcionar; si restaurarlo superara un límite del plan, la automatización vuelve pausada.',
            },
            {
                t: 'example',
                title: 'Ejemplo: la lista de proveedores',
                md: 'Un auxiliar de Ferretería El Sol borró la lista «Proveedores 2025» creyendo que era una copia vieja. Al día siguiente el jefe de compras no la encontraba. El admin abrió **Ajustes → Papelera**, filtró por listas, vio «Proveedores 2025 · con 143 registros · Lo borró Julián hace 1 día» y tocó **Restaurar**. Volvió con sus registros, sus vistas y la automatización de órdenes de compra.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Qué pasa después de los 30 días?',
                        a: 'Se borra para siempre, de forma automática, incluidos sus archivos. Ya no se puede recuperar.',
                    },
                    {
                        q: '¿Los registros de la papelera aparecen en las búsquedas o en los tableros?',
                        a: 'No. Para el resto de la app es como si no existieran, hasta que se restauran.',
                    },
                    {
                        q: 'Restauré una lista pero falta un registro.',
                        a: 'Si ese registro se había borrado antes que la lista, está en la papelera por separado: restáuralo también.',
                    },
                ],
            },
            { t: 'h', text: 'Qué va a la papelera' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'List',
                        title: 'Listas',
                        md: 'Vuelven con sus registros, campos, vistas, automatizaciones y formularios.',
                        tone: 'blue',
                    },
                    {
                        icon: 'FileText',
                        title: 'Registros',
                        md: 'Vuelven con sus subtareas, vínculos, archivos, comentarios e historial.',
                        tone: 'mint',
                    },
                    {
                        icon: 'Columns3',
                        title: 'Campos',
                        md: 'Vuelven con los valores que tenían en cada registro.',
                        tone: 'violet',
                    },
                    {
                        icon: 'Zap',
                        title: 'Vistas, automatizaciones y tableros',
                        md: 'Vuelven tal cual; las automatizaciones se reprograman solas.',
                        tone: 'amber',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Deshacer al instante',
                md: 'El aviso **Se movió a la papelera** dura unos segundos con su botón **Deshacer**: si borraste algo sin querer, es lo más rápido. También sirve **Ctrl + Z** en la tabla justo después de borrar filas.',
            },
            {
                t: 'actions',
                items: [{ label: 'Abrir la papelera', to: '/settings?s=papelera' }],
            },
        ],
    },
];
