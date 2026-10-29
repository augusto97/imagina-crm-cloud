import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SMS_BULK_MAX, type SmsBatchStatus, type SmsBulkPreview, type SmsConnectionSummary } from '@imagina-base/shared';
import { AlertTriangle, CalendarClock, Loader2, MessageSquareText, X } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { SmsBubble, SmsCounter, SmsStatusChip, hasMergeTags } from '@/cloud/components/sms/smsUi';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { CloudApiError } from '@/lib/cloud/client';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * SMS (ADR-S82) — mandar un SMS a la selección de la tabla. Primero la vista
 * previa del servidor (cuántos salen, quién no tiene teléfono válido, cuántos
 * SMS se cobran y cómo llega uno), después la confirmación. Los envíos van a
 * la cola —al ritmo de la conexión— y el resultado por fila se ve aquí mismo.
 */
export function BulkSmsDialog({
    listId,
    ids,
    connections,
    onClose,
    onDone,
}: {
    listId: number;
    ids: number[];
    connections: SmsConnectionSummary[];
    onClose: () => void;
    onDone: () => void;
}): JSX.Element {
    const qc = useQueryClient();
    const capped = ids.slice(0, SMS_BULK_MAX);
    const [connectionId, setConnectionId] = useState(connections[0]!.id);
    const conn = connections.find((c) => c.id === connectionId) ?? connections[0]!;
    const [message, setMessage] = useState('');
    const [strip, setStrip] = useState(true);
    const [respectHours, setRespectHours] = useState(false);
    const [preview, setPreview] = useState<SmsBulkPreview | null>(null);
    const [batchId, setBatchId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const input = { connection_id: conn.id, record_ids: capped, message, strip_accents: strip, respect_hours: respectHours };
    // Cambiar el texto o las opciones invalida la vista previa.
    useEffect(() => setPreview(null), [connectionId, message, strip, respectHours]);

    const check = useMutation({
        mutationFn: () => api.smsBulkPreview(listId, input),
        onSuccess: (p) => {
            setError(null);
            setPreview(p);
        },
        onError: (err) => setError(err instanceof CloudApiError || err instanceof Error ? err.message : String(err)),
    });
    const send = useMutation({
        mutationFn: () => api.smsBulkSend(listId, input),
        onSuccess: (r) => {
            setError(null);
            setBatchId(r.batch_id);
            invalidateForList(qc, recordsKeys.all, listId);
        },
        onError: (err) => setError(err instanceof CloudApiError || err instanceof Error ? err.message : String(err)),
    });
    const batch = useQuery({
        queryKey: ['sms-batch', listId, batchId],
        queryFn: () => api.smsBatch(listId, batchId!),
        enabled: batchId !== null,
        refetchInterval: (q) => ((q.state.data as SmsBatchStatus | undefined)?.done ? false : 2000),
    });
    useEffect(() => {
        if (batch.data?.done) invalidateForList(qc, recordsKeys.all, listId);
    }, [batch.data?.done, qc, listId]);

    const running = batchId !== null;
    return (
        <Dialog.Root open onOpenChange={(o) => (!o ? (running ? (onDone(), onClose()) : onClose()) : undefined)}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-bulk-sms-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-p-4">
                        <IntegrationLogo integrationKey={conn.provider} size={36} />
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {sprintf(_n('Enviar SMS a %d registro', 'Enviar SMS a %d registros', capped.length), capped.length)}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-xs imcrm-text-muted-foreground">
                                {ids.length > SMS_BULK_MAX
                                    ? sprintf(/* translators: %d: máximo */ __('Se toman los primeros %d de la selección.'), SMS_BULK_MAX)
                                    : __('Cada uno con sus datos: las variables se completan registro por registro.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-flex-1 imcrm-space-y-3 imcrm-overflow-y-auto imcrm-p-4">
                        {!running ? (
                            <>
                                {connections.length > 1 && (
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                        <Label htmlFor="bulk-sms-conn">{__('Enviar con')}</Label>
                                        <Select id="bulk-sms-conn" value={String(connectionId)} onChange={(e) => setConnectionId(Number(e.target.value))}>
                                            {connections.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.name}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                )}
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="bulk-sms-text">{__('Mensaje')}</Label>
                                    <Textarea id="bulk-sms-text" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder={__('Hola {{nombre}}, …')} data-testid="imcrm-bulk-sms-text" />
                                    <SmsCounter text={message} stripAccents={strip} onStripAccents={setStrip} hasVariables={hasMergeTags(message)} />
                                </div>
                                <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                    <input
                                        type="checkbox"
                                        checked={respectHours}
                                        onChange={(e) => setRespectHours(e.target.checked)}
                                        className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5"
                                        data-testid="imcrm-bulk-sms-respect-hours"
                                    />
                                    <span>
                                        <span className="imcrm-font-medium">{__('Respetar el horario para mensajes comerciales y de cobranza (Ley 2300 de 2023)')}</span>
                                        <span className="imcrm-block imcrm-text-muted-foreground">
                                            {__('Fuera de lunes a viernes 7:00 a. m.–7:00 p. m. y sábados 8:00 a. m.–3:00 p. m. (nunca domingos ni festivos) quedan programados. Confírmalo con tu abogado.')}
                                        </span>
                                    </span>
                                </label>

                                {preview && (
                                    <div className="imcrm-space-y-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-sm" data-testid="imcrm-bulk-sms-preview">
                                        <p className="imcrm-font-medium" data-testid="imcrm-bulk-sms-summary">
                                            {sprintf(
                                                /* translators: 1: destinatarios, 2: SMS */
                                                __('Salen %1$s SMS a %2$s destinatarios.'),
                                                formatNumber(preview.segments_total),
                                                formatNumber(preview.sendable),
                                            )}
                                        </p>
                                        {preview.missing.length > 0 && (
                                            <div className="imcrm-text-xs" data-testid="imcrm-bulk-sms-missing">
                                                <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                                    <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    {sprintf(_n('%d no recibe el SMS:', '%d no reciben el SMS:', preview.total - preview.sendable), preview.total - preview.sendable)}
                                                </p>
                                                <ul className="imcrm-mt-1 imcrm-max-h-28 imcrm-space-y-0.5 imcrm-overflow-y-auto imcrm-text-muted-foreground">
                                                    {preview.missing.map((m) => (
                                                        <li key={m.record_id}>
                                                            <span className="imcrm-font-medium imcrm-text-foreground">{m.title}</span> — {m.reason}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {preview.ucs2 > 0 && (
                                            <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                                {sprintf(_n('%d mensaje lleva caracteres que hacen cada SMS de 70 en vez de 160.', '%d mensajes llevan caracteres que hacen cada SMS de 70 en vez de 160.', preview.ucs2), preview.ucs2)}
                                            </p>
                                        )}
                                        {preview.scheduled_for && (
                                            <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-violet-700 dark:imcrm-text-violet-300" data-testid="imcrm-bulk-sms-scheduled">
                                                <CalendarClock className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {sprintf(/* translators: %s: fecha */ __('Ahora está fuera del horario permitido: salen desde %s.'), formatDateTimeStr(preview.scheduled_for))}
                                            </p>
                                        )}
                                        {preview.sample[0] && (
                                            <div>
                                                <p className="imcrm-mb-1 imcrm-text-xs imcrm-text-muted-foreground">
                                                    {sprintf(/* translators: %s: registro */ __('Así le llega a %s:'), preview.sample[0].title)}
                                                </p>
                                                <SmsBubble text={preview.sample[0].text} to={preview.sample[0].to} />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <BatchView batch={batch.data ?? null} />
                        )}
                        {error && <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-bulk-sms-error">{error}</p>}
                    </div>

                    <div className="imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-p-4">
                        {!running ? (
                            <>
                                <Button variant="ghost" onClick={onClose}>
                                    {__('Cancelar')}
                                </Button>
                                {!preview ? (
                                    <Button onClick={() => check.mutate()} disabled={message.trim() === '' || check.isPending} data-testid="imcrm-bulk-sms-check">
                                        {check.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <MessageSquareText className="imcrm-h-4 imcrm-w-4" />}
                                        {__('Revisar')}
                                    </Button>
                                ) : (
                                    <Button onClick={() => send.mutate()} disabled={preview.sendable === 0 || send.isPending} data-testid="imcrm-bulk-sms-send">
                                        {sprintf(_n('Enviar a %d destinatario', 'Enviar a %d destinatarios', preview.sendable), preview.sendable)}
                                    </Button>
                                )}
                            </>
                        ) : (
                            <Button
                                onClick={() => {
                                    onDone();
                                    onClose();
                                }}
                                data-testid="imcrm-bulk-sms-close"
                            >
                                {batch.data?.done ? __('Listo') : __('Seguir en segundo plano')}
                            </Button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function BatchView({ batch }: { batch: SmsBatchStatus | null }): JSX.Element {
    if (!batch) return <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Preparando el envío…')}</p>;
    const sent = (batch.counts.enviado ?? 0) + (batch.counts.entregado ?? 0);
    const pending = (batch.counts.en_cola ?? 0) + (batch.counts.enviando ?? 0) + (batch.counts.programado ?? 0);
    const failed = batch.counts.fallido ?? 0;
    const pct = batch.total > 0 ? Math.round(((batch.total - pending) / batch.total) * 100) : 0;
    return (
        <div className="imcrm-space-y-3" data-testid="imcrm-bulk-sms-batch" data-done={batch.done ? '1' : '0'}>
            <div className="imcrm-h-2 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                <div className="imcrm-h-full imcrm-bg-primary imcrm-transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="imcrm-text-sm" data-testid="imcrm-bulk-sms-batch-summary">
                {batch.done
                    ? sprintf(/* translators: 1: enviados, 2: fallidos */ __('Listo: %1$d enviados, %2$d con error.'), sent, failed)
                    : (batch.counts.programado ?? 0) > 0 && (batch.counts.en_cola ?? 0) === 0
                      ? __('Programados: salen solos en el horario permitido.')
                      : sprintf(/* translators: 1: enviados, 2: total */ __('Enviando… %1$d de %2$d.'), batch.total - pending, batch.total)}
            </p>
            <ul className="imcrm-max-h-64 imcrm-divide-y imcrm-divide-border imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                {batch.rows.map((r) => (
                    <li key={r.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-0.5 imcrm-px-3 imcrm-py-1.5 imcrm-text-xs" data-testid="imcrm-bulk-sms-row" data-status={r.status}>
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-font-medium">{r.title}</span>
                        <span className="imcrm-tabular-nums imcrm-text-muted-foreground">{r.to}</span>
                        <SmsStatusChip status={r.status} />
                        {r.error && <span className="imcrm-w-full imcrm-text-destructive">{r.error}</span>}
                    </li>
                ))}
            </ul>
        </div>
    );
}
