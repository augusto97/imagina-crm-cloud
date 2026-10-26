import { useContext, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
    whatsappTemplateShape,
    whatsappTemplateVariables,
    type WhatsappSendResult,
    type WhatsappTemplate,
} from '@imagina-base/shared';
import { AlertTriangle, CheckCircle2, ExternalLink, Send } from 'lucide-react';
import { Link } from 'react-router';

import { WhatsappBubble, templateOptionLabel } from '@/cloud/components/whatsapp/whatsappUi';
import { api as cloud } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';
import type { ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { AutomationEditorListContext } from './config-editors';
import { MergeTagInput } from './MergeTagInput';
import { labelMergeTags, readVariables, selectedTemplate } from '@/cloud/components/whatsapp/whatsappHelpers';

/**
 * D3 — Editor de las acciones de WhatsApp oficial: «Enviar plantilla de
 * WhatsApp» (la plantilla REAL aprobada en Meta, sus variables con merge tags
 * y la vista previa) y «Enviar mensaje de texto de WhatsApp» (sólo dentro de
 * la ventana de 24 h). «Probar ahora» manda DE VERDAD al número que se
 * escribe, con las variables resueltas contra un registro real de la lista.
 */

type Values = Record<string, unknown>;

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function useWhatsappConnections() {
    return useQuery({
        queryKey: ['whatsapp-connections'],
        queryFn: () => cloud.whatsappConnections(),
        retry: false,
        staleTime: 60_000,
    });
}

export function WhatsappActionConfig({
    spec,
    onChange,
    fields,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const connectionId = Number(spec.config.connection_id) > 0 ? Number(spec.config.connection_id) : null;
    const actionKey = str(spec.config.action_key);
    const values = (spec.config.values ?? {}) as Values;
    const q = useWhatsappConnections();
    const conn = (q.data ?? []).find((c) => c.id === connectionId) ?? null;
    const templates = conn?.templates ?? [];

    const setValues = (patch: Values): void => {
        onChange({ ...spec, config: { ...spec.config, values: { ...values, ...patch } } });
    };
    const phoneFields = fields.filter((f) => f.type === 'phone');

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-whatsapp-action-config" data-action={actionKey}>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Para (teléfono del contacto)')}
                    <span className="imcrm-text-destructive"> *</span>
                </Label>
                <MergeTagInput
                    value={str(values.to)}
                    onChange={(next) => setValues({ to: next })}
                    fields={fields}
                    placeholder={phoneFields[0] ? `{{${phoneFields[0].slug}}}` : '+57 300 111 2233'}
                    data-testid="imcrm-whatsapp-action-to"
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
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {actionKey === 'send_text' ? (
                <TextFields values={values} fields={fields} setValues={setValues} />
            ) : (
                <TemplateFields values={values} fields={fields} setValues={setValues} templates={templates} loading={q.isLoading} connectionId={connectionId} />
            )}

            {connectionId !== null && <TestSend connectionId={connectionId} kind={actionKey === 'send_text' ? 'text' : 'template'} values={values} />}
        </div>
    );
}

function TextFields({ values, fields, setValues }: { values: Values; fields: FieldEntity[]; setValues: (p: Values) => void }): JSX.Element {
    return (
        <>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Mensaje')}
                    <span className="imcrm-text-destructive"> *</span>
                </Label>
                <MergeTagInput value={str(values.text)} onChange={(next) => setValues({ text: next })} fields={fields} autoGrow data-testid="imcrm-whatsapp-action-text" />
            </div>
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                <input type="checkbox" checked={str(values.preview_url) === 'true'} onChange={(e) => setValues({ preview_url: e.target.checked ? 'true' : 'false' })} />
                {__('Mostrar la vista previa de los enlaces')}
            </label>
            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-amber-50 imcrm-p-2 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-bg-amber-500/10 dark:imcrm-text-amber-200">
                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                {__('Un texto libre sólo sale si el contacto escribió en las últimas 24 h. Si no, la acción falla con «La ventana de 24 h está cerrada: usa una plantilla» y no se envía nada. Para avisos que tú inicias, usa «Enviar plantilla de WhatsApp».')}
            </p>
        </>
    );
}

function TemplateFields({
    values,
    fields,
    setValues,
    templates,
    loading,
    connectionId,
}: {
    values: Values;
    fields: FieldEntity[];
    setValues: (p: Values) => void;
    templates: WhatsappTemplate[];
    loading: boolean;
    connectionId: number | null;
}): JSX.Element {
    const name = str(values.template);
    const language = str(values.language);
    const approved = templates.filter((t) => t.status === 'APPROVED');
    const tpl = selectedTemplate(templates, name, language);
    const vars = useMemo(() => (tpl ? whatsappTemplateVariables(tpl.components, tpl.parameter_format) : []), [tpl]);
    const shape = tpl ? whatsappTemplateShape(tpl.components, tpl.parameter_format) : null;
    const media = shape?.header && shape.header.format !== 'TEXT' && shape.header.format !== 'LOCATION' ? shape.header.format : null;
    const variables = readVariables(values.variables);
    const missing = vars.filter((v) => (variables[v.key] ?? '').trim() === '');
    // En la vista previa una variable del registro se lee como «[Nombre]».
    const previewVars = useMemo(() => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(variables)) out[k] = labelMergeTags(v, fields);
        return out;
    }, [variables, fields]);
    const value = tpl ? `${tpl.name}|${tpl.language}` : name !== '' ? `${name}|${language}` : '';

    return (
        <>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Plantilla')}
                        <span className="imcrm-text-destructive"> *</span>
                    </Label>
                    {connectionId !== null && (
                        <Link to={`/settings/whatsapp/${connectionId}`} target="_blank" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-foreground">
                            <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                            {__('Ver plantillas')}
                        </Link>
                    )}
                </div>
                <Select
                    value={value}
                    onChange={(e) => {
                        const [n, l] = e.target.value.split('|');
                        setValues({ template: n ?? '', language: l ?? '', variables: {}, header_media: '', header_filename: '' });
                    }}
                    data-testid="imcrm-whatsapp-action-template"
                >
                    <option value="">{loading ? __('Cargando…') : __('(elige una plantilla aprobada)')}</option>
                    {approved.map((t) => (
                        <option key={t.id} value={`${t.name}|${t.language}`}>
                            {templateOptionLabel(t)}
                        </option>
                    ))}
                    {name !== '' && !tpl && <option value={value}>{`${name} · ${language} — ${__('ya no está aprobada')}`}</option>}
                </Select>
                {!loading && approved.length === 0 && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Esta cuenta no tiene plantillas aprobadas. Créalas en Meta y toca «Actualizar plantillas» en la página de la conexión.')}
                    </p>
                )}
                {tpl && tpl.status !== 'APPROVED' && (
                    <p className="imcrm-text-xs imcrm-text-destructive">{__('Esta plantilla ya no está aprobada en Meta: la acción va a fallar hasta que elijas otra.')}</p>
                )}
                {name !== '' && !tpl && !loading && (
                    <p className="imcrm-text-xs imcrm-text-destructive">{__('La plantilla guardada ya no existe en Meta (o se borró): elige otra.')}</p>
                )}
            </div>

            {vars.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2.5" data-testid="imcrm-whatsapp-action-vars">
                    <p className="imcrm-text-xs imcrm-font-medium">{__('Variables de la plantilla')}</p>
                    {vars.map((v) => (
                        <div key={v.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{v.label}</Label>
                            <MergeTagInput
                                value={variables[v.key] ?? ''}
                                onChange={(next) => setValues({ variables: { ...variables, [v.key]: next } })}
                                fields={fields}
                                placeholder={v.example ? sprintf(/* translators: %s: ejemplo */ __('Por ejemplo: %s'), v.example) : ''}
                                data-testid={`imcrm-whatsapp-var-${v.key}`}
                            />
                        </div>
                    ))}
                </div>
            )}

            {media && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                        {media === 'IMAGE' ? __('Enlace de la imagen (https)') : media === 'VIDEO' ? __('Enlace del video (https)') : __('Enlace del documento (https)')}
                        <span className="imcrm-text-destructive"> *</span>
                    </Label>
                    <MergeTagInput
                        value={str(values.header_media)}
                        onChange={(next) => setValues({ header_media: next })}
                        fields={fields}
                        placeholder="https://… o {{pdf.link}}"
                        data-testid="imcrm-whatsapp-action-media"
                    />
                    {media === 'DOCUMENT' && (
                        <MergeTagInput
                            value={str(values.header_filename)}
                            onChange={(next) => setValues({ header_filename: next })}
                            fields={fields}
                            placeholder={__('Nombre del archivo (opcional), ej. Factura {{numero}}.pdf')}
                        />
                    )}
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Tiene que ser un enlace público: Meta lo descarga al enviar. Puedes usar el enlace de un PDF generado en una acción anterior ({{pdf.link}}).')}
                    </p>
                </div>
            )}

            {tpl && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Así lo verá el contacto (las variables se completan con cada registro):')}</p>
                    <WhatsappBubble template={tpl} variables={previewVars} headerMedia={labelMergeTags(str(values.header_media), fields)} />
                    {missing.length > 0 && (
                        <p className="imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-whatsapp-action-missing">
                            {sprintf(/* translators: %s: lista de variables */ __('Falta completar: %s.'), missing.map((v) => v.label).join(', '))}
                        </p>
                    )}
                </div>
            )}
        </>
    );
}

