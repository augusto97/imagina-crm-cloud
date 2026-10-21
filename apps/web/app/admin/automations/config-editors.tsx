import { createContext, useContext, useMemo, useState } from 'react';
import { ChevronRight, Play, Plus, Repeat, Send, Trash2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { BulkEditActionConfig } from './BulkEditActionConfig';
import { MergeTagInput } from './MergeTagInput';
import { ConditionEditor, type ConditionRule } from './ConditionEditor';
import { FilterOptionPicker } from '../records/FilterOptionPicker';
import { extractFieldOptions } from '../records/fieldOptions';
import { useFields } from '@/hooks/useFields';
import { useHookCaptures } from '@/hooks/useAutomations';
import { useLists } from '@/hooks/useLists';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import {
    cronError,
    describeWait,
    FOR_EACH_MAX_ITEMS,
    readWaitConfig,
    RESPONSE_NAME_RE,
    SCHEDULED_EACH_MAX,
    scheduleParts,
    scheduleTimeZone,
    timeZoneLabel,
    WAIT_UNITS,
    waitConfigProblem,
    type Connection,
    type ConnectorParam,
} from '@imagina-base/shared';
import { FilterGroupView } from '@/admin/records/FilterGroupView';
import { emptyTree } from '@/admin/records/filterTree';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import type { FilterTree } from '@/types/record';
import { TimeZoneSelect } from '@/components/TimeZoneSelect';
import { browserTimeZone, getTenantTimeZone } from '@/lib/tenantFormat';
import type {
    ActionMeta,
    ActionSpec,
    AutomationEntity,
    TriggerConfig,
} from '@/types/automation';
import type { FieldEntity } from '@/types/field';
import type { WebhookTestResult } from '@imagina-base/shared';
import { ActionTypeSelect } from './ActionTypeSelect';
import { SendEmailConfig } from './email/SendEmailConfig';
import { GeneratePdfConfig } from '../documents/GeneratePdfConfig';
import { useForms } from '../forms/useForms';
import { ActionTypeMenu } from './ActionTypeMenu';
import { ifElseDepth, insideLoop, type SeqPath } from './actionsTree';
import { LoopItemProvider, StepScope, useLoopItem, useRememberSample, useStepPath } from './flowContext';

/**
 * Editores de configuración del módulo de automatizaciones, compartidos
 * entre el editor de página completa (`AutomationEditorPage`) y los
 * sub-editores anidados (ramas de `if_else`). Antes vivían dentro del
 * modal `AutomationDialog` (eliminado en v0.1.90).
 */

/**
 * Context para exponer el `listId` actual a componentes profundos
 * del editor (FilterRow, FieldValueInput, etc.) sin prop-drilling.
 * Lo setea la página del editor al montar y lo consume cualquier
 * `<AutocompleteInput>` que necesite resolver valores distintos
 * desde el endpoint del backend.
 */
export const AutomationEditorListContext = createContext<number | undefined>(undefined);

export function useAutomationListId(): number | undefined {
    return useContext(AutomationEditorListContext);
}

/**
 * v0.1.111 — id de la automatización que se está editando (undefined en un
 * alta sin guardar). Lo setea `AutomationEditorPage`; lo consume el panel
 * "Probar el webhook" para leer las capturas de prueba del backend.
 */
export const AutomationEditorAutomationContext = createContext<number | undefined>(undefined);

export interface AutomationFormState {
    name: string;
    description: string;
    triggerType: string;
    triggerConfig: TriggerConfig;
    actions: ActionSpec[];
    isActive: boolean;
}

export const EMPTY_AUTOMATION_STATE: AutomationFormState = {
    name: '',
    description: '',
    triggerType: 'record_created',
    triggerConfig: {},
    actions: [],
    isActive: true,
};

export function fromAutomation(a: AutomationEntity): AutomationFormState {
    return {
        name: a.name,
        description: a.description ?? '',
        triggerType: a.trigger_type,
        triggerConfig: { ...a.trigger_config },
        // OJO: conservar `condition` — reconstruir la acción solo con
        // {type, config} hacía que al REABRIR el editor la condición por
        // acción desapareciera (y un re-guardado la borraba de la DB en
        // silencio).
        actions: a.actions.map((s) => ({
            type: s.type,
            config: { ...s.config },
            ...(s.condition !== undefined && s.condition !== null ? { condition: s.condition } : {}),
        })),
        isActive: a.is_active,
    };
}

export function cleanTriggerConfig(c: TriggerConfig): TriggerConfig {
    const out: TriggerConfig = {};
    if (c.field_filters && typeof c.field_filters === 'object') {
        const ff = c.field_filters as Record<string, unknown>;
        if (Object.keys(ff).length > 0) out.field_filters = ff;
    }
    if (Array.isArray(c.changed_fields) && c.changed_fields.length > 0) {
        out.changed_fields = c.changed_fields;
    }
    // field_changed
    if (typeof c.field === 'string' && c.field !== '') out.field = c.field;
    if (c.from_value !== undefined && c.from_value !== null && c.from_value !== '') {
        out.from_value = c.from_value;
    }
    if (c.to_value !== undefined && c.to_value !== null && c.to_value !== '') {
        out.to_value = c.to_value;
    }
    // scheduled (v0.1.221: además hora, día, zona horaria y un cron avanzado)
    if (typeof c.frequency === 'string' && c.frequency !== '') out.frequency = c.frequency;
    for (const k of ['hour', 'minute', 'weekday', 'day'] as const) if (typeof c[k] === 'number') out[k] = c[k];
    if (typeof c.tz === 'string' && c.tz !== '') out.tz = c.tz;
    if (typeof c.cron === 'string' && c.cron.trim() !== '') out.cron = c.cron.trim();
    // due_date_reached
    if (typeof c.due_field === 'string' && c.due_field !== '') out.due_field = c.due_field;
    if (typeof c.offset_minutes === 'number') out.offset_minutes = c.offset_minutes;
    // Fechas anteriores al alta de la automatización: por defecto NO disparan.
    if (c.include_past === true) out.include_past = true;
    // incoming_webhook: CONSERVAR el token — si se pierde en un guardado, el
    // backend rota la URL y los sistemas externos quedan apuntando a un 404.
    // (Regenerar = mandar el config SIN token a propósito.)
    if (typeof c.webhook_token === 'string' && c.webhook_token !== '') out.webhook_token = c.webhook_token;
    // form_submitted (v0.1.275): sólo un formulario; sin él, cualquiera.
    if (typeof c.form_id === 'number' && c.form_id > 0) out.form_id = c.form_id;
    // v0.1.289 — programado «para cada registro que cumpla…».
    if (c.for_each_record === true) {
        out.for_each_record = true;
        if (c.records_filter && typeof c.records_filter === 'object') out.records_filter = c.records_filter;
    }
    return out;
}

/**
 * Explicación en lenguaje humano de cada trigger — visible en el
 * editor para que un usuario con conocimientos básicos entienda qué
 * hace cada uno sin leer documentación.
 */
export function helpForTrigger(triggerType: string): string {
    switch (triggerType) {
        case 'record_created':
            return __('Se ejecuta cada vez que se crea un nuevo registro en esta lista. Útil para asignaciones automáticas, notificaciones de bienvenida, etc.');
        case 'record_updated':
            return __('Se ejecuta cada vez que se modifica un registro de esta lista. Si configuras "Disparar solo si cambian estos campos", solo dispara cuando alguno de los campos elegidos efectivamente cambió.');
        case 'field_changed':
            return __('Se ejecuta cuando un campo específico cambia, opcionalmente de un valor a otro. Ejemplo: «cuando el estado pasa de Prospecto a Ganado».');
        case 'scheduled':
            return __('Corre en el horario que elijas. Sin registro en particular es ideal para «Editar en lote» (subir precios cada semana, marcar vencidas cada noche) o un correo de resumen; con «Ejecutar una vez por cada registro que cumpla…» corre las acciones para cada registro del filtro (recordatorios, seguimientos).');
        case 'due_date_reached':
            return __('Se ejecuta cuando llega (o se acerca / pasa) la fecha de un campo del registro. Ejemplo: «20 días después del vencimiento» para recordatorios de pago. Si la fecha se cambia, vuelve a dispararse para la fecha nueva.');
        case 'form_submitted':
            return __('Se ejecuta cuando alguien envía un formulario público de esta lista: el registro ya está creado con sus respuestas, así que puedes avisarle al equipo, contestarle a quien lo llenó o completar campos. Puedes usar {{formulario.nombre}}.');
        case 'payment_received':
            return __('Se ejecuta cuando un cliente paga un link de cobro (Mercado Pago o Wompi) creado desde un registro de esta lista. La app lo confirma con el proveedor antes de disparar. En las acciones puedes usar {{pago.monto_pagado}}, {{pago.metodo}}, {{pago.fecha}} y {{pago.link}}.');
        default:
            return '';
    }
}

export interface TriggerConfigEditorProps {
    triggerType: string;
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
    fields: FieldEntity[];
}

/**
 * Editor del trigger_config: filtros por campo y, según el trigger,
 * su configuración específica (campos observados, frecuencia, campo
 * de fecha + offset…). Sin chrome propio — el contenedor lo pone la
 * tarjeta del flujo.
 */
export function TriggerConfigEditor({
    triggerType,
    config,
    onChange,
    fields,
}: TriggerConfigEditorProps): JSX.Element {
    const changed = Array.isArray(config.changed_fields) ? config.changed_fields : [];

    const updateChanged = (next: string[]): void => {
        onChange({ ...config, changed_fields: next });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {/* Un horario no tiene registro: su filtro es el de «para cada registro». */}
            {triggerType !== 'scheduled' && (
                <ConditionEditor
                    value={config.field_filters as ConditionRule[] | Record<string, unknown> | undefined}
                    onChange={(next) => onChange({ ...config, field_filters: next })}
                    fields={fields}
                    addLabel={__('Añadir filtro')}
                    helperText={__('La automatización solo se dispara si el registro cumple TODAS estas condiciones.')}
                />
            )}

            {triggerType === 'record_updated' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3">
                    <Label>{__('Disparar solo si cambian estos campos')}</Label>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Vacío = cualquier cambio dispara la regla.')}
                    </p>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        {fields.map((field) => {
                            const checked = changed.includes(field.slug);
                            return (
                                <label key={field.id} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) =>
                                            updateChanged(
                                                e.target.checked
                                                    ? [...changed, field.slug]
                                                    : changed.filter((s) => s !== field.slug),
                                            )
                                        }
                                    />
                                    {field.label}
                                </label>
                            );
                        })}
                        {fields.length === 0 && (
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('No hay campos.')}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {triggerType === 'field_changed' && (
                <FieldChangedConfig config={config} onChange={onChange} fields={fields} />
            )}

            {triggerType === 'scheduled' && (
                <ScheduledConfig config={config} onChange={onChange} fields={fields} />
            )}

            {triggerType === 'due_date_reached' && (
                <DueDateConfig config={config} onChange={onChange} fields={fields} />
            )}

            {triggerType === 'incoming_webhook' && (
                <IncomingWebhookConfig config={config} onChange={onChange} fields={fields} />
            )}

            {triggerType === 'form_submitted' && <FormSubmittedConfig config={config} onChange={onChange} />}
        </div>
    );
}

/** v0.1.275 — elegir qué formulario dispara (o cualquiera de la lista). */
function FormSubmittedConfig({
    config,
    onChange,
}: {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
}): JSX.Element {
    const listId = useAutomationListId();
    const forms = useForms(listId);
    const current = typeof config.form_id === 'number' ? config.form_id : 0;
    const list = forms.data ?? [];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-form-config">
            <Label htmlFor="trigger-form-id">{__('Formulario')}</Label>
            <Select
                id="trigger-form-id"
                value={String(current)}
                onChange={(e) => {
                    const id = Number(e.target.value);
                    const next = { ...config };
                    if (id > 0) next.form_id = id;
                    else delete next.form_id;
                    onChange(next);
                }}
            >
                <option value="0">{__('Cualquier formulario de esta lista')}</option>
                {list.map((f) => (
                    <option key={f.id} value={f.id}>
                        {f.name}
                        {f.enabled ? '' : ` (${__('sin publicar')})`}
                    </option>
                ))}
                {current > 0 && !list.some((f) => f.id === current) && !forms.isLoading && (
                    <option value={current}>{__('Formulario eliminado')}</option>
                )}
            </Select>
            {!forms.isLoading && list.length === 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Esta lista todavía no tiene formularios: créalos en Ajustes de la lista → Formularios.')}
                </p>
            )}
        </div>
    );
}

