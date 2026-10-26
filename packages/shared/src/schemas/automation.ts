import { z } from 'zod';
import { FALLBACK_TIME_ZONE, isValidTimeZone } from './timezone';
import { idSchema, isoDateTimeSchema } from './common';
import { filterOperatorSchema } from './filter';
import { RESPONSE_NAME_RE, waitConfigProblem } from './automation-flow';
import { APPROVAL_RESULTS, waitApprovalProblem } from './approvals';

/**
 * Automatizaciones (CONTRACT.md §8) — modelo FLEXIBLE alineado al plugin
 * (paridad total del editor Formulario + Diagrama):
 *
 *   trigger_type (slug) + trigger_config (field_filters / changed_fields /
 *   claves específicas del trigger) + actions[] (cada una con `condition`
 *   propia + el tipo especial `if_else` con ramas then/else recursivas) +
 *   description.
 *
 * El config de cada acción es un record laxo: el motor lee las claves que
 * necesita (el catálogo `/actions` describe el schema para el UI). Las
 * condiciones referencian el campo por SLUG (entrada/salida humana); el motor
 * resuelve slug→valor del record al evaluar.
 */

// --- Triggers (slugs conocidos; el tipo es abierto para el catálogo) ---
export const AUTOMATION_TRIGGERS = [
    'record_created',
    'record_updated',
    'field_changed',
    'due_date_reached',
    'scheduled',
    // C5 — una solicitud de aprobación del registro se resolvió.
    'approval_resolved',
    // A9 — un checklist del registro quedó completo.
    'checklist_completed',
    // D5 — una cita de la agenda se agendó, se reprogramó o se canceló.
    'booking_event',
    // D2 — llegó un correo al buzón de la lista (ticket nuevo o respuesta).
    'email_received',
    // E5 — un SLA del ticket entró en riesgo o se venció.
    'sla_alert',
] as const;
export const automationTriggerSlugSchema = z.string().min(1);
export type AutomationTriggerSlug = z.infer<typeof automationTriggerSlugSchema>;

// --- Condiciones ---
// Shape rico: array de `{field, op, value}` unidas por AND (lo que escribe el
// ConditionEditor del plugin). Se acepta también el legacy plano `{slug:value}`.
// `field` o `slug` (alias): el ConditionEditor del fork emite `{slug, op,
// value}` y el evaluador del motor acepta ambos desde siempre — el schema
// exigía `field` a secas y rechazaba con "Datos inválidos" cualquier
// condición guardada desde la UI.
export const conditionRuleSchema = z
    .object({
        field: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        op: filterOperatorSchema,
        value: z.unknown().optional(),
    })
    .refine((r) => (r.field ?? r.slug ?? '') !== '', {
        message: 'La condición necesita un campo (field o slug)',
    });
export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export const conditionDataSchema = z.union([
    z.array(conditionRuleSchema),
    z.record(z.unknown()),
]);
export type ConditionData = z.infer<typeof conditionDataSchema>;

// --- Acciones (recursivas por `if_else`) ---
export const AUTOMATION_ACTIONS = [
    'send_email',
    'call_webhook',
    'update_field',
    'create_record',
    'bulk_edit',
    'generate_pdf',
    'if_else',
    // v0.1.288 — esperar (tiempo o fecha de un campo) y repetir por cada vinculado.
    'wait',
    'for_each_linked',
    // C5 — pedir una aprobación y esperar a que se resuelva.
    'request_approval',
    'wait_approval',
    // C6 — subtareas (y checklists) de una plantilla de registro sobre el registro.
    'create_subtasks_from_template',
    // D2 — responder por correo al hilo del ticket (sale por el correo de la empresa).
    'reply_email',
    // E6 — pedirle a un agente de IA que trabaje sobre el registro.
    'ask_agent',
] as const;

export interface ActionSpec {
    type: string;
    config: Record<string, unknown>;
    condition?: ConditionData | null;
}
interface ActionSpecInput {
    type: string;
    config?: Record<string, unknown>;
    condition?: ConditionData | null;
}

