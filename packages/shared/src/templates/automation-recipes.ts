import { BLUEPRINT_VERSION } from '../schemas/list-template';
import type { FieldType } from '../schemas/field';
import type { AutomationTemplate, AutomationTemplateCategory, TemplateRoleField } from '../schemas/templates';

/**
 * Recetas de automatización del SISTEMA (v0.1.167) — las que trae la app,
 * como las "recipes" de Zapier o las plantillas de automatización de
 * ClickUp. Viven en `shared` porque se aplican EN EL CLIENTE: se mapean los
 * roles a los campos de la lista, se re-escribe el cuerpo y se abre el
 * editor pre-cargado para revisar (destinatarios, valores) antes de guardar.
 *
 * Convención: dentro del cuerpo, la `key` de cada rol se usa como si fuera
 * el slug del campo. Los valores que la persona debe completar van vacíos
 * a propósito (la descripción lo dice) — inventar un destinatario o un valor
 * de estado que no existe en su lista sería peor.
 */
export interface SystemAutomationTemplate {
    key: string;
    name: string;
    description: string;
    category: AutomationTemplateCategory;
    template: AutomationTemplate;
}

const role = (key: string, label: string, types: FieldType[], required = true): TemplateRoleField => ({
    key,
    label,
    types,
    required,
});

const DAY = 24 * 60;

const recipe = (
    key: string,
    name: string,
    description: string,
    category: AutomationTemplateCategory,
    fields: TemplateRoleField[],
    body: Pick<AutomationTemplate, 'trigger_type' | 'trigger_config' | 'actions'>,
): SystemAutomationTemplate => ({
    key,
    name,
    description,
    category,
    template: { version: BLUEPRINT_VERSION, fields, name, description, ...body },
});

const TITULO = role('titulo', 'Título o nombre', ['text'], false);
const ESTADO = role('estado', 'Estado', ['select']);
const EMAIL = role('email', 'Email del contacto', ['email']);

