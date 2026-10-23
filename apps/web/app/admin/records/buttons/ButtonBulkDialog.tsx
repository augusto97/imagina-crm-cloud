import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, Loader2, MousePointerClick, X } from 'lucide-react';
import { BUTTON_BULK_MAX, buttonLabel, readButtonConfig, type PressButtonBulkResult } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { pressButtonBulk, refreshAfterPress, useButtonQueryClient } from '@/hooks/useButtons';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

type Row = PressButtonBulkResult['results'][number];

/**
 * Presionar un botón sobre la selección de la tabla. Se manda en tandas de
 * `BUTTON_BULK_MAX` (el servidor re-chequea cada registro: rol, «deshabilitado
 * si…», poder editarlo) y cada fila vuelve con su resultado. Sólo se ofrece
 * para botones que no abren un enlace ni descargan un PDF: eso es de a uno.
 */
export function ButtonBulkDialog({
    listId,
    field,
    ids,
    recordTitle,
    onClose,
}: {
    listId: number;
    field: FieldEntity;
    ids: number[];
    recordTitle: (id: number) => string;
    onClose: () => void;
}): JSX.Element {
    const config = readButtonConfig(field.config);
    const label = buttonLabel(config, field.label);
    const qc = useButtonQueryClient();
    const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm');
    const [done, setDone] = useState(0);
    const [rows, setRows] = useState<Row[]>([]);
    const [error, setError] = useState<string | null>(null);
    const stop = useRef(false);

    const run = async (): Promise<void> => {
        setPhase('running');
        setDone(0);
        setRows([]);
        setError(null);
        stop.current = false;
        const acc: Row[] = [];
        for (let i = 0; i < ids.length; i += BUTTON_BULK_MAX) {
            if (stop.current) break;
            const batch = ids.slice(i, i + BUTTON_BULK_MAX);
            try {
                const res = await pressButtonBulk(listId, field.id, batch);
                acc.push(...res.results);
            } catch (err) {
                setError(err instanceof Error ? err.message : __('No se pudo presionar el botón.'));
                break;
            }
            setDone(acc.length);
            setRows([...acc]);
        }
        refreshAfterPress(qc, listId, null);
        setPhase('done');
    };

    const ok = rows.filter((r) => r.ok).length;
    const failed = rows.filter((r) => !r.ok);
    const pct = ids.length > 0 ? Math.round((done / ids.length) * 100) : 0;
    const question = (config.confirm ?? '').trim();

    return (
        <Dialog.Root open onOpenChange={(o) => (!o && phase !== 'running' ? onClose() : undefined)}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-button-bulk-dialog"
                    onEscapeKeyDown={(e) => phase === 'running' && e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <MousePointerClick className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                {sprintf(__('Presionar «%s»'), label)}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {sprintf(_n('En %s registro seleccionado', 'En %s registros seleccionados', ids.length), formatNumber(ids.length))}
                            </Dialog.Description>
                        </div>
                        {phase !== 'running' && (
                            <Dialog.Close asChild>
                                <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </Dialog.Close>
                        )}
                    </div>

                    <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4 imcrm-text-sm">
                        {phase === 'confirm' && (
                            <>
                                {question !== '' && <p className="imcrm-font-medium">{question}</p>}
                                <p className="imcrm-text-muted-foreground">
                                    {__('Se presiona en cada registro, como si lo hicieras de a uno: los que no cumplan (deshabilitados, sin permiso) quedan sin cambios y se listan al final.')}
                                </p>
                            </>
                        )}
                        {phase !== 'confirm' && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" aria-live="polite">
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-text-xs imcrm-text-muted-foreground">
                                    <span>{sprintf(__('%1$s de %2$s'), formatNumber(done), formatNumber(ids.length))}</span>
                                    <span className="imcrm-tabular-nums">{pct}%</span>
                                </div>
                                <div className="imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                                    <div className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-all" style={{ width: `${pct}%` }} />
                                </div>
                            </div>
                        )}
                        {phase === 'done' && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-button-bulk-result">
                                {ok > 0 && (
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                                        <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                                        {sprintf(_n('Listo en %s registro', 'Listo en %s registros', ok), formatNumber(ok))}
                                    </p>
                                )}
                                {failed.length > 0 && (
                                    <>
                                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                            <AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                                            {sprintf(_n('%s registro no se pudo', '%s registros no se pudieron', failed.length), formatNumber(failed.length))}
                                        </p>
                                        <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border">
                                            {failed.map((r) => (
                                                <li key={r.id} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-px-3 imcrm-py-2">
                                                    <span className="imcrm-truncate imcrm-font-medium">{recordTitle(r.id)}</span>
                                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{r.message}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                                {rows.length < ids.length && !error && (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {sprintf(__('Se detuvo: %s registros quedaron sin presionar.'), formatNumber(ids.length - rows.length))}
                                    </p>
                                )}
                            </div>
                        )}
                        {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                    </div>

                    <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        {phase === 'confirm' && (
                            <>
                                <Button variant="ghost" onClick={onClose}>
                                    {__('Cancelar')}
                                </Button>
                                <Button onClick={() => void run()} data-testid="imcrm-button-bulk-run">
                                    {sprintf(_n('Presionar en %s registro', 'Presionar en %s registros', ids.length), formatNumber(ids.length))}
                                </Button>
                            </>
                        )}
                        {phase === 'running' && (
                            <Button variant="outline" onClick={() => (stop.current = true)}>
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden />
                                {__('Detener')}
                            </Button>
                        )}
                        {phase === 'done' && (
                            <Button onClick={onClose} data-testid="imcrm-button-bulk-close">
                                {__('Listo')}
                            </Button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
