import {
    APPROVAL_DECISION_LABELS,
    APPROVAL_STATUS_LABELS,
    type ApprovalDecisionKind,
    type ApprovalRequestDto,
    type ApprovalStatus,
} from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';

/**
 * C5 — Piezas puras de la interfaz de aprobaciones (la ficha, «Mi trabajo»
 * y la pantalla de confirmación del correo las comparten).
 */

/** «Paso 1 de 2 · Jefe directo» (o «Aprobada», «Rechazada»… si ya se resolvió). */
export function approvalProgressLabel(req: Pick<ApprovalRequestDto, 'status' | 'current_step' | 'steps'>): string {
    if (req.status !== 'pending') return APPROVAL_STATUS_LABELS[req.status];
    const total = req.steps.length;
    const step = req.steps[req.current_step];
    const base = total > 1 ? sprintf(__('Paso %1$d de %2$d'), req.current_step + 1, total) : __('Esperando la decisión');
    return step && step.name.trim() !== '' && total > 1 ? `${base} · ${step.name}` : base;
}

/** Quiénes faltan por aprobar en el paso actual (modo «todos»). */
export function missingApprovers(req: Pick<ApprovalRequestDto, 'status' | 'current_step' | 'steps'>): string[] {
    if (req.status !== 'pending') return [];
    const step = req.steps[req.current_step];
    if (!step || step.mode !== 'all') return [];
    return step.approvers.filter((a) => !a.approved).map((a) => a.name);
}

/** Rechazar y devolver piden motivo (se le muestra a quien pidió). */
export function decisionNeedsReason(decision: ApprovalDecisionKind): boolean {
    return decision !== 'approve';
}

/** El verbo de una decisión en el historial («Aprobó», «Rechazó», «Devolvió»). */
export function decisionVerb(decision: ApprovalDecisionKind): string {
    return APPROVAL_DECISION_LABELS[decision];
}

/** Las abiertas primero (pendiente y devuelta), después de la más nueva a la más vieja. */
export function sortRequests<T extends Pick<ApprovalRequestDto, 'status' | 'id'>>(rows: readonly T[]): T[] {
    const rank = (s: ApprovalStatus): number => (s === 'pending' ? 0 : s === 'returned' ? 1 : 2);
    return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || b.id - a.id);
}

/** El texto del botón que confirma la decisión elegida. */
export function confirmLabel(decision: ApprovalDecisionKind): string {
    switch (decision) {
        case 'approve':
            return __('Aprobar');
        case 'reject':
            return __('Rechazar');
        case 'return':
            return __('Devolver para corregir');
    }
}

/** Lee `?d=approve|reject|return` del enlace del correo (cualquier otra cosa: nada). */
export function decisionFromQuery(raw: string | null | undefined): ApprovalDecisionKind | null {
    return raw === 'approve' || raw === 'reject' || raw === 'return' ? raw : null;
}
