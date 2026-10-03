import { useState } from 'react';
import { PAYMENT_STATUS_OPTIONS, type PaymentLinkStatus } from '@imagina-base/shared';
import { Check, Copy } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * Piezas chicas de los cobros (v0.1.251): el chip de estado —el MISMO color
 * que la opción de la columna «Estado del pago»—, el monto con su moneda y el
 * botón de copiar el link.
 */

export function PaymentStatusChip({ status, className }: { status: PaymentLinkStatus; className?: string }): JSX.Element {
    const opt = PAYMENT_STATUS_OPTIONS[status];
    return (
        <span
            data-testid="imcrm-payment-status"
            data-status={status}
            className={cn(
                'imcrm-inline-flex imcrm-items-center imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-semibold imcrm-text-white',
                className,
            )}
            style={{ backgroundColor: opt.color }}
        >
            {opt.label}
        </span>
    );
}

/** «$150.000 COP» con los separadores de la empresa; pesos sin decimales. */
export function formatMoney(amount: number, currency: string): string {
    const noCents = ['COP', 'CLP', 'PYG'].includes(currency.toUpperCase());
    const n = formatNumber(amount, { minFrac: noCents ? 0 : 2, maxFrac: noCents ? 0 : 2 });
    return `$${n} ${currency.toUpperCase()}`;
}

export function CopyButton({ value, label, testId }: { value: string; label?: string; testId?: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            data-testid={testId}
            onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                });
            }}
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
            title={__('Copiar')}
        >
            {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-emerald-600" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
            {label && <span>{copied ? __('¡Copiado!') : label}</span>}
        </button>
    );
}
