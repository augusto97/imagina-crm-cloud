import { createAutomationSchema, remapAutomationSlugs, type CreateAutomationInput, type TemplateRoleField } from '@imagina-base/shared';

import { fieldFitsRole, suggestRoleMapping, type MappableField } from '@/admin/templates/roleMapping';

import type { IdeaAction, IdeaAutomation, IdeaDef, IdeaQuestion } from './types';

/**
 * Activar una idea (v0.1.323, ADR-S76): todo lo que va de "la persona eligió
 * lista, campos y respuestas" a "estas automatizaciones se guardan" es PURO y
 * vive aquí, así se prueba sin navegador y la galería sólo dibuja.
 *
 * Orden (importa):
 *   1. respuestas → se reemplazan los `{ $q }` (estructural) y los `[[q:key]]`
 *      dentro de textos;
 *   2. `$message` → la acción de la app de mensajería de la conexión elegida;
 *   3. roles → campos (`remapAutomationSlugs`); los roles opcionales que la
 *      persona dejó sin campo se borran de los textos para no mandar `{{rol}}`;
 *   4. validación con el MISMO schema que usa el servidor + lo que el servidor
 *      rechazaría al guardar activa (un correo sin destinatario, un webhook sin
 *      dirección).
 *
 * Las respuestas de las preguntas se insertan ANTES de mapear los roles a
 * propósito: una pregunta puede responder con una variable de un rol
 * (`{{responsable.email}}`) y el paso 3 la traduce al campo real.
 */

export interface IdeaContext {
    /** Rol → slug del campo elegido. */
    roleToSlug: Record<string, string>;
    /** Respuestas YA resueltas (ver `resolveAnswers`). */
    answers: Record<string, unknown>;
    /** Conexión elegida → su app (`whatsapp`, `slack`, `mercadopago`…). */
    connectionApps: Record<number, string | null>;
}

export interface BuiltIdea {
    automations: CreateAutomationInput[];
    /** Lo que impide guardar (en lenguaje de la persona). */
    problems: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAnswerRef(v: unknown): v is { $q: string } {
    return isPlainObject(v) && typeof v.$q === 'string' && Object.keys(v).length === 1;
}

const TEXT_REF = /\[\[q:([a-z0-9_]+)\]\]/g;

/** Paso 1: reemplaza las respuestas en cualquier JSON. */
export function fillAnswers(value: unknown, answers: Record<string, unknown>): unknown {
    if (typeof value === 'string') {
        return value.replace(TEXT_REF, (_, key: string) => {
            const a = answers[key];
            return a === undefined || a === null ? '' : String(a);
        });
    }
    if (isAnswerRef(value)) return answers[value.$q] ?? '';
    if (Array.isArray(value)) return value.map((v) => fillAnswers(v, answers));
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = fillAnswers(v, answers);
        return out;
    }
    return value;
}

/**
 * La acción y los nombres de los datos de cada app de mensajería. Cada app
 * llama distinto al destinatario y al texto (`recipient`/`message` en WAS,
 * `chat_id`/`text` en Telegram…), así que la idea escribe un `$message`
 * neutro y se convierte aquí.
 */
export const MESSAGE_APPS: Record<string, { action: string; to: string; text: string; label: string }> = {
    whatsapp: { action: 'send_text', to: 'recipient', text: 'message', label: 'WhatsApp' },
    whatsapp_cloud: { action: 'send_text', to: 'to', text: 'text', label: 'WhatsApp oficial' },
    telegram: { action: 'send_message', to: 'chat_id', text: 'text', label: 'Telegram' },
    slack: { action: 'send_message', to: 'channel', text: 'text', label: 'Slack' },
    // SMS (ADR-S82): la misma acción en los cinco proveedores.
    sms_twilio: { action: 'send_sms', to: 'to', text: 'message', label: 'SMS' },
    sms_bulkgate: { action: 'send_sms', to: 'to', text: 'message', label: 'SMS' },
    sms_infobip: { action: 'send_sms', to: 'to', text: 'message', label: 'SMS' },
    sms_labsmobile: { action: 'send_sms', to: 'to', text: 'message', label: 'SMS' },
    sms_onurix: { action: 'send_sms', to: 'to', text: 'message', label: 'SMS' },
};

