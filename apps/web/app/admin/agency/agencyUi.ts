import { agencyPeriodText, type AgencyClient, type AgencyClientBilling, type AgencyClientPlan, type SubscriptionStatus } from '@imagina-base/shared';

import { formatMoney } from '@/cloud/components/payments/paymentUi';
import { formatDate } from '@/lib/tenantFormat';

import { __ } from '@/lib/i18n';

/** El estado de una empresa cliente en palabras (y su color). */
export function clientStateLabel(c: Pick<AgencyClient, 'access' | 'paused' | 'archived'>): { label: string; tone: 'ok' | 'warn' | 'bad' } {
    if (c.archived) return { label: __('Archivada'), tone: 'bad' };
    if (c.paused) return { label: __('Pausada por la agencia'), tone: 'warn' };
    if (c.access.state === 'locked') return { label: __('Bloqueada'), tone: 'bad' };
    if (c.access.state === 'read_only') {
        return {
            label:
                c.access.reason === 'agency'
                    ? __('Solo lectura (por tu agencia)')
                    : c.access.reason === 'agency_unpaid'
                      ? __('Solo lectura (sin pagar)')
                      : __('Solo lectura'),
            tone: 'warn',
        };
    }
    return { label: __('Activa'), tone: 'ok' };
}

/** «$150.000 COP cada mes». */
export function planPriceText(plan: Pick<AgencyClientPlan, 'price' | 'currency' | 'period_months'>): string {
    return `${formatMoney(plan.price, plan.currency)} ${__(agencyPeriodText(plan.period_months))}`;
}

/**
 * v0.1.451 — El cobro de un cliente en palabras: si está al día, por vencer,
 * en gracia o sin pagar (y su color). `null` sin plan.
 */
export function billingStateLabel(b: AgencyClientBilling): { label: string; detail: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
    const due = b.due_at ? formatDate(new Date(b.due_at)) : '';
    const cut = b.cut_at ? formatDate(new Date(b.cut_at)) : '';
    switch (b.state) {
        case 'none':
            return { label: __('Sin plan'), detail: __('No le cobras a esta empresa'), tone: 'muted' };
        case 'ok':
            return { label: __('Al día'), detail: due ? `${__('Pagado hasta el')} ${due}` : __('Sin fecha de vencimiento'), tone: 'ok' };
        case 'due_soon': {
            const d = b.days_left ?? 0;
            const when = d <= 0 ? __('vence hoy') : d === 1 ? __('vence mañana') : `${__('vence en')} ${d} ${__('días')}`;
            return { label: __('Por vencer'), detail: `${__('El pago')} ${when} (${due})`, tone: 'warn' };
        }
        case 'grace':
            return { label: __('Venció'), detail: `${__('Pasa a solo lectura el')} ${cut}`, tone: 'warn' };
        case 'unpaid':
            return { label: __('Sin pagar'), detail: `${__('En solo lectura desde el')} ${cut}`, tone: 'bad' };
    }
}

/**
 * v0.1.453 — El débito automático de un cliente en palabras (y su color).
 * `pending` = el cliente todavía no autorizó la tarjeta.
 */
export function debitStateLabel(status: SubscriptionStatus): { label: string; detail: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
    switch (status) {
        case 'pending':
            return { label: __('Débito por autorizar'), detail: __('Falta que autorice su tarjeta con el link.'), tone: 'warn' };
        case 'active':
            return { label: __('Débito automático'), detail: __('Se cobra solo cada período.'), tone: 'ok' };
        case 'retrying':
            return { label: __('Débito: reintentando'), detail: __('El último cobro no pasó: se vuelve a intentar.'), tone: 'warn' };
        case 'past_due':
            return { label: __('Débito en mora'), detail: __('Varios cobros no pasaron: hay que revisar su tarjeta.'), tone: 'bad' };
        case 'paused':
            return { label: __('Débito pausado'), detail: __('No se le está cobrando.'), tone: 'muted' };
        default:
            return { label: __('Sin débito'), detail: '', tone: 'muted' };
    }
}
