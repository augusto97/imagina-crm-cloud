import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';

/**
 * A14 (v0.1.445, ADR-S106) — Qué pasa con lo que cuelga de un registro que
 * se FUSIONA en otro.
 *
 * Cada tabla que apunta a un registro está clasificada aquí, una por una:
 *
 *  - `MOVE_STEPS`: se pasa al registro que queda (comentarios, tiempo,
 *    checklists, vínculos, cobros…). Si la tabla tiene un único que incluye
 *    la columna, lo que chocaría se queda donde estaba (`conflict`): moverlo
 *    rompería el único y no aporta (ya está en el que queda).
 *  - `LEFT_BEHIND`: es historia del registro que se va (su actividad, sus
 *    corridas) y se queda con él en la papelera.
 *  - `BLOCKING`: el registro ES otra cosa (una cita, un pedido): no se fusiona.
 *
 * `merge-plan.spec` recorre las FKs hacia `records` y falla si aparece una
 * tabla nueva sin clasificar — así una tabla futura no se queda colgando de un
 * registro en la papelera sin que nadie lo decida.
 */

export interface MoveStep {
    /** Clave estable (se guarda en el historial para deshacer). */
    key: string;
    /** En palabras, para la vista previa («Comentarios»). */
    label: string;
    table: string;
    column: string;
    /** Condición extra sobre la fila (`t`). */
    extra?: (primary: number) => SQL;
    /** Lo que chocaría con un único (`t` = la fila a mover, `x` = una del que queda). */
    conflict?: (primary: number) => SQL;
    /** No se cuenta en la vista previa (filas internas que acompañan a otras). */
    hidden?: boolean;
}

const same = (...cols: string[]) => sql.join(cols.map((c) => sql`x.${sql.identifier(c)} IS NOT DISTINCT FROM t.${sql.identifier(c)}`), sql` AND `);

export const MOVE_STEPS: readonly MoveStep[] = [
    { key: 'comments', label: 'Comentarios', table: 'comments', column: 'record_id' },
    { key: 'checklists', label: 'Checklists', table: 'record_checklists', column: 'record_id' },
    { key: 'checklist_items', label: 'Ítems de checklist', table: 'record_checklist_items', column: 'record_id', hidden: true },
    { key: 'time_entries', label: 'Tiempo registrado', table: 'time_entries', column: 'record_id' },
    { key: 'reminders', label: 'Recordatorios', table: 'reminders', column: 'record_id' },
    { key: 'payment_links', label: 'Links de pago', table: 'payment_links', column: 'record_id' },
    { key: 'subscriptions', label: 'Suscripciones', table: 'subscriptions', column: 'record_id' },
    { key: 'subscription_charges', label: 'Cobros registrados', table: 'subscription_charges', column: 'log_record_id', hidden: true },
    {
        key: 'document_numbers',
        label: 'Documentos emitidos',
        table: 'document_numbers',
        column: 'record_id',
        conflict: () => sql`${same('template_id')} AND x.voided_at IS NULL AND t.voided_at IS NULL`,
    },
    // D6 — las firmas del registro (pendientes o firmadas) se van con él.
    { key: 'signature_requests', label: 'Firmas de documentos', table: 'signature_requests', column: 'record_id' },
    { key: 'recurrences', label: 'Recurrencias', table: 'recurrences', column: 'record_id', conflict: () => same('tenant_id', 'date_field_id') },
    { key: 'portal_links', label: 'Accesos al portal', table: 'portal_links', column: 'record_id', conflict: () => same('user_id') },
    { key: 'record_shares', label: 'Personas de afuera con acceso', table: 'record_shares', column: 'record_id', conflict: () => same('user_id') },
    { key: 'helpdesk_tickets', label: 'Ticket de la mesa de ayuda', table: 'helpdesk_tickets', column: 'record_id', conflict: () => sql`TRUE` },
    { key: 'helpdesk_messages', label: 'Correos de la mesa de ayuda', table: 'helpdesk_messages', column: 'record_id' },
    { key: 'sms_messages', label: 'SMS enviados', table: 'sms_messages', column: 'record_id' },
    { key: 'whatsapp_contacts', label: 'Contacto de WhatsApp', table: 'whatsapp_contacts', column: 'last_outbound_record_id', hidden: true },
    { key: 'data_consents', label: 'Autorizaciones de datos', table: 'data_consents', column: 'record_id' },
    { key: 'mentions', label: 'Menciones', table: 'mentions', column: 'record_id', hidden: true },
    { key: 'notifications', label: 'Avisos', table: 'notifications', column: 'record_id', hidden: true },
    // Vínculos: los salientes y los entrantes, sin crear un vínculo del que
    // queda consigo mismo (el que unía a los dos se queda con el que se va).
    {
        key: 'relations_out',
        label: 'Vínculos con otros registros',
        table: 'relations',
        column: 'source_record_id',
        extra: (p) => sql`t.target_record_id <> ${p}`,
        conflict: () => same('tenant_id', 'field_id', 'target_record_id'),
    },
    {
        key: 'relations_in',
        label: 'Registros que lo vinculan',
        table: 'relations',
        column: 'target_record_id',
        extra: (p) => sql`t.source_record_id <> ${p}`,
        conflict: () => same('tenant_id', 'field_id', 'source_record_id'),
    },
    // Subtareas vivas (las que estaban en la papelera se quedan con su padre).
    { key: 'subtasks', label: 'Subtareas', table: 'records', column: 'parent_id', extra: () => sql`t.deleted_at IS NULL` },
];