/** Paso 2: `$message` → `connector_action` según la app de la conexión. */
export function expandMessages(actions: IdeaAction[], connectionApps: Record<number, string | null>, problems: string[]): IdeaAction[] {
    return actions.map((a) => {
        if (a.type === 'if_else' && isPlainObject(a.config)) {
            const cfg = a.config;
            return {
                ...a,
                config: {
                    ...cfg,
                    then_actions: expandMessages((cfg.then_actions as IdeaAction[] | undefined) ?? [], connectionApps, problems),
                    else_actions: expandMessages((cfg.else_actions as IdeaAction[] | undefined) ?? [], connectionApps, problems),
                },
            };
        }
        if (a.type !== '$message') return a;
        const id = Number(a.config.connection);
        const app = Number.isFinite(id) && id > 0 ? connectionApps[id] ?? null : null;
        const spec = app ? MESSAGE_APPS[app] : undefined;
        if (!spec) {
            problems.push('Elige con qué app se manda el mensaje.');
            return a;
        }
        return {
            type: 'connector_action',
            config: {
                connection_id: id,
                action_key: spec.action,
                values: { [spec.to]: a.config.to ?? '', [spec.text]: a.config.text ?? '' },
            },
            ...(a.condition !== undefined ? { condition: a.condition } : {}),
        };
    });
}

/** Paso 3b: borra de los textos las variables de roles opcionales sin campo. */
export function stripUnmappedRoles(value: unknown, roles: readonly string[]): unknown {
    if (roles.length === 0) return value;
    const re = new RegExp(`\\{\\{\\s*(?:before\\.)?(?:${roles.map((r) => r.replace(/[^a-z0-9_]/gi, '')).join('|')})(?:\\.(?:email|nombre))?(?:\\|[^}]*)?\\s*\\}\\}`, 'g');
    const walk = (v: unknown): unknown => {
        if (typeof v === 'string') return v.replace(re, '').replace(/[ \t]{2,}/g, ' ');
        if (Array.isArray(v)) return v.map(walk);
        if (isPlainObject(v)) {
            const out: Record<string, unknown> = {};
            for (const [k, inner] of Object.entries(v)) out[k] = walk(inner);
            return out;
        }
        return v;
    };
    return walk(value);
}

/** Paso 4b: lo que el servidor no dejaría guardar ACTIVO. */
function checkActions(actions: unknown[], problems: string[]): void {
    for (const raw of actions) {
        if (!isPlainObject(raw)) continue;
        const cfg = isPlainObject(raw.config) ? raw.config : {};
        if (raw.type === 'send_email' && String(cfg.to ?? '').trim() === '') {
            problems.push('Falta a qué correo mandar el aviso.');
        }
        if (raw.type === 'call_webhook' && !/^https?:\/\/\S+$/i.test(String(cfg.url ?? '').trim())) {
            problems.push('Pega la dirección (https://…) a la que se envían los datos.');
        }
        if (raw.type === 'connector_action') {
            if (!(Number(cfg.connection_id) > 0)) problems.push('Elige la conexión que se usa.');
            const values = isPlainObject(cfg.values) ? cfg.values : {};
            for (const [k, v] of Object.entries(values)) {
                if (typeof v === 'string' && v.trim() === '' && REQUIRED_CONNECTOR_VALUES.has(k)) {
                    problems.push(k === 'spreadsheet' ? 'Pega el enlace de la hoja de cálculo.' : 'Completa a quién se le envía el mensaje.');
                }
            }
        }
        if (raw.type === 'update_field' && isPlainObject(cfg.values)) {
            for (const v of Object.values(cfg.values)) {
                if (v === '' || (Array.isArray(v) && v.length === 0)) problems.push('Falta elegir el valor que se pone.');
            }
        }
        if (raw.type === 'if_else') {
            checkActions((cfg.then_actions as unknown[] | undefined) ?? [], problems);
            checkActions((cfg.else_actions as unknown[] | undefined) ?? [], problems);
        }
    }
}

const REQUIRED_CONNECTOR_VALUES = new Set(['recipient', 'to', 'chat_id', 'channel', 'spreadsheet']);

