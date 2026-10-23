import { useMemo, useState } from 'react';
import {
    FIELD_FORMAT_LABELS,
    FIELD_FORMAT_PRESETS,
    analyzeUserPattern,
    checkValueRules,
    defaultKindsFor,
    fieldDefaultOf,
    fieldValidationOf,
    formatDuration,
    isUserWritableType,
    parseDuration,
    validationKindsFor,
    type FieldDefault,
    type FieldFormatPreset,
    type FieldType,
    type FieldValidation,
    type RequiredIfOp,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { __ } from '@/lib/i18n';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';

/**
 * v0.1.300 — Valor por defecto y validaciones de un campo que se escribe a mano.
 *
 * Escribe `config.default_value` y `config.validation` (ver
 * `packages/shared/src/schemas/field-rules.ts`). El servidor vuelve a
 * normalizar todo al guardar (`FieldsService.normalizeRules`): valida el
 * valor por defecto contra el tipo, analiza la expresión regular contra ReDoS
 * y comprueba que "obligatorio si" apunte a otro campo de la misma lista.
 * Aquí sólo se arma la config y se avisa antes de guardar.
 */
interface Props {
    type: FieldTypeSlug | '';
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    listId?: number;
    currentFieldId?: number;
}

interface OptionRow {
    value: string;
    label: string;
}

const NUMBER_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent']);

function optionsOf(config: Record<string, unknown>): OptionRow[] {
    const raw = Array.isArray(config.options) ? config.options : [];
    return raw
        .map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>) : null))
        .filter((o): o is Record<string, unknown> => o !== null && typeof o.value === 'string' && o.value !== '')
        .map((o) => ({ value: String(o.value), label: typeof o.label === 'string' && o.label !== '' ? o.label : String(o.value) }));
}

