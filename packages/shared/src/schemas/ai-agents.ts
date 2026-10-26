import { z } from 'zod';
import { idSchema } from './common';
import { zonedInstant, zonedToday } from './timezone';

/**
 * E6 — Agentes de IA (ADR-S67).
 *
 * Un agente es un «compañero» con un nombre y una tarea en lenguaje natural
 * («Clasifica los tickets nuevos por tema y urgencia…») que trabaja sobre los
 * registros de las listas que se le asignan, con una lista CURADA de
 * herramientas. Corre con el acceso de quien lo creó (su dueño), intersectado
 * con sus listas y sus herramientas: nunca puede más que su dueño.
 *
 * Cuándo trabaja: con los disparadores de las automatizaciones. La acción
 * `ask_agent` («Pedirle a un agente») sirve en cualquier automatización, con
 * cualquier disparador presente o futuro; el editor del agente crea y mantiene
 * esas automatizaciones por debajo («Cuándo trabaja»).
 *
 * Modo de cambios: «Propone y una persona aprueba» (por defecto) deja los
 * cambios como una PROPUESTA en el registro; «Hace los cambios» los aplica en
 * el acto, por los mismos caminos (validadores, ACL, reglas de la tienda) que
 * una persona.
 */

// ─────────────────────────── Herramientas ───────────────────────────

export const AI_AGENT_TOOLS = [
    'read_record',
    'search_records',
    'update_fields',
    'create_records',
    'comment',
    'assign',
    'request_approval',
    'send_email',
] as const;
export const aiAgentToolSchema = z.enum(AI_AGENT_TOOLS);
export type AiAgentTool = z.infer<typeof aiAgentToolSchema>;

/** Las que ESCRIBEN algo (en modo «propone» quedan como propuesta). */
export const AI_AGENT_WRITE_TOOLS: readonly AiAgentTool[] = [
    'update_fields',
    'create_records',
    'comment',
    'assign',
    'request_approval',
    'send_email',
];

export interface AiAgentToolMeta {
    label: string;
    help: string;
    /** Escribe algo (en modo «propone» queda como propuesta). */
    writes: boolean;
    /** Conviene pensarlo dos veces antes de encenderla (sale de la app). */
    risky?: boolean;
}

export const AI_AGENT_TOOL_META: Record<AiAgentTool, AiAgentToolMeta> = {
    read_record: {
        label: 'Leer el registro',
        help: 'Lee el registro completo, sus vinculados, sus comentarios y su historial.',
        writes: false,
    },
    search_records: {
        label: 'Buscar registros',
        help: 'Busca registros en las listas donde trabaja (con lo que su dueño puede ver).',
        writes: false,
    },
    update_fields: {
        label: 'Cambiar campos',
        help: 'Cambia campos del registro con los mismos validadores que una persona.',
        writes: true,
    },
    create_records: {
        label: 'Crear registros',
        help: 'Crea registros nuevos en las listas donde trabaja (hasta 5 por paso).',
        writes: true,
    },
    comment: {
        label: 'Comentar',
        help: 'Deja una nota interna en el registro (o visible para el cliente, si lo permites).',
        writes: true,
    },
    assign: {
        label: 'Asignar',
        help: 'Asigna el registro a una persona o a un equipo.',
        writes: true,
    },
    request_approval: {
        label: 'Pedir una aprobación',
        help: 'Pide una aprobación con uno de los flujos de la lista.',
        writes: true,
    },
    send_email: {
        label: 'Mandar un correo',
        help: 'Manda un correo al contacto del registro o a alguien del equipo. Sale de la app: enciéndela sólo si hace falta.',
        writes: true,
        risky: true,
    },
};

/** Lo que trae un agente nuevo: lee, busca, cambia campos y comenta. */
export const DEFAULT_AI_AGENT_TOOLS: readonly AiAgentTool[] = ['read_record', 'search_records', 'update_fields', 'comment'];

// ─────────────────────────── Modo y topes ───────────────────────────

export const AI_AGENT_MODES = ['propose', 'act'] as const;
export const aiAgentModeSchema = z.enum(AI_AGENT_MODES);
export type AiAgentMode = z.infer<typeof aiAgentModeSchema>;

export const AI_AGENT_MODE_LABELS: Record<AiAgentMode, string> = {
    propose: 'Propone y una persona aprueba',
    act: 'Hace los cambios',
};

