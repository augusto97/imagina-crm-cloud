import { createContext, useContext, useState } from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { MergeTagInput } from './MergeTagInput';
import { ConditionEditor, type ConditionRule } from './ConditionEditor';
import { useEmailSignature } from '@/hooks/useEmailSignature';
import { useFields } from '@/hooks/useFields';
import { useHookCaptures } from '@/hooks/useAutomations';
import { useLists } from '@/hooks/useLists';
import { __ } from '@/lib/i18n';
import type {
    ActionMeta,
    ActionSpec,
    AutomationEntity,
    TriggerConfig,
} from '@/types/automation';
import type { FieldEntity } from '@/types/field';

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
    // scheduled
    if (typeof c.frequency === 'string' && c.frequency !== '') out.frequency = c.frequency;
    // due_date_reached
    if (typeof c.due_field === 'string' && c.due_field !== '') out.due_field = c.due_field;
    if (typeof c.offset_minutes === 'number') out.offset_minutes = c.offset_minutes;
    if (typeof c.tolerance_minutes === 'number') out.tolerance_minutes = c.tolerance_minutes;
    // incoming_webhook: CONSERVAR el token — si se pierde en un guardado, el
    // backend rota la URL y los sistemas externos quedan apuntando a un 404.
    // (Regenerar = mandar el config SIN token a propósito.)
    if (typeof c.webhook_token === 'string' && c.webhook_token !== '') out.webhook_token = c.webhook_token;
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
            return __('Se ejecuta cuando un campo específico cambia, opcionalmente con condiciones sobre el valor previo o nuevo. Ejemplo: "cuando status pasa de lead a won".');
        case 'scheduled':
            return __('Se ejecuta de forma recurrente (cada hora, dos veces al día, diario o semanal). En cada tick recorre todos los registros activos de la lista — útil para reportes periódicos o limpieza programada.');
        case 'due_date_reached':
            return __('Se ejecuta cuando llega (o se acerca / pasa) la fecha de un campo del registro. Ejemplo: "20 días después del vencimiento" para recordatorios de pago.');
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
            <ConditionEditor
                value={config.field_filters as ConditionRule[] | Record<string, unknown> | undefined}
                onChange={(next) => onChange({ ...config, field_filters: next })}
                fields={fields}
                addLabel={__('Añadir filtro')}
                helperText={__('El trigger solo dispara si el registro cumple TODAS estas condiciones.')}
            />

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
                <ScheduledConfig config={config} onChange={onChange} />
            )}

            {triggerType === 'due_date_reached' && (
                <DueDateConfig config={config} onChange={onChange} fields={fields} />
            )}

            {triggerType === 'incoming_webhook' && (
                <IncomingWebhookConfig config={config} onChange={onChange} fields={fields} />
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
                    {__('Guardá la automatización para generar la URL pública única.')}
                </p>
            )}
            <p className="imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                {__('Hacé un POST con JSON a esa URL desde un formulario u otra plataforma. Las claves del payload que coincidan con slugs de esta lista')}
                {slugs !== '' ? ` (${slugs}…)` : ''}
                {__(' se usan en las condiciones y en los merge tags como {{slug}}; el resto queda disponible como {{payload.clave}}.')}
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
                    {__('Todavía no llegó ningún dato. Tocá "Escuchar datos de prueba" y enviá un POST a la URL de arriba desde tu formulario u otra plataforma — el payload va a aparecer acá para que veas qué llega y cómo mapearlo.')}
                </p>
            ) : (
                <>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Último dato recibido')} {relativeTime(latest.received_at)}
                        {(captures.data?.length ?? 0) > 1 ? ` · ${captures.data!.length} ${__('capturas en 24 h')}` : ''}
                        {' — '}
                        {__('tocá un tag para copiarlo y usarlo en las acciones.')}
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
                                        title={__('Copiar merge tag')}
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
    const fromValue =
        typeof config.from_value === 'string' ? config.from_value : '';
    const toValue = typeof config.to_value === 'string' ? config.to_value : '';

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <Label>{__('Campo a observar')}</Label>
            <Select
                value={field}
                onChange={(e) => onChange({ ...config, field: e.target.value })}
                aria-label={__('Campo')}
            >
                <option value="">{__('— Selecciona campo —')}</option>
                {fields.map((f) => (
                    <option key={f.id} value={f.slug}>
                        {f.label} ({f.slug})
                    </option>
                ))}
            </Select>
            <div className="imcrm-flex imcrm-gap-2">
                <Input
                    placeholder={__('Valor previo (opcional)')}
                    value={fromValue}
                    onChange={(e) =>
                        onChange({
                            ...config,
                            from_value: e.target.value === '' ? null : e.target.value,
                        })
                    }
                    className="imcrm-flex-1"
                />
                <Input
                    placeholder={__('Valor nuevo (opcional)')}
                    value={toValue}
                    onChange={(e) =>
                        onChange({
                            ...config,
                            to_value: e.target.value === '' ? null : e.target.value,
                        })
                    }
                    className="imcrm-flex-1"
                />
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Si los valores quedan vacíos, dispara con cualquier cambio del campo.')}
            </p>
        </div>
    );
}