/**
 * v0.1.110 — Webhook ENTRANTE: muestra la URL pública única (token opaco
 * generado por el backend al guardar) + copiar + regenerar, y explica cómo
 * viaja el payload a condiciones y merge tags.
 */
function IncomingWebhookConfig({
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
    const [copied, setCopied] = useState(false);
    const slugs = fields.slice(0, 4).map((f) => `"${f.slug}"`).join(', ');
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <Label>{__('URL pública del webhook')}</Label>
            {url !== '' ? (
                <>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Input readOnly value={url} className="imcrm-flex-1 imcrm-font-mono imcrm-text-xs" aria-label={__('URL del webhook')} />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                void navigator.clipboard?.writeText(url).then(() => {
                                    setCopied(true);
                                    window.setTimeout(() => setCopied(false), 1500);
                                });
                            }}
                        >
                            {copied ? __('¡Copiada!') : __('Copiar')}
                        </Button>
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
            <p className="imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                {__('Haz un POST con JSON a esa URL desde un formulario u otra plataforma. Las claves del payload que coincidan con slugs de esta lista')}
                {slugs !== '' ? ` (${slugs}…)` : ''}
                {__(' se usan en las condiciones y como variables {{slug}}; el resto queda disponible como {{payload.clave}}.')}
            </p>
            {token !== '' && <WebhookTestPanel fields={fields} />}
        </div>
    );
}

/** Fila aplanada de un payload capturado: path con puntos + preview del valor. */
interface FlatEntry {
    path: string;
    value: string;
}

function flattenPayload(value: unknown, prefix: string, out: FlatEntry[]): void {
    if (out.length >= 40) return;
    if (value !== null && typeof value === 'object') {
        const entries = Array.isArray(value)
            ? value.map((v, i) => [String(i), v] as const)
            : Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) {
            out.push({ path: prefix, value: Array.isArray(value) ? '[]' : '{}' });
            return;
        }
        for (const [k, v] of entries) {
            flattenPayload(v, prefix === '' ? k : `${prefix}.${k}`, out);
        }
        return;
    }
    const s = value === null ? 'null' : String(value);
    out.push({ path: prefix, value: s.length > 60 ? `${s.slice(0, 60)}…` : s });
}

function relativeTime(iso: string): string {
    const diffS = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (diffS < 60) return __('hace segundos');
    if (diffS < 3600) return `${__('hace')} ${Math.round(diffS / 60)} min`;
    return `${__('hace')} ${Math.round(diffS / 3600)} h`;
}

/**
 * v0.1.111 — "Probar el webhook": muestra el ÚLTIMO payload recibido en la
 * URL pública (capturas de 24h en el backend) aplanado clave por clave, con
 * el merge tag copiable de cada una y el match contra los campos de la lista
 * (estilo "test trigger" de Zapier). "Escuchar" sondea cada 3.5 s para que el
 * dato aparezca apenas el sistema externo hace el POST de prueba.
 */
function WebhookTestPanel({ fields }: { fields: FieldEntity[] }): JSX.Element | null {
    const automationId = useContext(AutomationEditorAutomationContext);
    const [listening, setListening] = useState(false);
    const [copiedTag, setCopiedTag] = useState('');
    const captures = useHookCaptures(automationId, listening);

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
                <span className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {__('Probar el webhook')}
                </span>
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
                    {__('Todavía no llegó ningún dato. Toca "Escuchar datos de prueba" y envia un POST a la URL de arriba desde tu formulario u otra plataforma — el payload va a aparecer aquí para que veas qué llega y cómo mapearlo.')}
                </p>
            ) : (
                <>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Último dato recibido')} {relativeTime(latest.received_at)}
                        {(captures.data?.length ?? 0) > 1 ? ` · ${captures.data!.length} ${__('capturas en 24 h')}` : ''}
                        {' — '}
                        {__('toca un tag para copiarlo y usarlo en las acciones.')}
                    </p>
                    <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card">
                        {rows.map((row) => {
                            const field = row.path.includes('.') ? undefined : bySlug.get(row.path);
                            const tag = field !== undefined ? `{{${row.path}}}` : `{{payload.${row.path}}}`;
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
                        {rows.length === 0 && (
                            <p className="imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">{__('El payload llegó vacío.')}</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function FieldChangedConfig({
    config,
    onChange,
    fields,
}: {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const field = typeof config.field === 'string' ? config.field : '';
    const selected = fields.find((f) => f.slug === field);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <Label>{__('Campo a observar')}</Label>
            <Select
                value={field}
                // Otro campo: los valores «de/a» del anterior ya no aplican.
                onChange={(e) => onChange({ ...config, field: e.target.value, from_value: null, to_value: null })}
                aria-label={__('Campo')}
            >
                <option value="">{__('Elige un campo…')}</option>
                {fields.map((f) => (
                    <option key={f.id} value={f.slug}>
                        {f.label}
                    </option>
                ))}
            </Select>
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('De (valor anterior)')}</Label>
                    <ChangeEndInput field={selected} value={config.from_value} onChange={(v) => onChange({ ...config, from_value: v })} />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('A (valor nuevo)')}</Label>
                    <ChangeEndInput field={selected} value={config.to_value} onChange={(v) => onChange({ ...config, to_value: v })} />
                </div>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Vacío = cualquier valor. Sin ninguno de los dos, se dispara con cualquier cambio del campo.')}
            </p>
        </div>
    );
}

/**
 * Un extremo del cambio («de» / «a») de «Cuando cambia un campo». Para una
 * selección o una casilla se ELIGE (antes había que tipear el valor
 * interno, y el motor ni siquiera lo miraba).
 */
function ChangeEndInput({
    field,
    value,
    onChange,
}: {
    field: FieldEntity | undefined;
    value: unknown;
    onChange: (next: string | null) => void;
}): JSX.Element {
    const current = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
    if (field?.type === 'checkbox') {
        return (
            <Select value={checkboxChoice(value)} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} aria-label={__('Valor')}>
                <option value="">{__('Cualquiera')}</option>
                <option value="1">{__('Marcada')}</option>
                <option value="0">{__('Desmarcada')}</option>
            </Select>
        );
    }
    if (field && (field.type === 'select' || field.type === 'multi_select')) {
        return (
            <FilterOptionPicker
                options={extractFieldOptions(field)}
                mode="single"
                value={current}
                onChange={(next) => onChange(typeof next === 'string' && next !== '' ? next : null)}
                placeholder={__('Cualquiera')}
                aria-label={__('Valor')}
            />
        );
    }
    return (
        <Input
            placeholder={__('Cualquiera')}
            value={current}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
    );
}

function ScheduledConfig({
    config,
    onChange,
    fields,
}: {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
    fields: FieldEntity[];
}): JSX.Element {
    // v0.1.221 — hora, día y zona horaria: antes sólo se elegía la
    // frecuencia y el servidor nunca la registraba (leía un `cron` que nadie
    // escribía). `scheduleParts` (shared) es la misma lectura que usa el motor.
    const p = scheduleParts(config);
    // v0.1.263 — sin zona propia, el horario corre en la de la EMPRESA (la
    // misma regla que el servidor: `scheduleTimeZone`). Ya no se le pega la
    // del navegador a cada horario: así cambiar la zona de la empresa los
    // mueve a todos juntos.
    const tenantTz = getTenantTimeZone();
    const zone = scheduleTimeZone(config, tenantTz);
    const ownTz = zone.source === 'own' ? zone.tz : null;
    const set = (patch: Record<string, unknown>): void => onChange({ ...config, ...patch });
    const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    const hasCron = typeof config.cron === 'string' && config.cron.trim() !== '';
    // La misma validación que el servidor al guardar (shared).
    const cronProblem = hasCron ? cronError(String(config.cron)) : null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <Label>{__('Frecuencia')}</Label>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Select
                    className="imcrm-w-auto"
                    value={p.frequency}
                    onChange={(e) => set({ frequency: e.target.value })}
                    disabled={hasCron}
                    data-testid="imcrm-schedule-frequency"
                >
                    <option value="hourly">{__('Cada hora')}</option>
                    <option value="twicedaily">{__('Dos veces al día')}</option>
                    <option value="daily">{__('Todos los días')}</option>
                    <option value="weekly">{__('Una vez por semana')}</option>
                    <option value="monthly">{__('Una vez por mes')}</option>
                </Select>
                {p.frequency === 'weekly' && (
                    <Select className="imcrm-w-auto" value={String(p.weekday)} onChange={(e) => set({ weekday: Number(e.target.value) })} disabled={hasCron} data-testid="imcrm-schedule-weekday">
                        {WEEKDAYS.map((d, i) => (
                            <option key={d} value={i}>
                                {sprintf(__('los %s'), d)}
                            </option>
                        ))}
                    </Select>
                )}
                {p.frequency === 'monthly' && (
                    <Select className="imcrm-w-auto" value={String(p.day)} onChange={(e) => set({ day: Number(e.target.value) })} disabled={hasCron} data-testid="imcrm-schedule-day">
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>
                                {sprintf(__('el día %d'), d)}
                            </option>
                        ))}
                    </Select>
                )}
                {p.frequency === 'hourly' ? (
                    <Select className="imcrm-w-auto" value={String(p.minute)} onChange={(e) => set({ minute: Number(e.target.value) })} disabled={hasCron}>
                        {[0, 15, 30, 45].map((m) => (
                            <option key={m} value={m}>
                                {sprintf(__('al minuto %02d'), m)}
                            </option>
                        ))}
                    </Select>
                ) : (
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                        {__('a las')}
                        <Input
                            type="time"
                            className="imcrm-w-28"
                            value={time}
                            disabled={hasCron}
                            onChange={(e) => {
                                const [h, m] = e.target.value.split(':').map(Number);
                                if (Number.isInteger(h) && Number.isInteger(m)) set({ hour: h, minute: m });
                            }}
                            data-testid="imcrm-schedule-time"
                        />
                    </label>
                )}
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                <span className="imcrm-text-muted-foreground">{__('Zona horaria')}</span>
                <TimeZoneSelect
                    className="imcrm-h-8 imcrm-w-auto imcrm-max-w-full"
                    testId="imcrm-schedule-tz"
                    value={ownTz}
                    emptyLabel={
                        tenantTz
                            ? sprintf(__('La de la empresa (%s)'), timeZoneLabel(tenantTz))
                            : __('Sin elegir (UTC)')
                    }
                    onChange={(tz) => {
                        const next: TriggerConfig = { ...config };
                        if (tz) next.tz = tz;
                        else delete next.tz;
                        onChange(next);
                    }}
                />
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-schedule-zone-note">
                {zone.source === 'fallback'
                    ? null
                    : sprintf(__('Corre a la hora de %s.'), timeZoneLabel(zone.tz))}{' '}
                {p.frequency === 'twicedaily' ? sprintf(__('Corre a las %1$s y 12 horas después.'), time) : ''}
            </p>
            {zone.source === 'fallback' && (
                <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400" data-testid="imcrm-schedule-utc-warning">
                    {__('La empresa todavía no tiene zona horaria: este horario corre en UTC (en Colombia, 5 horas antes). Elígela en ')}
                    <a className="imcrm-font-medium imcrm-underline" href="#/settings?s=formato">
                        {__('Ajustes → Formato regional')}
                    </a>
                    {__(' o elige una arriba.')}
                </p>
            )}
            {hasCron && (
                <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                    {__('Este horario usa una expresión cron (abajo). Bórrala para elegir la frecuencia de la lista.')}
                </p>
            )}
            <details className="imcrm-text-xs" open={hasCron || undefined}>
                <summary className="imcrm-cursor-pointer imcrm-text-muted-foreground">{__('Avanzado: horario personalizado (cron)')}</summary>
                <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Input
                        value={typeof config.cron === 'string' ? config.cron : ''}
                        placeholder="0 9 * * 1-5"
                        onChange={(e) => onChange({ ...config, cron: e.target.value })}
                        data-testid="imcrm-schedule-cron"
                        aria-invalid={cronProblem !== null || undefined}
                        className={cronProblem ? 'imcrm-border-destructive' : undefined}
                    />
                    {cronProblem && (
                        <span className="imcrm-text-destructive" data-testid="imcrm-schedule-cron-error">
                            {sprintf(__('No es válido: %s. Así la automatización no correría nunca.'), cronProblem)}
                        </span>
                    )}
                    <span className="imcrm-text-muted-foreground">{__('Si la completas, manda sobre la frecuencia de arriba (minuto hora día mes día-de-semana).')}</span>
                </div>
            </details>
            <ScheduledEachConfig config={config} onChange={onChange} fields={fields} />
        </div>
    );
}

