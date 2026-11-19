import { z } from 'zod';
import { idSchema } from './common';

/**
 * v0.1.401 — Las acciones del conector completo de Whats (whats.imagina.cloud,
 * API pública v1 de Zender). El catálogo con sus datos vive en
 * `integrations.ts` (la entrada `whatsapp_web`); aquí van las reglas PURAS que
 * comparten el servidor, el editor y el asistente:
 *  - qué permisos de la clave pide cada acción,
 *  - qué datos se eligen de una lista de la cuenta (etiquetas, grupos, flujos…),
 *  - qué deja cada acción para los pasos siguientes (`{{whats.*}}`),
 *  - cómo se leen los datos de varias partes (etiquetas, teléfonos, variables).
 *
 * Todas las acciones sobre un contacto lo buscan por TELÉFONO (el dato
 * `recipient`, el mismo de «Enviar mensaje»: cambiar de una acción a otra en el
 * editor conserva el número). Si el contacto no está en Whats, se crea con el
 * teléfono y el nombre del registro antes de seguir —decisión del usuario—,
 * salvo en las acciones que quitan algo (no tiene sentido crearlo para quitarle
 * una etiqueta que no tiene).
 */

/** Las que mandan un mensaje (pasan por el mismo camino de siempre: columnas y estados). */
export const WHATS_SEND_ACTIONS = ['send_text', 'send_media', 'send_location', 'send_contact'] as const;

/** Las que trabajan sobre el contacto de Whats (lo buscan por teléfono). */
export const WHATS_CONTACT_ACTIONS = [
    'upsert_contact',
    'add_tags',
    'remove_tags',
    'add_to_group',
    'remove_from_group',
    'add_note',
    'record_consent',
    'unsubscribe',
    'trigger_flow',
    'enroll_drip',
    'reply_conversation',
    'conversation_status',
] as const;

export const WHATS_OTHER_ACTIONS = ['resume_flow'] as const;

export type WhatsActionKey =
    | (typeof WHATS_SEND_ACTIONS)[number]
    | (typeof WHATS_CONTACT_ACTIONS)[number]
    | (typeof WHATS_OTHER_ACTIONS)[number];

export const WHATS_ACTION_KEYS: readonly WhatsActionKey[] = [...WHATS_SEND_ACTIONS, ...WHATS_CONTACT_ACTIONS, ...WHATS_OTHER_ACTIONS];

export function isWhatsSendAction(key: string): boolean {
    return (WHATS_SEND_ACTIONS as readonly string[]).includes(key);
}

export function isWhatsAction(key: string): key is WhatsActionKey {
    return (WHATS_ACTION_KEYS as readonly string[]).includes(key);
}

/** Las que no crean el contacto si falta (quitan algo que un contacto nuevo no tendría). */
export const WHATS_NO_CREATE_ACTIONS: readonly WhatsActionKey[] = ['remove_tags', 'remove_from_group', 'unsubscribe', 'reply_conversation', 'conversation_status'];

/**
 * Los permisos de la clave de API que usa cada acción (los nombres son los de
 * Whats). Buscar el contacto pide `contacts.view`; crearlo si falta,
 * `contacts.manage`.
 */
export const WHATS_ACTION_ABILITIES: Record<WhatsActionKey, readonly string[]> = {
    send_text: ['wa.send'],
    send_media: ['wa.send'],
    send_location: ['wa.send'],
    send_contact: ['wa.send'],
    upsert_contact: ['contacts.manage'],
    add_tags: ['contacts.view', 'contacts.manage', 'tags.view', 'tags.manage'],
    remove_tags: ['contacts.view', 'tags.view', 'tags.manage'],
    add_to_group: ['contacts.view', 'contacts.manage', 'groups.view', 'groups.manage'],
    remove_from_group: ['contacts.view', 'groups.view', 'groups.manage'],
    add_note: ['contacts.view', 'contacts.manage'],
    record_consent: ['contacts.view', 'contacts.manage'],
    unsubscribe: ['unsubscribed.manage'],
    trigger_flow: ['contacts.view', 'contacts.manage', 'flows.trigger'],
    resume_flow: ['flows.run'],
    enroll_drip: ['contacts.view', 'contacts.manage', 'flows.trigger'],
    reply_conversation: ['contacts.view', 'messenger.view', 'messenger.send'],
    conversation_status: ['contacts.view', 'messenger.view', 'messenger.send'],
};