function TestSend({ connectionId, kind, values }: { connectionId: number; kind: 'template' | 'text'; values: Values }): JSX.Element {
    const listId = useContext(AutomationEditorListContext);
    const [to, setTo] = useState('');
    const [result, setResult] = useState<WhatsappSendResult | null>(null);
    const run = useMutation({
        mutationFn: () => cloud.whatsappTestSend(listId ?? 0, { connection_id: connectionId, to, kind, values }),
        onSuccess: setResult,
        onError: (err) =>
            setResult({
                ok: false,
                message_id: null,
                to,
                text: '',
                status: null,
                error: err instanceof CloudApiError || err instanceof Error ? err.message : String(err),
                request: null,
                response: null,
            }),
    });
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="imcrm-whatsapp-test">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Probar ahora (se envía de verdad)')}</Label>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder={__('Tu número, ej. +57 300 111 2233')}
                    className="imcrm-h-8 imcrm-max-w-[16rem] imcrm-flex-1"
                    data-testid="imcrm-whatsapp-test-to"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending || to.trim() === ''} data-testid="imcrm-whatsapp-test-send">
                    <Send className="imcrm-h-3.5 imcrm-w-3.5" />
                    {run.isPending ? __('Enviando…') : __('Probar ahora')}
                </Button>
            </div>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Las variables se completan con el último registro de la lista que puedes ver. La prueba no cambia ningún registro.')}
            </p>
            {result && <SendReport result={result} />}
        </div>
    );
}