export const actionSpecSchema: z.ZodType<ActionSpec, z.ZodTypeDef, ActionSpecInput> = z.lazy(() =>
    z.object({
        type: z.string().min(1),
        config: z.record(z.unknown()).default({}),
        condition: conditionDataSchema.nullish(),
    }),
);

// --- Config del trigger ---
export const triggerConfigSchema = z
    .object({
        field_filters: conditionDataSchema.optional(),
        changed_fields: z.array(z.string()).optional(),
    })
    .catchall(z.unknown());
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

// --- Entidad ---
export const automationSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    name: z.string().min(1).max(190),
    description: z.string().nullable(),
    trigger_type: automationTriggerSlugSchema,
    trigger_config: triggerConfigSchema,
    actions: z.array(actionSpecSchema),
    is_active: z.boolean(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    /**
     * v0.1.285 (ADR-S44) — la última corrida (sólo en el listado): el índice
     * muestra «Falló» sin abrir el historial de cada una.
     */
    last_run: z
        .object({ status: z.string(), error: z.string().nullable(), at: isoDateTimeSchema })
        .nullable()
        .optional(),
    /** v0.1.288 — cuántas corridas están en pausa en un «Esperar» (sólo en el listado). */
    waiting_runs: z.number().int().nonnegative().optional(),
});
export type Automation = z.infer<typeof automationSchema>;