function ScheduledConfig({
    config,
    onChange,
}: {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
}): JSX.Element {
    const frequency = typeof config.frequency === 'string' ? config.frequency : 'daily';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <Label>{__('Frecuencia')}</Label>
            <Select
                value={frequency}
                onChange={(e) => onChange({ ...config, frequency: e.target.value })}
            >
                <option value="hourly">{__('Cada hora')}</option>
                <option value="twicedaily">{__('Dos veces al día')}</option>
                <option value="daily">{__('Diariamente')}</option>
                <option value="weekly">{__('Semanalmente')}</option>
            </Select>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('La automatización se evalúa en cada tick contra todos los registros activos de la lista.')}
            </p>
        </div>
    );
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
    const tolerance =
        typeof config.tolerance_minutes === 'number'
            ? config.tolerance_minutes
            : Number(config.tolerance_minutes ?? 1440); // default 1 día — más útil que 30min para casos tipo "vencido hoy"

    const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
    const currentPreset = offsetToPresetId(offset);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <Label>{__('Campo de fecha')}</Label>
            <Select
                value={dueField}
                onChange={(e) => onChange({ ...config, due_field: e.target.value })}
            >
                <option value="">{__('— Selecciona campo —')}</option>
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
                        // Mantén el offset que ya estaba.
                        return;
                    }
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

            <details className="imcrm-group imcrm-mt-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-2 [&[open]]:imcrm-bg-card [&[open]]:imcrm-shadow-imcrm-sm">
                <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-font-medium imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                    <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform imcrm-duration-150 group-open:imcrm-rotate-90" />
                    <span>{__('Avanzado: ventana de tolerancia')}</span>
                </summary>
                <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Tolerancia (minutos)')}
                    </Label>
                    <Input
                        type="number"
                        min={1}
                        value={tolerance}
                        onChange={(e) =>
                            onChange({
                                ...config,
                                tolerance_minutes: Math.max(1, Number(e.target.value)),
                            })
                        }
                    />
                    <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                        {__('Ventana alrededor del momento target en la que el trigger todavía dispara — evita perder registros por jitter del cron. Default 1 día (1440 min).')}
                    </p>
                </div>
            </details>
        </div>
    );
}