/** Dependencias (se mueven aparte: sin crear un círculo). Seguir y dejar de seguir (sin id: se copian). */
export const SPECIAL_MOVES = [
    { key: 'dependencies', label: 'Dependencias', table: 'record_dependencies', columns: ['blocker_record_id', 'blocked_record_id'] },
    { key: 'follows', label: 'Personas que lo siguen', table: 'record_follows', columns: ['record_id'] },
] as const;

/** Historia del registro que se va: se queda con él (en la papelera). */
export const LEFT_BEHIND: ReadonlyArray<readonly [string, string]> = [
    ['activity', 'record_id'],
    ['automation_runs', 'record_id'],
    ['webhook_deliveries', 'record_id'],
    ['bulk_edit_items', 'record_id'],
    ['gantt_baseline_items', 'record_id'],
    ['approval_requests', 'record_id'],
    ['ai_agent_runs', 'record_id'],
    ['ai_agent_proposals', 'record_id'],
    ['record_duplicate_dismissals', 'record_low'],
    ['record_duplicate_dismissals', 'record_high'],
    // Listas espejo (tienda, sitio): no se fusionan (la fuente manda).
    ['sync_links', 'record_id'],
];

/** El registro ES otra cosa: no se fusiona (se dice por qué). */
export const BLOCKING: ReadonlyArray<{ table: string; column: string; message: string; tenantColumn?: string }> = [
    { table: 'booking_appointments', column: 'record_id', message: 'es una cita de la agenda' },
    { table: 'shop_orders', column: 'record_id', message: 'es un pedido de la tienda' },
    // I3 — el registro de una empresa cliente en la lista «Empresas cliente» de
    // su agencia: cada uno ES una empresa (la fila de `tenants` es del cliente;
    // la lista, de la agencia).
    { table: 'tenants', column: 'agency_record_id', tenantColumn: 'agency_id', message: 'es una empresa cliente de la agencia' },
];

/** Cuántas filas movería cada paso (para la vista previa). */
export async function countMoves(tx: Tx, tenantId: number, primary: number, dup: number): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const step of MOVE_STEPS) {
        const res = await tx.execute(sql`
            SELECT count(*)::int AS n FROM ${sql.identifier(step.table)} t
            WHERE t.tenant_id = ${tenantId} AND t.${sql.identifier(step.column)} = ${dup}
            ${step.extra ? sql`AND ${step.extra(primary)}` : sql``}
            ${conflictGuard(step, primary)}`);
        const n = Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0);
        if (n > 0) out.set(step.key, n);
    }
    const deps = await tx.execute(sql`
        SELECT count(*)::int AS n FROM record_dependencies
        WHERE tenant_id = ${tenantId} AND (blocker_record_id = ${dup} OR blocked_record_id = ${dup})
          AND blocker_record_id <> ${primary} AND blocked_record_id <> ${primary}`);
    const nd = Number((deps.rows[0] as { n?: number } | undefined)?.n ?? 0);
    if (nd > 0) out.set('dependencies', nd);
    const follows = await tx.execute(sql`
        SELECT count(*)::int AS n FROM record_follows f
        WHERE f.tenant_id = ${tenantId} AND f.record_id = ${dup}
          AND NOT EXISTS (SELECT 1 FROM record_follows g WHERE g.tenant_id = f.tenant_id AND g.user_id = f.user_id AND g.record_id = ${primary})`);
    const nf = Number((follows.rows[0] as { n?: number } | undefined)?.n ?? 0);
    if (nf > 0) out.set('follows', nf);
    return out;
}

