import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
    COMMENT_TRIGGER_AUTHOR_LABELS,
    COMMENT_TRIGGER_AUTHORS,
    COMMENT_TRIGGER_REPLY_FILTERS,
    COMMENT_TRIGGER_REPLY_LABELS,
    COMMENT_TRIGGER_VISIBILITIES,
    COMMENT_TRIGGER_VISIBILITY_LABELS,
    FIND_OPERATOR_LABELS,
    FIND_OPERATORS,
    FIND_RECORDS_DEFAULT_LIMIT,
    FIND_RECORDS_DEFAULT_NAME,
    FIND_RECORDS_MAX,
    RESPONSE_NAME_RE,
    UPSERT_MODE_LABELS,
    UPSERT_MODES,
    UPSERT_RECORD_DEFAULT_NAME,
    findOperatorIsNullary,
    isFindableFieldType,
    readCommentTriggerConfig,
    readFindRecordsConfig,
    readUpsertRecordConfig,
    webhookMatchFieldError,
    type FindOperator,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { DERIVED_FIELD_TYPES } from '@/lib/fieldTypeCatalog';
import { __, sprintf } from '@/lib/i18n';
import type { ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { FieldValueInput, readValueRows, useAutomationListId, valueRowsToConfig, type ValueRow } from './config-editors';
import { MergeTagInput } from './MergeTagInput';

/**
 * v0.1.444 — Editores de «Buscar registros», «Crear o actualizar un registro»
 * y del disparador «Cuando se agrega un comentario». Las reglas (qué campos
 * sirven, valores por defecto, qué se valida) viven en `packages/shared`
 * (`automation-records.ts`): lo que se ve aquí es lo que hace el motor.
 */

interface EditorProps {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}

/** Elegir la lista: vacío = la de la automatización. */
function ListPicker({ value, onChange, testId }: { value: number | null; onChange: (id: number | null) => void; testId: string }): JSX.Element {
    const lists = useLists();
    const current = useAutomationListId();
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
            <Label className="imcrm-shrink-0 imcrm-text-xs">{__('En la lista')}</Label>
            <Select
                value={value !== null && value !== current ? String(value) : ''}
                onChange={(e) => {
                    const id = Number(e.target.value);
                    onChange(Number.isInteger(id) && id > 0 ? id : null);
                }}
                aria-label={__('Lista')}
                className="imcrm-flex-1"
                data-testid={testId}
            >
                <option value="">{__('Esta lista')}</option>
                {(lists.data ?? [])
                    .filter((l) => l.id !== current)
                    .map((l) => (
                        <option key={l.id} value={String(l.id)}>
                            {l.name}
                        </option>
                    ))}
            </Select>
        </div>
    );
}

/** El nombre con que quedan los resultados para los pasos siguientes. */
function ResultName({
    spec,
    onChange,
    fallback,
    outputs,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fallback: string;
    outputs: string[];
}): JSX.Element {
    const raw = typeof spec.config.response_name === 'string' ? spec.config.response_name : '';
    const name = raw.trim() === '' ? fallback : raw.trim();
    const invalid = raw.trim() !== '' && !RESPONSE_NAME_RE.test(raw.trim());
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2">
            <Label className="imcrm-text-xs">{__('Nombre para usar el resultado en los pasos siguientes')}</Label>
            <Input
                value={raw}
                placeholder={fallback}
                onChange={(e) => {
                    const v = e.target.value.trim().toLowerCase();
                    const config = { ...spec.config };
                    if (v === '') delete config.response_name;
                    else config.response_name = v;
                    onChange({ ...spec, config });
                }}
                aria-invalid={invalid || undefined}
                className={invalid ? 'imcrm-h-8 imcrm-border-destructive' : 'imcrm-h-8'}
                data-testid="record-action-result-name"
            />
            {invalid ? (
                <span className="imcrm-text-[11px] imcrm-text-destructive">
                    {__('Usa minúsculas, números y guiones bajos, empezando con una letra (máximo 40).')}
                </span>
            ) : (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                    {outputs.map((o) => (
                        <code key={o} className="imcrm-rounded imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">
                            {`{{respuestas.${name}.${o}}}`}
                        </code>
                    ))}
                </div>
            )}
        </div>
    );
}

