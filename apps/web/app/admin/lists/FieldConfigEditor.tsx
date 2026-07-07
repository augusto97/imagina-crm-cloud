import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    ColorPicker,
    isHexColor,
    isPresetColor,
    type OptionColor,
} from '@/components/ui/color-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { __ } from '@/lib/i18n';
import type { FieldTypeSlug } from '@/types/field';

/**
 * Editor de la propiedad `config` de un campo. Cambia su contenido
 * según el `type`: cada tipo tiene reglas distintas (select tiene
 * options, number tiene precision, relation tiene target_list_id, etc.).
 *
 * El config se guarda directo como `field.config` JSON en el backend,
 * y el RecordValidator/FieldType correspondiente lo interpreta. Aquí
 * solo damos UI; la validación final la hace PHP.
 */
interface FieldConfigEditorProps {
    type: FieldTypeSlug | '';
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    /** Solo lo necesita el editor `computed` para listar los otros
     * campos de la lista que pueden ser inputs. */
    listId?: number;
    /** Field ID actual (en edición) — para excluirlo de los inputs
     * elegibles del computed (no puede referenciarse a sí mismo). */
    currentFieldId?: number;
}

export function FieldConfigEditor({
    type,
    config,
    onChange,
    listId,
    currentFieldId,
}: FieldConfigEditorProps): JSX.Element | null {
    if (type === 'select' || type === 'multi_select') {
        return <OptionsEditor config={config} onChange={onChange} />;
    }
    if (type === 'text' || type === 'long_text') {
        return <MaxLengthEditor config={config} onChange={onChange} />;
    }
    if (type === 'number') {
        return <PrecisionEditor config={config} onChange={onChange} />;
    }
    if (type === 'currency') {
        return <CurrencyEditor config={config} onChange={onChange} />;
    }
    if (type === 'relation') {
        return <RelationEditor config={config} onChange={onChange} />;
    }
    if (type === 'checkbox') {
        return <CheckboxDefaultEditor config={config} onChange={onChange} />;
    }
    if (type === 'computed') {
        return (
            <ComputedEditor
                config={config}
                onChange={onChange}
                listId={listId}
                currentFieldId={currentFieldId}
            />
        );
    }
    // date/datetime/url/email/user/file: no requieren config extra en MVP.
    return null;
}

interface SubProps {
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
}

interface OptionRow {
    value: string;
    label: string;
    color: OptionColor | null;
}

/** Acepta tanto preset names (`'rose'`) como hex (`#rrggbb`). */
function isAcceptableColor(c: string): boolean {
    return isPresetColor(c) || isHexColor(c);
}

function OptionsEditor({ config, onChange }: SubProps): JSX.Element {
    const options = useMemo<OptionRow[]>(() => {
        const raw = config.options;
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((o): o is { value?: unknown; label?: unknown; color?: unknown } =>
                typeof o === 'object' && o !== null,
            )
            .map((o) => ({
                value: typeof o.value === 'string' ? o.value : String(o.value ?? ''),
                label: typeof o.label === 'string' ? o.label : String(o.label ?? ''),
                // Acepta tanto presets nombrados como hex (#rrggbb).
                // Si el string no matchea ninguno, descartamos (null) —
                // probablemente venía de un import o config corrupto.
                color: typeof o.color === 'string' && isAcceptableColor(o.color)
                    ? o.color
                    : null,
            }));
    }, [config.options]);

    const setOptions = (next: OptionRow[]): void => {
        // Persistimos `color` solo cuando es no-null para no inflar
        // el JSON con valores vacíos y no romper opciones legacy.
        onChange({
            ...config,
            options: next.map((o) => ({
                value: o.value,
                label: o.label,
                ...(o.color ? { color: o.color } : {}),
            })),
        });
    };

    const addRow = (): void => setOptions([...options, { value: '', label: '', color: null }]);

    return (
        <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-shadow-imcrm-sm">
            <legend className="imcrm-px-1.5 imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">
                {__('Opciones')}
            </legend>
            <p className="imcrm-text-[12px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                {__('Cada opción tiene un valor (interno, snake_case), un label visible y un color opcional para diferenciarla en chips.')}
            </p>

            {options.length === 0 ? (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-warning/40 imcrm-bg-warning/5 imcrm-px-3 imcrm-py-3 imcrm-text-[12px] imcrm-text-warning">
                    {__('Añade al menos una opción para que el campo sea usable.')}
                </div>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <li className="imcrm-grid imcrm-grid-cols-[2.25rem_1fr_1fr_2.25rem] imcrm-gap-2 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">
                        <span>{__('Color')}</span>
                        <span>{__('Valor')}</span>
                        <span>{__('Label')}</span>
                        <span aria-hidden />
                    </li>
                    {options.map((opt, i) => (
                        <li
                            key={i}
                            className="imcrm-grid imcrm-grid-cols-[2.25rem_1fr_1fr_2.25rem] imcrm-items-center imcrm-gap-2"
                        >
                            <ColorPicker
                                value={opt.color}
                                onChange={(color) => {
                                    const next = [...options];
                                    next[i] = { ...next[i]!, color };
                                    setOptions(next);
                                }}
                            />
                            <Input
                                value={opt.value}
                                onChange={(e) => {
                                    const next = [...options];
                                    next[i] = { ...next[i]!, value: e.target.value };
                                    setOptions(next);
                                }}
                                placeholder="active"
                            />
                            <Input
                                value={opt.label}
                                onChange={(e) => {
                                    const next = [...options];
                                    next[i] = { ...next[i]!, label: e.target.value };
                                    setOptions(next);
                                }}
                                placeholder={__('Activo')}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setOptions(options.filter((_, j) => j !== i))}
                                aria-label={__('Eliminar opción')}
                            >
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}

            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                className="imcrm-self-start imcrm-gap-2"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Añadir opción')}
            </Button>
        </fieldset>
    );
}

function MaxLengthEditor({ config, onChange }: SubProps): JSX.Element {
    const max = typeof config.max_length === 'number' ? config.max_length : '';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{__('Largo máximo (opcional)')}</Label>
            <Input
                type="number"
                min={1}
                max={65535}
                value={max}
                onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                        const next = { ...config };
                        delete next.max_length;
                        onChange(next);
                    } else {
                        onChange({ ...config, max_length: Number(v) });
                    }
                }}
                placeholder="255"
            />
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Si se deja vacío usa el default del tipo (255 para text, ilimitado para long text).')}
            </p>
        </div>
    );
}

