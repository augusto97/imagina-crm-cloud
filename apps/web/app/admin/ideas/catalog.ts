import type { FieldType, TemplateRoleField } from '@imagina-base/shared';

import type { IdeaCategoryMeta, IdeaDef, IdeaQuestion } from './types';

/**
 * Catálogo de ideas (v0.1.323, ADR-S76). Cada idea es un caso de uso real,
 * contado como lo contaría la persona («que el cliente reciba un recordatorio
 * antes de que venza la factura»), con lo que crea al activarla.
 *
 * Reglas de redacción: español neutro tuteando, nunca el nombre del producto
 * («la app»), nada de jerga (slug, webhook se explica, JSON no). Las
 * automatizaciones usan la key del ROL en lugar del slug del campo (igual que
 * las recetas de v0.1.167) y `{ $q: 'pregunta' }` donde va una respuesta.
 * `ideas.test.ts` arma cada idea con datos de prueba y la valida con el mismo
 * schema que el servidor: una idea mal escrita rompe el test, no a la persona.
 */

export const IDEA_CATEGORIES: readonly IdeaCategoryMeta[] = [
    { id: 'ventas', label: 'Ventas', description: 'Que ningún cliente potencial se enfríe.', icon: 'TrendingUp', tone: 'blue' },
    { id: 'cobros', label: 'Cobros', description: 'Cobra a tiempo sin perseguir a nadie.', icon: 'Wallet', tone: 'mint' },
    { id: 'clientes', label: 'Clientes y soporte', description: 'Responde rápido y mantén a tus clientes al tanto.', icon: 'Headphones', tone: 'violet' },
    { id: 'proyectos', label: 'Proyectos y tareas', description: 'Que nada se pase de fecha.', icon: 'ListTodo', tone: 'amber' },
    { id: 'agenda', label: 'Agenda y citas', description: 'Menos ausencias y menos llamadas para agendar.', icon: 'CalendarCheck', tone: 'cyan' },
    { id: 'tienda', label: 'Tienda', description: 'Tu tienda en línea, ordenada y al día.', icon: 'Store', tone: 'rose' },
    { id: 'equipo', label: 'Equipo', description: 'Que cada persona sepa qué le toca.', icon: 'Users', tone: 'slate' },
    { id: 'conectar', label: 'Conectar apps', description: 'Lleva tus datos a WhatsApp, Slack, Sheets y más.', icon: 'Plug', tone: 'violet' },
];

const role = (key: string, label: string, types: FieldType[], required = true): TemplateRoleField => ({ key, label, types, required });

const TITULO = role('titulo', 'Nombre o título', ['text'], false);
const NOMBRE = role('nombre', 'Nombre del contacto', ['text'], false);
const EMAIL = role('email', 'Correo del contacto', ['email']);
const ESTADO = role('estado', 'Estado', ['select']);
const RESPONSABLE = role('responsable', 'Responsable', ['user'], false);
const MONTO = role('monto', 'Monto', ['currency', 'number', 'formula', 'rollup', 'computed']);
const TELEFONO = role('telefono', 'Teléfono', ['phone', 'text']);

const AVISAR_A: IdeaQuestion = { kind: 'email', key: 'avisar', label: 'A quién avisar', help: 'Uno o varios correos separados por coma.' };
const AVISAR_RESPONSABLE: IdeaQuestion = {
    kind: 'email',
    key: 'avisar',
    label: 'A quién avisar',
    help: 'Si eliges «Al responsable», le llega a quien esté asignado en cada registro.',
    personRole: 'responsable',
};
const SMS_APPS = ['sms_twilio', 'sms_bulkgate', 'sms_infobip', 'sms_labsmobile', 'sms_onurix'];
const MENSAJERIA: IdeaQuestion = {
    kind: 'connection',
    key: 'conexion',
    label: 'Con qué app',
    apps: ['whatsapp', 'whatsapp_cloud', 'telegram', 'slack', ...SMS_APPS],
};
const SMS_CUENTA: IdeaQuestion = { kind: 'connection', key: 'conexion', label: 'Cuenta de SMS', apps: SMS_APPS };
const COBROS_APP: IdeaQuestion = { kind: 'connection', key: 'conexion', label: 'Cuenta de cobro', apps: ['mercadopago', 'wompi'] };

const q = (key: string): { $q: string } => ({ $q: key });

