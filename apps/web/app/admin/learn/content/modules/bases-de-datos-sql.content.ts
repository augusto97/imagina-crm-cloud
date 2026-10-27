import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sql-que-es',
        route: '/settings?s=conectores',
        related: ['sql-conectar', 'sql-sincronizacion', 'integraciones-otras-apps'],
        blocks: [
            {
                t: 'p',
                md: 'Muchas empresas tienen su información importante en un sistema contable o un ERP que guarda todo en **SQL Server** o **Azure SQL**: facturas, cartera, inventario, clientes. Ese sistema es bueno para contabilizar, pero no para seguir cobros, asignar tareas o avisarle al cliente. La **sincronización SQL** trae esos datos a una lista de la app, cada cierto tiempo, para que el equipo trabaje con ellos: filtrar, asignar, comentar, armar tableros y automatizaciones.',
            },
            { t: 'anim', key: 'sql-hero', caption: 'Las facturas del ERP llegan a una lista de la app, emparejadas por su número, y quedan al día.' },
            { t: 'h', text: 'Cómo funciona, en una frase' },
            {
                t: 'p',
                md: 'Escribes (o te escriben) una **consulta** que devuelve las filas que te interesan —o eliges un **procedimiento almacenado** que ya exista—, eliges la lista, una **columna clave** que identifica cada fila (el número de factura, el NIT) y a qué campo va cada columna. En cada corrida, la app **empareja** las filas por la clave: actualiza lo que cambió, crea lo nuevo y no duplica nunca.',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'Lock', title: 'Sólo lee', md: 'Cada consulta corre en una transacción que se deshace siempre: aunque alguien escribiera un cambio, tu base no se modifica.', tone: 'mint' },
                    { icon: 'Key', title: 'Sin duplicados', md: 'Cada fila se empareja por la columna clave: si existe se actualiza, si no se crea.', tone: 'blue' },
                    { icon: 'Timer', title: 'Sola, cada tanto', md: 'Cada 15 minutos, cada hora o una vez al día, a la hora que elijas.', tone: 'amber' },
                    { icon: 'Zap', title: 'Con automatizaciones', md: 'Los cambios que trae disparan automatizaciones, con el valor anterior y el nuevo.', tone: 'violet' },
                ],
            },
            { t: 'h', text: 'Ideas para empezar' },
            {
                t: 'example',
                title: 'Cartera de una distribuidora',
                md: 'El ERP tiene las facturas. La sincronización las trae cada hora a la lista **Cartera**, con cliente, total, saldo y vencimiento. El equipo de cobros trabaja ahí: asigna cada factura a un cobrador, comenta las promesas de pago y una automatización manda el recordatorio por WhatsApp al vencer. Cuando el ERP marca la factura como pagada, la siguiente corrida la actualiza y otra automatización felicita al cobrador.',
            },
            {
                t: 'example',
                title: 'Inventario de una ferretería',
                md: 'Una vez por día, a las 6:00, la lista **Productos** se actualiza con el stock de cada referencia (clave: el código del producto). Un tablero muestra lo que está por agotarse y el comprador ve todo sin entrar al sistema contable.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Es de una sola vía',
                md: 'La sincronización **trae** datos de tu base a la app. Lo que cambies en la lista no vuelve a SQL Server. Si un campo lo mantiene la sincronización, no lo edites a mano: la próxima corrida lo pisa con el valor de la base. Sí puedes agregar a la lista tus propias columnas (responsable, notas, estado de gestión): esas no las toca nadie.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Necesito saber SQL?', a: 'Para escribir la consulta, sí, o pedirle a quien administra tu base que te la escriba (es un paso de una sola vez). Todo lo demás —elegir la lista, los campos, el horario— se hace con clics.' },
                    { q: '¿Funciona con MySQL o PostgreSQL?', a: 'Hoy la sincronización es para SQL Server y Azure SQL. Para otras bases, mira la importación de archivos o una API personalizada.' },
                    { q: '¿Cuántas sincronizaciones puedo tener?', a: 'Varias por conexión: por ejemplo una para clientes, otra para facturas y otra para productos, cada una con su horario y su lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Conectar la base', article: 'sql-conectar' },
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sql-conectar',
        route: '/settings?s=conectores',
        related: ['sql-sincronizacion', 'sql-que-es', 'integraciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'La conexión guarda **dónde está** la base y **con qué usuario** se entra. Se hace una vez; después puedes armar todas las sincronizaciones que quieras sobre ella. Lo más importante es pedir un **usuario de solo lectura**: la app sólo necesita leer.',
            },
            { t: 'anim', key: 'sql-hero', caption: 'Con la conexión lista, las sincronizaciones traen los datos a tus listas.' },
            { t: 'h', text: 'Lo que tiene que preparar quien administra la base' },
            {
                t: 'steps',
                items: [
                    'Un **usuario de solo lectura** (rol db_datareader). Si vas a usar un procedimiento almacenado, también el permiso de ejecutarlo.',
                    'Si es **Azure SQL**: en el portal de Azure → tu servidor SQL → **Redes**, agregar la dirección IP de este servidor a las reglas del firewall.',
                    'Si es un **servidor propio**: que acepte conexiones en el puerto 1433 desde la IP de este servidor (o por una VPN).',
                ],
            },
            { t: 'h', text: 'Conectar' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Integraciones**, toca **Conectar** en **SQL Server / Azure SQL**.',
                    'Escribe el **Servidor** (sin «https://»; acepta `servidor`, `servidor:puerto` o `servidor\\INSTANCIA`), la **Base de datos**, el **Usuario** y la **Contraseña**.',
                    'Si hace falta, abre **Opciones avanzadas**.',
                    'Toca **Conectar**: la app **se conecta de verdad** antes de guardar. Si no puede, te dice por qué y no guarda nada.',
                    'Si el usuario puede **escribir** en la base, la conexión se guarda igual pero te avisa: te recomendamos uno de solo lectura.',
                    'En la fila de la conexión aparece el botón **Sincronizaciones**.',
                ],
            },
            { t: 'demo', key: 'sql-conectar', caption: 'El cuadro de conexión de SQL Server.', fallback: 'sql-hero' },
            {
                t: 'settings',
                title: 'Opciones avanzadas',
                rows: [
                    { name: 'Puerto', what: 'Por defecto 1433.' },
                    { name: 'Conexión cifrada (TLS)', what: 'Encendida por defecto. Azure SQL la exige.', tip: 'Apágala sólo si tu servidor propio no tiene TLS configurado.' },
                    { name: 'Confiar en el certificado del servidor', what: 'Sólo para servidores propios con un certificado autofirmado. En Azure, déjalo apagado.' },
                ],
            },
            { t: 'h', text: 'Si no conecta: qué significa cada error' },
            {
                t: 'settings',
                rows: [
                    { name: 'SQL Server rechazó el usuario o la contraseña', what: 'Datos de acceso equivocados, o el usuario no tiene acceso a esa base.' },
                    { name: 'El firewall de Azure SQL no deja entrar a este servidor', what: 'Falta agregar la IP (el mensaje la muestra) en Redes del servidor de Azure.' },
                    { name: 'No se pudo abrir la base', what: 'La base no existe con ese nombre o el usuario no puede entrar a ella.' },
                    { name: 'No se pudo conectar al servidor', what: 'Nombre o puerto equivocados, o el servidor no acepta conexiones desde afuera.' },
                    { name: 'Falló la conexión cifrada', what: 'El servidor tiene un certificado autofirmado: activa **Confiar en el certificado del servidor**.' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Sólo servidores accesibles desde internet',
                md: 'Por seguridad, la app sólo se conecta a servidores con dirección pública. Si tu base está en la red interna de la oficina, quien administra la plataforma puede habilitar el acceso a redes internas, o puedes publicarla por una VPN.',
            },
            {
                t: 'example',
                title: 'Un colegio con su sistema académico',
                md: 'El proveedor del sistema académico crea el usuario `lectura_app` con permiso de solo lectura sobre la vista de pensiones y agrega la IP al firewall de Azure. La coordinadora administrativa conecta la base en dos minutos y arma la sincronización de **Pensiones** por número de estudiante.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Se guarda la contraseña?', a: 'Sí, cifrada. No vuelve a mostrarse; para cambiarla, usa **Actualizar clave** en la fila de la conexión.' },
                    { q: '¿Qué pasa si desconecto la base?', a: 'Sus sincronizaciones se borran y dejan de traer datos. Lo que ya se cargó en tus listas queda como está.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Armar una sincronización', article: 'sql-sincronizacion' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sql-sincronizacion',
        route: '/settings?s=conectores',
        related: ['sql-opciones-horario', 'sql-cada-corrida', 'sql-conectar'],
        blocks: [
            {
                t: 'p',
                md: 'Una **sincronización** dice qué traer de la base, a qué lista y cada cuánto. Se arma en **Ajustes → Integraciones → Sincronizaciones** (el botón de la fila de SQL Server) con **Nueva sincronización**. Una conexión puede tener varias.',
            },
            { t: 'anim', key: 'sql-mapping', caption: 'Cada columna de la consulta va a un campo de la lista; la del número de factura es la clave.' },
            { t: 'h', text: 'Qué traer' },
            {
                t: 'settings',
                rows: [
                    { name: 'Nombre', what: 'Para reconocerla en la lista de sincronizaciones: «Facturas desde el ERP».' },
                    { name: 'Una consulta', what: 'Escribes la consulta que devuelve las filas, por ejemplo `SELECT NumFactura, NIT, Cliente, Total, Saldo, FechaVence FROM dbo.Facturas WHERE Anulada = 0`.', tip: 'Trae sólo las columnas que vas a usar y filtra lo que no te sirve: corre más rápido.' },
                    { name: 'Un procedimiento almacenado', what: 'Eliges el procedimiento por su nombre y le pasas **parámetros** con su valor (vacío = NULL).' },
                    { name: '@ultima_sincronizacion', what: 'Un valor especial: la fecha y hora (UTC) de la última corrida que terminó bien, o NULL la primera vez. Sirve para traer **sólo lo que cambió**.', tip: 'En un procedimiento se agrega con **+ la última sincronización**.' },
                ],
            },
            {
                t: 'p',
                md: 'Ejemplo de consulta que trae sólo lo que cambió:\n\n`SELECT * FROM dbo.Facturas WHERE FechaModificacion >= @ultima_sincronizacion OR @ultima_sincronizacion IS NULL`\n\nLa primera vez trae todo (el valor es NULL); después, sólo lo modificado desde la corrida anterior.',
            },
            { t: 'h', text: 'Probar' },
            {
                t: 'p',
                md: 'Toca **Probar**: la app corre la consulta y te muestra **las columnas** que devuelve, con su tipo de SQL, y **hasta 50 filas de muestra**, con cuánto tardó. No escribe nada en la lista. Si la consulta tiene un error, te dice cuál (sintaxis, una tabla que no existe, falta de permiso, tiempo agotado).',
            },
            { t: 'h', text: 'Dónde cargarlo' },
            {
                t: 'steps',
                items: [
                    'Elige la **Lista** donde van los datos (puede ser una nueva y vacía).',
                    'Elige la **Columna clave en SQL**: la que identifica cada fila sin repetirse (el número de factura, el código del producto). La app sugiere sólo columnas que no se repiten en la muestra.',
                    'Elige a qué campo de la lista va la clave (**…va al campo**) o **Crear campo nuevo**. El campo clave puede ser de texto, correo, teléfono, enlace o número.',
                    'En la tabla **Columna en SQL → Campo de la lista**, elige para cada columna un campo existente, **Crear campo nuevo** (con el tipo sugerido) o **No traer**.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Elige bien la clave',
                md: 'Si eliges una columna que se repite —por ejemplo el NIT en una tabla de facturas, donde un cliente tiene muchas—, varias filas apuntarían al mismo registro y se pisarían entre ellas. Por eso la app sólo sugiere columnas sin repetidos.',
            },
            {
                t: 'settings',
                title: 'Tipos sugeridos para los campos nuevos',
                rows: [
                    { name: 'money, smallmoney', what: 'Moneda.' },
                    { name: 'int, bigint, decimal, numeric, float', what: 'Número.' },
                    { name: 'bit', what: 'Casilla (sí/no).' },
                    { name: 'date', what: 'Fecha.' },
                    { name: 'datetime, datetime2', what: 'Fecha y hora (leída en la zona horaria que elijas en las opciones).' },
                    { name: 'nvarchar, varchar', what: 'Texto (o Texto largo si la columna admite más de 500 caracteres).' },
                    { name: 'text, ntext, xml', what: 'Texto largo.' },
                ],
            },
            {
                t: 'p',
                md: 'Cada valor pasa por el **mismo validador** que usa la importación de archivos: un texto que no es una fecha válida para un campo Fecha se informa como fila con error, sin romper el resto.',
            },
            {
                t: 'example',
                title: 'Una cadena de óptica',
                md: 'Consulta: las órdenes de lentes del sistema de punto de venta. Clave: **NumOrden** → campo «Orden». Columnas: **Paciente** → texto, **Sede** → Selección (creada nueva), **FechaEntrega** → Fecha, **Total** → Moneda. La lista **Órdenes de laboratorio** queda lista para un tablero por sede y un aviso por WhatsApp cuando los lentes llegan.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo cambiar la consulta después?', a: 'Sí, con **Editar** en la tarjeta de la sincronización. La próxima corrida usa la nueva.' },
                    { q: '¿Puedo traer datos de varias tablas?', a: 'Sí: la consulta puede unir tablas. Lo que importa es que cada fila del resultado tenga una clave única.' },
                    { q: '¿Qué pasa con las columnas que pongo en «No traer»?', a: 'Se ignoran: no se crea campo ni se escribe nada.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Opciones y horario', article: 'sql-opciones-horario' },
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sql-opciones-horario',
        route: '/settings?s=conectores',
        related: ['sql-sincronizacion', 'sql-cada-corrida'],
        blocks: [
            {
                t: 'p',
                md: 'Debajo del mapeo, la sincronización tiene **Opciones** que deciden qué hacer en los casos que no son «actualizar lo que cambió», y **Cuándo**, que dice cada cuánto corre.',
            },
            { t: 'anim', key: 'sql-upsert', caption: 'Lo que cambió se actualiza, lo nuevo se crea y lo que dejó de aparecer se marca.' },
            { t: 'h', text: 'Opciones' },
            {
                t: 'settings',
                rows: [
                    { name: 'Crear los registros cuya clave todavía no está en la lista', what: 'Encendido: las filas nuevas crean registros. Apagado: sólo se actualizan los que ya existen.', tip: 'Apágalo si la lista la cargas tú y sólo quieres mantener al día ciertos datos (por ejemplo el saldo de clientes que ya tienes).' },
                    { name: 'Un valor NULL en SQL vacía el campo', what: 'Encendido: un valor vacío en la base vacía el campo en la lista. Apagado: se deja lo que había.' },
                    { name: 'Lo que deja de aparecer en el resultado', what: '**No tocarlo** (por defecto) o **Marcarlo en una casilla**: los registros cuya clave ya no vino se marcan desmarcando esa casilla. Nunca se borra nada.' },
                    { name: 'Casilla', what: 'Qué campo casilla usar para marcar. **Crear «Está en SQL»** lo crea por ti.', tip: 'Con una vista filtrada por «Está en SQL» desmarcado ves lo que se anuló o se borró en el ERP.' },
                    { name: 'Zona horaria de las fechas de la base', what: 'En qué hora están guardadas las fechas con hora de tu base, para que lleguen a la hora correcta.' },
                    { name: 'Tiempo máximo de la consulta (segundos)', what: 'Por defecto 60, hasta 300. Si la consulta tarda más, se corta con un error.' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: '«Marcar lo que falta» no se puede con @ultima_sincronizacion',
                md: 'Si la consulta usa `@ultima_sincronizacion`, sólo trae lo que cambió: no hay forma de saber qué dejó de existir, y se marcaría como desaparecido todo lo que no cambió. Por eso esa opción se deshabilita y la app te explica el motivo.',
            },
            { t: 'h', text: 'Cuándo corre' },
            {
                t: 'settings',
                rows: [
                    { name: 'Cada 15 minutos, 30 minutos, hora, 3, 6 o 12 horas', what: 'Corre todo el día con esa frecuencia.' },
                    { name: 'Una vez por día', what: 'Cada 24 horas.' },
                    { name: 'Todos los días a una hora', what: 'A la hora que elijas, en la zona horaria que elijas: por ejemplo 6:00 de Bogotá, antes de que llegue el equipo.' },
                    { name: 'Activarla y correr la primera ahora', what: 'Al guardar, la sincronización queda activa y hace la primera carga enseguida.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'La primera carga no dispara automatizaciones',
                md: 'Para no mandar cientos de correos o WhatsApps de golpe, la primera carga crea los registros en silencio. Las corridas siguientes sí disparan las automatizaciones de la lista, con el valor anterior y el nuevo de cada campo que cambió.',
            },
            { t: 'anim', key: 'sql-schedule', caption: 'La primera carga trae todo en silencio; después, cada hora, sólo lo que cambió.' },
            {
                t: 'example',
                title: 'Una cooperativa de crédito',
                md: 'Sincronización **Saldos** «Todos los días a las 5:30» con un procedimiento del sistema de cartera. Opciones: no crear registros (los asociados ya están en la lista), un NULL no vacía nada, y la casilla «Está en SQL» marca los créditos que se cancelaron. Al llegar la oficina, la vista **Mora > 30 días** está al día.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué frecuencia me conviene?', a: 'La que necesites ver: cartera y pedidos, cada hora; inventario o reportes, una vez al día. Una frecuencia muy alta con consultas pesadas carga tu base sin necesidad.' },
                    { q: '¿Puedo cambiar la frecuencia después?', a: 'Sí, con **Editar**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Qué pasa en cada corrida', article: 'sql-cada-corrida' },
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sql-cada-corrida',
        route: '/settings?s=conectores',
        related: ['sql-opciones-horario', 'sql-sincronizacion', 'integraciones-en-automatizaciones'],
        blocks: [
            {
                t: 'p',
                md: 'En cada corrida, la app lee el resultado de la consulta y **empareja cada fila por la clave**. Si el registro existe, actualiza **sólo los campos que cambiaron**; si no existe, lo crea (si lo permitiste); si no cambió nada, no lo toca. Cada cambio deja su rastro en la **actividad** del registro, como si lo hubiera hecho una persona.',
            },
            { t: 'anim', key: 'sql-upsert', caption: 'Una corrida: una factura pasa a Pagada, llega una nueva y una dejó de aparecer.' },
            { t: 'h', text: 'La tarjeta de cada sincronización' },
            {
                t: 'settings',
                rows: [
                    { name: 'Al día / Sincronizando… / En cola… / En pausa / Con error / Todavía no corrió', what: 'El estado de la sincronización, en vivo.' },
                    { name: 'Lista, clave y frecuencia', what: 'A qué lista va, cuál es la columna clave y cada cuánto corre, con la **Próxima** corrida.' },
                    { name: 'Resumen de la última corrida', what: '**Leídas**, **Creadas**, **Actualizadas**, **Sin cambios**, **Ya no están en SQL** y **Con error**.' },
                    { name: 'Ver filas con error', what: 'Cada fila que no se pudo guardar, con el motivo (una fecha inválida, un valor que el campo no acepta). Las demás filas sí se guardan.' },
                ],
            },
            {
                t: 'settings',
                title: 'Botones',
                rows: [
                    { name: 'Sincronizar ahora', what: 'Corre ya, sin esperar el horario.' },
                    { name: 'Vista previa', what: 'Muestra lo que haría la próxima corrida —qué crearía, qué cambiaría y de qué a qué— **sin escribir nada**.', tip: 'Úsala después de editar la consulta o el mapeo, antes de que corra de verdad.' },
                    { name: 'Editar', what: 'Cambia la consulta, el mapeo, las opciones o el horario.' },
                    { name: 'Pausar / Reanudar', what: 'Detiene la sincronización sin borrarla.' },
                    { name: 'Borrar', what: 'Deja de traer datos. Lo que ya se cargó en la lista queda como está.' },
                ],
            },
            { t: 'h', text: 'Límites' },
            {
                t: 'p',
                md: '- Hasta **50.000 filas** por corrida.\n- La consulta tiene un tiempo máximo (60 segundos por defecto, hasta 300).\n- Respeta el **límite de registros de tu plan**: si la carga lo pasaría, se detiene con el motivo.\n- Si la empresa está en solo-lectura por falta de pago, no corre.\n- Dos corridas de la misma sincronización nunca se pisan: si una sigue en curso, la siguiente espera.',
            },
            { t: 'h', text: 'Reaccionar a lo que cambia' },
            {
                t: 'p',
                md: 'Después de la primera carga, cada corrida dispara las automatizaciones de la lista como si los cambios los hubiera hecho una persona: **Cuando se crea un registro**, **Cuando cambia un campo** (con el valor de antes y el de ahora), etc. Así armas avisos como «cuando el ERP marca la factura como pagada, avisar al vendedor».',
            },
            { t: 'demo', key: 'sql-reaccionar', caption: 'Una automatización «Cuando cambia un campo» reacciona a lo que trae la sincronización.', fallback: 'sql-schedule' },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Si la sincronización falla',
                md: 'Si la base deja de responder, cambia la contraseña o se agota el tiempo, la tarjeta queda **Con error** con el motivo y se abre un problema en **Ajustes → Problemas** que le avisa al administrador. Cuando la siguiente corrida funciona, el problema se cierra solo.',
            },
            {
                t: 'example',
                title: 'Un laboratorio clínico',
                md: 'La sincronización trae cada 15 minutos los resultados listos del sistema del laboratorio. Cuando un resultado pasa a **Validado**, una automatización le manda al paciente un WhatsApp con el aviso, y el tablero de la recepción muestra cuántos quedan pendientes por sede.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Edité a mano un campo que trae la sincronización y volvió al valor anterior.', a: 'Es lo esperado: la base manda. Corrige el dato en el sistema de origen, o agrega una columna propia en la lista para tus notas.' },
                    { q: '¿Borrar un registro en la lista lo borra en la base?', a: 'No. Y si la fila sigue en la base, la próxima corrida lo vuelve a crear (si está permitido crear).' },
                    { q: '¿La vista previa cuenta para el límite?', a: 'No: no escribe nada.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver los problemas', to: '/settings?s=problemas' },
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                ],
            },
        ],
    },
];