/**
 * v0.1.289 — «Ejecutar una vez por cada registro que cumpla…»: el horario
 * deja de correr «sin registro» y corre las acciones para cada registro del
 * filtro (con sus variables, como cualquier otro disparo).
 */
function ScheduledEachConfig({
    config,
    onChange,
    fields,
}: {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const listId = useAutomationListId();
    const on = config.for_each_record === true;
    const filter = (config.records_filter as FilterTree | null | undefined) ?? null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="imcrm-schedule-each">
            <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                <input
                    type="checkbox"
                    className="imcrm-mt-0.5"
                    checked={on}
                    onChange={(e) => {
                        const next: TriggerConfig = { ...config };
                        if (e.target.checked) {
                            next.for_each_record = true;
                            if (!next.records_filter) next.records_filter = emptyTree();
                        } else {
                            delete next.for_each_record;
                            delete next.records_filter;
                        }
                        onChange(next);
                    }}
                    data-testid="imcrm-schedule-each-toggle"
                />
                <span className="imcrm-flex imcrm-flex-col">
                    <span className="imcrm-font-medium">{__('Ejecutar una vez por cada registro que cumpla…')}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Por ejemplo: cada mañana, un recordatorio a cada cliente con la factura vencida. Las acciones usan las variables de cada registro.')}
                    </span>
                </span>
            </label>
            {on && (
                <>
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                        <FilterGroupView
                            root={filter ?? emptyTree()}
                            path={[]}
                            fields={fields}
                            listId={listId}
                            onRootChange={(next) => onChange({ ...config, records_filter: next })}
                        />
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {sprintf(
                            __('Sin condiciones, corre para todos los registros. Procesa hasta %d registros por disparo, en tandas; si hay más, el resto queda para el siguiente y se avisa en Problemas. Las fechas relativas («hoy», «esta semana») se calculan en la zona horaria de la empresa.'),
                            SCHEDULED_EACH_MAX,
                        )}
                    </p>
                </>
            )}
        </div>
    );
}

const WEEKDAYS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

/**
 * v0.1.263 — Al guardar un horario sin zona propia: si la empresa tiene zona,
 * se deja así (corre en la de la empresa y la sigue si cambia); si no tiene,
 * se le pone la del navegador de quien lo guarda — nunca queda en UTC por
 * descuido.
 */
export function withScheduleZone(config: TriggerConfig): TriggerConfig {
    if (scheduleTimeZone(config, getTenantTimeZone()).source !== 'fallback') return config;
    const tz = browserTimeZone();
    return tz ? { ...config, tz } : config;
}

/**
 * Presets para `offset_minutes` que cubren el 95% de los casos típicos.
 * Si el operador necesita algo distinto puede elegir "Personalizado" y
 * editar el valor manualmente (en días).
 */
const DUE_DATE_PRESETS: Array<{ id: string; label: string; offsetMinutes: number }> = [
    { id: 'now',         label: 'Cuando llega la fecha (mismo día)',     offsetMinutes: 0 },
    { id: 'before_1h',   label: '1 hora antes',                          offsetMinutes: -60 },
    { id: 'before_1d',   label: '1 día antes',                           offsetMinutes: -1440 },
    { id: 'before_3d',   label: '3 días antes',                          offsetMinutes: -4320 },
    { id: 'before_7d',   label: '1 semana antes',                        offsetMinutes: -10080 },
    { id: 'after_1d',    label: '1 día después (vencido hace 1 día)',    offsetMinutes: 1440 },
    { id: 'after_3d',    label: '3 días después',                        offsetMinutes: 4320 },
    { id: 'after_7d',    label: '1 semana después',                      offsetMinutes: 10080 },
];

function offsetToPresetId(offset: number): string {
    return DUE_DATE_PRESETS.find((p) => p.offsetMinutes === offset)?.id ?? 'custom';
}

function DueDateConfig({
    config,
    onChange,
    fields,
}: {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const dueField = typeof config.due_field === 'string' ? config.due_field : '';
    const offset =
        typeof config.offset_minutes === 'number'
            ? config.offset_minutes
            : Number(config.offset_minutes ?? 0);

    const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
    /**
     * v0.1.155 — el select es CONTROLADO por el offset, así que al elegir
     * "Personalizado…" el handler no cambiaba nada y el valor volvía solo al
     * preset anterior: clickearlo no hacía absolutamente nada. Ahora la
     * elección manual vive en su propio estado (y arranca encendida si el
     * offset guardado no coincide con ningún preset).
     */
    const [manual, setManual] = useState(() => offsetToPresetId(offset) === 'custom');
    const currentPreset = manual ? 'custom' : offsetToPresetId(offset);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <Label>{__('Campo de fecha')}</Label>
            <Select
                value={dueField}
                onChange={(e) => onChange({ ...config, due_field: e.target.value })}
            >
                <option value="">{__('Elige un campo…')}</option>
                {dateFields.map((f) => (
                    <option key={f.id} value={f.slug}>
                        {f.label}
                    </option>
                ))}
            </Select>
            {dateFields.length === 0 && (
                <p className="imcrm-text-xs imcrm-text-warning">
                    {__('No hay campos de tipo fecha en esta lista.')}
                </p>
            )}

            <Label className="imcrm-mt-1">{__('Cuándo disparar')}</Label>
            <Select
                value={currentPreset}
                onChange={(e) => {
                    const id = e.target.value;
                    if (id === 'custom') {
                        // Se conserva el offset actual: el input de días
                        // aparece con ese valor para ajustarlo.
                        setManual(true);
                        return;
                    }
                    setManual(false);
                    const preset = DUE_DATE_PRESETS.find((p) => p.id === id);
                    if (preset) {
                        onChange({ ...config, offset_minutes: preset.offsetMinutes });
                    }
                }}
            >
                {DUE_DATE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                        {__(p.label)}
                    </option>
                ))}
                <option value="custom">{__('Personalizado…')}</option>
            </Select>

            {currentPreset === 'custom' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Días desde la fecha (negativo = antes, positivo = después) — ej. 20, 45, 70')}
                    </Label>
                    <Input
                        type="number"
                        step="any"
                        value={offset === 0 ? '' : offset / 1440}
                        placeholder="20"
                        onChange={(e) =>
                            onChange({
                                ...config,
                                offset_minutes: Math.round(Number(e.target.value || 0) * 1440),
                            })
                        }
                    />
                </div>
            )}

            <label className="imcrm-mt-1 imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-[13px]">
                <input
                    type="checkbox"
                    className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4"
                    checked={config.include_past === true}
                    onChange={(e) => onChange({ ...config, include_past: e.target.checked || undefined })}
                    data-testid="imcrm-due-include-past"
                />
                <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    <span>{__('Incluir las fechas que ya pasaron antes de crear esta automatización')}</span>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Por defecto sólo se dispara por las fechas que llegan desde que la creas: así una automatización nueva no le escribe de golpe a todos los registros vencidos hace meses.')}
                    </span>
                </span>
            </label>
        </div>
    );
}

interface ActionsEditorProps {
    value: ActionSpec[];
    onChange: (next: ActionSpec[]) => void;
    actionsCatalog: ActionMeta[];
    fields: FieldEntity[];
    error?: string;
    /** v0.1.289 — ruta de esta secuencia en el árbol (`[2, 'then']`). */
    seqPath?: SeqPath;
}

/** Lo que no se puede agregar en una secuencia (anidado máximo, bucle). */
export function excludedActionsAt(seqPath: SeqPath): string[] {
    const out: string[] = [];
    if (ifElseDepth(seqPath) >= 4) out.push('if_else', 'for_each_linked');
    // Dentro de un bucle no se espera ni se repite otra vez.
    if (insideLoop(seqPath)) out.push('wait', 'for_each_linked');
    return [...new Set(out)];
}

/**
 * Lista compacta y numerada de acciones — usada para las sub-listas
 * anidadas de `if_else` (then/else). El nivel superior del flujo usa
 * las tarjetas de `AutomationEditorPage`.
 */
export function ActionsEditor({
    value,
    onChange,
    actionsCatalog,
    fields,
    error,
    seqPath = [],
}: ActionsEditorProps): JSX.Element {
    const exclude = excludedActionsAt(seqPath);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}

            {value.length === 0 ? (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-4 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Todavía no hay acciones. Agrega al menos una.')}
                </p>
            ) : (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2.5">
                    {value.map((spec, i) => (
                        <StepScope key={i} path={[...seqPath, i]}>
                        <li
                            data-action-index={i}
                            className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3.5 imcrm-shadow-imcrm-sm"
                        >
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-[11px] imcrm-font-bold imcrm-text-primary imcrm-ring-1 imcrm-ring-primary/15">
                                    {i + 1}
                                </span>
                                <ActionTypeSelect
                                    spec={spec}
                                    actionsCatalog={actionsCatalog}
                                    exclude={exclude}
                                    onChange={(picked) => {
                                        const next = [...value];
                                        next[i] = picked;
                                        onChange(next);
                                    }}
                                    className="imcrm-flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                                    aria-label={__('Eliminar acción')}
                                >
                                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </div>

                            <ActionConfigEditor
                                spec={spec}
                                onChange={(next) => {
                                    const arr = [...value];
                                    arr[i] = next;
                                    onChange(arr);
                                }}
                                fields={fields}
                                actionsCatalog={actionsCatalog}
                            />
                        </li>
                        </StepScope>
                    ))}
                </ol>
            )}

            <ActionTypeMenu
                actionsCatalog={actionsCatalog}
                exclude={exclude}
                align="start"
                onPick={(type, config) => onChange([...value, { type, config: config ?? {} }])}
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={actionsCatalog.length === 0}
                    className="imcrm-self-start imcrm-gap-2"
                    data-testid="imcrm-nested-add-action"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Añadir acción')}
                </Button>
            </ActionTypeMenu>
        </div>
    );
}

