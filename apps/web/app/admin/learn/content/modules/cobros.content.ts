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
                    { icon: 'Globe', title: 'PayPal', md: 'Para cobrar en **dólares** (o euros y otras monedas de PayPal), a clientes de cualquier país. Pagan con su cuenta PayPal o con tarjeta. PayPal **no** cobra en pesos colombianos.', tone: 'violet' },
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
                    { q: '¿Puedo tener Mercado Pago, Wompi y PayPal a la vez?', a: 'Sí. Al cobrar eliges con cuál, y en una automatización eliges la acción del proveedor. Es común cobrar en pesos con Mercado Pago o Wompi y en dólares con PayPal.' },
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
            { t: 'h', text: 'PayPal' },
            { t: 'anim', key: 'cobro-paypal', caption: 'El link sale del pedido en dólares, el cliente aprueba en PayPal, la app cobra la orden al volver y el pedido pasa solo a «Pagado».' },
            {
                t: 'steps',
                items: [
                    'Entra a **developer.paypal.com** con tu cuenta **PayPal Business** y abre **Apps & Credentials**.',
                    'Arriba elige **Live** (para cobrar de verdad) o **Sandbox** (para ensayar) y toca **Create App**, o abre la que ya tengas.',
                    'Copia el **Client ID** y el **Secret** de esa app (toca **Show** para ver el Secret).',
                    'En **Ajustes → Integraciones**, toca **Conectar** en **PayPal** y pega los dos. La app reconoce sola si son de producción o de prueba, y registra sola en tu cuenta la dirección de avisos de pago: no hay que tocar nada más.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Con PayPal, aprobar no es pagar',
                md: 'Cuando el cliente toca «Pagar» en PayPal, el pago queda **aprobado** pero todavía no se cobró. La app lo **cobra** apenas el cliente vuelve de PayPal, cuando llega el aviso o cuando tocas **Verificar** —una sola vez, aunque pase por los tres caminos—, y recién ahí el registro pasa a «Pagado».',
            },
            {
                t: 'settings',
                title: 'Qué pide cada proveedor',
                rows: [
                    { name: 'Access Token (Mercado Pago)', what: 'La credencial de tu aplicación. Se guarda cifrada y nunca vuelve a mostrarse.' },
                    { name: 'Llave pública (Wompi)', what: 'Identifica a tu comercio. Debe ser del mismo ambiente que la privada (las dos de producción o las dos de prueba).' },
                    { name: 'Llave privada (Wompi)', what: 'Crea los links. Se guarda cifrada.' },
                    { name: 'Secreto de eventos (Wompi)', what: 'Verifica la firma de cada aviso de pago que manda Wompi. Se guarda cifrado.' },
                    { name: 'Client ID (PayPal)', what: 'Identifica a tu app de PayPal. Dice si las credenciales son de producción o de prueba.' },
                    { name: 'Secret (PayPal)', what: 'La clave de esa misma app. Se guarda cifrada y nunca vuelve a mostrarse.' },
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
                    { q: 'Dice que la credencial no sirve', a: 'Revisa que la copiaste completa y que es la de producción o la de prueba que querías. En Wompi, que las llaves sean del mismo ambiente. En PayPal, que el Client ID y el Secret sean de la MISMA app.' },
                    { q: '¿Por qué PayPal no me deja cobrar en pesos?', a: 'PayPal no procesa pesos colombianos. Con PayPal se cobra en dólares (USD) u otra moneda que acepte (euros, pesos mexicanos…). Si el monto del registro está en pesos, escríbelo en dólares al cobrar.' },
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
                md: 'Si la lista todavía no guarda los cobros en ninguna columna, la sección lo avisa con **Elegir columnas**: ahí decides dónde queda el link, el estado, la fecha, el monto y el medio, para ver y filtrar quién pagó sin abrir cada registro. Lo hace quien puede administrar los campos.',
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
                md: 'En la sección **Cobros** de cualquier registro toca **Elegir columnas** (o **Columnas**, si ya elegiste). Para cada dato eliges una columna que la lista **ya tiene** (por ejemplo, un «Link de pago» que creaste a mano), **Crear columna** o **No guardar**. Se llenan solas con cada link y con cada pago:',
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
                    'Más abajo, en **Dónde queda el link**, elige la columna de la lista donde se guarda (por ejemplo tu «Link de pago»), la del estado y la de la fecha de pago, y toca **Guardar los cobros en estas columnas**.',
                    'Agrega después un **Enviar email** o un WhatsApp con el link: **{{pago.link}}**.',
                    'Toca **Guardar**. Si quieres ensayarla, usa una conexión en modo prueba.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si la automatización corre con un **botón**, al presionarlo aparece el aviso **Link de pago listo** con **Copiar link**. Y si le pones un nombre a la respuesta (por ejemplo «pago»), en los pasos siguientes el link también es **{{respuestas.pago.url}}**.',
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
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cobros-suscripciones',
        route: '/settings?s=conectores',
        related: ['formularios-suscribir', 'cobros-automatizar', 'portal-pagos'],
        blocks: [
            {
                t: 'p',
                md: 'Con una **suscripción** el cliente autoriza el pago **una sola vez** —su tarjeta en Mercado Pago, o su cuenta PayPal— y, desde ahí, le cobran solo cada período: cada mes, cada tres meses o cada cierto número de días. Sirve para mensualidades, membresías, mantenimientos, planes de soporte o cualquier servicio que se paga igual todos los meses. No tienes que mandar un link cada mes.',
            },
            { t: 'anim', key: 'cobro-suscripcion', caption: 'La suscripción de un cliente: autoriza la tarjeta, queda al día, un mes se rechaza y Mercado Pago la vuelve a intentar sola.' },
            {
                t: 'callout',
                tone: 'info',
                md: 'Las suscripciones funcionan con **Mercado Pago** (débito automático con tarjeta de crédito o débito, en pesos) y con **PayPal** (la cuenta PayPal o la tarjeta del cliente, en dólares u otra moneda de PayPal). Con **Wompi** sigue habiendo links de pago, uno por cobro. El dinero va directo a la cuenta de tu empresa, sin comisión de la plataforma.',
            },
            { t: 'h', text: '1. Crea un plan' },
            {
                t: 'p',
                md: 'Un plan es «qué se cobra y cada cuánto». Ve a **Ajustes → Integraciones**, abre **Cobros** de tu conexión de Mercado Pago o de PayPal y, en **Suscripciones (débito automático)**, toca **Nuevo plan**:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Nombre', what: 'Cómo se llama el plan: «Mantenimiento mensual», «Membresía oro».' },
                    { name: 'Valor de cada cobro', what: 'Lo que se cobra cada período. Se escribe como siempre: 150.000.' },
                    { name: 'Cada', what: 'Cada cuántos meses o días se cobra (hasta 12 meses o 365 días).' },
                    { name: 'Cuántas cuotas', what: 'Vacío = hasta que se cancele. Con un número (por ejemplo 12), al cobrar la última la suscripción queda **Terminada**.' },
                    { name: 'Días gratis al empezar', what: 'Una prueba gratis: el primer cobro llega después de esos días.' },
                    { name: 'Días de gracia', what: 'Cuántos días se espera después de que vence el período antes de considerarla **Vencida** (10 por defecto). Mientras tanto Mercado Pago reintenta el cobro.' },
                    { name: 'Cuando vence sin pago', what: '**Marcarla «Vencida» y avisar** (recomendado: decides tú qué hacer) o también **cancelarla** en Mercado Pago o PayPal.' },
                    { name: 'Moneda', what: 'Con Mercado Pago, la de tu cuenta (pesos). Con PayPal, dólares u otra moneda que acepte PayPal: **nunca pesos colombianos**.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Si cambias el valor de un plan, vale para las suscripciones **nuevas**. Para subirle el valor a un cliente que ya está suscrito, usa **Cambiar el valor** en su ficha.',
            },
            { t: 'h', text: '2. Suscribe a un cliente' },
            {
                t: 'steps',
                items: [
                    'Abre la ficha del cliente. En la sección **Suscripción** toca **Suscribir**.',
                    'Elige el plan y revisa el **Correo del cliente** (se completa solo si el registro tiene un correo): la suscripción queda a nombre de ese correo.',
                    'Si quieres, cambia el **Valor** para este cliente o pon la fecha del **Primer cobro** (por ejemplo, el día 1 del mes que viene).',
                    'Toca **Crear el link**: la suscripción queda **Por autorizar** y el link se copia con **Copiar link**.',
                    'Mándale el link por WhatsApp o correo. Cuando el cliente autoriza el pago, la ficha pasa sola a **Al día**.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Que se suscriban solos',
                md: 'Con un formulario con **Suscribir al enviar**, cada persona elige el plan y autoriza su tarjeta sin que tengas que mandarle un link. Y en el portal, el bloque **Pagos** le muestra su suscripción, el próximo cobro y sus pagos.',
            },
            { t: 'h', text: 'Trae las suscripciones que ya tienes en Mercado Pago' },
            {
                t: 'p',
                md: 'Si ya cobrabas con débito automático desde Mercado Pago, no tienes que volver a suscribir a nadie: la app las **importa** con sus planes, su estado y sus cobros, y desde ahí las ves y las manejas como las que creas aquí (pausar, cambiar el valor, cancelar, automatizaciones, portal).',
            },
            { t: 'anim', key: 'cobro-importar', caption: 'Las suscripciones de tu cuenta de Mercado Pago pasan a la lista con su estado, y una nueva que se crea allá llega sola.' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Integraciones**, abre **Cobros** de tu conexión de Mercado Pago y toca **Importar desde Mercado Pago**.',
                    'Elige **adónde llegan**: **A una lista nueva** «Suscriptores · Mercado Pago» (un registro por suscripción, con las columnas ya puestas) o **A mis clientes de una lista**, vinculando cada suscripción al registro cuyo correo coincide (eliges la lista y la **Columna del correo**).',
                    'Toca **Ver qué se trae**: antes de importar nada ves cuántas hay activas, pausadas, por autorizar y canceladas, cuántas encuentran su cliente por correo y algunas de ejemplo.',
                    'Toca **Importar** (o **Crear la lista e importar**): los planes de Mercado Pago llegan como planes, cada suscripción con su estado y sus cobros, y —si lo eliges— cada cobro al **registro de cobros** con su tablero. Puedes cerrar la ventana: sigue sola. Importar no dispara automatizaciones.',
                ],
            },
            {
                t: 'settings',
                title: 'Opciones al importar',
                rows: [
                    { name: 'Crear el cliente que no está en la lista', what: 'Al vincular por correo, si el correo no coincide con ningún registro se crea uno con ese correo. Apagado, la suscripción queda sin registro y se ve en **Cobros**.' },
                    { name: 'Traer también las canceladas', what: 'Para tener el historial completo. Apagado, sólo se traen las activas y las pausadas.' },
                    { name: 'Traer también las que quedaron «Por autorizar»', what: 'Son de alguien que empezó a suscribirse y nunca puso la tarjeta. Apagado (lo normal) no se traen: si después la autoriza, llega sola.' },
                    { name: 'Guardar cada cobro como un registro · Crear también su tablero', what: 'Crea la lista «Cobros de suscripciones» con lo pagado y lo rechazado mes a mes, y su tablero (si todavía no tienes un registro de cobros).' },
                    { name: 'Traer solas las suscripciones nuevas', what: 'Las que se creen después en Mercado Pago (por ejemplo, desde el link de un plan que ya tenías publicado) llegan solas a la misma lista, por los avisos y una revisión cada 30 minutos. Se apaga cuando quieras desde la misma tarjeta.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Puedes importar cuantas veces quieras: lo que ya está en la app no se duplica. La lista nueva es una lista común: le agregas columnas, la filtras o le pones automatizaciones como a cualquier otra.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Por qué un suscriptor sale como «Cliente de Mercado Pago #número»?',
                        a: 'Mercado Pago no siempre da el correo de quien se suscribe; la app usa su **nombre** (el que tiene en Mercado Pago) y, si tampoco lo da, su número de cliente. Cuando llega un pago con su correo o su nombre, el registro se completa solo. Puedes escribirle el nombre a mano: la app no lo vuelve a cambiar.',
                    },
                    {
                        q: '¿Cómo veo todas las suscripciones de un mismo cliente juntas?',
                        a: 'En la vista **Por cliente** de la lista: agrupa por el suscriptor, así quien tuvo una suscripción cancelada y otra nueva aparece en un solo grupo.',
                    },
                    {
                        q: '¿Qué es un cobro «Según el resumen de Mercado Pago»?',
                        a: 'Cuando Mercado Pago no entrega el detalle de cada pago de una suscripción, la app usa el resumen que lleva Mercado Pago (cuántos cobros salieron y cuándo fue el último) para que el estado y «Pagado hasta» digan la verdad. Ese último cobro aparece así hasta que llega su pago real, que lo reemplaza sin duplicarlo. En **Cobros** de la conexión ves qué respondió Mercado Pago la última vez.',
                    },
                ],
            },
            { t: 'h', text: 'Qué significa cada estado' },
            {
                t: 'settings',
                rows: [
                    { name: 'Por autorizar', what: 'Se creó el link y el cliente todavía no autorizó la tarjeta. La ficha revisa sola cada pocos segundos mientras está abierta.' },
                    { name: 'Al día', what: 'El período actual está pagado.' },
                    { name: 'Reintentando', what: 'Falló el cobro del período (por ejemplo, fondos insuficientes) y Mercado Pago o PayPal lo vuelve a intentar en los próximos días.' },
                    { name: 'En mora', what: 'Se agotaron los reintentos y el período sigue sin pagar, pero todavía no pasaron los días de gracia. En PayPal, al tercer cobro fallido PayPal suspende la suscripción: aquí se ve como **En mora**, no como pausada.' },
                    { name: 'Vencida', what: 'Pasaron los días de gracia sin pago. Si el plan lo pide, además se cancela en Mercado Pago o PayPal.' },
                    { name: 'Pausada', what: 'No se cobra hasta que la reanudes.' },
                    { name: 'Cancelada', what: 'Ya no se cobra. El cliente puede volver a suscribirse con un link nuevo.' },
                    { name: 'Terminada', what: 'Se cobraron todas las cuotas del plan.' },
                ],
            },
            {
                t: 'p',
                md: 'Cada cobro aparece en la lista **Cobros** de la ficha con su resultado (Pagado o Rechazado), el valor, la fecha, el medio de pago y, si se rechazó, **por qué**. El mismo pago nunca se cuenta dos veces aunque el proveedor avise por dos caminos.',
            },
            { t: 'h', text: 'Con PayPal' },
            {
                t: 'p',
                md: 'Funciona igual que con Mercado Pago, con estas diferencias: el cliente aprueba la suscripción con su **cuenta PayPal o con tarjeta**, se cobra en **dólares** (u otra moneda de PayPal) y la app crea sola, en tu cuenta de PayPal, lo que PayPal necesita para cobrar el plan. El valor de cada cliente puede ser distinto al del plan.',
            },
            { t: 'anim', key: 'cobro-paypal', caption: 'El cliente aprueba en PayPal y vuelve: la app lo confirma con PayPal antes de marcarlo al día.' },
            {
                t: 'settings',
                rows: [
                    { name: 'Avisos', what: 'PayPal avisa cada cobro por la misma dirección de los links de pago (en **Cobros → Avisos de pago**). Sin avisos igual funciona: la app revisa cada suscripción por su cuenta.' },
                    { name: 'Si el cliente se arrepiente', what: 'Si vuelve de PayPal sin aprobar, la página le dice que no se cobró nada y le ofrece **Volver a PayPal**.' },
                    { name: 'Cancelar una que nunca se aprobó', what: 'PayPal no deja cancelar una suscripción sin aprobar: la app la cancela aquí y su link deja de mostrarse.' },
                    { name: 'Cobros fallidos', what: 'PayPal reintenta; cada intento rechazado queda en **Cobros** con su motivo («la cuenta PayPal del cliente no puede pagar»).' },
                ],
            },
            { t: 'h', text: 'Ver quién está al día en la lista' },
            {
                t: 'p',
                md: 'En la sección **Suscripción** toca **Elegir columnas** (o **Columnas**): el estado, el próximo cobro, el «pagado hasta», el plan, el valor, los cobros fallidos y el link se escriben solos en las columnas que elijas. Con eso armas una vista «En mora» filtrando por **Estado de la suscripción**, un kanban por estado o un tablero con lo que entra cada mes.',
            },
            { t: 'anim', key: 'cobro-estados', caption: 'Las columnas se llenan solas y un filtro deja sólo lo que hay que revisar.' },
            { t: 'h', text: 'Cada cobro en su propia lista (registro de cobros)' },
            {
                t: 'p',
                md: 'Las columnas dicen cómo va **hoy** cada cliente; el **registro de cobros** guarda la historia: cada cobro de Mercado Pago o PayPal (pagado, rechazado o reembolsado) queda como un **registro** en otra lista, vinculado al cliente. Con eso sumas lo cobrado por mes, ves cuántos cobros se rechazaron y por qué, y armas reportes como con cualquier dato.',
            },
            { t: 'anim', key: 'cobro-registro', caption: 'Cada cobro cae como una fila en «Cobros de suscripciones» y el tablero suma lo cobrado del mes.' },
            {
                t: 'steps',
                items: [
                    'En la sección **Suscripción** de la ficha toca **Columnas** y baja hasta **Registro de cobros**.',
                    'Elige **Crear la lista «Cobros de suscripciones»** (con su tablero, si quieres) o **Usar una lista que ya existe**, por ejemplo tu lista de facturas.',
                    'Si usas una lista tuya, elige qué columna guarda cada dato: el **Suscriptor** (una relación hacia la lista de clientes), el valor, el estado, la fecha, el período, el plan, el medio de pago, el motivo del rechazo y el id del pago. Lo que falte se crea solo.',
                    'Guarda: los cobros que ya existían se cargan al momento, sin disparar automatizaciones. Desde ahí, cada cobro nuevo llega solo y sí dispara las automatizaciones de esa lista.',
                ],
            },
            {
                t: 'settings',
                title: 'Lo que trae el tablero de la lista nueva',
                rows: [
                    { name: 'Cobrado este mes · Cobrado en total', what: 'La suma de los cobros pagados.' },
                    { name: 'Pagados y rechazados este mes', what: 'Cuántos cobros salieron y cuántos no.' },
                    { name: 'Cobros por mes', what: 'Barras apiladas por estado: ves de un vistazo si los rechazos suben.' },
                    { name: 'Por estado y por plan', what: 'Una dona por estado y cuánto deja cada plan.' },
                    { name: 'Últimos rechazos', what: 'La tabla con el cliente, el valor y el motivo, para llamar a quien toca.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Si alguien borra un registro de cobro, no vuelve a aparecer: la app respeta lo que borras. Y si un cobro cambia después (un reembolso), su registro se actualiza en lugar de crear otro.',
            },
            { t: 'h', text: 'Pídeselo al asistente' },
            {
                t: 'p',
                md: 'El asistente de IA (y Claude por el conector MCP) también trabaja con las suscripciones: «¿quién está en mora?», «¿a quién hay que cortarle el servicio?», «crea un plan anual de 900.000», «guarda los cobros en su propia lista con tablero» o «suscribe a Panadería Sol al plan mensual». Lo que cambia algo llega como una **propuesta** que apruebas con un botón; al suscribir, te deja el link para el cliente.',
            },
            { t: 'h', text: 'Pausar, cambiar el valor o cancelar' },
            {
                t: 'settings',
                rows: [
                    { name: 'Verificar', what: 'Le pregunta a Mercado Pago cómo va la suscripción en este momento.' },
                    { name: 'Pausar / Reanudar', what: 'Deja de cobrar mientras está pausada (vacaciones, un mes sin servicio).' },
                    { name: 'Cambiar el valor', what: 'El valor nuevo se cobra desde el próximo período. Mercado Pago le avisa al cliente.' },
                    { name: 'Cancelar', what: 'Mercado Pago deja de cobrarle. Puedes anotar el motivo.' },
                ],
            },
            { t: 'h', text: 'Automatizaciones con suscripciones' },
            {
                t: 'p',
                md: 'El disparador **Cuando cambia una suscripción** se ejecuta con lo que pasa: se activó, se cobró una cuota, falló un cobro, entró en mora, venció, se pausó, se reanudó, se canceló o terminó. Marca sólo lo que te interesa y, si quieres, sólo algunos planes. Así avisas al cliente que su pago falló, le avisas al equipo cuando alguien entra en mora o suspendes el servicio cuando vence.',
            },
            {
                t: 'settings',
                title: 'Variables de la suscripción',
                rows: [
                    { name: '{{suscripcion.estado}}', what: 'El estado en palabras: Al día, Reintentando, En mora…' },
                    { name: '{{suscripcion.plan}} · {{suscripcion.monto}}', what: 'El plan y el valor de cada cobro.' },
                    { name: '{{suscripcion.proximo_cobro}} · {{suscripcion.pagado_hasta}}', what: 'Cuándo toca el próximo cobro y hasta cuándo está pagado.' },
                    { name: '{{suscripcion.motivo}}', what: 'Por qué se rechazó el cobro o por qué se canceló.' },
                    { name: '{{suscripcion.link}}', what: 'El link para autorizar la tarjeta (mientras está por autorizar).' },
                ],
            },
            {
                t: 'p',
                md: 'Y dos acciones de **Mercado Pago**: **Crear suscripción** (por ejemplo, al marcar un cliente como «Activo», crea el link y en el paso siguiente lo mandas por WhatsApp con **{{suscripcion.link}}**) y **Pausar, reanudar, cancelar o cambiar el valor** de la suscripción del registro. Su **Probar ahora** no toca a ningún cliente real: te muestra lo que haría.',
            },
            {
                t: 'example',
                title: 'Un gimnasio en Medellín',
                md: 'Cada socio nuevo recibe por WhatsApp el link de su membresía mensual. Cuando un cobro falla, una automatización le escribe «Tu pago de {{suscripcion.plan}} no pasó: {{suscripcion.motivo}}». Si entra en mora, la recepción ve el estado en la lista al momento del ingreso.',
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Para enterarte **al instante** de cada cobro, copia la **URL de avisos** que aparece en Suscripciones y pégala en tu aplicación de Mercado Pago → **Webhooks**, con los eventos **Pagos** y **Planes y suscripciones**. Sin ella también funciona: la app revisa cada suscripción sola, sólo que se entera unos minutos después.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo tener dos suscripciones en el mismo registro?', a: 'Una a la vez. Para cambiar de plan, cancela la actual y suscríbelo al nuevo; las anteriores quedan en **Ver las anteriores**.' },
                    { q: '¿Qué pasa si el cliente nunca abre el link?', a: 'La suscripción queda **Por autorizar** y no se cobra nada. Puedes tocar **Crear otro link** para mandarle uno nuevo.' },
                    { q: '¿Se cobra el primer mes al autorizar?', a: 'Sí, salvo que el plan tenga días gratis o pongas la fecha del **Primer cobro**.' },
                    { q: '¿Puedo cambiar a mano el «Estado de la suscripción» en la lista?', a: 'Puedes, pero la siguiente noticia de Mercado Pago lo vuelve a escribir. Para registrar algo propio, usa tu propio campo.' },
                    { q: '¿Funciona en modo prueba?', a: 'Sí: con las credenciales de prueba de Mercado Pago el link abre el ambiente de prueba y no se cobra dinero real.' },
                    { q: 'Ya tengo suscripciones en Mercado Pago, ¿se pueden traer?', a: 'Sí: **Importar desde Mercado Pago** en Cobros de la conexión trae las suscripciones y sus planes, con su estado y sus cobros. Con PayPal todavía no se pueden importar.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Suscribir desde un formulario', article: 'formularios-suscribir' },
                ],
            },
        ],
    },
];