function conflictGuard(step: MoveStep, primary: number): SQL {
    if (!step.conflict) return sql``;
    return sql`AND NOT EXISTS (
        SELECT 1 FROM ${sql.identifier(step.table)} x
        WHERE x.tenant_id = t.tenant_id AND x.${sql.identifier(step.column)} = ${primary} AND ${step.conflict(primary)})`;
}

/** Lo que se movió de UN registro (por paso: los ids de las filas), para deshacer. */
export interface MovedRows {
    steps: Record<string, number[]>;
    /** Personas que pasaron a seguir al que queda (no lo seguían). */
    follows: number[];
    /** Dependencias: id de la fila → la columna que se cambió. */
    dependencies: Array<{ id: number; column: 'blocker_record_id' | 'blocked_record_id' }>;
    /** Dependencias que NO se movieron porque formaban un círculo. */
    skipped_cycles: number;
}

/**
 * Mueve todo lo de `dup` a `primary` (dentro del tx de la fusión). Un
 * duplicado por vez: así el `NOT EXISTS` ve lo que ya movió el anterior y dos
 * duplicados que compartían algo único no chocan entre sí.
 */
export async function moveRows(
    tx: Tx,
    tenantId: number,
    primary: number,
    dup: number,
    graph: Map<number, Set<number>>,
): Promise<MovedRows> {
    const moved: MovedRows = { steps: {}, follows: [], dependencies: [], skipped_cycles: 0 };
    for (const step of MOVE_STEPS) {
        const res = await tx.execute(sql`
            UPDATE ${sql.identifier(step.table)} AS t SET ${sql.identifier(step.column)} = ${primary}
            WHERE t.tenant_id = ${tenantId} AND t.${sql.identifier(step.column)} = ${dup}
            ${step.extra ? sql`AND ${step.extra(primary)}` : sql``}
            ${conflictGuard(step, primary)}
            RETURNING t.id`);
        const ids = (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
        if (ids.length > 0) moved.steps[step.key] = ids;
    }
    // Seguir: sin id propio; se copia a quien todavía no seguía al que queda.
    const fol = await tx.execute(sql`
        INSERT INTO record_follows (tenant_id, user_id, list_id, record_id)
        SELECT f.tenant_id, f.user_id, f.list_id, ${primary} FROM record_follows f
        WHERE f.tenant_id = ${tenantId} AND f.record_id = ${dup}
        ON CONFLICT DO NOTHING
        RETURNING user_id`);
    moved.follows = (fol.rows as Array<{ user_id: number | string }>).map((r) => Number(r.user_id));
    // Dependencias: una por una, sin crear un círculo (A bloquea a B y B a A).
    const deps = await tx.execute(sql`
        SELECT id, blocker_record_id AS blocker, blocked_record_id AS blocked FROM record_dependencies
        WHERE tenant_id = ${tenantId} AND (blocker_record_id = ${dup} OR blocked_record_id = ${dup})
        ORDER BY id`);
    for (const row of deps.rows as Array<{ id: number | string; blocker: number | string; blocked: number | string }>) {
        const id = Number(row.id);
        const blocker = Number(row.blocker) === dup ? primary : Number(row.blocker);
        const blocked = Number(row.blocked) === dup ? primary : Number(row.blocked);
        if (blocker === blocked) {
            // Uno bloqueaba al otro: fusionados, se bloquearía a sí mismo.
            moved.skipped_cycles++;
            continue;
        }
        const exists = graph.get(blocker)?.has(blocked) ?? false;
        if (exists || reaches(graph, blocked, blocker)) {
            if (!exists) moved.skipped_cycles++;
            continue;
        }
        const column = Number(row.blocker) === dup ? 'blocker_record_id' : 'blocked_record_id';
        await tx.execute(sql`UPDATE record_dependencies SET ${sql.identifier(column)} = ${primary} WHERE id = ${id}`);
        graph.get(Number(row.blocker))?.delete(Number(row.blocked));
        if (!graph.has(blocker)) graph.set(blocker, new Set());
        graph.get(blocker)!.add(blocked);
        moved.dependencies.push({ id, column });
    }
    return moved;
}

function reaches(graph: Map<number, Set<number>>, from: number, to: number): boolean {
    const seen = new Set<number>();
    const stack = [from];
    while (stack.length > 0) {
        const n = stack.pop()!;
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const next of graph.get(n) ?? []) stack.push(next);
    }
    return false;
}