/** Una regla de condición sin valor elegido (`estado es …` vacío). */
function checkConditions(trigger: Record<string, unknown>, problems: string[]): void {
    const filters = trigger.field_filters;
    if (!Array.isArray(filters)) return;
    for (const rule of filters) {
        if (!isPlainObject(rule)) continue;
        const v = rule.value;
        if (rule.op === 'is_null' || rule.op === 'is_not_null') continue;
        if (v === '' || v === undefined || (Array.isArray(v) && v.length === 0)) {
            problems.push('Falta elegir el valor de la condición.');
        }
    }
}

export function buildIdeaAutomations(
    automations: readonly IdeaAutomation[],
    roles: readonly TemplateRoleField[],
    ctx: IdeaContext,
): BuiltIdea {
    const problems: string[] = [];
    const missingRequired = roles.filter((r) => r.required && !ctx.roleToSlug[r.key]);
    for (const r of missingRequired) problems.push(`Elige qué campo es «${r.label}».`);
    const unmapped = roles.filter((r) => !ctx.roleToSlug[r.key]).map((r) => r.key);

    const out: CreateAutomationInput[] = [];
    for (const auto of automations) {
        const filled = fillAnswers({ trigger_config: auto.trigger_config, actions: auto.actions }, ctx.answers) as {
            trigger_config: Record<string, unknown>;
            actions: IdeaAction[];
        };
        const expanded = { trigger_config: filled.trigger_config, actions: expandMessages(filled.actions, ctx.connectionApps, problems) };
        const remapped = remapAutomationSlugs(expanded, ctx.roleToSlug);
        const clean = stripUnmappedRoles(remapped, unmapped) as typeof remapped;
        checkConditions(clean.trigger_config, problems);
        checkActions(clean.actions, problems);
        const input = {
            name: auto.name,
            description: auto.description,
            trigger_type: auto.trigger_type,
            trigger_config: clean.trigger_config,
            actions: clean.actions,
            is_active: true,
        };
        const parsed = createAutomationSchema.safeParse(input);
        if (!parsed.success) {
            problems.push(`«${auto.name}» no quedó bien armada.`);
            continue;
        }
        out.push(parsed.data);
    }
    return { automations: out, problems: [...new Set(problems)] };
}

// ── Respuestas ──────────────────────────────────────────────────────────────

export interface AnswerEnv {
    /** El correo de la persona que activa. */
    myEmail: string;
    /** Opciones del campo elegido para cada rol (para las preguntas `option`). */
    roleOptions: Record<string, Array<{ value: string; label: string }>>;
    /** Roles que ya tienen campo elegido. */
    mappedRoles: ReadonlySet<string>;
    /** Conexiones disponibles, para elegir por defecto la primera de la app. */
    connections: Array<{ id: number; integration_key: string | null; name: string }>;
}

export function fold(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

/** La opción que mejor coincide con alguna de las palabras de `guess`. */
export function guessOption(options: Array<{ value: string; label: string }>, guess: readonly string[]): string | undefined {
    for (const word of guess) {
        const w = fold(word);
        const hit = options.find((o) => fold(o.label).includes(w) || fold(o.value).includes(w));
        if (hit) return hit.value;
    }
    return undefined;
}

/**
 * Lo que se muestra elegido de entrada en cada pregunta (como texto: es lo que
 * guarda el formulario). Con esto el caso común es un solo clic.
 */
export function defaultRawAnswer(q: IdeaQuestion, env: AnswerEnv): string | string[] {
    switch (q.kind) {
        case 'email':
            return q.personRole && env.mappedRoles.has(q.personRole) ? personEmailTag(q.personRole) : env.myEmail;
        case 'option': {
            const opts = env.roleOptions[q.role] ?? [];
            if (q.multiple) {
                const picked: string[] = [];
                for (const w of q.guess) {
                    const v = guessOption(opts, [w]);
                    if (v !== undefined && !picked.includes(v)) picked.push(v);
                }
                return picked;
            }
            return guessOption(opts, q.guess) ?? '';
        }
        case 'days':
            return String(q.default);
        case 'text':
            return q.default;
        case 'url':
            return '';
        case 'connection': {
            const c = env.connections.find((x) => x.integration_key !== null && q.apps.includes(x.integration_key));
            return c ? String(c.id) : '';
        }
        case 'choice':
            return q.default;
    }
}

/** La variable que lee el correo de la persona de un campo Persona. */
export function personEmailTag(role: string): string {
    return `{{${role}.email}}`;
}

/** Texto del formulario → el valor que va dentro de la automatización. */
export function resolveAnswer(q: IdeaQuestion, raw: string | string[] | undefined): unknown {
    const s = Array.isArray(raw) ? raw : (raw ?? '').trim();
    switch (q.kind) {
        case 'days': {
            const n = Math.max(0, Math.round(Number(s) || 0));
            const signed = q.before ? -n : n;
            return q.unit === 'minutes' ? signed * 1440 : signed;
        }
        case 'connection':
            return Number(s) || 0;
        case 'option':
            return q.multiple ? (Array.isArray(raw) ? raw : s === '' ? [] : [s]) : s;
        default:
            return s;
    }
}

export function resolveAnswers(questions: readonly IdeaQuestion[], raw: Record<string, string | string[]>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const q of questions) out[q.key] = resolveAnswer(q, raw[q.key]);
    return out;
}