/** `2026-10-20T14:30:00.000Z` → `2026-10-20T09:30` (hora local, para `datetime-local`). */
function isoToLocalInput(iso: unknown): string {
    if (typeof iso !== 'string' || iso === '') return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function numberOrNull(raw: string): number | null {
    const t = raw.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

export function FieldRulesEditor({ type, config, onChange, listId, currentFieldId }: Props): JSX.Element | null {
    if (type === '' || !isUserWritableType(type as FieldType)) return null;
    const t = type as FieldType;
    const defaultKinds = defaultKindsFor(t);
    const kinds = validationKindsFor(t);
    const hasValidation = kinds.range !== null || kinds.length || kinds.format || kinds.requiredIf;
    if (defaultKinds.length === 0 && !hasValidation) return null;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="field-rules-editor">
            {defaultKinds.length > 0 && <DefaultValueSection type={t} config={config} onChange={onChange} />}
            {hasValidation && (
                <ValidationSection type={t} config={config} onChange={onChange} listId={listId} currentFieldId={currentFieldId} />
            )}
        </div>
    );
}

// ─── Valor por defecto ───────────────────────────────────────────────────

function Box({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                <span className="imcrm-text-sm imcrm-font-medium">{title}</span>
                {hint && <span className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</span>}
            </div>
            {children}
        </div>
    );
}

interface SectionProps {
    type: FieldType;
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
}

function DefaultValueSection({ type, config, onChange }: SectionProps): JSX.Element {
    const def = fieldDefaultOf(config);

    const setDefault = (next: FieldDefault | null): void => {
        const out = { ...config };
        if (next === null) delete out.default_value;
        else out.default_value = next;
        onChange(out);
    };
    const setValue = (value: unknown): void => {
        const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
        setDefault(empty ? null : { kind: 'value', value });
    };
    const fixed = def?.kind === 'value' ? def.value : undefined;

    let control: JSX.Element;
    switch (type) {
        case 'checkbox':
            control = (
                <Select value={fixed === true ? '1' : ''} onChange={(e) => setValue(e.target.value === '1' ? true : null)} aria-label={__('Valor por defecto')}>
                    <option value="">{__('Desmarcada')}</option>
                    <option value="1">{__('Marcada')}</option>
                </Select>
            );
            break;
        case 'user':
            control = (
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        checked={def?.kind === 'creator'}
                        onChange={(e) => setDefault(e.target.checked ? { kind: 'creator' } : null)}
                    />
                    {__('Asignar a quien crea el registro')}
                </label>
            );
            break;
        case 'select': {
            const options = optionsOf(config);
            control = (
                <Select value={typeof fixed === 'string' ? fixed : ''} onChange={(e) => setValue(e.target.value || null)} aria-label={__('Valor por defecto')}>
                    <option value="">{__('Ninguno')}</option>
                    {options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </Select>
            );
            break;
        }
        case 'multi_select': {
            const options = optionsOf(config);
            const chosen = Array.isArray(fixed) ? fixed.map(String) : [];
            control =
                options.length === 0 ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Agrega opciones arriba para elegir las que vienen marcadas.')}</p>
                ) : (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1.5">
                        {options.map((o) => (
                            <label key={o.value} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={chosen.includes(o.value)}
                                    onChange={(e) =>
                                        setValue(e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))
                                    }
                                />
                                {o.label}
                            </label>
                        ))}
                    </div>
                );
            break;
        }
        case 'rating': {
            const max = typeof config.max === 'number' ? config.max : 5;
            control = (
                <Select value={typeof fixed === 'number' ? String(fixed) : ''} onChange={(e) => setValue(e.target.value === '' ? null : Number(e.target.value))} aria-label={__('Valor por defecto')}>
                    <option value="">{__('Ninguno')}</option>
                    {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                            {n}
                        </option>
                    ))}
                </Select>
            );
            break;
        }
        case 'date':
        case 'datetime': {
            const dynamicKind = type === 'date' ? 'today' : 'now';
            const mode = def?.kind === dynamicKind ? dynamicKind : def?.kind === 'value' ? 'value' : '';
            control = (
                <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                    <Select
                        value={mode}
                        aria-label={__('Valor por defecto')}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') setDefault(null);
                            else if (v === dynamicKind) setDefault({ kind: dynamicKind });
                            else setDefault({ kind: 'value', value: fixed ?? undefined });
                        }}
                    >
                        <option value="">{__('Ninguno')}</option>
                        <option value={dynamicKind}>
                            {type === 'date' ? __('Hoy (el día en que se crea)') : __('La fecha y hora en que se crea')}
                        </option>
                        <option value="value">{type === 'date' ? __('Una fecha fija') : __('Una fecha y hora fija')}</option>
                    </Select>
                    {mode === 'value' &&
                        (type === 'date' ? (
                            <Input
                                type="date"
                                value={typeof fixed === 'string' ? fixed.slice(0, 10) : ''}
                                onChange={(e) => setDefault({ kind: 'value', value: e.target.value || undefined })}
                                aria-label={__('Fecha por defecto')}
                            />
                        ) : (
                            <Input
                                type="datetime-local"
                                value={isoToLocalInput(fixed)}
                                onChange={(e) => {
                                    const d = e.target.value ? new Date(e.target.value) : null;
                                    setDefault({ kind: 'value', value: d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined });
                                }}
                                aria-label={__('Fecha y hora por defecto')}
                            />
                        ))}
                </div>
            );
            break;
        }
        case 'duration':
            control = (
                <DraftInput
                    value={typeof fixed === 'number' ? formatDuration(fixed) : typeof fixed === 'string' ? fixed : ''}
                    placeholder={__('Ej. 1h 30m')}
                    onCommit={(raw) => {
                        if (raw.trim() === '') return setValue(null);
                        const p = parseDuration(raw);
                        setValue(p.ok ? p.value : raw);
                    }}
                />
            );
            break;
        default:
            if (NUMBER_TYPES.has(type)) {
                control = (
                    <DraftInput
                        inputMode="decimal"
                        value={typeof fixed === 'number' ? String(fixed) : ''}
                        placeholder={__('Ninguno')}
                        onCommit={(raw) => setValue(numberOrNull(raw))}
                    />
                );
            } else {
                control = (
                    <DraftInput
                        value={typeof fixed === 'string' ? fixed : ''}
                        placeholder={__('Ninguno')}
                        onCommit={(raw) => setValue(raw === '' ? null : raw)}
                    />
                );
            }
    }

    return (
        <Box title={__('Valor por defecto')} hint={__('Se pone solo al crear un registro sin ese dato (alta, formularios, importación, automatizaciones y API).')}>
            {control}
        </Box>
    );
}

/** Input con borrador local: el valor se manda al salir del campo o con Enter. */
function DraftInput({
    value,
    onCommit,
    placeholder,
    inputMode,
    type = 'text',
    ariaLabel,
}: {
    value: string;
    onCommit: (raw: string) => void;
    placeholder?: string;
    inputMode?: 'decimal' | 'numeric' | 'text';
    type?: string;
    ariaLabel?: string;
}): JSX.Element {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <Input
            type={type}
            inputMode={inputMode}
            value={draft ?? value}
            placeholder={placeholder}
            aria-label={ariaLabel ?? placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                if (draft !== null && draft !== value) onCommit(draft);
                setDraft(null);
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                }
            }}
        />
    );
}