export interface ActionConfigEditorProps {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}

export interface ActionConfigEditorPropsExtended extends ActionConfigEditorProps {
    /**
     * Catálogo de acciones disponibles. Solo se usa para `if_else` (que
     * ofrece sub-listas anidadas de acciones); el resto de tipos lo ignora.
     * Si no se pasa, los nested editors arrancan con catalog vacío y
     * deshabilitan "Añadir acción" — no rompen.
     */
    actionsCatalog?: ActionMeta[];
    /**
     * v0.1.289 — false en el lienzo: los pasos de una repetición se arman en
     * su marco, no dentro del panel.
     */
    nestedInline?: boolean;
}

/**
 * Editor del config de una acción concreta. Conoce las acciones del
 * catálogo (update_field, create_record, call_webhook, send_email,
 * if_else); para tipos custom registrados por terceros, fallback a
 * editor JSON crudo.
 */
export function ActionConfigEditor({
    spec,
    onChange,
    fields,
    actionsCatalog,
    nestedInline = true,
}: ActionConfigEditorPropsExtended): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {spec.type === 'update_field' ? (
                <UpdateFieldConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'create_record' ? (
                <CreateRecordConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'bulk_edit' ? (
                <BulkEditActionConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'call_webhook' ? (
                <CallWebhookConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'connector_action' ? (
                <ConnectorActionConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'send_email' ? (
                <SendEmailConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'generate_pdf' ? (
                <GeneratePdfConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'if_else' ? (
                <IfElseConfig
                    spec={spec}
                    onChange={onChange}
                    fields={fields}
                    actionsCatalog={actionsCatalog ?? []}
                />
            ) : spec.type === 'wait' ? (
                <WaitConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'for_each_linked' ? (
                <ForEachLinkedConfig spec={spec} onChange={onChange} fields={fields} actionsCatalog={actionsCatalog ?? []} nestedInline={nestedInline} />
            ) : (
                <JsonConfigFallback spec={spec} onChange={onChange} />
            )}

            {/* La condición a-nivel-acción no aplica a if_else (la lógica
                 de branch ya vive dentro de su propio config.condition) ni a
                 «Esperar», que tiene su «continuar sólo si…». */}
            {spec.type !== 'if_else' && spec.type !== 'wait' && (
                <ActionConditionEditor spec={spec} onChange={onChange} fields={fields} />
            )}
        </div>
    );
}

/**
 * Editor del config de `if_else`: condición + dos sub-listas anidadas
 * (then / else) de acciones. Reusa `ActionsEditor` recursivamente —
 * cada acción nested puede ser de cualquier tipo, incluyendo otro
 * `if_else` (limitado a 4 niveles por backend).
 */
function IfElseConfig({
    spec,
    onChange,
    fields,
    actionsCatalog,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
    actionsCatalog: ActionMeta[];
}): JSX.Element {
    const condition =
        spec.config.condition && typeof spec.config.condition === 'object'
            ? (spec.config.condition as Record<string, unknown>)
            : {};
    const thenActions: ActionSpec[] = Array.isArray(spec.config.then_actions)
        ? (spec.config.then_actions as ActionSpec[])
        : [];
    const elseActions: ActionSpec[] = Array.isArray(spec.config.else_actions)
        ? (spec.config.else_actions as ActionSpec[])
        : [];

    const updateConfig = (patch: Record<string, unknown>): void => {
        onChange({ ...spec, config: { ...spec.config, ...patch } });
    };
    const stepPath = useStepPath() ?? [];
    const condFields = useConditionFields(fields);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {/* Condición que decide qué rama ejecuta */}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-primary/20 imcrm-bg-primary/5 imcrm-p-3.5">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Badge variant="default" dot>
                        {__('Si')}
                    </Badge>
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                        {__('Todos estos pares campo = valor matchean el registro.')}
                    </p>
                </div>
                <ConditionEditor
                    value={condition as ConditionRule[] | Record<string, unknown> | undefined}
                    onChange={(next) => updateConfig({ condition: next })}
                    fields={condFields}
                />
            </div>

            {/* Branch THEN */}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-success/25 imcrm-bg-success/5 imcrm-p-3.5">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Badge variant="success" dot>
                        {__('Entonces')}
                    </Badge>
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                        {__('Acciones que se ejecutan si la condición es verdadera.')}
                    </p>
                </div>
                <ActionsEditor
                    value={thenActions}
                    onChange={(next) => updateConfig({ then_actions: next })}
                    actionsCatalog={actionsCatalog}
                    fields={fields}
                    seqPath={[...stepPath, 'then']}
                />
            </div>

            {/* Branch ELSE */}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-warning/30 imcrm-bg-warning/5 imcrm-p-3.5">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Badge variant="warning" dot>
                        {__('Si no')}
                    </Badge>
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                        {__('Acciones que se ejecutan si la condición es falsa.')}
                    </p>
                </div>
                <ActionsEditor
                    value={elseActions}
                    onChange={(next) => updateConfig({ else_actions: next })}
                    actionsCatalog={actionsCatalog}
                    fields={fields}
                    seqPath={[...stepPath, 'else']}
                />
            </div>
        </div>
    );
}

/**
 * Editor opcional de la condición de ejecución de la acción.
 *
 * Acepta tanto el shape legacy `{slug: value}` como el nuevo array
 * `[{slug, op, value}]` (transparente vía `<ConditionEditor>` +
 * `ConditionEvaluator::matches` backend).
 */
function ActionConditionEditor({
    spec,
    onChange,
    fields,
}: ActionConfigEditorProps): JSX.Element {
    const conditionValue = spec.condition as ConditionRule[] | Record<string, unknown> | undefined;
    const ruleCount = Array.isArray(conditionValue)
        ? conditionValue.length
        : conditionValue && typeof conditionValue === 'object'
          ? Object.keys(conditionValue).length
          : 0;
    const hasRows = ruleCount > 0;
    const condFields = useConditionFields(fields);

    return (
        <details
            className="imcrm-group imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-2.5 [&[open]]:imcrm-bg-card [&[open]]:imcrm-shadow-imcrm-sm"
            open={hasRows}
        >
            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-font-medium imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform imcrm-duration-150 group-open:imcrm-rotate-90" />
                <span>{__('Condición de ejecución (opcional)')}</span>
                {hasRows && (
                    <Badge variant="default" className="imcrm-ml-auto">
                        {ruleCount}
                    </Badge>
                )}
            </summary>
            <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-2">
                <ConditionEditor
                    value={conditionValue}
                    onChange={(next) => {
                        if (next.length === 0) {
                            const { condition: _omit, ...rest } = spec;
                            onChange(rest as ActionSpec);
                            return;
                        }
                        onChange({ ...spec, condition: next });
                    }}
                    fields={condFields}
                    helperText={__(
                        'Esta acción solo se ejecuta si TODAS las condiciones matchean el registro. Vacío = ejecutar siempre.',
                    )}
                />
            </div>
        </details>
    );
}

function UpdateFieldConfig({
    spec,
    onChange,
    fields,
}: ActionConfigEditorProps): JSX.Element {
    // State LOCAL (mismo patrón que TriggerConfigEditor): permite filas
    // con slug vacío durante la edición. Sin esto, "Añadir valor"
    // parecía no hacer nada porque la fila vacía se descartaba antes
    // de re-renderizar.
    // El valor se guarda con su tipo: `false` (no «0», que el motor leía
    // como texto verdadero) y una LISTA de opciones en un multi_select.
    const [valueRows, setValueRows] = useState<ValueRow[]>(() => readValueRows(spec.config.values));
    // v0.1.289 — dentro de «Repetir por cada registro vinculado» se puede
    // cambiar el registro que disparó o el VINCULADO de esa vuelta.
    const item = useLoopItem();
    const onItem = item !== null && spec.config.target === 'item';
    const targetFields = onItem ? item.fields.filter((f) => f.type !== 'relation') : fields;

    const commitValues = (next: ValueRow[]): void => {
        setValueRows(next);
        onChange({ ...spec, config: { ...spec.config, values: valueRowsToConfig(next) } });
    };
    const setTarget = (target: 'record' | 'item'): void => {
        setValueRows([]);
        const config: Record<string, unknown> = { ...spec.config, values: {} };
        if (target === 'item') config.target = 'item';
        else delete config.target;
        onChange({ ...spec, config });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            {item !== null && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="imcrm-update-target">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('¿Qué registro cambia?')}</Label>
                    <Select value={onItem ? 'item' : 'record'} onChange={(e) => setTarget(e.target.value === 'item' ? 'item' : 'record')}>
                        <option value="record">{__('El que disparó la automatización')}</option>
                        <option value="item">{sprintf(__('El vinculado de esta vuelta («%s»)'), item.listName)}</option>
                    </Select>
                </div>
            )}
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {onItem
                    ? __('Elige qué campos cambiar en cada registro vinculado y su valor nuevo. Acepta variables como {{item.slug}} (del vinculado) o {{slug}} (del que disparó).')
                    : __('Elige qué campos cambiar en el registro que disparó la automatización y su valor nuevo. Acepta variables como {{slug}} o {{record.id}}.')}
            </p>
            {/* Misma estructura de fila que CreateRecordConfig: selector +
                eliminar arriba, valor a ancho completo abajo. */}
            {valueRows.map((v, i) => {
                const selectedField = targetFields.find((f) => f.slug === v.slug);
                return (
                    <div
                        key={i}
                        className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2"
                    >
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Select
                                value={v.slug}
                                onChange={(e) => {
                                    const next = [...valueRows];
                                    // Reset value cuando cambia el campo: el valor
                                    // que tenía sentido para el field anterior
                                    // probablemente no aplica al nuevo.
                                    next[i] = { slug: e.target.value, value: '' };
                                    commitValues(next);
                                }}
                                aria-label={__('Campo a actualizar')}
                                className="imcrm-h-8 imcrm-flex-1"
                            >
                                <option value="">{__('— Campo —')}</option>
                                {targetFields.map((field) => (
                                    <option key={field.id} value={field.slug}>
                                        {field.label}
                                    </option>
                                ))}
                            </Select>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => commitValues(valueRows.filter((_, j) => j !== i))}
                                aria-label={__('Eliminar')}
                                className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0"
                            >
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </div>
                        <FieldValueInput
                            field={selectedField}
                            availableFields={fields}
                            value={v.value}
                            onChange={(next) => {
                                const arr = [...valueRows];
                                arr[i] = { ...arr[i]!, value: next };
                                commitValues(arr);
                            }}
                        />
                    </div>
                );
            })}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => commitValues([...valueRows, { slug: '', value: '' }])}
                className="imcrm-self-start imcrm-gap-2"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Añadir valor')}
            </Button>
        </div>
    );
}

/**
 * Editor visual de `create_record`: selector de LISTA DESTINO + filas
 * campo (de la lista destino) → valor. Los valores aceptan merge tags
 * de la lista del TRIGGER (`{{slug}}`, `{{record.id}}`) — el backend
 * los resuelve contra el registro que disparó la automatización, valida
 * cada valor con el schema del campo destino y vincula los campos
 * relation (ej. `{{record.id}}` en una relación hacia la lista origen).
 */
function CreateRecordConfig({
    spec,
    onChange,
    fields,
}: ActionConfigEditorProps): JSX.Element {
    const currentListId = useAutomationListId();
    const lists = useLists();
    const targetListId =
        typeof spec.config.target_list === 'number' && spec.config.target_list > 0
            ? spec.config.target_list
            : currentListId;
    const targetFields = useFields(targetListId);

    // Mismo patrón de state local que UpdateFieldConfig: filas con slug
    // vacío sobreviven durante la edición; solo las completas se comitean.
    // El valor se guarda con su tipo: `false` (no «0», que el motor leía
    // como texto verdadero) y una LISTA de opciones en un multi_select.
    const [valueRows, setValueRows] = useState<ValueRow[]>(() => readValueRows(spec.config.values));

    const commitValues = (next: ValueRow[]): void => {
        setValueRows(next);
        onChange({ ...spec, config: { ...spec.config, values: valueRowsToConfig(next) } });
    };

    const setTargetList = (raw: string): void => {
        const id = Number(raw);
        // Cambiar de lista invalida el mapeo: los slugs pertenecen a la
        // lista anterior. Se limpia para no mandar claves fantasma.
        setValueRows([]);
        onChange({
            ...spec,
            config: { ...spec.config, target_list: Number.isFinite(id) && id > 0 ? id : undefined, values: {} },
        });
    };

    const tf = targetFields.data ?? [];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Crea un registro en la lista elegida. Los valores aceptan variables del registro que disparó la automatización ({{slug}}, {{record.id}}); en un campo de relación, {{record.id}} lo vincula a ese registro.')}
            </p>
            <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Fechas con aritmética: |+1m suma un mes, |-1d resta un día — ej. {{before.proximo_cobro|+1m|-1d}} = fin del período anticipado. Etiquetas: {{campo|label}} escribe el texto de la opción en vez de su valor interno (aquí, para un select destino, conviene el valor).')}
            </p>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Lista destino')}</Label>
                <Select
                    value={targetListId !== undefined ? String(targetListId) : ''}
                    onChange={(e) => setTargetList(e.target.value)}
                    aria-label={__('Lista destino')}
                    className="imcrm-flex-1"
                >
                    <option value="">{__('— Lista —')}</option>
                    {(lists.data ?? []).map((l) => (
                        <option key={l.id} value={String(l.id)}>
                            {l.name}
                        </option>
                    ))}
                </Select>
            </div>
            {/* Fila por campo: selector + eliminar arriba, valor a ancho
                completo abajo — en columnas angostas el layout en línea
                hacía que inputs y chips se entremezclaran sin estructura. */}
            {valueRows.map((v, i) => {
                const selectedField = tf.find((f) => f.slug === v.slug);
                return (
                    <div
                        key={i}
                        className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2"
                    >
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Select
                                value={v.slug}
                                onChange={(e) => {
                                    const next = [...valueRows];
                                    next[i] = { slug: e.target.value, value: '' };
                                    commitValues(next);
                                }}
                                aria-label={__('Campo del registro nuevo')}
                                className="imcrm-h-8 imcrm-flex-1"
                            >
                                <option value="">{__('— Campo —')}</option>
                                {tf
                                    .filter((field) => field.type !== 'computed' && field.type !== 'lookup' && field.type !== 'rollup')
                                    .map((field) => (
                                        <option key={field.id} value={field.slug}>
                                            {field.label}
                                        </option>
                                    ))}
                            </Select>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => commitValues(valueRows.filter((_, j) => j !== i))}
                                aria-label={__('Eliminar')}
                                className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0"
                            >
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </div>
                        <FieldValueInput
                            field={selectedField}
                            availableFields={fields}
                            value={v.value}
                            onChange={(next) => {
                                const arr = [...valueRows];
                                arr[i] = { ...arr[i]!, value: next };
                                commitValues(arr);
                            }}
                        />
                    </div>
                );
            })}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => commitValues([...valueRows, { slug: '', value: '' }])}
                disabled={targetListId === undefined || targetFields.data === undefined}
                className="imcrm-self-start imcrm-gap-2"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Añadir valor')}
            </Button>
        </div>
    );
}

