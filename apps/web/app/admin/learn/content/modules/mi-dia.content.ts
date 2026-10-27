import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mi-dia-mi-trabajo',
        route: '/my-work',
        related: ['mi-dia-campana', 'mi-dia-seguir-recordatorios', 'mi-dia-avisos', 'primeros-pasos-moverte'],
        blocks: [
            {
                t: 'p',
                md: '**Mi trabajo** es tu lista de pendientes personal. Junta en una sola pantalla todo lo que tienes asignado en **todas las listas** de la empresa —tareas, oportunidades, tickets, citas, ítems de checklist— ordenado por cuándo vence. Es lo primero que conviene abrir al empezar el día: no tienes que entrar lista por lista para saber qué te toca.',
            },
            { t: 'anim', key: 'dia-mi-trabajo', caption: 'Llega una asignación nueva a «Hoy» y un ítem marcado como hecho sale de la lista.' },
            { t: 'h', text: 'Cómo llega algo a tu trabajo' },
            {
                t: 'p',
                md: 'Un registro aparece en tu trabajo cuando un campo de tipo **Usuario** (por ejemplo «Responsable» o «Asignado a») te tiene a ti. Si una lista no tiene ningún campo de persona, sus registros no se pueden asignar: pídele a quien administra la lista que agregue uno. Las fechas de vencimiento salen del campo de fecha del registro (la fecha límite, de entrega o de cierre). Lo que ya está terminado (un estado como «Hecho», «Cerrado» o «Ganado») no aparece.',
            },
            { t: 'h', text: 'Las pestañas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Asignado a mí', what: 'Lo tuyo, agrupado en **Vencido**, **Hoy**, **Próximos 7 días**, **Más adelante** y **Sin fecha**. También los ítems de checklist que te asignaron dentro de otros registros, que puedes marcar como hechos desde aquí.', tip: 'Empieza el día por «Vencido» y «Hoy».' },
                    { name: 'De mis equipos', what: 'Lo asignado a un equipo al que perteneces (con un campo de tipo **Equipo**), aunque no tenga una persona puntual.', tip: 'Útil en soporte o ventas: el equipo ve la bolsa común y alguien la toma.' },
                    { name: 'Aprobaciones', what: 'Las solicitudes que esperan tu decisión: aprobar, rechazar o devolver.', tip: 'El número de la pestaña dice cuántas tienes pendientes.' },
                    { name: 'Agentes', what: 'Los cambios que un agente de IA propuso y esperan que una persona los revise y aplique o descarte.' },
                    { name: 'Recordatorios', what: 'Tus recordatorios, de registros o sueltos. Puedes crear uno nuevo, marcarlo como hecho o borrarlo.' },
                    { name: 'Siguiendo', what: 'Los registros que sigues para enterarte de sus comentarios y cambios. Desde aquí puedes **Dejar de seguir**.' },
                ],
            },
            { t: 'demo', key: 'dia-mi-trabajo', caption: 'Mi trabajo con lo asignado agrupado por vencimiento.', fallback: 'dia-mi-trabajo' },
            { t: 'h', text: 'El resumen del panel lateral' },
            {
                t: 'p',
                md: 'Al tocar **Mi trabajo** en el riel, el panel de al lado muestra tres contadores (**Vencido**, **Hoy** y la semana), **Lo más urgente** (hasta seis cosas) y tus **Recordatorios**. Con el panel colapsado, pasar el mouse sobre el ícono lo muestra flotando: lo revisas de un vistazo sin salir de la lista en la que estás.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Cada grupo muestra lo más importante',
                md: 'Si tienes muchísimo asignado, se muestran los primeros resultados de cada lista. Para ver todo de una lista, ábrela y filtra por «Responsable es Yo».',
            },
            { t: 'h', text: 'Ideas para sacarle provecho' },
            {
                t: 'example',
                title: 'Una agencia de marketing',
                md: 'Cada tarea de **Proyectos y tareas** tiene un «Responsable» y una «Fecha de entrega». Cada diseñador abre Mi trabajo a primera hora y ve sus entregas de hoy y las atrasadas, sin importar de qué cliente sean. La directora revisa la pestaña **Aprobaciones** para dar el visto bueno a las piezas antes de enviarlas.',
            },
            {
                t: 'example',
                title: 'Una mesa de ayuda',
                md: 'Los tickets nuevos se asignan al equipo «Soporte»; aparecen en **De mis equipos** para todos. Quien toma uno se pone de responsable y el ticket pasa a su **Asignado a mí**, con el vencimiento del acuerdo de servicio.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No me aparece nada, aunque tengo registros a mi nombre.', a: 'Revisa que estén asignados con un campo de tipo **Usuario** (no un texto con tu nombre) y que no estén en un estado terminado.' },
                    { q: '¿Puedo ver el trabajo de otra persona?', a: 'Mi trabajo es personal. Para ver lo de otra persona, abre la lista y filtra por su nombre en el campo responsable, o usa la vista de carga de trabajo.' },
                    { q: '¿Se actualiza solo?', a: 'Sí. Cuando alguien te asigna algo, aparece al instante, y también te llega un aviso a la campana.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Mi trabajo', to: '/my-work' },
                    { label: 'Recordatorios y seguir registros', article: 'mi-dia-seguir-recordatorios' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mi-dia-campana',
        route: '/my-work',
        related: ['mi-dia-avisos', 'mi-dia-mi-trabajo', 'mi-dia-instalar'],
        blocks: [
            {
                t: 'p',
                md: 'La **campana** de la barra superior es tu bandeja de avisos. Te cuenta cuando alguien te menciona, te asigna un registro, te pide una aprobación o cuando cambia algo que sigues. El número rojo dice cuántos avisos no leíste, y se actualiza al instante, sin recargar la página.',
            },
            { t: 'anim', key: 'dia-campana', caption: 'Llega un aviso, se abre la bandeja y al tocarlo se abre el registro.' },
            { t: 'h', text: 'Qué te avisa la app' },
            {
                t: 'settings',
                rows: [
                    { name: 'Te mencionan', what: 'Alguien escribió **@tu nombre** en un comentario o en la descripción de un registro.' },
                    { name: 'Te asignan un registro', what: 'Un campo de persona pasó a tenerte a ti.' },
                    { name: 'Comentan un registro que sigues', what: 'Hay un comentario nuevo en algo que sigues.' },
                    { name: 'Cambia un registro que sigues', what: 'Cambió un dato («Estado: Pendiente → En curso»). Varios cambios seguidos del mismo registro se juntan en un solo aviso.' },
                    { name: 'Responden a tus comentarios', what: 'Alguien respondió en un hilo donde escribiste.' },
                    { name: 'Tus recordatorios', what: 'Llegó la hora de algo que te pediste recordar.' },
                    { name: 'Aprobaciones', what: 'Te toca decidir una solicitud, o se resolvió una que pediste.' },
                    { name: 'Asignan un registro a uno de tus equipos', what: 'Un campo de tipo Equipo pasó a uno de tus equipos.' },
                    { name: 'Mesa de ayuda', what: 'Un ticket que te toca entra en riesgo o se vence.' },
                    { name: 'Agentes de IA', what: 'Un agente dejó una propuesta para revisar.' },
                    { name: 'Algo dejó de funcionar', what: 'Una automatización, el correo o un conector falló.', tip: 'Llega a quien administra y a quien creó lo que falló.' },
                ],
            },
            {
                t: 'p',
                md: 'Nunca recibes un aviso de algo que hiciste tú, ni de registros que tu rol no puede ver.',
            },
            { t: 'h', text: 'Usar la bandeja' },
            {
                t: 'steps',
                items: [
                    'Toca la **campana**. Se abre la bandeja **Avisos** con los más nuevos arriba.',
                    'Elige **Todos** o **Sin leer** para ver sólo lo pendiente. Un punto de color marca lo que no leíste.',
                    'Toca un aviso: se abre el registro (en la lista que corresponde) y el aviso queda leído.',
                    'Para limpiar la bandeja de una vez, toca **Marcar todo como leído**.',
                    'Abajo tienes **Ir a Mi trabajo** y **Preferencias** (para elegir qué te llega también por correo o al teléfono).',
                ],
            },
            { t: 'demo', key: 'dia-campana', caption: 'Abrir la bandeja de avisos y llegar al registro.', fallback: 'dia-campana' },
            {
                t: 'callout',
                tone: 'info',
                title: 'La campana es siempre el centro',
                md: 'Todo aviso llega a la campana. El correo y las notificaciones del teléfono son copias opcionales que eliges en **Ajustes → Cuenta → Avisos**. Lo que está sin leer es lo mismo en el computador y en el teléfono.',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria',
                md: 'Cuando un asesor escribe «@Marta el cliente quiere visitar el apartamento el sábado» en la ficha del inmueble, a Marta le llega el aviso con el nombre del inmueble. Lo toca, ve el comentario y responde ahí mismo, con todo el contexto.',
            },
            { t: 'h', text: 'Para que la campana no te abrume' },
            {
                t: 'p',
                md: 'Si recibes demasiados avisos, ajusta qué te llega en **Ajustes → Cuenta → Avisos**: por ejemplo, deja de recibir los cambios de registros que sigues y quédate con menciones, asignaciones y recordatorios. También puedes **Dejar de seguir** los registros que ya no te interesan desde **Mi trabajo → Siguiendo**. Y si te ausentas unos días, al volver usa **Sin leer** para revisar sólo lo nuevo y **Marcar todo como leído** al terminar.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cómo menciono a alguien?', a: 'En un comentario o en la descripción de un registro escribe @ y elige a la persona. También puedes mencionar a un equipo completo.' },
                    { q: 'Me llegan demasiados avisos de cambios.', a: 'Deja de seguir los registros que no te interesan (pestaña **Siguiendo** de Mi trabajo) o apaga el correo de «Cambia un registro que sigues» en tus preferencias.' },
                    { q: '¿Los avisos se borran?', a: 'No hace falta borrarlos: márcalos como leídos y quedan en la pestaña Todos como historial.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Elegir qué me llega', to: '/settings?s=avisos' },
                    { label: 'Avisos por correo y resumen diario', article: 'mi-dia-avisos' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mi-dia-seguir-recordatorios',
        route: '/my-work',
        related: ['mi-dia-campana', 'mi-dia-mi-trabajo', 'primeros-pasos-piezas'],
        blocks: [
            {
                t: 'p',
                md: 'Dos herramientas para que nada se te pase: **Seguir** un registro te avisa de sus comentarios y cambios aunque no estés asignado, y **Recordarme** te manda un aviso a la hora que elijas («mañana a las 9:00, llamar para renovar el contrato»).',
            },
            { t: 'anim', key: 'dia-recordatorio', caption: 'Recordarme → Mañana a las 9:00 → a la hora llega el aviso.' },
            { t: 'h', text: 'Seguir un registro' },
            {
                t: 'p',
                md: 'Sigues **automáticamente** lo que creas, lo que comentas y lo que te asignan. Para seguir cualquier otro registro, ábrelo y toca **Seguir** (el ícono del ojo en la barra de la ficha). El botón pasa a **Siguiendo** y al pasar el mouse dice cuántas personas lo siguen. Tócalo de nuevo para dejar de seguirlo.',
            },
            {
                t: 'settings',
                title: 'Qué te llega por seguir un registro',
                rows: [
                    { name: 'Comentarios nuevos', what: 'Cada comentario de otra persona en ese registro.' },
                    { name: 'Cambios de datos', what: 'Qué cambió, de qué a qué. Si alguien cambia varias cosas seguidas, llega un solo aviso con todo.' },
                    { name: 'Dejar de seguir', what: 'Desde la ficha (**Siguiendo**) o desde **Mi trabajo → Siguiendo**.' },
                ],
            },
            { t: 'h', text: 'Crear un recordatorio desde un registro' },
            {
                t: 'steps',
                items: [
                    'Abre el registro y toca **Recordarme** (el ícono del despertador en la barra de la ficha).',
                    'Elige cuándo: **En 1 hora**, **Hoy a las 17:00**, **Mañana a las 9:00**, **En 3 días**, **El lunes a las 9:00** u **Otra fecha…** (con fecha y hora exactas).',
                    'Opcional: escribe una nota con lo que tienes que hacer.',
                    'Toca **Recordarme**. Verás «Recordatorio creado» con la fecha.',
                    'A la hora elegida te llega un aviso a la campana (y por correo o al teléfono, si lo tienes encendido). Al tocarlo, abres el registro.',
                ],
            },
            { t: 'demo', key: 'dia-recordarme', caption: 'Crear un recordatorio desde la ficha de un registro.', fallback: 'dia-recordatorio' },
            { t: 'h', text: 'Recordatorios sueltos' },
            {
                t: 'p',
                md: 'No todo pendiente es un registro. En **Mi trabajo → Recordatorios** toca **Nuevo recordatorio**, escribe **¿Qué te recordamos?** («pagar la luz del local») y elige cuándo. Ahí mismo ves todos tus recordatorios, los marcas como hechos o los borras. El popover de **Recordarme** de cada registro también lista los recordatorios que ya tiene, con **Quitar**.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Los recordatorios son personales: nadie más los ve y nadie más recibe el aviso. Si quieres que todo el equipo se entere de una fecha, usa un campo de fecha en el registro y una automatización «por vencimiento».',
            },
            {
                t: 'example',
                title: 'Un vendedor de seguros',
                md: 'Termina una llamada en la que el cliente le dice «llámame en quince días». Abre la ficha, toca **Recordarme → Otra fecha…**, pone la fecha y la nota «retomar cotización del seguro de hogar». Además sigue el registro, así se entera si su compañera de servicio le deja un comentario mientras tanto.',
            },
            { t: 'h', text: 'Seguir y recordar, juntos' },
            {
                t: 'p',
                md: 'Las dos herramientas se complementan: **seguir** te mantiene al tanto de lo que hacen otros en un registro (comentarios, cambios de estado), y un **recordatorio** te avisa de algo que tienes que hacer tú en un momento puntual. Por ejemplo, en una oportunidad grande que maneja otro vendedor puedes seguirla para ver cómo avanza y, además, ponerte un recordatorio el día antes del cierre para llamar al cliente.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Un recordatorio se repite?', a: 'No, avisa una sola vez. Para algo que se repite (un pago mensual), usa un campo de fecha con recurrencia en el registro.' },
                    { q: '¿A qué hora llega si estoy en otra ciudad?', a: 'A la hora que elegiste, según el reloj de tu dispositivo al crearlo.' },
                    { q: 'Sigo demasiados registros.', a: 'En **Mi trabajo → Siguiendo** tienes la lista completa y puedes dejar de seguir uno por uno.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver mis recordatorios', to: '/my-work' },
                    { label: 'La campana de avisos', article: 'mi-dia-campana' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mi-dia-avisos',
        route: '/settings?s=avisos',
        related: ['mi-dia-campana', 'mi-dia-instalar', 'mi-dia-mi-trabajo'],
        blocks: [
            {
                t: 'p',
                md: 'Todo aviso llega a la campana; tú decides qué te llega **también** por correo y como notificación al teléfono o al computador, y si quieres un **resumen diario** con tus pendientes. Se ajusta en **Ajustes → Cuenta → Avisos** (o desde la campana, botón **Preferencias**) y vale para la empresa en la que estás.',
            },
            { t: 'anim', key: 'dia-resumen', caption: 'Eliges los avisos por correo y push, enciendes el resumen y llega un solo correo con lo pendiente.' },
            { t: 'h', text: 'Qué te llega, y por dónde' },
            {
                t: 'p',
                md: 'La tabla tiene una fila por tipo de aviso y dos columnas: **Correo** (un correo en el momento) y **Push** (una notificación en los dispositivos donde la activaste). Marca o desmarca cada casilla: se guarda al instante.',
            },
            {
                t: 'settings',
                title: 'Cómo viene de fábrica',
                rows: [
                    { name: 'Te mencionan · Te asignan un registro · Tus recordatorios', what: 'Correo y push encendidos.', tip: 'Son avisos directos para ti y suelen tener apuro.' },
                    { name: 'Aprobaciones · Mesa de ayuda', what: 'Correo y push encendidos.' },
                    { name: 'Responden a tus comentarios · Algo dejó de funcionar', what: 'Correo encendido, push apagado.' },
                    { name: 'Comentan / Cambia un registro que sigues', what: 'Sólo en la campana.', tip: 'Enciéndelos sólo si sigues pocos registros: pueden ser muchos.' },
                    { name: 'Asignan un registro a uno de tus equipos · Agentes de IA', what: 'Sólo en la campana.', tip: 'Le llegan a muchas personas a la vez; enciéndelos si los necesitas.' },
                ],
            },
            { t: 'demo', key: 'dia-avisos', caption: 'Ajustes → Avisos: la tabla de correo y push y el resumen diario.', fallback: 'dia-resumen' },
            { t: 'h', text: 'El resumen diario por correo' },
            {
                t: 'steps',
                items: [
                    'En la misma pantalla, enciende **Resumen diario por correo**.',
                    'Elige la hora en **A las** (por ejemplo 7:00).',
                    'Marca los días en que lo quieres recibir (por ejemplo de lunes a viernes).',
                    'Listo: a esa hora te llega un solo correo con lo vencido, lo que vence hoy y los avisos sin leer. **Si no hay nada, no llega.**',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'La hora del resumen es la **hora de la empresa** (la zona horaria que configuró quien administra), que aparece debajo de los días.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Límite de correos',
                md: 'Llegan como mucho **10 correos de aviso por hora**: en una edición masiva (por ejemplo, cuando te asignan 50 registros de golpe) el resto queda sólo en la campana. Los correos salen por el correo de la empresa.',
            },
            {
                t: 'example',
                title: 'La dueña de una panadería',
                md: 'No quiere correos durante el día. Apaga los correos de menciones y asignaciones, deja el **push** de sus recordatorios y enciende el **Resumen diario** a las 6:30 de lunes a sábado: lo lee con el primer café y sabe qué pedidos vencen hoy.',
            },
            { t: 'h', text: 'Una configuración que suele funcionar' },
            {
                t: 'settings',
                rows: [
                    { name: 'En la campana', what: 'Todo. Es tu bandeja completa y no molesta.' },
                    { name: 'Por correo', what: 'Menciones, asignaciones, aprobaciones y fallas. Lo que necesita una respuesta tuya.' },
                    { name: 'Al teléfono (push)', what: 'Menciones, asignaciones y recordatorios. Lo urgente.' },
                    { name: 'Resumen diario', what: 'Encendido, a primera hora de tus días laborales, si prefieres revisar todo de una vez en vez de recibir correos sueltos.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: 'No me llegan los correos.', a: 'Revisa tu carpeta de spam y que la casilla «Correo» de ese aviso esté marcada. Si sigue sin llegar, quien administra debe revisar el correo de la empresa en Ajustes.' },
                    { q: '¿Las preferencias son por empresa?', a: 'Sí: si trabajas en dos empresas, configuras cada una por separado.' },
                    { q: '¿Qué trae una notificación push?', a: 'Sólo el título y una línea (por ejemplo, quién te mencionó y en qué registro). El detalle se ve al abrirla.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis avisos', to: '/settings?s=avisos' },
                    { label: 'Notificaciones en el teléfono', article: 'mi-dia-instalar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mi-dia-instalar',
        route: '/settings?s=avisos',
        related: ['mi-dia-avisos', 'mi-dia-escaner', 'mi-dia-campana'],
        blocks: [
            {
                t: 'p',
                md: 'La app se puede **instalar** en el teléfono y en el computador, sin tiendas de aplicaciones: queda con su ícono junto a tus otras aplicaciones, se abre en su propia ventana y te puede mandar **notificaciones** aunque esté cerrada. Es la misma app de siempre (lo que hagas en el teléfono se ve en el computador y al revés).',
            },
            { t: 'anim', key: 'dia-push', caption: 'Instalas la app, y con ella cerrada te llega la notificación de una asignación.' },
            { t: 'h', text: 'Instalarla' },
            {
                t: 'p',
                md: 'Abre el menú de tu cuenta (tu avatar) → **Instalar la app**, o ve a **Ajustes → Cuenta → Avisos**, tarjeta **App en este dispositivo**. Si tu navegador puede instalarla con un clic, se abre su ventana de instalación; si no, la app te muestra los pasos exactos para ese navegador.',
            },
            {
                t: 'settings',
                title: 'Según tu dispositivo',
                rows: [
                    { name: 'Chrome en el computador', what: 'Ícono **Instalar** a la derecha de la barra de direcciones, o menú ⋮ → **Enviar, guardar y compartir** → **Instalar página como app**.' },
                    { name: 'Edge en el computador', what: 'Ícono **Aplicación disponible** junto a la dirección, o menú ··· → **Aplicaciones** → **Instalar este sitio como una aplicación**.' },
                    { name: 'Safari en el Mac', what: '**Archivo** → **Agregar al Dock** (hace falta macOS Sonoma o más nuevo).' },
                    { name: 'Chrome en Android', what: 'Menú ⋮ → **Instalar app** (o **Agregar a la pantalla principal**).' },
                    { name: 'Samsung Internet', what: 'Menú ☰ → **Agregar página a** → **Pantalla de inicio**.' },
                    { name: 'iPhone y iPad', what: 'En Safari: botón **Compartir** → **Agregar a inicio** → **Agregar**.', tip: 'Si usas Chrome en el iPhone y no aparece la opción, abre la dirección en Safari.' },
                    { name: 'Firefox en el computador', what: 'No instala apps web. Abre la dirección en Chrome, Edge o Safari (las notificaciones sí funcionan en Firefox).' },
                ],
            },
            { t: 'demo', key: 'dia-instalar', caption: 'La tarjeta «App en este dispositivo» y las notificaciones.', fallback: 'dia-push' },
            { t: 'h', text: 'Activar las notificaciones en este dispositivo' },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Cuenta → Avisos**, tarjeta **Notificaciones en este dispositivo**.',
                    'Toca **Activar en este dispositivo**. El navegador te va a pedir permiso: acepta.',
                    'Toca **Enviarme una prueba** para comprobar que llega.',
                    'En la tabla de abajo elige qué avisos llegan como **Push** (por defecto: menciones, asignaciones, aprobaciones, recordatorios y mesa de ayuda).',
                    'Repite en cada dispositivo donde quieras recibirlas. La lista **Dispositivos con notificaciones en esta empresa** muestra todos, con **Quitar**.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'iPhone y iPad',
                md: 'En el iPhone las notificaciones sólo funcionan **con la app instalada** en la pantalla de inicio y con iOS 16.4 o más nuevo. Instálala primero y activa las notificaciones **desde la app instalada**.',
            },
            {
                t: 'settings',
                title: 'Si algo no anda',
                rows: [
                    { name: '«Bloqueaste las notificaciones para este sitio.»', what: 'Hay que permitirlas en el navegador: el candado junto a la dirección → Permisos → Notificaciones → Permitir. Después toca **Ya las desbloqueé**.' },
                    { name: 'La prueba no llega', what: 'Revisa que el sistema (Windows, macOS, Android) no tenga las notificaciones silenciadas o en «No molestar».' },
                    { name: 'Cerré sesión', what: 'Al cerrar sesión ese dispositivo deja de recibir notificaciones. Al volver a entrar, actívalas otra vez.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Llegan como mucho 20 notificaciones por hora a cada persona; el resto queda en la campana. La notificación trae sólo el título y una línea: el detalle se ve al abrirla.',
            },
            {
                t: 'example',
                title: 'Un técnico de mantenimiento en la calle',
                md: 'Instaló la app en su Android. Cuando le asignan una visita le llega la notificación «Te asignaron un registro», la toca y ve la dirección y el teléfono del cliente. Al llegar, marca la visita como hecha desde el teléfono.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Ocupa mucho espacio?', a: 'Casi nada: no es una app de tienda, es la misma página guardada para abrirse más rápido.' },
                    { q: '¿Funciona sin internet?', a: 'Necesita conexión para trabajar. Sin red muestra un aviso para reintentar.' },
                    { q: '¿Mis compañeros reciben mis notificaciones?', a: 'No, cada persona activa las suyas en sus propios dispositivos.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Avisos', to: '/settings?s=avisos' },
                    { label: 'Ver el recorrido para instalar', tour: 'install-app' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mi-dia-escaner',
        route: '/lists',
        related: ['primeros-pasos-buscar', 'mi-dia-instalar', 'listas-y-campos-administrar'],
        blocks: [
            {
                t: 'p',
                md: 'La app lee **códigos QR y de barras** con la cámara del teléfono o del computador. Sirve para encontrar al instante el producto, el activo o la entrada que tienes en la mano, para crear el registro si no existe y para revisar muchos códigos seguidos (un inventario, la puerta de un evento).',
            },
            { t: 'anim', key: 'dia-escaner', caption: 'Escaneo continuo: cada código se busca en la lista y se suma al historial.' },
            { t: 'h', text: 'Dónde está el escáner' },
            {
                t: 'settings',
                rows: [
                    { name: 'En la búsqueda global', what: 'Ctrl K → **Escanear** (o la acción **Escanear un código**). Busca el código en todas tus listas.', tip: 'Para cuando no recuerdas en qué lista está.' },
                    { name: 'En la barra de una lista', what: 'El botón **Escanear un código** junto al buscador. Busca sólo en esa lista.', tip: 'Para inventario y entradas: más rápido y permite crear.' },
                    { name: 'En un campo', what: 'El ícono de cámara junto al campo «Código» de la ficha o del alta: lo leído queda escrito en el campo.', tip: 'Para cargar el SKU de un producto nuevo sin tipearlo.' },
                ],
            },
            { t: 'h', text: 'Escanear en una lista' },
            {
                t: 'steps',
                items: [
                    'Abre la lista (por ejemplo **Productos**) y toca **Escanear un código**. Acepta el permiso de la cámara.',
                    'Elige **Un código** (busca uno y te muestra el resultado) o **Escaneo continuo** (sigue leyendo y arma un historial).',
                    'Apunta la cámara al código. Si lo encuentra, toca **Abrir**; si hay varios, eliges cuál; si no está, toca **Crear** para dar de alta un registro con ese código ya puesto.',
                    'En escaneo continuo puedes encender o apagar el **Sonido** y la **Vibración** de cada lectura.',
                ],
            },
            { t: 'demo', key: 'dia-escaner', caption: 'El botón de escanear en la barra de una lista.', fallback: 'dia-escaner' },
            { t: 'h', text: 'El campo del código' },
            {
                t: 'p',
                md: 'La app busca el código en un campo de la lista. Por defecto lo adivina por el nombre (**SKU**, **Código**, **Serial**, **Boleta**…) o busca en todos los campos de texto y número. Para fijarlo, ve a **Ajustes de la lista → Campos**, abre el menú del campo y elige **Usar como código para escanear**: queda con la etiqueta **Código**. En el diálogo del escáner también puedes cambiar el **Campo del código** para esa sesión.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'La búsqueda es **exacta**: no distingue mayúsculas ni espacios, pero el código tiene que ser el mismo. Si escaneas un código que no está, el registro nuevo nace con ese código ya cargado (salvo que el campo sea un ID automático, que lo pone la app).',
            },
            {
                t: 'example',
                title: 'Una ferretería contando inventario',
                md: 'Abre **Productos** en el celular, elige **Escaneo continuo** y recorre los estantes. Cada producto suena con un ✓ y entra al historial con su stock; los que no están en la lista aparecen con una X y el botón **Crear**. En diez minutos sabe qué le falta registrar.',
            },
            {
                t: 'example',
                title: 'La entrada de un evento',
                md: 'Cada invitado tiene una boleta con un código QR guardado en el campo «Boleta». En la puerta, el equipo escanea en modo continuo: si el invitado aparece, lo abren y marcan «Asistió».',
            },
            { t: 'h', text: 'Para que el escáner lea bien' },
            {
                t: 'p',
                md: 'Buena luz y el código entero dentro del recuadro, sin reflejos: los códigos impresos en papel brillante se leen mejor inclinando un poco el teléfono. Un código QR se lee desde más lejos que uno de barras. Y si un código no se lee, siempre puedes escribirlo a mano: la búsqueda es la misma.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo el botón de escanear en una lista.', a: 'Aparece cuando la lista tiene algún campo de texto o número donde buscar. Los invitados externos no lo ven.' },
                    { q: '¿Necesito un lector de códigos?', a: 'No: alcanza la cámara del teléfono o la del computador.' },
                    { q: '¿Funciona con códigos de cualquier tipo?', a: 'Lee los QR y los códigos de barras de productos más comunes (EAN, UPC, Code 128, entre otros).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Instalar la app en el teléfono', article: 'mi-dia-instalar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'mi-dia-favoritos',
        route: '/favorites',
        related: ['primeros-pasos-buscar', 'primeros-pasos-carpetas', 'mi-dia-mi-trabajo'],
        blocks: [
            {
                t: 'p',
                md: 'Si todos los días abres las mismas tres listas, un tablero y una vista filtrada, **anclarlas a Favoritos** te ahorra buscarlas. Y lo que abriste hace poco queda en **Recientes**, arriba del panel y en la búsqueda global.',
            },
            { t: 'anim', key: 'dia-favoritos', caption: 'Al tocar el pin, la lista se suma a Favoritos.' },
            { t: 'h', text: 'Anclar a favoritos' },
            {
                t: 'settings',
                rows: [
                    { name: 'Una lista', what: 'Pasa el mouse sobre la lista en el panel y toca el **pin** (o menú «···» → **Anclar a favoritos**). También desde la tarjeta de la lista en la página Listas.' },
                    { name: 'Un tablero', what: 'Igual: el pin del tablero en el panel de Tableros.' },
                    { name: 'Una vista', what: 'En la pestaña de la vista, menú «···» (o clic derecho) → **Marcar como favorito**. Al abrirla desde Favoritos, la lista se abre directamente en esa vista.', tip: 'Ideal para vistas como «Mis clientes de Bogotá» o «Facturas vencidas».' },
                ],
            },
            { t: 'demo', key: 'dia-favoritos', caption: 'Anclar una lista y verla en Favoritos.', fallback: 'dia-favoritos' },
            { t: 'h', text: 'La página de Favoritos' },
            {
                t: 'p',
                md: 'Toca **Favoritos** en el riel (o **g** y después **f**). Ves tus anclados como tarjetas, agrupados **Por carpeta** (la carpeta de cada lista, y los tableros al final) o **Por tipo** (Listas, Dashboards, Vistas). Para quitar uno, toca su pin: **Quitar de favoritos**. Los favoritos son **tuyos**: cada persona del equipo tiene los suyos.',
            },
            { t: 'h', text: 'Recientes' },
            {
                t: 'p',
                md: 'La app recuerda lo último que abriste: registros, listas y tableros. Lo ves arriba del panel de Listas, en **Recientes**, y en la búsqueda global (Ctrl K) antes de escribir nada. Es la forma más rápida de volver al cliente que estabas atendiendo hace diez minutos.',
            },
            { t: 'h', text: 'Ideas según tu trabajo' },
            {
                t: 'cards',
                items: [
                    { icon: 'TrendingUp', title: 'Si vendes', md: 'Ancla **Oportunidades** en su vista kanban «Mis oportunidades» y el tablero «Ventas del mes». Abres el día viendo tu embudo.', tone: 'blue' },
                    { icon: 'Wallet', title: 'Si llevas la administración', md: 'Ancla la vista «Facturas vencidas», la lista **Proveedores** y el tablero «Cartera». Lo urgente queda a un clic.', tone: 'mint' },
                    { icon: 'Headphones', title: 'Si atiendes clientes', md: 'Ancla la vista «Tickets abiertos — mi equipo» y la lista **Clientes**. Y sigue los tickets delicados para enterarte de cada comentario.', tone: 'amber' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Favoritos, recientes o carpetas',
                md: 'Usa **Favoritos** para lo que abres todos los días, **Recientes** para volver a lo que abriste hace un rato y las **carpetas** del panel para ordenar todas las listas de la empresa. Las tres cosas conviven: anclar una lista no la saca de su carpeta.',
            },
            {
                t: 'example',
                title: 'Un contador con varias empresas',
                md: 'En cada empresa ancla **Facturas**, la vista «Vencidas este mes» y el tablero «Cartera». Al cambiar de empresa, sus favoritos cambian solos, porque son por empresa.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Mis favoritos los ve el resto del equipo?', a: 'No, son personales y por empresa.' },
                    { q: '¿Puedo anclar un registro?', a: 'Se anclan listas, tableros y vistas. Para tener un registro a mano, síguelo (aparece en Mi trabajo → Siguiendo) o búscalo en Recientes.' },
                    { q: 'Anclé una vista privada, ¿pasa algo?', a: 'Funciona igual: sólo tú puedes verla, así que sólo tú la tienes en favoritos.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Favoritos', to: '/favorites' },
                    { label: 'Buscar con Ctrl+K', article: 'primeros-pasos-buscar' },
                ],
            },
        ],
    },
];
