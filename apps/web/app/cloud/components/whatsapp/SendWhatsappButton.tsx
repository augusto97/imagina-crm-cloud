import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    whatsappTemplateShape,
    whatsappTemplateVariables,
    type WhatsappRecordInfo,
    type WhatsappSendResult,
} from '@imagina-base/shared';
import { AlertTriangle, Clock, MessageCircle, Send, X } from 'lucide-react';

import { SendReport } from '@/admin/automations/WhatsappActionConfig';
import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { WhatsappBubble, WhatsappStatusChip, templateOptionLabel } from '@/cloud/components/whatsapp/whatsappUi';
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
import { cn } from '@/lib/utils';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';

/**
 * D3 — «Enviar WhatsApp» desde un registro (modal, página y ficha diseñada).
 * Sin una cuenta de WhatsApp Business conectada no se dibuja nada. El botón
 * muestra el estado del último envío; el diálogo deja elegir una plantilla
 * aprobada (con sus variables y la vista previa) o, si el contacto escribió en
 * las últimas 24 h, mandar un texto.
 */
function SendWhatsappButtonInner({ listId, recordId, compact = false }: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const isGuest = useIsGuest();
    const [open, setOpen] = useState(false);
    const key = ['record-whatsapp', listId, recordId] as const;
    const q = useQuery({
        queryKey: key,
        queryFn: () => api.whatsappRecord(listId, recordId),
        enabled: !isGuest,
        retry: false,
        staleTime: 30_000,
    });
    const info = q.data;
    if (isGuest || !info || info.connections.length === 0) return null;
    const first = info.connections[0]!;
    const status = info.connections.find((c) => c.last_status !== null)?.last_status ?? null;
    const label = __('Enviar WhatsApp');
    return (
        <>
            {compact ? (
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={label}
                    title={status ? `${label} · ${__('último envío:')} ${status}` : label}
                    onClick={() => setOpen(true)}
                    className="imcrm-relative"
                    data-testid="record-whatsapp"
                >
                    <MessageCircle className="imcrm-h-4 imcrm-w-4" />
                    {first.window_open && (
                        <span className="imcrm-absolute imcrm-right-1.5 imcrm-top-1.5 imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-emerald-500 imcrm-ring-2 imcrm-ring-card" aria-hidden />
                    )}
                </Button>
            ) : (
                <Button variant="outline" className="imcrm-gap-2" onClick={() => setOpen(true)} data-testid="record-whatsapp">
                    <MessageCircle className="imcrm-h-4 imcrm-w-4" />
                    {label}
                </Button>
            )}
            {open && <SendWhatsappDialog listId={listId} recordId={recordId} info={info} onClose={() => setOpen(false)} />}
        </>
    );
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

function SendWhatsappDialog({ listId, recordId, info, onClose }: { listId: number; recordId: number; info: WhatsappRecordInfo; onClose: () => void }): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const [connectionId, setConnectionId] = useState(info.connections[0]!.id);
    const conn = info.connections.find((c) => c.id === connectionId) ?? info.connections[0]!;
    const approved = conn.templates.filter((t) => t.status === 'APPROVED');
    const [kind, setKind] = useState<'template' | 'text'>(conn.window_open ? 'text' : 'template');
    const [to, setTo] = useState(info.recipient ?? '');
    const [tplKey, setTplKey] = useState(approved[0] ? `${approved[0].name}|${approved[0].language}` : '');
    const tpl = approved.find((t) => `${t.name}|${t.language}` === tplKey) ?? null;
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [media, setMedia] = useState('');
    const [text, setText] = useState('');
    const [result, setResult] = useState<WhatsappSendResult | null>(null);
    const [setupDone, setSetupDone] = useState(false);
    const vars = useMemo(() => (tpl ? whatsappTemplateVariables(tpl.components, tpl.parameter_format) : []), [tpl]);
    const shape = tpl ? whatsappTemplateShape(tpl.components, tpl.parameter_format) : null;
    const mediaFormat = shape?.header && shape.header.format !== 'TEXT' && shape.header.format !== 'LOCATION' ? shape.header.format : null;
    const missing = vars.filter((v) => (variables[v.key] ?? '').trim() === '').length + (mediaFormat && media.trim() === '' ? 1 : 0);
    const valid = to.trim() !== '' && (kind === 'text' ? text.trim() !== '' && conn.window_open : tpl !== null && missing === 0);

    const send = useMutation({
        mutationFn: () =>
            api.whatsappSend(listId, recordId, {
                connection_id: conn.id,
                to: to.trim() === (info.recipient ?? '') ? undefined : to.trim(),
                kind,
                ...(kind === 'template' && tpl
                    ? { template: tpl.name, language: tpl.language, variables, ...(mediaFormat ? { header_media: media.trim() } : {}) }
                    : { text, variables: {} }),
            }),
        onSuccess: (res) => {
            setResult(res);
            void qc.invalidateQueries({ queryKey: ['record-whatsapp', listId, recordId] });
            invalidateForList(qc, recordsKeys.all, listId);
            if (res.ok) toast.success(__('WhatsApp enviado'), res.to);
        },
        onError: (err) => setResult({ ok: false, message_id: null, to, text: '', status: null, error: errText(err), request: null, response: null }),
    });
    const setup = useMutation({
        mutationFn: () => api.whatsappSetupListColumns(listId),
        onSuccess: () => {
            setSetupDone(true);
            void qc.invalidateQueries({ queryKey: ['record-whatsapp', listId, recordId] });
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
                    data-testid="imcrm-whatsapp-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <IntegrationLogo integrationKey="whatsapp_cloud" size={40} />
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Enviar WhatsApp')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {sprintf(/* translators: %s: número de la empresa */ __('Desde %s. En el registro queda el último mensaje y su estado.'), conn.display_phone ?? conn.name)}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-mt-4 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xs" data-testid="imcrm-whatsapp-dialog-state">
                        {conn.window_open ? (
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-emerald-500/10 imcrm-px-2 imcrm-py-0.5 imcrm-font-medium imcrm-text-emerald-700 dark:imcrm-text-emerald-400" data-testid="imcrm-whatsapp-window-open">
                                <Clock className="imcrm-h-3 imcrm-w-3" />
                                {sprintf(/* translators: %s: fecha */ __('Ventana abierta hasta %s'), conn.window_closes_at ? formatDateTimeStr(conn.window_closes_at) : '')}
                            </span>
                        ) : (
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-muted-foreground" data-testid="imcrm-whatsapp-window-closed">
                                <Clock className="imcrm-h-3 imcrm-w-3" />
                                {__('Ventana cerrada: sólo plantillas')}
                            </span>
                        )}
                        {conn.last_status && (
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                                {__('Último envío:')} <WhatsappStatusChip status={conn.last_status} />
                                {conn.last_outbound_at ? formatDateTimeStr(conn.last_outbound_at) : ''}
                            </span>
                        )}
                    </div>
                    {conn.last_status === 'fallido' && conn.last_status_detail && (
                        <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">{conn.last_status_detail}</p>
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
                                <Label htmlFor="wa-conn">{__('Enviar desde')}</Label>
                                <Select
                                    id="wa-conn"
                                    value={String(connectionId)}
                                    onChange={(e) => {
                                        const next = info.connections.find((c) => c.id === Number(e.target.value));
                                        const firstTpl = next?.templates.find((t) => t.status === 'APPROVED');
                                        setConnectionId(Number(e.target.value));
                                        setTplKey(firstTpl ? `${firstTpl.name}|${firstTpl.language}` : '');
                                        setVariables({});
                                        setMedia('');
                                    }}
                                >
                                    {info.connections.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.display_phone ?? c.name}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        )}
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="wa-to">{__('Para')}</Label>
                            <Input id="wa-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="+57 300 111 2233" data-testid="imcrm-whatsapp-dialog-to" />
                            {!info.recipient && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('El registro no tiene teléfono: escríbelo con el indicativo del país.')}</p>}
                        </div>

                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-1 imcrm-text-sm" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={kind === 'template'}
                                onClick={() => setKind('template')}
                                className={cn('imcrm-rounded-md imcrm-py-1.5', kind === 'template' ? 'imcrm-bg-card imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground')}
                                data-testid="imcrm-whatsapp-kind-template"
                            >
                                {__('Plantilla')}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={kind === 'text'}
                                onClick={() => setKind('text')}
                                className={cn('imcrm-rounded-md imcrm-py-1.5', kind === 'text' ? 'imcrm-bg-card imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground')}
                                data-testid="imcrm-whatsapp-kind-text"
                            >
                                {__('Mensaje')}
                            </button>
                        </div>

                        {kind === 'text' ? (
                            conn.window_open ? (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="wa-text">{__('Mensaje')}</Label>
                                    <Textarea id="wa-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} data-testid="imcrm-whatsapp-dialog-text" />
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Puedes usar variables del registro, como {{nombre}}.')}</p>
                                </div>
                            ) : (
                                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-amber-50 imcrm-p-2.5 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-bg-amber-500/10 dark:imcrm-text-amber-200" data-testid="imcrm-whatsapp-dialog-closed">
                                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                    {__('La ventana de 24 h está cerrada: WhatsApp sólo deja mandar un mensaje libre si el contacto te escribió en las últimas 24 h. Usa una plantilla.')}
                                </p>
                            )
                        ) : approved.length === 0 ? (
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Esta cuenta no tiene plantillas aprobadas. Créalas en el administrador de WhatsApp de Meta y actualízalas en Ajustes → Integraciones → WhatsApp.')}
                            </p>
                        ) : (
                            <>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="wa-tpl">{__('Plantilla')}</Label>
                                    <Select
                                        id="wa-tpl"
                                        value={tplKey}
                                        onChange={(e) => {
                                            setTplKey(e.target.value);
                                            setVariables({});
                                            setMedia('');
                                        }}
                                        data-testid="imcrm-whatsapp-dialog-template"
                                    >
                                        {approved.map((t) => (
                                            <option key={t.id} value={`${t.name}|${t.language}`}>
                                                {templateOptionLabel(t)}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                                {vars.map((v) => (
                                    <div key={v.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                        <Label className="imcrm-text-xs imcrm-text-muted-foreground">{v.label}</Label>
                                        <Input
                                            value={variables[v.key] ?? ''}
                                            onChange={(e) => setVariables({ ...variables, [v.key]: e.target.value })}
                                            placeholder={v.example ? sprintf(/* translators: %s: ejemplo */ __('Por ejemplo: %s'), v.example) : __('Texto o {{campo}}')}
                                            data-testid={`imcrm-whatsapp-dialog-var-${v.key}`}
                                        />
                                    </div>
                                ))}
                                {mediaFormat && (
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                        <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Enlace público del adjunto (https)')}</Label>
                                        <Input value={media} onChange={(e) => setMedia(e.target.value)} placeholder="https://…" data-testid="imcrm-whatsapp-dialog-media" />
                                    </div>
                                )}
                                {tpl && <WhatsappBubble template={tpl} variables={variables} headerMedia={media} />}
                            </>
                        )}

                        {!info.has_columns && !setupDone && (
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-2.5 imcrm-text-xs imcrm-text-muted-foreground">
                                <span className="imcrm-min-w-0 imcrm-flex-1">
                                    {__('Esta lista todavía no tiene columnas de WhatsApp: el mensaje sale, pero el estado no queda a la vista en la tabla.')}
                                </span>
                                {info.can_setup && (
                                    <Button type="button" size="sm" variant="outline" onClick={() => setup.mutate()} disabled={setup.isPending} data-testid="imcrm-whatsapp-dialog-setup">
                                        {__('Preparar columnas')}
                                    </Button>
                                )}
                            </div>
                        )}

                        {result && <SendReport result={result} />}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {result?.ok ? __('Cerrar') : __('Cancelar')}
                            </Button>
                            {info.can_send ? (
                                <Button type="submit" disabled={!valid || send.isPending} data-testid="imcrm-whatsapp-dialog-send">
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
export function SendWhatsappButton(props: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const off = usePlanModuleOff('integrations');
    return off ? null : <SendWhatsappButtonInner {...props} />;
}
