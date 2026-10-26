import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import type { OptionColor, SelectOption } from './field';

/**
 * C5 — Aprobaciones (flujos por lista, solicitudes y decisiones).
 *
 * Un FLUJO (`approval_flows`) es configuración de la lista: nombre, pasos en
 * serie y qué se escribe en el registro al resolver. Una SOLICITUD
 * (`approval_requests`) es un pedido sobre UN registro con la COPIA de la
 * configuración al momento de pedir: cambiar el flujo después no altera las
 * pendientes. Cada DECISIÓN (`approval_decisions`) es una fila por persona y
 * paso (aprobar / rechazar / devolver, con motivo).
 *
 * Referencias por ID (regla de oro nº 1). Los nombres de las claves siguen las
 * convenciones del re-mapeo (blueprint y migración de empresa): un campo
 * termina en `field_id` (`approver_field_id`, `field_id`), las personas viajan
 * en `approver_user_ids` y el flujo, donde lo referencia otra config (una
 * automatización, el campo «Aprobación»), en `approval_flow_id`.
 */

// ── Estados ────────────────────────────────────────────────────────────────

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'returned', 'cancelled'] as const;
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
    pending: 'Pendiente',
    approved: 'Aprobada',
    rejected: 'Rechazada',
    returned: 'Devuelta',
    cancelled: 'Cancelada',
};

export const APPROVAL_STATUS_COLORS: Record<ApprovalStatus, OptionColor> = {
    pending: 'amber',
    approved: 'green',
    rejected: 'red',
    returned: 'orange',
    cancelled: 'gray',
};

/**
 * Las opciones del campo derivado «Aprobación» (ver `fieldConfigSchemas.approval`):
 * el estado de la ÚLTIMA solicitud del registro. Con estas opciones la tabla,
 * los filtros y la vista agrupada lo tratan como una selección de sólo lectura.
 */
export const APPROVAL_FIELD_OPTIONS: SelectOption[] = APPROVAL_STATUSES.map((s) => ({
    value: s,
    label: APPROVAL_STATUS_LABELS[s],
    color: APPROVAL_STATUS_COLORS[s],
}));

export const APPROVAL_DECISIONS = ['approve', 'reject', 'return'] as const;
export const approvalDecisionKindSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecisionKind = z.infer<typeof approvalDecisionKindSchema>;

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecisionKind, string> = {
    approve: 'Aprobó',
    reject: 'Rechazó',
    return: 'Devolvió',
};

// ── Configuración del flujo ───────────────────────────────────────────────

/** Los roles base que pueden aprobar (el cliente del portal no). */
export const APPROVER_ROLES = ['admin', 'manager', 'agent', 'viewer'] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export const APPROVER_ROLE_LABELS: Record<ApproverRole, string> = {
    admin: 'Admin',
    manager: 'Manager',
    agent: 'Agente',
    viewer: 'Lector',
};

/**
 * Quién aprueba un paso. Se RESUELVE EN VIVO en cada decisión (ver
 * ApprovalsService.resolveApprovers): si el campo Persona del registro cambió,
 * manda el valor de ahora.
 *
 * - `users`: una o varias personas puntuales.
 * - `role`: todas las personas con ese rol en la empresa.
 * - `team`: los miembros de un equipo (los equipos los agrega otra entrega:
 *   el tipo ya se valida aquí y se resuelve en un único punto del servidor).
 * - `field`: la persona del campo Persona del registro («Jefe»).
 */
export const approverSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('users'), approver_user_ids: z.array(idSchema).min(1).max(50) }),
    z.object({ type: z.literal('role'), role: z.string().trim().min(1).max(40) }),
    z.object({ type: z.literal('team'), team_id: idSchema }),
    z.object({ type: z.literal('field'), approver_field_id: idSchema }),
]);
export type Approver = z.infer<typeof approverSchema>;
export type ApproverType = Approver['type'];

export const APPROVAL_MODES = ['any', 'all'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
    any: 'Cualquiera aprueba',
    all: 'Todos aprueban',
};

