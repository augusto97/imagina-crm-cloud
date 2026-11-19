import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CircleAlert, Loader2, Sparkles, X } from 'lucide-react';
import {
    AUTOMATION_AI_DRAFT_MAX_CHARS,
    type AutomationAiDraftCurrent,
    type AutomationAiDraftResult,
    type AutomationAiDraftStage,
    type AutomationAiDraftStatus,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAutomationAiDraftJob, useStartAutomationAiDraft } from '@/hooks/useAutomationAiDraft';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { aiDraftExamples } from './aiDraft';

function stageText(stage: AutomationAiDraftStage | null): string {
    if (stage === 'checking') return __('Revisando que funcione con tu lista…');
    if (stage === 'fixing') return __('Corrigiendo un detalle…');
    return __('Armando la automatización…');
}

/**
 * v0.1.463 — «Describir con IA» / «Pedir un cambio con IA» (E7). Se baja la
 * primera vez que se abre (lazyDialog). Cuenta lo que quiere, elige un ejemplo
 * armado con los campos de la lista o lo escribe, y la IA devuelve la
 * automatización: el editor la carga SIN guardar.
 */
export function AutomationAiDraftDialog({
    open,
    onOpenChange,
    listId,
    listName,
    fields,
    current,
    status,
    onResult,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    listName: string;
    fields: FieldEntity[];
    /** La automatización del editor («Pedir un cambio»); sin ella, se arma una nueva. */
    current: AutomationAiDraftCurrent | null;
    status: AutomationAiDraftStatus | undefined;
    onResult: (result: AutomationAiDraftResult) => void;
}): JSX.Element {
    const mode = current ? 'change' : 'create';
    const [text, setText] = useState('');
    const [jobId, setJobId] = useState<string | null>(null);
    const start = useStartAutomationAiDraft(listId);
    const job = useAutomationAiDraftJob(listId, jobId);
    const examples = useMemo(() => aiDraftExamples(fields, mode), [fields, mode]);
    const delivered = useRef<string | null>(null);

    // Al terminar, el resultado va al editor (una sola vez por pedido).
    useEffect(() => {
        const data = job.data;
        if (!data || data.state !== 'done' || !data.result || delivered.current === data.id) return;
        delivered.current = data.id;
        onResult(data.result);
        setJobId(null);
        setText('');
        onOpenChange(false);
    }, [job.data, onOpenChange, onResult]);

    // Un pedido que ya no existe (venció o se reinició el servidor) no deja el diálogo trabado.
    const lost = jobId !== null && job.isError;
    const running = start.isPending || (jobId !== null && !lost && (job.data === undefined || job.data.state === 'running'));
    const jobError = lost
        ? job.error instanceof ApiError
            ? job.error.message
            : __('Se perdió el pedido. Vuelve a intentarlo.')
        : job.data?.state === 'error'
          ? job.data.error?.message ?? __('La IA no pudo armarla. Intenta de nuevo.')
          : null;
    const startError = start.isError ? (start.error instanceof ApiError ? start.error.message : __('No se pudo hablar con la IA. Intenta de nuevo.')) : null;
    const unavailable = status && !status.available ? status.reason ?? __('La IA no está disponible en este momento.') : null;
    const canSubmit = !running && unavailable === null && text.trim().length >= 3;

    const submit = (): void => {
        if (!canSubmit) return;
        setJobId(null);
        delivered.current = null;
        start.mutate(
            { description: text.trim(), ...(current ? { current } : {}) },
            { onSuccess: (r) => setJobId(r.id) },
        );
    };

    return (
        <Dialog.Root open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[92vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-xl imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-ai-draft-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                            <Sparkles className="imcrm-h-5 imcrm-w-5" />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {mode === 'change' ? __('Pedir un cambio con IA') : __('Describe la automatización')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {mode === 'change'
                                    ? __('Di qué quieres cambiar. La IA te devuelve la automatización cambiada para que la revises; lo demás queda igual. Nada se guarda hasta que toques «Guardar».')
                                    : sprintf(
                                          /* translators: %s: nombre de la lista */
                                          __('Cuéntalo en tus palabras: la IA arma el disparador y los pasos con los campos de «%s». Nada se guarda hasta que toques «Guardar».'),
                                          listName,
                                      )}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close
                            className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-50"
                            aria-label={__('Cerrar')}
                            disabled={running}
                        >
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    <form
                        className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            submit();
                        }}
                    >
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="ai-draft-text">{mode === 'change' ? __('¿Qué quieres cambiar?') : __('¿Qué quieres que pase?')}</Label>
                            <Textarea
                                id="ai-draft-text"
                                rows={4}
                                autoFocus
                                value={text}
                                maxLength={AUTOMATION_AI_DRAFT_MAX_CHARS}
                                disabled={running}
                                placeholder={
                                    mode === 'change'
                                        ? __('Ej.: si el correo falla, avísame en la app y sigue con lo demás.')
                                        : __('Ej.: cuando una factura pase a «Vencida», mándale un correo al cliente y espera 2 días; si sigue vencida, avísame.')
                                }
                                onChange={(e) => setText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        submit();
                                    }
                                }}
                                data-testid="imcrm-ai-draft-text"
                            />
                        </div>

                        {!running && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Ideas con tus campos')}</span>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    {examples.map((ex) => (
                                        <button
                                            key={ex}
                                            type="button"
                                            onClick={() => setText(ex)}
                                            className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-[13px] imcrm-leading-snug hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5"
                                            data-testid="imcrm-ai-draft-example"
                                        >
                                            {ex}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {running && (
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-primary/5 imcrm-px-3 imcrm-py-2 imcrm-text-sm" role="status" data-testid="imcrm-ai-draft-progress">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-primary" />
                                {stageText(job.data?.stage ?? null)}
                            </p>
                        )}

                        {unavailable !== null && (
                            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-[hsl(var(--imcrm-warning-ink))]" data-testid="imcrm-ai-draft-unavailable">
                                <CircleAlert className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                {unavailable}
                            </p>
                        )}
                        {(jobError ?? startError) !== null && !running && (
                            <p className="imcrm-text-xs imcrm-text-destructive" role="alert" data-testid="imcrm-ai-draft-error">
                                {jobError ?? startError}
                            </p>
                        )}
                        {status?.available && status.source === 'platform' && (
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Usa un pedido de la IA de tu plan.')}</p>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
                                {__('Cancelar')}
                            </Button>
                            <Button type="submit" className="imcrm-gap-2" disabled={!canSubmit} data-testid="imcrm-ai-draft-submit">
                                {running ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-4 imcrm-w-4" />}
                                {mode === 'change' ? __('Pedir el cambio') : __('Armar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

export default AutomationAiDraftDialog;
