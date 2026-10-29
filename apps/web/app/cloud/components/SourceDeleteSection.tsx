import { Link } from 'react-router';
import { Archive, Trash2 } from 'lucide-react';
import type { SourceDeleteMode, SourceGoneCount } from '@imagina-base/shared';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * v0.1.336 — Qué pasa en la app cuando algo se borra en la fuente (WordPress o
 * la tienda): queda marcado «Papelera» (lo de siempre) o se quita solo de la
 * app. Lo usan el alta (sólo la elección) y la página de la sincronización
 * (la elección y lo que ya está marcado, lista por lista).
 */
export function SourceDeleteChoice({
    value,
    onChange,
    source,
    disabled,
}: {
    value: SourceDeleteMode;
    onChange: (v: SourceDeleteMode) => void;
    /** «WordPress» / «WooCommerce». */
    source: string;
    disabled?: boolean;
}): JSX.Element {
    const options: Array<{ value: SourceDeleteMode; icon: typeof Archive; title: string; help: string }> = [
        {
            value: 'keep',
            icon: Archive,
            title: __('Conservarlo marcado'),
            help: __('Queda en la lista con el estado «Papelera», con todos sus datos. Puedes quitarlo cuando quieras.'),
        },
        {
            value: 'remove',
            icon: Trash2,
            title: __('Quitarlo de la app'),
            help: sprintf(
                __('Sale de la lista solo: va a la papelera de la app 30 días (por si te arrepientes) y deja de contar para tu plan. Si vuelve a aparecer en %s, vuelve solo.'),
                source,
            ),
        },
    ];
    return (
        <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2" role="radiogroup" aria-label={sprintf(__('Cuando algo se borra en %s'), source)}>
            {options.map((o) => {
                const active = value === o.value;
                const Icon = o.icon;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={disabled}
                        onClick={() => onChange(o.value)}
                        className={cn(
                            'imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors disabled:imcrm-opacity-60',
                            active ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent/50',
                        )}
                        data-testid={`imcrm-source-delete-${o.value}`}
                    >
                        <Icon className={cn('imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0', active ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')} aria-hidden />
                        <span>
                            <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{o.title}</span>
                            <span className="imcrm-mt-0.5 imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{o.help}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/** La sección de la página de la sincronización: la elección y lo que ya está marcado. */
export function SourceDeleteSection({
    value,
    gone,
    source,
    busy,
    onChange,
}: {
    value: SourceDeleteMode;
    gone: SourceGoneCount[];
    source: string;
    busy: boolean;
    onChange: (v: SourceDeleteMode) => void;
}): JSX.Element {
    const confirm = useConfirm();
    const total = gone.reduce((n, g) => n + g.count, 0);
    const pick = async (v: SourceDeleteMode): Promise<void> => {
        if (v === value) return;
        if (v === 'remove' && total > 0) {
            const ok = await confirm({
                title: __('¿Quitar de la app lo que ya se borró?'),
                description: sprintf(
                    _n(
                        'Hay %1$s registro que ya se borró en %2$s: también se quita ahora (va a la papelera de la app 30 días). Lo que se borre de aquí en adelante sale solo.',
                        'Hay %1$s registros que ya se borraron en %2$s: también se quitan ahora (van a la papelera de la app 30 días). Lo que se borre de aquí en adelante sale solo.',
                        total,
                    ),
                    formatNumber(total),
                    source,
                ),
                confirmLabel: __('Quitarlos de la app'),
                destructive: true,
            });
            if (!ok) return;
        }
        onChange(v);
    };
    return (
        <section className="imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="imcrm-source-delete-section" data-tour="sync-source-delete">
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">{sprintf(__('Lo que se borra en %s'), source)}</h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {sprintf(
                        __('Cuando algo se borra en %s (o se manda a su papelera), la app se entera sola. Elige qué hacer con su registro aquí.'),
                        source,
                    )}
                </p>
            </div>
            <SourceDeleteChoice value={value} onChange={(v) => void pick(v)} source={source} disabled={busy} />
            {gone.length > 0 && value === 'keep' && (
                <div className="imcrm-space-y-1.5 imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2 imcrm-text-sm" data-testid="imcrm-source-gone-list">
                    <p className="imcrm-text-muted-foreground">
                        {sprintf(
                            _n('%1$s registro ya se borró en %2$s y sigue en la app:', '%1$s registros ya se borraron en %2$s y siguen en la app:', total),
                            formatNumber(total),
                            source,
                        )}
                    </p>
                    <ul className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1">
                        {gone.map((g) => (
                            <li key={g.list.id}>
                                <Link to={`/lists/${g.list.slug}/records`} className="imcrm-text-primary hover:imcrm-underline">
                                    {sprintf(__('%1$s en «%2$s»'), formatNumber(g.count), g.list.name)}
                                </Link>
                            </li>
                        ))}
                    </ul>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('En cada lista puedes quitarlos de una vez, o uno por uno desde su menú.')}</p>
                </div>
            )}
        </section>
    );
}