export const IDEAS: readonly IdeaDef[] = [
    // ── Ventas ──────────────────────────────────────────────────────────
    {
        id: 'embudo-de-ventas',
        category: 'ventas',
        title: 'Arma tu embudo de ventas',
        summary: 'Una lista de oportunidades con etapas, montos y fechas de cierre, lista para usar.',
        problem: 'Las oportunidades viven en chats y notas sueltas, y no sabes cuánto tienes por cerrar este mes.',
        steps: [
            'Se crean las listas de oportunidades con sus etapas (prospecto, propuesta, negociación, ganada, perdida).',
            'Arrastras cada oportunidad de etapa en el tablero kanban, como en una pizarra.',
            'Cada columna suma el monto: ves de un vistazo cuánto hay en juego.',
            'Trae datos de ejemplo para que lo pruebes; los borras cuando quieras.',
        ],
        illustration: 'vistas-kanban',
        icon: 'KanbanSquare',
        tone: 'blue',
        keywords: 'pipeline crm prospectos oportunidades negocios kanban',
        learn: 'vistas/vistas-kanban',
        featured: true,
        plan: { kind: 'list', template: 'sys:pipeline-ventas' },
    },
    {
        id: 'proximo-contacto',
        category: 'ventas',
        title: 'Agenda solo el próximo contacto',
        summary: 'Cada cliente nuevo queda con una fecha para volver a llamarlo.',
        problem: 'Hablas con alguien interesado y, entre una cosa y otra, nadie lo vuelve a contactar.',
        steps: [
            'Cuando se crea un registro, se llena sola la fecha de «Próximo contacto» unos días adelante.',
            'El día que llega esa fecha, le llega un correo a quien tiene que llamar.',
            'Cambias la fecha a mano cuando acuerdas otra cosa con el cliente.',
        ],
        illustration: 'auto-horario',
        icon: 'Phone',
        tone: 'blue',
        listHints: ['client', 'prospect', 'oportunidad', 'contacto', 'lead'],
        keywords: 'seguimiento llamar volver a contactar recordatorio venta',
        learn: 'automatizaciones/automatizaciones-disparadores',
        featured: true,
        plan: {
            kind: 'automations',
            roles: [role('proximo_contacto', 'Próximo contacto', ['date', 'datetime']), TITULO, RESPONSABLE],
            questions: [
                { kind: 'days', key: 'dias', label: 'Cuántos días después', default: 7, unit: 'days' },
                AVISAR_RESPONSABLE,
            ],
            automations: [
                {
                    name: 'Fijar el próximo contacto',
                    description: 'Al crear el registro deja la fecha del próximo contacto unos días adelante.',
                    trigger_type: 'record_created',
                    trigger_config: {},
                    actions: [{ type: 'update_field', config: { values: { proximo_contacto: '{{date.today|+[[q:dias]]d}}' } } }],
                },
                {
                    name: 'Avisar el día del próximo contacto',
                    description: 'El día del próximo contacto manda un correo para no olvidarlo.',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'proximo_contacto', offset_minutes: 0 },
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: q('avisar'),
                                subject: 'Hoy toca contactar a {{titulo}}',
                                body: 'Hola,\n\nHoy es el día acordado para volver a contactar a «{{titulo}}».\n\nCuando hables con el cliente, actualiza la fecha del próximo contacto.',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'bienvenida',
        category: 'ventas',
        title: 'Saluda a cada cliente nuevo',
        summary: 'Un correo de bienvenida sale solo apenas registras a alguien.',
        problem: 'El primer contacto se te olvida o llega tarde, y la primera impresión se pierde.',
        steps: [
            'Registras un cliente nuevo (a mano, por un formulario o importando).',
            'Le llega al instante un correo de bienvenida con su nombre.',
            'Puedes cambiar el texto o diseñarlo con el editor de correos cuando quieras.',
        ],
        illustration: 'correo-enviar',
        icon: 'Mail',
        tone: 'blue',
        listHints: ['client', 'contacto', 'paciente', 'alumno', 'socio'],
        keywords: 'bienvenida correo nuevo cliente saludo onboarding',
        learn: 'automatizaciones/automatizaciones-correos',
        plan: {
            kind: 'automations',
            roles: [EMAIL, NOMBRE],
            questions: [
                {
                    kind: 'text',
                    key: 'mensaje',
                    label: 'Mensaje',
                    multiline: true,
                    default: 'Gracias por confiar en nosotros. Ya tenemos tus datos y en breve nos ponemos en contacto contigo.',
                },
            ],
            automations: [
                {
                    name: 'Correo de bienvenida',
                    description: 'Saluda por correo a cada registro nuevo.',
                    trigger_type: 'record_created',
                    trigger_config: {},
                    actions: [
                        {
                            type: 'send_email',
                            config: { to: '{{email}}', subject: '¡Hola, {{nombre}}! Te damos la bienvenida', body: 'Hola {{nombre}},\n\n[[q:mensaje]]\n\nSaludos.' },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'venta-ganada',
        category: 'ventas',
        title: 'Celebra cada venta cerrada',
        summary: 'Cuando una oportunidad pasa a «Ganada», le avisas al equipo con el monto.',
        problem: 'Las ventas se cierran y nadie más se entera hasta la reunión del viernes.',
        steps: [
            'Mueves una oportunidad a la etapa de venta ganada.',
            'Le llega un correo al equipo con el nombre y el monto.',
            'Si prefieres, también puede llegar a un canal de Slack (idea «Avisa en un canal de Slack»).',
        ],
        illustration: 'auto-flujo',
        icon: 'Target',
        tone: 'blue',
        listHints: ['oportunidad', 'negocio', 'venta', 'pipeline', 'deal'],
        keywords: 'ganado cerrado venta aviso equipo celebrar',
        learn: 'automatizaciones/automatizaciones-disparadores',
        plan: {
            kind: 'automations',
            roles: [ESTADO, TITULO, role('monto', 'Monto', ['currency', 'number', 'formula'], false)],
            questions: [{ kind: 'option', key: 'ganado', role: 'estado', label: 'Etapa de venta ganada', guess: ['ganad', 'cerrad', 'vendid', 'won'] }, AVISAR_A],
            automations: [
                {
                    name: 'Aviso de venta ganada',
                    description: 'Avisa por correo cuando una oportunidad pasa a la etapa ganada.',
                    trigger_type: 'record_updated',
                    trigger_config: { changed_fields: ['estado'], field_filters: [{ slug: 'estado', op: 'eq', value: q('ganado') }] },
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: q('avisar'),
                                subject: '¡Venta cerrada! {{titulo}}',
                                body: '«{{titulo}}» pasó a {{estado|label}}.\n\nMonto: {{monto|moneda}}\n\n¡Felicitaciones al equipo!',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'tablero-ventas',
        category: 'ventas',
        title: 'Mira tus ventas en un tablero',
        summary: 'Monto total, ticket promedio, embudo por etapa y cierres del mes en una sola pantalla.',
        problem: 'Para saber cómo va el mes tienes que filtrar, sumar y armar un informe a mano.',
        steps: [
            'Eliges la lista de oportunidades y qué campos son la etapa, el monto y la fecha.',
            'Se arma un tablero con indicadores, el embudo y la evolución por mes.',
            'Se actualiza solo con cada cambio, y lo puedes compartir o mandar por correo cada lunes.',
        ],
        illustration: 'tab-hero',
        icon: 'LayoutDashboard',
        tone: 'blue',
        listHints: ['oportunidad', 'venta', 'negocio', 'pipeline'],
        keywords: 'dashboard tablero ventas indicadores kpi embudo reporte',
        learn: 'tableros/tableros-crear',
        plan: { kind: 'dashboard', template: 'sys:embudo-de-ventas', name: 'Ventas' },
    },

    // ── Cobros ──────────────────────────────────────────────────────────
    {
        id: 'recordatorio-de-pago',
        category: 'cobros',
        title: 'Recuerda el pago antes de que venza',
        summary: 'Tu cliente recibe un recordatorio unos días antes y otro el día del vencimiento, sólo si no ha pagado.',
        problem: 'Perseguir pagos uno por uno toma horas y es incómodo para todos.',
        steps: [
            'Unos días antes del vencimiento le llega un recordatorio amable al cliente.',
            'El día que vence le llega otro, sólo si la factura sigue pendiente.',
            'Cuando marcas la factura como pagada, los recordatorios dejan de salir.',
        ],
        illustration: 'cobro-automatizar',
        icon: 'AlarmClock',
        tone: 'mint',
        listHints: ['factura', 'cobro', 'cuota', 'cuenta', 'pago', 'cartera'],
        keywords: 'recordatorio pago factura vencimiento cartera cobranza mora',
        learn: 'cobros/cobros-automatizar',
        featured: true,
        plan: {
            kind: 'automations',
            roles: [role('vence', 'Fecha de vencimiento', ['date', 'datetime']), ESTADO, EMAIL, TITULO, role('monto', 'Monto', ['currency', 'number', 'formula', 'rollup', 'computed'], false)],
            questions: [
                { kind: 'option', key: 'pendiente', role: 'estado', label: 'Estado que significa «sin pagar»', guess: ['pendient', 'por cobrar', 'sin pagar', 'vencid', 'abiert'] },
                { kind: 'days', key: 'antes', label: 'Cuántos días antes del vencimiento', default: 3, unit: 'minutes', before: true },
            ],
            automations: [
                {
                    name: 'Recordatorio antes del vencimiento',
                    description: 'Unos días antes de la fecha de vencimiento, si sigue sin pagar, le recuerda al cliente.',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'vence', offset_minutes: q('antes'), field_filters: [{ slug: 'estado', op: 'eq', value: q('pendiente') }] },
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: '{{email}}',
                                subject: 'Recordatorio: «{{titulo}}» vence el {{vence|fecha}}',
                                body: 'Hola,\n\nTe recordamos que «{{titulo}}» por {{monto|moneda}} vence el {{vence|fecha}}.\n\nSi ya realizaste el pago, ignora este mensaje.\n\nGracias.',
                            },
                        },
                    ],
                },
                {
                    name: 'Recordatorio el día del vencimiento',
                    description: 'El día del vencimiento, si sigue sin pagar, le avisa al cliente.',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'vence', offset_minutes: 0, field_filters: [{ slug: 'estado', op: 'eq', value: q('pendiente') }] },
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: '{{email}}',
                                subject: 'Hoy vence «{{titulo}}»',
                                body: 'Hola,\n\nHoy vence «{{titulo}}» por {{monto|moneda}}.\n\nSi ya pagaste, ignora este mensaje. ¡Gracias!',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'marcar-pagada',
        category: 'cobros',
        title: 'Marca la factura como pagada sola',
        summary: 'Cuando el cliente paga el link de Mercado Pago o Wompi, el estado cambia sin que toques nada.',
        problem: 'Revisar la cuenta del banco y actualizar a mano cada factura es lento y se presta a errores.',
        steps: [
            'Le mandas al cliente un link de pago desde la ficha (botón «Cobrar») o con una automatización.',
            'El cliente paga con tarjeta, PSE, Nequi o efectivo.',
            'El estado del registro pasa solo al de pagado, y queda la fecha y el medio de pago.',
        ],
        illustration: 'cobro-estados',
        icon: 'CheckCircle2',
        tone: 'mint',
        listHints: ['factura', 'cobro', 'cuota', 'pedido', 'pago'],
        needsApps: ['mercadopago', 'wompi'],
        keywords: 'pago recibido mercado pago wompi conciliar marcar pagada',
        learn: 'cobros/cobros-automatizar',
        plan: {
            kind: 'automations',
            roles: [ESTADO],
            questions: [{ kind: 'option', key: 'pagado', role: 'estado', label: 'Estado que significa «pagado»', guess: ['pagad', 'cobrad', 'paid', 'cancelad'] }],
            automations: [
                {
                    name: 'Marcar como pagado al recibir el pago',
                    description: 'Cuando entra el pago de un link del registro, cambia el estado a pagado.',
                    trigger_type: 'payment_received',
                    trigger_config: {},
                    actions: [{ type: 'update_field', config: { values: { estado: q('pagado') } } }],
                },
            ],
        },
    },
    {
        id: 'link-de-pago-al-crear',
        category: 'cobros',
        title: 'Envía el link de pago con cada factura',
        summary: 'Al crear una factura se genera su link de pago y le llega al cliente por correo.',
        problem: 'Mandar datos de cuenta y esperar el comprobante hace que el pago se demore días.',
        steps: [
            'Creas la factura (a mano, importando o desde una automatización).',
            'Se genera un link de pago de Mercado Pago o Wompi por el monto exacto.',
            'Le llega al cliente un correo con el botón para pagar.',
            'Cuando paga, el registro se actualiza solo.',
        ],
        illustration: 'cobro-cobrar',
        icon: 'CreditCard',
        tone: 'mint',
        listHints: ['factura', 'cobro', 'cuota', 'cuenta'],
        needsApps: ['mercadopago', 'wompi'],
        keywords: 'link de pago mercado pago wompi factura cobrar pse nequi',
        learn: 'cobros/cobros-cobrar',
        featured: true,
        plan: {
            kind: 'automations',
            roles: [MONTO, EMAIL, TITULO],
            questions: [COBROS_APP, { kind: 'days', key: 'vence', label: 'El link vence en (días)', default: 15, unit: 'days' }],
            automations: [
                {
                    name: 'Link de pago al crear la factura',
                    description: 'Crea el link de pago por el monto y se lo manda al cliente por correo.',
                    trigger_type: 'record_created',
                    trigger_config: {},
                    actions: [
                        {
                            type: 'connector_action',
                            config: {
                                connection_id: q('conexion'),
                                action_key: 'create_payment_link',
                                values: { title: '{{titulo}}', amount: '{{monto}}', payer_email: '{{email}}', expires_days: '[[q:vence]]' },
                            },
                        },
                        {
                            type: 'send_email',
                            config: {
                                to: '{{email}}',
                                subject: 'Tu factura «{{titulo}}» está lista',
                                body: 'Hola,\n\nYa puedes pagar «{{titulo}}» por {{monto|moneda}} desde este enlace:\n\n{{pago.link}}\n\nGracias.',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'gracias-por-pagar',
        category: 'cobros',
        title: 'Agradece cada pago',
        summary: 'Un correo de confirmación con el monto y el medio, apenas entra el pago.',
        problem: 'El cliente paga y no sabe si te llegó; te escribe para preguntar.',
        steps: [
            'El cliente paga un link de Mercado Pago o Wompi.',
            'Le llega un correo confirmando el monto recibido y el medio de pago.',
            'Combínala con «Marca la factura como pagada sola».',
        ],
        illustration: 'cobro-panel',
        icon: 'MailCheck',
        tone: 'mint',
        listHints: ['factura', 'cobro', 'pago', 'cuota'],
        needsApps: ['mercadopago', 'wompi'],
        keywords: 'confirmacion pago recibido gracias comprobante',
        learn: 'cobros/cobros-automatizar',
        plan: {
            kind: 'automations',
            roles: [EMAIL, TITULO],
            questions: [],
            automations: [
                {
                    name: 'Confirmación de pago',
                    description: 'Agradece y confirma el pago al cliente apenas entra.',
                    trigger_type: 'payment_received',
                    trigger_config: {},
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: '{{email}}',
                                subject: 'Recibimos tu pago',
                                body: 'Hola,\n\nRecibimos tu pago de {{pago.monto_pagado|moneda}} ({{pago.metodo}}) por «{{titulo}}».\n\n¡Muchas gracias!',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'facturacion-recurrente',
        category: 'cobros',
        title: 'Organiza tu facturación mensual',
        summary: 'Clientes y facturas vinculados, con saldo pendiente por cliente y aviso de mora.',
        problem: 'No sabes de un vistazo quién te debe y cuánto, ni qué facturas vencen esta semana.',
        steps: [
            'Se crean dos listas vinculadas: Clientes y Facturas.',
            'Cada cliente muestra solo cuánto se le ha facturado y cuánto debe.',
            'Trae un tablero de cartera y un aviso cuando una factura vence.',
        ],
        illustration: 'lc-relacion',
        icon: 'Receipt',
        tone: 'mint',
        keywords: 'facturacion clientes saldo cartera mensual plantilla',
        learn: 'listas-y-campos/listas-y-campos-relaciones',
        plan: { kind: 'list', template: 'sys:facturacion' },
    },
    {
        id: 'tablero-cartera',
        category: 'cobros',
        title: 'Mira tu cartera en un tablero',
        summary: 'Cuánto tienes por cobrar, cuánto ya entró y cómo va cada mes.',
        problem: 'El saldo por cobrar lo calculas en una hoja aparte, y siempre está desactualizado.',
        steps: [
            'Eliges la lista de facturas y qué campos son el estado, el monto y la fecha.',
            'Se arma un tablero con lo pendiente, lo pagado y la evolución por mes.',
            'Lo puedes programar para que te llegue por correo cada semana.',
        ],
        illustration: 'tab-apiladas',
        icon: 'PieChart',
        tone: 'mint',
        listHints: ['factura', 'cobro', 'cartera', 'pago'],
        keywords: 'dashboard cartera cobros pendiente pagado tablero',
        learn: 'tableros/tableros-crear',
        plan: { kind: 'dashboard', template: 'sys:cartera-y-cobros', name: 'Cartera' },
    },

    // ── Clientes y soporte ──────────────────────────────────────────────
    {
        id: 'avisar-cambio-estado',
        category: 'clientes',
        title: 'Mantén al cliente al tanto',
        summary: 'Cada vez que su caso cambia de estado, el cliente recibe un correo con el estado nuevo.',
        problem: 'Los clientes llaman a preguntar «¿cómo va lo mío?» varias veces al día.',
        steps: [
            'Cambias el estado de un caso, pedido o solicitud.',
            'Al cliente le llega un correo: «Tu caso ahora está En revisión».',
            'Menos llamadas, y el cliente siente que lo atienden.',
        ],
        illustration: 'auto-variables',
        icon: 'Send',
        tone: 'violet',
        listHints: ['ticket', 'caso', 'solicitud', 'pedido', 'orden', 'tramite'],
        keywords: 'estado cliente aviso seguimiento caso pedido notificar',
        learn: 'automatizaciones/automatizaciones-variables',
        featured: true,
        plan: {
            kind: 'automations',
            roles: [ESTADO, EMAIL, TITULO],
            questions: [],
            automations: [
                {
                    name: 'Avisar al cliente cuando cambia el estado',
                    description: 'Manda un correo al cliente con el estado nuevo de su caso.',
                    trigger_type: 'record_updated',
                    trigger_config: { changed_fields: ['estado'] },
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: '{{email}}',
                                subject: 'Novedades de «{{titulo}}»',
                                body: 'Hola,\n\nTe contamos que «{{titulo}}» ahora está: {{estado|label}}.\n\nSi tienes preguntas, responde este correo.\n\nSaludos.',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'encuesta-satisfaccion',
        category: 'clientes',
        title: 'Pregunta cómo le fue',
        summary: 'Al cerrar un caso, el cliente recibe una encuesta corta de satisfacción.',
        problem: 'No sabes si tus clientes quedan contentos hasta que se van.',
        steps: [
            'Cierras un caso, un pedido o un servicio.',
            'Le llega al cliente un correo pidiendo una nota del 1 al 5.',
            'Si sumas un campo «Satisfacción», puedes ver el promedio en un tablero.',
        ],
        illustration: 'correo-vista',
        icon: 'Star',
        tone: 'violet',
        listHints: ['ticket', 'caso', 'solicitud', 'servicio', 'pedido', 'proyecto'],
        keywords: 'encuesta satisfaccion nps opinion cerrar caso',
        learn: 'automatizaciones/automatizaciones-correos',
        plan: {
            kind: 'automations',
            roles: [ESTADO, EMAIL, TITULO],
            questions: [{ kind: 'option', key: 'cerrado', role: 'estado', label: 'Estado de cierre', guess: ['cerrad', 'resuelt', 'termin', 'entregad', 'finaliz', 'complet'] }],
            automations: [
                {
                    name: 'Encuesta de satisfacción al cerrar',
                    description: 'Cuando el caso se cierra, le pide al cliente su opinión.',
                    trigger_type: 'record_updated',
                    trigger_config: { changed_fields: ['estado'], field_filters: [{ slug: 'estado', op: 'eq', value: q('cerrado') }] },
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: '{{email}}',
                                subject: '¿Cómo te fue?',
                                body: 'Hola,\n\nTerminamos «{{titulo}}». Nos ayudaría mucho saber cómo te fue: responde este correo con una nota del 1 al 5.\n\n¡Gracias!',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'escalar-vencidos',
        category: 'clientes',
        title: 'Que nada se quede sin respuesta',
        summary: 'Si un caso llega a su fecha límite sin cerrarse, sube a prioridad alta y te avisa.',
        problem: 'Un caso se queda olvidado al fondo de la lista y el cliente se entera antes que tú.',
        steps: [
            'Cada caso tiene su fecha límite.',
            'Si llega esa fecha y no está cerrado, la prioridad sube sola.',
            'A la vez te llega un correo con el caso vencido.',
        ],
        illustration: 'mesa-sla',
        icon: 'AlarmClock',
        tone: 'violet',
        listHints: ['ticket', 'caso', 'solicitud', 'incidencia', 'soporte'],
        keywords: 'escalar vencido prioridad sla fecha limite caso atrasado',
        learn: 'automatizaciones/automatizaciones-logica',
        plan: {
            kind: 'automations',
            roles: [role('vence', 'Fecha límite', ['date', 'datetime']), ESTADO, role('prioridad', 'Prioridad', ['select']), TITULO],
            questions: [
                { kind: 'option', key: 'cerrado', role: 'estado', label: 'Estado de cierre (ese no se escala)', guess: ['cerrad', 'resuelt', 'termin', 'hech', 'complet'] },
                { kind: 'option', key: 'alta', role: 'prioridad', label: 'Prioridad a la que sube', guess: ['urgent', 'alta', 'critic', 'high'] },
                AVISAR_A,
            ],
            automations: [
                {
                    name: 'Escalar los casos vencidos',
                    description: 'Al llegar la fecha límite sin cerrar, sube la prioridad y avisa.',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'vence', offset_minutes: 0, field_filters: [{ slug: 'estado', op: 'neq', value: q('cerrado') }] },
                    actions: [
                        { type: 'update_field', config: { values: { prioridad: q('alta') } } },
                        {
                            type: 'send_email',
                            config: { to: q('avisar'), subject: 'Venció: {{titulo}}', body: '«{{titulo}}» llegó a su fecha límite y sigue en {{estado|label}}. Subimos su prioridad a {{prioridad|label}}.' },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'mesa-de-ayuda',
        category: 'clientes',
        title: 'Convierte tus correos en tickets',
        summary: 'Cada correo que llega a soporte se vuelve un caso con estado, responsable y plazos.',
        problem: 'Los pedidos de ayuda se pierden en la bandeja de entrada y nadie sabe quién responde qué.',
        steps: [
            'Se crea la lista de tickets lista para usar.',
            'Conectas el buzón de soporte (Gmail, Outlook u otro) en sus ajustes.',
            'Cada correo nuevo crea un ticket; las respuestas del cliente se suman al mismo hilo.',
            'Respondes desde la ficha y el cliente lo recibe como un correo normal.',
        ],
        illustration: 'mesa-hero',
        icon: 'Inbox',
        tone: 'violet',
        keywords: 'mesa de ayuda soporte tickets correo buzon helpdesk',
        learn: 'mesa-de-ayuda/mesa-que-es',
        featured: true,
        plan: { kind: 'list', template: 'sys:soporte-tickets' },
    },
    {
        id: 'formulario-contacto',
        category: 'clientes',
        title: 'Recibe solicitudes por un formulario',
        summary: 'Un formulario público para tu sitio o redes que crea registros solos.',
        problem: 'Los datos te llegan por WhatsApp, correo y llamadas, cada uno con un formato distinto.',
        steps: [
            'Eliges la lista donde caen las respuestas.',
            'Armas el formulario con las preguntas que quieras (o con todos los campos de un clic).',
            'Copias el enlace o lo insertas en tu sitio web.',
            'Cada respuesta llega como un registro nuevo.',
        ],
        illustration: 'form-hero',
        icon: 'FormInput',
        tone: 'violet',
        listHints: ['client', 'contacto', 'solicitud', 'prospect', 'lead', 'inscrip'],
        keywords: 'formulario contacto web inscripcion solicitud encuesta',
        learn: 'formularios/formularios-que-son',
        plan: { kind: 'go', to: 'list:formularios', label: 'Crear el formulario', capability: 'MANAGE_FORMS' },
    },
    {
        id: 'gracias-formulario',
        category: 'clientes',
        title: 'Responde al instante a quien llena tu formulario',
        summary: 'Quien completa el formulario recibe un correo de confirmación, y tú un aviso.',
        problem: 'La persona llena tu formulario y no sabe si alguien lo recibió.',
        steps: [
            'Alguien completa el formulario público de la lista.',
            'Le llega un correo confirmando que recibiste su solicitud.',
            'A ti te llega un aviso para responderle pronto.',
        ],
        illustration: 'form-automation',
        icon: 'MailCheck',
        tone: 'violet',
        listHints: ['client', 'contacto', 'solicitud', 'prospect', 'lead', 'inscrip'],
        keywords: 'formulario confirmacion respuesta automatica aviso',
        learn: 'formularios/formularios-automatizar',
        plan: {
            kind: 'automations',
            roles: [EMAIL, NOMBRE],
            questions: [AVISAR_A],
            automations: [
                {
                    name: 'Confirmación a quien llena el formulario',
                    description: 'Le confirma por correo que recibimos su solicitud.',
                    trigger_type: 'form_submitted',
                    trigger_config: {},
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: '{{email}}',
                                subject: 'Recibimos tu solicitud',
                                body: 'Hola {{nombre}},\n\nGracias por escribirnos. Recibimos tu solicitud y te responderemos muy pronto.\n\nSaludos.',
                            },
                        },
                    ],
                },
                {
                    name: 'Aviso de nueva respuesta del formulario',
                    description: 'Te avisa por correo cuando llega una respuesta del formulario.',
                    trigger_type: 'form_submitted',
                    trigger_config: {},
                    actions: [
                        {
                            type: 'send_email',
                            config: { to: q('avisar'), subject: 'Nueva respuesta: {{nombre}}', body: 'Llegó una respuesta del formulario «{{formulario.nombre}}» de {{nombre}} ({{email}}).' },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'portal-clientes',
        category: 'clientes',
        title: 'Dale a cada cliente su propio portal',
        summary: 'Tus clientes entran con un enlace y ven sus datos, sus facturas y conversan contigo.',
        problem: 'Mandas el mismo estado de cuenta por correo una y otra vez.',
        steps: [
            'Activas el portal en la lista de clientes y eliges una plantilla.',
            'Le das acceso a cada cliente con su correo: entra con un enlace, sin contraseña.',
            'Ve lo suyo (y sólo lo suyo): datos, facturas, documentos y un chat contigo.',
        ],
        illustration: 'portal-hero',
        icon: 'AppWindow',
        tone: 'violet',
        listHints: ['client', 'socio', 'paciente', 'alumno'],
        keywords: 'portal cliente acceso estado de cuenta autoservicio',
        learn: 'portal-clientes/portal-que-es',
        plan: { kind: 'go', to: 'list:compartir', label: 'Configurar el portal', capability: 'MANAGE_LISTS' },
    },
    {
        id: 'clasificar-con-ia',
        category: 'clientes',
        title: 'Que la IA clasifique cada caso',
        summary: 'Un agente lee cada caso nuevo y le pone la categoría y la prioridad.',
        problem: 'Clasificar a mano cada solicitud consume la primera hora del día.',
        steps: [
            'Creas el agente desde su plantilla «Clasificar tickets».',
            'Le dices en qué lista trabaja y qué campos puede cambiar.',
            'Cada caso nuevo llega clasificado (o con una propuesta para que la apruebes).',
        ],
        illustration: 'ia-agente',
        icon: 'Bot',
        tone: 'violet',
        keywords: 'inteligencia artificial agente clasificar prioridad tickets automatico',
        learn: 'inteligencia-artificial/ia-agentes',
        plan: { kind: 'go', to: '/agents/new?template=classify_tickets', label: 'Crear el agente', capability: 'MANAGE_AI_AGENTS' },
    },

    // ── Proyectos y tareas ──────────────────────────────────────────────
    {
        id: 'proyectos-y-tareas',
        category: 'proyectos',
        title: 'Organiza proyectos y tareas',
        summary: 'Tareas con responsable, fecha límite, avance y subtareas, con vistas de tablero y calendario.',
        problem: 'Las tareas viven en la cabeza de cada uno y nadie sabe qué está atrasado.',
        steps: [
            'Se crea una lista de tareas con estados, prioridad, responsable y fechas.',
            'Ves el trabajo como tabla, tablero kanban o calendario.',
            'Cada tarea puede tener subtareas, checklist y tiempo registrado.',
        ],
        illustration: 'vistas-gantt',
        icon: 'ListTodo',
        tone: 'amber',
        keywords: 'proyectos tareas pendientes equipo gantt kanban',
        learn: 'vistas/vistas-gantt',
        featured: true,
        plan: { kind: 'list', template: 'sys:proyectos-tareas' },
    },
    {
        id: 'aviso-antes-de-vencer',
        category: 'proyectos',
        title: 'Recuerda las fechas límite',
        summary: 'Unos días antes de que venza una tarea, al responsable le llega un recordatorio.',
        problem: 'Te enteras de que una entrega estaba para hoy cuando ya es tarde.',
        steps: [
            'Cada tarea tiene responsable y fecha límite.',
            'Unos días antes le llega un correo al responsable con la tarea.',
            'Si la tarea ya está terminada, no se manda nada.',
        ],
        illustration: 'dia-recordatorio',
        icon: 'CalendarClock',
        tone: 'amber',
        listHints: ['tarea', 'proyecto', 'entrega', 'actividad', 'pendiente'],
        keywords: 'recordatorio fecha limite vencimiento tarea responsable',
        learn: 'automatizaciones/automatizaciones-disparadores',
        plan: {
            kind: 'automations',
            roles: [role('vence', 'Fecha límite', ['date', 'datetime']), ESTADO, RESPONSABLE, TITULO],
            questions: [
                { kind: 'days', key: 'antes', label: 'Cuántos días antes', default: 2, unit: 'minutes', before: true },
                { kind: 'option', key: 'hecho', role: 'estado', label: 'Estado de terminada (esa no se recuerda)', guess: ['hech', 'termin', 'complet', 'cerrad', 'listo', 'done'] },
                AVISAR_RESPONSABLE,
            ],
            automations: [
                {
                    name: 'Recordatorio antes de la fecha límite',
                    description: 'Unos días antes de la fecha límite le recuerda la tarea al responsable.',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'vence', offset_minutes: q('antes'), field_filters: [{ slug: 'estado', op: 'neq', value: q('hecho') }] },
                    actions: [
                        {
                            type: 'send_email',
                            config: { to: q('avisar'), subject: 'Se acerca la fecha de «{{titulo}}»', body: 'Hola,\n\n«{{titulo}}» vence el {{vence|fecha}} y está en {{estado|label}}.\n\n¡Ánimo!' },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'avance-al-cerrar',
        category: 'proyectos',
        title: 'Al terminar, avance al 100 %',
        summary: 'Cuando una tarea pasa a terminada, su avance queda en 100 sin tocarlo.',
        problem: 'Las tareas terminadas quedan con 80 % y los informes de avance mienten.',
        steps: ['Mueves una tarea a terminada.', 'El campo de avance queda en 100 %.', 'Los tableros de avance del proyecto quedan correctos.'],
        illustration: 'auto-flujo',
        icon: 'Gauge',
        tone: 'amber',
        listHints: ['tarea', 'proyecto', 'actividad'],
        keywords: 'avance progreso porcentaje terminado tarea',
        learn: 'automatizaciones/automatizaciones-acciones',
        plan: {
            kind: 'automations',
            roles: [ESTADO, role('avance', 'Avance', ['percent', 'number'])],
            questions: [{ kind: 'option', key: 'hecho', role: 'estado', label: 'Estado de terminada', guess: ['hech', 'termin', 'complet', 'cerrad', 'listo', 'done'] }],
            automations: [
                {
                    name: 'Avance al 100 % al terminar',
                    description: 'Cuando la tarea pasa a terminada, el avance queda en 100.',
                    trigger_type: 'record_updated',
                    trigger_config: { changed_fields: ['estado'], field_filters: [{ slug: 'estado', op: 'eq', value: q('hecho') }] },
                    actions: [{ type: 'update_field', config: { values: { avance: '100' } } }],
                },
            ],
        },
    },
    {
        id: 'tarea-vencida',
        category: 'proyectos',
        title: 'Entérate de lo atrasado',
        summary: 'El día que vence una tarea sin terminar, te llega un aviso.',
        problem: 'Lo atrasado se descubre en la reunión semanal, no el día que pasa.',
        steps: ['Llega la fecha límite de una tarea.', 'Si no está terminada, te llega un correo con el responsable.', 'Decides a tiempo si mover la fecha o pedir ayuda.'],
        illustration: 'dia-campana',
        icon: 'BellRing',
        tone: 'amber',
        listHints: ['tarea', 'proyecto', 'entrega', 'actividad'],
        keywords: 'atrasado vencido tarea aviso jefe seguimiento',
        learn: 'automatizaciones/automatizaciones-disparadores',
        plan: {
            kind: 'automations',
            roles: [role('vence', 'Fecha límite', ['date', 'datetime']), ESTADO, TITULO, RESPONSABLE],
            questions: [{ kind: 'option', key: 'hecho', role: 'estado', label: 'Estado de terminada', guess: ['hech', 'termin', 'complet', 'cerrad', 'listo', 'done'] }, AVISAR_A],
            automations: [
                {
                    name: 'Aviso de tarea vencida',
                    description: 'El día que vence una tarea sin terminar, avisa por correo.',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'vence', offset_minutes: 0, field_filters: [{ slug: 'estado', op: 'neq', value: q('hecho') }] },
                    actions: [
                        {
                            type: 'send_email',
                            config: { to: q('avisar'), subject: 'Hoy vence «{{titulo}}» y no está terminada', body: '«{{titulo}}» vence hoy y sigue en {{estado|label}}.\n\nResponsable: {{responsable.nombre}}' },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'tablero-carga',
        category: 'proyectos',
        title: 'Mira quién tiene cuánto trabajo',
        summary: 'Un tablero con las tareas por persona, por estado y lo que vence pronto.',
        problem: 'A unos les sobra trabajo y a otros les falta, y nadie lo ve hasta que algo se atrasa.',
        steps: [
            'Eliges la lista de tareas y qué campos son el estado, el responsable y la fecha.',
            'Se arma un tablero con la carga de cada persona.',
            'También puedes usar la vista «Carga de trabajo» de la lista para repartir mejor.',
        ],
        illustration: 'vistas-carga',
        icon: 'Users',
        tone: 'amber',
        listHints: ['tarea', 'proyecto', 'actividad'],
        keywords: 'carga trabajo responsables tablero equipo tareas',
        learn: 'vistas/vistas-carga-de-trabajo',
        plan: { kind: 'dashboard', template: 'sys:carga-de-trabajo', name: 'Carga del equipo' },
    },

    // ── Agenda ──────────────────────────────────────────────────────────
    {
        id: 'agenda-de-citas',
        category: 'agenda',
        title: 'Deja que tus clientes agenden solos',
        summary: 'Una página pública donde eligen servicio, persona, día y hora libres.',
        problem: 'Agendar por chat toma cinco mensajes por cita y a veces se cruzan dos clientes.',
        steps: [
            'Se crea la lista de citas lista para usar.',
            'Configuras servicios, quién atiende y los horarios en «Agenda».',
            'Compartes el enlace: el cliente elige un horario libre y recibe la confirmación.',
            'Le llega un recordatorio antes y puede reprogramar desde el correo.',
        ],
        illustration: 'citas-hero',
        icon: 'CalendarCheck',
        tone: 'cyan',
        keywords: 'agenda citas reservas calendly turnos horarios',
        learn: 'agenda-citas/agenda-que-es',
        featured: true,
        plan: { kind: 'list', template: 'sys:agenda-citas' },
    },
    {
        id: 'recordatorio-cita',
        category: 'agenda',
        title: 'Recuérdale la cita al cliente',
        summary: 'Un día antes, el cliente recibe un recordatorio con la fecha y la hora.',
        problem: 'Los clientes olvidan la cita y el espacio queda vacío.',
        steps: ['Cada cita tiene fecha y el correo del cliente.', 'Un día antes le llega el recordatorio.', 'Menos ausencias, sin llamar a nadie.'],
        illustration: 'citas-email',
        icon: 'CalendarClock',
        tone: 'cyan',
        listHints: ['cita', 'reserva', 'turno', 'agenda', 'consulta', 'clase'],
        keywords: 'recordatorio cita turno reserva ausencias',
        learn: 'agenda-citas/agenda-campos-correos',
        plan: {
            kind: 'automations',
            roles: [role('fecha', 'Fecha de la cita', ['date', 'datetime']), EMAIL, NOMBRE],
            questions: [{ kind: 'days', key: 'antes', label: 'Cuántos días antes', default: 1, unit: 'minutes', before: true }],
            automations: [
                {
                    name: 'Recordatorio de la cita',
                    description: 'Antes de la cita le recuerda al cliente la fecha y la hora.',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'fecha', offset_minutes: q('antes') },
                    actions: [
                        {
                            type: 'send_email',
                            config: {
                                to: '{{email}}',
                                subject: 'Te recordamos tu cita',
                                body: 'Hola {{nombre}},\n\nTe esperamos el {{fecha|larga}}.\n\nSi no puedes venir, avísanos respondiendo este correo.\n\n¡Hasta pronto!',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'pagina-de-agenda',
        category: 'agenda',
        title: 'Publica tu página de agenda',
        summary: 'Configura servicios, horarios y quién atiende sobre una lista que ya tienes.',
        problem: 'Ya tienes una lista de citas y quieres que los clientes reserven solos.',
        steps: ['Eliges la lista de citas.', 'Defines servicios, personas y horarios.', 'Publicas y compartes el enlace o lo insertas en tu sitio.'],
        illustration: 'citas-slots',
        icon: 'Globe',
        tone: 'cyan',
        listHints: ['cita', 'reserva', 'turno', 'agenda'],
        keywords: 'pagina agenda publica reservas horarios',
        learn: 'agenda-citas/agenda-publicar',
        plan: { kind: 'go', to: 'list:agenda', label: 'Configurar la agenda', capability: 'MANAGE_LISTS' },
    },

    // ── Tienda ──────────────────────────────────────────────────────────
    {
        id: 'conectar-tienda',
        category: 'tienda',
        title: 'Trae tu tienda WooCommerce',
        summary: 'Pedidos, productos y clientes de tu tienda, al día y con tableros de ventas e inventario.',
        problem: 'Para ver tus ventas tienes que entrar al panel de la tienda y exportar informes.',
        steps: [
            'Conectas tu tienda con su clave en Integraciones.',
            'Se crean las listas de pedidos, productos y clientes, y se mantienen al día solas.',
            'Editas precios y stock desde aquí, también en lote.',
        ],
        illustration: 'tienda-hero',
        icon: 'Store',
        tone: 'rose',
        keywords: 'woocommerce tienda online pedidos productos inventario',
        learn: 'tiendas-woocommerce/tienda-conectar',
        featured: true,
        plan: { kind: 'go', to: '/settings?s=conectores', label: 'Conectar la tienda', capability: 'workspace_admin' },
    },
    {
        id: 'stock-bajo',
        category: 'tienda',
        title: 'Entérate cuando algo se está agotando',
        summary: 'Un aviso cuando un producto pasa a stock bajo o agotado, con lo que se vendió en el mes.',
        problem: 'Te enteras de que no hay stock cuando un cliente ya intentó comprar.',
        steps: [
            'Un producto llega a stock bajo o agotado (por ventas o porque lo cambiaste).',
            'Te llega un correo con las unidades que quedan y las vendidas en 30 días.',
            'Repones a tiempo.',
        ],
        illustration: 'tienda-stock',
        icon: 'Package',
        tone: 'rose',
        listHints: ['producto', 'inventario', 'stock', 'articulo'],
        keywords: 'stock bajo agotado inventario reponer aviso',
        learn: 'tiendas-woocommerce/tienda-inventario',
        plan: {
            kind: 'automations',
            roles: [
                role('estado_inventario', 'Estado de inventario', ['select']),
                role('nombre', 'Nombre del producto', ['text'], false),
                role('stock', 'Stock', ['number'], false),
            ],
            questions: [
                { kind: 'option', key: 'alertas', role: 'estado_inventario', label: 'Estados que avisan', guess: ['bajo', 'agotad', 'low', 'out'], multiple: true },
                AVISAR_A,
            ],
            automations: [
                {
                    name: 'Aviso de stock bajo',
                    description: 'Avisa cuando un producto pasa a stock bajo o agotado.',
                    trigger_type: 'record_updated',
                    trigger_config: { changed_fields: ['estado_inventario'], field_filters: [{ slug: 'estado_inventario', op: 'in', value: q('alertas') }] },
                    actions: [
                        {
                            type: 'send_email',
                            config: { to: q('avisar'), subject: 'Reponer: {{nombre}} ({{estado_inventario|label}})', body: '«{{nombre}}» está en {{estado_inventario|label}}.\n\nQuedan: {{stock}} unidades.' },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'inventario',
        category: 'tienda',
        title: 'Lleva tu inventario aunque no vendas en línea',
        summary: 'Productos con stock, ubicación, costo y alertas, con lectura de códigos desde el celular.',
        problem: 'El inventario está en una hoja que nadie actualiza a tiempo.',
        steps: [
            'Se crea una lista de inventario lista para usar.',
            'Escaneas el código de barras con la cámara del celular para encontrar cada producto.',
            'Un tablero te muestra qué reponer.',
        ],
        illustration: 'dia-escaner',
        icon: 'Boxes',
        tone: 'rose',
        keywords: 'inventario stock bodega productos codigo barras escaner',
        learn: 'mi-dia/mi-dia-escaner',
        plan: { kind: 'list', template: 'sys:inventario' },
    },

    // ── Equipo ──────────────────────────────────────────────────────────
    {
        id: 'aviso-nuevo-registro',
        category: 'equipo',
        title: 'Entérate de cada registro nuevo',
        summary: 'Te llega un correo cada vez que alguien crea un registro en una lista.',
        problem: 'Los pedidos nuevos esperan horas hasta que alguien abre la lista.',
        steps: ['Alguien crea un registro (a mano, por formulario o por correo).', 'Te llega un aviso con el nombre.', 'Lo abres con un clic.'],
        illustration: 'auto-correo',
        icon: 'Bell',
        tone: 'slate',
        keywords: 'aviso nuevo registro correo equipo notificar',
        learn: 'automatizaciones/automatizaciones-correos',
        plan: {
            kind: 'automations',
            roles: [TITULO],
            questions: [AVISAR_A],
            automations: [
                {
                    name: 'Aviso de registro nuevo',
                    description: 'Avisa por correo cuando se crea un registro.',
                    trigger_type: 'record_created',
                    trigger_config: {},
                    actions: [{ type: 'send_email', config: { to: q('avisar'), subject: 'Nuevo: {{titulo}}', body: 'Se creó «{{titulo}}» (registro #{{record.id}}).' } }],
                },
            ],
        },
    },
    {
        id: 'resumen-diario',
        category: 'equipo',
        title: 'Empieza el día con un resumen',
        summary: 'Cada mañana te llega un correo con lo que tienes asignado, lo que vence y lo atrasado.',
        problem: 'Cada día empieza revisando lista por lista qué te toca.',
        steps: ['Activas el resumen diario en tus avisos.', 'Eliges a qué hora y qué días.', 'Cada mañana te llega un correo con lo tuyo.'],
        illustration: 'dia-resumen',
        icon: 'Mail',
        tone: 'slate',
        keywords: 'resumen diario correo mañana pendientes mis tareas',
        learn: 'mi-dia/mi-dia-avisos',
        plan: { kind: 'go', to: '/settings?s=avisos', label: 'Activar el resumen' },
    },
    {
        id: 'tablero-por-correo',
        category: 'equipo',
        title: 'Recibe tu tablero cada lunes',
        summary: 'Un tablero que llega por correo a quien quieras, a la hora que quieras.',
        problem: 'Armas el mismo informe semanal a mano para la gerencia.',
        steps: ['Abres un tablero y tocas «Compartir».', 'En «Envío por correo» eliges los destinatarios y el horario.', 'Llega con las cifras y los gráficos, y un PDF si quieres.'],
        illustration: 'tab-compartir',
        icon: 'Send',
        tone: 'slate',
        keywords: 'informe semanal tablero correo programado gerencia reporte',
        learn: 'tableros/tableros-compartir',
        plan: { kind: 'go', to: '/dashboards', label: 'Ir a los tableros' },
    },
    {
        id: 'aprobar-gastos',
        category: 'equipo',
        title: 'Pide aprobación antes de pagar',
        summary: 'Los gastos o compras pasan por la aprobación de quien corresponde antes de seguir.',
        problem: 'Las aprobaciones se piden por chat y no queda registro de quién dijo que sí.',
        steps: ['Defines quién aprueba (una persona, un rol o el jefe del registro) en la lista.', 'Se pide la aprobación desde la ficha o con una automatización.', 'Quien aprueba lo hace desde la app o desde el correo, y queda el historial.'],
        illustration: 'aprob-flujo',
        icon: 'BadgeCheck',
        tone: 'slate',
        listHints: ['gasto', 'compra', 'solicitud', 'orden'],
        keywords: 'aprobacion gastos compras autorizar flujo',
        learn: 'aprobaciones/aprobaciones-configurar',
        plan: { kind: 'go', to: 'list:aprobaciones', label: 'Configurar la aprobación', capability: 'MANAGE_LISTS' },
    },

    // ── Conectar apps ───────────────────────────────────────────────────
    {
        id: 'whatsapp-al-crear',
        category: 'conectar',
        title: 'Confirma por WhatsApp cada registro nuevo',
        summary: 'Cuando entra un cliente o un pedido, le llega un WhatsApp de confirmación.',
        problem: 'Tus clientes leen WhatsApp mucho antes que el correo.',
        steps: [
            'Conectas tu WhatsApp en Integraciones.',
            'Cada registro nuevo manda un mensaje al teléfono del cliente con su nombre.',
            'También sirve con Telegram o Slack.',
        ],
        illustration: 'automation-whatsapp',
        icon: 'MessageCircle',
        tone: 'mint',
        listHints: ['client', 'pedido', 'contacto', 'cita', 'reserva'],
        needsApps: ['whatsapp', 'whatsapp_cloud', 'telegram', 'slack'],
        keywords: 'whatsapp mensaje confirmacion cliente telegram',
        learn: 'integraciones/integraciones-mensajeria',
        featured: true,
        plan: {
            kind: 'automations',
            roles: [TELEFONO, NOMBRE],
            questions: [MENSAJERIA, { kind: 'text', key: 'mensaje', label: 'Mensaje', multiline: true, default: 'Hola {{nombre}}, recibimos tus datos. En breve te contactamos. ¡Gracias!' }],
            automations: [
                {
                    name: 'Mensaje de confirmación al crear',
                    description: 'Manda un mensaje al teléfono del registro nuevo.',
                    trigger_type: 'record_created',
                    trigger_config: {},
                    actions: [{ type: '$message', config: { connection: q('conexion'), to: '{{telefono}}', text: q('mensaje') } }],
                },
            ],
        },
    },
    {
        id: 'recordatorio-cita-sms',
        category: 'agenda',
        title: 'Recuérdale la cita por SMS',
        summary: 'Un día antes, el cliente recibe un SMS con la fecha y la hora de su cita.',
        problem: 'Un correo se pierde en la bandeja; un SMS se lee en el momento.',
        steps: ['Conectas tu proveedor de SMS en Integraciones.', 'Un día antes de cada cita sale un SMS al teléfono del cliente.', 'Las tildes se quitan para que entre en un solo SMS.'],
        illustration: 'sms-hero',
        icon: 'MessageSquareText',
        tone: 'cyan',
        listHints: ['cita', 'reserva', 'turno', 'agenda', 'consulta', 'clase'],
        needsApps: SMS_APPS,
        keywords: 'sms recordatorio cita turno reserva ausencias mensaje de texto',
        learn: 'sms/sms-enviar',
        plan: {
            kind: 'automations',
            roles: [role('fecha', 'Fecha de la cita', ['date', 'datetime']), TELEFONO, NOMBRE],
            questions: [
                SMS_CUENTA,
                { kind: 'days', key: 'antes', label: 'Cuántos días antes', default: 1, unit: 'minutes', before: true },
                { kind: 'text', key: 'mensaje', label: 'Mensaje', multiline: true, default: 'Hola {{nombre}}, te recordamos tu cita el {{fecha|larga}}. Si no puedes venir, avísanos.' },
            ],
            automations: [
                {
                    name: 'Recordatorio de la cita por SMS',
                    description: 'Antes de la cita le manda un SMS al cliente con la fecha.',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'fecha', offset_minutes: q('antes') },
                    actions: [
                        {
                            type: 'connector_action',
                            config: { connection_id: q('conexion'), action_key: 'send_sms', values: { to: '{{telefono}}', message: q('mensaje'), strip_accents: 'true', respect_hours: 'false' } },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'aviso-pago-sms',
        category: 'cobros',
        title: 'Recuerda el pago por SMS, en horario permitido',
        summary: 'Antes del vencimiento, el cliente recibe un SMS si sigue sin pagar, siempre dentro del horario de la Ley 2300.',
        problem: 'Los recordatorios de cobro por correo no se leen, y escribir fuera de horario es un riesgo.',
        steps: [
            'Conectas tu proveedor de SMS en Integraciones.',
            'Unos días antes del vencimiento sale un SMS, sólo si la factura sigue pendiente.',
            'Lo que se genere de noche o un domingo queda programado para el siguiente momento permitido.',
        ],
        illustration: 'sms-hours',
        icon: 'MessageSquareText',
        tone: 'mint',
        listHints: ['factura', 'cobro', 'cuota', 'cuenta', 'pago', 'cartera'],
        needsApps: SMS_APPS,
        keywords: 'sms recordatorio pago cobranza factura vencimiento ley 2300 horario',
        learn: 'sms/sms-horario-estado',
        plan: {
            kind: 'automations',
            roles: [role('vence', 'Fecha de vencimiento', ['date', 'datetime']), ESTADO, TELEFONO, TITULO, NOMBRE, role('monto', 'Monto', ['currency', 'number', 'formula', 'rollup', 'computed'], false)],
            questions: [
                SMS_CUENTA,
                { kind: 'option', key: 'pendiente', role: 'estado', label: 'Estado que significa «sin pagar»', guess: ['pendient', 'por cobrar', 'sin pagar', 'vencid', 'abiert'] },
                { kind: 'days', key: 'antes', label: 'Cuántos días antes del vencimiento', default: 3, unit: 'minutes', before: true },
            ],
            automations: [
                {
                    name: 'Recordatorio de pago por SMS',
                    description: 'Unos días antes del vencimiento, si sigue sin pagar, le manda un SMS al cliente (respetando el horario de cobranza).',
                    trigger_type: 'due_date_reached',
                    trigger_config: { due_field: 'vence', offset_minutes: q('antes'), field_filters: [{ slug: 'estado', op: 'eq', value: q('pendiente') }] },
                    actions: [
                        {
                            type: 'connector_action',
                            config: {
                                connection_id: q('conexion'),
                                action_key: 'send_sms',
                                values: {
                                    to: '{{telefono}}',
                                    message: 'Hola {{nombre}}, te recordamos que «{{titulo}}» por {{monto|moneda}} vence el {{vence|fecha}}. Si ya pagaste, ignora este mensaje.',
                                    strip_accents: 'true',
                                    respect_hours: 'true',
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'slack-canal',
        category: 'conectar',
        title: 'Avisa en un canal de Slack',
        summary: 'Cada cambio de estado se publica en el canal de tu equipo.',
        problem: 'El equipo vive en Slack y la información importante está en otra parte.',
        steps: ['Conectas Slack en Integraciones.', 'Eliges el canal (#ventas, #soporte…).', 'Cada cambio de estado se publica con el nombre y el estado nuevo.'],
        illustration: 'integ-connect-once',
        icon: 'Hash',
        tone: 'violet',
        needsApps: ['slack'],
        keywords: 'slack canal equipo aviso estado mensaje',
        learn: 'integraciones/integraciones-mensajeria',
        plan: {
            kind: 'automations',
            roles: [ESTADO, TITULO],
            questions: [
                { kind: 'connection', key: 'conexion', label: 'Cuenta de Slack', apps: ['slack'] },
                { kind: 'text', key: 'canal', label: 'Canal', default: '#general' },
            ],
            automations: [
                {
                    name: 'Avisar en Slack cuando cambia el estado',
                    description: 'Publica en un canal de Slack cada cambio de estado.',
                    trigger_type: 'record_updated',
                    trigger_config: { changed_fields: ['estado'] },
                    actions: [{ type: '$message', config: { connection: q('conexion'), to: q('canal'), text: '«{{titulo}}» pasó de {{before.estado|label}} a {{estado|label}}.' } }],
                },
            ],
        },
    },
    {
        id: 'google-sheets',
        category: 'conectar',
        title: 'Copia cada registro a Google Sheets',
        summary: 'Cada registro nuevo suma una fila a tu hoja de cálculo, para quien sigue trabajando ahí.',
        problem: 'Parte del equipo (o tu contador) sigue trabajando en una hoja de cálculo.',
        steps: ['Conectas tu cuenta de Google en Integraciones.', 'Pegas el enlace de la hoja.', 'Cada registro nuevo agrega una fila con sus datos.'],
        illustration: 'integ-oauth',
        icon: 'FileSpreadsheet',
        tone: 'mint',
        needsApps: ['google_sheets'],
        keywords: 'google sheets hoja calculo excel respaldo fila',
        learn: 'integraciones/integraciones-google-microsoft',
        plan: {
            kind: 'automations',
            roles: [TITULO, role('email', 'Correo', ['email'], false), role('estado', 'Estado', ['select'], false), role('monto', 'Monto', ['currency', 'number'], false)],
            questions: [
                { kind: 'connection', key: 'conexion', label: 'Cuenta de Google', apps: ['google_sheets'] },
                { kind: 'url', key: 'hoja', label: 'Enlace de la hoja de cálculo', placeholder: 'https://docs.google.com/spreadsheets/d/…' },
            ],
            automations: [
                {
                    name: 'Copiar a Google Sheets',
                    description: 'Agrega una fila a la hoja de cálculo por cada registro nuevo.',
                    trigger_type: 'record_created',
                    trigger_config: {},
                    actions: [
                        {
                            type: 'connector_action',
                            config: {
                                connection_id: q('conexion'),
                                action_key: 'append_row',
                                values: { spreadsheet: q('hoja'), values: '{{record.id}}\n{{titulo}}\n{{email}}\n{{estado|label}}\n{{monto}}\n{{date.today}}' },
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'google-calendar',
        category: 'conectar',
        title: 'Pon cada fecha en tu Google Calendar',
        summary: 'Cada registro nuevo con fecha crea un evento en tu calendario.',
        problem: 'Las citas y entregas están en la lista, pero tu día lo organizas en el calendario.',
        steps: ['Conectas tu cuenta de Google en Integraciones.', 'Cada registro nuevo crea un evento con su fecha y nombre.', 'Puedes invitar al cliente con su correo.'],
        illustration: 'vistas-calendario',
        icon: 'CalendarDays',
        tone: 'blue',
        needsApps: ['google_calendar'],
        keywords: 'google calendar calendario evento cita fecha',
        learn: 'integraciones/integraciones-google-microsoft',
        plan: {
            kind: 'automations',
            roles: [role('fecha', 'Fecha', ['date', 'datetime']), TITULO],
            questions: [{ kind: 'connection', key: 'conexion', label: 'Cuenta de Google', apps: ['google_calendar'] }],
            automations: [
                {
                    name: 'Crear evento en Google Calendar',
                    description: 'Crea un evento en el calendario con la fecha del registro.',
                    trigger_type: 'record_created',
                    trigger_config: {},
                    actions: [
                        {
                            type: 'connector_action',
                            config: { connection_id: q('conexion'), action_key: 'create_event', values: { title: '{{titulo}}', date: '{{fecha}}', duration: '60' } },
                        },
                    ],
                },
            ],
        },
    },
    {
        id: 'enviar-a-otra-app',
        category: 'conectar',
        title: 'Envía los datos a otra herramienta',
        summary: 'Cada cambio de estado se manda a Zapier, Make, n8n o a tu propio sistema.',
        problem: 'Tienes otra herramienta que necesita enterarse de lo que pasa aquí.',
        steps: [
            'Copias la dirección que te da la otra herramienta (un «webhook»: una dirección que recibe datos).',
            'La pegas aquí.',
            'Cada cambio de estado le envía el registro con su estado nuevo y el anterior.',
        ],
        illustration: 'auto-webhook',
        icon: 'Webhook',
        tone: 'slate',
        keywords: 'zapier make n8n webhook integrar api sistema',
        learn: 'integraciones/integraciones-webhooks',
        plan: {
            kind: 'automations',
            roles: [ESTADO, TITULO],
            questions: [{ kind: 'url', key: 'url', label: 'Dirección que recibe los datos', placeholder: 'https://hooks.zapier.com/…' }],
            automations: [
                {
                    name: 'Enviar a otra app cuando cambia el estado',
                    description: 'Manda el registro a la dirección indicada cada vez que cambia el estado.',
                    trigger_type: 'record_updated',
                    trigger_config: { changed_fields: ['estado'] },
                    actions: [
                        {
                            type: 'call_webhook',
                            config: {
                                url: q('url'),
                                method: 'POST',
                                content_type: 'application/json',
                                body_params: [
                                    { key: 'id', value: '{{record.id}}' },
                                    { key: 'titulo', value: '{{titulo}}' },
                                    { key: 'estado', value: '{{estado}}' },
                                    { key: 'estado_anterior', value: '{{before.estado}}' },
                                ],
                            },
                        },
                    ],
                },
            ],
        },
    },
];

export function ideaById(id: string): IdeaDef | undefined {
    return IDEAS.find((i) => i.id === id);
}

export function categoryMeta(id: string): IdeaCategoryMeta | undefined {
    return IDEA_CATEGORIES.find((c) => c.id === id);
}

function fold(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/** Búsqueda sin acentos, por palabras: todas tienen que aparecer. */
export function searchIdeas(query: string, ideas: readonly IdeaDef[] = IDEAS): IdeaDef[] {
    const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
    if (words.length === 0) return [...ideas];
    return ideas.filter((i) => {
        const hay = fold([i.title, i.summary, i.problem, i.keywords ?? '', categoryMeta(i.category)?.label ?? '', ...(i.needsApps ?? [])].join(' '));
        return words.every((w) => hay.includes(w));
    });
}
