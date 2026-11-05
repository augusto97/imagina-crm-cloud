import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-que-es',
        route: '/lists',
        related: ['agenda-servicios-personas', 'agenda-publicar', 'agenda-gestionar', 'formularios-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'La **agenda de citas** es una página pública donde tus clientes reservan solos, a cualquier hora: eligen el **servicio**, **con quién** (si quieres), el **día** y una **hora libre**, y dejan sus datos. Cada cita llega como un **registro** de tu lista, con estado **Confirmada**, y el cliente recibe un correo con la confirmación, el archivo para agregarla a su calendario y los enlaces para cambiarla o cancelarla.\n\nSe acabaron los diez mensajes de WhatsApp para cuadrar una hora: la página sólo ofrece los horarios que de verdad están libres.',
            },
            { t: 'anim', key: 'citas-hero', caption: 'El cliente elige el servicio, el día y la hora; la cita aparece como un registro confirmado en tu lista.' },
            { t: 'h', text: 'Qué vive tu cliente, paso a paso' },
            {
                t: 'steps',
                items: [
                    '**Elige el servicio**: ve cada servicio con su duración (y su precio, si lo pusiste).',
                    '**¿Con quién?** (opcional): elige a la persona que lo atiende o **El primero disponible**.',
                    '**Elige el día y la hora**: un calendario marca los días con horarios libres y, al tocar uno, aparecen las horas. Los horarios se ven en su zona horaria y puede cambiarla.',
                    '**Tus datos**: nombre, correo, teléfono (si lo pides) y las preguntas que agregues; al final, **Confirmar cita**.',
                    'Ve **¡Tu cita quedó agendada!** con el resumen y el botón **Agregar a mi calendario**, y le llega el correo de confirmación.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Cada paso muestra «Paso 1 de 3», «Paso 2 de 3»… El paso **¿Con quién?** sólo aparece si dejas que el cliente elija y hay más de una persona para ese servicio.',
            },
            { t: 'h', text: 'Crear tu primera agenda' },
            {
                t: 'p',
                md: 'La agenda vive **dentro de una lista**, porque cada cita es un registro de esa lista. Lo más fácil es empezar con la plantilla de lista **Agenda de citas**, que ya trae la lista **Citas** con sus campos (fecha y hora, servicio, profesional, estado) y una agenda armada. Si ya tienes tu lista, la lista necesita al menos un campo **Fecha y hora** para el inicio de la cita.',
            },
            {
                t: 'steps',
                items: [
                    'Abre la lista de citas y toca **Configurar lista**.',
                    'Entra a la pestaña **Agenda** y toca **Nueva agenda** (o **Crear la primera**). Arranca con un servicio y contigo atendiendo de lunes a viernes.',
                    'Se abre el constructor: al centro **la página real** con los horarios de verdad; a la izquierda, tres pestañas: **Contenido** (las partes de la página en el orden en que las recorre el cliente), **Diseño** y **Ajustes**.',
                    'Toca **Servicios** y **Quién atiende** para cargar los tuyos; el horario está en **Ajustes → Horario y disponibilidad**.',
                    'Toca **Guardar** y, en **Ajustes → Publicar**, toca **Publicar la agenda**.',
                ],
            },
            { t: 'demo', key: 'citas-editar', caption: 'Abrir la agenda de la lista de citas y recorrer sus partes.', fallback: 'citas-hero' },
            {
                t: 'callout',
                tone: 'tip',
                title: 'La vista previa es de verdad',
                md: 'La página del centro calcula los horarios con lo que estás editando, sin guardar: si cambias el horario de alguien, ves las horas nuevas al instante. Nada se reserva ahí: es sólo para mirar.',
            },
            { t: 'h', text: 'Toca cualquier parte para editarla' },
            { t: 'anim', key: 'agenda-click-edit', caption: 'Tocar los horarios en la vista previa: aparece el panel de «Fecha y hora» y los horarios toman el color elegido.' },
            {
                t: 'p',
                md: 'Cada parte de la página (el título, la descripción, los servicios, el calendario, tus datos, el botón, la confirmación) se toca **en la vista previa** o en la lista de **Contenido**, y a la derecha aparece su panel:\n\n- **Mostrar**, arriba, si esa parte se puede ocultar (el título, la descripción, el logo, la franja, el avance). En la lista, el **ojo** hace lo mismo.\n- **Contenido**: lo que dice y lo que ofrece. Por ejemplo, el texto de cada paso («Elige el servicio», «Confirmar cita»).\n- **Estilo**: sus colores y su parte del diseño. Por ejemplo, el color de los horarios, del día elegido o del botón.\n\nAl tocar un paso en la lista, la vista previa va a ese paso. Lo que no es una parte de la página (el horario, las reglas, los correos, dónde se guarda cada dato, publicar) está en **Ajustes**.',
            },
            { t: 'h', text: 'La lista de agendas' },
            {
                t: 'settings',
                title: 'Lo que ves en Configurar lista → Agenda',
                rows: [
                    { name: 'Publicada / Sin publicar', what: 'Si la página recibe reservas. Una sin publicar responde «no disponible».' },
                    { name: 'Le falta algo para publicarla', what: 'Aviso cuando la configuración está incompleta (por ejemplo, sin campo para el inicio de la cita).' },
                    { name: 'Servicios · citas próximas · reservas en total', what: 'Los números de cada agenda y cuándo llegó la última reserva.' },
                    { name: 'Editar, Copiar enlace, Abrir, Publicar', what: 'Abrir el constructor, copiar la dirección pública, ver la página como el cliente y publicarla sin entrar.' },
                    { name: 'Eliminar', what: 'Borra la agenda. Las citas ya agendadas se conservan como registros, pero sus enlaces para cambiar o cancelar dejan de servir.' },
                ],
            },
            {
                t: 'cards',
                items: [
                    { icon: 'Headphones', title: 'Consultorios y clínicas', md: 'Consulta de 30 minutos, control de 20 y tratamiento de 1 hora, con varios profesionales.', tone: 'rose' },
                    { icon: 'Sparkles', title: 'Peluquerías y spas', md: 'Corte, color y manicure, cada uno con su duración y sus estilistas.', tone: 'violet' },
                    { icon: 'Briefcase', title: 'Asesorías', md: 'Una llamada de diagnóstico gratis de 30 minutos que alimenta tu embudo de ventas.', tone: 'blue' },
                    { icon: 'Building2', title: 'Salas y equipos', md: 'Reserva de la sala de reuniones, la cancha o el estudio de grabación como **recursos**.', tone: 'amber' },
                ],
            },
            {
                t: 'example',
                title: 'Una barbería con tres barberos',
                md: 'Barbería El Clásico, en Monterrey, publicó su agenda en el perfil de Instagram. Tiene tres servicios (Corte 40 min, Barba 20 min, Corte y barba 1 h) y tres barberos con horarios distintos. Los clientes eligen a su barbero o **El primero disponible**, reciben la confirmación con la dirección y un recordatorio 2 horas antes. En la lista **Citas**, la vista de calendario muestra el día de cada barbero.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Se cobra la cita al agendar?', a: 'No. El precio del servicio es sólo informativo. Si quieres cobrar, puedes crear un link de pago desde el registro o con una automatización.' },
                    { q: '¿Puedo tener varias agendas en la misma lista?', a: 'Sí: por ejemplo una para consultas presenciales y otra para virtuales. Las citas de una persona en cualquier agenda de la empresa ocupan su horario en todas.' },
                    { q: '¿Quien agenda necesita una cuenta?', a: 'No. La página es pública: deja su nombre y su correo y listo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Siguiente: servicios y quién atiende', article: 'agenda-servicios-personas' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-servicios-personas',
        route: '/lists',
        related: ['agenda-que-es', 'agenda-horarios-reglas', 'agenda-campos-correos'],
        blocks: [
            {
                t: 'p',
                md: 'Los dos primeros pasos de la agenda responden «¿qué se puede agendar?» y «¿quién lo atiende?». Un **servicio** es algo que el cliente reserva, con su duración. Quien atiende puede ser una **persona** de tu equipo o un **recurso** (una sala, un consultorio, una cancha).',
            },
            { t: 'anim', key: 'citas-roundrobin', caption: 'Con «El primero disponible», las citas se reparten por turno entre quienes están libres.' },
            { t: 'h', text: 'Servicios' },
            { t: 'anim', key: 'citas-cupos', caption: 'Un taller grupal: el cliente elige la duración y con quién, y los cupos de cada horario bajan con cada reserva.' },
            {
                t: 'settings',
                title: 'Cada servicio',
                rows: [
                    { name: 'Nombre del servicio', what: 'Lo que ve el cliente: «Consulta general», «Corte y barba».' },
                    { name: 'Duración', what: 'De 10 minutos a varias horas. Define cuánto tiempo bloquea la cita en el horario de quien atiende.', tip: 'Si después de cada cita necesitas tiempo para limpiar, no lo sumes aquí: usa el **Margen después** de las reglas.' },
                    { name: 'El cliente también puede elegir', what: 'Marca otras duraciones (por ejemplo 30 min y 1 h) y en la página el cliente elige cuánto dura su cita. La primera es la de por defecto.', tip: 'Una consulta de 30 minutos o una sesión completa de una hora, en el mismo servicio.' },
                    { name: 'Cupos por horario', what: 'Cuántas personas pueden reservar el mismo horario. Con 1 es una cita individual; con más es **grupal** (una clase, un taller, un tour) y cada reserva es un registro.', tip: 'Con **Mostrarle al cliente cuántos cupos quedan**, cada horario dice «3 cupos», «2 cupos»… Al llenarse deja de ofrecerse.' },
                    { name: 'Horario propio del servicio', what: 'Para ofrecer un servicio sólo en ciertas franjas (las valoraciones en la mañana, por ejemplo). Se cruza con el horario de quien atiende: se ofrece lo que está en los dos.' },
                    { name: 'Reglas propias del servicio', what: 'Márgenes antes y después, aviso mínimo y cada cuánto empieza un horario sólo para este servicio. Vacío = las de la página.', tip: 'Un procedimiento largo con 30 minutos de limpieza y las consultas cortas sin margen, en la misma agenda.' },
                    { name: 'Precio (opcional)', what: 'Se muestra junto al servicio, con el formato de tu empresa. Es sólo informativo: no se cobra.' },
                    { name: 'Descripción (opcional)', what: 'Una línea que ayuda a elegir: «Incluye lavado y peinado».' },
                    { name: 'Dónde es', what: '**Videollamada** (cada cita lleva su enlace de Google Meet o Microsoft Teams), **En persona** (con su dirección), **Por teléfono** (quién llama a quién), **Un enlace fijo** (tu sala de Zoom) o **Lo que dice la página**. Se puede sumar una indicación: «Toca el timbre del 302».', tip: 'Un enlace nunca se muestra en la página pública: el cliente lo recibe cuando reservó.' },
                    { name: 'Disponible para agendar', what: 'Apágalo para esconder un servicio sin borrarlo (por ejemplo, en temporada baja).' },
                    { name: 'Subir, Bajar, Quitar el servicio', what: 'El orden en que aparecen en la página, y quitarlo.' },
                ],
            },
            { t: 'h', text: 'Quién atiende' },
            {
                t: 'p',
                md: 'Tocando **Quién atiende** agregas a cada persona (**Agregar persona**) o recurso (**Agregar recurso**). Una persona aparece en la lista para elegir si **puede editar esta lista**: si no, no vería sus propias citas. Si atiende en otras agendas de la empresa, sus citas de allá también ocupan su horario aquí, así nunca le dan dos citas a la misma hora.',
            },
            {
                t: 'settings',
                title: 'Cada persona o recurso',
                rows: [
                    { name: 'Persona / Recurso', what: 'Elige a alguien del equipo, o escribe el nombre del recurso («Sala 1», «Cancha 2»).' },
                    { name: 'Nombre que ve el cliente (opcional)', what: 'Por ejemplo «Dra. Martínez» en vez de su nombre en la app.' },
                    { name: 'Foto', what: 'Una foto (PNG, JPG, WebP o GIF, hasta 5 MB) que el cliente ve al elegir con quién. Sin foto se muestran sus iniciales.' },
                    { name: 'Cargo o especialidad y descripción (opcional)', what: '«Odontóloga», «Asesor de seguros» y unas líneas sobre la persona: ayudan al cliente a elegir.' },
                    { name: 'Servicios que atiende', what: 'Qué servicios presta. Sin marcar ninguno, atiende todos.', tip: 'La nutricionista no hace masajes: márcale sólo los suyos.' },
                    { name: 'Su calendario: El suyo / Una conexión de la empresa', what: '**El suyo** usa el calendario que la persona conectó en **Ajustes → Cuenta → Mi calendario** (y ella elige en cuáles mira lo ocupado). **Una conexión de la empresa** usa un calendario de **Ajustes → Integraciones** y ahí eliges sus calendarios.', tip: 'Lo más común es **El suyo**: cada asesor conecta su propia cuenta y nadie más la ve.' },
                    { name: 'Su enlace de videollamada fijo (opcional)', what: 'Aparece si algún servicio es por videollamada: se usa si la reunión no se puede crear en su calendario (por ejemplo, una cuenta personal de Microsoft sin Teams) o si no tiene calendario.' },
                    { name: 'No ofrecer los horarios ocupados en su calendario', what: 'Las horas en que tiene un evento en su calendario no se ofrecen.', tip: 'Del calendario sólo se lee la hora de inicio y de fin de cada evento: nunca el título, la descripción ni los invitados.' },
                    { name: 'Agregar cada cita a su calendario', what: 'Cada reserva aparece también como evento en su Google Calendar u Outlook.' },
                    { name: 'Recibe citas', what: 'Apágalo para sacar a alguien de la agenda por un tiempo sin borrar su configuración.' },
                ],
            },
            { t: 'h', text: 'Con varias personas: ¿quién elige?' },
            {
                t: 'settings',
                rows: [
                    { name: 'El cliente elige', what: 'El cliente ve quién atiende y también **El primero disponible**, que reparte las citas por turno entre quienes están libres.', tip: 'Ideal cuando los clientes tienen su profesional de confianza.' },
                    { name: 'Se asigna solo', what: 'El cliente no elige: la cita va a quien esté libre.', tip: 'Ideal para una llamada comercial o un call center: la carga se reparte pareja.' },
                ],
            },
            {
                t: 'settings',
                title: 'Cómo se reparten las citas (con «El primero disponible» o «Se asigna solo»)',
                rows: [
                    { name: 'Por turno', what: 'Cada cita nueva va al siguiente que esté libre, en orden.' },
                    { name: 'Equilibrar la carga', what: 'La cita va a quien tiene menos citas en los próximos 30 días: nadie queda sobrecargado.' },
                    { name: 'Por prioridad', what: 'Va a quien tenga la prioridad más alta (de 1 a 5) y esté libre; entre iguales, por turno.', tip: 'Un asesor principal y otros de respaldo que sólo reciben citas cuando el principal está ocupado.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Cada persona conecta **su propio** Google Calendar u Outlook en **Ajustes → Cuenta → Mi calendario**: es privado, nadie más de la empresa lo ve ni lo usa. En **Quién atiende** ves si ya lo conectó. Lo explica a fondo **El calendario de cada asesor, la videollamada y los cambios desde el calendario**.',
            },
            {
                t: 'example',
                title: 'Un centro de fisioterapia',
                md: 'Fisio Andes, en La Paz, tiene **Evaluación inicial** (45 min), **Sesión** (1 h) y **Masaje deportivo** (30 min). Atienden tres fisioterapeutas y un recurso, **Piscina terapéutica**, para la hidroterapia. Cada fisioterapeuta tiene conectado su Google Calendar con **No ofrecer los horarios ocupados en su calendario**, así sus reuniones personales nunca se cruzan con un paciente. La agenda usa **El cliente elige**, porque cada paciente sigue con su terapeuta.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Una persona de otra área puede atender citas?', a: 'Sí, si puede editar la lista de citas. Si no aparece en **Agregar persona**, revisa su acceso a la lista en **Compartir → Con tu equipo** o en **Permisos**.' },
                    { q: '¿Qué pasa si saco un servicio que ya tiene citas?', a: 'Las citas existentes siguen igual (son registros). El servicio simplemente deja de ofrecerse.' },
                    { q: '¿Puedo reservar un recurso y una persona a la vez?', a: 'Cada cita va a una persona o a un recurso. Si necesitas ambos (el médico y el consultorio), arma la agenda por personas y lleva el consultorio como un campo más de la lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Conectar mi calendario', to: '/settings?s=calendario' },
                    { label: 'Siguiente: el calendario de cada asesor', article: 'agenda-calendarios' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-calendarios',
        route: '/settings?s=calendario',
        related: ['agenda-servicios-personas', 'agenda-gestionar', 'agenda-campos-correos'],
        blocks: [
            {
                t: 'p',
                md: 'La agenda funciona mejor cuando conoce el calendario de quien atiende. Con su **Google Calendar** u **Outlook** conectado pasan tres cosas: la página **no ofrece las horas en que ya está ocupado**, cada cita **se agrega sola a su calendario** (con su enlace de **Google Meet** o **Microsoft Teams** si es por videollamada) y, si la **mueve o la borra en su calendario**, la cita se mueve o se cancela en la app y al cliente le llega el aviso.',
            },
            { t: 'anim', key: 'citas-calendario-sync', caption: 'La reunión que Ana ya tenía no se ofrece; la cita llega a su calendario con Meet y, al arrastrarla a las 15:00, se mueve sola y Carla recibe el aviso.' },
            { t: 'h', text: 'Mi calendario: lo conecta cada persona' },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Cuenta → Mi calendario**.',
                    'Toca **Conectar Google Calendar** o **Conectar Outlook** y entra con tu propia cuenta. Google o Microsoft te piden permiso y vuelves solo a la app.',
                    'En **Mirar lo ocupado en**, marca tus calendarios: el principal y, si usas otros (el del equipo, el familiar), también esos. Lo ocupado en cualquiera no se ofrece.',
                    'En **Crear las citas en**, elige el calendario donde quieres ver tus citas.',
                    'Listo: en **Agendas donde atiendes** ves en qué agendas se usa.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Es una conexión **privada**: nadie más de la empresa la ve ni la usa en automatizaciones. De tus eventos sólo se lee la **hora de inicio y de fin**, nunca el título, la descripción ni los invitados, y sólo se modifican los eventos que creó la propia app.',
            },
            { t: 'h', text: 'En la agenda: de dónde sale su calendario' },
            {
                t: 'settings',
                title: 'Quién atiende → Su calendario',
                rows: [
                    { name: 'El suyo', what: 'Usa el **Mi calendario** de la persona. Si todavía no lo conectó, lo dice; si eres tú, aparece **Conectar mi calendario**.' },
                    { name: 'Una conexión de la empresa', what: 'Un Google Calendar u Outlook conectado en **Ajustes → Integraciones** (por ejemplo, el de una sala o el de recepción). Ahí eliges en qué calendarios mirar lo ocupado y en cuál crear las citas.' },
                    { name: 'No ofrecer los horarios ocupados en su calendario', what: 'Las horas con un evento en sus calendarios no se ofrecen.' },
                    { name: 'Agregar cada cita a su calendario', what: 'Cada reserva aparece como evento en su calendario. Hace falta para la videollamada: el enlace se crea en ese evento.' },
                    { name: 'Su enlace de videollamada fijo', what: 'Si la reunión no se puede crear (una cuenta personal de Microsoft no tiene Teams), se usa este enlace.' },
                ],
            },
            { t: 'h', text: 'La videollamada de cada cita' },
            {
                t: 'p',
                md: 'En el servicio elige **Dónde es → Videollamada**. Con **La del calendario de quien atiende**, quien usa Google Calendar recibe un enlace de **Google Meet** y quien usa Outlook uno de **Microsoft Teams**; también puedes fijar una de las dos. El enlace llega al cliente en el **correo de confirmación**, en el botón **Unirse a la videollamada** de la página de su cita y en el archivo del calendario. Si en **Ajustes → Dónde se guarda la cita** eliges **Enlace de la reunión**, también queda guardado en el registro.',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Si alguien no puede crear la videollamada (sin calendario, o con Teams pedido y un Google Calendar), la agenda **no se publica** y te dice a quién le falta qué: conectar su calendario, cambiar la videollamada o ponerle un enlace fijo.',
            },
            { t: 'h', text: 'Cuando la cambia en su calendario' },
            {
                t: 'settings',
                title: 'Quién atiende → Si quien atiende cambia la cita en su calendario',
                rows: [
                    { name: 'Si mueve el evento, mover la cita', what: 'La cita (y el registro) toman la nueva hora y el estado pasa a **Reprogramada**.' },
                    { name: 'Si borra el evento, cancelar la cita', what: 'La cita se cancela y deja libre el horario.' },
                ],
            },
            {
                t: 'p',
                md: 'La app revisa los calendarios cada pocos minutos. Si en **Ajustes → Correos y recordatorios** está encendido avisarle al cliente cuando el equipo cambia la cita, le llega el correo con la nueva hora. Lo que mueve el propio cliente desde su enlace no se confunde con un cambio de quien atiende.',
            },
            {
                t: 'example',
                title: 'Una asesoría de seguros',
                md: 'Seguros Pacífico, en Lima, tiene cuatro asesores que atienden por videollamada. Cada uno conectó su Google Calendar en **Mi calendario** y marcó también el calendario del equipo, donde están las capacitaciones. Los clientes eligen la hora y reciben el enlace de Meet en el correo. Cuando un asesor se enferma, arrastra sus citas del día a otra fecha en su calendario: la lista se actualiza sola y cada cliente recibe la nueva hora.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué permisos pide Google?', a: 'Ver y editar los eventos de tu calendario (para crear la cita, su Meet y mirar lo ocupado) y ver la lista de tus calendarios (para que elijas cuáles). La app sólo modifica los eventos que ella misma creó.' },
                    { q: '¿Y si desconecto mi calendario?', a: 'Las citas que ya están en tu calendario no se borran. La agenda deja de mirar lo ocupado y las citas nuevas no se agregan a él.' },
                    { q: '¿Funciona con una cuenta personal de Microsoft?', a: 'Sí para mirar lo ocupado y crear las citas. Teams sólo se crea con cuentas de trabajo o estudiantiles: con una personal, usa un enlace fijo.' },
                    { q: '¿Cada cuánto se ve un cambio hecho en el calendario?', a: 'En pocos minutos (la app revisa cada 3).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Conectar mi calendario', to: '/settings?s=calendario' },
                    { label: 'Siguiente: horarios y reglas', article: 'agenda-horarios-reglas' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-horarios-reglas',
        route: '/lists',
        related: ['agenda-servicios-personas', 'agenda-campos-correos', 'agenda-publicar'],
        blocks: [
            {
                t: 'p',
                md: 'Los horarios que ve el cliente salen de cruzar cuatro cosas: el **horario semanal** de cada persona, sus **días especiales** (y los festivos), lo que **ya está ocupado** (otras citas y su calendario) y las **reglas** de la agenda (márgenes, anticipación, tope). La app hace la cuenta y sólo ofrece lo que de verdad está libre.',
            },
            { t: 'anim', key: 'citas-slots', caption: 'Del horario de la semana se restan lo ocupado y los márgenes: lo que queda son los horarios que ve el cliente.' },
            { t: 'h', text: 'Disponibilidad: el horario de cada uno' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Horario y disponibilidad**, elige arriba a la persona o recurso.',
                    'Para cada día pon uno o más tramos **Desde** / **Hasta** (por ejemplo 8:00–12:00 y 14:00–18:00). Con **Agregar otro tramo** sumas la jornada de la tarde.',
                    'Usa **Copiar a lun–vie** para repetir el horario del lunes en toda la semana.',
                    'Marca **No atiende** en los días libres.',
                    'En **Festivos** elige el país: sus festivos oficiales no se ofrecen. Marca en la lista los que sí atiendes.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Los horarios se cargan en la **zona horaria de la empresa** (se elige en **Ajustes → Formato regional**). Si tu cliente está en otro país, la página le muestra las horas en SU zona, y él puede cambiarla.',
            },
            { t: 'h', text: 'Festivos por país y vacaciones' },
            { t: 'anim', key: 'citas-festivos', caption: 'Se elige el país y sus festivos se cierran solos; uno se marca como día que sí se atiende y unas vacaciones bloquean una semana.' },
            {
                t: 'p',
                md: 'En **Festivos** eliges el país de cada persona o recurso (Colombia, México, Perú, Chile, Argentina, España, Estados Unidos y más de 30). Los festivos salen del **calendario oficial**, así que se actualizan solos cada año, incluidos los que se trasladan. Debajo ves la lista del año con una casilla por festivo: márcala si ese día **sí atiendes**. Los festivos regionales (de un estado o provincia) se muestran aparte y no cierran salvo que los marques. Con varias personas, **Usar estos festivos para todos los que atienden** copia el país y lo marcado.',
            },
            {
                t: 'p',
                md: 'En **Vacaciones y ausencias** agregas un rango de fechas (**Desde** / **Hasta**, con una nota interna): esos días no se ofrecen. Sirve para vacaciones, una licencia o un viaje sin tener que cerrar día por día.',
            },
            { t: 'h', text: 'Días especiales' },
            {
                t: 'p',
                md: 'Un día cerrado o un sábado con otro horario: en **Días especiales** eliges la **Fecha**, si es **Cerrado** u **Otro horario** (con sus tramos) y una **Nota interna (opcional)**, y tocas **Agregar día**. Un día especial pisa al horario de la semana, a las vacaciones y a los festivos: si un festivo abres con otro horario, agrégalo como día especial.',
            },
            { t: 'h', text: 'Reglas' },
            {
                t: 'settings',
                title: 'Ajustes → Reglas',
                rows: [
                    { name: 'Margen antes (min)', what: 'Tiempo libre antes de cada cita, para prepararse.' },
                    { name: 'Margen después (min)', what: 'Tiempo libre después: limpieza, traslado o notas.', tip: 'Un spa con 15 minutos para cambiar la camilla nunca recibe citas pegadas.' },
                    { name: 'Aviso mínimo', what: 'Con cuánta anticipación se puede agendar: sin aviso, 30 min, 1, 2, 4 o 12 horas, 1 o 2 días. Tampoco se puede cambiar ni cancelar en línea con menos anticipación.', tip: 'Con 2 horas, nadie te reserva «para ya» sin que alcances a llegar.' },
                    { name: 'Hasta cuándo se puede agendar: los próximos días', what: 'Hasta cuántos días adelante se puede reservar (de 1 a 365). Con **Contar sólo días hábiles** se cuentan de lunes a viernes.', tip: 'Con 30 días, nadie aparta una fecha de dentro de seis meses que después olvida.' },
                    { name: 'Hasta cuándo se puede agendar: entre dos fechas', what: 'Sólo se ofrecen horarios entre una fecha **Desde** y una **Hasta**: una temporada, un evento o una feria.' },
                    { name: 'Un horario cada', what: 'Cada cuánto empieza un horario: **Lo que dura la cita** (uno detrás de otro), 5, 10, 15, 20, 30, 45 minutos, 1, 1,5 o 2 horas.', tip: 'Con citas de 45 minutos y «Lo que dura la cita», ofreces 8:00, 8:45, 9:30…' },
                    { name: 'Cupos y topes: por día, por semana, por mes', what: 'Cuántas citas puede recibir cada persona o recurso en un día, una semana (lunes a domingo) o un mes. Un horario grupal cuenta una sola vez. Vacío = sin tope.' },
                    { name: 'Citas pendientes por cliente', what: 'Cuántas citas futuras puede tener a la vez un mismo correo. Evita que una persona acapare la agenda.', tip: 'Con 1, cada cliente tiene una sola cita por delante: para otra, cambia la que tiene.' },
                    { name: 'El cliente puede cambiar el horario desde su correo', what: 'El correo de confirmación trae un enlace para elegir otro horario.' },
                    { name: 'El cliente puede cancelar desde su correo', what: 'El correo trae un enlace para cancelar (con un motivo opcional).' },
                ],
            },
            {
                t: 'example',
                title: 'Una nutricionista con consultas virtuales',
                md: 'Paula atiende por videollamada de lunes a jueves de 7:00 a 11:00 y los viernes sólo en la tarde. Puso **Margen después** de 10 minutos para escribir sus notas, **Aviso mínimo** de 12 horas (necesita revisar los exámenes antes) y **Hasta cuántos días adelante** de 21. En diciembre agregó un **Día especial** cerrado del 24 al 31.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué un día no aparece marcado en la página?', a: 'Puede ser que no haya tramos ese día, que sea festivo, que esté fuera de los días adelante permitidos, que ya esté lleno o que el aviso mínimo lo deje afuera. La vista previa del constructor te ayuda a probar.' },
                    { q: '¿Las citas cargadas a mano en la lista también ocupan el horario?', a: 'Sí: los registros de la lista con esa persona y esa hora también cuentan como ocupado, aunque no hayan llegado por la agenda.' },
                    { q: '¿Puedo tener horarios distintos por servicio?', a: 'Sí: toca **Servicios** y abre **Horario propio del servicio** y elige sus franjas. Se ofrece sólo lo que coincide con el horario de quien atiende.' },
                    { q: '¿Una misma persona puede reservar dos cupos de un horario grupal?', a: 'No con el mismo correo: la segunda reserva del mismo horario se rechaza. Para inscribir a otra persona, se usa su correo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Elegir la zona horaria de la empresa', to: '/settings?s=formato' },
                    { label: 'Siguiente: campos y correos', article: 'agenda-campos-correos' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-campos-correos',
        route: '/lists',
        related: ['agenda-horarios-reglas', 'agenda-publicar', 'formularios-correo-seguridad'],
        blocks: [
            {
                t: 'p',
                md: 'Cada cita se guarda como un registro, así que hay que decirle a la app **en qué campo** va cada dato: la fecha y hora, el servicio, quién atiende, el cliente. Esto se hace en **Ajustes → Dónde se guarda la cita**. En **Ajustes → Correos y recordatorios** decides qué le llega al cliente y cuándo.',
            },
            { t: 'anim', key: 'citas-mapping', caption: 'Los datos de la reserva caen en los campos de la lista: la cita es un registro más.' },
            { t: 'h', text: 'Campos de la lista' },
            {
                t: 'settings',
                rows: [
                    { name: 'Inicio de la cita', what: 'Un campo **Fecha y hora**. Obligatorio.', tip: 'Si la lista no tiene uno, agrégalo en **Campos** antes de seguir.' },
                    { name: 'Fin de la cita / Duración', what: 'Dónde guardar la hora de fin o la duración (opcionales). Con ellas, la vista de calendario dibuja el bloque completo.' },
                    { name: 'Quién atiende (persona) / Recurso', what: 'Un campo de persona y, si usas recursos, una selección.' },
                    { name: 'Servicio', what: 'Si es una selección, al publicar se crea una opción por servicio.' },
                    { name: 'Nombre, Correo y Teléfono del cliente', what: 'Dónde caen los datos que deja el cliente.' },
                    { name: 'Estado', what: 'Una selección: al publicar se crean **Confirmada**, **Reprogramada** y **Cancelada** si no existen.', tip: 'Con el estado puedes colorear el calendario y filtrar las canceladas.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Las opciones nuevas (servicios, recursos, estados) se crean **al publicar**, no mientras escribes: así, renombrar un servicio mientras armas la agenda no deja opciones sueltas en tu lista.',
            },
            { t: 'h', text: 'Lo que se le pregunta al cliente' },
            {
                t: 'p',
                md: 'Siempre se piden **nombre y correo**. El **Teléfono** puede ser **Obligatorio**, **Opcional** o **No pedirlo**. Con **+ Agregar una pregunta…** sumas cualquier otro campo de la lista (por ejemplo «Motivo de la consulta» o «¿Es tu primera vez?»), con su texto, una **Ayuda (opcional)** y si es **Obligatoria**.',
            },
            { t: 'h', text: 'Correos y recordatorios' },
            { t: 'anim', key: 'citas-email', caption: 'El correo de confirmación con el evento para el calendario, los enlaces para cambiar o cancelar, y el recordatorio antes de la cita.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Mandarle al cliente la confirmación por correo', what: 'Sale con la marca de tu empresa, el archivo para agregarla a su calendario y los enlaces para cambiar el horario o cancelar.', tip: 'Usa el correo de la empresa (**Ajustes → Correo**).' },
                    { name: 'Indicaciones para el cliente (opcional)', what: 'Van en el correo: qué traer, cómo llegar, el enlace de la videollamada…' },
                    { name: 'Recordatorios por correo', what: 'Uno o varios, con **+ Agregar un recordatorio…**: 10, 30 minutos, 1, 2, 3 horas, 1 o 2 días o 1 semana antes.', tip: 'Cada recordatorio sale una sola vez por cita. Si la cita se mueve, se vuelven a programar.' },
                    { name: 'Avisarle al cliente si el equipo mueve o cancela su cita', what: 'Si alguien de tu equipo cambia la fecha o el estado desde la lista, al cliente le llega el aviso.' },
                    { name: 'Mensaje al terminar de agendar', what: 'Lo que ve en la pantalla final: «Te enviamos la confirmación a tu correo».' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Recordatorios que bajan las ausencias',
                md: 'Un recordatorio 1 día antes y otro 2 horas antes reduce mucho las citas a las que nadie llega. Si además tienes WhatsApp conectado, una automatización puede mandar el recordatorio por WhatsApp.',
            },
            { t: 'h', text: 'Protección y datos personales' },
            {
                t: 'settings',
                rows: [
                    { name: 'Pedir la autorización de tratamiento de datos (Ley 1581)', what: 'La casilla obligatoria con el texto de tu empresa, igual que en los formularios. Se activa en **Ajustes → Datos personales**.' },
                    { name: 'Pedir la verificación anti-robots (captcha)', what: 'Para frenar reservas falsas. Las llaves se cargan en **Ajustes → Portal y formularios**.' },
                    { name: 'Código por correo y correos temporales', what: 'Están en **Ajustes → Aprobación y seguridad**: el cliente confirma su correo con un código de 6 números y no se aceptan los correos que duran unos minutos.' },
                ],
            },
            {
                t: 'example',
                title: 'Un consultorio de psicología',
                md: 'El consultorio de Andrés, en Montevideo, guarda **Motivo de la consulta** con una pregunta obligatoria, pide el teléfono como **Obligatorio** y en **Indicaciones para el cliente** pone la dirección, el timbre del edificio y el enlace de la videollamada para las sesiones virtuales. Configuró recordatorios de 1 día y 2 horas, y desde entonces casi nadie falta.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿El correo dice el nombre de mi empresa?', a: 'Sí: sale con tu marca. Si configuraste el correo de la empresa, sale desde tu dirección.' },
                    { q: '¿Qué es el archivo para el calendario?', a: 'Un archivo de evento que se abre en Google Calendar, Outlook o el calendario del iPhone y agrega la cita con su hora y su lugar.' },
                    { q: '¿Los recordatorios cuentan para mi cuota de correos?', a: 'Sí: todos los correos de la agenda salen por el correo de la empresa y cuentan en su cuota mensual (salvo que tengas tu propio servidor de correo).' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Configurar el correo de la empresa', to: '/settings?s=correo' },
                    { label: 'Siguiente: aprobar citas y frenar reservas falsas', article: 'agenda-aprobacion' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-aprobacion',
        route: '/lists',
        related: ['agenda-campos-correos', 'agenda-gestionar', 'agenda-publicar'],
        blocks: [
            {
                t: 'p',
                md: 'Hay negocios que no pueden confirmar una cita sin mirarla antes: un consultorio que revisa el motivo, una asesoría que primero quiere saber quién es el cliente, un taller con cupos limitados. En **Ajustes → Aprobación y seguridad** decides si cada cita **espera la aprobación** de alguien del equipo y cómo se protege la página de reservas falsas.',
            },
            { t: 'anim', key: 'citas-aprobacion', caption: 'Carla confirma su correo con un código, su cita queda «Por confirmar» con el horario apartado, Ana la aprueba desde la ficha y a Carla le llega la confirmación.' },
            { t: 'h', text: 'Elegir cuándo se aprueba' },
            {
                t: 'settings',
                title: 'Ajustes → Aprobación y seguridad → Aprobación de las citas',
                rows: [
                    { name: 'Se confirman solas', what: 'Cada reserva queda confirmada al instante. Es lo de siempre.' },
                    { name: 'Alguien del equipo las aprueba', what: 'Cada reserva queda **Por confirmar** hasta que alguien la aprueba. Mientras tanto, el horario queda apartado: nadie más lo puede tomar.' },
                    { name: 'Sólo la primera cita de cada cliente', what: 'La primera cita de cada correo espera la aprobación; las siguientes del mismo cliente se confirman solas.' },
                ],
            },
            {
                t: 'p',
                md: 'Cada servicio puede tener **su propia regla** en **Servicios → Aprobación**: por ejemplo, la consulta de control se confirma sola y la primera consulta se aprueba.',
            },
            { t: 'h', text: 'Quién aprueba y en cuánto tiempo' },
            {
                t: 'settings',
                rows: [
                    { name: 'Quien atiende la cita puede aprobarla', what: 'La persona que va a atender decide sobre sus propias citas.' },
                    { name: 'Y también estas personas', what: 'Otras personas del equipo que aprueban todas las citas de la agenda. Quien administra la lista siempre puede aprobar.' },
                    { name: 'Hay que decidir antes de', what: 'El plazo para decidir (de 2 horas a una semana). Nunca pasa del inicio de la cita.' },
                    { name: 'Si nadie decide a tiempo', what: '**Se rechaza** (y el horario vuelve a quedar libre) o **Se confirma** sola.' },
                    { name: 'Lo que ve el cliente al pedirla', what: 'El mensaje de la pantalla «Recibimos tu solicitud».' },
                ],
            },
            { t: 'h', text: 'Aprobar o rechazar desde la ficha' },
            {
                t: 'steps',
                items: [
                    'Cuando llega una cita por confirmar, a quien aprueba le llega un aviso en la campana.',
                    'Abre la ficha del registro: arriba aparece **Cita por confirmar**, con el servicio, la hora y hasta cuándo hay para decidir.',
                    'Toca **Aprobar**: la cita queda **Confirmada**, llega al calendario de quien atiende (con su videollamada) y al cliente le llega la confirmación con el evento para su calendario.',
                    'O toca **Rechazar** y, si quieres, escribe el motivo: al cliente le llega un correo con ese motivo y el horario vuelve a quedar libre.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Mientras la cita espera, no se crean el evento en el calendario, la videollamada ni los recordatorios: todo eso pasa cuando se aprueba. El estado del registro también cambia solo (**Por confirmar**, **Confirmada** o **Rechazada**), así puedes filtrar o armar un tablero con las que esperan.',
            },
            { t: 'h', text: 'Seguridad de la página' },
            {
                t: 'settings',
                title: 'Ajustes → Aprobación y seguridad → Seguridad de la página',
                rows: [
                    { name: 'Pedir que confirme su correo con un código', what: 'Antes de agendar, al cliente le llega un código de 6 números. Así nadie reserva con el correo de otra persona. Recomendado con «Sólo la primera cita de cada cliente».' },
                    { name: 'No aceptar correos temporales', what: 'Rechaza los correos que duran unos minutos, que suelen usarse para reservas falsas. Viene encendido.' },
                ],
            },
            {
                t: 'p',
                md: 'Además, siempre: un mismo correo no puede pedir más de 5 citas por hora, y cuando una cita se cambia, el enlace del correo anterior deja de servir para hacer cambios (sigue mostrando la cita, pero los cambios se hacen desde el enlace más reciente).',
            },
            {
                t: 'example',
                title: 'Un centro de estética',
                md: 'Lumina, en Medellín, ofrece valoraciones gratis y tratamientos. Puso **Sólo la primera cita de cada cliente** con el código por correo: la primera valoración la revisa la recepcionista antes de confirmarla (rechaza las que no tienen sentido con un motivo amable) y las clientas que ya vinieron reservan sus tratamientos sin esperar.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué pasa si el cliente cancela mientras espera?', a: 'Puede cancelar la solicitud desde el enlace de su correo; el horario queda libre y el registro pasa a Cancelada.' },
                    { q: '¿Las automatizaciones se enteran?', a: 'Sí: en **Cuando se agenda, reprograma o cancela una cita** puedes elegir también **Se pidió (por confirmar)** y **Se rechazó**. Las automatizaciones que ya tenías no cambian.' },
                    { q: '¿Quién aprueba si nadie está marcado?', a: 'Quien administra la lista. Si marcas que quien atiende puede aprobar, también esa persona.' },
                    { q: '¿Puedo aprobar desde el celular?', a: 'Sí: abre el aviso de la campana y aprueba o rechaza desde la ficha, igual que en el computador.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Configurar la agenda', to: '/lists' },
                    { label: 'Siguiente: diseñar la página de la agenda', article: 'agenda-diseno' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-diseno',
        route: '/lists',
        related: ['agenda-publicar', 'agenda-aprobacion', 'agenda-servicios-personas'],
        blocks: [
            {
                t: 'p',
                md: 'La página donde tus clientes agendan es tu vitrina: tiene que verse como tu negocio. En **Diseño** eliges una plantilla, el color, la tipografía y los tamaños; y tocando cada parte de la página cambias su color o la ocultas, con la **vista previa** que cambia al instante. Es el mismo diseño que tienen los formularios, así tus páginas se ven iguales.',
            },
            { t: 'anim', key: 'agenda-diseno', caption: 'Elegir la plantilla «Tarjetas», cambiar el color y ocultar los precios: la página de la agenda cambia en la vista previa.' },
            { t: 'h', text: 'Elegir una plantilla' },
            {
                t: 'steps',
                items: [
                    'En el constructor de la agenda (**Configurar lista → Agenda → Editar**) abre **Diseño**: a la izquierda, las plantillas y **Mis temas**; a la derecha, todos los ajustes del tema.',
                    'En **Plantillas** toca una: **Clásico** es el diseño de siempre; las demás (Minimalista, Tarjetas, Oscuro, Píldoras, Con portada, Dividido…) toman el color de tu marca.',
                    'Mira la vista previa: los servicios, quién atiende, el calendario y los horarios ya se ven con el diseño.',
                    'Toca **Guardar**. Si quieres usar el mismo diseño en otras agendas o formularios, guárdalo en **Mis temas**.',
                ],
            },
            { t: 'h', text: 'Mostrar u ocultar' },
            {
                t: 'settings',
                title: 'Lo que se oculta tocando cada parte',
                rows: [
                    { name: 'El logo, el título, la descripción y dónde es la cita', what: 'Con su **ojo** en la lista de **Contenido**, o tócalos en la vista previa y apaga **Mostrar**. El logo es el de Ajustes → Marca.' },
                    { name: 'La franja de color, la portada, el avance y la tarjeta', what: 'Igual: con su ojo. Sin tarjeta, la agenda queda sobre el fondo de la página.' },
                    { name: 'La duración, la descripción y el precio de cada servicio', what: 'Toca **Servicios** → **Qué se ve de cada servicio**. Ocultar el precio sirve si prefieres hablar de precios después.' },
                    { name: 'La foto, el cargo y la descripción de quienes atienden', what: 'Toca **Quién atiende** → **Qué se ve de cada persona**: «Odontóloga», «Doce años de experiencia»…' },
                ],
            },
            { t: 'h', text: 'El calendario y los horarios' },
            {
                t: 'settings',
                title: 'Toca «Fecha y hora» → Cómo se ve',
                rows: [
                    { name: 'El calendario', what: '**Al lado de los horarios** (en pantallas anchas) o **Arriba de los horarios**. En el celular siempre va arriba.' },
                    { name: 'Los horarios', what: '**Cuadrícula** de botones o **Lista**, uno debajo del otro (con los cupos a la derecha).' },
                    { name: 'La semana empieza el', what: 'Lunes o domingo, como se usa en tu país.' },
                ],
            },
            { t: 'h', text: 'El color de cada parte' },
            {
                t: 'p',
                md: 'Toca una parte y abre **Estilo**: ahí están **sus** colores. Los horarios tienen su fondo, su texto y su borde; los días del calendario, el día con horarios y el día elegido; el botón, su fondo, texto y borde; el título, los títulos de cada paso, las etiquetas de los datos… Vacío = sale de los colores generales del diseño (se ve punteado).',
            },
            { t: 'h', text: 'El resto del diseño' },
            {
                t: 'p',
                md: 'En **Diseño**, a la derecha, ajustas toda la página con la misma lógica de los formularios: **Colores** (y el modo oscuro), **Tipografía**, **Página** (ancho, aire, título y avance), **Fondo** (color, degradado o imagen), **Portada**, **Pantalla dividida**, **Tarjeta**, **Campos** (los datos del cliente), **Opciones** (los servicios y quién atiende como lista, botones o tarjetas) y **Botón**.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'El diseño vale también para la página donde el cliente **cambia o cancela** su cita. El color que elijas va además en los correos de confirmación y recordatorio.',
            },
            {
                t: 'example',
                title: 'Un consultorio odontológico',
                md: 'Sonríe, en Bogotá, eligió la plantilla **Tarjetas** con el verde de su marca, ocultó los precios (los explica en la consulta) y dejó las fotos de sus odontólogas: los pacientes eligen con quién atenderse viendo su cara y su especialidad. Puso el calendario arriba y los horarios en lista, que se leen mejor en el celular.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cambia cómo se ve mi agenda si no toco nada?', a: 'No. Las agendas que ya existían quedan con el diseño de siempre (Clásico) hasta que elijas otro.' },
                    { q: '¿Puedo escribir mi propio CSS?', a: 'Sí, en **CSS propio** al final del panel. Sólo lo agrega un administrador de la empresa; se limpia al guardar para que no cargue nada de otros sitios.' },
                    { q: '¿Se ve bien insertada en mi sitio?', a: 'Sí: el diseño viaja con la agenda. Con un fondo de color o imagen, puedes elegir si se ve también cuando está insertada.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Configurar la agenda', to: '/lists' },
                    { label: 'Siguiente: publicar la agenda', article: 'agenda-publicar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-publicar',
        route: '/lists',
        related: ['agenda-que-es', 'agenda-gestionar', 'formularios-publicar', 'formularios-medir-conversiones'],
        blocks: [
            {
                t: 'p',
                md: 'En el constructor, **Ajustes → Publicar** dice qué falta y tiene el botón para publicarla. Todo lo de compartirla (el enlace, el código para tu sitio con su demostración y el código QR) está en una sola ventana: el botón **Compartir** de arriba.',
            },
            { t: 'anim', key: 'citas-embed', caption: 'La agenda insertada en el sitio web de la empresa y el enlace en la biografía de Instagram.' },
            { t: 'h', text: 'Publicar' },
            {
                t: 'steps',
                items: [
                    'Entra a **Ajustes → Publicar**. Arriba ves las **citas próximas** y las **reservas en total**.',
                    'Si algo falta, aparece **Para publicarla falta:** con la lista (por ejemplo, un servicio sin nadie que lo atienda). Lo que tiene un problema se marca con un punto rojo, y al tocar **Publicar** te lleva a donde se arregla.',
                    'Toca **Publicar la agenda** (o enciende el interruptor **Sin publicar** de arriba).',
                    'Al publicarla se abre sola la ventana **Compartir la agenda**: copia el **Enlace**, el código para **Insertar en tu sitio** (con la demostración de cómo queda) o descarga el **Código QR**.',
                ],
            },
            { t: 'demo', key: 'citas-publicar', caption: 'Publicar la agenda y copiar su enlace.', fallback: 'citas-embed' },
            { t: 'h', text: 'Textos de la página' },
            {
                t: 'p',
                md: 'Los colores, el logo, la tipografía y qué se muestra están en **Diseño** (ver «Diseñar la página de la agenda»). Los textos se cambian tocando cada parte:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Título y Descripción', what: 'Tócalos en la vista previa: lo primero que lee el cliente, «Agenda tu cita» y «Elige el servicio, el día y la hora que te quedan bien».' },
                    { name: 'Dónde es la cita', what: 'Una dirección, «Videollamada»… Va en la página, el correo y el archivo del calendario.' },
                    { name: 'El texto de cada paso y del botón', what: 'En el **Contenido** de **Servicios**, **Quién atiende**, **Fecha y hora**, **Tus datos**, **Botón de agendar** y **Confirmación**. Vacío = el de siempre.' },
                    { name: 'Mensaje cuando no recibe reservas', what: 'En **Ajustes → Publicar**: lo que se ve si la agenda está sin publicar o tu empresa está en solo lectura.' },
                ],
            },
            { t: 'h', text: 'Dónde se puede insertar' },
            {
                t: 'p',
                md: 'En **Insertar en tu sitio** eliges cómo se ve: **En la página** (la agenda dentro de tu página), **Ventana al hacer clic** (un botón la abre sobre la página) o **Botón flotante** (un botón fijo en la esquina de cada página). Las dos últimas no cargan nada hasta que alguien las toca: lo más liviano para un sitio con muchas visitas. Al lado tienes una **demostración en vivo** de cómo queda (ahí no se agenda nada). Es igual que en los formularios.',
            },
            { t: 'anim', key: 'embed-popup', caption: 'El botón flotante «Agenda tu cita»: la agenda se abre en una ventana al tocarlo.' },
            {
                t: 'p',
                md: 'Debajo del código, en **Sitios que pueden insertarlo** (uno por renglón), escribe los dominios donde se puede insertar la agenda (por ejemplo `miempresa.com` o `*.miempresa.com` para todos sus subdominios). Vacío = cualquier sitio. El enlace directo funciona siempre, desde cualquier lugar.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Cambiar la dirección',
                md: '**Cambiar la dirección** (en **Compartir → Enlace**) genera un enlace nuevo: el actual deja de funcionar al instante, también donde lo hayas insertado. Las citas ya agendadas y sus enlaces para cambiar o cancelar no se ven afectados. Úsalo sólo si el enlace se filtró donde no debía.',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'Smartphone', title: 'Biografía de Instagram', md: 'El lugar número uno: «Agenda tu cita aquí».', tone: 'violet' },
                    { icon: 'MessageCircle', title: 'Respuesta rápida de WhatsApp', md: 'Cuando te escriban «¿tienes turno?», mandas el enlace.', tone: 'mint' },
                    { icon: 'Globe', title: 'Tu página web', md: 'Insertada en la página de servicios, con tu dominio permitido.', tone: 'blue' },
                    { icon: 'QrCode', title: 'Un QR en el local', md: 'En la recepción, para que reserven la próxima cita al salir.', tone: 'amber' },
                ],
            },
            {
                t: 'example',
                title: 'Un estudio de tatuajes',
                md: 'Tinta Norte, en Rosario, insertó la agenda en la página «Reservas» de su sitio, con **Sitios permitidos** `tintanorte.com.ar`, y el **Mensaje cuando no recibe reservas** dice «Estamos de vacaciones hasta el 15 de enero». Puso **Dónde es la cita** con la dirección y un enlace al mapa, que llega también en el correo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cómo dejo de recibir reservas un tiempo?', a: 'En **Publicar** toca **Dejar de recibir reservas** (o el interruptor de arriba). Las citas existentes se conservan, y la página muestra tu mensaje.' },
                    { q: '¿Se ve bien en el celular?', a: 'Sí: la página se adapta al teléfono. En la vista previa puedes cambiar a **Celular** para revisarla.' },
                    { q: '¿Qué pasa si mi empresa queda en solo lectura?', a: 'La agenda deja de recibir reservas y muestra el mensaje de cerrada, hasta que se regularice el pago.' },
                ],
            },
            { t: 'h', text: 'Medir las citas que traen tus anuncios' },
            {
                t: 'p',
                md: 'Si pautas en **Google Ads** o en **Meta**, en **Ajustes → Medir conversiones** del constructor cada cita agendada en tu sitio se vuelve una conversión de tu sitio: el evento **imagina_booking** para Google Tag Manager, tu etiqueta de conversión de Google Ads y el evento **Schedule** del píxel de Meta, con el **precio del servicio** como valor si quieres. Ahí mismo eliges guardar de qué campaña vino cada cita y llevar a la persona a una **página de gracias** con los datos de la cita: `https://tusitio.com/gracias?servicio={{cita.servicio}}&fecha={{cita.fecha}}`.',
            },
            {
                t: 'p',
                md: 'Si el anuncio lleva **directo al enlace de la agenda**, sin tu sitio de por medio, activa **Cargar mis etiquetas en el enlace directo** y pega el ID de Google Analytics (G-…) y el ID de tu píxel de Meta: la página carga el código oficial de Google y de Meta, aislado del resto de tu cuenta, y registra la cita al confirmarla.',
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Cómo medir conversiones', article: 'formularios-medir-conversiones' },
                    { label: 'Siguiente: gestionar las citas', article: 'agenda-gestionar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'agenda-gestionar',
        route: '/lists',
        related: ['agenda-que-es', 'agenda-campos-correos', 'formularios-automatizar'],
        blocks: [
            {
                t: 'p',
                md: 'Una vez publicada, la agenda trabaja sola. Tú gestionas las citas como cualquier otro registro: en la tabla, en la **vista de calendario**, en «Mi trabajo» de cada profesional y en los tableros. Y cuando algo cambia —una reserva nueva, una reprogramación, una cancelación— puedes reaccionar con una automatización.',
            },
            { t: 'anim', key: 'citas-reschedule', caption: 'El cliente cambia su cita desde el correo y el calendario de la lista se actualiza solo.' },
            { t: 'h', text: 'Ver y mover las citas' },
            {
                t: 'cards',
                items: [
                    { icon: 'CalendarDays', title: 'Vista de calendario', md: 'Una vista de calendario sobre el campo de inicio muestra el día o la semana de cada profesional. Arrastrar una cita la mueve.', tone: 'blue' },
                    { icon: 'Users', title: 'Carga de trabajo', md: 'Cuántas citas tiene cada persona por día o por semana, para repartir mejor.', tone: 'violet' },
                    { icon: 'ListTodo', title: 'Mi trabajo', md: 'Cada profesional ve sus citas asignadas, agrupadas en Hoy, Próximos 7 días y Más adelante.', tone: 'mint' },
                    { icon: 'BarChart3', title: 'Tableros', md: 'Citas por servicio, cancelaciones del mes, profesional más solicitado.', tone: 'amber' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si tu equipo mueve o cancela una cita desde la lista (cambiando la fecha o poniendo **Cancelada**), al cliente le llega el aviso, siempre que esté encendido **Avisarle al cliente si el equipo mueve o cancela su cita**. Los recordatorios se reprograman solos.',
            },
            { t: 'h', text: 'El cliente cambia o cancela' },
            {
                t: 'steps',
                items: [
                    'En su correo de confirmación (o en un recordatorio), el cliente toca **Cambiar el horario** o **Cancelar la cita**.',
                    'Se abre una página con el resumen de su cita (**Servicio**, **Con**, **Cuándo**, **Dónde**). Abrir el enlace no cambia nada: hay que confirmar.',
                    'Para cambiar, toca **Cambiar el horario**, elige otro día y hora y confirma **Sí, cambiar**. La cita queda **Reprogramada**, con la misma persona.',
                    'Para cancelar, toca **Cancelar la cita**, escribe un motivo si quiere y confirma **Sí, cancelar mi cita**. La cita queda **Cancelada** y el horario se libera.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'El aviso mínimo también vale para cambiar o cancelar: si la cita es en menos tiempo del permitido, el enlace no deja hacerlo en línea y el cliente tiene que contactarte.',
            },
            { t: 'h', text: 'Automatizar lo que sigue' },
            {
                t: 'p',
                md: 'En las automatizaciones de la lista, el disparador **Cuando se agenda, reprograma o cancela una cita** te deja elegir la **Página de agenda** (o **Cualquier agenda de esta lista**) y **Qué la dispara**: **Se agendó**, **Se reprogramó** y/o **Se canceló**. El registro es la cita, y tienes variables como `{{cita.servicio}}`, `{{cita.inicio}}`, `{{cita.persona}}`, `{{cita.cliente}}`, `{{cita.inicio_anterior}}`, `{{cita.enlace_reprogramar}}` y `{{cita.enlace_cancelar}}`.',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'MessageCircle', title: 'Confirmación por WhatsApp', md: '«Hola {{cita.cliente}}, tu {{cita.servicio}} quedó para el {{cita.inicio}} con {{cita.persona}}».', tone: 'mint' },
                    { icon: 'BellRing', title: 'Aviso al profesional', md: 'Cuando se cancela, un mensaje a quien atiende para que use ese espacio.', tone: 'amber' },
                    { icon: 'Star', title: 'Encuesta después', md: 'Con una espera hasta el día siguiente de la cita, un correo pidiendo la calificación.', tone: 'violet' },
                    { icon: 'Repeat', title: 'Recuperar la cita', md: 'El correo de cancelación ya trae **Agendar otra cita**; una automatización puede además ofrecerle un descuento por WhatsApp.', tone: 'blue' },
                ],
            },
            {
                t: 'example',
                title: 'Un centro odontológico',
                md: 'Dental Sonríe, en Arequipa, tiene una automatización **Se agendó** que manda la confirmación por WhatsApp con la dirección; otra **Se canceló** que avisa a recepción para ofrecer el espacio a la lista de espera; y una tercera que, un día después de cada cita, espera y manda la encuesta de satisfacción. El tablero muestra las cancelaciones de cada mes por profesional.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo crear una cita a mano?', a: 'Sí: crea el registro en la lista con su fecha, servicio y profesional. Ocupa el horario igual que una reserva, pero no le llega el correo de confirmación de la agenda.' },
                    { q: '¿Qué pasa si borro una cita?', a: 'Va a la papelera y el horario se libera. Si era de la agenda, sus enlaces de cambiar o cancelar dejan de servir.' },
                    { q: '¿Cada reserva cuenta como registro del plan?', a: 'Sí: cada cita es un registro y cuenta en el límite de registros de tu plan.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Volver al inicio del módulo', article: 'agenda-que-es' },
                ],
            },
        ],
    },
];