/** Deshacer: lo que se movió vuelve al registro de antes (sólo si sigue en el que quedó). */
export async function moveRowsBack(tx: Tx, tenantId: number, primary: number, dup: number, moved: MovedRows): Promise<void> {
    for (const step of MOVE_STEPS) {
        const ids = moved.steps[step.key];
        if (!ids || ids.length === 0) continue;
        await tx.execute(sql`
            UPDATE ${sql.identifier(step.table)} SET ${sql.identifier(step.column)} = ${dup}
            WHERE tenant_id = ${tenantId} AND ${sql.identifier(step.column)} = ${primary}
              AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    }
    if (moved.follows.length > 0) {
        await tx.execute(sql`
            DELETE FROM record_follows WHERE tenant_id = ${tenantId} AND record_id = ${primary}
              AND user_id IN (${sql.join(moved.follows.map((i) => sql`${i}`), sql`, `)})`);
    }
    for (const d of moved.dependencies) {
        await tx.execute(sql`
            UPDATE record_dependencies SET ${sql.identifier(d.column)} = ${dup}
            WHERE tenant_id = ${tenantId} AND id = ${d.id} AND ${sql.identifier(d.column)} = ${primary}`);
    }
}

/** Grafo de dependencias de la lista (bloqueante → bloqueados). */
export async function dependencyGraph(tx: Tx, tenantId: number, ids: number[]): Promise<Map<number, Set<number>>> {
    const graph = new Map<number, Set<number>>();
    if (ids.length === 0) return graph;
    const res = await tx.execute(sql`
        SELECT d.blocker_record_id AS blocker, d.blocked_record_id AS blocked FROM record_dependencies d
        WHERE d.tenant_id = ${tenantId}
          AND d.blocker_list_id IN (SELECT list_id FROM records WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`);
    for (const r of res.rows as Array<{ blocker: number | string; blocked: number | string }>) {
        const a = Number(r.blocker);
        if (!graph.has(a)) graph.set(a, new Set());
        graph.get(a)!.add(Number(r.blocked));
    }
    return graph;
}

/** Por qué estos registros no se pueden fusionar (citas, pedidos, dos suscripciones activas). */
export async function mergeBlockers(tx: Tx, tenantId: number, primary: number, dups: number[], titleOf: (id: number) => string): Promise<string[]> {
    const out: string[] = [];
    for (const b of BLOCKING) {
        for (const d of dups) {
            const res = await tx.execute(sql`SELECT 1 FROM ${sql.identifier(b.table)} WHERE ${sql.identifier(b.tenantColumn ?? 'tenant_id')} = ${tenantId} AND ${sql.identifier(b.column)} = ${d} LIMIT 1`);
            if (res.rows.length > 0) out.push(`«${titleOf(d)}» ${b.message}: no se fusiona.`);
        }
    }
    const live = await tx.execute(sql`
        SELECT record_id FROM subscriptions
        WHERE tenant_id = ${tenantId} AND status NOT IN ('cancelled', 'finished')
          AND record_id IN (${sql.join([primary, ...dups].map((i) => sql`${i}`), sql`, `)})`);
    const withLive = new Set((live.rows as Array<{ record_id: number | string }>).map((r) => Number(r.record_id)));
    if (withLive.size > 1) {
        out.push('Hay más de una suscripción activa entre estos registros: cancela las que sobran antes de fusionarlos (un registro tiene una sola).');
    }
    return out;
}
