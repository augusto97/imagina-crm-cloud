import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-consola',
        route: '/platform?tab=tenants',
        related: ['plataforma-empresas', 'plataforma-copias', 'plataforma-actualizaciones-dominios'],
        blocks: [
            {
                t: 'p',
                md: 'Si operas tu propio servidor —le das la app a tus clientes, a las sedes de tu grupo o a tus franquicias—, la **consola de Plataforma** es tu tablero de control. Ahí está todo lo que vale para **todas** las empresas del servidor: quiénes son, qué plan tienen, cuánto cobran, por dónde salen los correos de cuenta, las copias de seguridad y las actualizaciones.\n\nSólo la ven los **superadmins** de la plataforma: las cuentas que figuran como operadores en la configuración del servidor. Para el resto de la gente la sección ni siquiera aparece, aunque sean admin de su empresa.',
            },
            {
                t: 'anim',
                key: 'plat-console',
                caption: 'Arriba, las cifras de toda la plataforma; debajo, una pestaña por tema.',
            },
            { t: 'h', text: 'Cómo llegar' },
            {
                t: 'steps',
                items: [
                    'En el riel de la izquierda toca **Plataforma** (sólo aparece si eres superadmin).',
                    'Arriba ves las cifras generales: **Empresas** (y las nuevas en 30 días), **Activas** (y en prueba), **Impagas** (en solo-lectura), **Usuarios** y **Registros** de toda la plataforma.',
                    'Debajo, elige la pestaña del tema que quieres manejar. El enlace guarda la pestaña, así que puedes marcarla en tu navegador.',
                ],
            },
            {
                t: 'demo',
                key: 'plat-consola',
                caption: 'La consola de Plataforma: cifras generales y pestañas.',
                fallback: 'plat-console',
            },
            {
                t: 'settings',
                title: 'Las pestañas de la consola',
                rows: [
                    {
                        name: 'Empresas',
                        what: 'Todas las empresas: alta, plan, estado, detalle, archivar y borrar.',
                        tip: 'Es la pestaña que más vas a usar.',
                    },
                    {
                        name: 'Usuarios',
                        what: 'Todas las cuentas de la plataforma, con sus empresas.',
                        tip: 'Para crear cuentas, reenviar invitaciones o desactivar a alguien.',
                    },
                    {
                        name: 'Planes / Cobros',
                        what: 'Límites y precios de cada plan, y la cuenta de Mercado Pago con la que cobras.',
                        tip: 'Un plan con precio se vende solo desde Ajustes de cada empresa.',
                    },
                    {
                        name: 'Auditoría',
                        what: 'Quién entró como quién para dar soporte, y cuándo.',
                        tip: 'Toda sesión de soporte queda registrada.',
                    },
                    {
                        name: 'Novedades / Ayuda',
                        what: 'Lo que las personas ven como «lo nuevo» y la configuración del centro de ayuda.',
                        tip: 'Ideal para avisar mantenimientos.',
                    },
                    {
                        name: 'Correo (SMTP) / Diagnóstico',
                        what: 'El correo de las cuentas (verificación, contraseñas, invitaciones) y el registro de correos y errores.',
                        tip: 'Lo primero a revisar si alguien dice «no me llega el correo».',
                    },
                    {
                        name: 'Dominios / Integraciones / Asistente IA',
                        what: 'Dominios propios de las empresas, las apps de Google, Microsoft y Slack, y la clave de IA.',
                        tip: 'Se configuran una vez para todas las empresas.',
                    },
                    {
                        name: 'Actualizaciones / Copias de seguridad / Migrar empresas',
                        what: 'Instalar versiones nuevas, copias completas del servidor y mover empresas entre servidores.',
                        tip: 'Antes de algo grande, haz una copia.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: '¿Por qué me pide volver a entrar?',
                md: 'La consola sólo funciona con una sesión que abriste **con tu contraseña**. Si entraste de otra forma (por ejemplo, con un enlace) o tu sesión es muy vieja, la app cierra la sesión y te pide entrar de nuevo. Es una protección: quien tiene la consola tiene las llaves de todo el servidor.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Un superadmin también es una persona normal',
                md: 'Ser superadmin no te da acceso a los datos de las empresas: sólo a la consola. Para trabajar en una empresa tienes que ser miembro (te puedes sumar desde **Usuarios → Editar → Agregar a una empresa**) o usar **Impersonar** en el detalle de la empresa para dar soporte, que queda registrado.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puede haber más de un superadmin?',
                        a: 'Sí, y conviene: si uno pierde el acceso, el otro puede ayudar. Se definen en la configuración del servidor.',
                    },
                    {
                        q: 'Me quedé sin ninguna empresa, ¿cómo llego a la consola?',
                        a: 'La pantalla «Tu cuenta no tiene ninguna empresa» te deja crearte una o sumarte como admin a una existente; desde ahí vuelves a la consola.',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: la revisión del lunes',
                md: 'Cada lunes, el operador abre la consola: mira en las cifras si hay **Impagas** nuevas, revisa en **Diagnóstico** que no haya correos con problemas, confirma en **Copias de seguridad** que la última copia subió al Drive y en **Actualizaciones** si hay una versión nueva para instalar en la noche. Diez minutos y el servidor queda en orden.',
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir la consola', to: '/platform?tab=tenants' },
                    { label: 'Manejar empresas', article: 'plataforma-empresas' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-empresas',
        route: '/platform?tab=tenants',
        related: ['plataforma-usuarios', 'plataforma-planes-cobros', 'plataforma-migrar'],
        blocks: [
            {
                t: 'p',
                md: 'Cada **empresa** es un espacio separado, con sus listas, su gente y sus datos: nadie de una empresa ve nada de otra. En **Plataforma → Empresas** las ves todas en una grilla con su admin, plan, estado, uso y fecha de alta, y desde ahí das de alta una nueva, cambias su plan o la suspendes por impago.',
            },
            {
                t: 'anim',
                key: 'plat-tenants',
                caption: 'Cambias el plan o el estado desde la misma fila; «Impaga» la pasa a solo lectura sin tocar sus datos.',
            },
            { t: 'h', text: 'Dar de alta una empresa con su admin' },
            {
                t: 'steps',
                items: [
                    'En **Empresas** toca **Nueva empresa**.',
                    'Escribe el nombre de la empresa (por ejemplo «Ferretería El Sol»), el **Email del admin** y el **Nombre del admin**.',
                    'Toca **Crear empresa**. Si el correo ya tenía cuenta, queda como admin de la nueva empresa; si no, se crea la cuenta y le llega una invitación para definir su contraseña.',
                    'La empresa aparece en la grilla. Desde ahí le asignas el plan.',
                ],
            },
            {
                t: 'demo',
                key: 'plat-empresas',
                caption: 'Plataforma → Empresas: buscar una empresa y ver su detalle.',
                fallback: 'plat-tenants',
            },
            {
                t: 'settings',
                title: 'Lo que manejas en cada empresa',
                rows: [
                    {
                        name: 'Plan',
                        what: 'Los límites que tiene (registros, usuarios, automatizaciones, espacio, correos, asistente).',
                        tip: 'Puedes asignar cualquier plan activo, incluso uno sin precio pensado sólo para clientes especiales.',
                    },
                    {
                        name: 'Estado',
                        what: '**En prueba**, **Activa**, **Impaga** o **Cancelada**. Impaga y Cancelada dejan la empresa en solo lectura.',
                        tip: 'Los datos nunca se secuestran: en solo lectura la empresa puede consultar y exportar todo.',
                    },
                    {
                        name: 'Detalle',
                        what: 'Sus miembros con su rol y su uso contra el límite del plan. Puedes invitar, cambiar roles, reenviar invitaciones y quitar personas.',
                        tip: 'Como operador puedes sumar personas aunque la empresa esté en el límite de usuarios.',
                    },
                    {
                        name: 'Impersonar',
                        what: 'En el detalle, junto a cada miembro: entras a la app como esa persona para ver exactamente lo que ve y ayudarla.',
                        tip: 'Queda en **Auditoría**, con inicio y fin. Al cerrar sesión vuelves a tu cuenta.',
                    },
                    {
                        name: 'Archivar / Desarchivar',
                        what: 'Saca la empresa de la vista y deja de funcionar, sin borrar nada.',
                        tip: 'Para clientes que se fueron pero podrían volver. **Ver archivadas** las muestra.',
                    },
                    {
                        name: 'Borrar empresa',
                        what: 'Borra la empresa y TODOS sus datos, incluidos sus archivos. Pide escribir el nombre para confirmar.',
                        tip: 'Irreversible. Antes, exporta la empresa desde **Migrar empresas** por si acaso.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'El cobro automático cambia el estado solo',
                md: 'Si cobras con Mercado Pago o PayPal, no hace falta cambiar el estado a mano: cada pago extiende el período pagado, y si vence (después de 5 días de gracia) la empresa pasa sola a solo lectura. El cambio manual queda para acuerdos especiales.',
            },
            {
                t: 'example',
                title: 'Ejemplo: un cliente que paga por transferencia',
                md: 'Una distribuidora de Barranquilla paga por transferencia cada trimestre. Cuando confirmas el pago, entras a **Empresas**, buscas «Distribuidora», y dejas el plan en **Pro** con estado **Activa**. Si un trimestre se atrasa, la pasas a **Impaga**: la empresa sigue viendo y exportando todo, pero no puede cambiar nada hasta que pague.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Las personas de la empresa saben cuando entro como ellas?',
                        a: 'Ven un aviso de que la sesión es de soporte, y la sesión figura como «soporte» en sus dispositivos conectados. Usa esta función sólo cuando te piden ayuda.',
                    },
                    {
                        q: '¿Qué pasa con el dominio propio de una empresa que borro?',
                        a: 'Se libera. Si estaba habilitado en el servidor, aparece en **Dominios → Para quitar del servidor**.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Buscar entre muchas empresas',
                md: 'La grilla se pagina y busca en el servidor: escribe en el buscador parte del nombre de la empresa, su identificador o el correo de su admin y aparece al instante, aunque tengas cientos de empresas.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo crear una empresa para hacer pruebas?',
                        a: 'Sí: créala con tu correo como admin, úsala de laboratorio y archívala cuando termines.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Empresas', to: '/platform?tab=tenants' },
                    { label: 'Ver la auditoría de soporte', to: '/platform?tab=audit' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-usuarios',
        route: '/platform?tab=users',
        related: ['plataforma-empresas', 'plataforma-correo-diagnostico'],
        blocks: [
            {
                t: 'p',
                md: 'Una **cuenta** es una persona; puede pertenecer a una o varias empresas, con un rol en cada una. En **Plataforma → Usuarios** ves todas las cuentas del servidor, en cuántas empresas está cada una y su estado (**Activa**, **Invitación pendiente**, **Desactivada** o **Superadmin**).',
            },
            {
                t: 'anim',
                key: 'plat-users',
                caption: 'Creas una cuenta, le llega la invitación y la ves «Invitación pendiente» hasta que define su contraseña.',
            },
            { t: 'h', text: 'Crear una cuenta y sumarla a una empresa' },
            {
                t: 'steps',
                items: [
                    'En **Usuarios** escribe el **Email** y el **Nombre** y toca **Crear e invitar**. Le llega un correo para definir su contraseña.',
                    'En su fila toca **Editar**. Ves sus empresas con el rol en cada una.',
                    'En **Agregar a una empresa** busca la empresa, elige el rol y confírmalo.',
                    'Para cambiar su rol en una empresa, usa el selector de esa fila; para sacarla, **Quitar**. Su cuenta y sus otras empresas no cambian.',
                ],
            },
            {
                t: 'settings',
                title: 'Acciones de cada cuenta',
                rows: [
                    {
                        name: 'Reenviar invitación',
                        what: 'Manda de nuevo el enlace para definir la contraseña.',
                        tip: 'Cuando alguien dice que nunca le llegó: revisa también **Diagnóstico**.',
                    },
                    {
                        name: 'Enviar reset de contraseña',
                        what: 'Le llega un enlace para crear una contraseña nueva.',
                        tip: 'Útil si la persona no encuentra la opción en la pantalla de entrada.',
                    },
                    {
                        name: 'Desactivar cuenta',
                        what: 'Bloquea la entrada y cierra al instante todas sus sesiones en todas las empresas.',
                        tip: 'Para alguien que se fue o una cuenta comprometida. No borra nada.',
                    },
                    {
                        name: 'Reactivar cuenta',
                        what: 'Devuelve el acceso a una cuenta desactivada.',
                        tip: 'Conserva sus empresas y roles.',
                    },
                    {
                        name: 'Borrar…',
                        what: 'Borra la cuenta de forma irreversible. Pide escribir el email.',
                        tip: 'Lo que escribió en las empresas queda como «Usuario eliminado».',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Los superadmins son especiales',
                md: 'No se puede desactivar a un superadmin, y los admins de las empresas no pueden invitarlo: un superadmin sólo se suma a una empresa desde esta consola. Así la cuenta del operador nunca queda en manos de un cliente.',
            },
            {
                t: 'example',
                title: 'Ejemplo: un contador que lleva tres empresas',
                md: 'Hernán es contador externo de tres clientes tuyos. Creas su cuenta una vez, y desde **Editar → Agregar a una empresa** lo sumas a las tres con rol **Lector**. Él entra con una sola contraseña y cambia de empresa desde el menú de su avatar.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo ver la contraseña de alguien?',
                        a: 'No. Nadie puede: sólo se puede mandar un enlace para que la persona cree una nueva.',
                    },
                    {
                        q: 'Una persona usa dos correos, ¿puedo unir sus cuentas?',
                        a: 'No. Son dos cuentas distintas. Lo práctico es quitar la que no usa de sus empresas y desactivarla.',
                    },
                ],
            },
            { t: 'h', text: 'Cuándo usar cada acción' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'UserPlus',
                        title: 'Alguien nuevo',
                        md: 'Créalo con **Crear e invitar** y súmalo a su empresa desde **Editar**. Si la empresa ya tiene un admin, también puede invitarlo él desde sus Ajustes.',
                        tone: 'mint',
                    },
                    {
                        icon: 'Lock',
                        title: 'Una cuenta comprometida',
                        md: '**Desactivar cuenta** corta todas sus sesiones al instante. Después, **Enviar reset de contraseña** y reactívala cuando la persona confirme que es ella.',
                        tone: 'rose',
                    },
                    {
                        icon: 'Users',
                        title: 'Alguien que cambia de empresa',
                        md: 'En **Editar**, quítalo de la empresa anterior y agrégalo a la nueva. Conserva su contraseña y su doble verificación.',
                        tone: 'blue',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Borrar no es lo mismo que desactivar',
                md: '**Desactivar cuenta** se deshace con **Reactivar cuenta** y conserva todo. **Borrar…** no tiene vuelta atrás: la persona pierde su acceso a todas las empresas y lo que escribió queda como «Usuario eliminado». Ante la duda, desactiva.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Una cuenta desactivada ocupa un usuario del plan de su empresa?',
                        a: 'Mientras siga como miembro de la empresa, sí. Si ya no va a volver, que el admin la quite de **Miembros**.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [{ label: 'Abrir Usuarios', to: '/platform?tab=users' }],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-planes-cobros',
        route: '/platform?tab=plans',
        related: ['plataforma-empresas', 'plataforma-correo-diagnostico'],
        blocks: [
            {
                t: 'p',
                md: 'Los **planes** dicen cuánto puede usar cada empresa y cuánto cuesta. Los editas en **Plataforma → Planes**: una fila por plan, con sus límites y su precio en dólares y en pesos colombianos. En **Plataforma → Cobros** conectas la cuenta de **Mercado Pago** con la que cobras, y ves todos los pagos que entran.',
            },
            {
                t: 'anim',
                key: 'plat-plans',
                caption: 'Cada plan con sus límites y sus precios; vacío significa ilimitado o «no se vende en esa moneda».',
            },
            { t: 'h', text: 'Editar o crear un plan' },
            {
                t: 'steps',
                items: [
                    'En **Planes** toca **Editar** en una fila o **Nuevo plan**.',
                    'En **Límites (vacío = ilimitado)** completa **Registros**, **Usuarios**, **Invitados**, **Automatizaciones**, **Storage (MB)**, **Correos / mes** y **Pedidos IA / mes**.',
                    'En **Precio de checkout** pon el precio mensual en **USD / mes (PayPal)** y/o **COP / mes (Mercado Pago)**. Sin precio, el plan no se vende solo.',
                    'Deja marcado **Plan activo (asignable y vendible)** y toca **Guardar cambios**.',
                ],
            },
            {
                t: 'demo',
                key: 'plat-planes',
                caption: 'Plataforma → Planes: límites y precios de cada plan.',
                fallback: 'plat-plans',
            },
            {
                t: 'settings',
                title: 'Los límites de un plan',
                rows: [
                    {
                        name: 'Registros / Usuarios / Invitados',
                        what: 'Cuántos registros en total, cuántas personas del equipo y cuántas personas de afuera.',
                        tip: 'Los clientes del portal no cuentan como usuarios.',
                    },
                    {
                        name: 'Automatizaciones',
                        what: 'Cuántas automatizaciones puede tener creadas.',
                        tip: 'Un buen diferenciador entre planes.',
                    },
                    {
                        name: 'Storage (MB)',
                        what: 'Espacio de archivos en tu servidor.',
                        tip: 'Lo que la empresa guarda en su propio Drive o almacenamiento no cuenta.',
                    },
                    {
                        name: 'Correos / mes',
                        what: 'Correos que salen por el correo de la plataforma.',
                        tip: 'Con su propio Gmail, Outlook o SMTP no hay límite: así no usan tu servidor como plataforma de envíos masivos.',
                    },
                    {
                        name: 'Pedidos IA / mes',
                        what: 'Mensajes al asistente con tu clave de IA.',
                        tip: 'Con clave propia de la empresa, no hay límite.',
                    },
                ],
            },
            { t: 'h', text: 'Conectar Mercado Pago' },
            {
                t: 'steps',
                items: [
                    'En el panel de desarrolladores de Mercado Pago, en **Tus integraciones**, crea una aplicación de pagos online (Checkout Pro) y copia el **Access Token** de producción (empieza con `APP_USR-`). Para probar, usa el de prueba (`TEST-`).',
                    'En **Plataforma → Cobros** pégalo y guarda.',
                    'En la misma aplicación de Mercado Pago, en **Webhooks → Configurar notificaciones**, pega la URL que te muestra la consola (con **Copiar**) y marca los eventos **Pagos** y **Planes y suscripciones**.',
                    'Mercado Pago te muestra una **Clave secreta**: pégala en **Clave secreta de los webhooks** y toca **Guardar**.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Sin la clave secreta, los pagos no se acreditan',
                md: 'Si falta la clave secreta, las empresas pueden pagar pero la app no puede comprobar que el aviso viene de Mercado Pago: lo rechaza y el período **no se extiende**. La consola lo avisa en rojo.',
            },
            {
                t: 'p',
                md: 'Más abajo, **Pagos recientes** muestra todos los pagos de planes de todas las empresas: fecha, empresa, concepto, medio, monto y estado (Aprobado, Pendiente, Rechazado o Devuelto). PayPal (en dólares) se configura en el archivo de configuración del servidor; la consola te dice si está activo.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Cobras comisión sobre los pagos de las empresas a sus clientes?',
                        a: 'No. Los cobros que cada empresa hace a sus propios clientes (links de pago) van a la cuenta de esa empresa. Aquí sólo cobras los planes.',
                    },
                    {
                        q: '¿Puedo tener un plan especial para un solo cliente?',
                        a: 'Sí: crea el plan sin precio y asígnalo a mano en **Empresas**. No aparece en el checkout de nadie.',
                    },
                    {
                        q: '¿Puedo borrar un plan?',
                        a: 'Sólo si ninguna empresa lo tiene. Si no, desmárcalo como activo para que no se venda más.',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: tres planes para pymes',
                md: '**Básico**: 5.000 registros, 5 usuarios, 10 automatizaciones y 1.000 correos al mes a $ 59.000 COP. **Profesional**: 50.000 registros, 20 usuarios y 10.000 correos a $ 199.000 COP. **A la medida**: sin límites y sin precio, que asignas a mano a los clientes grandes después de negociar.',
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Planes', to: '/platform?tab=plans' },
                    { label: 'Abrir Cobros', to: '/platform?tab=cobros' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-correo-diagnostico',
        route: '/platform?tab=diagnostico',
        related: ['plataforma-usuarios', 'plataforma-actualizaciones-dominios'],
        blocks: [
            {
                t: 'p',
                md: 'Hay correos que no son de ninguna empresa sino de cada **cuenta**: verificar el correo, recuperar la contraseña, las invitaciones. Esos salen siempre por el **correo de la plataforma**, que configuras en **Plataforma → Correo (SMTP)**. También lo usan las empresas que no configuraron su propio correo (con la cuota de su plan). Si no está configurado, en producción la app avisa que no se pudo enviar en vez de fingir que salió.',
            },
            {
                t: 'anim',
                key: 'plat-diagnostics',
                caption: 'Diagnóstico: si los correos de cuenta salen, los últimos correos con su resultado y los errores del servidor agrupados.',
            },
            { t: 'h', text: 'Configurar el correo de la plataforma' },
            {
                t: 'steps',
                items: [
                    'Abre **Plataforma → Correo (SMTP)** y completa el servidor de envío (Brevo, Amazon SES, Mailgun o el de tu hosting): host, puerto, usuario, contraseña y remitente.',
                    'Guarda y manda un correo de prueba.',
                    'Crea en el dominio del remitente los registros SPF, DKIM y DMARC que pide tu proveedor: sin ellos, los correos de recuperación caen en spam.',
                ],
            },
            { t: 'h', text: 'Diagnóstico' },
            {
                t: 'settings',
                title: 'Lo que muestra Plataforma → Diagnóstico',
                rows: [
                    {
                        name: 'Correos de cuenta',
                        what: 'Si se envían o no, y por dónde salen.',
                        tip: 'Si dice **No se envían**, toca **Configurar el correo de la plataforma**.',
                    },
                    {
                        name: 'Correos recientes',
                        what: 'Cada intento de envío del servidor: a quién, por qué vía y si quedó **Enviado**, **No enviado** o **Falló**, con el error del servidor de correo.',
                        tip: 'Filtra **Con problemas** o **De cuenta** para encontrar rápido el correo que alguien dice que no le llegó.',
                    },
                    {
                        name: 'Errores del servidor',
                        what: 'Lo que una persona vio como «Error interno», agrupado: cuántas veces, la última, y el detalle técnico.',
                        tip: 'Útil para reportar un problema con datos concretos.',
                    },
                    {
                        name: 'Disco',
                        what: 'Espacio libre del servidor y qué ocupa: versiones de la app, copias, archivos, base de datos.',
                        tip: '**Liberar espacio** borra versiones viejas y copias previas a cada actualización, sin tocar datos ni archivos de las empresas.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Disco: el espacio y la cantidad de archivos',
                md: 'Un servidor se puede quedar sin lugar de dos formas: sin gigas libres o sin «lugar para más archivos» aunque queden gigas (cada versión de la app trae decenas de miles). La tarjeta **Disco** mide las dos, y una actualización no arranca si no hay suficiente: primero libera espacio.',
            },
            {
                t: 'example',
                title: 'Ejemplo: «no me llega la invitación»',
                md: 'Una empresa nueva dice que su vendedor no recibió la invitación. En **Diagnóstico → Correos recientes** filtras **De cuenta** y ves la invitación con estado **Falló** y el error «535 autenticación fallida». La contraseña del SMTP de la plataforma venció: la cambias en **Correo (SMTP)**, reenvías la invitación desde **Usuarios** y queda **Enviado**.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿El diagnóstico guarda el contenido de los correos?',
                        a: 'No: sólo a quién, el asunto, la vía y el resultado. Se conserva unos días y lo puedes limpiar con **Limpiar**.',
                    },
                    {
                        q: '¿Veo aquí los problemas de las automatizaciones de cada empresa?',
                        a: 'No. Esos los ve cada empresa en su sección **Problemas**. Aquí ves lo del servidor.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Un remitente que inspire confianza',
                md: 'Usa un remitente del dominio de tu plataforma, como «no-responder@tuplataforma.com», con un nombre visible claro. Las empresas que mandan desde el correo de la plataforma conservan su nombre visible y las respuestas les llegan a su dirección.',
            },
            {
                t: 'settings',
                title: 'Qué significa cada resultado',
                rows: [
                    {
                        name: 'Enviado',
                        what: 'El servidor de correo lo aceptó.',
                        tip: 'Si igual no llegó, revisa spam y los registros SPF/DKIM.',
                    },
                    {
                        name: 'No enviado',
                        what: 'No había por dónde mandarlo (correo sin configurar, cuota agotada).',
                        tip: 'Configura el correo o revisa la cuota del plan de esa empresa.',
                    },
                    {
                        name: 'Falló',
                        what: 'El servidor de correo lo rechazó; el error dice por qué.',
                        tip: 'Errores 535 son de usuario o contraseña; 550 suelen ser del remitente.',
                    },
                ],
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Cada cuánto se revisa el disco?',
                        a: 'Cada vez que abres la tarjeta, y antes de cada actualización. Después de una actualización la app limpia sola las versiones que sobran.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Diagnóstico', to: '/platform?tab=diagnostico' },
                    { label: 'Abrir Correo (SMTP)', to: '/platform?tab=correo' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-integraciones-ia',
        route: '/platform?tab=integraciones',
        related: ['plataforma-planes-cobros', 'plataforma-correo-diagnostico'],
        blocks: [
            {
                t: 'p',
                md: 'Para que una empresa conecte **su** Gmail, Google Calendar, Google Drive, Outlook o Slack con un solo botón, alguien tiene que registrar una vez la «app» en Google, Microsoft y Slack. Ese alguien eres tú, en **Plataforma → Integraciones**. Cada empresa conecta después su propia cuenta y sus datos quedan separados: tú registras la app, no prestas tu cuenta.',
            },
            {
                t: 'anim',
                key: 'plat-integrations',
                caption: 'Registras la app de cada proveedor una vez; desde ahí, cada empresa conecta su cuenta con «Conectar».',
            },
            { t: 'h', text: 'Registrar Google, Microsoft o Slack' },
            {
                t: 'steps',
                items: [
                    'En **Integraciones** abre el proveedor. La consola trae una guía por fases con el enlace a la pantalla exacta de cada paso.',
                    'Copia la **URI de redirección** (es la misma para los tres) y pégala donde la guía indica.',
                    'Completa la pantalla de consentimiento con el **Nombre de la app**, el **Correo de asistencia** y las páginas públicas (abajo). La guía trae ya escrita la **Justificación de permisos** para copiar.',
                    'Pega el **Client ID** y el **Client Secret** que te da el proveedor y toca **Guardar**. La tarjeta queda **Configurada**.',
                    'Para Google, publica la app y pide la verificación siguiendo la última fase: mientras está «en prueba», Google corta las conexiones cada 7 días.',
                ],
            },
            {
                t: 'demo',
                key: 'plat-integraciones',
                caption: 'Plataforma → Integraciones: la app de cada proveedor y las páginas públicas.',
                fallback: 'plat-integrations',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Páginas públicas',
                md: 'Google, Microsoft y Slack piden una página principal pública, una política de privacidad y condiciones del servicio. La plataforma ya las sirve armadas: en **Páginas públicas** completa **Nombre de la app**, **Empresa responsable**, **Correo de contacto y privacidad** y, si quieres, tu sitio y una descripción. Puedes editar los textos; los sugeridos ya explican cómo se usan los datos de cada proveedor.',
            },
            { t: 'h', text: 'El asistente de IA para las empresas' },
            {
                t: 'anim',
                key: 'plat-ai',
                caption: 'Tu clave de IA y cómo la usan las empresas: compartida con la cuota de su plan, o cada una con la suya.',
            },
            {
                t: 'settings',
                title: 'Plataforma → Asistente IA',
                rows: [
                    {
                        name: 'Asistente habilitado en la plataforma',
                        what: 'El interruptor general. Apagado, ninguna empresa usa el asistente.',
                        tip: 'Útil si quieres lanzarlo primero con unas pocas empresas.',
                    },
                    {
                        name: 'Clave de la plataforma',
                        what: 'Tu clave del proveedor de IA. Se guarda cifrada y no vuelve a mostrarse. **Probar** confirma que funciona.',
                        tip: 'Si dice **Clave guardada ilegible**, escríbela de nuevo.',
                    },
                    {
                        name: 'Modelo por defecto',
                        what: 'Con «Siempre el más reciente», el asistente pasa solo a cada modelo nuevo.',
                        tip: 'Cada empresa puede elegir otro en sus Ajustes.',
                    },
                    {
                        name: 'Compartir la clave de la plataforma',
                        what: 'Las empresas usan tu clave con la cuota mensual de su plan (columna IA/mes de Planes). Los pedidos los pagas tú.',
                        tip: 'Ajusta la cuota de cada plan según lo que quieras gastar.',
                    },
                    {
                        name: 'Permitir claves propias por empresa',
                        what: 'Cada empresa puede cargar su propia clave en sus Ajustes: sin cuota y a su cargo.',
                        tip: 'Ideal para empresas que usan mucho el asistente.',
                    },
                ],
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Qué pasa con las conexiones si quito la app de un proveedor?',
                        a: 'Las empresas ya no pueden conectar nuevas cuentas de ese proveedor, y las conexiones existentes dejan de renovarse. La consola te dice cuántas conexiones la usan antes de quitarla.',
                    },
                    {
                        q: '¿WhatsApp, Telegram o WooCommerce también se registran aquí?',
                        a: 'No: esas funcionan con una clave que cada empresa pega en su propia sección de Integraciones.',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: registrar Google en una tarde',
                md: 'El operador crea un proyecto en Google Cloud, habilita las APIs de Gmail, Calendar, Sheets y Drive con los botones de la guía, arma la pantalla de consentimiento con el nombre de su plataforma y las páginas públicas, crea el cliente pegando la URI de redirección y carga el ID y el secreto. Prueba con su propia cuenta, publica la app y envía la verificación. Desde ese día, cualquier empresa conecta su Gmail con un botón.',
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Integraciones', to: '/platform?tab=integraciones' },
                    { label: 'Abrir Asistente IA', to: '/platform?tab=ai' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-copias',
        route: '/platform?tab=backups',
        related: ['plataforma-migrar', 'plataforma-actualizaciones-dominios'],
        blocks: [
            {
                t: 'p',
                md: 'Una **copia completa** es todo lo necesario para volver atrás o para levantar la app en otro servidor: la base de datos, los archivos subidos, los ajustes de la plataforma y los secretos del servidor. En **Plataforma → Copias de seguridad** las programas, las guardas también en tu **Google Drive** (cifradas) y, si algo sale mal, restauras una.',
            },
            {
                t: 'anim',
                key: 'plat-backups',
                caption: 'La copia sale del servidor cifrada hacia tu Google Drive; si el servidor se pierde, otro la baja y la restaura.',
            },
            { t: 'h', text: 'Copias automáticas' },
            {
                t: 'steps',
                items: [
                    'En **Copias de seguridad**, en **Copias automáticas**, prende **Todos los días**, elige la **Hora (UTC)** y cuántas conservar en **Conservar (copias)**.',
                    'Deja marcado **Incluir secretos**: sin ellos, las contraseñas de correo y los códigos de doble verificación de la copia no se pueden leer en otro servidor.',
                    'Para una copia en el momento (antes de un cambio grande), toca **Crear copia ahora**.',
                    'En **Copias guardadas** ves cada copia con su fecha, versión, tamaño y contenido (base, archivos, plataforma, secretos, cifrada). Puedes **Descargar** o **Eliminar** cada una.',
                ],
            },
            {
                t: 'demo',
                key: 'plat-copias',
                caption: 'Plataforma → Copias de seguridad: automáticas, guardadas y Google Drive.',
                fallback: 'plat-backups',
            },
            { t: 'h', text: 'Una copia fuera del servidor: Google Drive' },
            {
                t: 'steps',
                items: [
                    'En **Copia fuera del servidor · Google Drive**, crea en Google Cloud un cliente del tipo «TV y dispositivos de entrada limitada» y pega su ID y su secreto (los pasos están en la tarjeta).',
                    'Toca **Conectar tu Google Drive**: aparece un código para escribir en la página de Google desde cualquier dispositivo.',
                    'Define la **Contraseña de recuperación** y repítela. Con ella se cifra cada copia antes de salir del servidor. **Guárdala en tu gestor de contraseñas**: sin ella las copias no se pueden abrir.',
                    'Desde ahora cada copia se sube sola a la carpeta del servidor en tu Drive. Toca **Descargar el kit de recuperación** y guárdalo junto a la contraseña.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Sin la contraseña de recuperación no hay vuelta',
                md: 'Nadie puede abrir una copia cifrada sin su contraseña, ni siquiera el soporte. El kit de recuperación trae todos los pasos y el cliente de Google, pero **no** la contraseña: guárdala aparte.',
            },
            { t: 'h', text: 'Restaurar una copia' },
            {
                t: 'p',
                md: 'En **Copias guardadas**, en la fila de la copia toca el ícono **Restaurar esta copia**. Escribe **RESTAURAR** para confirmar y toca **Restaurar ahora**. La app se detiene, la base de datos y los archivos actuales se reemplazan por los de la copia (antes guarda una copia de la base actual por si acaso) y vuelve a arrancar en unos minutos. Una copia hecha con una versión más nueva que la instalada no se restaura: primero actualiza.',
            },
            { t: 'h', text: 'Recuperar el servidor desde cero' },
            {
                t: 'steps',
                items: [
                    'En un servidor nuevo (Ubuntu o Debian) corre el comando de instalación que trae el kit de recuperación. Te pregunta el dominio, tu correo y el servidor web.',
                    'Al terminar, muestra en la terminal un **código de recuperación**. Abre la dirección del servidor en el navegador: aparece la pantalla de recuperación.',
                    'Escribe el código, pega el cliente de Google del kit, conecta tu Drive con el código que aparece y elige la copia (de cualquier servidor conectado a ese Drive).',
                    'Escribe la **contraseña de recuperación**. El servidor baja la copia, la descifra, instala la misma versión y la restaura. En unos minutos dice «el servidor ya está funcionando» y entras con tus cuentas de siempre.',
                ],
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Y si no tengo Google Drive?',
                        a: 'Descarga las copias y guárdalas en otro lugar seguro. Para levantar un servidor nuevo con un archivo descargado, el kit y la guía de migración del servidor explican cómo hacerlo por consola.',
                    },
                    {
                        q: '¿Cuánto pesa una copia?',
                        a: 'Depende de los archivos subidos: la base suele pesar poco y los archivos, mucho. Si las empresas guardan sus archivos en su propio almacenamiento, esos no entran en la copia.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Copias de seguridad', to: '/platform?tab=backups' },
                    { label: 'Migrar una sola empresa', article: 'plataforma-migrar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-migrar',
        route: '/platform?tab=transfers',
        related: ['plataforma-copias', 'plataforma-empresas'],
        blocks: [
            {
                t: 'p',
                md: 'Una copia completa mueve el **servidor entero**. A veces sólo quieres mover **una empresa**: separar un servidor en dos, pasarle un cliente a otro operador o llevar a un cliente grande a su propio servidor. Para eso está **Plataforma → Migrar empresas**: exporta una empresa entera —datos, archivos y personas— a un archivo, y la importas en otra instalación.',
            },
            {
                t: 'anim',
                key: 'plat-migrate',
                caption: 'La empresa viaja en un archivo cifrado por tu Google Drive de un servidor al otro; el original queda intacto.',
            },
            { t: 'h', text: 'Exportar e importar' },
            {
                t: 'steps',
                items: [
                    'En el servidor de origen, en **Exportar una empresa**, elige la empresa. Marca **Incluir los archivos subidos** (y, si quieres, **Incluir el historial de automatizaciones**) y exporta.',
                    'El archivo aparece en la lista. Toca **Subir a Drive** (se sube cifrado con la contraseña de recuperación de ese servidor) o **Descargar**.',
                    'En el servidor de destino, en **En Google Drive**, busca la empresa y tráela escribiendo la contraseña de recuperación del **servidor de origen**. O usa **Traer un archivo de otro servidor** para subir el que descargaste.',
                    'Toca **Importar aquí**. Revisa el **Nombre** y el **Identificador** de la empresa nueva y confirma. Se crea una empresa NUEVA, con todo re-vinculado.',
                ],
            },
            {
                t: 'settings',
                title: 'Qué viaja y qué no',
                rows: [
                    {
                        name: 'Viaja',
                        what: 'Listas, campos, registros, vistas, automatizaciones, tableros, comentarios, archivos, plantillas, personas y sus roles.',
                        tip: 'Las referencias internas se re-vinculan solas: nada queda apuntando a otra empresa.',
                    },
                    {
                        name: 'No viaja',
                        what: 'El dominio propio, el enlace público de cada lista, las direcciones de los webhooks entrantes y los tokens de acceso.',
                        tip: 'Son credenciales del servidor de origen: el importe genera direcciones nuevas y te avisa.',
                    },
                    {
                        name: 'Conservar las contraseñas de las cuentas nuevas',
                        what: 'Las personas nuevas en este servidor entran con la contraseña de siempre.',
                        tip: 'Márcalo sólo si el archivo lo exportó un servidor tuyo. Si no, nacen sin contraseña y entran con «¿Olvidaste tu contraseña?».',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'La empresa de origen queda intacta',
                md: 'Migrar es copiar. Cuando confirmes que en el servidor nuevo está todo bien, avisa a la empresa que entre por la dirección nueva y, si quieres, borra la de origen desde **Empresas**.',
            },
            {
                t: 'example',
                title: 'Ejemplo: un cliente grande a su propio servidor',
                md: 'Una cadena de clínicas creció y pidió su propio servidor. Instalaste uno nuevo, lo conectaste al mismo Google Drive, subiste la empresa desde el servidor compartido y la trajiste en el nuevo con la contraseña de recuperación del compartido. Las personas que ya tenían cuenta en el nuevo servidor quedaron vinculadas por su correo, con su contraseña y su doble verificación.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Qué pasa con las personas que ya tienen cuenta en el servidor de destino?',
                        a: 'Se reconocen por su correo y se vinculan a su cuenta existente: conservan su contraseña, su doble verificación y sus otras empresas.',
                    },
                    {
                        q: '¿Viajan las claves de correo o de integraciones?',
                        a: 'Sólo si los dos servidores comparten la misma clave de cifrado. Si no, se descartan y el importe te avisa qué hay que volver a conectar.',
                    },
                ],
            },
            { t: 'h', text: 'Antes y después de migrar' },
            {
                t: 'steps',
                items: [
                    'Avisa a la empresa con una novedad o un correo: mientras migras, conviene que no hagan cambios grandes.',
                    'Después de importar, entra a la empresa nueva (súmate como miembro o usa **Impersonar**) y revisa listas, registros y archivos.',
                    'Pídele al admin que vuelva a conectar lo que no viaja: integraciones con clave, su dominio propio y los formularios incrustados en su web (tienen dirección nueva).',
                    'Cuando todo esté bien, archiva o borra la empresa en el servidor de origen.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Sin Google Drive también se puede',
                md: 'Si no conectaste el Drive, usa **Descargar** en el servidor de origen y **Traer un archivo de otro servidor** en el de destino. El archivo trae todo; sólo cuida dónde lo guardas mientras tanto, porque contiene los datos de la empresa.',
            },
            {
                t: 'actions',
                items: [{ label: 'Abrir Migrar empresas', to: '/platform?tab=transfers' }],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-actualizaciones-dominios',
        route: '/platform?tab=updates',
        related: ['plataforma-copias', 'plataforma-correo-diagnostico'],
        blocks: [
            {
                t: 'p',
                md: 'La app se actualiza desde la consola, sin entrar al servidor por consola: aparece una versión nueva, tocas **Actualizar** y el servidor la descarga, verifica, hace una copia de la base, instala, reinicia y comprueba que responde. Si algo falla, vuelve solo a la versión anterior.',
            },
            {
                t: 'anim',
                key: 'plat-updates',
                caption: 'Al tocar «Actualizar», el servidor descarga, copia la base, instala, reinicia y verifica; si falla, vuelve atrás solo.',
            },
            { t: 'h', text: 'Actualizar' },
            {
                t: 'steps',
                items: [
                    'Abre **Plataforma → Actualizaciones**. Ves la **Versión actual** y, si hay una nueva, **Disponible** con la etiqueta **Hay actualización**.',
                    'Toca **Buscar actualizaciones** si quieres revisar en el momento (también se revisa sola cada hora).',
                    'Toca **Actualizar** y espera: la app puede no responder un minuto mientras reinicia.',
                    'Cuando vuelva, la versión actual es la nueva. Revisa **Novedades** para ver qué trae.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Buenas costumbres',
                md: 'Actualiza en un horario tranquilo (temprano o de noche), con una copia reciente en tu Drive, y avisa a las empresas con una novedad de tipo **Aviso** si esperas un corte. Si una versión te da problemas, **Rollback** vuelve a la anterior.',
            },
            { t: 'h', text: 'Dominios propios de las empresas' },
            {
                t: 'anim',
                key: 'empresa-domain',
                caption: 'La empresa pide su dominio y prueba que es suyo; tú lo habilitas en el servidor y la consola comprueba que responde.',
            },
            {
                t: 'p',
                md: 'Cada empresa puede usar su dominio para el equipo y otro para el portal de sus clientes (lo configuran en su **Ajustes → Marca**). Cuando una empresa verifica uno, te llega un correo y aparece en **Plataforma → Dominios**, en **Para habilitar**.',
            },
            {
                t: 'steps',
                items: [
                    'Espera a que el dominio diga **Apunta aquí**: la empresa tiene que crear el registro que apunta al servidor. Sin eso, el certificado no se puede emitir.',
                    'En el panel de tu servidor (por ejemplo ServerAvatar), abre la aplicación de la plataforma y agrega el dominio como alias o dominio adicional. **Copiar todos** te da la lista lista para pegar.',
                    'Vuelve a emitir el certificado SSL de la aplicación para que incluya el alias.',
                    'Toca **Comprobar**. Cuando diga **Responde**, pasa a **Funcionando** y los enlaces de esa empresa ya salen por su dominio.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Saca los dominios que ya no se usan',
                md: 'Los alias comparten un solo certificado: si una empresa deja de usar su dominio y queda en el servidor, la próxima renovación del certificado puede fallar para todos. Por eso aparece en **Para quitar del servidor**: sácalo del panel, vuelve a emitir el SSL y toca **Ya lo saqué**.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿La actualización borra algo?',
                        a: 'No. Antes de instalar hace una copia de la base, y los archivos de las empresas no se tocan. Las versiones anteriores se conservan un tiempo para poder volver atrás.',
                    },
                    {
                        q: 'Dice que no hay espacio para actualizar.',
                        a: 'Ve a **Diagnóstico → Disco** y toca **Liberar espacio**: borra versiones viejas y copias previas que sobran.',
                    },
                ],
            },
            {
                t: 'settings',
                title: 'Botones de Actualizaciones',
                rows: [
                    {
                        name: 'Buscar actualizaciones',
                        what: 'Revisa en el momento si hay una versión nueva.',
                        tip: 'Igual se revisa sola cada hora.',
                    },
                    {
                        name: 'Actualizar',
                        what: 'Instala la versión disponible con copia previa y verificación.',
                        tip: 'Tarda unos minutos; no cierres la consola.',
                    },
                    {
                        name: 'Rollback',
                        what: 'Vuelve a la versión anterior.',
                        tip: 'Úsalo si una versión nueva te da un problema que no puede esperar.',
                    },
                ],
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Qué hago si un dominio dice «Apunta a otro lado»?',
                        a: 'La empresa tiene un registro DNS que apunta a otro servidor (quizás a su página web). Pídele que lo cambie al destino que muestra la consola; mientras tanto, no lo agregues al servidor.',
                    },
                    {
                        q: '¿Me entero sin entrar a la consola?',
                        a: 'Sí: cuando una empresa verifica un dominio, o quita uno que estaba activo, los superadmins reciben un correo con los pasos.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Actualizaciones', to: '/platform?tab=updates' },
                    { label: 'Abrir Dominios', to: '/platform?tab=dominios' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'plataforma-novedades-ayuda',
        route: '/platform?tab=novedades',
        related: ['plataforma-actualizaciones-dominios', 'plataforma-consola'],
        blocks: [
            {
                t: 'p',
                md: 'Las personas que usan la app se enteran de lo nuevo en el **megáfono** de la barra superior. Cada versión trae sus propias novedades, que llegan solas. Además, en **Plataforma → Novedades** puedes publicar las tuyas: un aviso de mantenimiento, una función que activaste para tus clientes, un cambio de precios.',
            },
            {
                t: 'anim',
                key: 'plat-novedades',
                caption: 'Publicas un aviso, cada persona lo ve en su megáfono y la consola cuenta cuántos lo vieron, lo abrieron y tocaron el botón.',
            },
            { t: 'h', text: 'Publicar una novedad' },
            {
                t: 'steps',
                items: [
                    'En **Novedades** crea una nueva. Elige el tipo: **Nueva función**, **Mejora**, **Corrección** o **Aviso**.',
                    'Escribe el título y el texto (admite negrita, listas y enlaces). Puedes sumar una imagen, un video y un botón que lleve a una pantalla de la app o a un enlace.',
                    'Elige a quién: todos o algunos roles y planes. Puedes programarla, ponerle vencimiento y marcarla como **destacada** para que se abra sola una vez.',
                    'Mira la vista previa (es exactamente lo que verán) y publícala.',
                ],
            },
            {
                t: 'settings',
                title: 'Tipos y comportamiento',
                rows: [
                    {
                        name: 'Nueva función / Mejora / Corrección',
                        what: 'Aparecen en el megáfono y en la página de novedades, agrupadas por mes.',
                        tip: 'Las de cada versión llegan solas: puedes editarlas u ocultarlas.',
                    },
                    {
                        name: 'Aviso',
                        what: 'Además se muestra en una franja arriba de la app hasta que la persona la cierra o vence.',
                        tip: 'Para mantenimientos o cambios importantes. Ponle vencimiento.',
                    },
                    {
                        name: 'Destacada',
                        what: 'Se abre sola en un diálogo, una vez por persona.',
                        tip: 'Úsala poco: si todo es destacado, nada lo es.',
                    },
                    {
                        name: 'Estadísticas',
                        what: 'Cuántas personas la vieron, la abrieron y tocaron el botón.',
                        tip: 'Te dice si el anuncio llegó.',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: aviso de mantenimiento',
                md: 'Tipo **Aviso**, título «Mantenimiento el sábado 2 a las 11 p. m.», texto «La app puede no responder por 10 minutos. Tus datos no se tocan.», para todos los roles y planes, con vencimiento el domingo. El lunes ves que lo vieron 214 personas.',
            },
            { t: 'h', text: 'La ayuda dentro de la app' },
            {
                t: 'p',
                md: 'En **Plataforma → Ayuda** ajustas lo que tus clientes ven al tocar **Ayuda**: el **contacto de soporte** (correo, WhatsApp, un centro de ayuda externo y una nota), un video para cualquier guía, **ocultar** guías que no aplican a tu servidor y **crear guías propias** con tu texto, tus videos y las pantallas donde aparecen. Así la ayuda habla de tu forma de dar soporte, no de una genérica.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Tu contacto, donde lo buscan',
                md: 'Si cargas tu WhatsApp de soporte, aparece en el panel de ayuda y al final de las guías. Es lo primero que busca alguien que se trabó.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Las novedades de cada versión se pueden quitar?',
                        a: 'Sí: puedes ocultarlas o editar su texto. Si editas una, queda «Editada» y puedes restaurar el texto original.',
                    },
                    {
                        q: '¿Las personas nuevas reciben todas las novedades viejas?',
                        a: 'No. Sólo las que llegan después de su alta, para no abrumarlas.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Lo nuevo de cada versión llega solo',
                md: 'Cada actualización trae sus novedades escritas para las personas que usan la app. No tienes que copiarlas: aparecen en el megáfono de quienes ya tenían cuenta cuando llegó la versión. Si alguna no aplica a tu servidor, ocúltala.',
            },
            {
                t: 'steps',
                items: [
                    'Para configurar la ayuda, abre **Plataforma → Ayuda**.',
                    'Completa el contacto de soporte: correo, WhatsApp y, si tienes, la dirección de tu centro de ayuda.',
                    'Agrega un video a las guías que más consultan tus clientes (YouTube, Vimeo o Loom).',
                    'Oculta las guías de funciones que no ofreces y crea las tuyas para tus procesos.',
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Novedades', to: '/platform?tab=novedades' },
                    { label: 'Abrir Ayuda', to: '/platform?tab=ayuda' },
                ],
            },
        ],
    },
];
