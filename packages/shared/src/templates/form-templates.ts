import type { FieldType } from '../schemas/field';
import {
    formConfigSchema,
    newFormItemId,
    type FormConditionOp,
    type FormConfig,
    type FormFieldDisplay,
    type FormFileAccept,
    type FormItemWidth,
    type FormRange,
} from '../schemas/form';
import type { PublicTheme } from '../schemas/public-theme';

/**
 * v0.1.359 — Plantillas de formularios COMPLETOS: preguntas con su forma
 * (escala, Sí/No, tarjetas…), condiciones, páginas, puntaje, pantallas
 * finales, textos y diseño, listos para publicar.
 *
 * Como un formulario vive sobre una lista que ya existe, la plantilla no
 * habla de campos sino de ROLES («el correo», «la calificación de 0 a 10»):
 * al usarla se elige qué campo de la lista cumple cada rol, o se CREA el
 * campo con el tipo y las opciones que trae la plantilla. Viven en `shared`
 * porque se arman EN EL CLIENTE (el mismo patrón de las recetas de
 * automatización): `buildFormFromTemplate` es puro y el resultado pasa por el
 * mismo `sanitizeConfig` del servidor al crear el formulario.
 */

export const FORM_TEMPLATE_CATEGORIES = ['contact', 'sales', 'feedback', 'events', 'support', 'people', 'customers', 'education'] as const;
export type FormTemplateCategory = (typeof FORM_TEMPLATE_CATEGORIES)[number];

export const FORM_TEMPLATE_CATEGORY_LABELS: Record<FormTemplateCategory, string> = {
    contact: 'Contacto',
    sales: 'Ventas',
    feedback: 'Opiniones',
    events: 'Eventos',
    support: 'Soporte',
    people: 'Equipo y talento',
    customers: 'Clientes',
    education: 'Educación',
};

export interface FormTemplateOption {
    value: string;
    label: string;
    color?: string;
}

/** Un rol: qué dato pide la plantilla y qué campo lo guarda. */
export interface FormTemplateRole {
    key: string;
    /** Nombre del campo si se crea («Correo»). */
    label: string;
    /** Tipos de campo que sirven para este rol. */
    types: FieldType[];
    /** Cómo se crea el campo si la lista no tiene uno. */
    create: { type: FieldType; config?: Record<string, unknown> };
    /** Se puede dejar sin preguntar (si no hay campo y no se quiere crear). */
    optional?: boolean;
}

/** Una pregunta de la plantilla (`q` = la key de su rol). */
export interface FormTemplateQuestion {
    q: string;
    label?: string;
    help?: string;
    placeholder?: string;
    required?: boolean;
    display?: FormFieldDisplay;
    range?: Partial<FormRange>;
    width?: FormItemWidth;
    accept?: FormFileAccept;
    yes_label?: string;
    no_label?: string;
    /** Mostrar sólo si otra pregunta (por su rol) cumple la condición. */
    show_if?: { q: string; op: FormConditionOp; value?: unknown };
}

export type FormTemplateItem = FormTemplateQuestion | { heading: string } | { text: string } | { page: string };

export interface FormTemplateCalc {
    key: string;
    name: string;
    /** Puntos por opción (valor de la opción que crea la plantilla) o un factor. */
    parts: Array<{ q: string; points?: Record<string, number>; multiplier?: number }>;
    /** Rol numérico donde se guarda el resultado (que el formulario no pregunta). */
    save?: string;
}

export interface FormTemplateEnding {
    name: string;
    title: string;
    message: string;
    when?: { calc: string; op: 'eq' | 'neq' | 'gt' | 'lt'; value: number };
}

export interface FormTemplate {
    id: string;
    name: string;
    description: string;
    category: FormTemplateCategory;
    /** Clave del catálogo de íconos de la app. */
    icon: string;
    color: string;
    roles: FormTemplateRole[];
    items: FormTemplateItem[];
    settings: {
        title: string;
        description?: string;
        submit_label?: string;
        success_title?: string;
        success_message?: string;
        layout?: 'classic' | 'conversational';
        welcome?: { title?: string; message: string; button_label?: string };
        /** Plantilla de diseño (`publicThemePresets`). */
        theme?: string;
        /** El rol del correo de quien responde (copia, confirmación). */
        email_role?: string;
        save_progress?: { device: boolean; email: boolean };
    };
    calcs?: FormTemplateCalc[];
    endings?: FormTemplateEnding[];
}