// ─── Validaciones ────────────────────────────────────────────────────────

interface ValidationProps extends SectionProps {
    listId?: number;
    currentFieldId?: number;
}

function ValidationSection({ type, config, onChange, listId, currentFieldId }: ValidationProps): JSX.Element {
    const kinds = validationKindsFor(type);
    const v: FieldValidation = fieldValidationOf(config) ?? {};

    /** Aplica un parche a `validation` quitando lo vacío (y la clave entera si queda vacía). */
    const patch = (changes: Partial<Record<keyof FieldValidation, unknown>>, extra?: (out: Record<string, unknown>) => void): void => {
        const next: Record<string, unknown> = { ...v, ...changes };
        for (const [k, val] of Object.entries(next)) {
            if (val === null || val === undefined || val === '') delete next[k];
        }
        const out = { ...config };
        if (Object.keys(next).length > 0) out.validation = next;
        else delete out.validation;
        extra?.(out);
        onChange(out);
    };

    return (
        <Box title={__('Validaciones')} hint={__('Se revisan al guardar desde cualquier lado: la tabla, la ficha, el alta, los formularios, la importación y la API.')}>
            {kinds.range === 'number' && <NumberRange v={v} patch={patch} type={type} />}
            {kinds.range === 'date' && <DateRange v={v} patch={patch} />}
            {kinds.length && <LengthRange v={v} patch={patch} config={config} />}
            {kinds.format && <FormatRule v={v} patch={patch} type={type} config={config} />}
            {kinds.requiredIf && <RequiredIfRule v={v} patch={patch} listId={listId} currentFieldId={currentFieldId} />}
        </Box>
    );
}

type Patch = (changes: Partial<Record<keyof FieldValidation, unknown>>, extra?: (out: Record<string, unknown>) => void) => void;

function MessageInput({ value, onCommit }: { value: string | undefined; onCommit: (raw: string) => void }): JSX.Element {
    return (
        <DraftInput
            value={value ?? ''}
            placeholder={__('Mensaje si no se cumple (opcional)')}
            onCommit={(raw) => onCommit(raw.trim())}
        />
    );
}

function NumberRange({ v, patch, type }: { v: FieldValidation; patch: Patch; type: FieldType }): JSX.Element {
    const min = typeof v.min === 'number' ? v.min : null;
    const max = typeof v.max === 'number' ? v.max : null;
    const isDuration = type === 'duration';
    const show = (n: number | null): string => (n === null ? '' : isDuration ? formatDuration(n) : String(n));
    const parse = (raw: string): number | null => {
        if (raw.trim() === '') return null;
        if (isDuration) {
            const p = parseDuration(raw);
            return p.ok ? p.value : null;
        }
        return numberOrNull(raw);
    };
    const swapped = min !== null && max !== null && min > max;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{isDuration ? __('Duración mínima y máxima') : __('Valor mínimo y máximo')}</Label>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <DraftInput inputMode={isDuration ? 'text' : 'decimal'} value={show(min)} placeholder={__('Mínimo')} onCommit={(raw) => patch({ min: parse(raw) })} />
                <DraftInput inputMode={isDuration ? 'text' : 'decimal'} value={show(max)} placeholder={__('Máximo')} onCommit={(raw) => patch({ max: parse(raw) })} />
            </div>
            {swapped && <p className="imcrm-text-xs imcrm-text-destructive">{__('El mínimo no puede ser mayor que el máximo.')}</p>}
            {(min !== null || max !== null) && <MessageInput value={v.range_message} onCommit={(raw) => patch({ range_message: raw })} />}
        </div>
    );
}

function DateRange({ v, patch }: { v: FieldValidation; patch: Patch }): JSX.Element {
    const min = typeof v.min === 'string' ? v.min : '';
    const max = typeof v.max === 'string' ? v.max : '';
    const swapped = min !== '' && max !== '' && min > max;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{__('Fecha mínima y máxima')}</Label>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Input type="date" value={min} aria-label={__('Fecha mínima')} onChange={(e) => patch({ min: e.target.value || null })} />
                <Input type="date" value={max} aria-label={__('Fecha máxima')} onChange={(e) => patch({ max: e.target.value || null })} />
            </div>
            {swapped && <p className="imcrm-text-xs imcrm-text-destructive">{__('La fecha mínima no puede ser posterior a la máxima.')}</p>}
            {(min !== '' || max !== '') && <MessageInput value={v.range_message} onCommit={(raw) => patch({ range_message: raw })} />}
        </div>
    );
}