interface ConditionRow {
    field: string;
    op: FindOperator;
    value: string;
}

function conditionRowsOf(raw: unknown): ConditionRow[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
        .map((r) => ({
            field: String(r.field ?? r.slug ?? ''),
            op: ((FIND_OPERATORS as readonly string[]).includes(String(r.op)) ? r.op : 'eq') as FindOperator,
            value: r.value === undefined || r.value === null ? '' : String(r.value),
        }));
}

/** Operadores que tienen sentido para cada tipo (el motor acepta todos; esto evita confusiones). */
function operatorsFor(type: string | undefined): FindOperator[] {
    if (type === 'relation') return ['eq', 'neq', 'is_null', 'is_not_null'];
    if (type === 'checkbox') return ['eq', 'neq'];
    if (type === 'select') return ['eq', 'neq', 'is_null', 'is_not_null'];
    if (type === 'multi_select') return ['contains', 'not_contains', 'is_null', 'is_not_null'];
    if (type === 'number' || type === 'currency' || type === 'percent' || type === 'rating' || type === 'duration' || type === 'date' || type === 'datetime') {
        return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
    }
    return ['eq', 'neq', 'contains', 'not_contains', 'is_null', 'is_not_null'];
}

function valueHint(field: FieldEntity | undefined): string {
    if (!field) return __('Valor o variable');
    if (field.type === 'relation') return __('Id del registro vinculado, ej. {{record.id}}');
    if (field.type === 'select' || field.type === 'multi_select') return __('La opción (su nombre) o una variable');
    if (field.type === 'checkbox') return __('Sí o No');
    if (field.type === 'date' || field.type === 'datetime') return __('AAAA-MM-DD o {{campo}}');
    if (field.type === 'phone') return __('{{telefono}} — con o sin indicativo');
    return __('{{campo}} o un valor');
}

