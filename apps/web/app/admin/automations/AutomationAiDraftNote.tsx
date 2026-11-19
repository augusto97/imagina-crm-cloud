import { CircleAlert, RotateCcw, Sparkles, X } from 'lucide-react';
import type { AutomationAiDraftResult } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

/**
 * v0.1.463 — lo que armó (o cambió) la IA, arriba del editor: el resumen en
 * palabras, qué cambió (al pedir un cambio), los avisos de lo que hay que
 * completar y «Deshacer». Nada está guardado todavía.
 */
export function AutomationAiDraftNote({
    result,
    changes,
    onUndo,
    onAskChange,
    onClose,
}: {
    result: AutomationAiDraftResult;
    /** «Qué cambió» (sólo al pedir un cambio). */
    changes: string[];
    onUndo: () => void;
    onAskChange: (() => void) | null;
    onClose: () => void;
}): JSX.Element {
    const change = result.mode === 'change';
    return (
        <section
            className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 imcrm-text-[13px]"
            data-testid="imcrm-ai-draft-note"
            data-tour="automation-ai-result"
            aria-live="polite"
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                <Sparkles className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-font-semibold">
                        {change ? __('La IA hizo el cambio que pediste') : __('La IA armó esta automatización')}
                    </p>
                    <p className="imcrm-mt-0.5 imcrm-break-words imcrm-text-muted-foreground" data-testid="imcrm-ai-draft-summary">
                        {result.summary}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent"
                    aria-label={__('Cerrar este aviso')}
                >
                    <X className="imcrm-h-3.5 imcrm-w-3.5" />
                </button>
            </div>

            {change && changes.length > 0 && (
                <div className="imcrm-pl-6">
                    <p className="imcrm-text-xs imcrm-font-medium">{__('Qué cambió')}</p>
                    <ul className="imcrm-mt-1 imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-4" data-testid="imcrm-ai-draft-changes">
                        {changes.map((c, i) => (
                            <li key={i} className="imcrm-break-words">{c}</li>
                        ))}
                    </ul>
                </div>
            )}

            {result.warnings.length > 0 && (
                <div className="imcrm-ml-6 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-2.5 imcrm-py-2" data-testid="imcrm-ai-draft-warnings">
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-[hsl(var(--imcrm-warning-ink))]">
                        <CircleAlert className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        {__('Revisa esto antes de guardar')}
                    </p>
                    <ul className="imcrm-mt-1 imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-5 imcrm-text-xs">
                        {result.warnings.map((w, i) => (
                            <li key={i} className="imcrm-break-words">{w}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-pl-6">
                <span className="imcrm-mr-auto imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Todavía no está guardada: revisa los pasos y toca «Guardar».')}
                </span>
                {onAskChange && (
                    <Button size="sm" variant="outline" className="imcrm-gap-1.5" onClick={onAskChange} data-testid="imcrm-ai-draft-ask-again">
                        <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Pedir otro cambio')}
                    </Button>
                )}
                <Button size="sm" variant="outline" className="imcrm-gap-1.5" onClick={onUndo} data-testid="imcrm-ai-draft-undo">
                    <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Deshacer')}
                </Button>
            </div>
        </section>
    );
}