function LengthRange({ v, patch, config }: { v: FieldValidation; patch: Patch; config: Record<string, unknown> }): JSX.Element {
    // El largo máximo "del tipo" (`config.max_length`, de antes) se muestra
    // aquí y, al tocarlo, se muda a la validación (con su mensaje propio).
    const legacyMax = typeof config.max_length === 'number' ? config.max_length : null;
    const minL = typeof v.min_length === 'number' ? v.min_length : null;
    const maxL = typeof v.max_length === 'number' ? v.max_length : legacyMax;
    const int = (raw: string): number | null => {
        const n = numberOrNull(raw);
        return n === null ? null : Math.max(0, Math.floor(n));
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{__('Largo mínimo y máximo (caracteres)')}</Label>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <DraftInput inputMode="numeric" value={minL === null ? '' : String(minL)} placeholder={__('Mínimo')} onCommit={(raw) => patch({ min_length: int(raw) })} />
                <DraftInput
                    inputMode="numeric"
                    value={maxL === null ? '' : String(maxL)}
                    placeholder={__('Máximo')}
                    onCommit={(raw) => {
                        const n = int(raw);
                        patch({ max_length: n === 0 ? null : n }, (out) => {
                            delete out.max_length;
                        });
                    }}
                />
            </div>
            {minL !== null && maxL !== null && minL > maxL && (
                <p className="imcrm-text-xs imcrm-text-destructive">{__('El largo mínimo no puede ser mayor que el máximo.')}</p>
            )}
            {(minL !== null || typeof v.max_length === 'number') && (
                <MessageInput value={v.length_message} onCommit={(raw) => patch({ length_message: raw })} />
            )}
        </div>
    );
}

function FormatRule({ v, patch, type, config }: { v: FieldValidation; patch: Patch; type: FieldType; config: Record<string, unknown> }): JSX.Element {
    const format = (v.format ?? '') as FieldFormatPreset | '';
    const pattern = typeof v.pattern === 'string' ? v.pattern : '';
    const analysis = useMemo(() => (format === 'regex' && pattern !== '' ? analyzeUserPattern(pattern) : null), [format, pattern]);
    const [sample, setSample] = useState('');
    const sampleError = useMemo(() => {
        if (sample.trim() === '' || format === '') return null;
        if (format === 'regex' && (!analysis || !analysis.ok)) return null;
        return checkValueRules({ type, config }, sample) ?? '';
    }, [sample, format, analysis, type, config]);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{__('Formato')}</Label>
            <Select
                value={format}
                aria-label={__('Formato')}
                onChange={(e) => {
                    const next = e.target.value as FieldFormatPreset | '';
                    patch({
                        format: next || null,
                        pattern: next === 'regex' ? pattern : null,
                        pattern_ignore_case: next === 'regex' ? v.pattern_ignore_case : null,
                        format_message: next ? v.format_message : null,
                    });
                }}
            >
                <option value="">{__('Cualquier texto')}</option>
                {FIELD_FORMAT_PRESETS.map((f) => (
                    <option key={f} value={f}>
                        {FIELD_FORMAT_LABELS[f]}
                    </option>
                ))}
            </Select>
            {format === 'regex' && (
                <>
                    <DraftInput value={pattern} placeholder={__('Ej. ^[A-Z]{2}-\\d{4}$')} ariaLabel={__('Expresión regular')} onCommit={(raw) => patch({ pattern: raw })} />
                    {analysis && !analysis.ok && <p className="imcrm-text-xs imcrm-text-destructive">{analysis.reason}</p>}
                    {analysis?.ok && (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Expresión revisada: se aplica al valor completo y no puede trabar el servidor.')}
                        </p>
                    )}
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            checked={v.pattern_ignore_case === true}
                            onChange={(e) => patch({ pattern_ignore_case: e.target.checked ? true : null })}
                        />
                        {__('Sin distinguir mayúsculas y minúsculas')}
                    </label>
                </>
            )}
            {format !== '' && (
                <>
                    <MessageInput value={v.format_message} onCommit={(raw) => patch({ format_message: raw })} />
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Input value={sample} onChange={(e) => setSample(e.target.value)} placeholder={__('Prueba un valor')} aria-label={__('Prueba un valor')} />
                        {sampleError === '' && <p className="imcrm-text-xs imcrm-text-success">{__('Cumple el formato.')}</p>}
                        {sampleError && <p className="imcrm-text-xs imcrm-text-destructive">{sampleError}</p>}
                    </div>
                </>
            )}
        </div>
    );
}