export const SYSTEM_AUTOMATION_TEMPLATES: readonly SystemAutomationTemplate[] = [
    recipe(
        'bienvenida',
        'Correo de bienvenida al crear',
        'Cuando se crea un registro, le manda un correo de bienvenida al email del contacto.',
        'correo',
        [EMAIL, role('nombre', 'Nombre del contacto', ['text'], false)],
        {
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [
                {
                    type: 'send_email',
                    config: {
                        to: '{{email}}',
                        subject: '¡Bienvenido/a, {{nombre}}!',
                        body: 'Hola {{nombre}},\n\nGracias por confiar en nosotros. Ya registramos tus datos y en breve nos ponemos en contacto.\n\nSaludos.',
                    },
                },
            ],
        },
    ),
    recipe(
        'aviso-nuevo-registro',
        'Avisar al equipo cuando se crea un registro',
        'Cada alta manda un correo interno con el título del registro. Completá el destinatario.',
        'correo',
        [TITULO],
        {
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [
                {
                    type: 'send_email',
                    config: {
                        to: '',
                        subject: 'Nuevo registro: {{titulo}}',
                        body: 'Se creó «{{titulo}}» (registro #{{record.id}}).',
                    },
                },
            ],
        },
    ),
    recipe(
        'cambio-de-estado',
        'Avisar por correo cuando cambia el estado',
        'Cada vez que cambia el estado, manda un correo con el valor nuevo y el anterior. Completá el destinatario.',
        'correo',
        [ESTADO, TITULO],
        {
            trigger_type: 'record_updated',
            trigger_config: { changed_fields: ['estado'] },
            actions: [
                {
                    type: 'send_email',
                    config: {
                        to: '',
                        subject: '{{titulo}} pasó a {{estado}}',
                        body: '«{{titulo}}» cambió de {{before.estado}} a {{estado}}.',
                    },
                },
            ],
        },
    ),
    recipe(
        'encuesta-satisfaccion',
        'Encuesta de satisfacción al cerrar',
        'Cuando el estado pasa al valor de cierre (completalo en la condición), le pide al contacto su opinión por correo.',
        'correo',
        [ESTADO, EMAIL, TITULO],
        {
            trigger_type: 'record_updated',
            trigger_config: {
                changed_fields: ['estado'],
                field_filters: [{ slug: 'estado', op: 'eq', value: '' }],
            },
            actions: [
                {
                    type: 'send_email',
                    config: {
                        to: '{{email}}',
                        subject: '¿Cómo fue tu experiencia?',
                        body: 'Hola,\n\nCerramos «{{titulo}}». Nos ayudaría mucho saber cómo te fue: respondé este correo con una nota del 1 al 5.\n\n¡Gracias!',
                    },
                },
            ],
        },
    ),
    recipe(
        'recordatorio-antes-de-vencer',
        'Recordatorio 3 días antes de la fecha',
        'Tres días antes de la fecha límite manda un correo de aviso. Completá el destinatario; el plazo se ajusta en el disparador.',
        'plazos',
        [role('fecha', 'Fecha límite', ['date', 'datetime']), TITULO],
        {
            trigger_type: 'due_date_reached',
            trigger_config: { due_field: 'fecha', offset_minutes: -3 * DAY },
            actions: [
                {
                    type: 'send_email',
                    config: {
                        to: '',
                        subject: 'Vence en 3 días: {{titulo}}',
                        body: '«{{titulo}}» vence el {{fecha}}.',
                    },
                },
            ],
        },
    ),
    recipe(
        'recordatorio-de-pago',
        'Recordatorio de pago a los 20 días',
        'Veinte días después de la fecha de emisión, si el estado sigue siendo el pendiente (completalo en la condición), manda un recordatorio al email del contacto.',
        'plazos',
        [role('fecha', 'Fecha de emisión', ['date', 'datetime']), ESTADO, EMAIL, TITULO],
        {
            trigger_type: 'due_date_reached',
            trigger_config: {
                due_field: 'fecha',
                offset_minutes: 20 * DAY,
                field_filters: [{ slug: 'estado', op: 'eq', value: '' }],
            },
            actions: [
                {
                    type: 'send_email',
                    config: {
                        to: '{{email}}',
                        subject: 'Recordatorio de pago: {{titulo}}',
                        body: 'Hola,\n\nTe recordamos que «{{titulo}}», emitida el {{fecha}}, sigue pendiente de pago.\n\nGracias.',
                    },
                },
            ],
        },
    ),
    recipe(
        'escalar-al-vencer',
        'Escalar la prioridad al vencer',
        'Al llegar la fecha límite, si el estado sigue abierto (completalo en la condición), sube la prioridad al valor que elijas.',
        'plazos',
        [role('vence', 'Fecha límite', ['date', 'datetime']), ESTADO, role('prioridad', 'Prioridad', ['select'])],
        {
            trigger_type: 'due_date_reached',
            trigger_config: {
                due_field: 'vence',
                offset_minutes: 0,
                field_filters: [{ slug: 'estado', op: 'eq', value: '' }],
            },
            actions: [{ type: 'update_field', config: { values: { prioridad: '' } } }],
        },
    ),
    recipe(
        'proximo-contacto',
        'Fijar el próximo contacto a 7 días',
        'Al crear el registro, deja la fecha de próximo contacto una semana adelante.',
        'campos',
        [role('proximo_contacto', 'Próximo contacto', ['date', 'datetime'])],
        {
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [{ type: 'update_field', config: { values: { proximo_contacto: '{{date.today|+7d}}' } } }],
        },
    ),
    recipe(
        'completar-avance',
        'Al cerrar, avance al 100 %',
        'Cuando el estado pasa al valor de cierre (completalo en la condición), el avance queda en 100.',
        'campos',
        [ESTADO, role('avance', 'Avance', ['percent', 'number'])],
        {
            trigger_type: 'record_updated',
            trigger_config: {
                changed_fields: ['estado'],
                field_filters: [{ slug: 'estado', op: 'eq', value: '' }],
            },
            actions: [{ type: 'update_field', config: { values: { avance: '100' } } }],
        },
    ),
    recipe(
        'webhook-cambio-estado',
        'Enviar a un webhook cuando cambia el estado',
        'Manda id, título y estado a la URL que indiques (Zapier, Make, n8n o tu propia API) cada vez que cambia el estado.',
        'integraciones',
        [ESTADO, TITULO],
        {
            trigger_type: 'record_updated',
            trigger_config: { changed_fields: ['estado'] },
            actions: [
                {
                    type: 'call_webhook',
                    config: {
                        url: '',
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
    ),
    recipe(
        'whatsapp-al-crear',
        'WhatsApp de confirmación al crear',
        'Llama a tu gateway de WhatsApp/SMS con el teléfono del contacto y un mensaje. Completá la URL y las credenciales del proveedor.',
        'integraciones',
        [role('telefono', 'Teléfono', ['phone', 'text']), role('nombre', 'Nombre del contacto', ['text'], false)],
        {
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [
                {
                    type: 'call_webhook',
                    config: {
                        url: '',
                        method: 'POST',
                        content_type: 'application/x-www-form-urlencoded',
                        body_params: [
                            { key: 'recipient', value: '{{telefono}}' },
                            { key: 'message', value: 'Hola {{nombre}}, recibimos tu solicitud. En breve te contactamos.' },
                        ],
                    },
                },
            ],
        },
    ),
];

export function systemAutomationTemplate(key: string): SystemAutomationTemplate | undefined {
    return SYSTEM_AUTOMATION_TEMPLATES.find((t) => t.key === key);
}
