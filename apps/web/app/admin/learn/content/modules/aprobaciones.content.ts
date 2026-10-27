import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ───────────────────────────── 1. Qué son ─────────────────────────────
    {
        id: 'aprobaciones-que-son',
        route: '/lists',
        related: ['aprobaciones-configurar', 'aprobaciones-pedir-decidir', 'equipo-y-permisos-equipos'],
        blocks: [
            {
                t: 'p',
                md: 'Hay decisiones que no puede tomar cualquiera: un gasto grande, un descuento fuera de lo normal, un contrato nuevo, una devolución de dinero. Un **flujo de aprobación** hace que ese registro no avance hasta que la persona que corresponde diga que sí. Quien lo necesita toca **Pedir aprobación** en la ficha, a quien le toca decidir le llega el aviso, y la respuesta queda escrita en el registro con quién, cuándo y por qué.',
            },
            { t: 'anim', key: 'aprob-flujo', caption: 'Un gasto pasa por el jefe directo y después por gerencia; al aprobar el último paso, el registro cambia de estado solo.' },
            { t: 'h', text: 'Las piezas' },
            {
                t: 'cards',
                items: [
                    { icon: 'Workflow', title: 'El flujo', md: 'La regla, armada una vez por lista: «Gasto mayor a $ 1.000.000», «Descuento especial». Puede haber varios flujos en la misma lista.', tone: 'amber' },
                    { icon: 'ListChecks', title: 'Los pasos', md: 'Uno o varios, **en orden**: el paso 2 empieza cuando se aprueba el 1. Cada paso dice quién decide y si basta con una persona o tienen que aprobar todas.', tone: 'violet' },
                    { icon: 'Send', title: 'La solicitud', md: 'Cada vez que alguien pide una aprobación sobre un registro nace una solicitud con su nota, su estado y el historial de decisiones.', tone: 'blue' },
                    { icon: 'CheckCircle2', title: 'La decisión', md: '**Aprobar**, **Rechazar** o **Devolver** (para que se corrija). Al aprobar el último paso o al rechazar, se pueden escribir campos solos.', tone: 'mint' },
                ],
            },
            { t: 'h', text: 'Los estados de una solicitud' },
            {
                t: 'settings',
                title: 'Por dónde pasa cada solicitud',
                rows: [
                    { name: 'Pendiente', what: 'Se pidió y espera la decisión del paso en curso. En la ficha se ve «Paso 1 de 2» y quién falta.', tip: 'Mientras hay una pendiente de un flujo, no se puede pedir otra del mismo flujo sobre ese registro.' },
                    { name: 'Aprobada', what: 'Se aprobó el último paso. Se escriben los campos de **Al aprobar, poner**.' },
                    { name: 'Rechazada', what: 'Alguien de un paso rechazó (con su motivo). Se escriben los campos de **Al rechazar, poner**.', tip: 'Si el flujo no permite pedir otra vez, el registro queda así.' },
                    { name: 'Devuelta', what: 'Quien decide pidió una corrección. Quien la pidió arregla lo que haga falta y la vuelve a pedir.', tip: '«Devolver» siempre deja pedir de nuevo, aunque el flujo no permita repetir tras un rechazo.' },
                    { name: 'Cancelada', what: 'Quien la pidió (o un administrador) la retiró antes de que se decidiera, con **Cancelar la solicitud**.' },
                ],
            },
            { t: 'anim', key: 'aprob-decidir', caption: '«Devolver» con un motivo: la solicitud queda «Devuelta» y quien la pidió sabe qué corregir.' },
            { t: 'h', text: 'Ejemplos de negocio' },
            {
                t: 'example',
                title: 'Gastos de viaje en una empresa de 20 personas',
                md: 'Lista **Gastos** con un campo Persona «Jefe directo». Flujo «Gasto mayor a $ 1.000.000» con dos pasos: primero el **Jefe directo** del registro (cualquiera aprueba), después **Gerencia** (rol, todos aprueban). Al aprobar, **Estado** pasa a «Aprobado»; al rechazar, a «Rechazado».',
            },
            {
                t: 'example',
                title: 'Descuentos en ventas',
                md: 'En **Oportunidades**, un flujo «Descuento mayor al 15 %» con un solo paso: la gerente comercial (persona puntual). Los vendedores lo piden desde la ficha con una nota («El cliente paga el año completo») y la gerente decide desde su celular, en el correo.',
            },
            {
                t: 'example',
                title: 'Contratos que firma el área legal',
                md: 'En **Contratos**, un paso con el equipo **Legal**: decide cualquiera de las personas del equipo que pueda ver el registro en ese momento. Si cambia la gente del equipo, cambia quién puede aprobar, sin tocar el flujo.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Lo que una aprobación no hace',
                md: 'No bloquea editar el registro: mientras está pendiente, el registro se sigue pudiendo cambiar. Si necesitas que nadie toque el monto mientras se decide, quítale el permiso de edición a ese rol en la lista o usa una automatización que avise si cambia.',
            },
            { t: 'h', text: 'Quién hace qué' },
            {
                t: 'settings',
                rows: [
                    { name: 'Crear y editar flujos', what: 'Quien puede configurar la lista (administración de listas).' },
                    { name: 'Pedir una aprobación', what: 'Quien puede **editar** ese registro.' },
                    { name: 'Decidir', what: 'Las personas del paso en curso, calculadas en el momento: si cambias el «Jefe directo» del registro, decide el de ahora. Además tienen que poder ver el registro.' },
                    { name: 'Cancelar', what: 'Quien la pidió o un administrador.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo aprobar lo que pedí yo?', a: 'Por defecto no, aunque seas aprobador de ese paso. Se puede permitir en el flujo con **Quien pide puede aprobar su propia solicitud**, pero conviene dejarlo apagado.' },
                    { q: '¿Una persona invitada o un cliente del portal puede aprobar?', a: 'No. Sólo deciden personas del equipo de trabajo.' },
                    { q: '¿Qué pasa con las pendientes si borro el registro?', a: 'Se cancelan. Si lo recuperas de la papelera, no vuelven a quedar pendientes: hay que pedirlas otra vez.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Crear un flujo paso a paso', article: 'aprobaciones-configurar' },
                    { label: 'Cómo se pide y se decide', article: 'aprobaciones-pedir-decidir' },
                    { label: 'Ir a mis aprobaciones', to: '/my-work?tab=approvals' },
                ],
            },
        ],
    },

    // ─────────────────────────── 2. Configurar ───────────────────────────
    {
        id: 'aprobaciones-configurar',
        route: '/lists',
        related: ['aprobaciones-pedir-decidir', 'equipo-y-permisos-equipos', 'equipo-y-permisos-roles-propios'],
        blocks: [
            {
                t: 'p',
                md: 'Los flujos se arman en los **ajustes de cada lista**, una vez. Desde ahí en adelante, la ficha de cada registro muestra **Pedir aprobación** y las automatizaciones de esa lista pueden pedirlos solas.',
            },
            { t: 'h', text: 'Crear el flujo' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y toca **Configurar lista** (o el «…» de la lista en el menú → **Ajustes**).',
                    'Entra a la pestaña **Aprobaciones** y toca **Nuevo flujo**.',
                    'Escribe el **Nombre** (que diga cuándo se usa: «Gasto mayor a $1M») y, si quieres, una **Descripción**.',
                    'En **Pasos (en orden)** define cada paso: su nombre, **Quién aprueba** y **Cómo se aprueba**. Con **Agregar un paso** sumas otro; con **Subir** y **Bajar** cambias el orden.',
                    'Elige qué campos se escriben solos en **Al aprobar, poner** y **Al rechazar, poner**.',
                    'Revisa las reglas del final y toca **Crear flujo**.',
                ],
            },
            { t: 'demo', key: 'aprob-crear-flujo', caption: 'De los ajustes de la lista a un flujo nuevo, listo para pedir.', fallback: 'aprob-flujo' },
            { t: 'h', text: 'Quién aprueba cada paso' },
            {
                t: 'cards',
                items: [
                    { icon: 'UserCheck', title: 'Un campo Persona del registro', md: 'Decide la persona que está en ese campo: el «Jefe directo», el «Responsable de la cuenta». Cambia de registro a registro y siempre se lee en vivo.', tone: 'blue' },
                    { icon: 'Shield', title: 'Todas las personas con un rol', md: 'Cualquiera con ese rol (Gerente, Agente…). Incluye a quien tiene un rol propio basado en ese rol.', tone: 'violet' },
                    { icon: 'Users', title: 'Personas puntuales', md: 'Las personas que elijas por nombre. Útil cuando decide alguien fijo, como la gerente financiera.', tone: 'amber' },
                    { icon: 'UserPlus', title: 'Un equipo', md: 'Las personas del equipo en ese momento que puedan ver el registro. Si entra o sale alguien del equipo, no hay que tocar el flujo.', tone: 'mint' },
                ],
            },
            {
                t: 'settings',
                title: 'Todos los ajustes del flujo',
                rows: [
                    { name: 'Nombre', what: 'Lo que se ve al pedir la aprobación y en los avisos.', tip: 'Que diga el caso: «Descuento mayor al 15 %», no «Flujo 1».' },
                    { name: 'Descripción (opcional)', what: 'Cuándo se usa, para quien lo pide.' },
                    { name: 'Nombre del paso', what: 'Opcional («Jefe directo», «Gerencia»). Se muestra en la ficha y en los avisos («paso 1 de 2»).' },
                    { name: 'Quién aprueba', what: 'Campo Persona, rol, personas puntuales o equipo (ver arriba).' },
                    { name: 'Cómo se aprueba', what: '**Cualquiera aprueba**: basta la primera persona que apruebe. **Todos aprueban**: el paso pasa cuando aprueban todas; mientras tanto la ficha dice «Falta que aprueben: …».', tip: 'Con «Todos aprueban», un solo rechazo rechaza la solicitud.' },
                    { name: 'Al aprobar, poner', what: 'Campos que se escriben cuando se aprueba el **último** paso (Estado = Aprobado, Fecha de aprobación = hoy…).' },
                    { name: 'Al rechazar, poner', what: 'Campos que se escriben cuando alguien rechaza.' },
                    { name: 'Se puede pedir otra vez tras un rechazo', what: 'Si está apagado, un registro rechazado queda así. «Devolver» siempre permite corregir y pedir de nuevo.' },
                    { name: 'Quien pide puede aprobar su propia solicitud', what: 'Apagado (recomendado): aunque sea aprobador del paso, no decide sobre lo que pidió.' },
                    { name: 'Activo (se puede pedir)', what: 'Apagado, el flujo no se ofrece al pedir. Las pendientes siguen su curso.' },
                    { name: 'Agregar la columna «Aprobación» a la tabla', what: 'Crea una columna con el estado de la última solicitud, para filtrar y agrupar.' },
                ],
            },
            { t: 'anim', key: 'aprob-flujo', caption: 'Dos pasos en orden: cualquiera del primero, todos los del segundo.' },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Un campo de estado propio',
                md: 'Si quieres que la tabla diga «Aprobado» o «Rechazado» con tus palabras, crea un campo de selección «Estado del gasto» con esas opciones y úsalo en **Al aprobar, poner** y **Al rechazar, poner**. La columna **Aprobación** sigue existiendo para filtrar por el estado de la solicitud.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Cambiar o borrar un flujo',
                md: 'Las solicitudes que ya están pendientes siguen con la configuración con la que se pidieron: los cambios valen para las nuevas. Si borras un flujo con solicitudes pendientes, se cancelan; el historial de las ya resueltas se conserva en la actividad de cada registro.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Me dice «Nadie puede aprobar este paso ahora». ¿Qué pasó?', a: 'El paso no tiene a quién preguntarle: el campo Persona del registro está vacío, nadie tiene ese rol, o las personas elegidas no pueden ver el registro. Completa el campo o revisa el flujo.' },
                    { q: '¿Cuántos pasos puede tener un flujo?', a: 'Los que necesites, aunque lo habitual son uno o dos. Cada paso más es un día más de espera para quien pide.' },
                    { q: '¿Puedo tener un flujo distinto según el monto?', a: 'Sí: crea dos flujos («Hasta $ 1M» y «Más de $ 1M») y usa una automatización que pida uno u otro según el monto. Lo ves en «Aprobaciones en automatizaciones».' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Pedir y decidir', article: 'aprobaciones-pedir-decidir' },
                    { label: 'Pedirlas desde una automatización', article: 'aprobaciones-automatizaciones' },
                    { label: 'Armar equipos', article: 'equipo-y-permisos-equipos' },
                ],
            },
        ],
    },

    // ──────────────────────── 3. Pedir y decidir ────────────────────────
    {
        id: 'aprobaciones-pedir-decidir',
        route: '/my-work?tab=approvals',
        related: ['aprobaciones-seguimiento', 'mi-dia-mi-trabajo', 'fichas-abrir'],
        blocks: [
            {
                t: 'p',
                md: 'Una vez que la lista tiene un flujo, pedir y decidir son dos o tres toques. Quien pide lo hace desde la ficha del registro; quien decide puede hacerlo desde la misma ficha, desde **Mi trabajo** o desde el correo que le llega.',
            },
            { t: 'h', text: 'Pedir la aprobación' },
            {
                t: 'steps',
                items: [
                    'Abre la ficha del registro (un gasto, una oportunidad, un contrato).',
                    'En la sección **Aprobación**, toca **Pedir aprobación**.',
                    'Elige el flujo (si la lista tiene uno solo, ya viene elegido).',
                    'Escribe una **Nota para quienes aprueban (opcional)**: el contexto que les ahorra preguntar («Es el gasto del viaje a Medellín»).',
                    'Toca **Pedir aprobación**. A quienes deciden el primer paso les llega el aviso.',
                ],
            },
            { t: 'demo', key: 'aprob-pedir', caption: 'Desde la ficha: flujo, nota y listo.', fallback: 'aprob-decidir' },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si el botón no se puede usar, al lado se ve el motivo: «Ya hay una solicitud pendiente de este flujo», «Se rechazó y este flujo no deja pedirla otra vez» o «Para pedir una aprobación tienes que poder editar el registro».',
            },
            { t: 'h', text: 'Decidir desde la ficha' },
            {
                t: 'p',
                md: 'Cuando te toca, la ficha muestra **Pendiente de tu aprobación** con tres botones. **Aprobar** pasa al paso siguiente (o cierra la solicitud si era el último). **Rechazar** pide el **Motivo del rechazo**, que ve quien la pidió. **Devolver** pide **Qué hay que corregir** y le deja a quien la pidió volver a pedirla cuando lo arregle.',
            },
            { t: 'anim', key: 'aprob-decidir', caption: 'Devolver con un motivo: quien pidió recibe el aviso y sabe qué corregir.' },
            {
                t: 'settings',
                title: 'Cuándo usar cada botón',
                rows: [
                    { name: 'Aprobar', what: 'Está bien como está. Si el paso es de «Todos aprueban», tu aprobación cuenta y se espera al resto.' },
                    { name: 'Rechazar', what: 'La respuesta es no. Se escriben los campos de **Al rechazar, poner**.', tip: 'Escribe un motivo claro: es lo único que verá quien pidió.' },
                    { name: 'Devolver', what: 'Puede ser que sí, pero falta algo (la factura, una firma, un monto corregido).', tip: 'Es la opción más amable para errores que se pueden arreglar: no cuenta como rechazo.' },
                ],
            },
            { t: 'h', text: 'Todo lo que te toca, en «Mi trabajo»' },
            {
                t: 'p',
                md: 'En **Mi trabajo** → pestaña **Aprobaciones** se juntan las solicitudes de todas las listas. Arriba, **Esperan tu decisión** (con los mismos botones); abajo, **Lo que pediste**, con el paso en el que va cada una. La pestaña muestra un contador cuando tienes algo pendiente.',
            },
            { t: 'demo', key: 'aprob-mi-trabajo', caption: 'Las aprobaciones de todas las listas en un solo lugar.', fallback: 'aprob-decidir' },
            { t: 'h', text: 'Decidir desde el correo' },
            {
                t: 'p',
                md: 'El aviso por correo trae **Aprobar**, **Rechazar** y **Abrir el registro**. Al tocar uno se abre la app en **Confirma tu decisión**: revisas la solicitud y confirmas con tu sesión. Nada se decide con sólo abrir el enlace, así un correo reenviado no aprueba nada. Si no tienes la sesión abierta, primero entras y vuelves a la misma pantalla.',
            },
            { t: 'anim', key: 'aprob-correo', caption: 'Del correo a la app: se confirma con tu sesión.' },
            { t: 'h', text: 'Cancelar una solicitud' },
            {
                t: 'p',
                md: 'Si te equivocaste de flujo o ya no hace falta, en la ficha toca **Cancelar la solicitud** y escribe el **Motivo de la cancelación** (opcional). Lo pueden hacer quien la pidió y quien administra la empresa. A quienes esperaban decidir les desaparece de sus pendientes.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Me llegó el aviso pero la ficha dice que ahora no me toca. ¿Por qué?', a: 'Ya diste tu aprobación en ese paso, otra persona ya lo resolvió, o cambió el aprobador (por ejemplo, le cambiaron el «Jefe directo» al registro). Decide siempre quien corresponde en ese momento.' },
                    { q: 'Dos personas tocaron Aprobar al mismo tiempo. ¿Se aprobó dos veces?', a: 'No. Se guarda la primera decisión; a la otra persona le aparece que la solicitud ya cambió.' },
                    { q: '¿Puedo decidir desde el celular?', a: 'Sí: desde el correo, desde la notificación o desde Mi trabajo. Si instalas la app en el teléfono te llega un aviso del sistema.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir mis aprobaciones', to: '/my-work?tab=approvals' },
                    { label: 'Avisos y seguimiento', article: 'aprobaciones-seguimiento' },
                    { label: 'Recorrido por la ficha', tour: 'record' },
                ],
            },
        ],
    },

    // ───────────────────────────── 4. Seguimiento ─────────────────────────────
    {
        id: 'aprobaciones-seguimiento',
        route: '/lists',
        related: ['vistas-filtros-y-orden', 'mi-dia-avisos', 'fichas-actividad-historial'],
        blocks: [
            {
                t: 'p',
                md: 'Una aprobación sirve si se sabe en qué va. La app lo muestra en tres lugares: una columna para filtrar la lista, los avisos a cada persona y el historial dentro del registro.',
            },
            { t: 'h', text: 'La columna «Aprobación»' },
            {
                t: 'p',
                md: 'Al crear el flujo, la casilla **Agregar la columna «Aprobación» a la tabla** suma un campo con el estado de la **última** solicitud de cada registro: Pendiente, Aprobada, Rechazada, Devuelta o Cancelada. Nadie lo escribe a mano: cambia solo con cada decisión. Además, la fila y la tarjeta del kanban muestran un indicador cuando hay una aprobación pendiente.',
            },
            { t: 'anim', key: 'aprob-columna', caption: 'Un filtro «Aprobación es Pendiente» deja a la vista lo que todavía espera decisión.' },
            {
                t: 'settings',
                title: 'Qué puedes hacer con esa columna',
                rows: [
                    { name: 'Filtrar', what: '«Aprobación es Pendiente» para ver lo que falta decidir; «es Rechazada» para lo que hay que revisar.' },
                    { name: 'Agrupar y ordenar', what: 'Una vista agrupada por Aprobación muestra de un vistazo cuánto hay en cada estado.' },
                    { name: 'Tableros', what: 'Un gráfico de dona por Aprobación, o un indicador «Pendientes» con ese filtro.' },
                    { name: 'Exportar', what: 'Sale en el Excel o CSV como un dato más.' },
                ],
            },
            { t: 'h', text: 'Tu tablero de pendientes: «Mi trabajo»' },
            {
                t: 'p',
                md: 'Si apruebas en varias listas, no tienes que recorrerlas: **Mi trabajo** → **Aprobaciones** junta todo lo que espera tu decisión y lo que pediste tú. Cada fila dice de qué lista es, quién lo pidió, la nota y en qué paso va; desde ahí decides sin abrir el registro, o lo abres si necesitas ver más.',
            },
            { t: 'demo', key: 'aprob-mi-trabajo', caption: 'Lo que espera tu decisión, de todas las listas, en una pestaña.', fallback: 'aprob-decidir' },
            { t: 'h', text: 'Los avisos' },
            {
                t: 'cards',
                items: [
                    { icon: 'BellRing', title: 'Te toca aprobar', md: 'A quienes deciden el paso, cuando empieza. Llega a la campana, por correo (con los botones) y, si instalaste la app, como notificación del teléfono.', tone: 'amber' },
                    { icon: 'CheckCircle2', title: 'Se resolvió', md: 'A quien la pidió, cuando se aprueba, se rechaza o se devuelve, con el motivo si lo hay.', tone: 'mint' },
                    { icon: 'Settings', title: 'Tus preferencias', md: 'En **Ajustes** → **Avisos** eliges si las aprobaciones te llegan también por correo y como notificación. Por defecto, sí.', tone: 'blue' },
                ],
            },
            { t: 'anim', key: 'aprob-correo', caption: 'El correo trae los botones; la decisión se confirma en la app con tu sesión.' },
            { t: 'h', text: 'El historial' },
            {
                t: 'p',
                md: 'La sección **Aprobación** de la ficha muestra la solicitud en curso con sus pasos («Paso 1 de 2», quién pidió, la nota, quién falta). Las anteriores quedan en **Ver solicitudes anteriores**, y cada decisión queda en la actividad del registro en lenguaje claro: «Ana aprobó el paso 1 de 2», «Carlos rechazó: falta la factura».',
            },
            {
                t: 'example',
                title: 'Un indicador en el tablero de gerencia',
                md: 'En el tablero de la empresa, un indicador «Gastos por aprobar» que cuenta los registros de **Gastos** con **Aprobación** = Pendiente, y una dona de los últimos 30 días por estado de aprobación. De un vistazo se ve si las aprobaciones se están quedando atascadas.',
            },
            {
                t: 'example',
                title: 'La reunión de los lunes',
                md: 'Una vista guardada «Gastos por aprobar» con el filtro **Aprobación es Pendiente**, ordenada por monto de mayor a menor. Gerencia la abre los lunes y en diez minutos sabe qué está frenado y por qué.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Borré el flujo. ¿Pierdo el historial?', a: 'No: lo que ya se decidió queda en la actividad de cada registro.' },
                    { q: 'No me llegan los correos de aprobación.', a: 'Revisa en **Ajustes** → **Avisos** que estén encendidos, y que el correo de la empresa esté configurado. En la campana siempre aparecen.' },
                    { q: '¿Quién ve la columna «Aprobación»?', a: 'Quien puede ver la lista. Es un dato de sólo lectura: nadie lo cambia a mano, ni siquiera quien administra la empresa.' },
                    { q: 'Una solicitud lleva días pendiente. ¿Cómo insisto?', a: 'Abre la ficha: dice quién falta. Puedes escribirle en los comentarios con una @mención, o armar una automatización con **Esperar aprobación** y un tope de días que avise a gerencia si nadie decide.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Elegir mis avisos', to: '/settings?s=avisos' },
                    { label: 'Filtrar una lista', article: 'vistas-filtros-y-orden' },
                ],
            },
        ],
    },

    // ───────────────────────── 5. En automatizaciones ─────────────────────────
    {
        id: 'aprobaciones-automatizaciones',
        route: '/lists',
        related: ['automatizaciones-logica', 'automatizaciones-disparadores', 'aprobaciones-configurar'],
        blocks: [
            {
                t: 'p',
                md: 'Las aprobaciones se combinan con las automatizaciones en tres piezas: una acción para **pedirla**, un paso para **esperarla** y un disparador para reaccionar **cuando se decide**. Así un gasto grande pide la aprobación solo, y cuando gerencia aprueba se genera el PDF y se avisa a contabilidad, sin que nadie se acuerde.',
            },
            { t: 'anim', key: 'aprob-automatizacion', caption: 'Un gasto nuevo pide la aprobación, la espera y sigue por un camino según el resultado.' },
            { t: 'h', text: 'Las tres piezas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Acción «Pedir aprobación»', what: 'Pide un flujo de la lista sobre el registro, con una nota opcional (acepta variables).', tip: 'En la ficha se ve «Lo pidió una automatización».' },
                    { name: 'Paso «Esperar aprobación»', what: 'La automatización se detiene hasta que la solicitud se resuelve. En **Esperar la solicitud de** eliges el flujo, o «La que pidió esta automatización (o cualquiera pendiente)».' },
                    { name: 'Tope de días', what: '**Si no se resuelve en** N días, la automatización sigue con el resultado «vencida». Vacío: espera sin tope.', tip: 'Útil para insistir o escalar: «si en 3 días nadie decidió, avisa a gerencia».' },
                    { name: 'Disparador «Cuando se aprueba o se rechaza»', what: 'Arranca una automatización cuando se resuelve una solicitud. Eliges el flujo (o **Cualquier flujo de esta lista**) y **Cuando la solicitud queda**: Aprobada, Rechazada, Devuelta o Cancelada.', tip: 'Si no marcas nada, corre al aprobar y al rechazar.' },
                ],
            },
            { t: 'anim', key: 'auto-espera', caption: 'Como cualquier espera: la corrida queda «En espera hasta…» en el historial y se cancela sola si el registro se borra.' },
            { t: 'h', text: 'Decidir según el resultado' },
            {
                t: 'p',
                md: 'Después de **Esperar aprobación**, agrega un **Si / sino** con la condición **Resultado de la aprobación** es «Aprobada». En la rama «Sí» van los pasos del camino feliz; en «Si no», lo que pasa si se rechaza, se devuelve o se vence. El resultado también está como variable para los correos y mensajes.',
            },
            {
                t: 'settings',
                title: 'Variables que deja una aprobación',
                rows: [
                    { name: '{{aprobacion.resultado}}', what: 'aprobada, rechazada, devuelta, cancelada o vencida.' },
                    { name: '{{aprobacion.flujo}}', what: 'El nombre del flujo.' },
                    { name: '{{aprobacion.motivo}}', what: 'El motivo del rechazo o de la devolución.' },
                    { name: '{{aprobacion.decidio}}', what: 'Quién decidió.' },
                    { name: '{{aprobacion.solicito}}', what: 'Quién pidió la aprobación.' },
                    { name: '{{aprobacion.nota}}', what: 'La nota de la solicitud.' },
                ],
            },
            { t: 'h', text: 'Receta: gastos grandes con aprobación' },
            {
                t: 'steps',
                items: [
                    'En **Gastos**, crea el flujo «Gasto mayor a $ 1.000.000» con los pasos que necesites.',
                    'Crea una automatización **Cuando se crea un registro** con la condición «Monto mayor que 1000000».',
                    'Agrega **Pedir aprobación** con ese flujo y la nota «Gasto de {{solicitante}}: {{concepto}}».',
                    'Agrega **Esperar aprobación** con un tope de 5 días.',
                    'Agrega un **Si / sino** con **Resultado de la aprobación** es «Aprobada».',
                    'En «Sí»: **Generar un PDF** con el comprobante y **Enviar email** a contabilidad. En «Si no»: **Enviar email** a quien lo pidió con {{aprobacion.motivo}}.',
                    'Toca **Probar** sobre un gasto real y, en **Probar como si la aprobación quedara**, elige Aprobada, Rechazada o Vencida para ver cada camino sin pedir nada.',
                ],
            },
            {
                t: 'example',
                title: 'Avisar al cliente que su descuento se aprobó',
                md: 'En **Oportunidades**: disparador **Cuando se aprueba o se rechaza**, flujo «Descuento mayor al 15 %», sólo **Aprobada** → **Enviar email** al cliente: «Hola {{cliente}}, te confirmamos el descuento de {{descuento}} %». Así el vendedor no tiene que estar pendiente.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: '¿Esperar o disparar?',
                md: 'Usa **Esperar aprobación** cuando la misma automatización pide y continúa (todo queda en una sola corrida, fácil de seguir en el historial). Usa el disparador **Cuando se aprueba o se rechaza** cuando la aprobación la pide una persona desde la ficha y quieres reaccionar a cualquier decisión.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué pasa con la espera si borran el registro o pausan la automatización?', a: 'La espera se cancela con el motivo en el historial. Al reactivarla no se retoma: corre de nuevo con los próximos disparos.' },
                    { q: '¿Una automatización puede aprobar sola?', a: 'No. Las decisiones siempre las toma una persona; una automatización sólo pide, espera y reacciona.' },
                    { q: '¿Y si el registro ya tiene una solicitud pendiente de ese flujo?', a: '**Pedir aprobación** no pide otra: usa la que ya estaba (el historial lo dice), y **Esperar aprobación** espera esa.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ramas, condiciones y esperas', article: 'automatizaciones-logica' },
                    { label: 'Todos los disparadores', article: 'automatizaciones-disparadores' },
                    { label: 'Recorrido de automatizaciones', tour: 'automation-basics' },
                ],
            },
        ],
    },
];