/** Una fila «campo → valor» de «Actualizar campo» / «Crear un registro». */
interface ValueRow {
    slug: string;
    value: unknown;
}

function readValueRows(raw: unknown): ValueRow[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.entries(raw as Record<string, unknown>).map(([slug, value]) => ({ slug, value }));
}

function valueRowsToConfig(rows: ValueRow[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of rows) {
        if (r.slug.trim() === '') continue;
        out[r.slug.trim()] = r.value;
    }
    return out;
}

/** El valor de una casilla tal como lo guarda el editor: sí / no / sin elegir. */
function checkboxChoice(value: unknown): '' | '1' | '0' {
    if (value === true || value === '1' || value === 'true') return '1';
    if (value === false || value === '0' || value === 'false') return '0';
    return '';
}

/**
 * Valor de una selección, de varias opciones o de una casilla: se ELIGE de
 * la lista (y viaja con su tipo: una LISTA de opciones, `true`/`false`) o
 * se usa una variable (`{{estado}}` del registro que disparó). Antes una
 * casilla «Desmarcado» viajaba como el texto «0» —verdadero para el
 * motor— y un multi_select sólo admitía UNA opción.
 */
function ChoiceValueInput({
    field,
    availableFields,
    value,
    onChange,
}: {
    field: FieldEntity;
    availableFields: FieldEntity[];
    value: unknown;
    onChange: (next: unknown) => void;
}): JSX.Element {
    const [variable, setVariable] = useState(() => typeof value === 'string' && value.includes('{{'));
    const switchLink = (label: string, next: boolean): JSX.Element => (
        <button
            type="button"
            className="imcrm-self-start imcrm-text-[11px] imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
            onClick={() => {
                setVariable(next);
                onChange(next ? '' : field.type === 'multi_select' ? [] : '');
            }}
        >
            {label}
        </button>
    );

    if (variable) {
        return (
            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                <MergeTagInput
                    value={typeof value === 'string' ? value : ''}
                    onChange={onChange}
                    fields={availableFields}
                    placeholder={__('{{campo}} del registro que disparó')}
                    aria-label={__('Valor')}
                />
                {switchLink(__('Elegir de la lista'), false)}
            </div>
        );
    }

    let control: JSX.Element;
    if (field.type === 'checkbox') {
        control = (
            <Select
                value={checkboxChoice(value)}
                onChange={(e) => onChange(e.target.value === '1' ? true : e.target.value === '0' ? false : '')}
                className="imcrm-flex-1"
                aria-label={__('Valor')}
            >
                <option value="">{__('Elige…')}</option>
                <option value="1">{__('Marcada')}</option>
                <option value="0">{__('Desmarcada')}</option>
            </Select>
        );
    } else {
        const options = extractFieldOptions(field);
        const multi = field.type === 'multi_select';
        const current = multi
            ? Array.isArray(value)
                ? value.map(String)
                : typeof value === 'string' && value.trim() !== ''
                  ? value.split(',').map((x) => x.trim()).filter(Boolean)
                  : []
            : typeof value === 'string'
              ? value
              : '';
        control = (
            <FilterOptionPicker
                options={options}
                mode={multi ? 'multi' : 'single'}
                value={current}
                onChange={(next) => onChange(multi ? (Array.isArray(next) ? next : []) : (next ?? ''))}
                placeholder={multi ? __('Elige una o varias opciones…') : __('Elige una opción…')}
                aria-label={__('Valor')}
            />
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
            {control}
            {switchLink(__('Usar una variable'), true)}
        </div>
    );
}

/**
 * Input contextual para el VALOR de un campo. Switchea según el tipo:
 * - select: dropdown con las options del campo
 * - checkbox: select marcado/desmarcado
 * - date / datetime / number / currency: MergeTagInput con placeholder
 *   del formato (un input tipado no acepta ni muestra merge tags)
 * - resto: MergeTagInput con chips
 *
 * `field` puede ser undefined si el campo aún no fue elegido — en ese
 * caso mostramos placeholder.
 */
function FieldValueInput({
    field,
    availableFields,
    value,
    onChange,
}: {
    field: FieldEntity | undefined;
    /**
     * Todos los fields de la lista — usados para alimentar el picker
     * de variables del MergeTagInput cuando el field elegido es de
     * texto. Si no se pasa, el picker queda en "Sistema" only.
     */
    availableFields?: FieldEntity[];
    value: unknown;
    onChange: (next: unknown) => void;
}): JSX.Element {
    if (!field) {
        return (
            <Input
                placeholder={__('Elige un campo primero')}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}
                className="imcrm-flex-1"
                disabled
            />
        );
    }

    // Selección, varias opciones y casilla: se ELIGE de la lista (con su
    // tipo real), o se usa una variable del registro que disparó.
    if (field.type === 'select' || field.type === 'multi_select' || field.type === 'checkbox') {
        return (
            <ChoiceValueInput field={field} availableFields={availableFields ?? []} value={value} onChange={onChange} />
        );
    }

    const textValue = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

    // date / datetime / number / currency: MergeTagInput — un input
    // tipado (type=date / type=number) NO acepta merge tags, y mapear
    // variables aquí es el caso central de create_record/update_field
    // (ej. monto = {{monto_mensual}}, periodo = {{before.proximo_cobro}}).
    // El backend valida/coerciona con el schema del campo destino; un
    // valor fijo se tipea a mano en el formato del placeholder.
    if (field.type === 'date' || field.type === 'datetime') {
        return (
            <MergeTagInput
                value={textValue}
                onChange={onChange}
                fields={availableFields ?? []}
                placeholder={
                    field.type === 'date'
                        ? __('AAAA-MM-DD o {{campo}}')
                        : __('AAAA-MM-DD HH:MM o {{campo}}')
                }
                className="imcrm-flex-1"
                aria-label={__('Valor')}
            />
        );
    }

    if (
        field.type === 'number'
        || field.type === 'currency'
        // v0.1.158 — también los numéricos nuevos: `rating` son estrellas,
        // `percent` va de 0 a 100 y `duration` acepta "1h 30m" (el backend
        // lo convierte a minutos con el mismo validador compartido).
        || field.type === 'rating'
        || field.type === 'percent'
        || field.type === 'duration'
        || field.type === 'phone'
    ) {
        return (
            <MergeTagInput
                value={textValue}
                onChange={onChange}
                fields={availableFields ?? []}
                placeholder={
                    field.type === 'duration'
                        ? __('1h 30m o {{campo}}')
                        : field.type === 'phone'
                            ? __('+57300… o {{campo}}')
                            : __('0 o {{campo}}')
                }
                className="imcrm-flex-1"
                aria-label={__('Valor')}
            />
        );
    }

    // text / long_text / email / url / relation / user / file:
    // MergeTagInput con chips para insertar variables al cursor. Los de texto
    // CRECEN con el contenido (v0.1.156): un mensaje largo no entra en un
    // renglón y quedaba imposible de revisar.
    const growable = field.type === 'text' || field.type === 'long_text';
    return (
        <div className="imcrm-flex-1">
            <MergeTagInput
                {...(growable ? { rows: 1, autoGrow: true } : {})}
                value={textValue}
                onChange={onChange}
                fields={availableFields ?? []}
                placeholder={__('Valor o usa los chips para insertar variables')}
                aria-label={__('Valor')}
            />
        </div>
    );
}