/**
 * Los permisos que necesita la clave para conectar (v0.1.389): ver la cuenta y
 * los números, enviar, leer los mensajes y manejar los avisos. Sin `wa.send` no
 * se conecta; sin los otros se conecta con un aviso.
 */
export const WA_WEB_KEY_ABILITIES = ['account.view', 'wa.accounts.view', 'wa.send', 'wa.read', 'webhooks.manage'] as const;

/**
 * Los permisos que suman las acciones de v0.1.401 (los de los mensajes ya se
 * pedían al conectar). Son opcionales: sin ellos sólo esas acciones avisan.
 */
export const WA_WEB_EXTRA_ABILITIES = [
    'contacts.view',
    'contacts.manage',
    'tags.view',
    'tags.manage',
    'groups.view',
    'groups.manage',
    'flows.view',
    'flows.trigger',
    'flows.run',
    'messenger.view',
    'messenger.send',
    'unsubscribed.manage',
] as const;

/** Para qué sirve cada permiso, en palabras (lo que se muestra al faltar). */
export const WA_WEB_ABILITY_LABEL: Record<string, string> = {
    'account.view': 'ver la cuenta',
    'wa.accounts.view': 'ver los números',
    'wa.send': 'enviar mensajes',
    'wa.read': 'leer los mensajes',
    'webhooks.manage': 'avisos',
    'contacts.view': 'ver contactos',
    'contacts.manage': 'crear y editar contactos',
    'tags.view': 'ver etiquetas',
    'tags.manage': 'poner y quitar etiquetas',
    'groups.view': 'ver grupos de contactos',
    'groups.manage': 'agregar y quitar de grupos',
    'flows.view': 'ver flujos y goteos',
    'flows.trigger': 'activar flujos e inscribir en goteos',
    'flows.run': 'reanudar flujos',
    'messenger.view': 'ver conversaciones',
    'messenger.send': 'responder y resolver conversaciones',
    'unsubscribed.manage': 'dar de baja',
};

/**
 * v0.1.403 — Los permisos de la clave agrupados por lo que habilitan, para la
 * ventana de conexión y la página de la conexión. Antes los pasos nombraban
 * sólo los cinco de conectar, y las acciones de contactos, etiquetas, grupos,
 * flujos y la bandeja —y los disparadores que traen sólo el contacto— fallaban
 * después por un permiso que nadie había pedido. Un test exige que cada permiso
 * que usa una acción esté en algún grupo.
 */
export interface WaWebPermissionGroup {
    key: string;
    title: string;
    /** Qué habilita, en palabras. */
    help: string;
    /** Sin ellos no se conecta (o se conecta a medias); el resto, sólo si se usa. */
    required: boolean;
    abilities: readonly string[];
}

export const WA_WEB_PERMISSION_GROUPS: readonly WaWebPermissionGroup[] = [
    {
        key: 'base',
        title: 'Conectar, enviar y recibir',
        help: 'Ver la cuenta y tus números, enviar mensajes y archivos, saber si cada uno se entregó o se leyó y recibir los mensajes que te escriben.',
        required: true,
        abilities: WA_WEB_KEY_ABILITIES,
    },
    {
        key: 'contacts',
        title: 'Contactos',
        help: 'Buscar el contacto por teléfono y crearlo si falta: lo usan casi todas las acciones sobre el contacto («Crear o actualizar contacto», notas, consentimiento, etiquetas, grupos, flujos, goteos). También los disparadores de «Cuando pasa algo en Whats» que traen sólo el contacto.',
        required: false,
        abilities: ['contacts.view', 'contacts.manage'],
    },
    {
        key: 'tags',
        title: 'Etiquetas',
        help: 'Poner y quitar etiquetas, y elegirlas de la lista de tu cuenta.',
        required: false,
        abilities: ['tags.view', 'tags.manage'],
    },
    {
        key: 'groups',
        title: 'Grupos de contactos',
        help: 'Agregar o quitar el contacto de un grupo de tu cuenta (no son grupos de WhatsApp).',
        required: false,
        abilities: ['groups.view', 'groups.manage'],
    },
    {
        key: 'flows',
        title: 'Flujos y goteos',
        help: 'Elegir el flujo o el goteo de la lista (flows.view), activar un flujo e inscribir en un goteo (flows.trigger) y reanudar un flujo que quedó esperando (flows.run).',
        required: false,
        abilities: ['flows.view', 'flows.trigger', 'flows.run'],
    },
    {
        key: 'inbox',
        title: 'Bandeja de conversaciones',
        help: 'Responder una conversación y resolverla o reabrirla.',
        required: false,
        abilities: ['messenger.view', 'messenger.send'],
    },
    {
        key: 'unsubscribe',
        title: 'Bajas',
        help: 'Dar de baja a un contacto para que no reciba más mensajes.',
        required: false,
        abilities: ['unsubscribed.manage'],
    },
];