interface ActionsEditorProps {
    value: ActionSpec[];
    onChange: (next: ActionSpec[]) => void;
    actionsCatalog: ActionMeta[];
    fields: FieldEntity[];
    error?: string;
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
}: ActionsEditorProps): JSX.Element {
    const addAction = (): void => {
        const first = actionsCatalog[0];
        if (!first) return;
        onChange([...value, { type: first.slug, config: {} }]);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}

            {value.length === 0 ? (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-4 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Aún no hay acciones. Añade al menos una.')}
                </p>
            ) : (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2.5">
                    {value.map((spec, i) => (
                        <li
                            key={i}
                            data-action-index={i}
                            className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3.5 imcrm-shadow-imcrm-sm"
                        >
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-[11px] imcrm-font-bold imcrm-text-primary imcrm-ring-1 imcrm-ring-primary/15">
                                    {i + 1}
                                </span>
                                <Select
                                    value={spec.type}
                                    onChange={(e) => {
                                        const next = [...value];
                                        next[i] = { type: e.target.value, config: {} };
                                        onChange(next);
                                    }}
                                    className="imcrm-flex-1"
                                    aria-label={__('Tipo de acción')}
                                >
                                    {actionsCatalog.map((a) => (
                                        <option key={a.slug} value={a.slug}>
                                            {a.label}
                                        </option>
                                    ))}
                                </Select>
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
                    ))}
                </ol>
            )}

            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addAction}
                disabled={actionsCatalog.length === 0}
                className="imcrm-self-start imcrm-gap-2"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Añadir acción')}
            </Button>
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
}: ActionConfigEditorPropsExtended): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {spec.type === 'update_field' ? (
                <UpdateFieldConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'create_record' ? (
                <CreateRecordConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'call_webhook' ? (
                <CallWebhookConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'send_email' ? (
                <SendEmailConfig spec={spec} onChange={onChange} fields={fields} />
            ) : spec.type === 'if_else' ? (
                <IfElseConfig
                    spec={spec}
                    onChange={onChange}
                    fields={fields}
                    actionsCatalog={actionsCatalog ?? []}
                />
            ) : (
                <JsonConfigFallback spec={spec} onChange={onChange} />
            )}

            {/* La condición a-nivel-acción no aplica a if_else (la lógica
                 de branch ya vive dentro de su propio config.condition). */}
            {spec.type !== 'if_else' && (
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
                    fields={fields}
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
                    fields={fields}
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
    const [valueRows, setValueRows] = useState<Array<{ slug: string; value: string }>>(() => {
        const rawValues = spec.config.values;
        if (!rawValues || typeof rawValues !== 'object') return [];
        return Object.entries(rawValues as Record<string, unknown>).map(([slug, v]) => ({
            slug,
            value: typeof v === 'string' ? v : String(v ?? ''),
        }));
    });

    const commitValues = (next: Array<{ slug: string; value: string }>): void => {
        setValueRows(next);
        const out: Record<string, string> = {};
        for (const v of next) {
            if (v.slug.trim() === '') continue;
            out[v.slug.trim()] = v.value;
        }
        onChange({ ...spec, config: { ...spec.config, values: out } });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Setea pares campo → valor en el registro que disparó el trigger. Soporta merge tags como {{slug}} o {{record.id}}.')}
            </p>
            {/* Misma estructura de fila que CreateRecordConfig: selector +
                eliminar arriba, valor a ancho completo abajo. */}
            {valueRows.map((v, i) => {
                const selectedField = fields.find((f) => f.slug === v.slug);
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
                                {fields.map((field) => (
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
    const [valueRows, setValueRows] = useState<Array<{ slug: string; value: string }>>(() => {
        const rawValues = spec.config.values;
        if (!rawValues || typeof rawValues !== 'object') return [];
        return Object.entries(rawValues as Record<string, unknown>).map(([slug, v]) => ({
            slug,
            value: typeof v === 'string' ? v : String(v ?? ''),
        }));
    });

    const commitValues = (next: Array<{ slug: string; value: string }>): void => {
        setValueRows(next);
        const out: Record<string, string> = {};
        for (const v of next) {
            if (v.slug.trim() === '') continue;
            out[v.slug.trim()] = v.value;
        }
        onChange({ ...spec, config: { ...spec.config, values: out } });
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
                {__('Crea un registro en la lista elegida. Los valores aceptan merge tags del registro que disparó el trigger ({{slug}}, {{record.id}}); en un campo de relación, {{record.id}} lo vincula a ese registro.')}
            </p>
            <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Fechas con aritmética: |+1m suma un mes, |-1d resta un día — ej. {{before.proximo_cobro|+1m|-1d}} = fin del período anticipado.')}
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
                                    .filter((field) => field.type !== 'computed')
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
    value: string;
    onChange: (next: string) => void;
}): JSX.Element {
    if (!field) {
        return (
            <Input
                placeholder={__('Selecciona un campo primero')}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="imcrm-flex-1"
                disabled
            />
        );
    }

    if (field.type === 'select' || field.type === 'multi_select') {
        const options = (field.config?.options as Array<{ value: string; label?: string }> | undefined) ?? [];
        return (
            <Select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="imcrm-flex-1"
                aria-label={__('Valor')}
            >
                <option value="">{__('— Selecciona valor —')}</option>
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label || opt.value}
                    </option>
                ))}
            </Select>
        );
    }

    if (field.type === 'checkbox') {
        return (
            <Select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="imcrm-flex-1"
                aria-label={__('Valor')}
            >
                <option value="">{__('— —')}</option>
                <option value="1">{__('Marcado')}</option>
                <option value="0">{__('Desmarcado')}</option>
            </Select>
        );
    }

    // date / datetime / number / currency: MergeTagInput — un input
    // tipado (type=date / type=number) NO acepta merge tags, y mapear
    // variables acá es el caso central de create_record/update_field
    // (ej. monto = {{monto_mensual}}, periodo = {{before.proximo_cobro}}).
    // El backend valida/coerciona con el schema del campo destino; un
    // valor fijo se tipea a mano en el formato del placeholder.
    if (field.type === 'date' || field.type === 'datetime') {
        return (
            <MergeTagInput
                value={value}
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

    if (field.type === 'number' || field.type === 'currency') {
        return (
            <MergeTagInput
                value={value}
                onChange={onChange}
                fields={availableFields ?? []}
                placeholder={__('0 o {{campo}}')}
                className="imcrm-flex-1"
                aria-label={__('Valor')}
            />
        );
    }

    // text / long_text / email / url / relation / user / file:
    // MergeTagInput con chips para insertar variables al cursor.
    return (
        <div className="imcrm-flex-1">
            <MergeTagInput
                value={value}
                onChange={onChange}
                fields={availableFields ?? []}
                placeholder={__('Valor o usa los chips para insertar variables')}
                aria-label={__('Valor')}
            />
        </div>
    );
}

function CallWebhookConfig({
    spec,
    onChange,
    fields,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const url = typeof spec.config.url === 'string' ? spec.config.url : '';
    const method = typeof spec.config.method === 'string' ? spec.config.method : 'POST';
    const body = typeof spec.config.body_template === 'string' ? spec.config.body_template : '';

    const set = (patch: Record<string, unknown>): void => {
        onChange({ ...spec, config: { ...spec.config, ...patch } });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
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
                        placeholder="https://example.com/hook"
                        value={url}
                        onChange={(next) => set({ url: next })}
                        fields={fields}
                    />
                </div>
            </div>
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Body (opcional, soporta merge tags)')}
            </Label>
            <MergeTagInput
                rows={3}
                value={body}
                onChange={(next) => set({ body_template: next })}
                fields={fields}
                placeholder='{"id": {{record.id}}, "name": "{{name}}"}'
            />
        </div>
    );
}

function SendEmailConfig({
    spec,
    onChange,
    fields,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const to = typeof spec.config.to === 'string' ? spec.config.to : '';
    const subject = typeof spec.config.subject === 'string' ? spec.config.subject : '';
    const body = typeof spec.config.body === 'string' ? spec.config.body : '';
    const isHtml = Boolean(spec.config.is_html);
    const fromName = typeof spec.config.from_name === 'string' ? spec.config.from_name : '';
    const fromEmail = typeof spec.config.from_email === 'string' ? spec.config.from_email : '';
    const cc = typeof spec.config.cc === 'string' ? spec.config.cc : '';
    const bcc = typeof spec.config.bcc === 'string' ? spec.config.bcc : '';

    const set = (patch: Record<string, unknown>): void => {
        onChange({ ...spec, config: { ...spec.config, ...patch } });
    };

    // La firma se carga vía hook; el callback `onInsertSignature`
    // resuelve la promesa con el HTML guardado por el usuario.
    const signature = useEmailSignature();

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Para (acepta merge tags y múltiples emails separados por coma)')}
            </Label>
            <MergeTagInput
                placeholder="{{email}} o user@example.com"
                value={to}
                onChange={(next) => set({ to: next })}
                fields={fields}
            />

            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Asunto')}</Label>
            <MergeTagInput
                placeholder={__('Hola {{name}}')}
                value={subject}
                onChange={(next) => set({ subject: next })}
                fields={fields}
            />

            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cuerpo')}</Label>
            <MergeTagInput
                rows={4}
                placeholder={__('Tu mensaje. Usa los chips abajo para insertar variables.')}
                value={body}
                onChange={(next) => set({ body: next })}
                fields={fields}
                showSignatureButton
                onInsertSignature={() => signature.data ?? ''}
            />

            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                <input
                    type="checkbox"
                    checked={isHtml}
                    onChange={(e) => set({ is_html: e.target.checked })}
                />
                {__('Enviar como HTML')}
            </label>

            <details className="imcrm-group imcrm-mt-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-2 [&[open]]:imcrm-bg-card [&[open]]:imcrm-shadow-imcrm-sm">
                <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-font-medium imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                    <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform imcrm-duration-150 group-open:imcrm-rotate-90" />
                    <span>{__('Avanzado: From, Cc, Bcc')}</span>
                </summary>
                <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <div className="imcrm-flex imcrm-gap-2">
                        <Input
                            placeholder={__('Nombre remitente')}
                            value={fromName}
                            onChange={(e) => set({ from_name: e.target.value })}
                            className="imcrm-flex-1"
                        />
                        <Input
                            placeholder="noreply@example.com"
                            value={fromEmail}
                            onChange={(e) => set({ from_email: e.target.value })}
                            className="imcrm-flex-1"
                        />
                    </div>
                    <MergeTagInput
                        placeholder={__('Cc (separados por coma)')}
                        value={cc}
                        onChange={(next) => set({ cc: next })}
                        fields={fields}
                    />
                    <MergeTagInput
                        placeholder={__('Bcc (separados por coma)')}
                        value={bcc}
                        onChange={(next) => set({ bcc: next })}
                        fields={fields}
                    />
                </div>
            </details>
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
