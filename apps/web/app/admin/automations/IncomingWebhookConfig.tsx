import { useContext, useMemo, useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw } from 'lucide-react';
import {
    defaultMatchKey,
    readWebhookRecordConfig,
    WEBHOOK_MATCH_FIELD_TYPES,
    webhookExamplePayload,
    webhookMatchFieldError,
    webhookModeSearches,
    writeWebhookRecordConfig,
    type WebhookRecordConfig,
    type WebhookRecordMode,
} from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useClearHookSecret, useHookCaptures, useHookSecret, useSetHookSecret, type HookCaptureEntity } from '@/hooks/useAutomations';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { AutomationEditorAutomationContext } from './flowContext';
import { flattenPayload, type FlatEntry } from './webhookPayload';

type TriggerConfig = Record<string, unknown>;

const MODES: ReadonlyArray<{ value: WebhookRecordMode; label: string; hint: string }> = [
    { value: 'none', label: __('Nada'), hint: __('Sólo usa los datos del JSON como variables. Ninguna acción tiene un registro.') },
    { value: 'create', label: __('Crear uno nuevo'), hint: __('Crea un registro con los datos del JSON cuyo nombre coincide con un campo de la lista.') },
    {
        value: 'update',
        label: __('Actualizar uno existente'),
        hint: __('Busca el registro y las acciones corren sobre él. Si no lo encuentra, la corrida queda «Cancelada» con el motivo y no se crea nada.'),
    },
    { value: 'upsert', label: __('Actualizar o crear'), hint: __('Si encuentra el registro lo actualiza; si no, crea uno nuevo.') },
];

/**
 * v0.1.110 / v0.1.399 — Webhook ENTRANTE: la URL pública (token opaco que
 * genera el backend al guardar), el secreto opcional, qué hacer con el
 * registro (nada, crear, actualizar, actualizar o crear), cómo buscarlo, el
 * JSON de ejemplo que se arma solo y la prueba con los datos que llegan.
 */
