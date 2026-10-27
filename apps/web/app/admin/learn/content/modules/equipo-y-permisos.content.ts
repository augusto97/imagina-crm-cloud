import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'equipo-y-permisos-invitar',
        route: '/settings?s=miembros',
        related: ['equipo-y-permisos-roles-propios', 'equipo-y-permisos-permisos-lista', 'equipo-y-permisos-invitados'],
        blocks: [
            {
                t: 'p',
                md: 'La app se vuelve útil de verdad cuando todo tu equipo trabaja en el mismo lugar: la vendedora carga sus oportunidades, el bodeguero actualiza el inventario y tú ves todo en un tablero. Para eso, cada persona necesita su propia cuenta dentro de tu empresa, con un **rol** que dice qué puede hacer.\n\nEn **Ajustes → Miembros** invitas a cada persona por correo. Si todavía no tiene cuenta, la app se la crea y le manda un enlace para definir su contraseña; si ya tenía cuenta (porque trabaja con otra empresa que usa la app), queda sumada al instante. Esta sección sólo la ve quien tiene el rol **Admin**.',
            },
            {
                t: 'anim',
                key: 'equipo-invite',
                caption: 'Escribes el correo, eliges el rol y tocas «Invitar»: la persona queda con «Invitación pendiente» hasta que define su contraseña.',
            },
            { t: 'h', text: 'Cómo invitar a alguien' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes** desde el menú de tu cuenta (tu avatar, arriba a la derecha) y entra a **Miembros**.',
                    'En **Email** escribe el correo de la persona. Si no tiene cuenta, completa también **Nombre (si no tiene cuenta)**: así la reconoces en la lista desde el primer día.',
                    'En **Rol** elige qué va a poder hacer (abajo te explicamos cada uno). Si creaste roles propios, aparecen en el mismo menú bajo **Roles propios**.',
                    'Toca **Invitar**. Verás el aviso «Invitación enviada a…» y la persona aparece en la lista con la etiqueta **Invitación pendiente**.',
                    'Cuando abra el correo y defina su contraseña, la etiqueta desaparece y ya puede entrar. El enlace del correo vence en **7 días**.',
                ],
            },
            {
                t: 'demo',
                key: 'equipo-invitar',
                caption: 'Invitar a una persona desde Ajustes → Miembros.',
                fallback: 'equipo-invite',
            },
            { t: 'h', text: 'Qué puede hacer cada rol' },
            {
                t: 'p',
                md: 'Hay cuatro roles fijos para tu equipo. El rol define dos cosas: **qué módulos** puede tocar (crear listas, automatizaciones, tableros…) y **qué registros** ve por defecto en cada lista. Lo segundo se puede afinar lista por lista en **Permisos**, así que no hace falta elegir el rol perfecto para todo.',
            },
            {
                t: 'settings',
                title: 'Los roles fijos',
                rows: [
                    {
                        name: 'Admin',
                        what: 'Todo, incluidos miembros, plan, marca, correo y cualquier lista. Siempre tiene acceso total a todas las listas.',
                        tip: 'Dale este rol sólo a quien de verdad administra la empresa: dueño, gerente o la persona de sistemas. Conviene que haya al menos dos.',
                    },
                    {
                        name: 'Manager',
                        what: 'Trabaja con todos los registros, arma vistas y tableros, importa, exporta y hace ediciones masivas. No cambia la estructura de las listas ni las automatizaciones.',
                        tip: 'Ideal para coordinadores y jefes de área que necesitan ver todo y ordenar el trabajo.',
                    },
                    {
                        name: 'Agente',
                        what: 'Trabaja con sus registros: los que creó (y los que tiene asignados, si la lista lo configura). Crea, edita y borra lo suyo.',
                        tip: 'El rol típico de vendedores, asesores, técnicos de campo y personal de soporte.',
                    },
                    {
                        name: 'Lector',
                        what: 'Mira los registros y los tableros, sin cambiar nada. Puede exportar lo que ve.',
                        tip: 'Para socios, contadores internos o gerencia que sólo consulta.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Clientes del portal e invitados no se manejan aquí',
                md: 'Los **clientes del portal** se dan de alta desde la ficha de cada registro, y las **personas de afuera** (un proveedor, un contador externo) se invitan desde **Compartir** de una lista o de un registro. Las ves en la tarjeta **Invitados**, debajo de los miembros. Ninguno de los dos ocupa un usuario de tu plan.',
            },
            {
                t: 'h',
                text: 'Invitaciones pendientes, reenviar, cambiar rol y quitar',
            },
            {
                t: 'settings',
                title: 'Lo que puedes hacer en cada fila de la lista',
                rows: [
                    {
                        name: 'Invitación pendiente',
                        what: 'La persona todavía no definió su contraseña. Ya cuenta como miembro (ocupa su lugar en el plan) y ya puedes asignarle registros.',
                        tip: 'Si te dice que no le llegó nada, primero pídele que revise la carpeta de spam.',
                    },
                    {
                        name: 'Reenviar',
                        what: 'Manda un enlace nuevo para definir la contraseña (vale otros 7 días). Al tocarlo cambia a «Reenviada».',
                        tip: 'Hay un freno de unos pocos reenvíos por hora para que nadie use el botón como spam.',
                    },
                    {
                        name: 'Selector de rol',
                        what: 'Cambia el rol al instante, sin que la persona tenga que salir y volver a entrar.',
                        tip: 'Puedes pasar a alguien de Agente a Manager durante unas vacaciones de su jefe y volverlo después.',
                    },
                    {
                        name: 'Quitar (la X)',
                        what: 'Deja de tener acceso a esta empresa al instante. Su cuenta y lo que escribió quedan; puedes volver a sumarla cuando quieras.',
                        tip: 'Quitar NO borra sus registros ni sus comentarios: siguen siendo de la empresa.',
                    },
                    {
                        name: 'Desactivada',
                        what: 'La cuenta de la persona fue desactivada por el operador de la plataforma: no puede entrar a ninguna empresa.',
                        tip: 'Si crees que es un error, contacta al soporte de la plataforma.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Lo que la app no te deja hacer (a propósito)',
                md: '- **Dejar a la empresa sin administrador**: no puedes quitarle el rol Admin ni sacar al último admin.\n- **Quitarte a ti mismo**: para irte de una empresa, pídele a otro admin que te quite.\n- **Pasarte del límite de usuarios de tu plan**: si el plan permite 10 personas y ya hay 10 (contando las invitaciones pendientes), la invitación se rechaza con el motivo. Mira tu consumo en **Ajustes → Plan y uso**.',
            },
            { t: 'h', text: 'Ejemplos de cómo organizar los roles' },
            {
                t: 'example',
                title: 'Una ferretería con dos sucursales',
                md: 'El dueño y la administradora son **Admin**. Los dos jefes de tienda son **Manager**: ven todas las ventas y arman los tableros de su sucursal. Los cuatro vendedores son **Agente**: cada uno ve y actualiza sus cotizaciones. El contador, que pasa una vez al mes, es **Lector**.',
            },
            {
                t: 'example',
                title: 'Una clínica odontológica',
                md: 'La gerente es **Admin**; la recepcionista, **Manager** (agenda citas de todos los odontólogos y ve la cartera); cada odontólogo, **Agente** (ve sólo a sus pacientes asignados, ver el artículo sobre asignados). El socio inversionista entra como **Lector** a mirar los tableros.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Qué pasa si invito a alguien que ya usa la app en otra empresa?',
                        a: 'Queda sumada al instante, con la misma contraseña de siempre. Cuando entre verá un selector para cambiar de empresa.',
                    },
                    {
                        q: '¿Puedo invitar a varias personas a la vez?',
                        a: 'Se invitan una por una: el correo, el rol y «Invitar». Toma pocos segundos por persona.',
                    },
                    {
                        q: 'Le llegó el correo pero el enlace dice que venció.',
                        a: 'Los enlaces duran 7 días. Toca «Reenviar» en su fila y pídele que use el correo más reciente.',
                    },
                    {
                        q: '¿Una invitación pendiente ocupa un usuario del plan?',
                        a: 'Sí: la cuenta ya existe dentro de tu empresa. Si no la vas a usar, quítala con la X.',
                    },
                    {
                        q: '¿Puedo ver quién invitó o quitó a alguien?',
                        a: 'Sí, en **Ajustes → Registro de actividad** queda cada alta, cambio de rol y baja, con quién lo hizo y cuándo.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Miembros', to: '/settings?s=miembros' },
                    { label: 'Ver el recorrido', tour: 'invite-team' },
                    {
                        label: 'Roles propios',
                        article: 'equipo-y-permisos-roles-propios',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'equipo-y-permisos-roles-propios',
        route: '/settings?s=roles',
        related: ['equipo-y-permisos-invitar', 'equipo-y-permisos-permisos-lista', 'equipo-y-permisos-recetas'],
        blocks: [
            {
                t: 'p',
                md: 'Los cuatro roles fijos cubren a casi todos, pero siempre aparece un caso intermedio: un **Agente** que además necesita exportar a Excel, un **Supervisor** que ve los registros de todos pero no puede borrarlos, o un **Lector** que no debería ver los tableros de ventas. Para eso existen los **roles propios**.\n\nUn rol propio se crea a partir de uno de los fijos (Manager, Agente o Lector) y le prendes o apagas, una por una, las cosas que puede hacer en cada parte de la app. Se arman en **Ajustes → Roles** (sólo el Admin).',
            },
            {
                t: 'anim',
                key: 'equipo-roles-custom',
                caption: 'El rol «Supervisor» nace basado en Agente y gana dos capacidades: ver todos los registros y crear tableros.',
            },
            { t: 'h', text: 'Crear un rol propio' },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Roles** y toca **Nuevo rol**.',
                    'Escribe el **Nombre** (por ejemplo «Supervisor» o «Contador»), una **Descripción (opcional)** y elige un **Color** para reconocerlo en las listas.',
                    'En **Basado en** elige el rol fijo de partida: Manager, Agente o Lector. Las casillas de abajo se marcan con lo que ese rol ya puede hacer.',
                    'En **Qué puede hacer** prende o apaga lo que necesites. Cada casilla explica en una línea lo que permite.',
                    'Toca **Crear rol**. Desde ese momento aparece en el selector de rol de **Miembros**, bajo **Roles propios**.',
                ],
            },
            {
                t: 'demo',
                key: 'equipo-roles',
                caption: 'Ajustes → Roles: los roles fijos y el formulario de un rol nuevo.',
                fallback: 'equipo-roles-custom',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'El rol base y las casillas hacen cosas distintas',
                md: 'El **rol base** decide qué registros ve por defecto en cada lista (todos, los suyos…). Las **casillas** deciden qué puede hacer en la app. Por eso, para cambiar la base hay que crear otro rol: un rol «basado en Agente» siempre arranca viendo lo suyo en cada lista, aunque le prendas «Ver todos los registros» (esa casilla le abre las listas donde los permisos lo permitan).',
            },
            { t: 'h', text: 'Todas las capacidades, por módulo' },
            {
                t: 'settings',
                title: 'Registros',
                rows: [
                    {
                        name: 'Ver todos los registros',
                        what: 'Ve todos los registros de las listas (según los permisos de cada lista).',
                        tip: 'Para supervisores que revisan el trabajo de todo el equipo.',
                    },
                    {
                        name: 'Ver sus registros',
                        what: 'Ve los registros que creó o tiene asignados.',
                    },
                    { name: 'Crear registros', what: 'Da de alta registros nuevos.' },
                    {
                        name: 'Editar cualquier registro',
                        what: 'Cambia los datos de cualquier registro que ve.',
                    },
                    {
                        name: 'Editar sus registros',
                        what: 'Cambia los registros que creó o tiene asignados.',
                    },
                    {
                        name: 'Eliminar cualquier registro',
                        what: 'Manda a la papelera cualquier registro que ve.',
                        tip: 'Apágala en roles de personal nuevo: borrar por error es lo más común al empezar.',
                    },
                    {
                        name: 'Eliminar sus registros',
                        what: 'Manda a la papelera los registros que creó.',
                    },
                    {
                        name: 'Acciones en lote',
                        what: 'Edita, mueve o borra muchos registros a la vez y deshace ediciones masivas.',
                        tip: 'Una edición masiva mal hecha cambia cientos de filas: dásela a quien la necesita.',
                    },
                ],
            },
            {
                t: 'settings',
                title: 'El resto de la app',
                rows: [
                    { name: 'Importar', what: 'Sube registros desde un CSV o Excel.' },
                    {
                        name: 'Exportar',
                        what: 'Descarga los registros que ve en CSV o Excel.',
                        tip: 'Apágala si te preocupa que se lleven la base de clientes.',
                    },
                    {
                        name: 'Gestionar listas',
                        what: 'Crea, configura y elimina listas, y decide quién accede a cada una.',
                    },
                    {
                        name: 'Gestionar campos',
                        what: 'Agrega, cambia y elimina columnas.',
                    },
                    {
                        name: 'Gestionar vistas',
                        what: 'Crea y cambia las vistas guardadas para todo el equipo.',
                    },
                    {
                        name: 'Ver tableros',
                        what: 'Abre los tableros que se comparten con su rol.',
                    },
                    {
                        name: 'Crear y editar tableros',
                        what: 'Arma tableros, los publica y programa envíos por correo.',
                    },
                    {
                        name: 'Gestionar automatizaciones',
                        what: 'Crea, cambia y pausa automatizaciones.',
                    },
                    {
                        name: 'Gestionar formularios',
                        what: 'Arma y publica formularios públicos que crean registros.',
                    },
                    {
                        name: 'Gestionar plantillas de documentos',
                        what: 'Diseña las plantillas de PDF (cotizaciones, cuentas de cobro).',
                    },
                    {
                        name: 'Gestionar equipos',
                        what: 'Crea equipos y decide quién está en cada uno.',
                    },
                    {
                        name: 'Usar el asistente IA',
                        what: 'Conversa con el asistente y conecta Claude u otros clientes por MCP.',
                    },
                    {
                        name: 'Gestionar agentes de IA',
                        what: 'Crea, cambia y pausa agentes de IA. Cada agente trabaja con el acceso de quien lo crea.',
                    },
                ],
            },
            { t: 'h', text: 'Editar, borrar y usar el rol en cada lista' },
            {
                t: 'p',
                md: '- Toca el lápiz de un rol para cambiar su nombre, color o casillas. Los cambios se aplican **al instante** a todas las personas con ese rol.\n- Al **Eliminar rol**, la app te dice cuántas personas lo tienen: vuelven al rol fijo en el que estaba basado, sin perder nada.\n- En **Permisos** de cada lista, el rol propio aparece con su propia fila. Mientras no lo toques, **usa los mismos permisos que su rol base**; con **Personalizar para este rol** le das un nivel distinto en esa lista, y con **Volver a usar los de…** lo devuelves.',
            },
            {
                t: 'example',
                title: 'Una agencia de viajes con «Asesor senior»',
                md: 'Los asesores son **Agente**: ven sólo sus clientes. Los asesores con más experiencia ayudan a los nuevos, así que la gerente crea **Asesor senior** basado en Agente con **Ver todos los registros** y **Exportar** prendidos, pero **Eliminar cualquier registro** apagado. Pueden revisar las reservas de todos sin riesgo de borrarlas.',
            },
            {
                t: 'example',
                title: 'Un colegio con «Coordinación académica»',
                md: 'Basado en **Manager**, pero sin **Exportar** (los datos de estudiantes son sensibles) y sin **Acciones en lote**. Con **Crear y editar tableros** prendido, la coordinación arma su tablero de asistencia y notas.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo crear un rol basado en Admin?',
                        a: 'No: el Admin queda fijo con acceso total, para que siempre haya alguien que pueda arreglar cualquier cosa.',
                    },
                    {
                        q: '¿Un invitado de afuera puede tener un rol propio?',
                        a: 'No. Los invitados tienen su propio nivel (puede ver, comentar o editar) sobre lo que les compartes.',
                    },
                    {
                        q: '¿Cuántos roles propios puedo crear?',
                        a: 'Los que necesites. Conviene que sean pocos y con nombres claros, para que todos entiendan quién hace qué.',
                    },
                    {
                        q: 'Cambié un rol y alguien sigue viendo un botón.',
                        a: 'Pídele que recargue la página: los permisos se revisan en el servidor en cada acción, así que aunque vea el botón, la app no lo deja hacer lo que el rol no permite.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Roles', to: '/settings?s=roles' },
                    {
                        label: 'Permisos por lista',
                        article: 'equipo-y-permisos-permisos-lista',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'equipo-y-permisos-equipos',
        route: '/settings?s=equipos',
        related: ['equipo-y-permisos-personas-equipos', 'equipo-y-permisos-asignados', 'equipo-y-permisos-invitar'],
        blocks: [
            {
                t: 'p',
                md: 'Un **equipo** es un grupo de personas de tu empresa: «Ventas», «Soporte», «Bodega», «Sede Medellín». Sirve para tres cosas que ahorran mucho trabajo:\n\n1. **Asignar** un registro a un equipo entero (con un campo de tipo **Equipo**) en vez de a una sola persona.\n2. **Avisar a todas** con una mención: escribir **@Ventas** en un comentario le llega a cada persona del equipo.\n3. **Dar acceso** a una lista a todo el equipo de una vez, sin tocar el rol de nadie.',
            },
            {
                t: 'anim',
                key: 'equipo-teams',
                caption: 'El registro queda asignado al equipo Ventas y la mención @Ventas le avisa a cada una de sus personas.',
            },
            { t: 'h', text: 'Crear un equipo y sumar personas' },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Equipos** y toca **Nuevo equipo**.',
                    'Escribe el **Nombre** y, si quieres, una **Descripción (opcional)**. Con el botón de **Color e ícono** le das una identidad visual: así se ve como chip en las tablas.',
                    'En **Personas** busca a cada miembro por nombre y súmalo. Con **Marcar como líder** destacas a quien coordina (el líder sólo se muestra; no da permisos extra).',
                    'Toca **Crear equipo**. Puedes editarlo o eliminarlo después con el lápiz y la papelera de su tarjeta.',
                ],
            },
            {
                t: 'demo',
                key: 'equipo-equipos',
                caption: 'Crear el equipo «Ventas» y sumar a sus personas.',
                fallback: 'equipo-teams',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Los equipos los crea el **Admin** o quien tenga la capacidad **Gestionar equipos** en su rol propio. Sólo entran personas del equipo de trabajo: los clientes del portal y los invitados de afuera no forman parte de un equipo.',
            },
            { t: 'h', text: 'Dónde se usan los equipos' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Tag',
                        title: 'Campo «Equipo»',
                        md: 'Agrega a una lista un campo de tipo **Equipo** (uno o varios). Se ve como chip con el color del equipo, filtra («es uno de mis equipos»), agrupa en tabla y tablero, se ordena y se exporta por nombre.',
                        tone: 'amber',
                    },
                    {
                        icon: 'MessageSquare',
                        title: 'Menciones @equipo',
                        md: 'En comentarios y en la descripción, escribe **@** y el nombre del equipo: cada persona del equipo que puede ver el registro recibe el aviso.',
                        tone: 'violet',
                    },
                    {
                        icon: 'Lock',
                        title: 'Acceso a listas',
                        md: 'En **Compartir → Con tu equipo** de una lista, **Equipos con acceso** le da a todo el equipo un nivel (Solo mirar, Colaborar…) sólo en esa lista.',
                        tone: 'blue',
                    },
                    {
                        icon: 'Inbox',
                        title: '«Mi trabajo»',
                        md: 'Cada persona ve la sección **De mis equipos** con los registros asignados a sus equipos, además de los suyos.',
                        tone: 'mint',
                    },
                    {
                        icon: 'Gauge',
                        title: 'Carga de trabajo',
                        md: 'En la vista de carga de trabajo puedes filtrar por equipo para ver sólo a sus personas.',
                        tone: 'cyan',
                    },
                    {
                        icon: 'CheckCircle2',
                        title: 'Aprobaciones',
                        md: 'Un paso de aprobación puede pedirle la decisión a **un equipo**: decide cualquiera (o todos) de quienes están en ese momento.',
                        tone: 'rose',
                    },
                ],
            },
            { t: 'h', text: 'Avisos cuando se asigna a un equipo' },
            {
                t: 'p',
                md: 'Cuando un registro se asigna a un equipo, cada persona del equipo recibe el aviso **Asignan un registro a uno de tus equipos** en la campana. Por correo viene **apagado** por defecto (con un equipo grande gastaría la cuota de correos); cada persona lo puede prender en **Ajustes → Avisos**.',
            },
            {
                t: 'example',
                title: 'Mesa de ayuda de una empresa de software',
                md: 'Tres equipos: **Soporte N1**, **Soporte N2** y **Facturación**. Cada ticket tiene un campo **Equipo**; una automatización lo asigna a Facturación si el asunto habla de pagos. Los agentes ven en «Mi trabajo» los tickets de su equipo y escriben **@Soporte N2** cuando necesitan escalar.',
            },
            {
                t: 'example',
                title: 'Una cadena de panaderías',
                md: 'Un equipo por sede (**Sede Centro**, **Sede Norte**). La lista **Pedidos especiales** tiene un campo Equipo con la sede que lo entrega, y cada sede ve su lista filtrada con «es uno de mis equipos».',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Al eliminar un equipo',
                md: 'Las personas siguen en la empresa. Los registros asignados a ese equipo quedan sin él y las listas compartidas con el equipo dejan de estarlo.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Una persona puede estar en varios equipos?',
                        a: 'Sí. Si dos equipos tienen acceso distinto a la misma lista, vale el más permisivo de los dos.',
                    },
                    {
                        q: '¿El líder tiene más permisos?',
                        a: 'No, el líder sólo se muestra (estrella en su tarjeta). Si necesitas que coordine con más permisos, dale un rol propio.',
                    },
                    {
                        q: '¿Puedo mencionar a un equipo en un registro que algunos no pueden ver?',
                        a: 'Sí, pero el aviso sólo les llega a las personas del equipo que pueden ver ese registro.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Equipos', to: '/settings?s=equipos' },
                    {
                        label: 'Dar acceso por equipo',
                        article: 'equipo-y-permisos-personas-equipos',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'equipo-y-permisos-permisos-lista',
        route: '/lists',
        related: ['equipo-y-permisos-asignados', 'equipo-y-permisos-personas-equipos', 'equipo-y-permisos-recetas'],
        blocks: [
            {
                t: 'p',
                md: 'El rol de una persona dice qué puede hacer en la app en general. Pero cada lista guarda cosas distintas: no es lo mismo la lista de **Tareas** (que todos tocan) que la de **Nómina** (que casi nadie debería ver). Por eso cada lista tiene su propia sección **Permisos**, donde decides, rol por rol, quién ve, crea, edita o borra registros y qué columnas no le aparecen.\n\nSe abre con **Configurar lista** (arriba a la derecha de la lista) → pestaña **Permisos**, que lleva el título **Quién puede hacer qué**. Lo configura quien tiene **Gestionar listas** (el Admin, normalmente). El Admin no aparece: siempre tiene acceso total. En esta pantalla el rol Lector aparece con el nombre **Visor**.',
            },
            {
                t: 'anim',
                key: 'equipo-list-levels',
                caption: 'Al pasar el rol Agente de «Solo mirar» a «Colaborar», el ajuste fino se actualiza solo.',
            },
            { t: 'h', text: 'Los cinco niveles listos para usar' },
            {
                t: 'p',
                md: 'Cada rol tiene una tarjeta con cinco niveles. En la mayoría de los casos alcanza con elegir uno:',
            },
            {
                t: 'settings',
                title: 'Niveles de acceso',
                rows: [
                    {
                        name: 'Sin acceso',
                        what: 'No ve esta lista: ni en el menú ni en búsquedas, tableros o exportaciones.',
                        tip: 'Para listas internas: costos, nómina, evaluaciones del personal.',
                    },
                    {
                        name: 'Solo mirar',
                        what: 'Ve todos los registros, no puede tocarlos.',
                        tip: 'Para consultar: inventario para vendedores, catálogo de precios.',
                    },
                    {
                        name: 'Solo lo suyo',
                        what: 'Ve y edita únicamente los registros que creó.',
                        tip: 'El clásico para vendedores: cada uno con su propia cartera.',
                    },
                    {
                        name: 'Colaborar',
                        what: 'Ve y edita todo, pero no elimina.',
                        tip: 'Para equipos que trabajan juntos en lo mismo sin riesgo de borrar.',
                    },
                    {
                        name: 'Control total',
                        what: 'Ve, crea, edita y elimina cualquier registro.',
                        tip: 'Para quien es dueño de la lista: el jefe del área.',
                    },
                ],
            },
            {
                t: 'demo',
                key: 'equipo-permisos',
                caption: 'La pestaña Permisos de una lista: un nivel por rol y el ajuste fino.',
                fallback: 'equipo-list-levels',
            },
            { t: 'h', text: 'El ajuste fino: cuatro preguntas por rol' },
            {
                t: 'p',
                md: 'Debajo de los niveles, **Ajuste fino** muestra lo que hay detrás de cada nivel y te deja armar combinaciones propias. Si la combinación no coincide con ninguno de los cinco, la tarjeta dice «Este rol usa una combinación propia — mírala en el ajuste fino».',
            },
            {
                t: 'settings',
                title: 'Ajuste fino',
                rows: [
                    {
                        name: 'Puede ver',
                        what: 'Qué registros le aparecen: **Todos los registros**, **Los asignados a la persona (y los que creó)**, **Los que creó** o **Ninguno**.',
                        tip: '«Los asignados» necesita que elijas un campo responsable (ver el artículo de asignados).',
                    },
                    {
                        name: 'Puede editar',
                        what: 'Qué registros puede cambiar, con las mismas cuatro opciones.',
                        tip: 'Puede ver todos y editar sólo los suyos: útil para que el equipo se entere de todo sin pisarse.',
                    },
                    {
                        name: 'Puede eliminar',
                        what: 'Qué registros puede mandar a la papelera.',
                        tip: 'Lo borrado queda 30 días en la papelera, pero mejor que borre sólo quien debe.',
                    },
                    {
                        name: 'Puede crear registros nuevos',
                        what: 'Si puede dar de alta registros en esta lista.',
                        tip: 'Quien crea un registro siempre lo ve, aunque su «Puede ver» diga otra cosa.',
                    },
                    {
                        name: 'Campos que este rol NO debe ver',
                        what: 'Las columnas marcadas no llegan a la pantalla de ese rol ni puede modificarlas: ni en la tabla, ni en la ficha, ni en exportaciones, búsquedas, filtros o tableros.',
                        tip: 'Costos, márgenes, salarios, observaciones internas.',
                    },
                ],
            },
            {
                t: 'anim',
                key: 'equipo-hidden-fields',
                caption: 'El campo Costo, marcado como oculto para Agente, desaparece de su tabla.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Lo oculto se oculta de verdad',
                md: 'Un campo oculto no se cuela por los costados: tampoco aparece en la actividad del registro, en los resúmenes, en los lookups o rollups de otra lista, ni en un campo calculado que lo use (si «Ganancia = Precio − Costo» y Costo está oculto, Ganancia también se oculta). Así nadie lo deduce.',
            },
            { t: 'h', text: 'Roles propios en esta pantalla' },
            {
                t: 'p',
                md: 'Cada rol propio tiene su fila con la etiqueta **Rol propio**. Al principio dice «Usa los mismos permisos que…» su rol base. Toca **Personalizar para este rol** para darle un nivel distinto sólo en esta lista; **Volver a usar los de…** lo devuelve. Al terminar, toca **Guardar permisos**.',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria',
                md: 'En **Propiedades**: Agente = **Colaborar** (todos actualizan el estado de las propiedades), con **Comisión del dueño** como campo oculto. En **Clientes**: Agente = **Solo lo suyo**. En **Contratos**: Agente = **Solo mirar** y Lector = **Sin acceso**.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Por qué el Admin no aparece en la lista de roles?',
                        a: 'Porque siempre tiene acceso total a todas las listas. Así nunca queda una lista que nadie pueda administrar.',
                    },
                    {
                        q: 'Le quité el acceso a un rol y alguien todavía la ve.',
                        a: 'Revisa **Compartir → Con tu equipo**: si a esa persona o a uno de sus equipos le diste acceso puntual, ese acceso manda sobre el del rol.',
                    },
                    {
                        q: '¿Los permisos aplican también a los tableros?',
                        a: 'Sí. Un gráfico calcula con los registros y campos que cada persona puede ver: dos personas pueden ver números distintos en el mismo tablero.',
                    },
                    {
                        q: '¿Y a las automatizaciones?',
                        a: 'Las automatizaciones corren solas sobre toda la lista: los permisos limitan lo que hacen las personas, no lo que hace una automatización que configuró un admin.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir mis listas', to: '/lists' },
                    {
                        label: 'Ver solo lo asignado',
                        article: 'equipo-y-permisos-asignados',
                    },
                    {
                        label: 'Recetas de permisos',
                        article: 'equipo-y-permisos-recetas',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'equipo-y-permisos-personas-equipos',
        route: '/lists',
        related: ['equipo-y-permisos-permisos-lista', 'equipo-y-permisos-equipos', 'equipo-y-permisos-invitados'],
        blocks: [
            {
                t: 'p',
                md: 'A veces el permiso por rol no alcanza: Luis es **Agente** como todos los vendedores, pero también lleva la lista de **Garantías** y necesita control total ahí. Cambiarle el rol le daría más poder en **toda** la app. La solución es darle acceso **sólo en esa lista**, a él en persona o a su equipo.\n\nEsto se hace desde el botón **Compartir** de la lista, en la sección **Con tu equipo**, con dos bloques: **Personas con acceso** y **Equipos con acceso**.',
            },
            {
                t: 'anim',
                key: 'equipo-precedence',
                caption: 'Manda la capa más específica: lo que le das a Luis en persona pisa lo de su equipo, y lo de su equipo pisa lo de su rol.',
            },
            { t: 'h', text: 'Dar acceso a una persona' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y toca **Compartir** (arriba a la derecha).',
                    'En **Con tu equipo** verás primero el enlace de la lista: sólo lo abre quien tenga cuenta y permiso. Debajo está **Personas con acceso**.',
                    'Busca a la persona por nombre o correo («Buscar una persona por nombre o correo…»). Sólo aparecen miembros de esta empresa.',
                    'En el selector de al lado elige el nivel (Sin acceso, Solo mirar, Solo lo suyo, Colaborar o Control total) y toca a la persona en los resultados para sumarla. El cambio se guarda al instante y aparece el aviso «Compartida con…».',
                    'Para cambiar el nivel después, usa el selector de su fila; con la X le quitas el acceso puntual y vuelve a valer el de su rol.',
                ],
            },
            {
                t: 'demo',
                key: 'equipo-compartir',
                caption: 'Compartir → Con tu equipo: personas y equipos con acceso a la lista.',
                fallback: 'equipo-precedence',
            },
            { t: 'h', text: 'Dar acceso a un equipo' },
            {
                t: 'p',
                md: 'En **Equipos con acceso** elige un equipo («Elige un equipo…»), su nivel, y toca **Compartir**. Todas las personas del equipo reciben ese nivel en esta lista, y quien entre al equipo después lo recibe solo. Si todavía no hay equipos, el panel te lo dice y te manda a **Ajustes → Equipos**.',
            },
            { t: 'h', text: 'Qué acceso manda cuando hay varios' },
            {
                t: 'settings',
                title: 'El orden de prioridad',
                rows: [
                    {
                        name: '1. La persona',
                        what: 'Si le diste acceso a alguien en persona, ese manda sobre todo lo demás, para bien o para mal.',
                        tip: 'Sirve también para RESTRINGIR: un Manager con «Solo mirar» en la lista de Nómina.',
                    },
                    {
                        name: '2. Sus equipos',
                        what: 'Si no tiene acceso personal pero alguno de sus equipos sí, vale el del equipo. Con varios equipos, vale lo más permisivo de cada cosa, y un campo se oculta sólo si todos sus equipos lo ocultan.',
                    },
                    {
                        name: '3. Su rol',
                        what: 'Si no tiene nada de lo anterior, vale el nivel de su rol (o de su rol propio) en **Permisos**.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Un acceso por persona o por equipo **no le cambia el rol** a nadie: fuera de esa lista sigue siendo Agente, Lector o lo que sea. Es la forma más segura de abrir una puerta puntual.',
            },
            {
                t: 'example',
                title: 'Un estudio contable',
                md: 'Todos los asistentes son **Agente** con **Solo lo suyo** en **Clientes**. La lista **Declaraciones de renta** se comparte con el equipo **Impuestos** en **Colaborar**, y con la socia Marcela en persona con **Control total**. Ningún rol tuvo que cambiar.',
            },
            {
                t: 'example',
                title: 'Un practicante que sólo mira',
                md: 'El practicante tiene rol **Agente**, pero en la lista **Cartera** se le da acceso personal **Solo mirar**: aprende viendo los cobros sin poder modificarlos.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo compartir la lista con alguien que no es de la empresa?',
                        a: 'Sí, en el mismo diálogo, más abajo, está **Personas de afuera** (invitados). Lee el artículo de invitados.',
                    },
                    {
                        q: '¿Quién puede dar estos accesos?',
                        a: 'Quien administra la lista (capacidad **Gestionar listas**). Los demás ven el enlace del equipo pero no los bloques de acceso.',
                    },
                    {
                        q: '¿Dónde veo de un vistazo quién tiene acceso a qué?',
                        a: 'En **Compartir** de cada lista ves las personas y equipos con acceso puntual, y en **Permisos** los niveles por rol. Los cambios quedan en **Ajustes → Registro de actividad**.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir mis listas', to: '/lists' },
                    { label: 'Equipos', article: 'equipo-y-permisos-equipos' },
                    {
                        label: 'Invitados de afuera',
                        article: 'equipo-y-permisos-invitados',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'equipo-y-permisos-asignados',
        route: '/lists',
        related: ['equipo-y-permisos-permisos-lista', 'equipo-y-permisos-equipos', 'equipo-y-permisos-recetas'],
        blocks: [
            {
                t: 'p',
                md: '«Solo lo suyo» funciona por quién **creó** el registro. Pero en muchos negocios quien crea no es quien atiende: la recepcionista carga al paciente y lo atiende el odontólogo; la gerente reparte los clientes entre los vendedores. Para eso existe el alcance **Los asignados a la persona (y los que creó)**: cada persona ve los registros donde figura como responsable.',
            },
            {
                t: 'anim',
                key: 'equipo-own-scope',
                caption: 'La misma lista: la admin ve todo, el agente sólo lo que le corresponde.',
            },
            { t: 'h', text: 'Cómo se configura' },
            {
                t: 'steps',
                items: [
                    'Asegúrate de que la lista tenga un campo de tipo **Persona** (por ejemplo «Responsable» o «Vendedor»). Si no lo tiene, agrégalo en la pestaña **Campos**.',
                    'Ve a **Permisos** de la lista y, en el rol que quieras (por ejemplo Agente), abre **Ajuste fino**.',
                    'En **Puede ver** (y si quieres en **Puede editar**) elige **Los asignados a la persona (y los que creó)**.',
                    'Aparece la pregunta **¿Qué campo dice quién es el responsable?**: elige tu campo de persona.',
                    'Opcional: en **¿Y qué campo dice qué equipo lo atiende? (opcional)** elige un campo de tipo Equipo. Así un registro también cuenta como asignado a todas las personas de los equipos que tiene.',
                    'Toca **Guardar permisos**.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Sin campo responsable no hay magia',
                md: 'Si eliges «Los asignados…» pero no eliges el campo, la persona ve sólo los registros que creó. Y si la lista no tiene ningún campo de tipo Persona ni Equipo, la app te avisa que hay que crear uno en **Campos**.',
            },
            { t: 'h', text: 'Qué ve cada uno' },
            {
                t: 'settings',
                rows: [
                    {
                        name: 'Registros asignados a él',
                        what: 'Los ve (y los edita, si «Puede editar» también dice asignados).',
                    },
                    {
                        name: 'Registros que él creó',
                        what: 'También los ve siempre, aunque no se haya puesto de responsable: quien crea un registro nunca lo pierde de vista.',
                    },
                    {
                        name: 'Registros de su equipo',
                        what: 'Si configuraste el campo Equipo, los registros asignados a cualquiera de sus equipos.',
                    },
                    {
                        name: 'Todo lo demás',
                        what: 'No le aparece: ni en la tabla, ni en búsquedas, ni en tableros ni exportaciones.',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Un CRM de ventas',
                md: 'La lista **Oportunidades** tiene el campo **Vendedor** (Persona). La gerente reparte los prospectos con una edición masiva o desde el kanban. Cada vendedor (Agente con «Los asignados…») ve sólo su cartera y su tablero personal muestra **sus** números. La gerente (Manager) ve todo.',
            },
            {
                t: 'example',
                title: 'Un taller de mantenimiento',
                md: 'La lista **Órdenes de trabajo** tiene **Técnico** (Persona) y **Cuadrilla** (Equipo). Cada técnico ve sus órdenes y las de su cuadrilla; cuando una orden se asigna a una cuadrilla, todos sus técnicos reciben el aviso.',
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Combínalo con **Mi trabajo**: cada persona ve ahí, en una sola pantalla, todo lo que tiene asignado en todas las listas, ordenado por vencimiento.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: 'Reasigné un registro a otra persona, ¿lo deja de ver el anterior?',
                        a: 'Sí, salvo que lo haya creado él (quien crea lo sigue viendo) o que esté en el equipo asignado.',
                    },
                    {
                        q: '¿Puedo usar varios campos de persona?',
                        a: 'Para este alcance se elige uno solo como responsable. Los demás campos de persona sirven para mostrar, filtrar y avisar.',
                    },
                    {
                        q: '¿Afecta a los Managers?',
                        a: 'Sólo si a su rol le eliges ese alcance. Por defecto el Manager ve todos los registros.',
                    },
                ],
            },
            { t: 'h', text: 'Cómo repartir los registros' },
            {
                t: 'steps',
                items: [
                    'De a uno: en la ficha del registro, cambia el campo **Vendedor** (o el que uses como responsable). La persona recibe el aviso «Te asignan un registro».',
                    'Varios de una vez: marca las filas en la tabla y usa **Asignar** en la barra de selección. Elige la persona y confirma: queda en el historial de ediciones masivas y se puede deshacer.',
                    'Automático: crea una automatización «Cuando se crea un registro» con la acción **Actualizar un campo** que ponga al responsable según la ciudad, el producto o el origen.',
                    'Por turnos: en una agenda de citas, «El primero disponible» reparte las citas entre las personas que atienden.',
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir mis listas', to: '/lists' },
                    { label: 'Ir a Mi trabajo', to: '/my-work' },
                    {
                        label: 'Permisos de una lista',
                        article: 'equipo-y-permisos-permisos-lista',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'equipo-y-permisos-invitados',
        route: '/settings?s=miembros',
        related: ['equipo-y-permisos-personas-equipos', 'equipo-y-permisos-invitar', 'equipo-y-permisos-recetas'],
        blocks: [
            {
                t: 'p',
                md: 'Un **invitado** es alguien de afuera de tu empresa —un proveedor, un freelancer, tu contador externo— que necesita ver o trabajar en algo puntual: una lista entera o algunos registros sueltos. Ve **SÓLO** lo que le compartes (nada más de la empresa) y **no ocupa un usuario de tu plan**: cada plan tiene su propio cupo de invitados.',
            },
            {
                t: 'anim',
                key: 'equipo-guest',
                caption: 'Se comparte un contrato con el contador: él entra a «Compartido conmigo» y ve sólo ese registro.',
            },
            { t: 'h', text: 'Los tres niveles de un invitado' },
            {
                t: 'settings',
                rows: [
                    {
                        name: 'Puede ver',
                        what: 'Mira, sin cambiar nada.',
                        tip: 'Para que el cliente revise el avance de su proyecto o el contador consulte facturas.',
                    },
                    {
                        name: 'Puede comentar',
                        what: 'Mira y deja comentarios.',
                        tip: 'Para aprobar diseños, hacer preguntas o dejar observaciones sin tocar los datos.',
                    },
                    {
                        name: 'Puede editar',
                        what: 'Mira, comenta y cambia los datos (nunca borra).',
                        tip: 'Para un proveedor que actualiza el estado de sus pedidos o un freelancer que carga su trabajo.',
                    },
                ],
            },
            { t: 'h', text: 'Compartir una lista entera' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y toca **Compartir**.',
                    'Baja hasta **Personas de afuera**: «Un proveedor, un freelancer o el contador: ven sólo esta lista (nada más de la empresa) y no ocupan un usuario de tu plan».',
                    'Escribe su correo (**correo@deafuera.com**), elige el nivel y toca **Invitar**.',
                    'Si no tenía cuenta, le llega una invitación para entrar; si ya tenía, le avisamos por correo y ya puede entrar.',
                ],
            },
            { t: 'h', text: 'Compartir un solo registro' },
            {
                t: 'steps',
                items: [
                    'Abre el registro (la ficha o el panel lateral) y toca el botón de compartir de la barra del registro.',
                    'Se abre **Compartir «nombre del registro»**: «Con alguien de afuera: ve SÓLO este registro (nada más de la empresa) y no ocupa un usuario de tu plan».',
                    'Escribe el correo, elige el nivel y toca **Invitar**. En la misma ventana ves a quién se lo compartiste, con su nivel y una X para quitarle el acceso.',
                ],
            },
            {
                t: 'demo',
                key: 'equipo-invitado',
                caption: 'Compartir un registro con alguien de afuera.',
                fallback: 'equipo-guest',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Quién puede compartir',
                md: 'Una **lista entera** la comparte quien la administra (Gestionar listas). Un **registro suelto** lo puede compartir cualquiera que pueda editar registros.',
            },
            { t: 'h', text: 'Qué ve el invitado' },
            {
                t: 'p',
                md: 'Al entrar, el invitado ve una pantalla propia, **Compartido conmigo**, con el aviso «Eres invitado de «tu empresa»: sólo ves lo que te compartieron». Ahí tiene dos secciones, **Listas** y **Registros**, cada una con su nivel. Cuando le compartes algo nuevo, aparece ahí solo.\n\nPor seguridad, un invitado nunca ve: las otras listas, el menú de la empresa, tableros, automatizaciones, los vínculos con otras listas, el tiempo registrado, las aprobaciones ni los checklists internos. Ve los campos que vería un **Lector**, y su cuenta sólo tiene las secciones **Seguridad**, **Avisos**, **Tus datos** y **Apariencia**.',
            },
            { t: 'h', text: 'Administrar a los invitados' },
            {
                t: 'p',
                md: 'En **Ajustes → Miembros**, debajo de los miembros, la tarjeta **Invitados** lista a todas las personas de afuera con lo que tienen compartido («lista entera» o cada registro) y te deja:\n\n- Cambiar el nivel en cada cosa compartida, o **Dejar de compartir** una en particular.\n- **Reenviar** la invitación si todavía está pendiente.\n- **Pasar a miembro…**: si esa persona entra al equipo, la conviertes en miembro con un rol (ocupa un usuario de tu plan).\n- **Quitar**: deja de ver todo lo que le compartiste, al instante. Su cuenta queda (puede ser invitada de otras empresas).',
            },
            {
                t: 'example',
                title: 'Una constructora y sus proveedores',
                md: 'La lista **Pedidos a proveedores** se comparte con cada proveedor en **Puede editar**, pero filtrando lo que ve: en vez de la lista entera, se le comparte cada pedido suelto. El proveedor actualiza «Fecha de despacho» y comenta si hay faltantes, sin ver a la competencia.',
            },
            {
                t: 'example',
                title: 'Una agencia de marketing y su cliente',
                md: 'El registro de la campaña de **Café Bahía** se comparte con su gerente en **Puede comentar**: revisa los avances, comenta «aprobado» y sigue todo sin pedir informes por correo.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿En qué se diferencia un invitado de un cliente del portal?',
                        a: 'El portal es una página diseñada para tus clientes con su información (y se configura por lista). Un invitado entra a la app y trabaja directamente sobre los registros que le compartes.',
                    },
                    {
                        q: '¿Cuántos invitados puedo tener?',
                        a: 'Depende de tu plan; lo ves en **Ajustes → Plan y uso**, en la barra **Invitados**.',
                    },
                    {
                        q: '¿Un invitado puede borrar?',
                        a: 'No, nunca. Con «Puede editar» cambia datos, pero no borra registros.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver mis invitados', to: '/settings?s=miembros' },
                    { label: 'Abrir mis listas', to: '/lists' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'equipo-y-permisos-recetas',
        route: '/lists',
        related: ['equipo-y-permisos-permisos-lista', 'equipo-y-permisos-roles-propios', 'equipo-y-permisos-asignados'],
        blocks: [
            {
                t: 'p',
                md: 'Los permisos tienen muchas piezas: roles, roles propios, equipos, niveles por lista, ajuste fino, campos ocultos, acceso por persona e invitados. Aquí van configuraciones probadas para los casos que más se repiten en negocios reales. Cópialas tal cual o úsalas como punto de partida.',
            },
            {
                t: 'anim',
                key: 'equipo-hidden-fields',
                caption: 'Ocultar una columna sensible a un rol es la receta más usada.',
            },
            { t: 'h', text: 'Vendedores que sólo ven su cartera' },
            {
                t: 'steps',
                items: [
                    'Vendedores con rol **Agente**; jefe comercial con rol **Manager**.',
                    'En **Clientes** y **Oportunidades**, campo **Vendedor** (Persona).',
                    'Permisos de esas listas → Agente → **Ajuste fino**: Puede ver y Puede editar = **Los asignados a la persona (y los que creó)**; Puede eliminar = **Ninguno**; Puede crear = sí.',
                    'Responsable = **Vendedor**. Guardar.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Si un vendedor se va, reasigna su cartera con una edición masiva del campo Vendedor antes de quitarlo: nadie pierde clientes.',
            },
            { t: 'h', text: 'Costos y márgenes que el equipo no ve' },
            {
                t: 'p',
                md: 'En **Productos**, Agente y Lector en **Solo mirar**, y en **Campos que este rol NO debe ver** marca **Costo**, **Proveedor** y **Margen**. Los vendedores consultan precios y stock sin ver cuánto ganas.',
            },
            { t: 'h', text: 'Un contador externo que mira las facturas' },
            {
                t: 'p',
                md: 'No lo sumes como miembro: invítalo como **invitado** a la lista **Facturas** con **Puede ver** (o **Puede comentar** si te deja observaciones). No ocupa un usuario y no ve nada más de la empresa. Cuando termine la temporada de impuestos, lo quitas con un clic.',
            },
            { t: 'h', text: 'Supervisor que revisa a todos pero no borra' },
            {
                t: 'p',
                md: 'Rol propio **Supervisor** basado en Agente, con **Ver todos los registros**, **Editar cualquier registro** y **Exportar** prendidas, **Eliminar cualquier registro** apagada. En **Permisos** de las listas operativas, personaliza su fila en **Colaborar**.',
            },
            { t: 'h', text: 'Una lista confidencial dentro de la empresa' },
            {
                t: 'p',
                md: 'Para **Nómina** o **Evaluaciones**: todos los roles en **Sin acceso**, y en **Compartir → Con tu equipo** da acceso personal **Control total** a la persona de gestión humana. Ni los Managers la ven; los Admin sí (siempre tienen acceso total), así que revisa bien quién es Admin.',
            },
            { t: 'h', text: 'Sucursales que ven sólo lo suyo' },
            {
                t: 'p',
                md: 'Crea un equipo por sede y, en **Pedidos**, un campo **Sede** de tipo Equipo además del campo **Vendedor** (Persona). En Permisos, Agente con «Los asignados…», responsable = **Vendedor** y equipo = **Sede**. Cada sede ve sus pedidos; la gerencia general (Manager) ve todo.',
            },
            { t: 'h', text: 'Practicantes y personal en prueba' },
            {
                t: 'p',
                md: 'Rol propio **Practicante** basado en Agente, sin **Exportar**, sin **Acciones en lote** y sin **Eliminar sus registros**. Si una lista es especialmente delicada, dale acceso personal **Solo mirar** en ella.',
            },
            {
                t: 'example',
                title: 'Todo junto: una distribuidora de alimentos',
                md: '12 personas: 2 Admin (dueños), 1 Manager (jefa de operaciones), 1 rol propio **Supervisor de ruta**, 6 Agentes (vendedores de ruta, con cartera asignada), 1 Lector (bodega, mira pedidos) y 1 invitado (el contador, sólo Facturas). Equipos **Ruta Norte** y **Ruta Sur** para avisar con @. Costos ocultos para Agente y Lector en **Productos**.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Cómo pruebo que la configuración quedó bien?',
                        a: 'Pídele a alguien con ese rol que entre y te cuente qué ve. Como alternativa, crea una cuenta de prueba con ese rol, entra con ella en una ventana privada y revisa.',
                    },
                    {
                        q: '¿Se pueden copiar los permisos de una lista a otra?',
                        a: 'Al **duplicar** una lista o guardarla como plantilla, sus ajustes viajan con ella, permisos incluidos.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Prueba la receta antes de anunciarla',
                md: 'Después de guardar los permisos, pídele a alguien con ese rol que abra la lista y te cuente qué ve. Si eres admin, también puedes revisar desde **Permisos** el resumen de cada rol. Ajustar es inmediato: no hace falta que nadie salga y vuelva a entrar.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo combinar varias recetas en la misma lista?',
                        a: 'Sí. Cada rol, cada equipo y cada persona tiene su propio acceso en la lista; las recetas se suman sin pisarse.',
                    },
                    {
                        q: '¿Los permisos de una lista valen para sus tableros?',
                        a: 'Sí: un tablero sólo muestra lo que cada persona puede ver de la lista, así que el vendedor ve sus números y la gerente los de todos.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir mis listas', to: '/lists' },
                    { label: 'Ir a Roles', to: '/settings?s=roles' },
                    { label: 'Ir a Equipos', to: '/settings?s=equipos' },
                ],
            },
        ],
    },
];