interface KeyValueRow {
    key: string;
    value: string;
}

/** Lee filas `[{key,value}]`, tolerando el objeto plano de configs viejas. */
function readRows(raw: unknown): KeyValueRow[] {
    if (Array.isArray(raw)) {
        return raw
            .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
            .map((r) => ({ key: String(r.key ?? ''), value: String(r.value ?? '') }));
    }
    if (raw !== null && typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
            key,
            value: String(value ?? ''),
        }));
    }
    return [];
}

/**
 * Editor de filas clave/valor con merge tags en el valor. Es la pieza que
 * convierte "escribe el JSON a mano" en "completa los datos que pide la API".
 */
function KeyValueEditor({
    label,
    hint,
    rows,
    onChange,
    fields,
    keyPlaceholder,
    valuePlaceholder,
}: {
    label: string;
    hint?: string;
    rows: KeyValueRow[];
    onChange: (next: KeyValueRow[]) => void;
    fields: FieldEntity[];
    keyPlaceholder?: string;
    valuePlaceholder?: string;
}): JSX.Element {
    const patch = (i: number, part: Partial<KeyValueRow>): void => {
        onChange(rows.map((r, idx) => (idx === i ? { ...r, ...part } : r)));
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{label}</Label>
            {hint && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</p>}
            {rows.map((row, i) => (
                <div
                    key={i}
                    className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-2"
                >
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Input
                            className="imcrm-h-8 imcrm-flex-1 imcrm-font-mono imcrm-text-xs"
                            placeholder={keyPlaceholder ?? 'clave'}
                            value={row.key}
                            onChange={(e) => patch(i, { key: e.target.value })}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="imcrm-text-destructive hover:imcrm-text-destructive"
                            aria-label={__('Quitar')}
                            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                        >
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        </Button>
                    </div>
                    <MergeTagInput
                        value={row.value}
                        onChange={(next) => patch(i, { value: next })}
                        fields={fields}
                        rows={1}
                        autoGrow
                        placeholder={valuePlaceholder ?? __('valor o {{campo}}')}
                    />
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="imcrm-w-fit imcrm-gap-1.5"
                onClick={() => onChange([...rows, { key: '', value: '' }])}
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agregar')}
            </Button>
        </div>
    );
}

/**
 * Selector de CONEXIÓN de la acción (v0.1.196, ADR-S22).
 *
 * Elegir una conexión es la forma recomendada: la credencial vive cifrada en
 * un solo lugar y rotarla no obliga a editar cada automatización. "Sin
 * conexión" sigue existiendo para los webhooks abiertos, que no necesitan
 * ninguna.
 */
/**
 * v0.1.198 — acción CON NOMBRE de un conector ("Enviar WhatsApp"). El
 * formulario se DERIVA de la definición guardada en la conexión: quien arma
 * la automatización llena campos rotulados y no sabe (ni tiene por qué saber)
 * de métodos, rutas ni content-types.
 */
function ConnectorActionConfig({
    spec,
    onChange,
    fields,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const listId = useContext(AutomationEditorListContext);
    const connectionId = Number(spec.config.connection_id) > 0 ? Number(spec.config.connection_id) : null;
    const actionKey = typeof spec.config.action_key === 'string' ? spec.config.action_key : '';
    const values = (spec.config.values ?? {}) as Record<string, unknown>;
    const [test, setTest] = useState<WebhookTestResult | null>(null);

    const q = useQuery({
        queryKey: ['connections'],
        queryFn: async () => (await api.get<Connection[]>('/connections')).data ?? [],
        retry: false,
        staleTime: 60_000,
    });
    const connections = q.data ?? [];
    const connection = connections.find((c) => c.id === connectionId) ?? null;
    const action = connection?.actions.find((a) => a.key === actionKey) ?? null;
    const remember = useRememberSample();

    const setValue = (key: string, next: string): void => {
        onChange({
            ...spec,
            config: { ...spec.config, values: { ...values, [key]: next } },
        });
    };

    const run = useMutation({
        mutationFn: async (): Promise<WebhookTestResult> => {
            const res = await api.post<WebhookTestResult>(
                `/lists/${listId ?? 0}/automations/test-webhook`,
                { config: spec.config },
            );
            return res.data;
        },
        onSuccess: (r) => {
            setTest(r);
            if (r.response) remember?.(r.response.body);
        },
        onError: (err: unknown) =>
            setTest({
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: err instanceof Error ? err.message : String(err),
                sample_record_id: null,
            }),
    });

    // Una conexión o una acción que ya no existe NO se esconde: la
    // automatización sigue guardada apuntando ahí y hay que poder verlo.
    if (!q.isLoading && connection === null) {
        return (
            <p className="imcrm-rounded imcrm-bg-muted imcrm-p-2 imcrm-text-xs imcrm-text-destructive">
                {__('La conexión de esta acción ya no existe o es privada de otra persona.')}
            </p>
        );
    }
    if (!q.isLoading && action === null) {
        return (
            <p className="imcrm-rounded imcrm-bg-muted imcrm-p-2 imcrm-text-xs imcrm-text-destructive">
                {sprintf(
                    /* translators: 1: connection name, 2: action key */
                    __('«%1$s» ya no tiene la acción «%2$s»: se renombró o se borró.'),
                    connection?.name ?? '',
                    actionKey,
                )}
            </p>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-connector-action-config">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <IntegrationLogo integrationKey={connection?.integration_key ?? null} size={24} />
                <p className="imcrm-min-w-0 imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-font-medium imcrm-text-foreground">{connection?.name}</span>
                    {action?.description ? ` · ${action.description}` : ''}
                </p>
            </div>

            {(action?.params ?? []).map((param) => (
                <ConnectorParamField
                    key={param.key}
                    param={param}
                    value={typeof values[param.key] === 'string' ? (values[param.key] as string) : ''}
                    fields={fields}
                    onChange={(next) => setValue(param.key, next)}
                />
            ))}

            {(action?.params ?? []).length === 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Esta acción no pide datos: se ejecuta tal cual está definida.')}
                </p>
            )}

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => run.mutate()}
                    disabled={run.isPending}
                    data-testid="imcrm-connector-action-test"
                >
                    <Send className="imcrm-h-3.5 imcrm-w-3.5" />
                    {run.isPending ? __('Probando…') : __('Probar ahora')}
                </Button>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Usa un registro real de la lista para completar las variables.')}
                </span>
            </div>

            {test && <WebhookTestReport result={test} />}

            <ResponseNameInput spec={spec} onChange={onChange} />
        </div>
    );
}

/** Un campo del formulario, derivado del tipo declarado en la conexión. */
function ConnectorParamField({
    param,
    value,
    fields,
    onChange,
}: {
    param: ConnectorParam;
    value: string;
    fields: FieldEntity[];
    onChange: (next: string) => void;
}): JSX.Element {
    const hasOptions = param.type === 'select' && param.options.length > 0;
    // Una opción de lista también puede venir de una variable del registro:
    // el escape existe porque si no, el campo queda en un callejón sin salida.
    const [asTag, setAsTag] = useState(
        () => hasOptions && value !== '' && !param.options.some((o) => o.value === value),
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                    {param.label || param.key}
                    {param.required && <span className="imcrm-text-destructive"> *</span>}
                </Label>
                {hasOptions && (
                    <button
                        type="button"
                        className="imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-foreground"
                        onClick={() => setAsTag((v) => !v)}
                    >
                        {asTag ? __('Elegir de la lista') : __('Usar una variable')}
                    </button>
                )}
            </div>

            {param.type === 'boolean' ? (
                <Select value={value === '' ? 'false' : value} onChange={(e) => onChange(e.target.value)}>
                    <option value="true">{__('Sí')}</option>
                    <option value="false">{__('No')}</option>
                </Select>
            ) : hasOptions && !asTag ? (
                <Select value={value} onChange={(e) => onChange(e.target.value)}>
                    <option value="">{__('(sin elegir)')}</option>
                    {param.options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label || o.value}
                        </option>
                    ))}
                </Select>
            ) : (
                <MergeTagInput
                    value={value}
                    onChange={onChange}
                    fields={fields}
                    autoGrow={param.type === 'long_text'}
                    placeholder={
                        param.default !== ''
                            ? sprintf(
                                  /* translators: %s: default value */
                                  __('Por defecto: %s'),
                                  param.default,
                              )
                            : param.type === 'number'
                              ? __('0 o {{campo}}')
                              : ''
                    }
                />
            )}

            {param.help !== '' && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{param.help}</p>
            )}
        </div>
    );
}

function ConnectionSelect({
    value,
    onChange,
}: {
    value: number | null;
    onChange: (id: number | null) => void;
}): JSX.Element {
    const q = useQuery({
        queryKey: ['connections'],
        queryFn: async () => (await api.get<ConnectionOption[]>('/connections')).data ?? [],
        retry: false,
        staleTime: 60_000,
    });
    // v0.1.203 — sólo las APIs personalizadas: una app de la galería (Slack,
    // Gmail…) se usa con sus acciones ya armadas, no como webhook crudo.
    const options = (q.data ?? []).filter((c) => (c.integration_key ?? null) === null);
    // Una conexión PRIVADA de otra persona no aparece en la lista, pero la
    // acción la sigue usando: decirlo es mejor que mostrar el selector vacío.
    const missing = value !== null && options.length > 0 && !options.some((c) => c.id === value);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Conexión')}</Label>
            <Select
                value={value === null ? '' : String(value)}
                onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                data-testid="imcrm-action-connection"
            >
                <option value="">{__('Sin conexión (escribir la credencial aquí abajo)')}</option>
                {options.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                        {c.secret_state === 'unreadable' ? ` — ${__('credencial ilegible')}` : ''}
                    </option>
                ))}
                {missing && (
                    <option value={String(value)}>
                        {__('Conexión')} #{value} — {__('privada de otra persona')}
                    </option>
                )}
            </Select>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Las conexiones se crean en Ajustes → Conectores. La URL de aquí puede ser relativa a la base de la conexión.')}
            </p>
        </div>
    );
}

interface ConnectionOption {
    id: number;
    name: string;
    secret_state: string;
    /** v0.1.203 — `null` en las APIs personalizadas. */
    integration_key?: string | null;
}

/**
 * Constructor + PROBADOR de webhooks salientes (v0.1.155).
 *
 * Antes esto era una URL y un cuadro de texto para escribir el cuerpo a mano:
 * para pegarle a una API real (un gateway de WhatsApp que pide
 * `application/x-www-form-urlencoded` con `secret`, `account`, `recipient`,
 * `message`) había que adivinar el formato y esperar a que saltara un registro
 * para ver si funcionaba. Ahora: tipo de contenido, filas clave/valor para
 * cuerpo, cabeceras y parámetros de la URL —cada valor con sus variables— y un
 * botón que ejecuta la petición de verdad y muestra qué se mandó y qué
 * contestaron.
 */