// ─────────────────────────── Roles comunes ───────────────────────────

const opts = (...pairs: Array<[string, string, string?]>): { options: FormTemplateOption[] } => ({
    options: pairs.map(([value, label, color]) => ({ value, label, ...(color ? { color } : {}) })),
});

const NAME: FormTemplateRole = { key: 'nombre', label: 'Nombre', types: ['text'], create: { type: 'text' } };
const EMAIL: FormTemplateRole = { key: 'correo', label: 'Correo', types: ['email'], create: { type: 'email' } };
const PHONE = (optional = true): FormTemplateRole => ({ key: 'telefono', label: 'Teléfono', types: ['phone', 'text'], create: { type: 'phone' }, optional });
const COMPANY: FormTemplateRole = { key: 'empresa', label: 'Empresa', types: ['text'], create: { type: 'text' }, optional: true };
const MESSAGE = (label = 'Mensaje', optional = false): FormTemplateRole => ({
    key: 'mensaje',
    label,
    types: ['long_text', 'text'],
    create: { type: 'long_text' },
    optional,
});

// ─────────────────────────── Catálogo ───────────────────────────

export const FORM_TEMPLATES: readonly FormTemplate[] = [
    {
        id: 'contact',
        name: 'Contacto',
        description: 'Nombre, correo, teléfono y mensaje. El clásico para la página de contacto de tu sitio.',
        category: 'contact',
        icon: 'mail',
        color: '#0e7490',
        roles: [NAME, EMAIL, PHONE(), MESSAGE()],
        items: [
            { q: 'nombre', label: '¿Cómo te llamas?', required: true, width: 'half' },
            { q: 'correo', label: 'Tu correo', required: true, width: 'half', placeholder: 'tu@correo.com' },
            { q: 'telefono', label: 'Tu teléfono (opcional)' },
            { q: 'mensaje', label: '¿En qué te podemos ayudar?', required: true },
        ],
        settings: {
            title: 'Escríbenos',
            description: 'Te respondemos en menos de un día hábil.',
            submit_label: 'Enviar mensaje',
            success_title: '¡Gracias, {{nombre}}!',
            success_message: 'Recibimos tu mensaje. Te escribimos muy pronto.',
            theme: 'minimal',
            email_role: 'correo',
        },
    },
    {
        id: 'quote',
        name: 'Pide tu cotización',
        description: 'En dos pasos: qué necesita y cómo contactarlo. Pide el NIT sólo si es una empresa.',
        category: 'sales',
        icon: 'receipt',
        color: '#2563eb',
        roles: [
            {
                key: 'servicio',
                label: 'Servicio',
                types: ['select'],
                create: { type: 'select', config: opts(['consultoria', 'Consultoría', 'blue'], ['implementacion', 'Implementación', 'violet'], ['soporte', 'Soporte mensual', 'teal'], ['otro', 'Otro', 'gray']) },
            },
            {
                key: 'tipo_cliente',
                label: 'Tipo de cliente',
                types: ['select'],
                create: { type: 'select', config: opts(['persona', 'Persona', 'sky'], ['empresa', 'Empresa', 'indigo']) },
            },
            { key: 'presupuesto', label: 'Presupuesto', types: ['currency', 'number'], create: { type: 'currency', config: { currency: 'COP', precision: 0 } }, optional: true },
            MESSAGE('Detalle', true),
            NAME,
            COMPANY,
            { key: 'nit', label: 'NIT', types: ['text'], create: { type: 'text' }, optional: true },
            EMAIL,
            PHONE(false),
        ],
        items: [
            { page: '¿Qué necesitas?' },
            { q: 'servicio', label: '¿Qué servicio te interesa?', required: true, display: 'cards' },
            { q: 'presupuesto', label: 'Presupuesto aproximado (opcional)', help: 'Si no lo sabes, déjalo vacío.' },
            { q: 'mensaje', label: 'Cuéntanos un poco más', placeholder: 'Qué quieres lograr, para cuándo…' },
            { page: '¿Cómo te contactamos?' },
            { q: 'tipo_cliente', label: '¿Eres persona o empresa?', required: true, display: 'buttons' },
            { q: 'nombre', label: 'Tu nombre', required: true, width: 'half' },
            { q: 'empresa', label: 'Empresa', width: 'half', show_if: { q: 'tipo_cliente', op: 'eq', value: 'empresa' } },
            { q: 'nit', label: 'NIT', show_if: { q: 'tipo_cliente', op: 'eq', value: 'empresa' } },
            { q: 'correo', label: 'Correo', required: true, width: 'half' },
            { q: 'telefono', label: 'WhatsApp', required: true, width: 'half' },
        ],
        settings: {
            title: 'Pide tu cotización',
            description: 'Toma 2 minutos. Te enviamos la propuesta en menos de 24 horas.',
            submit_label: 'Pedir mi cotización',
            success_title: '¡Listo, {{nombre}}!',
            success_message: 'Recibimos tu solicitud. Te escribimos por WhatsApp hoy mismo.',
            theme: 'corporate',
            email_role: 'correo',
            save_progress: { device: true, email: false },
        },
    },
    {
        id: 'nps',
        name: 'Encuesta de satisfacción (NPS)',
        description: 'Una pregunta por pantalla: del 0 al 10, qué tanto nos recomendaría, y el porqué según la nota.',
        category: 'feedback',
        icon: 'smiley',
        color: '#16a34a',
        roles: [
            { key: 'nps', label: 'Recomendación (NPS)', types: ['number', 'rating'], create: { type: 'number', config: { min: 0, max: 10, precision: 0 } } },
            { key: 'que_gusto', label: 'Lo que más le gustó', types: ['long_text', 'text'], create: { type: 'long_text' }, optional: true },
            { key: 'que_mejorar', label: 'Qué mejorar', types: ['long_text', 'text'], create: { type: 'long_text' }, optional: true },
            { key: 'correo', label: 'Correo', types: ['email'], create: { type: 'email' }, optional: true },
        ],
        items: [
            {
                q: 'nps',
                label: '¿Qué tan probable es que nos recomiendes a un amigo o colega?',
                required: true,
                display: 'scale',
                range: { min: 0, max: 10, step: 1, low_label: 'Nada probable', high_label: 'Muy probable' },
            },
            { q: 'que_gusto', label: '¡Genial! ¿Qué es lo que más te gusta?', show_if: { q: 'nps', op: 'gt', value: 8 } },
            { q: 'que_mejorar', label: '¿Qué podríamos hacer mejor?', show_if: { q: 'nps', op: 'lt', value: 9 } },
            { q: 'correo', label: 'Si quieres que te contactemos, déjanos tu correo (opcional)' },
        ],
        settings: {
            title: 'Tu opinión nos importa',
            submit_label: 'Enviar',
            success_title: '¡Gracias por tu tiempo!',
            success_message: 'Tu respuesta nos ayuda a mejorar.',
            layout: 'conversational',
            welcome: { message: 'Son sólo 3 preguntas y toma menos de un minuto.', button_label: 'Empezar' },
            theme: 'soft',
        },
    },
    {
        id: 'event',
        name: 'Inscripción a un evento',
        description: 'Datos del asistente, cuántas personas lo acompañan y su preferencia de comida.',
        category: 'events',
        icon: 'calendar_star',
        color: '#c026d3',
        roles: [
            NAME,
            EMAIL,
            PHONE(),
            { key: 'acompanantes', label: 'Acompañantes', types: ['number'], create: { type: 'number', config: { min: 0, max: 10, precision: 0 } }, optional: true },
            {
                key: 'comida',
                label: 'Preferencia de comida',
                types: ['select'],
                create: { type: 'select', config: opts(['ninguna', 'Sin restricciones', 'gray'], ['vegetariana', 'Vegetariana', 'green'], ['vegana', 'Vegana', 'lime'], ['sin_gluten', 'Sin gluten', 'amber']) },
                optional: true,
            },
            { key: 'como_supo', label: '¿Cómo se enteró?', types: ['select', 'text'], create: { type: 'select', config: opts(['redes', 'Redes sociales', 'pink'], ['correo', 'Correo', 'blue'], ['amigo', 'Un amigo', 'orange'], ['otro', 'Otro', 'gray']) }, optional: true },
        ],
        items: [
            { q: 'nombre', label: 'Nombre completo', required: true },
            { q: 'correo', label: 'Correo', required: true, width: 'half' },
            { q: 'telefono', label: 'Celular', width: 'half' },
            { q: 'acompanantes', label: '¿Cuántas personas te acompañan?', display: 'scale', range: { min: 0, max: 4, step: 1 } },
            { q: 'comida', label: 'Preferencia de comida', display: 'buttons' },
            { q: 'como_supo', label: '¿Cómo te enteraste del evento?' },
        ],
        settings: {
            title: 'Inscríbete al evento',
            description: 'Cupos limitados. Te enviamos la confirmación al correo.',
            submit_label: 'Inscribirme',
            success_title: '¡Te esperamos, {{nombre}}!',
            success_message: 'Tu inscripción quedó registrada. Revisa tu correo.',
            theme: 'vibrant',
            email_role: 'correo',
        },
    },
    {
        id: 'support',
        name: 'Solicitud de soporte',
        description: 'Tipo de problema, prioridad, descripción y capturas de pantalla.',
        category: 'support',
        icon: 'lifebuoy',
        color: '#ea580c',
        roles: [
            NAME,
            EMAIL,
            {
                key: 'tipo',
                label: 'Tipo de problema',
                types: ['select'],
                create: { type: 'select', config: opts(['acceso', 'No puedo entrar', 'red'], ['error', 'Algo no funciona', 'orange'], ['pregunta', 'Tengo una pregunta', 'blue'], ['factura', 'Facturación', 'violet']) },
            },
            {
                key: 'prioridad',
                label: 'Prioridad',
                types: ['select'],
                create: { type: 'select', config: opts(['baja', 'Baja', 'gray'], ['media', 'Media', 'amber'], ['alta', 'Alta', 'red']) },
                optional: true,
            },
            MESSAGE('Descripción'),
            { key: 'adjuntos', label: 'Adjuntos', types: ['file'], create: { type: 'file' }, optional: true },
        ],
        items: [
            { q: 'nombre', label: 'Tu nombre', required: true, width: 'half' },
            { q: 'correo', label: 'Tu correo', required: true, width: 'half' },
            { q: 'tipo', label: '¿Qué pasa?', required: true, display: 'cards' },
            { q: 'prioridad', label: '¿Qué tan urgente es?', display: 'buttons' },
            { q: 'mensaje', label: 'Cuéntanos el detalle', required: true, placeholder: 'Qué estabas haciendo, qué esperabas y qué pasó.' },
            { q: 'adjuntos', label: 'Capturas de pantalla (opcional)', accept: 'images_pdf' },
        ],
        settings: {
            title: '¿Cómo te ayudamos?',
            submit_label: 'Enviar solicitud',
            success_title: 'Recibimos tu solicitud',
            success_message: 'Te respondemos al correo en el menor tiempo posible.',
            theme: 'classic',
            email_role: 'correo',
        },
    },
    {
        id: 'job',
        name: 'Postulación a un empleo',
        description: 'Datos, cargo, experiencia, hoja de vida y LinkedIn. Se puede guardar y terminar después.',
        category: 'people',
        icon: 'briefcase',
        color: '#7c3aed',
        roles: [
            NAME,
            EMAIL,
            PHONE(false),
            {
                key: 'cargo',
                label: 'Cargo',
                types: ['select', 'text'],
                create: { type: 'select', config: opts(['ventas', 'Ventas', 'blue'], ['operaciones', 'Operaciones', 'teal'], ['administracion', 'Administración', 'violet']) },
            },
            { key: 'experiencia', label: 'Años de experiencia', types: ['number'], create: { type: 'number', config: { min: 0, max: 50, precision: 0 } }, optional: true },
            { key: 'hoja_de_vida', label: 'Hoja de vida', types: ['file'], create: { type: 'file' } },
            { key: 'linkedin', label: 'LinkedIn', types: ['url'], create: { type: 'url' }, optional: true },
            MESSAGE('¿Por qué quieres trabajar con nosotros?', true),
        ],
        items: [
            { page: 'Tus datos' },
            { q: 'nombre', label: 'Nombre completo', required: true },
            { q: 'correo', label: 'Correo', required: true, width: 'half' },
            { q: 'telefono', label: 'Celular', required: true, width: 'half' },
            { page: 'Tu experiencia' },
            { q: 'cargo', label: '¿A qué cargo te postulas?', required: true },
            { q: 'experiencia', label: 'Años de experiencia', display: 'slider', range: { min: 0, max: 20, step: 1 } },
            { q: 'hoja_de_vida', label: 'Hoja de vida', required: true, accept: 'documents' },
            { q: 'linkedin', label: 'Perfil de LinkedIn (opcional)', placeholder: 'https://linkedin.com/in/…' },
            { q: 'mensaje', label: '¿Por qué quieres trabajar con nosotros?' },
        ],
        settings: {
            title: 'Trabaja con nosotros',
            description: 'Cuéntanos de ti. Si quieres, guarda y termina después.',
            submit_label: 'Enviar mi postulación',
            success_title: '¡Gracias por postularte, {{nombre}}!',
            success_message: 'Revisamos cada hoja de vida y te escribimos si tu perfil encaja.',
            theme: 'elegant',
            email_role: 'correo',
            save_progress: { device: true, email: true },
        },
    },
    {
        id: 'customer',
        name: 'Datos del cliente',
        description: 'Para registrar o actualizar los datos de un cliente: documento, contacto, dirección y cumpleaños.',
        category: 'customers',
        icon: 'identification_card',
        color: '#0891b2',
        roles: [
            NAME,
            { key: 'documento', label: 'Documento', types: ['text'], create: { type: 'text' } },
            EMAIL,
            PHONE(false),
            { key: 'direccion', label: 'Dirección', types: ['text'], create: { type: 'text' }, optional: true },
            { key: 'ciudad', label: 'Ciudad', types: ['text', 'select'], create: { type: 'text' }, optional: true },
            { key: 'cumpleanos', label: 'Cumpleaños', types: ['date'], create: { type: 'date' }, optional: true },
            { key: 'autoriza_whatsapp', label: 'Acepta mensajes por WhatsApp', types: ['checkbox'], create: { type: 'checkbox' }, optional: true },
        ],
        items: [
            { q: 'nombre', label: 'Nombre completo', required: true, width: 'two_thirds' },
            { q: 'documento', label: 'Cédula o NIT', required: true, width: 'third' },
            { q: 'correo', label: 'Correo', required: true, width: 'half' },
            { q: 'telefono', label: 'Celular', required: true, width: 'half' },
            { q: 'direccion', label: 'Dirección', width: 'two_thirds' },
            { q: 'ciudad', label: 'Ciudad', width: 'third' },
            { q: 'cumpleanos', label: 'Fecha de cumpleaños', help: 'Para enviarte un detalle ese día.' },
            { q: 'autoriza_whatsapp', label: '¿Te podemos escribir por WhatsApp?', display: 'yes_no' },
        ],
        settings: {
            title: 'Actualiza tus datos',
            description: 'Así te mantenemos al tanto de tus pedidos y novedades.',
            submit_label: 'Guardar mis datos',
            success_title: '¡Gracias, {{nombre}}!',
            success_message: 'Tus datos quedaron al día.',
            theme: 'cards',
            email_role: 'correo',
        },
    },
    {
        id: 'quiz',
        name: 'Test con puntaje',
        description: 'Tres preguntas que suman puntos y un final distinto según el resultado. Para diagnósticos o calificar clientes.',
        category: 'education',
        icon: 'trophy',
        color: '#d97706',
        roles: [
            {
                key: 'frecuencia',
                label: '¿Con qué frecuencia?',
                types: ['select'],
                create: { type: 'select', config: opts(['nunca', 'Nunca', 'gray'], ['a_veces', 'A veces', 'amber'], ['siempre', 'Siempre', 'green']) },
            },
            {
                key: 'equipo',
                label: 'Tamaño del equipo',
                types: ['select'],
                create: { type: 'select', config: opts(['solo', 'Sólo yo', 'gray'], ['pequeno', '2 a 10 personas', 'sky'], ['grande', 'Más de 10', 'indigo']) },
            },
            { key: 'urgente', label: '¿Es urgente?', types: ['checkbox'], create: { type: 'checkbox' } },
            NAME,
            EMAIL,
            { key: 'puntaje', label: 'Puntaje', types: ['number'], create: { type: 'number', config: { precision: 0 } }, optional: true },
        ],
        items: [
            { q: 'frecuencia', label: '¿Con qué frecuencia te pasa este problema?', required: true, display: 'cards' },
            { q: 'equipo', label: '¿Cuántas personas trabajan contigo?', required: true, display: 'buttons' },
            { q: 'urgente', label: '¿Necesitas resolverlo este mes?', required: true, display: 'yes_no' },
            { q: 'nombre', label: '¿Cómo te llamas?', required: true },
            { q: 'correo', label: '¿A qué correo te enviamos el resultado?', required: true },
        ],
        settings: {
            title: 'Descubre tu nivel en 1 minuto',
            submit_label: 'Ver mi resultado',
            layout: 'conversational',
            welcome: { message: 'Responde 5 preguntas rápidas y te decimos qué te conviene.', button_label: 'Empezar el test' },
            theme: 'pills',
            email_role: 'correo',
        },
        calcs: [
            {
                key: 'puntos',
                name: 'Puntaje',
                parts: [
                    { q: 'frecuencia', points: { nunca: 0, a_veces: 2, siempre: 4 } },
                    { q: 'equipo', points: { solo: 1, pequeno: 2, grande: 3 } },
                    { q: 'urgente', points: { true: 3, false: 0 } },
                ],
                save: 'puntaje',
            },
        ],
        endings: [
            {
                name: 'Puntaje alto',
                title: '¡Estás listo, {{nombre}}!',
                message: 'Sacaste {{puntos}} puntos: te conviene empezar ya. Te escribimos hoy mismo.',
                when: { calc: 'puntos', op: 'gt', value: 6 },
            },
            {
                name: 'Puntaje bajo',
                title: 'Gracias, {{nombre}}',
                message: 'Sacaste {{puntos}} puntos. Te enviamos algunos consejos para empezar.',
            },
        ],
    },
    {
        id: 'order',
        name: 'Pedido de un producto',
        description: 'Producto, cantidad, fecha de entrega, dirección y forma de pago.',
        category: 'sales',
        icon: 'shopping_bag',
        color: '#db2777',
        roles: [
            {
                key: 'producto',
                label: 'Producto',
                types: ['select', 'text'],
                create: { type: 'select', config: opts(['basico', 'Plan básico', 'sky'], ['estandar', 'Plan estándar', 'blue'], ['premium', 'Plan premium', 'violet']) },
            },
            { key: 'cantidad', label: 'Cantidad', types: ['number'], create: { type: 'number', config: { min: 1, precision: 0 } } },
            { key: 'entrega', label: 'Fecha de entrega', types: ['date'], create: { type: 'date' }, optional: true },
            NAME,
            PHONE(false),
            { key: 'direccion', label: 'Dirección', types: ['text', 'long_text'], create: { type: 'text' } },
            {
                key: 'pago',
                label: 'Forma de pago',
                types: ['select'],
                create: { type: 'select', config: opts(['transferencia', 'Transferencia', 'blue'], ['efectivo', 'Efectivo contra entrega', 'green'], ['tarjeta', 'Tarjeta', 'violet']) },
                optional: true,
            },
            MESSAGE('Notas', true),
        ],
        items: [
            { page: 'Tu pedido' },
            { q: 'producto', label: '¿Qué quieres pedir?', required: true, display: 'cards' },
            { q: 'cantidad', label: 'Cantidad', required: true, width: 'half' },
            { q: 'entrega', label: '¿Para cuándo lo necesitas?', width: 'half' },
            { page: 'Entrega' },
            { q: 'nombre', label: 'Nombre de quien recibe', required: true },
            { q: 'telefono', label: 'Celular', required: true, width: 'half' },
            { q: 'pago', label: 'Forma de pago', width: 'half' },
            { q: 'direccion', label: 'Dirección de entrega', required: true },
            { q: 'mensaje', label: 'Notas para la entrega (opcional)' },
        ],
        settings: {
            title: 'Haz tu pedido',
            submit_label: 'Hacer mi pedido',
            success_title: '¡Pedido recibido!',
            success_message: 'Te confirmamos por WhatsApp el valor y la entrega.',
            theme: 'natural',
        },
    },
];