/** Qué grupos opcionales le faltan a la clave (con algún permiso pendiente). Una clave con `*` tiene todo. */
export function missingWaWebPermissionGroups(abilities: readonly string[]): WaWebPermissionGroup[] {
    if (abilities.includes('*')) return [];
    return WA_WEB_PERMISSION_GROUPS.filter((g) => !g.required && g.abilities.some((a) => !abilities.includes(a)));
}

/** Los permisos que le faltan a la clave para una acción (vacío = tiene todo). */
export function missingWhatsAbilities(actionKey: string, abilities: readonly string[]): string[] {
    if (!isWhatsAction(actionKey)) return [];
    // Una clave con `*` (todos los permisos) o sin la lista no se juzga.
    if (abilities.includes('*')) return [];
    return WHATS_ACTION_ABILITIES[actionKey].filter((a) => !abilities.includes(a));
}

/** Qué se elige de una lista de la cuenta de Whats. */
export const WHATS_LOOKUP_KINDS = ['tags', 'groups', 'flows', 'drips', 'contact_fields'] as const;
export type WhatsLookupKind = (typeof WHATS_LOOKUP_KINDS)[number];

export const WHATS_LOOKUP_ABILITY: Record<WhatsLookupKind, string> = {
    tags: 'tags.view',
    groups: 'groups.view',
    flows: 'flows.view',
    drips: 'flows.view',
    contact_fields: 'contacts.view',
};

/** El dato (por su clave) → de qué lista se elige. Las mismas claves en todas las acciones. */
export const WHATS_PARAM_LOOKUP: Record<string, WhatsLookupKind> = {
    tags: 'tags',
    group: 'groups',
    flow: 'flows',
    drip: 'drips',
};

/** Una opción de una lista de la cuenta (lo que devuelve el servidor). */
export interface WhatsLookupItem {
    /** El valor que se guarda: el NOMBRE para etiquetas y grupos (admite variables), el id para flujos y goteos. */
    value: string;
    label: string;
    /** Algo útil al lado: «Activo», «Borrador», el tipo de un campo. */
    hint: string | null;
}

export interface WhatsLookupResult {
    items: WhatsLookupItem[];
    /** Hay más de las que se trajeron (cientos de etiquetas): se escriben a mano. */
    truncated: boolean;
    /** Por qué no se pudo traer la lista (permiso, plan, clave). Null = salió bien. */
    error: string | null;
}

export interface WhatsAbilitiesResult {
    abilities: string[];
    /** Permisos que faltan por acción (sólo las que tienen alguno pendiente). */
    missing: Record<string, string[]>;
    error: string | null;
}

/** Lo que deja cada acción para los pasos siguientes. */
export const WHATS_ACTION_OUTPUTS: Record<WhatsActionKey, readonly string[]> = {
    send_text: ['mensaje_id', 'contacto_id'],
    send_media: ['mensaje_id', 'contacto_id'],
    send_location: ['mensaje_id', 'contacto_id'],
    send_contact: ['mensaje_id', 'contacto_id'],
    upsert_contact: ['contacto_id', 'contacto_nuevo'],
    add_tags: ['contacto_id'],
    remove_tags: ['contacto_id'],
    add_to_group: ['contacto_id'],
    remove_from_group: ['contacto_id'],
    add_note: ['contacto_id'],
    record_consent: ['contacto_id'],
    unsubscribe: [],
    trigger_flow: ['contacto_id', 'ejecucion_id'],
    resume_flow: ['ejecucion_id'],
    enroll_drip: ['contacto_id', 'inscrito'],
    reply_conversation: ['conversacion_id', 'mensaje_id'],
    conversation_status: ['conversacion_id'],
};