export function SendReport({ result }: { result: WhatsappSendResult }): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5 imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2 imcrm-text-xs" data-testid="imcrm-whatsapp-send-report" data-ok={result.ok ? '1' : '0'}>
            {result.ok ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                    <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    {sprintf(/* translators: %s: teléfono */ __('Enviado a %s. Meta lo aceptó; el estado (entregado, leído) llega solo.'), result.to)}
                </p>
            ) : (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-font-medium imcrm-text-destructive">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {result.error ?? __('No se pudo enviar.')}
                </p>
            )}
            {result.text !== '' && <p className="imcrm-whitespace-pre-wrap imcrm-text-muted-foreground">{result.text}</p>}
            {(result.request || result.response) && (
                <details>
                    <summary className="imcrm-cursor-pointer imcrm-text-muted-foreground">{__('Ver lo que se envió a Meta y su respuesta')}</summary>
                    {result.request && (
                        <pre className="imcrm-mt-1 imcrm-max-h-48 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded imcrm-bg-background imcrm-p-2 imcrm-text-[11px]">
                            {`POST ${result.request.url}\n\n${prettyJson(result.request.body)}`}
                        </pre>
                    )}
                    {result.response && (
                        <pre className="imcrm-mt-1 imcrm-max-h-48 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded imcrm-bg-background imcrm-p-2 imcrm-text-[11px]">
                            {`HTTP ${result.response.status}\n\n${prettyJson(result.response.body)}`}
                        </pre>
                    )}
                </details>
            )}
        </div>
    );
}

function prettyJson(body: string): string {
    try {
        return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
        return body;
    }
}

/** «Cuando llega un mensaje de WhatsApp»: de cualquier número de la empresa o de uno. */
export function WhatsappTriggerConfig({ config, onChange }: { config: TriggerConfig; onChange: (next: TriggerConfig) => void }): JSX.Element {
    const q = useWhatsappConnections();
    const conns = q.data ?? [];
    const value = Number(config.connection_id) > 0 ? String(config.connection_id) : '';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-whatsapp-config">
            <Label htmlFor="trigger-whatsapp-connection">{__('Número de WhatsApp')}</Label>
            <Select
                id="trigger-whatsapp-connection"
                value={value}
                onChange={(e) => {
                    const next: TriggerConfig = { ...config };
                    if (e.target.value === '') delete next.connection_id;
                    else next.connection_id = Number(e.target.value);
                    onChange(next);
                }}
            >
                <option value="">{__('Cualquiera de la empresa')}</option>
                {conns.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.display_phone ? `${c.display_phone} · ${c.name}` : c.name}
                    </option>
                ))}
            </Select>
            {!q.isLoading && conns.length === 0 && (
                <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                    {__('Todavía no hay una cuenta de WhatsApp Business conectada: conéctala en Ajustes → Integraciones.')}
                </p>
            )}
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Para que se dispare en esta lista, la lista tiene que ser la elegida en «Dónde caen los mensajes» de la conexión.')}
            </p>
        </div>
    );
}