const REQUIRED_IF_LABELS: Record<RequiredIfOp, string> = {
    eq: 'es',
    neq: 'no es',
    not_empty: 'tiene valor',
};

function RequiredIfRule({ v, patch, listId, currentFieldId }: { v: FieldValidation; patch: Patch; listId?: number; currentFieldId?: number }): JSX.Element {
    const fieldsQuery = useFields(listId);
    const candidates = useMemo(
        () =>
            ((fieldsQuery.data ?? []) as FieldEntity[]).filter(
                (f) => f.id !== currentFieldId && isUserWritableType(f.type as FieldType) && f.type !== 'file',
            ),
        [fieldsQuery.data, currentFieldId],
    );
    const rule = v.required_if ?? null;
    const other = rule?.field_id ? candidates.find((f) => f.id === rule.field_id) ?? null : null;
    const op: RequiredIfOp = rule?.op ?? 'eq';

    const setRule = (next: Partial<NonNullable<FieldValidation['required_if']>> | null): void => {
        if (next === null) return patch({ required_if: null });
        const merged = { field_id: rule?.field_id ?? null, op, ...(rule ?? {}), ...next };
        if (merged.op === 'not_empty') delete (merged as { value?: unknown }).value;
        patch({ required_if: merged });
    };

    if (listId === undefined) return <></>;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{__('Obligatorio sólo si…')}</Label>
            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-[1fr_auto_1fr]">
                <Select
                    value={rule?.field_id ? String(rule.field_id) : ''}
                    aria-label={__('Campo de la condición')}
                    onChange={(e) => {
                        const id = Number(e.target.value);
                        if (!id) return setRule(null);
                        setRule({ field_id: id, op: rule?.op ?? 'eq', value: undefined });
                    }}
                >
                    <option value="">{__('Nunca (no aplica)')}</option>
                    {candidates.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
                {other && (
                    <Select value={op} aria-label={__('Condición')} onChange={(e) => setRule({ op: e.target.value as RequiredIfOp })}>
                        {(Object.keys(REQUIRED_IF_LABELS) as RequiredIfOp[]).map((o) => (
                            <option key={o} value={o}>
                                {__(REQUIRED_IF_LABELS[o])}
                            </option>
                        ))}
                    </Select>
                )}
                {other && op !== 'not_empty' && <RequiredIfValue other={other} value={rule?.value} onChange={(value) => setRule({ value })} />}
            </div>
            {other && (
                <DraftInput
                    value={rule?.message ?? ''}
                    placeholder={__('Mensaje si falta (opcional)')}
                    onCommit={(raw) => setRule({ message: raw.trim() || undefined })}
                />
            )}
        </div>
    );
}

function RequiredIfValue({ other, value, onChange }: { other: FieldEntity; value: unknown; onChange: (v: unknown) => void }): JSX.Element {
    if (other.type === 'checkbox') {
        const on = value === true || value === 'true' || value === 1 || value === '1';
        return (
            <Select value={on ? '1' : '0'} aria-label={__('Valor')} onChange={(e) => onChange(e.target.value === '1')}>
                <option value="1">{__('Marcada')}</option>
                <option value="0">{__('Desmarcada')}</option>
            </Select>
        );
    }
    if (other.type === 'select' || other.type === 'multi_select') {
        const options = optionsOf(other.config);
        return (
            <Select value={typeof value === 'string' ? value : ''} aria-label={__('Valor')} onChange={(e) => onChange(e.target.value || undefined)}>
                <option value="">{__('Elige una opción')}</option>
                {options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </Select>
        );
    }
    return (
        <DraftInput
            value={value === undefined || value === null ? '' : String(value)}
            placeholder={__('Valor')}
            onCommit={(raw) => onChange(raw === '' ? undefined : NUMBER_TYPES.has(other.type) || other.type === 'rating' ? numberOrNull(raw) ?? raw : raw)}
        />
    );
}
