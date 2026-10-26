import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { approvalFlows } from '../db/schema';

/**
 * C5 — Los flujos de aprobación que referencia una automatización: el del
 * disparador «Cuando se aprueba o se rechaza» y los de «Pedir aprobación» /
 * «Esperar aprobación» (también en ramas y bucles). Puro: lo usan el guardado
 * de automatizaciones, el borrado de un flujo y el asistente.
 */
export function approvalFlowRefs(input: { trigger_type?: string; trigger_config?: Record<string, unknown> | null; actions?: unknown }): number[] {
    const out = new Set<number>();
    const add = (raw: unknown): void => {
        const n = Number(raw);
        if (Number.isInteger(n) && n > 0) out.add(n);
    };
    if (input.trigger_type === 'approval_resolved') add(input.trigger_config?.approval_flow_id);
    const walk = (actions: unknown, depth: number): void => {
        if (!Array.isArray(actions) || depth > 8) return;
        for (const a of actions) {
            if (!a || typeof a !== 'object') continue;
            const spec = a as { type?: unknown; config?: Record<string, unknown> };
            const cfg = spec.config ?? {};
            if (spec.type === 'request_approval' || spec.type === 'wait_approval') add(cfg.approval_flow_id);
            walk(cfg.then_actions, depth + 1);
            walk(cfg.else_actions, depth + 1);
            walk(cfg.actions, depth + 1);
        }
    };
    walk(input.actions, 0);
    return [...out];
}

/**
 * Cada flujo referenciado tiene que existir y ser de ESTA lista (400 legible
 * si no): un id de otra lista o de otra empresa no se guarda.
 */
export async function assertApprovalFlowRefs(
    tx: Tx,
    tenantId: number,
    listId: number,
    input: Parameters<typeof approvalFlowRefs>[0],
): Promise<void> {
    const refs = approvalFlowRefs(input);
    if (refs.length === 0) return;
    const rows = await tx
        .select({ id: approvalFlows.id, listId: approvalFlows.listId })
        .from(approvalFlows)
        .where(and(eq(approvalFlows.tenantId, tenantId), inArray(approvalFlows.id, refs)));
    const ok = new Set(rows.filter((r) => r.listId === listId).map((r) => r.id));
    const bad = refs.filter((id) => !ok.has(id));
    if (bad.length > 0) {
        throw new BadRequestException({
            code: 'invalid_approval_flow_ref',
            message: `El flujo de aprobación elegido no existe en esta lista (#${bad.join(', #')}): elige otro en el editor.`,
            data: { status: 400, errors: { approval_flow_id: 'No es de esta lista' } },
        });
    }
}

/**
 * Copia de un jsonb SIN los flujos de aprobación (`approval_flow_id: null`).
 * Las plantillas y «Duplicar lista» no llevan los flujos (son configuración
 * de ESA lista: aprobadores, pasos): un campo «Aprobación» de la copia muestra
 * la última solicitud de cualquier flujo, el disparador vale para cualquiera y
 * «Pedir aprobación» queda sin flujo (la automatización llega pausada, con el
 * aviso de que falta elegirlo).
 */
export function withoutApprovalFlowRefs<T>(value: T): T {
    const walk = (v: unknown, depth: number): unknown => {
        if (depth > 12) return v;
        if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
        if (v === null || typeof v !== 'object') return v;
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
            out[k] = k === 'approval_flow_id' ? null : walk(x, depth + 1);
        }
        return out;
    };
    return walk(value, 0) as T;
}