/** Las variables `{{whats.*}}` (para el selector de variables del editor). */
export const WHATS_ACTION_MERGE_TAGS: Array<{ tag: string; label: string }> = [
    { tag: 'whats.contacto_id', label: 'Id del contacto en Whats' },
    { tag: 'whats.contacto_nuevo', label: '¿Se creó el contacto? (Sí / No)' },
    { tag: 'whats.mensaje_id', label: 'Id del mensaje enviado' },
    { tag: 'whats.ejecucion_id', label: 'Id de la ejecución del flujo' },
    { tag: 'whats.inscrito', label: '¿Quedó inscrito en el goteo? (Sí / No)' },
    { tag: 'whats.conversacion_id', label: 'Id de la conversación' },
];

// ── Lectura de los datos ──────────────────────────────────────────────

/** Un nombre para comparar: sin mayúsculas, sin tildes y sin espacios de más. */
export function whatsNameKey(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** «VIP, Cliente nuevo; vip» → ['VIP', 'Cliente nuevo'] (sin repetidos, hasta 50). */
export function whatsNames(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(/[,;\n]/)) {
        const name = part.replace(/\s+/g, ' ').trim();
        if (name === '') continue;
        const key = whatsNameKey(name);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name.slice(0, 100));
        if (out.length >= 50) break;
    }
    return out;
}

/** Los teléfonos de una tarjeta de contacto: uno por línea (o separados por coma), hasta 10. */
export function whatsPhoneList(raw: string): string[] {
    return raw
        .split(/[\n,;]/)
        .map((p) => p.trim())
        .filter((p) => p !== '')
        .slice(0, 10);
}

/**
 * Filas «clave → valor» (variables de un flujo, campos personalizados de un
 * contacto). Se guardan como un objeto JSON en texto; también se aceptan
 * renglones `clave=valor` (lo que escribe el asistente o alguien a mano).
 */
export function readWhatsKeyValues(raw: unknown): Record<string, string> {
    let obj: unknown = raw;
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (t === '') return {};
        if (t.startsWith('{')) {
            try {
                obj = JSON.parse(t);
            } catch {
                obj = null;
            }
        } else {
            const out: Record<string, string> = {};
            for (const line of t.split('\n')) {
                const i = line.indexOf('=');
                if (i <= 0) continue;
                const k = line.slice(0, i).trim();
                if (k !== '') out[k] = line.slice(i + 1).trim();
            }
            return out;
        }
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const key = k.trim();
        if (key === '') continue;
        out[key] = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
    }
    return out;
}

/** Lo contrario: las filas se guardan como objeto JSON (vacías fuera). */
export function writeWhatsKeyValues(rows: Array<{ key: string; value: string }>): string {
    const obj: Record<string, string> = {};
    for (const r of rows) {
        const k = r.key.trim();
        if (k !== '') obj[k] = r.value;
    }
    return Object.keys(obj).length > 0 ? JSON.stringify(obj) : '';
}

/** «Sí» para los datos sí/no (con el valor por defecto si viene vacío). */
export function whatsFlag(raw: unknown, fallback: boolean): boolean {
    const s = String(raw ?? '')
        .trim()
        .toLowerCase();
    if (s === '') return fallback;
    return ['true', '1', 'si', 'sí', 'yes', 'on'].includes(s);
}

// ── «Probar ahora» de las acciones que no mandan un mensaje ────────────


export const whatsActionTestSchema = z.object({
    connection_id: idSchema,
    action_key: z.string().trim().min(1).max(60),
    /** Los `values` de la acción tal cual se están editando (con variables). */
    values: z.record(z.string(), z.unknown()).prefault({}),
    /** Registro para resolver las variables (default: el último de la lista que se alcanza). */
    record_id: z.number().int().positive().optional(),
    /** Ejecutarla de verdad (sobre el contacto del registro de muestra). Sin esto sólo se muestra. */
    execute: z.boolean().default(false),
});
export type WhatsActionTestInput = z.infer<typeof whatsActionTestSchema>;

/** Un paso de lo que haría (o hizo) la acción: lo que se mandaría a Whats, sin la clave. */
export interface WhatsActionStep {
    label: string;
    method: string;
    url: string;
    body: string | null;
    /** Al ejecutar: la respuesta (código HTTP); null = no se ejecutó. */
    status: number | null;
}

export interface WhatsActionTestResult {
    ok: boolean;
    executed: boolean;
    /** Lo que hizo o haría, en palabras. */
    summary: string;
    steps: WhatsActionStep[];
    /** Lo que dejaría para los pasos siguientes (`{{whats.*}}`). */
    outputs: Record<string, string>;
    error: string | null;
    sample_record_id: number | null;
}
