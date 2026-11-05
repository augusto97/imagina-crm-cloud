import {
    SUBSCRIPTION_FIELD_ROLES,
    SUBSCRIPTION_STATUS_OPTIONS,
    suggestSubscriptionFields,
    type Subscription,
    type SubscriptionFieldRole,
    type SubscriptionFields,
    type SubscriptionFrequencyType,
    type SubscriptionStatus,
} from '@imagina-base/shared';

/**
 * v0.1.367 (ADR-S96) — Textos de las suscripciones (puros: los usan el panel
 * de la ficha, la página de la conexión y los tests).
 */

export type SubChoice = number | 'create' | null;

export interface SubFieldLike {
    id: number;
    label: string;
    type: string;
    config?: unknown;
}

/** «cada mes», «cada 3 meses», «cada 15 días». */
export function frequencyText(frequency: number, type: SubscriptionFrequencyType): string {
    const n = Math.max(1, Math.floor(frequency));
    if (type === 'days') return n === 1 ? 'cada día' : `cada ${n} días`;
    if (n === 1) return 'cada mes';
    if (n === 12) return 'cada año';
    return `cada ${n} meses`;
}

/** «12 cuotas» / «sin fin». */
export function cyclesText(cycles: number | null): string {
    if (cycles === null || cycles <= 0) return 'hasta que se cancele';
    return cycles === 1 ? '1 cuota' : `${cycles} cuotas`;
}

/** La etiqueta y el color del estado (los MISMOS de la columna «Estado de la suscripción»). */
export function statusOption(status: SubscriptionStatus): { label: string; color: string } {
    return SUBSCRIPTION_STATUS_OPTIONS[status] ?? { label: String(status), color: '#64748b' };
}

/** Una frase de qué pasa ahora con la suscripción. */
export function statusSentence(sub: Pick<Subscription, 'status' | 'last_failure_reason' | 'consecutive_failed' | 'cancel_reason'>): string {
    switch (sub.status) {
        case 'pending':
            return 'Esperando que el cliente autorice su tarjeta con el link.';
        case 'active':
            return 'Al día: el período actual está pagado.';
        case 'retrying':
            return `Falló el último cobro${sub.last_failure_reason ? ` (${sub.last_failure_reason})` : ''}: Mercado Pago lo vuelve a intentar en los próximos días.`;
        case 'past_due':
            return `En mora: ${sub.consecutive_failed > 1 ? `${sub.consecutive_failed} cuotas rechazadas` : 'se agotaron los reintentos'}. Sigue en los días de gracia.`;
        case 'expired':
            return 'Vencida: pasaron los días de gracia sin pago. Es momento de suspender el servicio.';
        case 'paused':
            return 'Pausada: no se cobra hasta reanudarla.';
        case 'cancelled':
            return `Cancelada${sub.cancel_reason ? `: ${sub.cancel_reason}` : '.'}`;
        case 'finished':
            return 'Terminada: se cobraron todas las cuotas.';
        default:
            return '';
    }
}

/** Para qué sirve cada columna, en una línea. */
export const SUB_ROLE_HINTS: Record<SubscriptionFieldRole, string> = {
    status: 'Al día, Reintentando, En mora, Vencida… se actualiza solo.',
    plan: 'El nombre del plan.',
    amount: 'Cuánto se cobra cada período.',
    next_charge: 'Cuándo toca el próximo cobro.',
    paid_until: 'Hasta cuándo está pagado el servicio.',
    failed: 'Cuántas cuotas seguidas se rechazaron.',
    link: 'El link para que el cliente autorice su tarjeta.',
};

/**
 * Lo que se propone cuando la lista todavía no eligió columnas: las que YA
 * tiene y sirven y, para el estado, el próximo cobro, el «pagado hasta» y el
 * link, columnas nuevas (es lo mínimo para filtrar quién debe).
 */
export function proposeSubscriptionChoices(fields: SubFieldLike[], current: SubscriptionFields | null): Record<SubscriptionFieldRole, SubChoice> {
    const out = {} as Record<SubscriptionFieldRole, SubChoice>;
    if (current) {
        const alive = new Set(fields.map((f) => f.id));
        for (const role of SUBSCRIPTION_FIELD_ROLES) out[role] = current[role] !== null && alive.has(current[role]!) ? current[role] : null;
        return out;
    }
    const suggested = suggestSubscriptionFields(fields, null);
    const createByDefault: readonly SubscriptionFieldRole[] = ['status', 'next_charge', 'paid_until', 'link'];
    for (const role of SUBSCRIPTION_FIELD_ROLES) {
        if (suggested[role] !== null) out[role] = suggested[role];
        else out[role] = createByDefault.includes(role) ? 'create' : null;
    }
    return out;
}
