import { useState } from 'react';
import { Loader2, Sparkles, Undo2 } from 'lucide-react';

import { useRecordAiGate } from '@/admin/records/ai/RecordAi';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { aiErrorText, useRecordAiReply } from '@/hooks/useRecordAi';
import { __ } from '@/lib/i18n';

/**
 * v0.1.456 (ADR-S109) — «Sugerir respuesta»: la IA arma un borrador con el
 * hilo y el registro y lo deja en la caja para que la persona lo revise. Nunca
 * se envía solo. Si ya había algo escrito, la IA lo toma como lo que se quiere
 * decir; «Deshacer» devuelve lo que estaba.
 *
 * Una respuesta para el cliente (portal) no ve las notas internas del equipo
 * (eso lo filtra el servidor).
 */
export function SuggestReplyButton({
    listId,
    recordId,
    commentId,
    forClient,
    draft,
    onSuggest,
    disabled = false,
}: {
    listId: number;
    recordId: number;
    /** El hilo al que se responde (sin él, la conversación del registro). */
    commentId?: number;
    forClient: boolean;
    draft: string;
    onSuggest: (text: string) => void;
    disabled?: boolean;
}): JSX.Element | null {
    const gate = useRecordAiGate();
    const planOff = usePlanModuleOff('ai');
    const reply = useRecordAiReply(listId, recordId);
    const toast = useToast();
    const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
    if (!gate.show || planOff) return null;

    const canUndo = undo !== null && draft === undo.after;
    return (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5">
            <Button
                type="button"
                size="sm"
                variant="ghost"
                className="imcrm-h-7 imcrm-gap-1.5 imcrm-px-2 imcrm-text-primary"
                disabled={disabled || reply.isPending || (gate.ready && !gate.available)}
                title={gate.reason ?? __('La IA escribe un borrador con la conversación y los datos del registro. Lo revisas antes de enviar.')}
                onClick={() =>
                    reply.mutate(
                        { comment_id: commentId, for_client: forClient, hint: draft.trim().slice(0, 2000) },
                        {
                            onSuccess: (res) => {
                                setUndo({ before: draft, after: res.text });
                                onSuggest(res.text);
                            },
                            onError: (err) => toast.error(__('No se pudo sugerir una respuesta'), aiErrorText(err)),
                        },
                    )
                }
                data-testid="imcrm-suggest-reply"
                data-tour="comments-suggest-reply"
            >
                {reply.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />}
                <span className="imcrm-hidden sm:imcrm-inline">{reply.isPending ? __('Pensando…') : __('Sugerir respuesta')}</span>
            </Button>
            {canUndo && (
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-muted-foreground"
                    onClick={() => {
                        onSuggest(undo.before);
                        setUndo(null);
                    }}
                    title={__('Volver a lo que tenías escrito')}
                    data-testid="imcrm-suggest-reply-undo"
                >
                    <Undo2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Deshacer')}</span>
                </Button>
            )}
        </span>
    );
}