function CallWebhookConfig({
    spec,
    onChange,
    fields,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}): JSX.Element {
    // El contexto trae el ID de la lista; el endpoint acepta id o slug.
    const listId = useContext(AutomationEditorListContext);
    const url = typeof spec.config.url === 'string' ? spec.config.url : '';
    const method = typeof spec.config.method === 'string' ? spec.config.method : 'POST';
    const contentType =
        typeof spec.config.content_type === 'string' &&
        ['json', 'form', 'multipart', 'text', 'xml', 'html'].includes(spec.config.content_type)
            ? spec.config.content_type
            : 'json';
    // text/xml/html se escriben a mano: "una fila por dato" no aplica.
    const rawOnly = contentType === 'text' || contentType === 'xml' || contentType === 'html';
    const rawBody = typeof spec.config.body_template === 'string' ? spec.config.body_template : '';
    const bodyRows = readRows(spec.config.body_params);
    const headerRows = readRows(spec.config.headers);
    const queryRows = readRows(spec.config.query_params);
    const secret = typeof spec.config.secret === 'string' ? spec.config.secret : '';
    // v0.1.196 — con una conexión elegida, la credencial la pone ella y los
    // campos de secreto de la acción dejan de tener sentido.
    const connectionId = Number(spec.config.connection_id) > 0 ? Number(spec.config.connection_id) : null;
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const [showRaw, setShowRaw] = useState(rawBody !== '' && bodyRows.length === 0);
    const [test, setTest] = useState<WebhookTestResult | null>(null);
    const remember = useRememberSample();

    const set = (patch: Record<string, unknown>): void => {
        onChange({ ...spec, config: { ...spec.config, ...patch } });
    };

    const run = useMutation({
        mutationFn: async (): Promise<WebhookTestResult> => {
            const res = await api.post<WebhookTestResult>(
                `/lists/${listId ?? 0}/automations/test-webhook`,
                { config: spec.config },
            );
            return res.data;
        },
        onSuccess: (r) => {
            setTest(r);
            if (r.response) remember?.(r.response.body);
        },
        onError: (err: unknown) =>
            setTest({
                request: { url, method, headers: {}, body: null },
                response: null,
                error: err instanceof Error ? err.message : String(err),
                sample_record_id: null,
            }),
    });

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <ConnectionSelect
                value={connectionId}
                onChange={(id) => set({ connection_id: id })}
            />
            <div className="imcrm-flex imcrm-gap-2 imcrm-items-start">
                <Select
                    value={method}
                    onChange={(e) => set({ method: e.target.value })}
                    aria-label={__('Método HTTP')}
                    className="imcrm-w-28"
                >
                    {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                        <option key={m} value={m}>
                            {m}
                        </option>
                    ))}
                </Select>
                <div className="imcrm-flex-1">
                    <MergeTagInput
                        placeholder="https://api.tu-proveedor.com/enviar"
                        value={url}
                        onChange={(next) => set({ url: next })}
                        fields={fields}
                    />
                </div>
            </div>

            {hasBody && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Tipo de contenido')}
                    </Label>
                    <Select value={contentType} onChange={(e) => set({ content_type: e.target.value })}>
                        <option value="json">JSON (application/json)</option>
                        <option value="form">
                            {__('Datos de formulario codificados (x-www-form-urlencoded)')}
                        </option>
                        <option value="multipart">
                            {__('Form-data (multipart, sólo campos de texto)')}
                        </option>
                        <option value="text">{__('Texto plano (text/plain)')}</option>
                        <option value="xml">XML (application/xml)</option>
                        <option value="html">HTML (text/html)</option>
                    </Select>
                </div>
            )}

            {hasBody && !showRaw && !rawOnly && (
                <KeyValueEditor
                    label={__('Cuerpo — datos que pide la API')}
                    hint={__('Una fila por dato. El valor acepta variables del registro.')}
                    rows={bodyRows}
                    onChange={(next) => set({ body_params: next })}
                    fields={fields}
                    keyPlaceholder="recipient"
                    valuePlaceholder="{{telefono}}"
                />
            )}
            {hasBody && (showRaw || rawOnly) && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Cuerpo crudo (se manda tal cual)')}
                    </Label>
                    <MergeTagInput
                        rows={3}
                        autoGrow
                        value={rawBody}
                        onChange={(next) => set({ body_template: next })}
                        fields={fields}
                        placeholder='{"id": {{record.id}}, "name": "{{name}}"}'
                    />
                </div>
            )}
            {hasBody && !rawOnly && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="imcrm-w-fit"
                    onClick={() => setShowRaw(!showRaw)}
                >
                    {showRaw ? __('Usar filas clave/valor') : __('Escribir el cuerpo a mano')}
                </Button>
            )}

            <details className="imcrm-group imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-2 [&[open]]:imcrm-bg-card">
                <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-font-medium imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                    <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform group-open:imcrm-rotate-90" />
                    <span>{__('Cabeceras, parámetros de la URL y firma')}</span>
                </summary>
                <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <KeyValueEditor
                        label={__('Cabeceras (headers)')}
                        hint={__('Por ejemplo Authorization: Bearer tu-token.')}
                        rows={headerRows}
                        onChange={(next) => set({ headers: next })}
                        fields={fields}
                        keyPlaceholder="Authorization"
                        valuePlaceholder="Bearer …"
                    />
                    <KeyValueEditor
                        label={__('Parámetros de la URL (query)')}
                        rows={queryRows}
                        onChange={(next) => set({ query_params: next })}
                        fields={fields}
                        keyPlaceholder="api_key"
                    />
                    {connectionId === null ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Secreto para firmar (opcional)')}
                            </Label>
                            <Input
                                value={secret}
                                onChange={(e) => set({ secret: e.target.value })}
                                placeholder={__('deja vacío si el destino no verifica firma')}
                            />
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Se envía la cabecera x-imagina-signature con el HMAC-SHA256 del cuerpo: el destino puede comprobar que el pedido salió de aquí.')}
                            </p>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Mejor todavía: guárdalo en una conexión (Ajustes → Conectores) y úsala aquí. Queda cifrado y se rota en un solo lugar.')}
                            </p>
                        </div>
                    ) : (
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('La credencial y el secreto de firma los pone la conexión elegida arriba. No hace falta escribirlos aquí.')}
                        </p>
                    )}
                </div>
            </details>

            {/* Probador: ejecuta la MISMA petición que hará el motor. */}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="imcrm-gap-1.5"
                    disabled={run.isPending || url.trim() === '' || listId === undefined}
                    onClick={() => run.mutate()}
                >
                    <Play className="imcrm-h-3.5 imcrm-w-3.5" />
                    {run.isPending ? __('Probando…') : __('Probar ahora')}
                </Button>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Manda la petición de verdad, usando el último registro de la lista para resolver las variables.')}
                </span>
            </div>

            {test && <WebhookTestReport result={test} />}

            <ResponseNameInput spec={spec} onChange={onChange} />
        </div>
    );
}

/**
 * v0.1.289 — Nombre de la respuesta de un webhook o conector: los pasos
 * siguientes la leen como `{{respuestas.<nombre>.body.campo}}` aunque en el
 * medio haya otros webhooks (el último siempre está en `{{webhook…}}`).
 */
function ResponseNameInput({ spec, onChange }: { spec: ActionSpec; onChange: (next: ActionSpec) => void }): JSX.Element {
    const name = typeof spec.config.response_name === 'string' ? spec.config.response_name : '';
    const invalid = name !== '' && !RESPONSE_NAME_RE.test(name);
    return (
        <details className="imcrm-group imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-2 [&[open]]:imcrm-bg-card" open={name !== '' || undefined}>
            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-font-medium imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform group-open:imcrm-rotate-90" />
                <span>{__('Usar la respuesta en los pasos siguientes')}</span>
            </summary>
            <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Los pasos de abajo leen la respuesta de este paso con {{webhook.status}} y {{webhook.body.campo}} (por ejemplo {{webhook.body.data.id}} o {{webhook.body.items.0.precio}}). Si en el medio hay otro webhook, ponle un nombre a éste y úsalo con {{respuestas.nombre.body.campo}}.')}
                </p>
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Nombre de la respuesta (opcional)')}</Label>
                <Input
                    value={name}
                    placeholder="cotizacion"
                    onChange={(e) => {
                        const v = e.target.value.trim().toLowerCase();
                        const config = { ...spec.config };
                        if (v === '') delete config.response_name;
                        else config.response_name = v;
                        onChange({ ...spec, config });
                    }}
                    aria-invalid={invalid || undefined}
                    className={invalid ? 'imcrm-border-destructive' : undefined}
                    data-testid="imcrm-response-name"
                />
                {invalid ? (
                    <span className="imcrm-text-[11px] imcrm-text-destructive">
                        {__('Usa minúsculas, números y guiones bajos, empezando con una letra (máximo 40).')}
                    </span>
                ) : name !== '' ? (
                    <span className="imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">{`{{respuestas.${name}.body…}}`}</span>
                ) : null}
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Se guardan hasta 64 KB de la respuesta (también si la automatización espera en el medio). Si es más larga se corta, y lo que quede afuera llega vacío.')}
                </p>
            </div>
        </details>
    );
}

/** Resultado del probador: qué se mandó y qué contestaron. */
function WebhookTestReport({ result }: { result: WebhookTestResult }): JSX.Element {
    const status = result.response?.status ?? 0;
    const good = status >= 200 && status < 300;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                {result.error ? (
                    <Badge dot variant="destructive">
                        {__('No se pudo conectar')}
                    </Badge>
                ) : (
                    <Badge dot variant={good ? 'success' : 'warning'}>
                        HTTP {status}
                    </Badge>
                )}
                <span className="imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">
                    {result.request.method} {result.request.url}
                </span>
            </div>
            {result.error && <p className="imcrm-text-sm imcrm-text-destructive">{result.error}</p>}
            {result.request.body !== null && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Se envió')}
                    </Label>
                    <pre className="imcrm-max-h-32 imcrm-overflow-auto imcrm-rounded imcrm-bg-muted/50 imcrm-p-2 imcrm-font-mono imcrm-text-[11px]">
                        {result.request.body}
                    </pre>
                </div>
            )}
            {result.response && result.response.body !== '' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Respondió')}
                    </Label>
                    <pre className="imcrm-max-h-32 imcrm-overflow-auto imcrm-rounded imcrm-bg-muted/50 imcrm-p-2 imcrm-font-mono imcrm-text-[11px]">
                        {result.response.body}
                    </pre>
                </div>
            )}
            {result.sample_record_id === null && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('La lista no tiene registros: las variables se resolvieron vacías.')}
                </p>
            )}
        </div>
    );
}


/**
 * v0.1.289 — Dentro de un bucle, las condiciones pueden mirar también el
 * registro VINCULADO de esa vuelta (`item.<slug>`).
 */
function useConditionFields(fields: FieldEntity[]): FieldEntity[] {
    const item = useLoopItem();
    return useMemo(() => {
        if (!item) return fields;
        const extra = item.fields
            .filter((f) => f.type !== 'relation')
            .map((f) => ({ ...f, slug: `item.${f.slug}`, label: `${item.listName} · ${f.label}` }));
        return [...fields, ...extra];
    }, [fields, item]);
}

const WAIT_UNIT_LABELS: Record<(typeof WAIT_UNITS)[number], string> = {
    minutes: 'minutos',
    hours: 'horas',
    days: 'días',
};

/**
 * v0.1.289 — «Esperar»: un tiempo fijo o hasta una fecha del registro (con
 * desplazamiento y hora fija en la zona de la empresa). La corrida queda en
 * pausa y sigue sola; al terminar se vuelve a leer el registro.
 */
