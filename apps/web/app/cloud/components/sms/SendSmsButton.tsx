import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { finalSmsText, type SmsRecordInfo, type SmsSendResult } from '@imagina-base/shared';
import { MessageSquareText, Send, X } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { SmsBubble, SmsCounter, SmsSendReport, SmsStatusChip, hasMergeTags } from '@/cloud/components/sms/smsUi';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { CloudApiError } from '@/lib/cloud/client';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';

/**
 * SMS (ADR-S82) — «Enviar SMS» desde un registro (modal, página y ficha
 * diseñada). Sin una conexión de SMS no se dibuja nada. El diálogo muestra el
 * texto REAL (las variables resueltas por el servidor con este registro) y el
 * contador de SMS con la misma función que usa el envío.
 */
function SendSmsButtonInner({ listId, recordId, compact = false }: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const isGuest = useIsGuest();
    const [open, setOpen] = useState(false);
    const q = useQuery({
        queryKey: ['record-sms', listId, recordId] as const,
        queryFn: () => api.smsRecord(listId, recordId),
        enabled: !isGuest,
        retry: false,
        staleTime: 30_000,
    });
    const info = q.data;
    if (isGuest || !info || info.connections.length === 0) return null;
    const label = __('Enviar SMS');
    return (
        <>
            {compact ? (
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={label}
                    title={info.last ? `${label} · ${__('último SMS:')} ${info.last.status}` : label}
                    onClick={() => setOpen(true)}
                    data-testid="record-sms"
                    data-tour="record-sms"
                >
                    <MessageSquareText className="imcrm-h-4 imcrm-w-4" />
                </Button>
            ) : (
                <Button variant="outline" className="imcrm-gap-2" onClick={() => setOpen(true)} data-testid="record-sms" data-tour="record-sms">
                    <MessageSquareText className="imcrm-h-4 imcrm-w-4" />
                    {label}
                </Button>
            )}
            {open && <SendSmsDialog listId={listId} recordId={recordId} info={info} onClose={() => setOpen(false)} />}
        </>
    );
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

/** Espera a que la persona deje de escribir. */
function useDebounced<T>(value: T, ms: number): T {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return v;
}

function SendSmsDialog({ listId, recordId, info, onClose }: { listId: number; recordId: number; info: SmsRecordInfo; onClose: () => void }): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const [connectionId, setConnectionId] = useState(info.connections[0]!.id);
    const conn = info.connections.find((c) => c.id === connectionId) ?? info.connections[0]!;
    const [to, setTo] = useState(info.recipient ?? '');
    const [message, setMessage] = useState('');
    const [strip, setStrip] = useState(false);
    const [respectHours, setRespectHours] = useState(false);
    const [result, setResult] = useState<SmsSendResult | null>(null);
    const [setupDone, setSetupDone] = useState(false);

    const input = {
        connection_id: conn.id,
        to: to.trim() === (info.recipient ?? '') ? undefined : to.trim(),
        message,
        strip_accents: strip,
        respect_hours: respectHours,
    };
    // La vista previa se pide SIN quitar tildes: «Quitar tildes» se aplica aquí,
    // con la misma función que el envío, y así se puede prender y apagar.
    const debounced = useDebounced({ ...input, strip_accents: false }, 400);
    const preview = useQuery({
        queryKey: ['record-sms-preview', listId, recordId, debounced] as const,
        queryFn: () => api.smsPreview(listId, recordId, debounced),
        enabled: debounced.message.trim() !== '',
        retry: false,
        staleTime: 10_000,
    });
    const shown = debounced.message.trim() !== '' ? preview.data : undefined;
    const valid = message.trim() !== '' && (to.trim() !== '' || info.recipient !== null);

    const send = useMutation({
        mutationFn: () => api.smsSend(listId, recordId, input),
        onSuccess: (res) => {
            setResult(res);
            void qc.invalidateQueries({ queryKey: ['record-sms', listId, recordId] });
            invalidateForList(qc, recordsKeys.all, listId);
            if (res.ok) toast.success(res.status === 'programado' ? __('SMS programado') : __('SMS enviado'), res.to);
        },
        onError: (err) =>
            setResult({ ok: false, status: null, message_id: null, provider_message_id: null, to, text: '', segments: 0, encoding: 'gsm7', scheduled_for: null, error: errText(err), request: null, response: null }),
    });
    const setup = useMutation({
        mutationFn: () => api.smsSetupListColumns(listId),
        onSuccess: () => {
            setSetupDone(true);
            void qc.invalidateQueries({ queryKey: ['record-sms', listId, recordId] });
        },
        onError: (err) => toast.error(__('No se pudieron preparar las columnas'), errText(err)),
    });

    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-sms-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <IntegrationLogo integrationKey={conn.provider} size={40} />
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Enviar SMS')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {sprintf(/* translators: %s: conexión */ __('Con %s. En el registro queda la fecha y el estado de entrega.'), conn.name)}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    {info.last && (
                        <div className="imcrm-mt-4 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-sms-dialog-last">
                            {__('Último SMS:')} <SmsStatusChip status={info.last.status} /> {formatDateTimeStr(info.last.at)}
                            {info.last.status === 'fallido' && info.last.error && <span className="imcrm-w-full imcrm-text-destructive">{info.last.error}</span>}
                        </div>
                    )}

                    <form
                        className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setResult(null);
                            if (valid) send.mutate();
                        }}
                    >
                        {info.connections.length > 1 && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sms-conn">{__('Enviar con')}</Label>
                                <Select id="sms-conn" value={String(connectionId)} onChange={(e) => setConnectionId(Number(e.target.value))} data-testid="imcrm-sms-dialog-connection">
                                    {info.connections.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        )}
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="sms-to">{__('Para')}</Label>
                            <Input id="sms-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="+57 300 111 2233" inputMode="tel" data-testid="imcrm-sms-dialog-to" />
                            {!info.recipient && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('El registro no tiene teléfono: escríbelo con el indicativo del país.')}</p>}
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="sms-text">{__('Mensaje')}</Label>
                            <Textarea
                                id="sms-text"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                rows={4}
                                placeholder={__('Hola {{nombre}}, …')}
                                data-testid="imcrm-sms-dialog-text"
                            />
                            <SmsCounter text={shown?.text ?? message} stripAccents={strip} onStripAccents={setStrip} hasVariables={!shown && hasMergeTags(message)} />
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Puedes usar variables del registro, como {{nombre}}.')}</p>
                        </div>
                        {shown && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="imcrm-sms-dialog-preview">
                                <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Así llega')}</Label>
                                <SmsBubble text={finalSmsText(shown.text, strip)} to={shown.ok ? shown.to : null} />
                                {!shown.ok && shown.error && <p className="imcrm-text-xs imcrm-text-destructive">{shown.error}</p>}
                            </div>
                        )}
                        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                            <input type="checkbox" checked={respectHours} onChange={(e) => setRespectHours(e.target.checked)} className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5" data-testid="imcrm-sms-respect-hours" />
                            <span>
                                <span className="imcrm-font-medium">{__('Respetar el horario para mensajes comerciales y de cobranza (Ley 2300 de 2023)')}</span>
                                <span className="imcrm-block imcrm-text-muted-foreground">
                                    {__('Lunes a viernes de 7:00 a. m. a 7:00 p. m. y sábados de 8:00 a. m. a 3:00 p. m.; nunca domingos ni festivos. Fuera de ese horario queda programado. Confírmalo con tu abogado.')}
                                </span>
                            </span>
                        </label>

                        {!info.has_columns && !setupDone && (
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-2.5 imcrm-text-xs imcrm-text-muted-foreground">
                                <span className="imcrm-min-w-0 imcrm-flex-1">{__('Esta lista todavía no tiene columnas de SMS: el mensaje sale, pero el estado no queda a la vista en la tabla.')}</span>
                                {info.can_setup && (
                                    <Button type="button" size="sm" variant="outline" onClick={() => setup.mutate()} disabled={setup.isPending} data-testid="imcrm-sms-dialog-setup">
                                        {__('Preparar columnas')}
                                    </Button>
                                )}
                            </div>
                        )}

                        {result && <SmsSendReport result={result} />}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {result?.ok ? __('Cerrar') : __('Cancelar')}
                            </Button>
                            {info.can_send ? (
                                <Button type="submit" disabled={!valid || send.isPending} data-testid="imcrm-sms-dialog-send">
                                    <Send className="imcrm-h-4 imcrm-w-4" />
                                    {send.isPending ? __('Enviando…') : __('Enviar')}
                                </Button>
                            ) : (
                                <span className="imcrm-self-center imcrm-text-xs imcrm-text-muted-foreground">{__('No tienes permiso para editar este registro.')}</span>
                            )}
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/** v0.1.338 (ADR-S87) — sin el módulo en el plan, el botón no aparece. */
export function SendSmsButton(props: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const off = usePlanModuleOff('integrations');
    return off ? null : <SendSmsButtonInner {...props} />;
}