export const createAutomationSchema = z.object({
    name: z.string().trim().min(1).max(190),
    description: z.string().max(2000).nullish(),
    trigger_type: automationTriggerSlugSchema,
    trigger_config: triggerConfigSchema.optional(),
    actions: z.array(actionSpecSchema).min(1),
    is_active: z.boolean().optional(),
});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z
    .object({
        name: z.string().trim().min(1).max(190),
        description: z.string().max(2000).nullable(),
        trigger_type: automationTriggerSlugSchema,
        trigger_config: triggerConfigSchema,
        actions: z.array(actionSpecSchema).min(1),
        is_active: z.boolean(),
        /**
         * v0.1.288 — el cambio restaura una versión anterior (sólo para la
         * nota del historial de versiones: «Restauró la versión del …»).
         */
        restored_from: idSchema,
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El patch no puede estar vacío' });
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

// --- Runs ---
// v0.1.288 — `waiting`: la corrida está en pausa en un «Esperar» y se reanuda
// sola a su hora; `cancelled`: no siguió (se canceló la espera, se pausó la
// automatización, se borró el registro…), con el motivo en `error`.
export const AUTOMATION_RUN_STATUSES = ['pending', 'running', 'success', 'failed', 'waiting', 'cancelled'] as const;
export const automationRunStatusSchema = z.enum(AUTOMATION_RUN_STATUSES);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

export const actionLogStatusSchema = z.enum(['success', 'failed', 'skipped']);
export type ActionLogStatus = z.infer<typeof actionLogStatusSchema>;

export const actionLogEntrySchema = z.object({
    action: z.string(),
    status: actionLogStatusSchema,
    message: z.string().nullable(),
    details: z.record(z.unknown()).default({}),
});
export type ActionLogEntry = z.infer<typeof actionLogEntrySchema>;

export const automationRunSchema = z.object({
    id: idSchema,
    automation_id: idSchema,
    list_id: idSchema,
    record_id: idSchema.nullable(),
    status: automationRunStatusSchema,
    actions_log: z.array(actionLogEntrySchema),
    error: z.string().nullable(),
    started_at: isoDateTimeSchema.nullable(),
    finished_at: isoDateTimeSchema.nullable(),
    created_at: isoDateTimeSchema.nullable(),
    /** v0.1.288 — una corrida `waiting` se reanuda a esta hora. */
    resume_at: isoDateTimeSchema.nullable().optional(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

// --- Catálogo (para el UI: /triggers y /actions) ---
export const triggerMetaSchema = z.object({
    slug: z.string(),
    label: z.string(),
    event: z.string(),
    config_schema: z.record(z.record(z.unknown())),
});
export type TriggerMeta = z.infer<typeof triggerMetaSchema>;

export const actionMetaSchema = z.object({
    slug: z.string(),
    label: z.string(),
    config_schema: z.record(z.record(z.unknown())),
    /**
     * v0.1.198 — acciones con NOMBRE de un conector. Cuando viene, el ítem del
     * menú no es un tipo de acción sino una acción concreta de una conexión
     * ("Enviar WhatsApp" de «Gateway»); el `slug` sigue siendo
     * `connector_action` porque el motor ejecuta una sola cosa.
     */
    connector: z
        .object({
            connection_id: idSchema,
            connection_name: z.string(),
            action_key: z.string(),
            description: z.string(),
            /** v0.1.203 — app de la galería, para pintar su logo en el menú. */
            integration_key: z.string().nullable().optional(),
        })
        .optional(),
});
export type ActionMeta = z.infer<typeof actionMetaSchema>;

// --- v0.1.111: capturas de prueba del webhook entrante ---
// Los últimos payloads recibidos en `POST /public/hooks/:token`, para que el
// editor muestre qué llega y ayude a mapear claves → campos/merge tags.
export const hookCaptureSchema = z.object({
    payload: z.record(z.unknown()),
    received_at: z.string(),
});
export type HookCapture = z.infer<typeof hookCaptureSchema>;

/**
 * Probador de webhooks salientes (v0.1.155). El backend arma la petición con
 * el MISMO builder que usa el motor, la ejecuta contra el destino real (con
 * el guard anti-SSRF de SEC-03) y devuelve lo que mandó y lo que contestaron.
 * Sin esto, configurar una API ajena era escribir a ciegas y esperar a que
 * saltara un registro para ver si funcionaba.
 */
export const webhookTestInputSchema = z.object({
    /** El `config` de la acción `call_webhook` tal cual se está editando. */
    config: z.record(z.unknown()),
    /** Registro de muestra para resolver las variables. Default: el último. */
    record_id: z.number().int().positive().optional(),
});
export type WebhookTestInput = z.infer<typeof webhookTestInputSchema>;

/**
 * v0.1.265 — «Enviar prueba» / «Ver con datos reales» del editor de correos.
 * La prueba sale SIEMPRE a la casilla de quien la pide.
 */
export const emailTestInputSchema = z.object({
    /** El `config` de la acción `send_email` tal cual se está editando. */
    config: z.record(z.unknown()),
    record_id: z.number().int().positive().optional(),
    /** false = sólo arma el correo (vista previa con datos reales). */
    send: z.boolean().default(false),
});
export type EmailTestInput = z.infer<typeof emailTestInputSchema>;

export interface EmailTestResult {
    subject: string;
    html: string | null;
    text: string | null;
    sample_record_id: number | null;
    /** La casilla a la que salió la prueba (null si no se mandó). */
    sent_to: string | null;
    error: string | null;
    signature_note: string | null;
    /** v0.1.266 — PDFs adjuntos de la prueba enviada. */
    attachments?: Array<{ filename: string; bytes: number }>;
}

export const webhookTestResultSchema = z.object({
    /** Lo que se envió, ya con las variables resueltas. */
    request: z.object({
        url: z.string(),
        method: z.string(),
        headers: z.record(z.string()),
        body: z.string().nullable().default(null),
    }),
    /** `null` si no se llegó a conectar (ver `error`). */
    response: z
        .object({
            status: z.number(),
            content_type: z.string().default(''),
            body: z.string().default(''),
        })
        .nullable()
        .default(null),
    /** Motivo por el que no hubo respuesta (SSRF bloqueado, timeout, DNS…). */
    error: z.string().nullable().default(null),
    /** Id del registro usado para resolver las variables (`null` = ninguno). */
    sample_record_id: z.number().nullable().default(null),
});
export type WebhookTestResult = z.infer<typeof webhookTestResultSchema>;

// --- Trigger «En un horario» (v0.1.221) ---
// La UI guarda una FRECUENCIA legible (la del plugin: cada hora, dos veces al
// día, diario, semanal) más hora, día y zona horaria; el motor necesita un
// cron. Esta función es la ÚNICA traducción entre las dos, así el editor y
// el scheduler no pueden desalinearse. Un `cron` explícito siempre manda.
export const SCHEDULE_FREQUENCIES = ['hourly', 'twicedaily', 'daily', 'weekly', 'monthly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

function schedInt(v: unknown, min: number, max: number, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export interface ScheduleParts {
    frequency: ScheduleFrequency;
    hour: number;
    minute: number;
    /** 0 = domingo … 6 = sábado. */
    weekday: number;
    /** 1-28 (los meses cortos no tienen 29-31). */
    day: number;
}

/** Lee la frecuencia del config con defaults: diario a las 9:00. */
export function scheduleParts(cfg: Record<string, unknown>): ScheduleParts {
    const f = cfg.frequency;
    return {
        frequency: (SCHEDULE_FREQUENCIES as readonly unknown[]).includes(f) ? (f as ScheduleFrequency) : 'daily',
        hour: schedInt(cfg.hour, 0, 23, 9),
        minute: schedInt(cfg.minute, 0, 59, 0),
        weekday: schedInt(cfg.weekday, 0, 6, 1),
        day: schedInt(cfg.day, 1, 28, 1),
    };
}

/**
 * v0.1.263 — En qué reloj corre una automatización programada: la zona propia
 * (`trigger_config.tz`, si alguien la eligió) o, si no, la de la EMPRESA. Sin
 * ninguna de las dos, UTC — y `source: 'fallback'` para que la interfaz lo
 * avise en vez de mostrar una zona que no es la real.
 */
export function scheduleTimeZone(
    cfg: Record<string, unknown>,
    tenantTimeZone: string | null | undefined,
): { tz: string; source: 'own' | 'tenant' | 'fallback' } {
    if (isValidTimeZone(cfg.tz)) return { tz: cfg.tz.trim(), source: 'own' };
    if (isValidTimeZone(tenantTimeZone)) return { tz: tenantTimeZone.trim(), source: 'tenant' };
    return { tz: FALLBACK_TIME_ZONE, source: 'fallback' };
}

/** El cron de una automatización programada (en su zona horaria `tz`). */
export function scheduleCron(cfg: Record<string, unknown>): string {
    const cron = typeof cfg.cron === 'string' ? cfg.cron.trim() : '';
    if (cron !== '') return cron;
    const p = scheduleParts(cfg);
    switch (p.frequency) {
        case 'hourly':
            return `${p.minute} * * * *`;
        case 'twicedaily':
            return `${p.minute} ${Math.min(p.hour, (p.hour + 12) % 24)},${Math.max(p.hour, (p.hour + 12) % 24)} * * *`;
        case 'weekly':
            return `${p.minute} ${p.hour} * * ${p.weekday}`;
        case 'monthly':
            return `${p.minute} ${p.hour} ${p.day} * *`;
        default:
            return `${p.minute} ${p.hour} * * *`;
    }
}

// --- Validación de un cron escrito a mano (auditoría de automatizaciones) ---
// Un cron inválido (`99 99 * * *`) se guardaba ACTIVO y el servidor nunca lo
// registraba (sólo lo anotaba en el log): la automatización no corría jamás y
// nadie se enteraba. Esta validación corre al guardar (servidor) y mientras
// se escribe (editor). Acepta lo que entiende el planificador: 5 campos (o 6
// con segundos), listas, rangos, pasos, nombres de meses y días, `?`, `L` y `#`.

const CRON_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const CRON_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface CronFieldSpec {
    name: string;
    min: number;
    max: number;
    names?: string[];
    namesBase?: number;
    kind: 'sec' | 'min' | 'hour' | 'dom' | 'month' | 'dow';
}

const CRON_FIELDS_5: CronFieldSpec[] = [
    { name: 'los minutos', min: 0, max: 59, kind: 'min' },
    { name: 'la hora', min: 0, max: 23, kind: 'hour' },
    { name: 'el día del mes', min: 1, max: 31, kind: 'dom' },
    { name: 'el mes', min: 1, max: 12, names: CRON_MONTHS, namesBase: 1, kind: 'month' },
    { name: 'el día de la semana', min: 0, max: 7, names: CRON_DAYS, namesBase: 0, kind: 'dow' },
];

function cronNumber(raw: string, spec: CronFieldSpec): number | null {
    if (/^\d+$/.test(raw)) return Number(raw);
    const idx = spec.names?.indexOf(raw.toLowerCase()) ?? -1;
    return idx >= 0 ? idx + (spec.namesBase ?? 0) : null;
}

function cronFieldError(field: string, spec: CronFieldSpec): string | null {
    if (field === '') return `falta ${spec.name}`;
    for (const item of field.split(',')) {
        if (item === '') return `${spec.name}: hay una coma de más`;
        if (item === '?' && (spec.kind === 'dom' || spec.kind === 'dow')) continue;
        if (item === 'L' && spec.kind === 'dom') continue;
        // `5L` (último viernes) y `5#2` (segundo viernes) en el día de la semana.
        if (spec.kind === 'dow') {
            const special = /^(\w+?)(L|#([1-5]))$/i.exec(item);
            if (special) {
                const n = cronNumber(special[1]!, spec);
                if (n === null || n < spec.min || n > spec.max) return `«${item}» no es un día de la semana válido`;
                continue;
            }
        }
        const [rangePart, stepPart, extra] = item.split('/');
        if (extra !== undefined) return `«${item}» tiene más de un paso (/)`;
        if (stepPart !== undefined && !/^[1-9]\d*$/.test(stepPart)) return `«${item}»: el paso debe ser un número mayor que 0`;
        if (rangePart === '*') continue;
        const bounds = (rangePart ?? '').split('-');
        if (bounds.length > 2) return `«${item}» no es un rango válido`;
        const nums = bounds.map((b) => cronNumber(b, spec));
        if (nums.some((n) => n === null)) return `«${item}» no es válido para ${spec.name}`;
        for (const n of nums as number[]) {
            if (n < spec.min || n > spec.max) return `«${n}» está fuera de rango para ${spec.name} (${spec.min}-${spec.max})`;
        }
        if (nums.length === 2 && (nums[0] as number) > (nums[1] as number)) return `«${item}»: el rango va al revés`;
    }
    return null;
}

/**
 * Motivo (en español) por el que un cron no es válido, o null si lo es.
 * Ejemplo: «99 99 * * *» → ««99» está fuera de rango para los minutos (0-59)».
 */
export function cronError(expr: string): string | null {
    const parts = expr.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 5 && parts.length !== 6) {
        return 'un horario personalizado lleva 5 partes: minuto, hora, día del mes, mes y día de la semana (por ejemplo «30 8 * * 1-5»)';
    }
    const specs: CronFieldSpec[] =
        parts.length === 6 ? [{ name: 'los segundos', min: 0, max: 59, kind: 'sec' }, ...CRON_FIELDS_5] : CRON_FIELDS_5;
    for (let i = 0; i < parts.length; i++) {
        const err = cronFieldError(parts[i]!, specs[i]!);
        if (err) return err;
    }
    return null;
}

// --- Configuración mínima de cada acción (auditoría de automatizaciones) ---
// Una automatización creada desde una plantilla se guardaba ACTIVA con un
// «Enviar email» sin destinatario: corría, no mandaba nada y nadie lo veía.
// Lo imprescindible de cada acción se valida al guardar (servidor → 400) y en
// el editor (aviso en la tarjeta), con la MISMA función.

export interface AutomationConfigIssue {
    /** Ruta tipo Zod: `actions.0.config.to`, `trigger_config.cron`. */
    path: string;
    message: string;
}

const isBlankConfig = (v: unknown): boolean =>
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

interface IssueScope {
    /** Dentro de «Repetir por cada registro vinculado». */
    inLoop: boolean;
    /** Nombres de respuesta ya usados (para avisar de repetidos). */
    responseNames: Set<string>;
}

function actionIssues(actions: unknown, base: string, depth: number, out: AutomationConfigIssue[], scope: IssueScope): void {
    if (!Array.isArray(actions) || depth > 6) return;
    actions.forEach((a, i) => {
        if (!a || typeof a !== 'object') return;
        const spec = a as { type?: unknown; config?: unknown };
        const cfg = (spec.config && typeof spec.config === 'object' ? spec.config : {}) as Record<string, unknown>;
        const at = `${base}.${i}`;
        // v0.1.288 — una respuesta con nombre (`{{respuestas.<nombre>.body}}`).
        if ((spec.type === 'call_webhook' || spec.type === 'connector_action') && !isBlankConfig(cfg.response_name)) {
            const name = String(cfg.response_name).trim();
            if (!RESPONSE_NAME_RE.test(name)) {
                out.push({
                    path: `${at}.config.response_name`,
                    message: 'El nombre de la respuesta usa sólo minúsculas, números y guion bajo, y empieza con una letra (por ejemplo «pedido_erp»).',
                });
            } else if (scope.responseNames.has(name)) {
                out.push({ path: `${at}.config.response_name`, message: `Ya hay otro paso que guarda su respuesta como «${name}»: usa otro nombre.` });
            } else {
                scope.responseNames.add(name);
            }
        }
        switch (spec.type) {
            case 'send_email':
                if (isBlankConfig(cfg.to)) out.push({ path: `${at}.config.to`, message: 'El correo necesita un destinatario («Para»).' });
                break;
            case 'call_webhook':
                if (isBlankConfig(cfg.url) && isBlankConfig(cfg.connection_id)) {
                    out.push({ path: `${at}.config.url`, message: 'El webhook necesita una URL.' });
                }
                break;
            case 'update_field': {
                const values = cfg.values;
                if (!values || typeof values !== 'object' || Object.keys(values as object).length === 0) {
                    out.push({ path: `${at}.config.values`, message: 'Elige al menos un campo para actualizar.' });
                }
                if (cfg.target === 'item' && !scope.inLoop) {
                    out.push({ path: `${at}.config.target`, message: '«El registro vinculado» sólo existe dentro de «Repetir por cada registro vinculado».' });
                }
                break;
            }
            case 'generate_pdf':
                if (isBlankConfig(cfg.document_template_id)) {
                    out.push({ path: `${at}.config.document_template_id`, message: 'Elige la plantilla del documento PDF.' });
                }
                break;
            case 'reply_email':
                if (isBlankConfig(cfg.body)) {
                    out.push({ path: `${at}.config.body`, message: 'Escribe el texto de la respuesta.' });
                }
                break;
            case 'create_subtasks_from_template':
                if (isBlankConfig(cfg.template_id)) {
                    out.push({ path: `${at}.config.template_id`, message: 'Elige la plantilla de registro.' });
                }
                break;
            case 'connector_action':
                if (isBlankConfig(cfg.connection_id) || isBlankConfig(cfg.action_key)) {
                    out.push({ path: `${at}.config.connection_id`, message: 'Elige la app conectada y la acción.' });
                }
                break;
            case 'ask_agent': {
                // E6 — «Pedirle a un agente».
                const agent = Number(cfg.agent_id);
                if (!Number.isInteger(agent) || agent <= 0) {
                    out.push({ path: `${at}.config.agent_id`, message: 'Elige el agente de IA al que se le pide el trabajo.' });
                }
                if (typeof cfg.instruction === 'string' && cfg.instruction.length > 1000) {
                    out.push({ path: `${at}.config.instruction`, message: 'La instrucción extra es demasiado larga (máximo 1.000 caracteres).' });
                }
                break;
            }
            case 'bulk_edit':
                if (!Array.isArray(cfg.operations) || cfg.operations.length === 0) {
                    out.push({ path: `${at}.config.operations`, message: 'Agrega al menos un cambio para la edición en lote.' });
                }
                break;
            case 'wait': {
                // Una espera dentro de un bucle no tiene un "después" claro (¿por
                // ítem? ¿todas juntas?): no se permite, y se explica.
                if (scope.inLoop) {
                    out.push({ path: `${at}.type`, message: 'No se puede esperar dentro de «Repetir por cada registro vinculado»: pon la espera antes o después de la repetición.' });
                    break;
                }
                const problem = waitConfigProblem(cfg);
                if (problem) out.push({ path: `${at}.config`, message: problem });
                break;
            }
            case 'request_approval': {
                const flow = Number(cfg.approval_flow_id);
                if (!Number.isInteger(flow) || flow <= 0) {
                    out.push({ path: `${at}.config.approval_flow_id`, message: 'Elige el flujo de aprobación que se pide.' });
                }
                break;
            }
            case 'wait_approval': {
                // Como «Esperar»: dentro de un bucle no tiene un "después" claro.
                if (scope.inLoop) {
                    out.push({ path: `${at}.type`, message: 'No se puede esperar una aprobación dentro de «Repetir por cada registro vinculado»: pon la espera antes o después de la repetición.' });
                    break;
                }
                const problem = waitApprovalProblem(cfg);
                if (problem) out.push({ path: `${at}.config.timeout_days`, message: problem });
                break;
            }
            case 'for_each_linked': {
                if (scope.inLoop) {
                    out.push({ path: `${at}.type`, message: 'No se puede repetir dentro de otra repetición.' });
                    break;
                }
                const rel = Number(cfg.relation_field_id);
                if (!Number.isInteger(rel) || rel <= 0) {
                    out.push({ path: `${at}.config.relation_field_id`, message: 'Elige la relación por la que se repite.' });
                }
                const inner = Array.isArray(cfg.actions) ? cfg.actions : [];
                if (inner.length === 0) {
                    out.push({ path: `${at}.config.actions`, message: 'Agrega al menos una acción para repetir.' });
                }
                actionIssues(inner, `${at}.config.actions`, depth + 1, out, { ...scope, inLoop: true });
                break;
            }
            case 'if_else':
                actionIssues(cfg.then_actions, `${at}.config.then_actions`, depth + 1, out, scope);
                actionIssues(cfg.else_actions, `${at}.config.else_actions`, depth + 1, out, scope);
                break;
            default:
                break;
        }
    });
}

/**
 * Lo que le falta a una automatización para poder correr (vacío = lista).
 * Sólo lo imprescindible: un «Para» vacío, una URL vacía, un cron inválido,
 * un vencimiento sin campo de fecha, un «cuando cambia» sin campo.
 */
export function automationConfigIssues(input: {
    trigger_type?: string;
    trigger_config?: Record<string, unknown> | null;
    actions?: unknown;
}): AutomationConfigIssue[] {
    const out: AutomationConfigIssue[] = [];
    const cfg = input.trigger_config ?? {};
    if (input.trigger_type === 'scheduled' && typeof cfg.cron === 'string' && cfg.cron.trim() !== '') {
        const err = cronError(cfg.cron);
        if (err) out.push({ path: 'trigger_config.cron', message: `El horario personalizado (cron) no es válido: ${err}.` });
    }
    if (
        input.trigger_type === 'due_date_reached' &&
        isBlankConfig(cfg.due_field) &&
        isBlankConfig(cfg.field_id) &&
        isBlankConfig(cfg.field) &&
        isBlankConfig(cfg.date_field)
    ) {
        out.push({ path: 'trigger_config.due_field', message: 'Elige el campo de fecha que dispara la automatización.' });
    }
    if (input.trigger_type === 'field_changed' && isBlankConfig(cfg.field)) {
        out.push({ path: 'trigger_config.field', message: 'Elige el campo a observar.' });
    }
    // A9 — «uno con un nombre en particular» sin nombre no dispararía nunca.
    if (input.trigger_type === 'checklist_completed' && cfg.checklist_mode === 'named' && isBlankConfig(cfg.checklist_name)) {
        out.push({ path: 'trigger_config.checklist_name', message: 'Escribe el nombre del checklist que dispara la automatización.' });
    }
    if (input.actions !== undefined) actionIssues(input.actions, 'actions', 0, out, { inLoop: false, responseNames: new Set() });
    return out;
}

// --- v0.1.288: «Probar» paso a paso (simulación) ---
// Corre la automatización TAL COMO SE ESTÁ EDITANDO (sin guardar) contra un
// registro real en modo simulación: el motor resuelve todo con el MISMO código
// que en una corrida de verdad, pero no escribe, no envía y no llama — salvo
// los webhooks/conectores que la persona marque para ejecutar de verdad.
export const automationTestRunInputSchema = z.object({
    trigger_type: automationTriggerSlugSchema,
    trigger_config: triggerConfigSchema.default({}),
    actions: z.array(actionSpecSchema).max(60).default([]),
    /** Registro de prueba. Default: el último de la lista. */
    record_id: z.number().int().positive().optional(),
    /** La automatización guardada (si existe): para leer la última captura del webhook entrante. */
    automation_id: z.number().int().positive().optional(),
    /** Rutas (`2.then.0`) de webhooks/conectores que se ejecutan DE VERDAD. */
    real_steps: z.array(z.string().max(120)).max(10).default([]),
    /**
     * C5 — con qué resultado se simula una aprobación (el disparador «Cuando
     * se aprueba o se rechaza» y el paso «Esperar aprobación»). Default: el
     * de la última solicitud del registro de prueba o, si no hay, `aprobada`.
     */
    approval_result: z.enum(APPROVAL_RESULTS).optional(),
});
export type AutomationTestRunInput = z.infer<typeof automationTestRunInputSchema>;

/** Una condición evaluada, regla por regla (para decir POR QUÉ). */
export interface ConditionCheck {
    field: string;
    label: string;
    op: string;
    expected: unknown;
    actual: unknown;
    ok: boolean;
}

export type TestStepStatus = 'would_run' | 'ran' | 'skipped' | 'failed' | 'info';

/** Un paso simulado: qué haría, con lo resuelto (correo, petición, cambios…). */
export interface AutomationTestStep {
    /** Ruta del paso (`2.then.0`). */
    path: string;
    depth: number;
    action: string;
    status: TestStepStatus;
    message: string;
    /** Detalle por tipo: `email`, `request`, `response`, `changes`, `values`, `checks`… */
    details: Record<string, unknown>;
}

export interface AutomationTestRunResult {
    record: { id: number; title: string } | null;
    trigger: { matches: boolean; message: string; checks: ConditionCheck[]; notes: string[] };
    steps: AutomationTestStep[];
    /**
     * Cuerpos de las respuestas reales obtenidas (por ruta del paso), para que
     * el editor sugiera sus campos como variables de los pasos siguientes.
     */
    responses: Record<string, unknown>;
}

// --- v0.1.288: historial de versiones ---
// Cada guardado deja una foto de la automatización (sin secretos) con autor y
// fecha; se conservan las últimas 50.
export const AUTOMATION_VERSIONS_KEPT = 50;
/** Lo que se guarda en lugar de un secreto en una versión. */
export const AUTOMATION_SECRET_MARKER = '[oculto]';

export const automationVersionSchema = z.object({
    id: idSchema,
    automation_id: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    trigger_type: z.string(),
    trigger_config: z.record(z.unknown()),
    actions: z.array(actionSpecSchema),
    is_active: z.boolean(),
    author: z.object({ id: idSchema, name: z.string() }).nullable(),
    /** «Creó la automatización», «Restauró la versión del …», «Duplicada de …». */
    note: z.string().nullable(),
    created_at: isoDateTimeSchema,
});
export type AutomationVersion = z.infer<typeof automationVersionSchema>;