function PrecisionEditor({ config, onChange }: SubProps): JSX.Element {
    const precision = typeof config.precision === 'number' ? config.precision : 0;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{__('Precisión decimal')}</Label>
            <Select
                value={precision}
                onChange={(e) => onChange({ ...config, precision: Number(e.target.value) })}
            >
                <option value={0}>{__('Entero (sin decimales)')}</option>
                <option value={1}>{__('1 decimal')}</option>
                <option value={2}>{__('2 decimales')}</option>
                <option value={4}>{__('4 decimales')}</option>
            </Select>
        </div>
    );
}

function CurrencyEditor({ config, onChange }: SubProps): JSX.Element {
    const currency = typeof config.currency === 'string' ? config.currency : 'USD';
    const precision = typeof config.precision === 'number' ? config.precision : 2;
    return (
        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Moneda')}</Label>
                <Input
                    value={currency}
                    onChange={(e) => onChange({ ...config, currency: e.target.value.toUpperCase() })}
                    placeholder="USD"
                    maxLength={3}
                />
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Decimales')}</Label>
                <Select
                    value={precision}
                    onChange={(e) => onChange({ ...config, precision: Number(e.target.value) })}
                >
                    <option value={0}>0</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                </Select>
            </div>
        </div>
    );
}

function RelationEditor({ config, onChange }: SubProps): JSX.Element {
    const lists = useLists();
    const targetId = typeof config.target_list_id === 'number' ? config.target_list_id : 0;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{__('Lista relacionada')}</Label>
            <Select
                value={targetId}
                onChange={(e) => onChange({ ...config, target_list_id: Number(e.target.value) })}
            >
                <option value={0}>{__('— Selecciona —')}</option>
                {(lists.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                        {l.name}
                    </option>
                ))}
            </Select>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('El campo permitirá vincular registros de esta lista.')}
            </p>
        </div>
    );
}