function WaitConfig({ spec, onChange, fields }: ActionConfigEditorProps): JSX.Element {
    const cfg = spec.config;
    const w = readWaitConfig(cfg);
    const item = useLoopItem();
    const condFields = useConditionFields(fields);
    const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
    const set = (patch: Record<string, unknown>): void => {
        const config = { ...cfg, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete config[k];
        onChange({ ...spec, config });
    };
    const fieldLabel = dateFields.find((f) => f.slug === w.dateField)?.label;
    const problem = waitConfigProblem(cfg);
    const tz = getTenantTimeZone();
    const hasTime = typeof cfg.at_time === 'string' && cfg.at_time !== '';
    const resumeCond = cfg.resume_condition as ConditionRule[] | Record<string, unknown> | undefined;
    const resumeCount = Array.isArray(resumeCond) ? resumeCond.length : resumeCond ? Object.keys(resumeCond).length : 0;

    if (item !== null) {
        return (
            <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive">
                {__('No se puede esperar dentro de «Repetir por cada registro vinculado»: la espera pausaría la vuelta de un solo vinculado. Pon la espera antes o después de la repetición.')}
            </p>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-wait-config">
            <div className="imcrm-inline-flex imcrm-w-fit imcrm-gap-0.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5" role="tablist">
                {(['duration', 'until_field'] as const).map((m) => (
                    <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={w.mode === m}
                        onClick={() => set({ mode: m })}
                        className={
                            w.mode === m
                                ? 'imcrm-rounded-md imcrm-bg-card imcrm-px-2.5 imcrm-py-1 imcrm-text-[12px] imcrm-font-medium imcrm-shadow-imcrm-sm'
                                : 'imcrm-rounded-md imcrm-px-2.5 imcrm-py-1 imcrm-text-[12px] imcrm-text-muted-foreground hover:imcrm-text-foreground'
                        }
                        data-testid={`imcrm-wait-mode-${m}`}
                    >
                        {m === 'duration' ? __('Un tiempo') : __('Hasta una fecha del registro')}
                    </button>
                ))}
            </div>

            {w.mode === 'duration' ? (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <span>{__('Esperar')}</span>
                    <Input
                        type="number"
                        min={1}
                        className="imcrm-w-24"
                        value={typeof cfg.amount === 'number' || typeof cfg.amount === 'string' ? String(cfg.amount) : ''}
                        onChange={(e) => set({ amount: e.target.value === '' ? undefined : Number(e.target.value) })}
                        aria-label={__('Cuánto esperar')}
                        data-testid="imcrm-wait-amount"
                    />
                    <Select className="imcrm-w-auto" value={w.unit} onChange={(e) => set({ unit: e.target.value })} aria-label={__('Unidad')} data-testid="imcrm-wait-unit">
                        {WAIT_UNITS.map((u) => (
                            <option key={u} value={u}>
                                {__(WAIT_UNIT_LABELS[u])}
                            </option>
                        ))}
                    </Select>
                </div>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-sm">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Input
                            type="number"
                            min={0}
                            className="imcrm-w-20"
                            value={typeof cfg.offset_amount === 'number' || typeof cfg.offset_amount === 'string' ? String(cfg.offset_amount) : '0'}
                            onChange={(e) => set({ offset_amount: e.target.value === '' ? 0 : Number(e.target.value) })}
                            aria-label={__('Desplazamiento')}
                            data-testid="imcrm-wait-offset"
                        />
                        <Select className="imcrm-w-auto" value={w.offsetUnit} onChange={(e) => set({ offset_unit: e.target.value })} aria-label={__('Unidad del desplazamiento')}>
                            {WAIT_UNITS.map((u) => (
                                <option key={u} value={u}>
                                    {__(WAIT_UNIT_LABELS[u])}
                                </option>
                            ))}
                        </Select>
                        <Select className="imcrm-w-auto" value={w.offsetDirection} onChange={(e) => set({ offset_direction: e.target.value })} aria-label={__('Antes o después')} data-testid="imcrm-wait-direction">
                            <option value="before">{__('antes de')}</option>
                            <option value="after">{__('después de')}</option>
                        </Select>
                        <Select className="imcrm-w-auto imcrm-min-w-[10rem]" value={w.dateField} onChange={(e) => set({ date_field: e.target.value })} aria-label={__('Campo de fecha')} data-testid="imcrm-wait-field">
                            <option value="">{__('— Campo de fecha —')}</option>
                            {dateFields.map((f) => (
                                <option key={f.id} value={f.slug}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                    {dateFields.length === 0 && (
                        <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">{__('Esta lista no tiene campos de fecha.')}</p>
                    )}
                    <label className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <input
                            type="checkbox"
                            checked={hasTime}
                            onChange={(e) => set({ at_time: e.target.checked ? '09:00' : undefined })}
                            data-testid="imcrm-wait-at-time-toggle"
                        />
                        <span>{__('A una hora fija de ese día')}</span>
                        {hasTime && (
                            <Input
                                type="time"
                                className="imcrm-w-28"
                                value={String(cfg.at_time)}
                                onChange={(e) => set({ at_time: e.target.value })}
                                data-testid="imcrm-wait-at-time"
                            />
                        )}
                    </label>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Si la fecha cambia mientras espera, la espera se mueve sola. Si el campo está vacío, la automatización termina aquí.')}
                    </p>
                </div>
            )}

            <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2 imcrm-text-[12px]" data-testid="imcrm-wait-summary">
                {problem ?? `${describeWait(cfg, fieldLabel)}.`}{' '}
                <span className="imcrm-text-muted-foreground">
                    {tz ? sprintf(__('Las horas son las de %s.'), timeZoneLabel(tz)) : __('La empresa no tiene zona horaria: las horas se toman en UTC.')}
                </span>
            </p>

            <details className="imcrm-group imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-2.5 [&[open]]:imcrm-bg-card" open={resumeCount > 0 || undefined}>
                <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-font-medium imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                    <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform group-open:imcrm-rotate-90" />
                    <span>{__('Continuar sólo si… (opcional)')}</span>
                    {resumeCount > 0 && (
                        <Badge variant="default" className="imcrm-ml-auto">
                            {resumeCount}
                        </Badge>
                    )}
                </summary>
                <div className="imcrm-mt-3">
                    <ConditionEditor
                        value={resumeCond}
                        onChange={(next) => set({ resume_condition: next.length > 0 ? next : undefined })}
                        fields={condFields}
                        helperText={__('Al terminar la espera se vuelve a leer el registro: si ya no cumple TODAS estas condiciones (por ejemplo, la factura ya se pagó), la automatización termina ahí.')}
                    />
                </div>
            </details>

            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Mientras espera, la corrida aparece «En espera» en el historial y se puede cancelar. Si se borra el registro o se pausa la automatización, la espera se cancela (y no se retoma al reactivarla).')}
            </p>
        </div>
    );
}

/**
 * v0.1.289 — «Repetir por cada registro vinculado»: la relación (en
 * cualquier sentido), un filtro opcional sobre la otra lista y los pasos que
 * corren una vez por cada vinculado.
 */
function ForEachLinkedConfig({
    spec,
    onChange,
    fields,
    actionsCatalog,
    nestedInline = true,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
    actionsCatalog: ActionMeta[];
    nestedInline?: boolean;
}): JSX.Element {
    const listId = useAutomationListId();
    const paths = useRelationPaths(listId);
    const relId = Number(spec.config.relation_field_id) || 0;
    const path = paths.data?.find((p) => p.relation_field_id === relId) ?? null;
    const other = useFields(path?.other_list_id);
    const filter = (spec.config.filter_tree as FilterTree | null | undefined) ?? null;
    const inner: ActionSpec[] = Array.isArray(spec.config.actions) ? (spec.config.actions as ActionSpec[]) : [];
    const stepPath = useStepPath() ?? [];
    const set = (patch: Record<string, unknown>): void => {
        const config = { ...spec.config, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete config[k];
        onChange({ ...spec, config });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-for-each-config">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Por cada registro vinculado de')}</Label>
                <Select
                    value={relId > 0 ? String(relId) : ''}
                    onChange={(e) => set({ relation_field_id: e.target.value === '' ? undefined : Number(e.target.value), filter_tree: undefined })}
                    data-testid="imcrm-for-each-relation"
                >
                    <option value="">{__('— Elige la relación —')}</option>
                    {(paths.data ?? []).map((p) => (
                        <option key={`${p.relation_field_id}`} value={p.relation_field_id}>
                            {p.direction === 'forward'
                                ? sprintf(__('%1$s (campo «%2$s» de esta lista)'), p.other_list_name, p.relation_label)
                                : sprintf(__('%1$s (los que apuntan aquí por «%2$s»)'), p.other_list_name, p.relation_label)}
                        </option>
                    ))}
                </Select>
                {!paths.isLoading && (paths.data ?? []).length === 0 && (
                    <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        {__('Esta lista no está vinculada con ninguna otra: agrega un campo «Relación» para poder repetir por sus registros.')}
                    </p>
                )}
            </div>

            {path && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            checked={filter !== null}
                            onChange={(e) => set({ filter_tree: e.target.checked ? emptyTree() : undefined })}
                            data-testid="imcrm-for-each-has-filter"
                        />
                        {sprintf(__('Sólo los de «%s» que cumplan…'), path.other_list_name)}
                    </label>
                    {filter !== null && (
                        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                            <FilterGroupView
                                root={filter}
                                path={[]}
                                fields={other.data ?? []}
                                listId={path.other_list_id}
                                onRootChange={(next) => set({ filter_tree: next })}
                            />
                        </div>
                    )}
                </div>
            )}

            {nestedInline && (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-info/30 imcrm-bg-info/5 imcrm-p-3.5">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Badge variant="default" dot>
                        <Repeat className="imcrm-mr-1 imcrm-inline imcrm-h-3 imcrm-w-3" />
                        {__('Por cada uno')}
                    </Badge>
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                        {path
                            ? sprintf(__('Estos pasos corren una vez por cada registro de «%s». Usa {{item.campo}} para sus datos.'), path.other_list_name)
                            : __('Elige la relación para armar los pasos que se repiten.')}
                    </p>
                </div>
                <LoopItemProvider listId={listId} relationFieldId={relId}>
                    <ActionsEditor
                        value={inner}
                        onChange={(next) => set({ actions: next })}
                        actionsCatalog={actionsCatalog}
                        fields={fields}
                        seqPath={[...stepPath, 'each']}
                    />
                </LoopItemProvider>
            </div>
            )}

            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {sprintf(
                    __('Procesa hasta %d vinculados por corrida (si hay más, queda anotado en el historial). Dentro de la repetición no se puede esperar ni repetir otra vez.'),
                    FOR_EACH_MAX_ITEMS,
                )}
            </p>
        </div>
    );
}

function JsonConfigFallback({
    spec,
    onChange,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
}): JSX.Element {
    const [text, setText] = useState(() => JSON.stringify(spec.config, null, 2));
    const [parseError, setParseError] = useState<string | null>(null);

    const commit = (): void => {
        try {
            const parsed = JSON.parse(text);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new Error('config debe ser un objeto JSON');
            }
            onChange({ ...spec, config: parsed as Record<string, unknown> });
            setParseError(null);
        } catch (err) {
            if (err instanceof Error) setParseError(err.message);
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Configuración (JSON)')}
            </Label>
            <Textarea
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={commit}
                spellCheck={false}
                className="imcrm-font-mono imcrm-text-xs"
            />
            {parseError && <p className="imcrm-text-xs imcrm-text-destructive">{parseError}</p>}
        </div>
    );
}