/** Pasos por flujo (en serie). */
export const APPROVAL_MAX_STEPS = 10;

export const approvalStepSchema = z.object({
    /** Id estable del paso dentro del flujo (la interfaz lo genera). */
    id: z.string().trim().min(1).max(40),
    /** Nombre corto («Jefe directo», «Finanzas»). Vacío = «Paso N». */
    name: z.string().trim().max(80).default(''),
    approver: approverSchema,
    mode: z.enum(APPROVAL_MODES).default('any'),
});
export type ApprovalStep = z.infer<typeof approvalStepSchema>;

/** Un campo que se pone al resolver (`field_id` → re-mapeo por convención). */
export const approvalFieldSetSchema = z.object({
    field_id: idSchema,
    value: z.unknown(),
});
export type ApprovalFieldSet = z.infer<typeof approvalFieldSetSchema>;

export const approvalFlowConfigSchema = z.object({
    steps: z.array(approvalStepSchema).min(1).max(APPROVAL_MAX_STEPS),
    /** Al aprobar el último paso: estos campos (p. ej. Estado = Aprobado). */
    on_approve: z.array(approvalFieldSetSchema).max(20).default([]),
    /** Al rechazar: estos otros (p. ej. Estado = Rechazado). */
    on_reject: z.array(approvalFieldSetSchema).max(20).default([]),
    /** Tras un rechazo, ¿se puede pedir otra vez? (devolver siempre lo permite). */
    allow_resubmit: z.boolean().default(false),
    /**
     * ¿Quien pidió puede aprobar su propia solicitud? Por defecto NO: el campo
     * Persona lo puede cambiar quien edita el registro, y sin esta regla bastaría
     * con ponerse a uno mismo de «Jefe» para auto-aprobarse.
     */
    self_approval: z.boolean().default(false),
});
export type ApprovalFlowConfig = z.infer<typeof approvalFlowConfigSchema>;

/** Lee una config guardada tolerando basura (nunca lanza; null si no sirve). */
export function readApprovalFlowConfig(raw: unknown): ApprovalFlowConfig | null {
    const parsed = approvalFlowConfigSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : null;
}

export const approvalFlowSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    name: z.string(),
    description: z.string(),
    config: approvalFlowConfigSchema,
    is_active: z.boolean(),
    /** Solicitudes pendientes de este flujo (para avisar antes de borrarlo). */
    pending_count: z.number().int().nonnegative().default(0),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type ApprovalFlow = z.infer<typeof approvalFlowSchema>;

export const createApprovalFlowSchema = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    config: approvalFlowConfigSchema,
    is_active: z.boolean().default(true),
    /**
     * Crear también la columna «Aprobación» (campo derivado con el estado de la
     * última solicitud de este flujo) para ver y filtrar en la tabla.
     */
    add_status_field: z.boolean().default(false),
});
export type CreateApprovalFlowInput = z.input<typeof createApprovalFlowSchema>;