export function IncomingWebhookConfig({
    config,
    onChange,
    fields,
}: {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const token = typeof config.webhook_token === 'string' ? config.webhook_token : '';
    const url = token !== '' ? `${window.location.origin}/api/v1/public/hooks/${token}` : '';
    const rc = readWebhookRecordConfig(config);
    const automationId = useContext(AutomationEditorAutomationContext);
    const secret = useHookSecret(token !== '' ? automationId : undefined);
    const secretOn = secret.data?.enabled === true;

    const setRc = (patch: Partial<WebhookRecordConfig>): void => {
        const next: WebhookRecordConfig = { ...rc, ...patch };
        // La clave por defecto sigue a la búsqueda mientras nadie la cambió a mano.
        if (patch.match && rc.matchKey === defaultMatchKey(rc.match)) next.matchKey = defaultMatchKey(patch.match);
        const { record_mode: _m, match: _x, match_key: _k, apply_payload_fields: _a, ...rest } = config;
        onChange({ ...rest, ...writeWebhookRecordConfig(next) });
    };

    // Campos por los que se puede buscar: los que no se repiten (o un ID automático).
    const candidates = fields.filter((f) => (WEBHOOK_MATCH_FIELD_TYPES as readonly string[]).includes(f.type));
    const matchError =
        webhookModeSearches(rc.mode) && rc.match.by === 'field'
            ? webhookMatchFieldError(fields.find((f) => f.slug === (rc.match as { field: string }).field))
            : null;
    const example = useMemo(
        () =>
            webhookExamplePayload(
                rc,
                fields.map((f) => ({ slug: f.slug, type: f.type, label: f.label, config: f.config, is_primary: f.is_primary })),
                rc.mode === 'none' || rc.mode === 'update' ? { extra: { respuesta: '2' } } : {},
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(rc), fields],
    );
    const exampleJson = JSON.stringify(example, null, 2);
    const curl = url
        ? [`curl -X POST '${url}'`, `  -H 'Content-Type: application/json'`, ...(secretOn ? [`  -H 'X-Webhook-Secret: TU_SECRETO'`] : []), `  -d '${JSON.stringify(example)}'`].join(' \\\n')
        : '';

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-border-t imcrm-border-border imcrm-pt-3" data-tour="automation-webhook-trigger">
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <Label>{__('URL pública del webhook')}</Label>
                {url !== '' ? (
                    <>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Input readOnly value={url} className="imcrm-flex-1 imcrm-font-mono imcrm-text-xs" aria-label={__('URL del webhook')} data-testid="webhook-url" />
                            <CopyButton text={url} label={__('Copiar')} />
                        </div>
                        <button
                            type="button"
                            onClick={() => onChange({ ...config, webhook_token: '' })}
                            className="imcrm-self-start imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-destructive"
                        >
                            {__('Regenerar URL (la actual deja de funcionar al guardar)')}
                        </button>
                    </>
                ) : (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Guarda la automatización para generar la URL pública única.')}
                    </p>
                )}
                {url !== '' && automationId !== undefined && <SecretSection automationId={automationId} enabled={secretOn} hint={secret.data?.hint ?? null} />}
            </section>

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="webhook-record-mode">
                <Label>{__('Qué hacer con el registro')}</Label>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5 sm:imcrm-grid-cols-4" role="radiogroup" aria-label={__('Qué hacer con el registro')}>
                    {MODES.map((m) => (
                        <button
                            key={m.value}
                            type="button"
                            role="radio"
                            aria-checked={rc.mode === m.value}
                            data-testid={`webhook-mode-${m.value}`}
                            onClick={() => setRc({ mode: m.value })}
                            className={cn(
                                'imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                rc.mode === m.value
                                    ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-foreground'
                                    : 'imcrm-border-border imcrm-bg-card imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                            )}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
                <p className="imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">{MODES.find((m) => m.value === rc.mode)?.hint}</p>

                {webhookModeSearches(rc.mode) && (
                    <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-3 sm:imcrm-grid-cols-2">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="webhook-match-by" className="imcrm-text-xs">
                                {__('Buscar por')}
                            </Label>
                            <Select
                                id="webhook-match-by"
                                className="imcrm-h-8 imcrm-text-xs"
                                value={rc.match.by === 'field' ? `field:${rc.match.field}` : 'record_id'}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setRc({ match: v === 'record_id' ? { by: 'record_id' } : { by: 'field', field: v.slice('field:'.length) } });
                                }}
                                data-testid="webhook-match-by"
                            >
                                <option value="record_id">{__('El id del registro')}</option>
                                {candidates.map((f) => {
                                    const err = webhookMatchFieldError(f);
                                    return (
                                        <option key={f.id} value={`field:${f.slug}`} disabled={err !== null}>
                                            {f.label}
                                            {err !== null ? ` — ${__('márcalo «Sin repetidos»')}` : ''}
                                        </option>
                                    );
                                })}
                            </Select>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="webhook-match-key" className="imcrm-text-xs">
                                {__('Clave en el JSON')}
                            </Label>
                            <Input
                                id="webhook-match-key"
                                className="imcrm-h-8 imcrm-font-mono imcrm-text-xs"
                                value={rc.matchKey}
                                placeholder={defaultMatchKey(rc.match)}
                                onChange={(e) => {
                                    const v = e.target.value.trim();
                                    const { record_mode: _m, match: _x, match_key: _k, apply_payload_fields: _a, ...rest } = config;
                                    onChange({ ...rest, ...writeWebhookRecordConfig(rc), match_key: v === '' ? defaultMatchKey(rc.match) : v });
                                }}
                                data-testid="webhook-match-key"
                            />
                        </div>
                        <p className="imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground sm:imcrm-col-span-2">
                            {rc.match.by === 'record_id'
                                ? __('El id es único en toda la app: nunca puede haber dos. Un id de otra lista cuenta como «no encontrado». Para un dato anidado usa puntos: data.id.')
                                : __('Sólo se busca por un campo marcado «Sin repetidos» (o un ID automático): nunca hay dos registros con el mismo valor. Un teléfono se compara sin importar el formato.')}
                        </p>
                        {matchError && (
                            <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/5 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs imcrm-text-destructive sm:imcrm-col-span-2" role="alert">
                                {matchError}
                            </p>
                        )}
                        <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs imcrm-text-foreground sm:imcrm-col-span-2">
                            <input
                                type="checkbox"
                                className="imcrm-mt-0.5"
                                checked={rc.applyPayloadFields}
                                onChange={(e) => setRc({ applyPayloadFields: e.target.checked })}
                                data-testid="webhook-apply-fields"
                            />
                            <span>
                                {__('Escribir también los datos del JSON en los campos con el mismo nombre')}
                                <span className="imcrm-block imcrm-text-muted-foreground">
                                    {rc.mode === 'upsert'
                                        ? __('Al crear siempre se escriben; esto es para cuando lo encuentra.')
                                        : __('Por ejemplo, si llega "nota": "…" y la lista tiene el campo nota.')}
                                </span>
                            </span>
                        </label>
                    </div>
                )}
            </section>

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="webhook-example">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <Label>{__('Ejemplo del JSON que tienes que enviar')}</Label>
                    <CopyButton text={exampleJson} label={__('Copiar')} />
                </div>
                <pre className="imcrm-max-h-56 imcrm-overflow-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-font-mono imcrm-text-xs imcrm-text-foreground" data-testid="webhook-example-json">
                    {exampleJson}
                </pre>
                {curl !== '' && (
                    <details className="imcrm-text-xs">
                        <summary className="imcrm-cursor-pointer imcrm-text-muted-foreground hover:imcrm-text-foreground">{__('Probar desde la terminal (curl)')}</summary>
                        <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <pre className="imcrm-overflow-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-font-mono imcrm-text-[11px]">{curl}</pre>
                            <CopyButton text={curl} label={__('Copiar el comando')} />
                        </div>
                    </details>
                )}
                <p className="imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                    {__('Envíalo por POST, en formato JSON. Todo lo que llega queda disponible como {{payload.nombre}} (con puntos para lo anidado: {{payload.data.id}}). ')}
                    {rc.mode === 'none'
                        ? __('Los datos que se llaman como un campo de la lista también funcionan como {{campo}}.')
                        : __('Con registro, {{campo}} y {{record.id}} son los del registro: para que otro sistema te lo devuelva, mándale {{record.id}} en «Llamar webhook externo».')}
                </p>
            </section>

            {token !== '' && <WebhookTestPanel fields={fields} rc={rc} />}
        </div>
    );
}

/** v0.1.399 — secreto opcional: se genera (o se pega uno propio) y se ve una sola vez. */
function SecretSection({ automationId, enabled, hint }: { automationId: number; enabled: boolean; hint: string | null }): JSX.Element {
    const set = useSetHookSecret(automationId);
    const clear = useClearHookSecret(automationId);
    const [shown, setShown] = useState<string | null>(null);
    const [own, setOwn] = useState(false);
    const [ownValue, setOwnValue] = useState('');
    const error = (set.error ?? clear.error) as { message?: string } | null;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-3" data-testid="webhook-secret">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-foreground">
                    <KeyRound className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {enabled ? __('Pide un secreto') : __('Secreto (opcional)')}
                    {enabled && hint && (
                        <Badge variant="secondary" className="imcrm-font-mono imcrm-text-[10px]">
                            ····{hint}
                        </Badge>
                    )}
                </span>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={set.isPending}
                        onClick={() => set.mutate(undefined, { onSuccess: (d) => setShown(d.secret) })}
                        data-testid="webhook-secret-generate"
                    >
                        {enabled ? <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> : null}
                        {enabled ? __('Generar otro') : __('Pedir un secreto')}
                    </Button>
                    {!enabled && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setOwn((v) => !v)}>
                            {__('Usar uno propio')}
                        </Button>
                    )}
                    {enabled && (
                        <Button type="button" size="sm" variant="ghost" disabled={clear.isPending} onClick={() => (setShown(null), clear.mutate())} data-testid="webhook-secret-clear">
                            {__('Quitar')}
                        </Button>
                    )}
                </div>
            </div>
            <p className="imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                {enabled
                    ? __('Cada envío tiene que traer la cabecera X-Webhook-Secret (o Authorization: Bearer) con el secreto. Sin él responde 401 y no corre nada.')
                    : __('Además de la URL, puedes exigir un secreto en una cabecera: así, aunque alguien vea la URL, no puede dispararla.')}
            </p>
            {own && !enabled && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Input
                        value={ownValue}
                        onChange={(e) => setOwnValue(e.target.value)}
                        placeholder={__('Al menos 16 caracteres, sin espacios')}
                        className="imcrm-h-8 imcrm-flex-1 imcrm-font-mono imcrm-text-xs"
                        aria-label={__('Tu secreto')}
                    />
                    <Button
                        type="button"
                        size="sm"
                        disabled={ownValue.trim().length < 16 || set.isPending}
                        onClick={() => set.mutate(ownValue.trim(), { onSuccess: (d) => (setShown(d.secret), setOwn(false), setOwnValue('')) })}
                    >
                        {__('Guardar')}
                    </Button>
                </div>
            )}
            {shown && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-success/40 imcrm-bg-success/5 imcrm-p-2.5" data-testid="webhook-secret-shown">
                    <span className="imcrm-text-xs imcrm-font-medium imcrm-text-foreground">{__('Cópialo ahora: no se vuelve a mostrar.')}</span>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Input readOnly value={shown} className="imcrm-h-8 imcrm-flex-1 imcrm-font-mono imcrm-text-xs" aria-label={__('Secreto del webhook')} />
                        <CopyButton text={shown} label={__('Copiar')} />
                    </div>
                </div>
            )}
            {error?.message && (
                <p className="imcrm-text-xs imcrm-text-destructive" role="alert">
                    {error.message}
                </p>
            )}
        </div>
    );
}

