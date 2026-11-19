import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { RECORD_AI_REWRITE_META, type RecordAiRewriteAction } from '@imagina-base/shared';

import { ChatMarkdown } from '@/admin/assistant/ChatMarkdown';
import { aiErrorText, useRecordAiWrite } from '@/hooks/useRecordAi';
import { FLOATING_MENU_ATTR } from '@/lib/escapeGuard';
import { __ } from '@/lib/i18n';

/** Marca de menú flotante propio: Esc lo cierra a él, no a la ficha. */
const FLOATING = { [FLOATING_MENU_ATTR]: '' } as Record<string, string>;

export interface AiWriteRequest {
    mode: 'compose' | 'rewrite';
    /** Qué hacer con lo seleccionado (sólo `rewrite`). */
    action?: RecordAiRewriteAction;
    /** Lo seleccionado, en el formato sencillo (sólo `rewrite`). */
    text?: string;
    top: number;
    left: number;
}

/**
 * v0.1.456 (ADR-S109) — «Escribir con IA» en la descripción: pedir un texto
 * nuevo (menú «/») o reescribir lo seleccionado (barra flotante). Siempre con
 * vista previa: la persona decide si lo inserta, reemplaza o descarta — nada
 * entra al documento solo.
 */
export function AiWritePanel({
    listKey,
    recordId,
    request,
    unavailable,
    onInsert,
    onReplace,
    onClose,
}: {
    listKey: string | number;
    recordId: number;
    request: AiWriteRequest;
    /** Motivo por el que la IA no se puede usar ahora (o `null`). */
    unavailable: string | null;
    onInsert: (text: string) => void;
    /** Sólo al reescribir: reemplaza lo seleccionado. */
    onReplace?: (text: string) => void;
    onClose: () => void;
}): JSX.Element {
    const write = useRecordAiWrite(listKey, recordId);
    const [prompt, setPrompt] = useState('');
    const box = useRef<HTMLDivElement>(null);
    const rewrite = request.mode === 'rewrite';
    const label = rewrite && request.action ? RECORD_AI_REWRITE_META[request.action].label : __('Escribir con IA');

    const run = (): void => {
        if (unavailable !== null || write.isPending) return;
        if (rewrite) {
            if (request.action && request.text) write.mutate({ mode: 'rewrite', action: request.action, text: request.text });
            return;
        }
        if (prompt.trim().length >= 3) write.mutate({ mode: 'compose', prompt: prompt.trim() });
    };

    // Reescribir arranca solo (ya se eligió qué hacer). El foco pasa al panel:
    // así la barra de formato del editor se esconde y no queda encima.
    useEffect(() => {
        box.current?.focus();
        if (rewrite) run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Esc con el panel abierto: lo cierra a él (la ficha, al ver el menú
    // todavía montado, no se cierra). Como el menú «/», en la `window`.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const result = write.data?.text ?? null;

    return (
        <div
            ref={box}
            tabIndex={-1}
            {...FLOATING}
            role="dialog"
            aria-label={label}
            className="imcrm-absolute imcrm-z-50 imcrm-flex imcrm-w-[380px] imcrm-max-w-[calc(100vw-2rem)] imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-2.5 imcrm-shadow-imcrm-lg imcrm-outline-none"
            style={{ top: request.top, left: request.left }}
            data-testid="imcrm-ai-write"
            data-tour="description-ai-panel"
        >
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold">
                <Sparkles className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" aria-hidden />
                {label}
            </div>

            {unavailable !== null && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                    <CircleAlert className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {unavailable}
                </p>
            )}

            {!rewrite && result === null && (
                <>
                    <textarea
                        autoFocus
                        rows={3}
                        value={prompt}
                        maxLength={1000}
                        disabled={write.isPending || unavailable !== null}
                        placeholder={__('¿Qué quieres que escriba? Ej.: un resumen de la propuesta para el cliente con los próximos pasos.')}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                run();
                            }
                        }}
                        className="imcrm-w-full imcrm-resize-none imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-text-sm imcrm-outline-none focus:imcrm-border-primary"
                        data-testid="imcrm-ai-write-prompt"
                    />
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('La IA lee los datos de este registro. Vas a ver el texto antes de insertarlo.')}
                    </p>
                </>
            )}

            {write.isPending && (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-ai-write-loading">
                    <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                    {rewrite ? __('Reescribiendo…') : __('Escribiendo…')}
                </p>
            )}

            {write.isError && (
                <p className="imcrm-text-xs imcrm-text-destructive" role="alert" data-testid="imcrm-ai-write-error">
                    {aiErrorText(write.error)}
                </p>
            )}

            {result !== null && !write.isPending && (
                <div
                    className="imcrm-max-h-60 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2.5 imcrm-py-2 imcrm-text-sm"
                    data-testid="imcrm-ai-write-result"
                    data-markdown={result}
                >
                    {/* Se ve con su formato (como quedará en la descripción); nunca como HTML. */}
                    <ChatMarkdown text={result} />
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-1.5">
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onClose}
                    className="imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent"
                    data-testid="imcrm-ai-write-discard"
                >
                    {__('Descartar')}
                </button>
                {result !== null && !write.isPending && (
                    <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                            if (rewrite) run();
                            else write.reset();
                        }}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent"
                    >
                        <RefreshCw className="imcrm-h-3 imcrm-w-3" />
                        {rewrite ? __('Probar otra vez') : __('Pedir otra cosa')}
                    </button>
                )}
                {result === null && !rewrite && (
                    <button
                        type="button"
                        disabled={write.isPending || unavailable !== null || prompt.trim().length < 3}
                        onClick={run}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-bg-primary imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary-foreground disabled:imcrm-opacity-50"
                        data-testid="imcrm-ai-write-run"
                    >
                        <Sparkles className="imcrm-h-3 imcrm-w-3" />
                        {__('Escribir')}
                    </button>
                )}
                {result !== null && !write.isPending && (
                    <>
                        <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onInsert(result)}
                            className={
                                rewrite
                                    ? 'imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium hover:imcrm-bg-accent'
                                    : 'imcrm-rounded-md imcrm-bg-primary imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary-foreground'
                            }
                            data-testid="imcrm-ai-write-insert"
                        >
                            {rewrite ? __('Insertar debajo') : __('Insertar')}
                        </button>
                        {rewrite && onReplace && (
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => onReplace(result)}
                                className="imcrm-rounded-md imcrm-bg-primary imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary-foreground"
                                data-testid="imcrm-ai-write-replace"
                            >
                                {__('Reemplazar')}
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

/** Las acciones sobre lo seleccionado, en el orden de la barra flotante. */
export const AI_REWRITE_GROUPS: Array<{ title: string; actions: RecordAiRewriteAction[] }> = [
    { title: __('Editar'), actions: ['improve', 'shorter', 'longer', 'fix'] },
    { title: __('Cambiar el tono'), actions: ['formal', 'friendly'] },
    { title: __('Traducir'), actions: ['translate_en', 'translate_pt', 'translate_es'] },
];
