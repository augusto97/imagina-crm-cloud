import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useSourceGoneCount } from '@/hooks/useSourceGone';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';

import { mirrorSourceOf, type StoreRules } from './storeRules';

/**
 * v0.1.336 — Aviso de una lista de la tienda o del sitio: «N ya se borraron en
 * WordPress · Quitarlos de la app». Lo que la fuente borró deja de estorbar sin
 * perderse: va a la papelera de la app 30 días y deja de contar para el plan.
 */
export function SourceGoneBar({
    listId,
    rules,
    canRemoveAll,
    onRemove,
}: {
    listId: number;
    rules: StoreRules;
    /** Puede quitarlos de una vez (acciones masivas); si no, uno por uno desde su menú. */
    canRemoveAll: boolean;
    onRemove: () => void;
}): JSX.Element | null {
    const gone = useSourceGoneCount(listId, true);
    const n = gone.data ?? 0;
    if (n === 0) return null;
    const source = mirrorSourceOf(rules) ?? '';
    return (
        <div
            className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-1.5 imcrm-text-[13px]"
            data-testid="imcrm-source-gone-bar"
            data-tour="list-source-gone"
        >
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-start imcrm-gap-2">
                <Trash2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-min-w-0">
                {sprintf(
                    _n('%1$s registro ya se borró en %2$s.', '%1$s registros ya se borraron en %2$s.', n),
                    formatNumber(n),
                    source,
                )}{' '}
                <span className="imcrm-text-muted-foreground">
                    {canRemoveAll
                        ? __('Si ya no te sirven, quítalos de la app: van a su papelera 30 días y dejan de contar para tu plan.')
                        : __('Puedes quitarlos uno por uno desde su menú («Quitar de la app»).')}
                </span>
                </span>
            </span>
            {canRemoveAll && (
                <Button size="sm" variant="outline" className="imcrm-ml-auto imcrm-h-7" onClick={onRemove} data-testid="imcrm-source-gone-remove">
                    {__('Quitarlos de la app')}
                </Button>
            )}
        </div>
    );
}
