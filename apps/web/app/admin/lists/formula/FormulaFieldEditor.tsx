import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import {
    FORMULA_RESULT_LABELS,
    FORMULA_RESULT_TYPES,
    escapeRefName,
    formulaDisplayConfig,
    formulaToDisplay,
    inferFormulaResultType,
    prepareFormula,
    refDisplayName,
    type FormulaResultType,
    type FormulaTypingField,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';

import { functionInsertText } from './formulaEditing';
import { FormulaInput, type FormulaInputHandle } from './FormulaInput';
import { FormulaPreview } from './FormulaPreview';
import { FormulaReference } from './FormulaReference';

/**
 * Fórmulas (A1) — el editor del campo «Fórmula» (panel de campos y
 * administrador). Se escribe por NOMBRE (`{Precio} * {Cantidad}`); el
 * servidor la guarda por id al guardar el campo. Mientras se escribe:
 * autocompletado de funciones y campos, el error con su columna, el tipo del
 * resultado inferido y una vista previa contra un registro real.
 */
interface Props {
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    listId?: number;
    currentFieldId?: number;
}

/** Lo que se guarda (sin las claves de otros tipos ni los nombres recordados). */
function cleanConfig(config: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    for (const key of ['formula', 'result_type', 'currency', 'precision'] as const) {
        if (config[key] !== undefined) next[key] = config[key];
    }
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
    }
    return next;
}

