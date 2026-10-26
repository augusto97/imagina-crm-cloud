import { stepLabel, type ApprovalStatus, type ApprovalStep } from '@imagina-base/shared';

/**
 * C5 — Textos de los avisos de aprobación. Puro (se testea sin base): el
 * título se arma AL CREAR el aviso, así si después se renombra el registro
 * el aviso sigue contando lo que pasó.
 */

const MAX_TITLE = 280;

function quote(title: string): string {
    const t = title.trim() || 'Sin título';
    return `«${t.length > 80 ? `${t.slice(0, 79)}…` : t}»`;
}

function cap(s: string): string {
    return s.length > MAX_TITLE ? `${s.slice(0, MAX_TITLE - 1)}…` : s;
}

/** «paso 1 de 2» (sólo si hay más de uno). */
function stepPart(stepIndex: number, steps: readonly Pick<ApprovalStep, 'name'>[]): string {
    if (steps.length <= 1) return '';
    const step = steps[stepIndex];
    const name = step ? stepLabel(step, stepIndex) : `Paso ${stepIndex + 1}`;
    const generic = name === `Paso ${stepIndex + 1}`;
    return generic ? `, paso ${stepIndex + 1} de ${steps.length}` : `, paso ${stepIndex + 1} de ${steps.length}: ${name}`;
}

/** Al aprobador: «Ana pidió tu aprobación: «Taxi» (Gastos, paso 1 de 2)». */
export function askTitle(o: {
    requesterName: string | null;
    recordTitle: string;
    flowName: string;
    stepIndex: number;
    steps: readonly Pick<ApprovalStep, 'name'>[];
}): string {
    const who = o.requesterName?.trim() ? `${o.requesterName.trim()} pidió tu aprobación` : 'Se pidió tu aprobación';
    return cap(`${who}: ${quote(o.recordTitle)} (${o.flowName}${stepPart(o.stepIndex, o.steps)})`);
}

/** A quien pidió: «Luis aprobó «Taxi» (Gastos)», «Marta te devolvió «Taxi» para corregir». */
export function resolvedTitle(o: {
    status: Exclude<ApprovalStatus, 'pending'>;
    deciderName: string | null;
    recordTitle: string;
    flowName: string;
}): string {
    const who = o.deciderName?.trim() || 'Alguien';
    const rec = quote(o.recordTitle);
    switch (o.status) {
        case 'approved':
            return cap(`${who} aprobó ${rec} (${o.flowName})`);
        case 'rejected':
            return cap(`${who} rechazó ${rec} (${o.flowName})`);
        case 'returned':
            return cap(`${who} te devolvió ${rec} para corregir (${o.flowName})`);
        case 'cancelled':
            return cap(`Se canceló la aprobación de ${rec} (${o.flowName})`);
    }
}

/** El mensaje que vuelve a quien decide. */
export function decisionMessage(o: {
    decision: 'approve' | 'reject' | 'return';
    stepIndex: number;
    stepsCount: number;
    outcome: 'advanced' | 'approved' | 'waiting' | 'rejected' | 'returned';
    waitingOn: number;
}): string {
    switch (o.outcome) {
        case 'approved':
            return o.stepsCount > 1 ? `Aprobaste el último paso: la solicitud quedó aprobada.` : 'Aprobaste: la solicitud quedó aprobada.';
        case 'advanced':
            return `Aprobaste el paso ${o.stepIndex + 1} de ${o.stepsCount}: pasó al siguiente.`;
        case 'waiting':
            return `Aprobaste. Falta${o.waitingOn === 1 ? '' : 'n'} ${o.waitingOn} ${o.waitingOn === 1 ? 'persona' : 'personas'} de este paso.`;
        case 'rejected':
            return 'Rechazaste la solicitud.';
        case 'returned':
            return 'Devolviste la solicitud a quien la pidió.';
    }
}