export function formTemplateById(id: string): FormTemplate | undefined {
    return FORM_TEMPLATES.find((t) => t.id === id);
}

// ─────────────────────────── Armar el formulario ───────────────────────────

/** Lo mínimo de un campo de la lista para una plantilla. */
export interface FormTemplateField {
    id: number;
    type: string;
    /** El nombre del campo en `{{…}}` (para recordar la respuesta). */
    slug: string;
    config?: Record<string, unknown> | null;
}

/** Rol → campo de la lista (null = no se pregunta). */
export type FormTemplateMapping = Record<string, FormTemplateField | null | undefined>;

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function fieldOptions(field: FormTemplateField): FormTemplateOption[] {
    const raw = (field.config as { options?: unknown } | null | undefined)?.options;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
        (o): o is FormTemplateOption => !!o && typeof (o as FormTemplateOption).value === 'string' && typeof (o as FormTemplateOption).label === 'string',
    );
}

function roleOptions(role: FormTemplateRole): FormTemplateOption[] {
    const raw = (role.create.config as { options?: unknown } | undefined)?.options;
    return Array.isArray(raw) ? (raw as FormTemplateOption[]) : [];
}

/**
 * El valor de una opción de la plantilla en el campo elegido: el mismo valor,
 * o la opción con la misma etiqueta. `undefined` si el campo no la tiene.
 * Las casillas (`true`/`false`) y los números pasan tal cual.
 */
