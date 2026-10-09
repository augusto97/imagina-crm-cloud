import { Loader2, RefreshCw, Sparkles } from 'lucide-react';

import { useToast } from '@/components/ui/toast';
import { useRunAiField } from '@/hooks/useAiFields';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { FieldValueDisplay } from './crm/FieldValueDisplay';

/**
 * v0.1.277 (ADR-S41) — Valor de un campo con IA en la ficha: se lee, no se
 * edita, y «Recalcular» lo pide de nuevo al modelo (esperando la respuesta).
 */
export function AiFieldValue({
    field,
    value,
    listId,
    recordId,
}: {
    field: FieldEntity;
    value: unknown;
    listId: number | string;
    recordId?: number;
}): JSX.Element {
    const run = useRunAiField(listId);
    const toast = useToast();
    const empty = value === null || value === undefined || value === '';
    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-1.5" data-ai-value={field.slug}>
            <Sparkles className="imcrm-mt-1 imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-sm">
                {run.isPending ? (
                    <span className="imcrm-text-muted-foreground">{__('La IA está pensando…')}</span>
                ) : empty ? (
                    <span className="imcrm-text-muted-foreground">{__('Todavía sin calcular')}</span>
                ) : (
                    <FieldValueDisplay field={field} value={value} />
                )}
            </span>
            {recordId !== undefined && (
                <button
                    type="button"
                    disabled={run.isPending}
                    onClick={() =>
                        run.mutate(
                            { recordId, fieldId: field.id },
                            { onError: (err) => toast.error(__('La IA no pudo completar el campo'), err instanceof Error ? err.message : String(err)) },
                        )
                    }
                    className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-50"
                    title={__('Volver a calcular con IA')}
                    data-testid="ai-field-run"
                >
                    {run.isPending ? <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" /> : <RefreshCw className="imcrm-h-3 imcrm-w-3" />}
                    {empty ? __('Calcular') : __('Recalcular')}
                </button>
            )}
        </div>
    );
}