/** Tope duro de pasos por corrida (vueltas en las que el agente usa herramientas). */
export const AI_AGENT_MAX_STEPS = 20;
export const AI_AGENT_DEFAULTS = {
    max_steps: 8,
    max_runs_per_day: 200,
    monthly_token_budget: 2_000_000,
} as const;
/** Escrituras por corrida (llamadas a herramientas que escriben) y altas por corrida. */
export const AI_AGENT_MAX_WRITES_PER_RUN = 20;
export const AI_AGENT_MAX_CREATES_PER_RUN = 10;
/** Listas por agente. */
export const AI_AGENT_MAX_LISTS = 20;
/** Largo de la instrucción extra de una automatización (`ask_agent`). */
export const AI_AGENT_MAX_EXTRA_INSTRUCTION = 1000;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex (#RRGGBB)');

export const aiAgentSettingsSchema = z.object({
    /** El agente puede escribir comentarios visibles para el cliente (portal). */
    client_comments: z.boolean().default(false),
    /** Quiénes revisan sus propuestas en «Mi trabajo» (vacío = su dueño). */
    reviewer_user_ids: z.array(idSchema).max(20).default([]),
});
export type AiAgentSettings = z.infer<typeof aiAgentSettingsSchema>;

/** Lee los ajustes guardados tolerando basura (nunca lanza). */
export function readAiAgentSettings(raw: unknown): AiAgentSettings {
    const parsed = aiAgentSettingsSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : aiAgentSettingsSchema.parse({});
}

const agentNameSchema = z.string().trim().min(1, 'El agente necesita un nombre').max(80);

export const createAiAgentSchema = z.object({
    name: agentNameSchema,
    description: z.string().trim().max(500).default(''),
    color: hexColor.nullable().optional(),
    icon: z.string().max(40).nullable().optional(),
    instructions: z.string().trim().min(1, 'Escribe qué hace el agente').max(6000),
    list_ids: z.array(idSchema).min(1, 'Elige al menos una lista').max(AI_AGENT_MAX_LISTS),
    tools: z.array(aiAgentToolSchema).min(1, 'Elige al menos una herramienta').max(AI_AGENT_TOOLS.length),
    mode: aiAgentModeSchema.default('propose'),
    settings: aiAgentSettingsSchema.default({}),
    max_steps: z.number().int().min(1).max(AI_AGENT_MAX_STEPS).default(AI_AGENT_DEFAULTS.max_steps),
    max_runs_per_day: z.number().int().min(1).max(10_000).default(AI_AGENT_DEFAULTS.max_runs_per_day),
    /** Tokens por mes (entrada + salida). null = sin tope propio (manda la cuota del plan). */
    monthly_token_budget: z.number().int().min(1_000).max(1_000_000_000).nullable().default(AI_AGENT_DEFAULTS.monthly_token_budget),
    is_active: z.boolean().default(true),
    /** La plantilla de la que salió (sólo para la nota de la versión). */
    template_key: z.string().max(40).optional(),
});
export type CreateAiAgentInput = z.infer<typeof createAiAgentSchema>;

export const updateAiAgentSchema = z
    .object({
        name: agentNameSchema,
        description: z.string().trim().max(500),
        color: hexColor.nullable(),
        icon: z.string().max(40).nullable(),
        instructions: z.string().trim().min(1, 'Escribe qué hace el agente').max(6000),
        list_ids: z.array(idSchema).min(1, 'Elige al menos una lista').max(AI_AGENT_MAX_LISTS),
        tools: z.array(aiAgentToolSchema).min(1, 'Elige al menos una herramienta').max(AI_AGENT_TOOLS.length),
        mode: aiAgentModeSchema,
        settings: aiAgentSettingsSchema,
        max_steps: z.number().int().min(1).max(AI_AGENT_MAX_STEPS),
        max_runs_per_day: z.number().int().min(1).max(10_000),
        monthly_token_budget: z.number().int().min(1_000).max(1_000_000_000).nullable(),
        is_active: z.boolean(),
        /** Restaura una versión anterior (sólo para la nota del historial). */
        restored_from: idSchema,
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El cambio no puede estar vacío' });
export type UpdateAiAgentInput = z.infer<typeof updateAiAgentSchema>;

// ─────────────────────────── Lo que ve la interfaz ───────────────────────────

export interface AiAgentListRef {
    id: number;
    slug: string;
    name: string;
    icon: string | null;
    color: string | null;
}

/** Una automatización que le pide trabajo al agente («Cuándo trabaja»). */
export interface AiAgentTriggerDto {
    automation_id: number;
    automation_name: string;
    list_id: number;
    list_slug: string;
    list_name: string;
    trigger_type: string;
    is_active: boolean;
    /** La automatización SÓLO le pide trabajo al agente (la mantiene el editor del agente). */
    managed: boolean;
    /** Instrucción extra de esa automatización (si tiene). */
    instruction: string;
    /** Cambios que la disparan (`changed_fields`, por slug), si tiene. */
    changed_fields: string[];
}

export interface AiAgentDto {
    id: number;
    name: string;
    description: string;
    color: string | null;
    icon: string | null;
    instructions: string;
    list_ids: number[];
    /** Las listas vivas (las que están en la papelera no aparecen). */
    lists: AiAgentListRef[];
    tools: AiAgentTool[];
    mode: AiAgentMode;
    settings: AiAgentSettings;
    max_steps: number;
    max_runs_per_day: number;
    monthly_token_budget: number | null;
    /** El agente corre con el acceso de esta persona. */
    owner: { id: number; name: string } | null;
    is_active: boolean;
    /** Por qué se pausó solo (dueño sin acceso, etc.). */
    paused_reason: string | null;
    usage: { runs_today: number; tokens_month: number };
    triggers: AiAgentTriggerDto[];
    last_run: { id: number; status: AiAgentRunStatus; at: string; error: string | null } | null;
    pending_proposals: number;
    created_at: string;
    updated_at: string;
}

// ─────────────────────────── Corridas ───────────────────────────

export const AI_AGENT_RUN_STATUSES = ['queued', 'running', 'success', 'failed', 'skipped', 'stopped'] as const;
export const aiAgentRunStatusSchema = z.enum(AI_AGENT_RUN_STATUSES);
export type AiAgentRunStatus = z.infer<typeof aiAgentRunStatusSchema>;

export const AI_AGENT_RUN_STATUS_LABELS: Record<AiAgentRunStatus, string> = {
    queued: 'En cola',
    running: 'Trabajando',
    success: 'Terminó',
    failed: 'Falló',
    skipped: 'No arrancó',
    stopped: 'Cortada por un tope',
};

/**
 * Un paso de una corrida: qué herramienta usó, con qué (resumido) y qué
 * resultó. `kind`: leyó, escribió, dejó en la propuesta, lo simuló («Probar»)
 * o se le negó (herramienta no permitida, campo oculto, lista fuera de su
 * alcance…).
 */
export const AI_AGENT_STEP_KINDS = ['read', 'write', 'proposed', 'simulated', 'blocked', 'error'] as const;
export type AiAgentStepKind = (typeof AI_AGENT_STEP_KINDS)[number];

export interface AiAgentRunStep {
    n: number;
    tool: string;
    label: string;
    input: string;
    ok: boolean;
    kind: AiAgentStepKind;
    result: string;
}

export interface AiAgentRunDto {
    id: number;
    agent_id: number;
    list_id: number | null;
    list_slug: string | null;
    list_name: string | null;
    record_id: number | null;
    record_title: string | null;
    automation_id: number | null;
    automation_name: string | null;
    /** «Automatización «Clasificar» · Cuando se crea un registro», «Probar». */
    trigger_label: string;
    status: AiAgentRunStatus;
    /** «Probar»: no escribió nada. */
    simulated: boolean;
    mode: AiAgentMode;
    instruction: string;
    steps: AiAgentRunStep[];
    /** Lo que respondió el agente al terminar. */
    summary: string;
    input_tokens: number;
    output_tokens: number;
    error: string | null;
    proposal_id: number | null;
    created_by_name: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
}

export const testAiAgentSchema = z.object({
    list_id: idSchema,
    record_id: idSchema.optional(),
    /** Instrucción extra (como la de una automatización). */
    instruction: z.string().trim().max(AI_AGENT_MAX_EXTRA_INSTRUCTION).default(''),
});
export type TestAiAgentInput = z.infer<typeof testAiAgentSchema>;

// ─────────────────────────── «Cuándo trabaja» ───────────────────────────

/**
 * Disparadores que el editor del agente arma solo. Cualquier otro (los de hoy
 * y los que vengan) se elige en el editor de automatizaciones con la acción
 * «Pedirle a un agente».
 */
export const AI_AGENT_QUICK_TRIGGERS = ['record_created', 'record_updated', 'form_submitted', 'checklist_completed'] as const;
export type AiAgentQuickTrigger = (typeof AI_AGENT_QUICK_TRIGGERS)[number];

export const AI_AGENT_QUICK_TRIGGER_LABELS: Record<AiAgentQuickTrigger, string> = {
    record_created: 'Cuando se crea un registro',
    record_updated: 'Cuando cambia un registro',
    form_submitted: 'Cuando se envía un formulario',
    checklist_completed: 'Cuando se completa un checklist',
};

export const createAiAgentTriggerSchema = z.object({
    list_id: idSchema,
    trigger_type: z.enum(AI_AGENT_QUICK_TRIGGERS),
    /** «Cuando cambia un registro»: sólo si cambia alguno de estos campos (slugs). */
    changed_fields: z.array(z.string().min(1).max(63)).max(20).default([]),
    instruction: z.string().trim().max(AI_AGENT_MAX_EXTRA_INSTRUCTION).default(''),
});
export type CreateAiAgentTriggerInput = z.infer<typeof createAiAgentTriggerSchema>;

export const updateAiAgentTriggerSchema = z
    .object({
        is_active: z.boolean(),
        instruction: z.string().trim().max(AI_AGENT_MAX_EXTRA_INSTRUCTION),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El cambio no puede estar vacío' });
export type UpdateAiAgentTriggerInput = z.infer<typeof updateAiAgentTriggerSchema>;

// ─────────────────────────── Propuestas ───────────────────────────

export const AI_AGENT_PROPOSAL_STATUSES = ['pending', 'applied', 'discarded', 'failed'] as const;
export type AiAgentProposalStatus = (typeof AI_AGENT_PROPOSAL_STATUSES)[number];

/**
 * Un cambio de una propuesta, como lo ve la persona: «Prioridad: Media → Alta»,
 * «Nota interna: …», «Nuevo registro en Tareas: …». El payload que se aplica
 * (ids, valores ya validados) queda en el servidor.
 */
export interface AiAgentProposalItem {
    kind: 'update_fields' | 'create_record' | 'comment' | 'request_approval' | 'send_email';
    title: string;
    lines: Array<{ label: string; from: string | null; to: string }>;
    /** Resultado al aplicar (si ya se aplicó). */
    outcome?: { ok: boolean; message: string } | null;
}

export interface AiAgentProposalDto {
    id: number;
    agent: { id: number; name: string; color: string | null; icon: string | null } | null;
    run_id: number | null;
    list_id: number;
    list_slug: string | null;
    list_name: string | null;
    record_id: number;
    record_title: string | null;
    status: AiAgentProposalStatus;
    summary: string;
    items: AiAgentProposalItem[];
    decided_by_name: string | null;
    decided_at: string | null;
    created_at: string;
}

export interface MyAgentProposalsDto {
    pending: AiAgentProposalDto[];
}

/** Resultado de aplicar una propuesta. */
export interface AiAgentApplyResult {
    proposal: AiAgentProposalDto;
    applied: number;
    failed: number;
    warnings: string[];
}

// ─────────────────────────── Versiones ───────────────────────────

export const AI_AGENT_VERSIONS_KEPT = 30;

export interface AiAgentVersionDto {
    id: number;
    agent_id: number;
    snapshot: {
        name: string;
        description: string;
        color: string | null;
        icon: string | null;
        instructions: string;
        list_ids: number[];
        tools: AiAgentTool[];
        mode: AiAgentMode;
        settings: AiAgentSettings;
        max_steps: number;
        max_runs_per_day: number;
        monthly_token_budget: number | null;
        is_active: boolean;
    };
    author: { id: number; name: string } | null;
    note: string | null;
    created_at: string;
}

// ─────────────────────────── Actividad ───────────────────────────

/**
 * `activity.action = 'ai_agent'`: lo que hizo un agente que no es un cambio de
 * campos (esos van como `record_updated` con `agent` en la entrada). El diff
 * guarda `{ agent: { event, agent_id, agent_name, … } }`.
 */
export const AI_AGENT_ACTIVITY_EVENTS = ['note', 'proposed', 'applied', 'discarded', 'approval', 'email'] as const;
export type AiAgentActivityEvent = (typeof AI_AGENT_ACTIVITY_EVENTS)[number];

export interface AiAgentActivityDiff {
    event: AiAgentActivityEvent;
    agent_id: number;
    agent_name: string;
    proposal_id?: number;
    summary?: string;
    count?: number;
    visibility?: 'internal' | 'client';
    excerpt?: string;
}

/** Lee el diff de una entrada `ai_agent` (null si no lo es o está roto). */
export function readAgentActivity(diff: unknown): AiAgentActivityDiff | null {
    const raw = (diff as { agent?: unknown } | null)?.agent;
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, unknown>;
    if (!(AI_AGENT_ACTIVITY_EVENTS as readonly unknown[]).includes(a.event)) return null;
    if (typeof a.agent_name !== 'string') return null;
    return {
        event: a.event as AiAgentActivityEvent,
        agent_id: Number(a.agent_id) || 0,
        agent_name: a.agent_name,
        ...(typeof a.proposal_id === 'number' ? { proposal_id: a.proposal_id } : {}),
        ...(typeof a.summary === 'string' ? { summary: a.summary } : {}),
        ...(typeof a.count === 'number' ? { count: a.count } : {}),
        ...(a.visibility === 'client' || a.visibility === 'internal' ? { visibility: a.visibility } : {}),
        ...(typeof a.excerpt === 'string' ? { excerpt: a.excerpt } : {}),
    };
}

// ─────────────────────────── Acción de automatización ───────────────────────────

/** La config de la acción «Pedirle a un agente» (`ask_agent`). */
export interface AskAgentConfig {
    agent_id: number | null;
    instruction: string;
}

export function readAskAgentConfig(cfg: unknown): AskAgentConfig {
    const c = (cfg ?? {}) as Record<string, unknown>;
    const id = Number(c.agent_id);
    return {
        agent_id: Number.isInteger(id) && id > 0 ? id : null,
        instruction: typeof c.instruction === 'string' ? c.instruction.slice(0, AI_AGENT_MAX_EXTRA_INSTRUCTION) : '',
    };
}

/** ¿La automatización SÓLO le pide trabajo a este agente? (la mantiene su editor). */
export function isManagedAgentAutomation(actions: unknown, agentId: number): boolean {
    if (!Array.isArray(actions) || actions.length !== 1) return false;
    const a = actions[0] as { type?: unknown; config?: unknown; condition?: unknown } | null;
    if (!a || a.type !== 'ask_agent') return false;
    if (Array.isArray(a.condition) && a.condition.length > 0) return false;
    return readAskAgentConfig(a.config).agent_id === agentId;
}

/** Los agentes que nombra una lista de acciones (recorre si/sino y bucles). */
export function agentIdsInActions(actions: unknown, depth = 0): number[] {
    if (!Array.isArray(actions) || depth > 6) return [];
    const out: number[] = [];
    for (const a of actions) {
        if (!a || typeof a !== 'object') continue;
        const spec = a as { type?: unknown; config?: unknown };
        const cfg = (spec.config && typeof spec.config === 'object' ? spec.config : {}) as Record<string, unknown>;
        if (spec.type === 'ask_agent') {
            const id = readAskAgentConfig(cfg).agent_id;
            if (id !== null) out.push(id);
        }
        out.push(...agentIdsInActions(cfg.then_actions, depth + 1));
        out.push(...agentIdsInActions(cfg.else_actions, depth + 1));
        out.push(...agentIdsInActions(cfg.actions, depth + 1));
    }
    return [...new Set(out)];
}

// ─────────────────────────── Plantillas ───────────────────────────

export interface AiAgentTemplate {
    key: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    instructions: string;
    tools: AiAgentTool[];
    mode: AiAgentMode;
    /** Cuándo conviene que trabaje (lo propone el editor al crearlo). */
    trigger: AiAgentQuickTrigger;
    /** Pista para elegir los campos que disparan «Cuando cambia un registro». */
    trigger_hint: string;
}

export const AI_AGENT_TEMPLATES: readonly AiAgentTemplate[] = [
    {
        key: 'classify_tickets',
        name: 'Clasificador de tickets',
        description: 'Clasifica cada ticket nuevo por tema y urgencia, le pone prioridad y explica por qué en una nota interna.',
        icon: 'tag',
        color: '#2563eb',
        instructions: [
            'Clasifica cada registro nuevo:',
            '1. Lee el registro (asunto, descripción y comentarios).',
            '2. Elige el TEMA entre las opciones del campo de tema o categoría y la PRIORIDAD entre las opciones del campo de prioridad (Alta si hay algo caído, un cliente molesto o una fecha encima; Baja si es una consulta general).',
            '3. Completa esos dos campos. No cambies ningún otro.',
            '4. Deja una nota interna de una línea con el motivo («Prioridad alta: el cliente no puede facturar»).',
        ].join('\n'),
        tools: ['read_record', 'update_fields', 'comment'],
        mode: 'propose',
        trigger: 'record_created',
        trigger_hint: '',
    },
    {
        key: 'summarize_on_close',
        name: 'Resumen al cerrar',
        description: 'Cuando un registro se cierra, deja una nota interna con el resumen de lo que pasó.',
        icon: 'file_text',
        color: '#7c3aed',
        instructions: [
            'Cuando el registro se cierra, resúmelo para quien lo lea después:',
            '1. Lee el registro, sus comentarios y su historial.',
            '2. Deja UNA nota interna con 3 a 5 viñetas: qué se pidió, qué se hizo, cómo terminó y si quedó algo pendiente.',
            'No cambies ningún campo.',
        ].join('\n'),
        tools: ['read_record', 'comment'],
        mode: 'act',
        trigger: 'record_updated',
        trigger_hint: 'Elige el campo de estado: el agente trabaja cuando cambia.',
    },
    {
        key: 'fill_missing',
        name: 'Completar datos faltantes',
        description: 'Lee la descripción y completa los campos vacíos con los datos que aparecen ahí.',
        icon: 'sparkle',
        color: '#0d9488',
        instructions: [
            'Completa los datos que faltan en el registro:',
            '1. Lee el registro, su descripción y sus comentarios.',
            '2. Completa SÓLO los campos que están vacíos con datos que aparezcan escritos de forma explícita (correo, teléfono, empresa, ciudad, fechas, montos).',
            '3. Nunca inventes ni supongas: si un dato no está, deja el campo vacío.',
            '4. No cambies campos que ya tienen valor.',
        ].join('\n'),
        tools: ['read_record', 'update_fields'],
        mode: 'propose',
        trigger: 'record_created',
        trigger_hint: '',
    },
    {
        key: 'suggest_reply',
        name: 'Sugerir una respuesta',
        description: 'Redacta un borrador de respuesta al cliente y lo deja como nota interna para revisarlo.',
        icon: 'chat_text',
        color: '#ea580c',
        instructions: [
            'Prepara un borrador de respuesta para el cliente:',
            '1. Lee el registro y sus comentarios para entender qué necesita.',
            '2. Redacta una respuesta breve, amable y profesional, en español neutro, que resuelva lo que pide o diga cuál es el siguiente paso.',
            '3. Déjala como nota INTERNA que empiece con «Borrador de respuesta:» para que una persona la revise y la envíe.',
            'No prometas plazos ni descuentos que no estén en el registro.',
        ].join('\n'),
        tools: ['read_record', 'comment'],
        mode: 'act',
        trigger: 'record_created',
        trigger_hint: '',
    },
    {
        key: 'assign_by_topic',
        name: 'Asignar por tema',
        description: 'Según el tema del registro, lo asigna a la persona o al equipo que corresponde.',
        icon: 'users',
        color: '#db2777',
        instructions: [
            'Asigna cada registro nuevo a quien corresponde según su tema.',
            'Reglas (edítalas con tu equipo):',
            '- Facturación y pagos → el equipo de Administración.',
            '- Errores, accesos y fallas → el equipo de Soporte.',
            '- Ventas, cotizaciones y planes → el equipo de Ventas.',
            'Si el tema no está claro, no asignes: deja una nota interna explicando qué falta para decidir.',
        ].join('\n'),
        tools: ['read_record', 'assign', 'comment'],
        mode: 'propose',
        trigger: 'record_created',
        trigger_hint: '',
    },
];

export function aiAgentTemplate(key: string): AiAgentTemplate | null {
    return AI_AGENT_TEMPLATES.find((t) => t.key === key) ?? null;
}

// ─────────────────────────── Puras (validación y resúmenes) ───────────────────────────

/** Recorta un texto para un resumen de una línea. */
export function agentClip(text: unknown, max = 160): string {
    const s = (typeof text === 'string' ? text : text === null || text === undefined ? '' : JSON.stringify(text)).replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Inicio del día (instante) en una zona horaria, para contar «corridas de hoy». */
export function agentDayStart(now: Date, timeZone: string): Date {
    try {
        return zonedInstant(zonedToday(timeZone, now), timeZone);
    } catch {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
}

/** Inicio del mes calendario (UTC) para el presupuesto de tokens. */
export function agentMonthStart(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Herramientas que se le ofrecen al modelo: las del agente que su dueño puede usar. */
export function agentToolsOffered(tools: readonly string[], ownerCan: (tool: AiAgentTool) => boolean): AiAgentTool[] {
    return AI_AGENT_TOOLS.filter((t) => tools.includes(t) && ownerCan(t));
}
