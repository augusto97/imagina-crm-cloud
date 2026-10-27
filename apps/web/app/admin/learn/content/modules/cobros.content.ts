import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cobros-que-es',
        route: '/settings?s=conectores',
        related: ['cobros-conectar', 'cobros-cobrar', 'cobros-estados'],
        blocks: [
            {
                t: 'p',
                md: 'Un **link de pago** es una dirección que le mandas al cliente por WhatsApp o por correo: la abre, elige cómo pagar (PSE, Nequi, tarjeta, efectivo) y paga. Lo creas desde cualquier registro —una factura, una cuota, una reserva— y, lo más importante, **la app se entera sola cuando el cliente paga**: el registro cambia a «Pagado» con la fecha, el monto y el medio, sin que nadie revise el extracto del banco.',
            },
            { t: 'anim', key: 'cobro-hero', caption: 'Se crea el link desde la factura, viaja por WhatsApp, el cliente paga con PSE y la factura pasa sola a «Pagado».' },
            { t: 'h', text: 'A dónde va el dinero' },
            {
                t: 'p',
                md: 'Conectas **tu propia cuenta** de Mercado Pago o de Wompi. El dinero va **directo a esa cuenta**, como si cobraras desde el panel del proveedor: la app no lo toca ni cobra comisión. Las comisiones que haya son las de tu contrato con el proveedor.',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'Wallet', title: 'Mercado Pago', md: 'Colombia, México, Argentina, Chile, Perú, Uruguay y Brasil, cada uno con su moneda. PSE, tarjetas, efectivo y los medios de cada país.', tone: 'blue' },
                    { icon: 'CreditCard', title: 'Wompi', md: 'Colombia, en pesos. Links de Bancolombia con PSE, Nequi, tarjeta y corresponsales.', tone: 'slate' },
                ],
            },
            { t: 'h', text: 'El recorrido de un cobro' },
            {
                t: 'steps',
                items: [
                    'Un administrador **conecta** Mercado Pago o Wompi una vez, en Ajustes → Integraciones.',
                    'Desde un registro tocas **Cobrar** (o lo hace una automatización): se crea el link y queda copiado.',
                    'Le mandas el link al cliente por WhatsApp o por correo.',
                    'El cliente paga en la página del proveedor.',
                    'El proveedor le avisa a la app; la app **confirma el pago consultando al proveedor** y actualiza el registro.',
                    'Si tienes una automatización «Cuando se recibe un pago», corre: marcar la factura, agradecer, avisar al equipo.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Por qué es confiable',
                md: 'Un aviso de pago nunca se cree a ciegas: la app vuelve a consultar el pago al proveedor con la credencial de tu empresa antes de marcar nada. Si el cliente pagó otro monto, el link queda en **Monto distinto** para que lo revises, en vez de darlo por pagado.',
            },
            { t: 'anim', key: 'cobro-estados', caption: 'Los estados se actualizan solos: pagado, monto distinto, vencido, reembolsado.' },
            {
                t: 'example',
                title: 'Un gimnasio en Barranquilla',
                md: 'Cada mes una automatización crea la cuota de cada socio con su link de Wompi y se lo manda por WhatsApp. Los que pagan pasan solos a «Pagado» y reciben un «¡Gracias!»; la recepcionista filtra «Estado del pago es Pendiente» y llama sólo a los que faltan.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Necesito una cuenta empresarial en el proveedor?', a: 'Necesitas una cuenta de Mercado Pago o de Wompi habilitada para cobrar, con acceso a sus credenciales. Puedes empezar con las credenciales de **prueba** para ensayar sin dinero real.' },
                    { q: '¿La app guarda los datos de tarjeta del cliente?', a: 'No. El cliente paga en la página del proveedor; la app sólo recibe el resultado: estado, monto, fecha y medio.' },
                    { q: '¿Puedo tener Mercado Pago y Wompi a la vez?', a: 'Sí. Al cobrar eliges con cuál, y en una automatización eliges la acción del proveedor.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Conectar un proveedor', article: 'cobros-conectar' },
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cobros-conectar',
        route: '/settings?s=conectores',
        related: ['cobros-que-es', 'cobros-cobrar', 'integraciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'La conexión de cobro se hace **una vez** en **Ajustes → Integraciones**, en la sección **Cobros y pagos**. Una conexión del equipo la crea un **administrador**: la credencial puede mover dinero en nombre de la empresa. Antes de guardarla, la app **la prueba con el proveedor**: si no sirve, no se guarda y te dice por qué.',
            },
            { t: 'anim', key: 'cobro-conectar', caption: 'Se toca «Conectar» en Mercado Pago, se pega el Access Token, la app lo comprueba y queda conectada en modo prueba.' },
            { t: 'h', text: 'Mercado Pago' },
            {
                t: 'steps',
                items: [
                    'Entra a **mercadopago.com.co/developers** (o el de tu país) → **Tus integraciones** y crea una aplicación, o abre la que ya tengas.',
                    'En **Credenciales de producción** copia el **Access Token**: empieza con APP_USR-. Para ensayar sin dinero real, usa el de prueba, que empieza con TEST-.',
                    'En la app, abre **Ajustes → Integraciones**, busca **Mercado Pago** y toca **Conectar**.',
                    'Pega el **Access Token** y toca **Conectar**. Listo: no hay que configurar nada más, cada link le avisa a la app cuando se paga.',
                ],
            },
            { t: 'h', text: 'Wompi' },
            {
                t: 'steps',
                items: [
                    'Entra a **comercios.wompi.co** → **Desarrolladores** → **Programadores**.',
                    'Copia la **Llave pública** (pub_prod_…), la **Llave privada** (prv_prod_…) y el **Secreto de eventos** (prod_events_…). Para ensayar, las de Sandbox (test).',
                    'En **Ajustes → Integraciones**, toca **Conectar** en **Wompi** y pega las tres.',
                    'Después de conectar, abre **Cobros** en esa conexión, **copia la URL de eventos** y pégala en Wompi → Desarrolladores → **URL de Eventos**. Sin este paso Wompi no le avisa a la app.',
                ],
            },
            {
                t: 'settings',
                title: 'Qué pide cada proveedor',
                rows: [
                    { name: 'Access Token (Mercado Pago)', what: 'La credencial de tu aplicación. Se guarda cifrada y nunca vuelve a mostrarse.' },
                    { name: 'Llave pública (Wompi)', what: 'Identifica a tu comercio. Debe ser del mismo ambiente que la privada (las dos de producción o las dos de prueba).' },
                    { name: 'Llave privada (Wompi)', what: 'Crea los links. Se guarda cifrada.' },
                    { name: 'Secreto de eventos (Wompi)', what: 'Verifica la firma de cada aviso de pago que manda Wompi. Se guarda cifrado.' },
                ],
            },
            { t: 'h', text: 'Modo prueba' },
            {
                t: 'p',
                md: 'Con credenciales de prueba la conexión muestra la marca **Modo prueba** y el diálogo de cobrar avisa que **el link no cobra dinero real**. Úsalo para ensayar todo el circuito —crear el link, pagarlo con las tarjetas de prueba del proveedor, ver cómo cambia el registro y cómo corren tus automatizaciones— antes de pasar a producción. Para pasar a cobrar de verdad, toca **Actualizar clave** y pega las credenciales de producción.',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: '**Desconectar** borra la credencial: los links ya creados siguen en el historial, pero la app deja de poder consultarlos y de crear nuevos. Las automatizaciones que usaban esa conexión fallarán con el motivo y aparecerán en **Problemas**.',
            },
            {
                t: 'example',
                title: 'Una tienda de muebles en Bucaramanga',
                md: 'La dueña conectó primero el Access Token TEST- de Mercado Pago, creó un link desde una cotización y lo pagó con la tarjeta de prueba: vio la cotización pasar a «Pagado» y el correo de agradecimiento. Al día siguiente cambió la clave por la de producción con **Actualizar clave**, sin tocar sus automatizaciones.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Dice que la credencial no sirve', a: 'Revisa que la copiaste completa y que es la de producción o la de prueba que querías. En Wompi, que las llaves sean del mismo ambiente.' },
                    { q: '¿Puedo conectar dos cuentas de Mercado Pago?', a: 'Sí: toca **Conectar otra cuenta**. Al cobrar eliges con cuál.' },
                    { q: '¿Quién puede conectar?', a: 'Un administrador de la empresa. Si el administrador habilitó las conexiones privadas, cada persona puede conectar una que sólo usa ella.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Cobrar desde un registro', article: 'cobros-cobrar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cobros-cobrar',
        route: '/lists',
        related: ['cobros-estados', 'cobros-automatizar', 'cobros-que-es'],
        blocks: [
            {
                t: 'p',
                md: 'Con una conexión de cobro lista, cada registro tiene en su ficha la sección **Cobros**: los links que se crearon para él, con su estado, y el botón **Cobrar** para crear uno nuevo. Lo puede hacer quien puede editar ese registro.',
            },
            { t: 'anim', key: 'cobro-cobrar', caption: 'Se toca «Cobrar», el diálogo trae el concepto y el monto, se crea el link y aparece como «Pendiente».' },
            { t: 'h', text: 'Crear el link' },
            {
                t: 'steps',
                items: [
                    'Abre el registro (por ejemplo, una factura) y baja hasta la sección **Cobros**.',
                    'Toca **Cobrar** (si todavía no tiene ningún cobro, el botón dice **Cobrar este registro**).',
                    'Revisa lo que trae: el **Concepto** sale del título del registro y el **Monto** de su campo de dinero.',
                    'Elige la **Moneda**, escribe el **Correo del cliente** si quieres que el proveedor lo precomplete, y en **Vence en (días)** cuántos días puede pagar (vacío = no vence).',
                    'Toca **Crear link de pago**. El link queda **copiado**: pégalo en el WhatsApp o en el correo del cliente.',
                ],
            },
            { t: 'demo', key: 'cobro-demo-ficha', caption: 'La sección «Cobros» de una factura y el diálogo para crear un link de pago.', fallback: 'cobro-cobrar' },
            {
                t: 'settings',
                title: 'El diálogo «Cobrar»',
                rows: [
                    { name: 'Cobrar con', what: 'Aparece si tienes más de una conexión: Mercado Pago, Wompi u otra cuenta.' },
                    { name: 'Concepto', what: 'Lo que el cliente ve al pagar: «Factura FAC-1042», «Cuota de octubre».' },
                    { name: 'Monto', what: 'Escríbelo como lo lees: 1.250.000 o 1250000. Debajo ves «Se cobra $ 1.250.000».' },
                    { name: 'Moneda', what: 'La de tu cuenta de Mercado Pago (COP, MXN, ARS, CLP, PEN, UYU, BRL). Wompi cobra siempre en pesos colombianos.' },
                    { name: 'Correo del cliente (opcional)', what: 'El proveedor lo usa para precompletar el pago y mandarle el comprobante.' },
                    { name: 'Vence en (días)', what: 'Pasado ese plazo el link pasa solo a **Vencido**. Vacío = no vence.' },
                ],
            },
            { t: 'h', text: 'Lo que puedes hacer con cada link' },
            {
                t: 'settings',
                rows: [
                    { name: 'Copiar link', what: 'Lo copia otra vez, por si lo perdiste.' },
                    { name: 'Abrir la página de pago', what: 'Abre lo que ve el cliente, para revisarlo.' },
                    { name: 'Verificar', what: 'Consulta al proveedor en el momento. Útil si el cliente dice que ya pagó y todavía no se ve.' },
                    { name: 'Anular', what: 'Sólo para un link **Pendiente**. En Wompi además lo desactiva en el proveedor; en Mercado Pago queda «Anulado» en la app.', tip: 'Anula antes de crear otro por un monto distinto, para que el cliente no pague el viejo.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Debajo del botón aparece **Agregar columnas**: crea en la lista las columnas de cobro (link, estado, fecha, monto y medio) para ver y filtrar quién pagó sin abrir cada registro. Lo hace quien puede administrar los campos.',
            },
            {
                t: 'example',
                title: 'Un consultorio veterinario en Quito',
                md: 'Al terminar la consulta, la recepcionista abre la ficha de la mascota, toca **Cobrar** con el valor de la consulta y le pega el link al dueño por WhatsApp mientras sale. Cuando paga desde el carro, la ficha ya dice «Pagado» con Nequi como medio.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'No veo la sección «Cobros»', a: 'La empresa todavía no tiene una conexión de cobro: la sección te lleva a **Ajustes → Integraciones**. Si ya existe y es privada de otra persona, no la puedes usar.' },
                    { q: '¿Puedo crear varios links para un mismo registro?', a: 'Sí: por ejemplo, un anticipo y el saldo. Cada link tiene su estado.' },
                    { q: 'El cliente pagó pero sigue «Pendiente»', a: 'Toca **Verificar**. Si en Wompi pasa siempre, revisa que pegaste la URL de eventos en su panel.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver quién ya pagó', article: 'cobros-estados' },
                    { label: 'Hacerlo en automático', article: 'cobros-automatizar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cobros-estados',
        route: '/lists',
        related: ['cobros-cobrar', 'cobros-panel', 'cobros-automatizar'],
        blocks: [
            {
                t: 'p',
                md: 'Cada link tiene un **estado** que se actualiza solo. Cuando el proveedor avisa de un pago, la app lo **confirma consultando al proveedor** y escribe el resultado en el registro. No tienes que entrar al panel de Mercado Pago ni de Wompi a revisar.',
            },
            { t: 'anim', key: 'cobro-estados', caption: 'La tabla con las columnas de cobro: los estados cambian solos y un filtro deja sólo lo pendiente.' },
            { t: 'h', text: 'Qué significa cada estado' },
            {
                t: 'settings',
                rows: [
                    { name: 'Pendiente', what: 'El link está creado y nadie lo pagó todavía.' },
                    { name: 'Pagado', what: 'El proveedor aprobó el pago por el monto y la moneda del link.' },
                    { name: 'Rechazado', what: 'El cliente intentó pagar y el proveedor lo rechazó. Puede volver a intentar con el mismo link.' },
                    { name: 'Vencido', what: 'Pasó el plazo de **Vence en (días)** sin pago. Cambia solo.' },
                    { name: 'Anulado', what: 'Alguien lo anuló desde la ficha.' },
                    { name: 'Reembolsado', what: 'Lo pagaron y después devolviste el dinero desde el proveedor.' },
                    { name: 'Monto distinto', what: 'El proveedor aprobó un pago por **otro monto o moneda**. Revísalo: no se da por pagado.', tip: 'Pasa, por ejemplo, si el cliente pagó una cuota parcial por otro medio del mismo link.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Un link **Pagado** no vuelve a «Rechazado» si llega un aviso viejo o un intento fallido posterior: sólo un reembolso lo cambia.',
            },
            { t: 'h', text: 'Ver y filtrar en la lista' },
            {
                t: 'p',
                md: 'En la sección **Cobros** de cualquier registro toca **Agregar columnas**. La lista gana cinco columnas que se llenan solas con cada pago:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Link de pago', what: 'El último link creado para ese registro.' },
                    { name: 'Estado del pago', what: 'Una selección con colores: Pendiente, Pagado, Rechazado, Vencido, Anulado, Reembolsado, Monto distinto.' },
                    { name: 'Fecha de pago', what: 'Cuándo se pagó.' },
                    { name: 'Monto pagado', what: 'Lo que efectivamente pagó el cliente.' },
                    { name: 'Medio de pago', what: 'PSE, Nequi, tarjeta, efectivo…' },
                ],
            },
            {
                t: 'p',
                md: 'Con esas columnas armas lo que usas todos los días: una vista **Por cobrar** con el filtro «Estado del pago es Pendiente», un kanban agrupado por **Estado del pago**, o un tablero con la suma de **Monto pagado** del mes.',
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Una automatización «Cuando se recibe un pago» puede además cambiar **tu** campo de estado (por ejemplo, Estado = Pagada) para que todo lo demás —tableros, recordatorios de mora— siga funcionando como siempre.',
            },
            {
                t: 'example',
                title: 'Una administración de edificios en Lima',
                md: 'La lista **Cuotas** tiene una vista «Morosos» con «Estado del pago es Pendiente» y «Vencimiento antes de hoy». El administrador la abre cada lunes: ya no tiene que cruzar el extracto del banco con la lista de departamentos.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo cambiar a mano el «Estado del pago»?', a: 'Sí, es un campo de la lista; pero el siguiente aviso del proveedor lo vuelve a escribir. Para registrar un pago en efectivo, mejor usa tu propio campo de estado.' },
                    { q: '¿Qué pasa si devuelvo el dinero desde Mercado Pago?', a: 'Con el aviso del reembolso, el link pasa a **Reembolsado** y las columnas se actualizan.' },
                    { q: 'Tengo «Monto distinto», ¿qué hago?', a: 'Abre el registro, mira el **Monto pagado** y decide: cobra la diferencia con un link nuevo o márcalo a mano en tu campo de estado.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Crear una vista filtrada', tour: 'views' },
                    { label: 'El panel de cobros', article: 'cobros-panel' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cobros-automatizar',
        route: '/lists',
        related: ['cobros-cobrar', 'correos-enviar', 'automatizaciones-variables'],
        blocks: [
            {
                t: 'p',
                md: 'Lo mejor de los cobros es que pueden ocurrir sin que nadie toque nada: una automatización **crea el link y lo manda**, y otra **reacciona cuando el cliente paga**. Las dos piezas son la acción **Crear link de pago** y el disparador **Cuando se recibe un pago**.',
            },
            { t: 'anim', key: 'cobro-automatizar', caption: 'Una automatización crea el link y lo manda por WhatsApp; otra marca la factura y agradece cuando llega el pago.' },
            { t: 'h', text: 'Crear el link en automático' },
            {
                t: 'steps',
                items: [
                    'Abre las **Automatizaciones** de la lista (por ejemplo **Facturas**) y crea una con el disparador que quieras: **Cuando se crea un registro**, o una fecha.',
                    'Toca **Añadir la primera acción** y, en **Apps conectadas**, elige **Crear link de pago (Mercado Pago)** o **(Wompi)**.',
                    'Completa **Concepto** («Factura {{numero}}»), **Monto** ({{monto}}), la **Moneda**, el **Correo del cliente** y **Vence en (días)**.',
                    'Agrega después un **Enviar email** o un WhatsApp con el link: **{{pago.link}}**.',
                    'Toca **Guardar**. Si quieres ensayarla, usa una conexión en modo prueba.',
                ],
            },
            { t: 'demo', key: 'cobro-demo-automatizar', caption: 'La acción «Crear link de pago» en el menú de acciones de una automatización.', fallback: 'cobro-automatizar' },
            {
                t: 'callout',
                tone: 'tip',
                md: '**Probar ahora** en esa acción no crea un cobro real: te muestra qué link se armaría. Usa **Enviarme una prueba** del correo para ver el mensaje con el botón de pago.',
            },
            { t: 'h', text: 'Reaccionar cuando pagan' },
            {
                t: 'p',
                md: 'Crea otra automatización con el disparador **Cuando se recibe un pago**. Se ejecuta cuando un cliente paga un link creado desde un registro de esa lista, **después** de que la app lo confirmó con el proveedor. El registro es el que tiene el link, así que puedes cambiar sus campos, avisar al equipo o agradecer.',
            },
            {
                t: 'settings',
                title: 'Variables del pago',
                rows: [
                    { name: '{{pago.link}}', what: 'La dirección del link de pago.' },
                    { name: '{{pago.monto}}', what: 'El monto del link.' },
                    { name: '{{pago.estado}}', what: 'El estado en palabras: Pendiente, Pagado…' },
                    { name: '{{pago.monto_pagado}}', what: 'Lo que pagó el cliente.' },
                    { name: '{{pago.metodo}}', what: 'El medio: PSE, Nequi, tarjeta.' },
                    { name: '{{pago.fecha}}', what: 'Cuándo se pagó.' },
                    { name: '{{pago.concepto}}', what: 'El concepto del link.' },
                    { name: '{{pago.id}}', what: 'El número del pago en el proveedor, para conciliar.' },
                ],
            },
            {
                t: 'p',
                md: 'Las dos primeras sirven justo después de **Crear link de pago**; las demás, en una automatización **Cuando se recibe un pago**. En el selector de variables aparecen en su propia sección.',
            },
            { t: 'h', text: 'Recetas que funcionan' },
            {
                t: 'cards',
                items: [
                    { icon: 'Send', title: 'Factura que se cobra sola', md: '**Cuando se crea un registro** → Crear link de pago → Enviar email con un botón «Pagar ahora» a **{{pago.link}}** y la cuenta de cobro en PDF adjunta.', tone: 'blue' },
                    { icon: 'BadgeCheck', title: 'Gracias y a otra cosa', md: '**Cuando se recibe un pago** → Actualizar campo Estado = Pagada → Enviar email «Recibimos {{pago.monto_pagado}} con {{pago.metodo}}».', tone: 'mint' },
                    { icon: 'AlarmClock', title: 'Recordatorio con link nuevo', md: '**Por vencimiento**, 3 días después, si sigue pendiente → Crear link de pago → WhatsApp con el link.', tone: 'amber' },
                    { icon: 'Users', title: 'Aviso al equipo', md: '**Cuando se recibe un pago** con monto alto → Enviar email a cartera@ con el registro y {{pago.id}} para conciliar.', tone: 'violet' },
                ],
            },
            {
                t: 'example',
                title: 'Una escuela de música en Montevideo',
                md: 'El primer día de cada mes, una automatización programada crea la mensualidad de cada alumno con su link de Mercado Pago en pesos uruguayos y la manda por correo a la familia. Cuando pagan, otra marca la mensualidad como **Pagada** y le avisa a la profesora por WhatsApp.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué pasa si falla la creación del link?', a: 'Ese paso falla con el motivo del proveedor, queda en el historial de la automatización y aparece en **Problemas**. Los pasos siguientes no corren.' },
                    { q: '¿Se dispara dos veces si el proveedor avisa dos veces?', a: 'No: el pago se registra una sola vez y la automatización corre una vez por pago confirmado.' },
                    { q: '¿Funciona con los pagos del portal del cliente?', a: 'Sí: un pago hecho desde el portal también dispara **Cuando se recibe un pago**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Recorrido de automatizaciones', tour: 'automation-basics' },
                    { label: 'Diseñar el correo de cobro', article: 'correos-editor' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cobros-panel',
        route: '/settings?s=conectores',
        related: ['cobros-estados', 'portal-pagos', 'cobros-conectar'],
        blocks: [
            {
                t: 'p',
                md: 'Cada conexión de cobro tiene su **panel de cobros**: un resumen de lo que está pasando con tu dinero, sin entrar al proveedor. Ábrelo en **Ajustes → Integraciones**, en la conexión, con el botón **Cobros**.',
            },
            { t: 'anim', key: 'cobro-panel', caption: 'Llega el aviso de un pago: la factura pasa a «Pagado» y los totales del panel se actualizan.' },
            { t: 'h', text: 'Qué muestra' },
            {
                t: 'settings',
                rows: [
                    { name: 'Pendientes, Pagados y Cobrado', what: 'Cuántos links esperan pago, cuántos se pagaron y cuánto dinero entró con ellos.' },
                    { name: 'Modo prueba', what: 'Una marca junto al nombre si la conexión usa credenciales de prueba.' },
                    { name: 'Avisos de pago', what: 'En Mercado Pago no hay nada que configurar. En Wompi muestra la **URL de eventos** para copiar en su panel y la hora del **Último aviso** recibido.', tip: 'Si en Wompi nunca llega un aviso, revisa esa URL.' },
                    { name: 'Cómo cobrar', what: 'Los cuatro caminos: desde un registro, desde una automatización, reaccionar al pago y las columnas de cobro.' },
                    { name: 'Últimos links de pago', what: 'Registro, concepto, monto, estado, medio y fecha, con copiar y abrir.' },
                ],
            },
            { t: 'demo', key: 'cobro-demo-panel', caption: 'De Integraciones al panel de cobros de la conexión de Mercado Pago.', fallback: 'cobro-panel' },
            { t: 'h', text: 'Que tus clientes paguen desde el portal' },
            {
                t: 'p',
                md: 'Si usas el **portal del cliente**, el bloque **Pagos** le muestra a cada cliente sus links con el estado de cada uno y el **comprobante** de los pagados (concepto, monto pagado, fecha, medio y referencia). Además puede ofrecer un botón **Pagar** que cobra el monto de un campo de su registro —por ejemplo, su saldo pendiente—, siempre con una conexión de cobro **del equipo**.',
            },
            { t: 'anim', key: 'portal-pay', caption: 'El cliente paga su saldo desde el portal y ve el comprobante.' },
            {
                t: 'callout',
                tone: 'info',
                md: 'El monto del botón lo lee el servidor desde el registro: un cliente no puede cambiarlo. Si ya hay un link pendiente por ese mismo monto, se reusa en vez de crear otro.',
            },
            {
                t: 'example',
                title: 'Una constructora en Cali',
                md: 'Los compradores de apartamentos entran al portal y ven sus cuotas con su estado. El botón «Pagar la cuota de este mes» cobra el campo **Cuota actual** con Wompi; el gerente sigue en el panel de cobros cuánto entró en la semana.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quién ve el panel de cobros?', a: 'Las personas que tienen acceso a la sección de Integraciones.' },
                    { q: '¿Puedo descargar los pagos?', a: 'Con las columnas de cobro en la lista, exporta la vista a Excel o CSV como cualquier otra.' },
                    { q: '¿El portal muestra pagos de otros clientes?', a: 'No: cada cliente ve sólo los links de su registro y de lo que está vinculado a él.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'El bloque Pagos del portal', article: 'portal-pagos' },
                ],
            },
        ],
    },
];