export function mapTemplateOption(role: FormTemplateRole, field: FormTemplateField, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (field.type !== 'select' && field.type !== 'multi_select') return value;
    const options = fieldOptions(field);
    if (options.some((o) => o.value === value)) return value;
    const label = roleOptions(role).find((o) => o.value === value)?.label ?? value;
    const hit = options.find((o) => normalize(o.label) === normalize(label) || normalize(o.value) === normalize(label));
    return hit?.value;
}

/** Los roles que faltan para poder armar el formulario (los no opcionales sin campo). */
export function missingTemplateRoles(tpl: FormTemplate, mapping: FormTemplateMapping): FormTemplateRole[] {
    return tpl.roles.filter((r) => !r.optional && !mapping[r.key]);
}

const NUMERIC_SAVE_TYPES = new Set(['number', 'currency', 'percent']);

/**
 * `{{rol}}` → `{{slug del campo elegido}}` (y lo mismo para un cálculo
 * renombrado), conservando lo que va después de la barra (`{{nombre|amigo}}`).
 * Una respuesta que no se pregunta queda tal cual: el formulario la muestra
 * vacía (o con lo de la barra).
 */
function rewriteRecall(text: string, names: ReadonlyMap<string, string>): string {
    return text.replace(/\{\{\s*([a-z][a-z0-9_]*)(\s*\|[^}]*)?\s*\}\}/g, (all, key: string, rest: string | undefined) => {
        const to = names.get(key);
        return to ? `{{${to}${rest ?? ''}}}` : all;
    });
}