function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            className="imcrm-shrink-0 imcrm-gap-1.5"
            onClick={() => {
                void navigator.clipboard?.writeText(text).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                });
            }}
        >
            {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
            {copied ? __('¡Copiado!') : label}
        </Button>
    );
}

function relativeTime(iso: string): string {
    const diffS = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (diffS < 60) return __('hace segundos');
    if (diffS < 3600) return `${__('hace')} ${Math.round(diffS / 60)} min`;
    return `${__('hace')} ${Math.round(diffS / 3600)} h`;
}

const MATCH_TONE: Record<NonNullable<HookCaptureEntity['match']>['kind'], string> = {
    none: 'imcrm-border-border imcrm-bg-muted/40 imcrm-text-muted-foreground',
    found: 'imcrm-border-success/40 imcrm-bg-success/10 imcrm-text-foreground',
    create: 'imcrm-border-primary/40 imcrm-bg-primary/10 imcrm-text-foreground',
    not_found: 'imcrm-border-warning/50 imcrm-bg-warning/10 imcrm-text-foreground',
    error: 'imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-text-destructive',
};

/**
 * v0.1.111 — «Probar el webhook»: el ÚLTIMO dato recibido aplanado clave por
 * clave con su variable copiable. v0.1.399 — además, qué registro encontraría
 * con la búsqueda que se está editando (sin guardar).
 */