export const updateApprovalFlowSchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000),
        config: approvalFlowConfigSchema,
        is_active: z.boolean(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El cambio no puede estar vacío' });
export type UpdateApprovalFlowInput = z.input<typeof updateApprovalFlowSchema>;

// ── Solicitudes y decisiones ──────────────────────────────────────────────

export const requestApprovalSchema = z.object({
    flow_id: idSchema,
    note: z.string().trim().max(2000).default(''),
});
export type RequestApprovalInput = z.input<typeof requestApprovalSchema>;

export const decideApprovalSchema = z
    .object({
        decision: approvalDecisionKindSchema,
        /**
         * El paso que la persona VIO (índice, 0 = el primero). Obligatorio: si
         * entre medio otra persona ya lo resolvió, la decisión no cae sobre el
         * paso siguiente por un doble clic (409 `approval_step_changed`).
         */
        step: z.number().int().min(0).max(APPROVAL_MAX_STEPS),
        reason: z.string().trim().max(2000).default(''),
    })
    .refine((d) => d.decision === 'approve' || d.reason.trim() !== '', {
        message: 'Escribe el motivo (se le muestra a quien pidió la aprobación).',
        path: ['reason'],
    });
export type DecideApprovalInput = z.input<typeof decideApprovalSchema>;

export const cancelApprovalSchema = z.object({
    reason: z.string().trim().max(2000).default(''),
});
export type CancelApprovalInput = z.input<typeof cancelApprovalSchema>;

export interface ApprovalPerson {
    id: number;
    name: string;
}

export interface ApprovalDecisionDto {
    id: number;
    step: number;
    user_id: number | null;
    user_name: string | null;
    decision: ApprovalDecisionKind;
    reason: string;
    created_at: string;
}

/** Un paso de una solicitud, como lo dibuja la ficha. */
export interface ApprovalStepDto {
    id: string;
    name: string;
    mode: ApprovalMode;
    /** «El campo «Jefe»», «Rol: Manager», «Ana, Luis». */
    approver_label: string;
    state: 'done' | 'current' | 'upcoming' | 'stopped';
    /**
     * Paso actual: quiénes pueden decidir AHORA (resuelto en vivo) y quién ya
     * aprobó. En los demás, vacío.
     */
    approvers: Array<ApprovalPerson & { approved: boolean }>;
}

export interface ApprovalRequestDto {
    id: number;
    list_id: number;
    record_id: number;
    flow_id: number | null;
    flow_name: string;
    status: ApprovalStatus;
    current_step: number;
    steps: ApprovalStepDto[];
    requested_by: ApprovalPerson | null;
    /** `automation` = la pidió una automatización (`automation_name`). */
    source: 'user' | 'automation';
    automation_name: string | null;
    requested_at: string;
    note: string;
    resolved_at: string | null;
    resolved_by: ApprovalPerson | null;
    /** Motivo del rechazo, de la devolución o de la cancelación. */
    reason: string;
    decisions: ApprovalDecisionDto[];
    /** Quien mira puede decidir el paso actual (ya pasó el ACL). */
    can_decide: boolean;
    /** Quien mira puede cancelarla (quien la pidió, o un admin). */
    can_cancel: boolean;
}

/** Un flujo disponible en la ficha: si se puede pedir y, si no, por qué. */
export interface RecordApprovalFlowDto {
    id: number;
    name: string;
    description: string;
    steps: number;
    can_request: boolean;
    blocked_reason: string | null;
}

/** La sección «Aprobación» de la ficha (viaja en el bundle de la ficha). */
export interface RecordApprovalsDto {
    flows: RecordApprovalFlowDto[];
    /** De la más nueva a la más vieja. */
    requests: ApprovalRequestDto[];
    /** Quien mira puede pedir (puede editar el registro). */
    can_request: boolean;
}

export const recordApprovalsSchema = z.custom<RecordApprovalsDto>(
    (v) => !!v && typeof v === 'object' && Array.isArray((v as { requests?: unknown }).requests),
);

/** Una solicitud en «Mi trabajo» → Aprobaciones. */
export interface ApprovalInboxItem {
    id: number;
    status: ApprovalStatus;
    flow_name: string;
    current_step: number;
    steps_count: number;
    step_name: string;
    list_id: number;
    list_slug: string;
    list_name: string;
    list_icon: string | null;
    list_color: string | null;
    record_id: number;
    record_title: string;
    requested_by_name: string | null;
    requested_at: string;
    note: string;
    reason: string;
    resolved_at: string | null;
}

export interface MyApprovalsDto {
    /** Esperan una decisión MÍA (paso actual, sin decidir todavía). */
    pending: ApprovalInboxItem[];
    /** Las que pedí: pendientes y las resueltas en los últimos 30 días. */
    requested: ApprovalInboxItem[];
    pending_count: number;
}

/** Lo que devuelve decidir o cancelar: la solicitud ya actualizada. */
export interface ApprovalActionResult {
    request: ApprovalRequestDto;
    /** «Aprobaste el paso 1 de 2», «Se aprobó la solicitud». */
    message: string;
    /** Algo no salió al resolver (p. ej. un campo del flujo ya no existe). */
    warnings: string[];
}

// ── Helpers puros ─────────────────────────────────────────────────────────

export function stepLabel(step: Pick<ApprovalStep, 'name'>, index: number): string {
    const name = step.name.trim();
    return name !== '' ? name : `Paso ${index + 1}`;
}

/**
 * El aprobador en palabras. `fieldLabel` / `userNames` / `teamName` vienen de
 * quien llama (la interfaz o el servidor) — sin ellos se nombra por id.
 */
export function describeApprover(
    approver: Approver,
    ctx: { fieldLabel?: string | null; userNames?: ReadonlyMap<number, string>; teamName?: string | null } = {},
): string {
    switch (approver.type) {
        case 'users': {
            const names = approver.approver_user_ids.map((id) => ctx.userNames?.get(id) ?? `Persona #${id}`);
            return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} y ${names.length - 3} más`;
        }
        case 'role':
            return `Rol: ${APPROVER_ROLE_LABELS[approver.role as ApproverRole] ?? approver.role}`;
        case 'team':
            return `Equipo: ${ctx.teamName ?? `#${approver.team_id}`}`;
        case 'field':
            return `El campo «${ctx.fieldLabel ?? `#${approver.approver_field_id}`}»`;
    }
}

/**
 * Problemas de una config de flujo contra los campos de la lista (null = bien).
 * `fields`: id → {type, label, config}. Lo usan el servidor al guardar y la
 * interfaz mientras se edita.
 */
export function approvalFlowConfigProblems(
    config: ApprovalFlowConfig,
    fields: ReadonlyMap<number, { type: string; label: string }>,
): string[] {
    const out: string[] = [];
    config.steps.forEach((s, i) => {
        const name = stepLabel(s, i);
        if (s.approver.type === 'field') {
            const f = fields.get(s.approver.approver_field_id);
            if (!f) out.push(`${name}: el campo de la persona que aprueba ya no existe.`);
            else if (f.type !== 'user') out.push(`${name}: «${f.label}» no es un campo Persona.`);
        }
        if (s.approver.type === 'role' && !(APPROVER_ROLES as readonly string[]).includes(s.approver.role)) {
            out.push(`${name}: el rol «${s.approver.role}» no existe.`);
        }
    });
    const ids = new Set<string>();
    for (const s of config.steps) {
        if (ids.has(s.id)) out.push('Hay dos pasos con el mismo identificador.');
        ids.add(s.id);
    }
    for (const [what, sets] of [
        ['Al aprobar', config.on_approve],
        ['Al rechazar', config.on_reject],
    ] as const) {
        const seen = new Set<number>();
        for (const s of sets) {
            const f = fields.get(s.field_id);
            if (!f) out.push(`${what}: un campo que se pone ya no existe.`);
            else if (seen.has(s.field_id)) out.push(`${what}: «${f.label}» está dos veces.`);
            seen.add(s.field_id);
        }
    }
    return out;
}

// ── Automatizaciones ──────────────────────────────────────────────────────

/**
 * El resultado de una aprobación en el idioma de las automatizaciones
 * (`{{aprobacion.resultado}}`): una palabra en minúsculas, cómoda para un
 * si/sino («es» `aprobada`). `vencida` = el paso «Esperar aprobación» llegó a
 * su tope de días sin que se resolviera.
 */
export const APPROVAL_RESULTS = ['aprobada', 'rechazada', 'devuelta', 'cancelada', 'vencida'] as const;
export type ApprovalResult = (typeof APPROVAL_RESULTS)[number];

export const APPROVAL_RESULT_BY_STATUS: Record<Exclude<ApprovalStatus, 'pending'>, ApprovalResult> = {
    approved: 'aprobada',
    rejected: 'rechazada',
    returned: 'devuelta',
    cancelled: 'cancelada',
};

export const APPROVAL_RESULT_LABELS: Record<ApprovalResult, string> = {
    aprobada: 'Aprobada',
    rechazada: 'Rechazada',
    devuelta: 'Devuelta',
    cancelada: 'Cancelada',
    vencida: 'Vencida (no se resolvió a tiempo)',
};

/** El disparador «Cuando se aprueba o se rechaza» filtra por estos resultados. */
export const APPROVAL_TRIGGER_RESULTS = ['approved', 'rejected', 'returned', 'cancelled'] as const;
export type ApprovalTriggerResult = (typeof APPROVAL_TRIGGER_RESULTS)[number];

/** Los resultados que dispara por defecto (sin elegir): aprobada y rechazada. */
export const APPROVAL_TRIGGER_DEFAULT_RESULTS: readonly ApprovalTriggerResult[] = ['approved', 'rejected'];

/** Lee los resultados elegidos en el disparador (vacío = los de por defecto). */
export function readApprovalTriggerResults(cfg: Record<string, unknown> | null | undefined): ApprovalTriggerResult[] {
    const raw = cfg?.results;
    const picked = Array.isArray(raw)
        ? raw.filter((r): r is ApprovalTriggerResult => (APPROVAL_TRIGGER_RESULTS as readonly unknown[]).includes(r))
        : [];
    return picked.length > 0 ? [...new Set(picked)] : [...APPROVAL_TRIGGER_DEFAULT_RESULTS];
}

/** El flujo elegido en una config (`approval_flow_id`), o null = cualquiera. */
export function readApprovalFlowId(cfg: Record<string, unknown> | null | undefined): number | null {
    const n = Number(cfg?.approval_flow_id);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** Tope de días de «Esperar aprobación» (como «Esperar»). */
export const WAIT_APPROVAL_MAX_DAYS = 366;

/** La config de «Esperar aprobación» ya leída. */
export interface WaitApprovalConfig {
    /** El flujo de la solicitud a esperar (null = la que pidió esta automatización o cualquiera pendiente). */
    flowId: number | null;
    /** Si no se resuelve en N días, sigue con resultado `vencida` (null = sin tope). */
    timeoutDays: number | null;
}

export function readWaitApprovalConfig(cfg: Record<string, unknown> | null | undefined): WaitApprovalConfig {
    const raw = cfg?.timeout_days;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    return {
        flowId: readApprovalFlowId(cfg),
        timeoutDays: Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), WAIT_APPROVAL_MAX_DAYS) : null,
    };
}

/** Lo que le falta a «Esperar aprobación» para poder correr (null = bien). */
export function waitApprovalProblem(cfg: Record<string, unknown> | null | undefined): string | null {
    const raw = cfg?.timeout_days;
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 'El tope de días tiene que ser un número mayor que 0 (o vacío para esperar sin tope).';
    if (n > WAIT_APPROVAL_MAX_DAYS) return `Se puede esperar como mucho ${WAIT_APPROVAL_MAX_DAYS} días.`;
    return null;
}

/** «Espera a que se resuelva «Gastos» (hasta 5 días)». */
export function describeWaitApproval(cfg: Record<string, unknown> | null | undefined, flowName?: string | null): string {
    const w = readWaitApprovalConfig(cfg);
    const what = flowName ? `la aprobación «${flowName}»` : 'la aprobación';
    return w.timeoutDays
        ? `Espera a que se resuelva ${what} (como mucho ${w.timeoutDays} ${w.timeoutDays === 1 ? 'día' : 'días'}; si no, sigue como «vencida»)`
        : `Espera a que se resuelva ${what}`;
}

/** Las variables `{{aprobacion.x}}` que dejan el disparador, la acción y la espera. */
export const APPROVAL_MERGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
    { tag: 'aprobacion.resultado', label: 'Resultado (aprobada, rechazada, devuelta, cancelada, vencida)' },
    { tag: 'aprobacion.flujo', label: 'Nombre del flujo' },
    { tag: 'aprobacion.motivo', label: 'Motivo del rechazo o la devolución' },
    { tag: 'aprobacion.decidio', label: 'Quién decidió' },
    { tag: 'aprobacion.solicito', label: 'Quién pidió la aprobación' },
    { tag: 'aprobacion.nota', label: 'Nota de la solicitud' },
];
