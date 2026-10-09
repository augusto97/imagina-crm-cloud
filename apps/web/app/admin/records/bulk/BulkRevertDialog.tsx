import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Undo2, X } from 'lucide-react';
import type { BulkRevertPreview, BulkRevertResult } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import type { BulkApplyProgress } from '@/hooks/useBulkEdit';
import { useBulkRevertApply, useBulkRevertPreview } from '@/hooks/useBulkHistory';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

interface BulkRevertDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    editId: number;
    /** El resumen de la edición («Precio: subir 10 %»), para que se sepa qué se deshace. */
    summary: string;
    onDone?: () => void;
}

type Phase = 'loading' | 'preview' | 'applying' | 'done' | 'error';

/**
 * Deshacer una edición masiva (v0.1.218). Primero la vista previa: cuántas
 * filas vuelven limpias, cuáles cambió alguien DESPUÉS (conflictos: sólo se
 * pisan si la persona lo marca) y un ejemplo de lo que vuelve. Después se
 * aplica en tandas con avance, igual que la edición.
 */
export function BulkRevertDialog({ open, onOpenChange, listId, editId, summary, onDone }: BulkRevertDialogProps): JSX.Element {
    const [phase, setPhase] = useState<Phase>('loading');
    const [preview, setPreview] = useState<BulkRevertPreview | null>(null);
    const [force, setForce] = useState(false);
    const [progress, setProgress] = useState<BulkApplyProgress | null>(null);
    const [result, setResult] = useState<BulkRevertResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const previewM = useBulkRevertPreview(listId);
    const applyM = useBulkRevertApply(listId);

    useEffect(() => {
        if (!open) return;
        setPhase('loading');
        setPreview(null);
        setForce(false);
        setProgress(null);
        setResult(null);
        setError(null);
        previewM
            .mutateAsync({ editId })
            .then((p) => {
                setPreview(p);
                setPhase('preview');
            })
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : __('Error desconocido'));
                setPhase('error');
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, editId]);

    const ids = preview ? (force ? [...preview.item_ids, ...preview.conflict_ids] : preview.item_ids) : [];

    const runApply = async (): Promise<void> => {
        if (!preview || ids.length === 0) return;
        setPhase('applying');
        const res = await applyM.mutateAsync({ editId, itemIds: ids, force, onProgress: setProgress });
        // Sin «volverlos atrás igual», los que cambiaron después ni se mandan:
        // igual se cuentan en el resultado (quedaron como estaban a propósito).
        setResult({ ...res, conflicts: res.conflicts + (force ? 0 : preview.conflict_ids.length) });
        setPhase('done');
        onDone?.();
    };

    return (
        <Dialog.Root open={open} onOpenChange={(o) => (phase === 'applying' ? undefined : onOpenChange(o))}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-bulk-revert-dialog"
                    onEscapeKeyDown={(e) => phase === 'applying' && e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <Undo2 className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                {__('Deshacer edición masiva')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-line-clamp-2 imcrm-text-xs imcrm-text-muted-foreground">
                                {summary}
                            </Dialog.Description>
                        </div>
                        {phase !== 'applying' && (
                            <Dialog.Close asChild>
                                <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </Dialog.Close>
                        )}
                    </div>

                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4">
                        {phase === 'loading' && (
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-10 imcrm-text-sm imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                {__('Revisando cómo están hoy esos registros…')}
                            </div>
                        )}
                        {phase === 'error' && (
                            <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert">
                                {error}
                            </p>
                        )}
                        {phase === 'preview' && preview && <RevertPreviewPanel preview={preview} force={force} onForce={setForce} />}
                        {phase === 'applying' && (
                            <div className="imcrm-py-8 imcrm-text-center" aria-live="polite">
                                <Loader2 className="imcrm-mx-auto imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-primary" />
                                <p className="imcrm-mt-3 imcrm-text-sm">
                                    {progress
                                        ? sprintf(__('Volviendo atrás… %1$s de %2$s'), formatNumber(progress.done), formatNumber(progress.total))
                                        : __('Volviendo atrás…')}
                                </p>
                                <div className="imcrm-mx-auto imcrm-mt-3 imcrm-h-2 imcrm-max-w-sm imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                                    <div
                                        className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-all"
                                        style={{ width: `${progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                                    />
                                </div>
                            </div>
                        )}
                        {phase === 'done' && result && (
                            <div className="imcrm-space-y-3" data-testid="imcrm-bulk-revert-result">
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                    <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-emerald-600" />
                                    {sprintf(_n('Se volvió atrás %s registro.', 'Se volvieron atrás %s registros.', result.reverted), formatNumber(result.reverted))}
                                </p>
                                {result.conflicts > 0 && (
                                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                        {sprintf(
                                            _n(
                                                '%d quedó como estaba porque alguien lo cambió después.',
                                                '%d quedaron como estaban porque alguien los cambió después.',
                                                result.conflicts,
                                            ),
                                            result.conflicts,
                                        )}
                                    </p>
                                )}
                                {result.failed.length > 0 && (
                                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3">
                                        <p className="imcrm-text-sm imcrm-font-medium imcrm-text-destructive">
                                            {sprintf(_n('%d no se pudo volver atrás:', '%d no se pudieron volver atrás:', result.failed.length), result.failed.length)}
                                        </p>
                                        <ul className="imcrm-mt-1.5 imcrm-space-y-0.5 imcrm-text-xs">
                                            {result.failed.slice(0, 50).map((f, i) => (
                                                <li key={`${f.item_id}-${i}`}>
                                                    <span className="imcrm-font-medium">{f.title}</span> — {f.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        {(phase === 'preview' || phase === 'error' || phase === 'loading') && (
                            <Button variant="ghost" onClick={() => onOpenChange(false)}>
                                {__('Cancelar')}
                            </Button>
                        )}
                        {phase === 'preview' && preview && (
                            <Button onClick={() => void runApply()} disabled={ids.length === 0} data-testid="imcrm-bulk-revert-apply">
                                {ids.length === 0
                                    ? __('No hay nada que volver atrás')
                                    : sprintf(_n('Volver atrás %s registro', 'Volver atrás %s registros', ids.length), formatNumber(ids.length))}
                            </Button>
                        )}
                        {phase === 'done' && (
                            <Button onClick={() => onOpenChange(false)} data-testid="imcrm-bulk-revert-close">
                                {__('Listo')}
                            </Button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function RevertPreviewPanel({
    preview,
    force,
    onForce,
}: {
    preview: BulkRevertPreview;
    force: boolean;
    onForce: (v: boolean) => void;
}): JSX.Element {
    if (preview.total === 0) {
        return <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">{__('Esta edición ya se deshizo por completo.')}</p>;
    }
    return (
        <div className="imcrm-space-y-4" data-testid="imcrm-bulk-revert-preview">
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                <Stat label={__('Vuelven atrás')} value={preview.item_ids.length} tone="ok" />
                <Stat label={__('Cambiaron después')} value={preview.conflict_ids.length} tone={preview.conflict_ids.length > 0 ? 'warn' : 'muted'} />
                <Stat label={__('Ya no existen')} value={preview.missing} tone="muted" />
            </div>
            {preview.conflict_ids.length > 0 && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-amber-500/40 imcrm-bg-amber-500/5 imcrm-p-3">
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                        <AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-text-amber-600" />
                        {__('Alguien volvió a tocar estos registros después de la edición')}
                    </p>
                    <ul className="imcrm-mt-1.5 imcrm-max-h-32 imcrm-space-y-0.5 imcrm-overflow-y-auto imcrm-text-xs" data-testid="imcrm-bulk-revert-conflicts">
                        {preview.conflicts.map((c) => (
                            <li key={c.item_id}>
                                <span className="imcrm-font-medium">{c.title}</span> — {c.message}
                            </li>
                        ))}
                    </ul>
                    <label className="imcrm-mt-2 imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5"
                            checked={force}
                            onChange={(e) => onForce(e.target.checked)}
                            data-testid="imcrm-bulk-revert-force"
                        />
                        <span>
                            {__('Volverlos atrás igual')}
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Se pierde lo que se cambió después en esas columnas. Si no lo marcas, esos registros quedan como están.')}
                            </span>
                        </span>
                    </label>
                </div>
            )}
            {preview.sample.length > 0 && (
                <div>
                    <p className="imcrm-mb-1.5 imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('Así vuelven')}
                    </p>
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border">
                        {preview.sample.map((s) => (
                            <li key={s.item_id} className="imcrm-px-3 imcrm-py-2">
                                <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium" title={s.title}>
                                    {s.title}
                                </p>
                                <ul className="imcrm-mt-0.5 imcrm-space-y-0.5">
                                    {s.changes.map((c) => (
                                        <li key={c.label} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                                            <span className="imcrm-text-muted-foreground">{c.label}:</span>
                                            <span className="imcrm-line-through imcrm-opacity-70">{pretty(c.before)}</span>
                                            <ArrowRight className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" />
                                            <span className="imcrm-font-medium">{pretty(c.after)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

/** Un número crudo del backend se muestra con los separadores de la empresa. */
function pretty(s: string): string {
    return /^-?\d+(\.\d+)?$/.test(s) ? formatNumber(Number(s)) : s;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'muted' }): JSX.Element {
    return (
        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2">
            <p
                className={cn(
                    'imcrm-text-lg imcrm-font-semibold',
                    tone === 'ok' && 'imcrm-text-emerald-600',
                    tone === 'warn' && 'imcrm-text-amber-600',
                    tone === 'muted' && 'imcrm-text-muted-foreground',
                )}
            >
                {formatNumber(value)}
            </p>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">{label}</p>
        </div>
    );
}