function WebhookTestPanel({ fields, rc }: { fields: FieldEntity[]; rc: WebhookRecordConfig }): JSX.Element | null {
    const automationId = useContext(AutomationEditorAutomationContext);
    const [listening, setListening] = useState(false);
    const [copiedTag, setCopiedTag] = useState('');
    const captures = useHookCaptures(automationId, listening, {
        record_mode: rc.mode,
        match_by: rc.match.by,
        ...(rc.match.by === 'field' ? { match_field: rc.match.field } : {}),
        match_key: rc.matchKey,
    });

    if (automationId === undefined) return null;

    const latest = captures.data?.[0];
    const rows: FlatEntry[] = [];
    if (latest) flattenPayload(latest.payload, '', rows);
    const bySlug = new Map(fields.map((f) => [f.slug, f]));

    const copyTag = (tag: string): void => {
        void navigator.clipboard?.writeText(tag).then(() => {
            setCopiedTag(tag);
            window.setTimeout(() => setCopiedTag(''), 1500);
        });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-3" data-testid="webhook-test-panel">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Probar el webhook')}</span>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    {listening && (
                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                            <span className="imcrm-h-2 imcrm-w-2 imcrm-animate-pulse imcrm-rounded-full imcrm-bg-primary" />
                            {__('Escuchando…')}
                        </span>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            if (!listening) void captures.refetch();
                            setListening((v) => !v);
                        }}
                    >
                        {listening ? __('Detener') : __('Escuchar datos de prueba')}
                    </Button>
                </div>
            </div>
            {latest === undefined ? (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Todavía no llegó ningún dato. Toca «Escuchar datos de prueba» y envía un POST a la URL de arriba desde tu formulario u otra plataforma: aquí vas a ver qué llega, cómo mapearlo y a qué registro iría.')}
                </p>
            ) : (
                <>
                    {latest.match && (
                        <p className={cn('imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs', MATCH_TONE[latest.match.kind])} data-testid="webhook-test-match">
                            {latest.match.message}
                        </p>
                    )}
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Último dato recibido')} {relativeTime(latest.received_at)}
                        {(captures.data?.length ?? 0) > 1 ? ` · ${captures.data!.length} ${__('capturas en 24 h')}` : ''}
                        {' — '}
                        {__('toca una variable para copiarla y usarla en las acciones.')}
                    </p>
                    <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card">
                        {rows.map((row) => {
                            const field = row.path.includes('.') ? undefined : bySlug.get(row.path);
                            const tag = field !== undefined && rc.mode === 'none' ? `{{${row.path}}}` : `{{payload.${row.path}}}`;
                            return (
                                <div key={row.path} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-2.5 imcrm-py-1.5">
                                    <div className="imcrm-min-w-0 imcrm-flex-1">
                                        <span className="imcrm-block imcrm-truncate imcrm-font-mono imcrm-text-xs imcrm-text-foreground">{row.path}</span>
                                        <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{row.value}</span>
                                    </div>
                                    {field !== undefined && (
                                        <Badge variant="secondary" className="imcrm-shrink-0 imcrm-text-[10px]">
                                            {__('campo')} «{field.label}»
                                        </Badge>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => copyTag(tag)}
                                        title={__('Copiar variable')}
                                        className="imcrm-shrink-0 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                    >
                                        {copiedTag === tag ? __('¡Copiado!') : tag}
                                    </button>
                                </div>
                            );
                        })}
                        {rows.length === 0 && <p className="imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">{__('El JSON llegó vacío.')}</p>}
                    </div>
                </>
            )}
        </div>
    );
}
