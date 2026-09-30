import { useState } from 'react';
import { Copy, CornerDownRight, History, Loader2, Store, Trash2, Undo2, Wand2 } from 'lucide-react';
import type { BulkEditLog } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBulkHistory } from '@/hooks/useBulkHistory';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';

import { BulkRevertDialog } from './BulkRevertDialog';

interface BulkHistorySheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
}

/**
 * Historial de ediciones masivas de la lista (v0.1.218): quién cambió qué en
 * lote y cuándo, con «Deshacer» en cada una. Se conservan 30 días.
 */
export function BulkHistorySheet({ open, onOpenChange, listId }: BulkHistorySheetProps): JSX.Element {
    const history = useBulkHistory(listId, open);
    const [reverting, setReverting] = useState<BulkEditLog | null>(null);

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent data-testid="imcrm-bulk-history">
                    <SheetHeader>
                        <div className="imcrm-min-w-0">
                            <SheetTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <History className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                                {__('Ediciones masivas')}
                            </SheetTitle>
                            <SheetDescription>{__('Lo que se cambió en lote en esta lista en los últimos 30 días. Cualquiera se puede deshacer.')}</SheetDescription>
                        </div>
                        <SheetCloseButton />
                    </SheetHeader>
                    <SheetBody>
                        {history.isLoading && (
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                {__('Cargando…')}
                            </div>
                        )}
                        {history.data && history.data.length === 0 && (
                            <p className="imcrm-py-8 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Todavía no hubo ediciones masivas en esta lista.')}
                            </p>
                        )}
                        <ul className="imcrm-space-y-2.5">
                            {history.data?.map((e) => (
                                <li key={e.id} className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid="imcrm-bulk-history-item">
                                    <div className="imcrm-flex imcrm-items-start imcrm-gap-2.5">
                                        <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground">
                                            <KindIcon kind={e.kind} />
                                        </span>
                                        <div className="imcrm-min-w-0 imcrm-flex-1">
                                            <p className="imcrm-text-sm imcrm-font-medium imcrm-leading-snug">{e.summary}</p>
                                            <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                                {[
                                                    e.user_name ?? (e.user_id === null && e.summary.startsWith('Automatización «') ? __('Automatización') : __('Alguien')),
                                                    formatDateTimeStr(e.created_at),
                                                    e.kind === 'store'
                                                        ? sprintf(
                                                              _n('%s producto o variación en la tienda', '%s productos y variaciones en la tienda', e.item_count),
                                                              formatNumber(e.item_count),
                                                          )
                                                        : sprintf(_n('%s registro', '%s registros', e.item_count), formatNumber(e.item_count)),
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </p>
                                            {e.reverted_count > 0 && (
                                                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                                                    {e.reverted_count >= e.item_count
                                                        ? __('Deshecha')
                                                        : sprintf(__('Deshecha en parte (%1$s de %2$s)'), formatNumber(e.reverted_count), formatNumber(e.item_count))}
                                                </p>
                                            )}
                                        </div>
                                        {e.can_revert && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="imcrm-shrink-0"
                                                onClick={() => setReverting(e)}
                                                data-testid="imcrm-bulk-history-undo"
                                            >
                                                <Undo2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Deshacer')}
                                            </Button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </SheetBody>
                </SheetContent>
            </Sheet>
            {reverting && (
                <BulkRevertDialog
                    open
                    onOpenChange={(o) => {
                        if (!o) setReverting(null);
                    }}
                    listId={listId}
                    editId={reverting.id}
                    summary={reverting.summary}
                />
            )}
        </>
    );
}

/** Icono por tipo de edición (v0.1.220 suma mover, duplicar y borrar). */
function KindIcon({ kind }: { kind: BulkEditLog['kind'] }): JSX.Element {
    const Icon = kind === 'store' ? Store : kind === 'move' ? CornerDownRight : kind === 'duplicate' ? Copy : kind === 'delete' ? Trash2 : Wand2;
    return <Icon className="imcrm-h-3.5 imcrm-w-3.5" />;
}