// ── Sugerir la lista ────────────────────────────────────────────────────────

/** La lista que más se parece a lo que la idea necesita (por nombre). */
export function suggestList<T extends { id: number; name: string; slug: string }>(idea: IdeaDef, lists: readonly T[]): T | undefined {
    const hints = (idea.listHints ?? []).map(fold);
    if (hints.length === 0) return undefined;
    let best: { list: T; score: number } | undefined;
    for (const list of lists) {
        const name = fold(`${list.name} ${list.slug}`);
        const score = hints.reduce((acc, h, i) => (name.includes(h) ? acc + (hints.length - i) : acc), 0);
        if (score > 0 && (!best || score > best.score)) best = { list, score };
    }
    return best?.list;
}

/** Roles de la idea (vacío si no es de automatizaciones). */
export function ideaRoles(idea: IdeaDef): TemplateRoleField[] {
    return idea.plan.kind === 'automations' ? idea.plan.roles : [];
}

// ── Sugerir los campos ──────────────────────────────────────────────────────

const SYNONYMS: Record<string, string[]> = {
    telefono: ['telefono', 'celular', 'movil', 'whatsapp', 'phone', 'tel'],
};

/**
 * La sugerencia rol → campo de las plantillas, más cuidadosa: cuando un rol
 * acepta `text` sólo como RESPALDO (un teléfono guardado como texto), un campo
 * de texto cualquiera no alcanza — tiene que llamarse parecido. Si no, el
 * WhatsApp saldría a la «Ciudad» porque era el primer campo de texto.
 */
export function suggestIdeaMapping(roles: readonly TemplateRoleField[], fields: readonly (MappableField & { is_primary?: boolean })[]): Record<string, number> {
    const out = suggestRoleMapping([...roles], [...fields]);
    // El «título» de un aviso es el campo de título de la lista (el que se ve
    // grande en la ficha), no el primer texto que aparezca.
    const primary = fields.find((f) => f.is_primary);
    const tituloRole = roles.find((r) => r.key === 'titulo');
    if (primary && tituloRole && fieldFitsRole(primary, tituloRole)) {
        for (const [k, v] of Object.entries(out)) if (v === primary.id && k !== 'titulo') delete out[k];
        out.titulo = primary.id;
    }
    for (const role of roles) {
        const id = out[role.key];
        if (id === undefined) continue;
        const primary = role.types[0];
        const f = fields.find((x) => x.id === id);
        if (!f || primary === undefined || primary === 'text' || f.type === primary || f.type !== 'text') continue;
        const words = [...(SYNONYMS[role.key] ?? []), fold(role.key), ...fold(role.label).split(/\s+/).filter((w) => w.length > 3)];
        const named = (x: MappableField): boolean => words.some((w) => fold(`${x.label} ${x.slug}`).includes(w));
        if (named(f)) continue;
        const used = new Set(Object.values(out));
        const better =
            fields.find((x) => !used.has(x.id) && x.type === primary) ?? fields.find((x) => !used.has(x.id) && fieldFitsRole(x, role) && named(x));
        if (better) out[role.key] = better.id;
        else delete out[role.key];
    }
    return out;
}