function CheckboxDefaultEditor({ config, onChange }: SubProps): JSX.Element {
    const def = config.default === true;
    return (
        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
            <input
                type="checkbox"
                checked={def}
                onChange={(e) => onChange({ ...config, default: e.target.checked })}
            />
            {__('Marcado por defecto')}
        </label>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Computed (campo calculado)
// ─────────────────────────────────────────────────────────────────────

interface ComputedOpDef {
    slug: string;
    label: string;
    /** Cuántos inputs requiere (fixed) o `[min, max]`. */
    arity: number | [number, number];
    /** Tipos de field aceptables como input (filtra el dropdown). */
    inputTypes: string[];
    /** Texto de ayuda mostrado abajo del operador. */
    hint: string;
}

const COMPUTED_OPS: ComputedOpDef[] = [
    {
        slug: 'date_diff_months',
        label: __('Diferencia en meses'),
        arity: 2,
        inputTypes: ['date', 'datetime'],
        hint: __('months(B) − months(A). Positivo si B es posterior a A; negativo si A es posterior.'),
    },
    {
        slug: 'date_diff_days',
        label: __('Diferencia en días'),
        arity: 2,
        inputTypes: ['date', 'datetime'],
        hint: __('Días entre A y B. Positivo si B es posterior.'),
    },
    {
        slug: 'sum',
        label: __('Suma'),
        arity: [2, 10],
        inputTypes: ['number', 'currency', 'computed'],
        hint: __('Suma de todos los inputs numéricos.'),
    },
    {
        slug: 'product',
        label: __('Producto'),
        arity: [2, 10],
        inputTypes: ['number', 'currency', 'computed'],
        hint: __('Multiplica todos los inputs.'),
    },
    {
        slug: 'subtract',
        label: __('Resta'),
        arity: 2,
        inputTypes: ['number', 'currency', 'computed'],
        hint: __('A − B.'),
    },
    {
        slug: 'divide',
        label: __('División'),
        arity: 2,
        inputTypes: ['number', 'currency', 'computed'],
        hint: __('A / B. Si B es 0, el campo queda vacío.'),
    },
    {
        slug: 'concat',
        label: __('Concatenar texto'),
        arity: [2, 10],
        inputTypes: ['text', 'long_text', 'email', 'url', 'select', 'computed'],
        hint: __('Une los inputs en un solo texto, separados por el separador.'),
    },
    {
        slug: 'abs',
        label: __('Valor absoluto'),
        arity: 1,
        inputTypes: ['number', 'currency', 'computed'],
        hint: __('Valor absoluto (siempre positivo) del input.'),
    },
];

interface ComputedEditorProps extends SubProps {
    listId?: number;
    currentFieldId?: number;
}

function ComputedEditor({
    config,
    onChange,
    listId,
    currentFieldId,
}: ComputedEditorProps): JSX.Element {
    const fields = useFields(listId);
    const operation = typeof config.operation === 'string' ? config.operation : '';
    const opDef = COMPUTED_OPS.find((o) => o.slug === operation);
    const inputs = Array.isArray(config.inputs) ? (config.inputs as number[]) : [];

    const eligibleFields = (fields.data ?? []).filter((f) => {
        if (currentFieldId !== undefined && f.id === currentFieldId) return false;
        if (!opDef) return true;
        return opDef.inputTypes.includes(f.type);
    });

    const setOperation = (slug: string): void => {
        // Reset inputs al cambiar la operación (los aceptables cambian).
        onChange({ ...config, operation: slug, inputs: [] });
    };

    const setInputAt = (idx: number, fieldId: number): void => {
        const next = [...inputs];
        next[idx] = fieldId;
        onChange({ ...config, inputs: next });
    };

    const addInput = (): void => {
        onChange({ ...config, inputs: [...inputs, 0] });
    };

    const removeInput = (idx: number): void => {
        onChange({ ...config, inputs: inputs.filter((_, i) => i !== idx) });
    };

    const setSeparator = (sep: string): void => {
        onChange({ ...config, separator: sep });
    };

    const minInputs = typeof opDef?.arity === 'number' ? opDef.arity : opDef?.arity[0] ?? 2;
    const maxInputs = typeof opDef?.arity === 'number' ? opDef.arity : opDef?.arity[1] ?? 10;
    const canAdd = inputs.length < maxInputs;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Operación')}</Label>
                <Select
                    value={operation}
                    onChange={(e) => setOperation(e.target.value)}
                >
                    <option value="">{__('— Selecciona —')}</option>
                    {COMPUTED_OPS.map((op) => (
                        <option key={op.slug} value={op.slug}>
                            {op.label}
                        </option>
                    ))}
                </Select>
                {opDef !== undefined && (
                    <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                        {opDef.hint}
                    </p>
                )}
            </div>

            {opDef !== undefined && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label className="imcrm-text-xs">
                        {opDef.arity === 2 || (Array.isArray(opDef.arity) && opDef.arity[0] === 2 && opDef.arity[1] === 2)
                            ? __('Campos A y B')
                            : __('Campos de entrada')}
                    </Label>
                    {Array.from({ length: Math.max(inputs.length, minInputs) }).map((_, i) => {
                        const value = inputs[i] ?? 0;
                        const isFixed = typeof opDef.arity === 'number';
                        const canRemove = !isFixed && inputs.length > minInputs;
                        return (
                            <div key={i} className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-w-6 imcrm-text-xs imcrm-text-muted-foreground">
                                    {opDef.arity === 2 ? (i === 0 ? 'A' : 'B') : `#${i + 1}`}
                                </span>
                                <Select
                                    value={value}
                                    onChange={(e) => setInputAt(i, Number(e.target.value))}
                                    className="imcrm-flex-1"
                                >
                                    <option value={0}>{__('— Selecciona campo —')}</option>
                                    {eligibleFields.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                            {f.type === 'computed' ? ` (${__('calculado')})` : ''}
                                        </option>
                                    ))}
                                </Select>
                                {canRemove && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => removeInput(i)}
                                        aria-label={__('Quitar input')}
                                    >
                                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                    {canAdd && Array.isArray(opDef.arity) && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={addInput}
                            className="imcrm-self-start imcrm-gap-2"
                        >
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Añadir input')}
                        </Button>
                    )}
                </div>
            )}

            {opDef?.slug === 'concat' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label className="imcrm-text-xs">{__('Separador')}</Label>
                    <Input
                        type="text"
                        value={typeof config.separator === 'string' ? config.separator : ' '}
                        onChange={(e) => setSeparator(e.target.value)}
                        placeholder={__('Ej. " " o " - "')}
                    />
                </div>
            )}
        </div>
    );
}