export function FormulaFieldEditor({ config, onChange, listId, currentFieldId }: Props): JSX.Element {
    const fieldsQuery = useFields(listId);
    const fields = useMemo<FieldEntity[]>(() => fieldsQuery.data ?? [], [fieldsQuery.data]);
    const inputRef = useRef<FormulaInputHandle>(null);
    const uid = useId();
    const inputId = `formula-${uid}`;
    const errorId = `formula-error-${uid}`;

    const stored = typeof config.formula === 'string' ? config.formula : '';
    const labels = (config.labels && typeof config.labels === 'object' ? config.labels : {}) as Record<string, string>;
    // El texto que se edita es SIEMPRE por nombre; una fórmula guardada
    // (`{#12}`) se traduce una vez, cuando ya están los campos.
    const [text, setText] = useState<string | null>(null);
    useEffect(() => {
        if (text !== null || fieldsQuery.isLoading) return;
        setText(stored.includes('{#') ? formulaToDisplay(stored, fields, labels) : stored);
        // Sólo la primera vez (después manda lo que escribe la persona).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldsQuery.isLoading, fields]);

    const value = text ?? '';
    const refs = useMemo(
        () => fields.map((f) => ({ id: f.id, slug: f.slug, label: f.label, type: f.type, config: f.config })),
        [fields],
    );
    const prepared = useMemo(
        () => (value.trim() === '' ? null : prepareFormula(value, refs, currentFieldId ?? null)),
        [value, refs, currentFieldId],
    );

    const selfId = currentFieldId ?? -1;
    const typing = useMemo(() => {
        const map = new Map<number, FormulaTypingField>(refs.map((f) => [f.id, f]));
        const throughTarget = (id: number) => fields.find((f) => f.id === id)?.through?.target_field ?? null;
        return { map, throughTarget };
    }, [refs, fields]);

    const resultType = typeof config.result_type === 'string' ? (config.result_type as FormulaResultType) : null;
    const inferred = useMemo<FormulaResultType>(() => {
        if (!prepared || !prepared.ok) return 'text';
        return inferFormulaResultType(prepared.stored, { fields: typing.map, throughTarget: typing.throughTarget }).type;
    }, [prepared, typing]);
    const effectiveType = resultType ?? inferred;

    const evalField = useMemo(() => {
        if (!prepared || !prepared.ok) return null;
        return {
            id: selfId,
            type: 'formula',
            label: __('Esta fórmula'),
            config: cleanConfig(config, { formula: prepared.stored, labels: prepared.labels }),
        };
    }, [prepared, config, selfId]);

    const display = useMemo(() => {
        if (!evalField) return { type: effectiveType as FieldTypeSlug, config: {} };
        const map = new Map(typing.map);
        map.set(evalField.id, evalField);
        const out = formulaDisplayConfig(evalField, { fields: map, throughTarget: typing.throughTarget });
        return { type: out.type as FieldTypeSlug, config: out.config };
    }, [evalField, effectiveType, typing]);

    const setFormula = (next: string): void => {
        setText(next);
        onChange(cleanConfig(config, { formula: next }));
    };

    // ¿El servidor la puede filtrar/ordenar? Sólo se sabe de la fórmula
    // GUARDADA: se muestra mientras el texto no cambió.
    const saved = currentFieldId !== undefined ? fields.find((f) => f.id === currentFieldId) : undefined;
    const savedInfo = saved?.type === 'formula' ? saved.formula : null;
    const unchanged = savedInfo !== null && savedInfo !== undefined && savedInfo.display === value;

    if (text === null) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" aria-hidden />
                {__('Cargando los campos de la lista…')}
            </p>
        );
    }

    const error = prepared && !prepared.ok ? prepared.error : null;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-formula-editor="">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor={inputId} className="imcrm-text-xs">
                    {__('Fórmula')}
                </Label>
                <FormulaInput
                    ref={inputRef}
                    id={inputId}
                    value={value}
                    onChange={setFormula}
                    fields={fields}
                    excludeId={currentFieldId}
                    errorRange={error ? { start: error.start, end: error.end } : null}
                    invalid={error !== null}
                    describedBy={errorId}
                />
                <div id={errorId} aria-live="polite">
                    {error ? (
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-destructive" data-formula-error-message="">
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                            <span>{error.message}</span>
                        </p>
                    ) : prepared?.ok ? (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-emerald-700 dark:imcrm-text-emerald-300">
                            <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {sprintf(__('La fórmula está bien · da %s'), FORMULA_RESULT_LABELS[inferred].toLowerCase())}
                        </p>
                    ) : (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Escribe { para elegir un campo y empieza a escribir para ver las funciones. Ej.: SI({Total} > 1000000, "Grande", "Chico")')}
                        </p>
                    )}
                </div>
            </div>

            <FormulaPreview listId={listId} fields={fields} formula={evalField} display={display} />

            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label className="imcrm-text-xs">{__('Mostrar el resultado como')}</Label>
                    <Select
                        value={resultType ?? ''}
                        onChange={(e) =>
                            onChange(cleanConfig(config, { formula: value, result_type: e.target.value === '' ? undefined : e.target.value }))
                        }
                        aria-label={__('Mostrar el resultado como')}
                    >
                        <option value="">{sprintf(__('Automático (%s)'), FORMULA_RESULT_LABELS[inferred])}</option>
                        {FORMULA_RESULT_TYPES.map((t) => (
                            <option key={t} value={t}>
                                {FORMULA_RESULT_LABELS[t]}
                            </option>
                        ))}
                    </Select>
                </div>
                {(effectiveType === 'currency' || effectiveType === 'number' || effectiveType === 'percent') && (
                    <div className="imcrm-flex imcrm-gap-2">
                        {effectiveType === 'currency' && (
                            <div className="imcrm-flex imcrm-w-24 imcrm-flex-col imcrm-gap-1.5">
                                <Label className="imcrm-text-xs">{__('Moneda')}</Label>
                                <Input
                                    value={typeof config.currency === 'string' ? config.currency : ''}
                                    placeholder={String(display.config.currency ?? 'COP')}
                                    maxLength={3}
                                    onChange={(e) => {
                                        const c = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
                                        onChange(cleanConfig(config, { formula: value, currency: c.length === 3 ? c : c === '' ? undefined : c }));
                                    }}
                                    aria-label={__('Moneda (código de 3 letras)')}
                                />
                            </div>
                        )}
                        <div className="imcrm-flex imcrm-w-24 imcrm-flex-col imcrm-gap-1.5">
                            <Label className="imcrm-text-xs">{__('Decimales')}</Label>
                            <Input
                                type="number"
                                min={0}
                                max={10}
                                value={typeof config.precision === 'number' ? config.precision : ''}
                                placeholder={String(display.config.precision ?? 2)}
                                onChange={(e) => {
                                    const n = e.target.value === '' ? undefined : Math.max(0, Math.min(10, Math.round(Number(e.target.value))));
                                    onChange(cleanConfig(config, { formula: value, precision: n }));
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>
            {effectiveType === 'percent' && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Como un campo Porcentaje, el resultado va de 0 a 100. Para mostrar una proporción multiplícala por 100: {Pagado} / {Total} * 100.')}
                </p>
            )}

            {unchanged && savedInfo && !savedInfo.sql && savedInfo.sql_reason && (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-font-medium imcrm-text-foreground">{__('Se muestra, pero no se puede filtrar, ordenar ni sumar en el pie: ')}</span>
                    {savedInfo.sql_reason}
                </p>
            )}

            <FormulaReference
                fields={fields}
                excludeId={currentFieldId}
                onInsertFunction={(fn) => {
                    const { insert, caretOffset } = functionInsertText(fn, undefined);
                    inputRef.current?.insert(insert, caretOffset);
                }}
                onInsertField={(f) => {
                    inputRef.current?.insert(`{${escapeRefName(refDisplayName(f, fields))}}`);
                }}
            />
        </div>
    );
}