/** «Buscar registros» en esta lista u otra. */
export function FindRecordsConfig({ spec, onChange, fields }: EditorProps): JSX.Element {
    const cfg = readFindRecordsConfig(spec.config);
    const currentListId = useAutomationListId();
    const targetId = cfg.listId ?? currentListId;
    const sameList = cfg.listId === null || cfg.listId === currentListId;
    const targetFields = useFields(targetId);
    const tf = (targetFields.data ?? []).filter((f) => isFindableFieldType(f.type));
    const [rows, setRows] = useState<ConditionRow[]>(() => conditionRowsOf(spec.config.conditions));

    const set = (patch: Record<string, unknown>): void => {
        const config: Record<string, unknown> = { ...spec.config, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete config[k];
        onChange({ ...spec, config });
    };
    const commitRows = (next: ConditionRow[]): void => {
        setRows(next);
        set({ conditions: next.filter((r) => r.field !== '').map((r) => ({ field: r.field, op: r.op, value: findOperatorIsNullary(r.op) ? '' : r.value })) });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="action-find-records">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Busca registros que cumplan las condiciones y deja lo que encontró para los pasos siguientes: cuántos son, el primero y sus ids (sirven para vincularlos o para «Repetir por cada vinculado»). Sólo lee: no cambia nada.')}
            </p>
            <ListPicker
                value={cfg.listId}
                onChange={(id) => {
                    setRows([]);
                    set({ list_id: id ?? undefined, conditions: [], sort_field: undefined });
                }}
                testId="find-records-list"
            />

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Que cumplan')}</Label>
                <Select value={cfg.logic} onChange={(e) => set({ logic: e.target.value === 'or' ? 'or' : undefined })} aria-label={__('Cómo se combinan')} className="imcrm-h-8 imcrm-flex-1">
                    <option value="and">{__('Todas las condiciones')}</option>
                    <option value="or">{__('Alguna de las condiciones')}</option>
                </Select>
            </div>

            {rows.map((r, i) => {
                const field = tf.find((f) => f.slug === r.field);
                const ops = operatorsFor(field?.type);
                return (
                    <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2" data-testid="find-records-condition">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <Select
                                value={r.field}
                                onChange={(e) => {
                                    const nf = tf.find((f) => f.slug === e.target.value);
                                    const nops = operatorsFor(nf?.type);
                                    const next = [...rows];
                                    next[i] = { field: e.target.value, op: nops.includes(r.op) ? r.op : nops[0]!, value: '' };
                                    commitRows(next);
                                }}
                                aria-label={__('Campo')}
                                className="imcrm-h-8 imcrm-min-w-[140px] imcrm-flex-1"
                            >
                                <option value="">{__('— Campo —')}</option>
                                {tf.map((f) => (
                                    <option key={f.id} value={f.slug}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                            <Select
                                value={r.op}
                                onChange={(e) => {
                                    const next = [...rows];
                                    next[i] = { ...r, op: e.target.value as FindOperator };
                                    commitRows(next);
                                }}
                                aria-label={__('Operador')}
                                className="imcrm-h-8 imcrm-w-auto imcrm-min-w-[120px]"
                            >
                                {(ops.includes(r.op) ? ops : [...ops, r.op]).map((op) => (
                                    <option key={op} value={op}>
                                        {__(FIND_OPERATOR_LABELS[op])}
                                    </option>
                                ))}
                            </Select>
                            <Button type="button" variant="ghost" size="icon" onClick={() => commitRows(rows.filter((_, j) => j !== i))} aria-label={__('Eliminar condición')} className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0">
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </div>
                        {!findOperatorIsNullary(r.op) && (
                            <MergeTagInput
                                value={r.value}
                                onChange={(v) => {
                                    const next = [...rows];
                                    next[i] = { ...r, value: v };
                                    commitRows(next);
                                }}
                                fields={fields}
                                placeholder={valueHint(field)}
                                aria-label={__('Valor')}
                            />
                        )}
                    </div>
                );
            })}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows([...rows, { field: '', op: 'eq', value: '' }])}
                disabled={targetFields.data === undefined || rows.length >= 20}
                className="imcrm-self-start imcrm-gap-2"
                data-testid="find-records-add-condition"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Añadir condición')}
            </Button>
            {rows.filter((r) => r.field !== '').length === 0 && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Sin condiciones trae los registros de la lista (los más nuevos primero).')}</p>
            )}
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('El texto se compara sin mayúsculas ni espacios de más y el teléfono con o sin indicativo. Si una variable llega vacía, esa condición no busca «vacío»: con «Todas» no encuentra nada y con «Alguna» se ignora.')}
            </p>

            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Ordenar por')}</Label>
                    <div className="imcrm-flex imcrm-gap-1.5">
                        <Select value={cfg.sortField ?? ''} onChange={(e) => set({ sort_field: e.target.value === '' ? undefined : e.target.value })} aria-label={__('Ordenar por')} className="imcrm-h-8 imcrm-flex-1">
                            <option value="">{__('Fecha de alta')}</option>
                            {tf
                                .filter((f) => f.type !== 'relation' && f.type !== 'multi_select')
                                .map((f) => (
                                    <option key={f.id} value={f.slug}>
                                        {f.label}
                                    </option>
                                ))}
                        </Select>
                        <Select value={cfg.sortDir} onChange={(e) => set({ sort_dir: e.target.value === 'asc' ? 'asc' : undefined })} aria-label={__('Dirección')} className="imcrm-h-8 imcrm-w-auto">
                            <option value="desc">{cfg.sortField === null ? __('Más nuevos primero') : __('De mayor a menor')}</option>
                            <option value="asc">{cfg.sortField === null ? __('Más viejos primero') : __('De menor a mayor')}</option>
                        </Select>
                    </div>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{sprintf(__('Cuántos traer (máximo %d)'), FIND_RECORDS_MAX)}</Label>
                    <Input
                        type="number"
                        min={1}
                        max={FIND_RECORDS_MAX}
                        value={typeof spec.config.limit === 'number' ? spec.config.limit : FIND_RECORDS_DEFAULT_LIMIT}
                        onChange={(e) => {
                            const n = Math.round(Number(e.target.value));
                            set({ limit: Number.isFinite(n) && n > 0 ? Math.min(n, FIND_RECORDS_MAX) : undefined });
                        }}
                        className="imcrm-h-8"
                        aria-label={__('Cuántos traer')}
                    />
                </div>
            </div>

            {sameList && (
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                    <input type="checkbox" checked={cfg.excludeSelf} onChange={(e) => set({ exclude_self: e.target.checked ? undefined : false })} />
                    {__('No contar el registro que disparó la automatización')}
                </label>
            )}

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Si no encuentra nada')}</Label>
                <Select value={cfg.ifNone} onChange={(e) => set({ if_none: e.target.value === 'stop' ? 'stop' : undefined })} aria-label={__('Si no encuentra nada')} className="imcrm-h-8 imcrm-flex-1" data-testid="find-records-if-none">
                    <option value="continue">{__('Seguir con los pasos siguientes')}</option>
                    <option value="stop">{__('Detener la automatización')}</option>
                </Select>
            </div>

            <ResultName spec={spec} onChange={onChange} fallback={FIND_RECORDS_DEFAULT_NAME} outputs={['cantidad', 'primero.id', 'primero.titulo', 'ids']} />
        </div>
    );
}

/** «Crear o actualizar un registro»: busca por el id o por un campo «Sin repetidos». */
export function UpsertRecordConfig({ spec, onChange, fields }: EditorProps): JSX.Element {
    const cfg = readUpsertRecordConfig(spec.config);
    const currentListId = useAutomationListId();
    const targetId = cfg.listId ?? currentListId;
    const targetFields = useFields(targetId);
    const tf = targetFields.data ?? [];
    const [valueRows, setValueRows] = useState<ValueRow[]>(() => readValueRows(spec.config.values));
    const matchField = cfg.match.by === 'field' ? tf.find((f) => f.slug === (cfg.match as { field: string }).field) : undefined;
    const matchError = cfg.match.by === 'field' && targetFields.data !== undefined ? webhookMatchFieldError(matchField) : null;

    const set = (patch: Record<string, unknown>): void => {
        const config: Record<string, unknown> = { ...spec.config, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete config[k];
        onChange({ ...spec, config });
    };
    const commitValues = (next: ValueRow[]): void => {
        setValueRows(next);
        set({ values: valueRowsToConfig(next) });
    };
    const candidates = tf.filter((f) => f.type !== 'relation' && !['file', 'button'].includes(f.type));

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="action-upsert-record">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Busca un registro por un dato (su id, un correo, un NIT…) y, según lo que elijas, lo actualiza o lo crea. Nunca adivina: si el dato coincide con más de un registro, no toca ninguno y lo dice.')}
            </p>
            <ListPicker
                value={cfg.listId}
                onChange={(id) => {
                    setValueRows([]);
                    set({ list_id: id ?? undefined, values: {}, match_by: undefined, match_field: undefined });
                }}
                testId="upsert-record-list"
            />
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Qué hacer')}</Label>
                <Select value={cfg.mode} onChange={(e) => set({ mode: e.target.value === 'upsert' ? undefined : e.target.value })} aria-label={__('Qué hacer')} className="imcrm-h-8 imcrm-flex-1" data-testid="upsert-record-mode">
                    {UPSERT_MODES.map((m) => (
                        <option key={m} value={m}>
                            {__(UPSERT_MODE_LABELS[m])}
                        </option>
                    ))}
                </Select>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2">
                <Label className="imcrm-text-xs">{__('Buscar el registro por')}</Label>
                <Select
                    value={cfg.match.by === 'field' ? `field:${(cfg.match as { field: string }).field}` : 'record_id'}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'record_id') set({ match_by: undefined, match_field: undefined });
                        else set({ match_by: 'field', match_field: v.slice('field:'.length) });
                    }}
                    aria-label={__('Buscar el registro por')}
                    className="imcrm-h-8"
                    data-testid="upsert-record-match"
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
                {matchError !== null && <p className="imcrm-text-[11px] imcrm-text-destructive">{matchError}</p>}
                <MergeTagInput
                    value={cfg.matchValue}
                    onChange={(v) => set({ match_value: v === '' ? undefined : v })}
                    fields={fields}
                    placeholder={cfg.match.by === 'record_id' ? __('{{respuestas.busqueda.primero.id}} o {{payload.id}}') : __('{{correo}}, {{payload.nit}}…')}
                    aria-label={__('Con este dato')}
                />
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {cfg.match.by === 'record_id'
                        ? __('Con el id, si no lo encuentra en la lista (o llega vacío) lo crea, según lo que elegiste arriba.')
                        : __('Si lo crea, este dato queda escrito en el campo por el que busca. El texto se compara sin mayúsculas y el teléfono con o sin indicativo.')}
                </p>
            </div>

            <Label className="imcrm-text-xs">{cfg.mode === 'create_only' ? __('Valores del registro nuevo') : __('Qué escribir en el registro')}</Label>
            {valueRows.map((v, i) => {
                const selectedField = tf.find((f) => f.slug === v.slug);
                return (
                    <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2">
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Select
                                value={v.slug}
                                onChange={(e) => {
                                    const next = [...valueRows];
                                    next[i] = { slug: e.target.value, value: '' };
                                    commitValues(next);
                                }}
                                aria-label={__('Campo')}
                                className="imcrm-h-8 imcrm-flex-1"
                            >
                                <option value="">{__('— Campo —')}</option>
                                {tf
                                    .filter((f) => !DERIVED_FIELD_TYPES.has(f.type))
                                    .map((f) => (
                                        <option key={f.id} value={f.slug}>
                                            {f.label}
                                        </option>
                                    ))}
                            </Select>
                            <Button type="button" variant="ghost" size="icon" onClick={() => commitValues(valueRows.filter((_, j) => j !== i))} aria-label={__('Eliminar')} className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0">
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
                disabled={targetFields.data === undefined}
                className="imcrm-self-start imcrm-gap-2"
                data-testid="upsert-record-add-value"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Añadir valor')}
            </Button>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Un valor que llega vacío no borra lo que el registro ya tiene. Si no cambia nada, no se escribe (ni dispara otras automatizaciones).')}
            </p>

            <ResultName spec={spec} onChange={onChange} fallback={UPSERT_RECORD_DEFAULT_NAME} outputs={['id', 'titulo', 'accion']} />
        </div>
    );
}

/** «Cuando se agrega un comentario»: quién, qué tipo, respuestas y palabras. */
export function CommentTriggerConfig({ config, onChange }: { config: TriggerConfig; onChange: (next: TriggerConfig) => void }): JSX.Element {
    const c = readCommentTriggerConfig(config);
    const set = (key: string, value: string): void => {
        const next: TriggerConfig = { ...config };
        if (value === '' || value === 'any') delete next[key];
        else next[key] = value;
        onChange(next);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-comment-config">
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Quién lo escribe')}</Label>
                    <Select value={c.from} onChange={(e) => set('comment_from', e.target.value)} aria-label={__('Quién lo escribe')} className="imcrm-h-8" data-testid="trigger-comment-from">
                        {COMMENT_TRIGGER_AUTHORS.map((k) => (
                            <option key={k} value={k}>
                                {__(COMMENT_TRIGGER_AUTHOR_LABELS[k])}
                            </option>
                        ))}
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Qué tipo de comentario')}</Label>
                    <Select value={c.visibility} onChange={(e) => set('comment_visibility', e.target.value)} aria-label={__('Qué tipo de comentario')} className="imcrm-h-8">
                        {COMMENT_TRIGGER_VISIBILITIES.map((k) => (
                            <option key={k} value={k}>
                                {__(COMMENT_TRIGGER_VISIBILITY_LABELS[k])}
                            </option>
                        ))}
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Hilos')}</Label>
                    <Select value={c.replies} onChange={(e) => set('comment_replies', e.target.value)} aria-label={__('Hilos')} className="imcrm-h-8">
                        {COMMENT_TRIGGER_REPLY_FILTERS.map((k) => (
                            <option key={k} value={k}>
                                {__(COMMENT_TRIGGER_REPLY_LABELS[k])}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label className="imcrm-text-xs">{__('Sólo si el texto tiene alguna de estas palabras (opcional)')}</Label>
                <Input
                    value={c.contains}
                    onChange={(e) => onChange({ ...config, comment_contains: e.target.value })}
                    placeholder={__('urgente, factura, reclamo')}
                    className="imcrm-h-8"
                    data-testid="trigger-comment-contains"
                />
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Separadas por comas; basta con una. Sin mayúsculas ni tildes. Los comentarios de los agentes de IA nunca disparan automatizaciones.')}
                </p>
            </div>
        </div>
    );
}