/**
 * Arma la configuración del formulario con los campos elegidos para cada
 * rol. Una pregunta cuyo rol no tiene campo no se incluye (y lo que dependía
 * de ella —su condición, su parte del puntaje— tampoco). `theme` es el diseño
 * ya resuelto (con el color de la marca de la empresa).
 */
export function buildFormFromTemplate(
    tpl: FormTemplate,
    mapping: FormTemplateMapping,
    opts: { theme?: PublicTheme | null; /** Los nombres de TODOS los campos de la lista (un cálculo no puede llamarse igual). */ slugs?: readonly string[] } = {},
): FormConfig {
    const roleByKey = new Map(tpl.roles.map((r) => [r.key, r]));
    const fieldOf = (key: string): FormTemplateField | null => mapping[key] ?? null;
    // Un mismo campo no se pregunta dos veces.
    const used = new Set<number>();
    const items: Array<Record<string, unknown>> = [];
    let pendingBreak: Record<string, unknown> | null = null;

    for (const it of tpl.items) {
        if ('page' in it) {
            // Un salto de página sólo si ya hay algo antes (la primera página no lleva).
            pendingBreak = items.length ? { id: newFormItemId(), type: 'page_break', title: it.page } : null;
            if (!items.length) items.push({ id: newFormItemId(), type: 'heading', text: it.page });
            continue;
        }
        const push = (item: Record<string, unknown>): void => {
            if (pendingBreak) {
                items.push(pendingBreak);
                pendingBreak = null;
            }
            items.push(item);
        };
        if ('heading' in it) {
            push({ id: newFormItemId(), type: 'heading', text: it.heading });
            continue;
        }
        if ('text' in it) {
            push({ id: newFormItemId(), type: 'text', text: it.text });
            continue;
        }
        const role = roleByKey.get(it.q);
        const field = fieldOf(it.q);
        if (!role || !field || used.has(field.id)) continue;
        used.add(field.id);
        let showIf: Record<string, unknown> | null = null;
        if (it.show_if) {
            const otherRole = roleByKey.get(it.show_if.q);
            const other = fieldOf(it.show_if.q);
            if (otherRole && other) {
                const value = mapTemplateOption(otherRole, other, it.show_if.value);
                // Sin la opción en el campo elegido, la condición no tiene sentido: se pregunta siempre.
                if (value !== undefined) showIf = { field_id: other.id, op: it.show_if.op, ...(it.show_if.value !== undefined ? { value } : {}) };
            }
        }
        push({
            id: newFormItemId(),
            type: 'field',
            field_id: field.id,
            label: it.label ?? '',
            help: it.help ?? '',
            placeholder: it.placeholder ?? '',
            required: it.required === true,
            ...(it.display ? { display: it.display } : {}),
            ...(it.range ? { range: it.range } : {}),
            ...(it.width ? { width: it.width } : {}),
            ...(it.accept ? { accept: it.accept } : {}),
            ...(it.yes_label ? { yes_label: it.yes_label } : {}),
            ...(it.no_label ? { no_label: it.no_label } : {}),
            show_if: showIf,
        });
    }

    // Cómo se recuerda cada respuesta: el rol pasa a llamarse como el campo elegido.
    const names = new Map<string, string>();
    for (const r of tpl.roles) {
        const f = fieldOf(r.key);
        if (f && used.has(f.id) && f.slug && f.slug !== r.key) names.set(r.key, f.slug);
    }
    // Un cálculo no puede llamarse como un campo de la lista: se le busca otro nombre.
    const taken = new Set(opts.slugs ?? []);
    for (const f of Object.values(mapping)) if (f?.slug) taken.add(f.slug);
    const calcKey = new Map<string, string>();
    for (const c of tpl.calcs ?? []) {
        let key = c.key;
        for (let n = 2; taken.has(key); n++) key = `${c.key}_${n}`;
        taken.add(key);
        calcKey.set(c.key, key);
        if (key !== c.key) names.set(c.key, key);
    }
    const recall = (t: string): string => rewriteRecall(t, names);

    // Cálculos: sólo las partes con campo; se guarda en un campo numérico que NO se pregunta.
    const calcs = (tpl.calcs ?? []).flatMap((c) => {
        const parts = c.parts.flatMap((p) => {
            const role = roleByKey.get(p.q);
            const field = fieldOf(p.q);
            if (!role || !field || !used.has(field.id)) return [];
            const points: Record<string, number> = {};
            for (const [value, n] of Object.entries(p.points ?? {})) {
                const raw = value === 'true' ? true : value === 'false' ? false : value;
                const mapped = mapTemplateOption(role, field, raw);
                if (mapped !== undefined) points[String(mapped)] = n;
            }
            return [{ field_id: field.id, points, multiplier: p.multiplier ?? null }];
        });
        if (!parts.length) return [];
        const save = c.save ? fieldOf(c.save) : null;
        const saveId = save && NUMERIC_SAVE_TYPES.has(save.type) && !used.has(save.id) ? save.id : null;
        return [{ id: newFormItemId(), key: calcKey.get(c.key) ?? c.key, name: c.name, start: 0, parts, save_field_id: saveId }];
    });
    const calcKeys = new Set(calcs.map((c) => c.key));
    const endings = (tpl.endings ?? []).flatMap((e) => {
        const when = e.when ? { ...e.when, calc: calcKey.get(e.when.calc) ?? e.when.calc } : null;
        if (when && !calcKeys.has(when.calc)) return [];
        return [{ id: newFormItemId(), name: e.name, title: recall(e.title), message: recall(e.message), redirect_url: null, when }];
    });
    for (const it of items) {
        if (it.type === 'heading' || it.type === 'text') it.text = recall(String(it.text ?? ''));
        if (it.type === 'field') {
            it.label = recall(String(it.label ?? ''));
            it.help = recall(String(it.help ?? ''));
        }
    }

    const s = tpl.settings;
    const email = s.email_role ? fieldOf(s.email_role) : null;
    return formConfigSchema.parse({
        items,
        settings: {
            title: recall(s.title),
            description: recall(s.description ?? ''),
            submit_label: s.submit_label ?? 'Enviar',
            success_title: recall(s.success_title ?? '¡Gracias!'),
            success_message: recall(s.success_message ?? 'Recibimos tu respuesta.'),
            layout: s.layout ?? 'classic',
            ...(s.welcome
                ? { welcome: { enabled: true, title: recall(s.welcome.title ?? ''), message: recall(s.welcome.message), button_label: s.welcome.button_label ?? 'Empezar', file_id: null, show_time: true } }
                : {}),
            ...(s.save_progress ? { save_progress: s.save_progress } : {}),
            respondent_email_field_id: email && email.type === 'email' && used.has(email.id) ? email.id : null,
            theme: opts.theme ?? null,
            calcs,
            endings,
        },
    });
}
