import { useContext, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Connection, SmsSendResult } from '@imagina-base/shared';
import { MessageSquareText, Send } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { SmsCounter, SmsSendReport, hasMergeTags } from '@/cloud/components/sms/smsUi';
import { api as cloud } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import type { ActionSpec } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { AutomationEditorListContext } from './config-editors';
import { MergeTagInput } from './MergeTagInput';

/**
 * SMS (ADR-S82) — Editor de «Enviar SMS»: destino (con variables), mensaje con
 * el contador de SMS (la misma función que usa el envío), remitente opcional,
 * «Quitar tildes» y «Respetar el horario» de la Ley 2300. «Probar ahora»
 * resuelve las variables contra un registro real y NO manda nada;
 * «Enviarme una prueba» sí, al número que se escribe.
 */

type Values = Record<string, unknown>;

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function bool(v: unknown): boolean {
    return v === true || v === 'true' || v === '1';
}

export function SmsActionConfig({
    spec,
    onChange,
    fields,
    connection,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
    connection: Connection;
}): JSX.Element {
    const listId = useContext(AutomationEditorListContext);
    const values = (spec.config.values ?? {}) as Values;
    const setValues = (patch: Values): void => {
        onChange({ ...spec, config: { ...spec.config, values: { ...values, ...patch } } });
    };
    const phoneFields = fields.filter((f) => f.type === 'phone');
    const message = str(values.message);
    const strip = bool(values.strip_accents);
    const respect = bool(values.respect_hours);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-sms-action-config">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <IntegrationLogo integrationKey={connection.integration_key} size={24} />
                <p className="imcrm-min-w-0 imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-font-medium imcrm-text-foreground">{connection.name}</span> · {__('Manda un SMS y deja en el registro la fecha y el estado de entrega.')}
                </p>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Para (teléfono)')}
                    <span className="imcrm-text-destructive"> *</span>
                </Label>
                <MergeTagInput
                    value={str(values.to)}
                    onChange={(next) => setValues({ to: next })}
                    fields={fields}
                    placeholder={phoneFields[0] ? `{{${phoneFields[0].slug}}}` : '+57 300 111 2233'}
                    data-testid="imcrm-sms-action-to"
                />
                {str(values.to).trim() === '' && phoneFields.length > 0 && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Usar:')}
                        {phoneFields.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                className="imcrm-rounded imcrm-border imcrm-border-border imcrm-px-1.5 imcrm-py-0.5 hover:imcrm-bg-accent"
                                onClick={() => setValues({ to: `{{${f.slug}}}` })}
                                data-testid={`imcrm-sms-action-to-${f.slug}`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                )}
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Un número sin indicativo toma el país de la conexión (Colombia si no dice otro).')}</p>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Mensaje')}
                    <span className="imcrm-text-destructive"> *</span>
                </Label>
                <MergeTagInput value={message} onChange={(next) => setValues({ message: next })} fields={fields} rows={3} autoGrow data-testid="imcrm-sms-action-message" />
                <SmsCounter text={message} stripAccents={strip} onStripAccents={(next) => setValues({ strip_accents: next ? 'true' : 'false' })} hasVariables={hasMergeTags(message)} />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Remitente (opcional)')}</Label>
                <MergeTagInput value={str(values.sender)} onChange={(next) => setValues({ sender: next })} fields={fields} placeholder={__('Vacío = el de la conexión')} />
            </div>

            <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                <input
                    type="checkbox"
                    checked={respect}
                    onChange={(e) => setValues({ respect_hours: e.target.checked ? 'true' : 'false' })}
                    className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5"
                    data-testid="imcrm-sms-action-respect-hours"
                />
                <span>
                    <span className="imcrm-font-medium">{__('Respetar el horario para mensajes comerciales y de cobranza (Ley 2300 de 2023)')}</span>
                    <span className="imcrm-block imcrm-text-muted-foreground">
                        {__('Lunes a viernes de 7:00 a. m. a 7:00 p. m. y sábados de 8:00 a. m. a 3:00 p. m., en la zona horaria de la empresa; nunca domingos ni festivos. Fuera de ese horario el SMS queda programado para el siguiente momento permitido. Es una ayuda: confirma con tu abogado qué aplica a tus mensajes.')}
                    </span>
                </span>
            </label>

            {listId !== undefined && <SmsTest listId={listId} connectionId={connection.id} values={values} />}
        </div>
    );
}

function SmsTest({ listId, connectionId, values }: { listId: number; connectionId: number; values: Values }): JSX.Element {
    const [to, setTo] = useState('');
    const [result, setResult] = useState<SmsSendResult | null>(null);
    const run = useMutation({
        mutationFn: (send: boolean) => cloud.smsTestSend(listId, { connection_id: connectionId, values, send, ...(send ? { to: to.trim() } : {}) }),
        onSuccess: (r) => setResult(r),
        onError: (err: unknown) =>
            setResult({
                ok: false,
                status: null,
                message_id: null,
                provider_message_id: null,
                to,
                text: '',
                segments: 0,
                encoding: 'gsm7',
                scheduled_for: null,
                error: err instanceof CloudApiError || err instanceof Error ? err.message : String(err),
                request: null,
                response: null,
            }),
    });
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="imcrm-sms-test">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => run.mutate(false)} disabled={run.isPending} data-testid="imcrm-sms-test-preview">
                    <MessageSquareText className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Probar ahora')}
                </Button>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Completa las variables con un registro real y muestra lo que saldría. No envía nada.')}</span>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder={__('Tu número, ej. +57 300 111 2233')}
                    inputMode="tel"
                    className="imcrm-h-8 imcrm-max-w-[16rem] imcrm-flex-1"
                    data-testid="imcrm-sms-test-to"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending || to.trim() === ''} data-testid="imcrm-sms-test-send">
                    <Send className="imcrm-h-3.5 imcrm-w-3.5" />
                    {run.isPending ? __('Enviando…') : __('Enviarme una prueba')}
                </Button>
            </div>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('La prueba va a tu número (se cobra como un SMS) y no cambia ningún registro.')}</p>
            {result && <SmsSendReport result={result} />}
        </div>
    );
}
