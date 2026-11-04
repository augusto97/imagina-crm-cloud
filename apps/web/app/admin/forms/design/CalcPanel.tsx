import { useState } from 'react';
import { Calculator, ChevronDown, Plus, Trash2 } from 'lucide-react';

import { FORM_CALC_KEY_RE, FORM_MAX_CALCS, type FormCalc, type FormConfig } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { Field } from '../../automations/email/EmailBlockInspector';
import { addCalc, calcSources, calcRange, removeCalc, renameCalcKey, setCalcPart, takenCalcKeys, updateCalc, type CalcSource } from '../formDesignOps';

/**
 * v0.1.357 — Cálculos del formulario (puntaje, total, nivel): cuánto suma
 * cada respuesta. El resultado se muestra entre llaves (`{{puntaje}}`),
 * decide saltos y pantallas finales, y se puede guardar en un campo.
 */
export function CalcPanel({
    config,
    fields,
    fieldsById,
    onChange,
}: {
    config: FormConfig;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    onChange: (next: FormConfig) => void;
}): JSX.Element {
    const calcs = config.settings.calcs;
    const slugs = fields.map((f) => f.slug);
    const [openId, setOpenId] = useState<string | null>(null);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-calcs">
            <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Suma puntos según lo que responde cada persona: la nota de un test, qué tan listo está un cliente, un total. Muéstralo entre llaves o úsalo para elegir el salto o la pantalla final.')}
            </p>
            {calcs.map((c) => (
                <CalcCard
                    key={c.id}
                    calc={c}
                    config={config}
                    fields={fields}
                    fieldsById={fieldsById}
                    slugs={slugs}
                    open={openId === c.id || calcs.length === 1}
                    onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                    onChange={onChange}
                />
            ))}
            {calcs.length < FORM_MAX_CALCS && (
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-self-start"
                    onClick={() => {
                        const r = addCalc(config, slugs, calcs.length === 0 ? 'Puntaje' : 'Total');
                        onChange(r.config);
                        setOpenId(r.id);
                    }}
                    data-testid="form-calc-add"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar un cálculo')}
                </Button>
            )}
        </div>
    );
}

function CalcCard({
    calc,
    config,
    fields,
    fieldsById,
    slugs,
    open,
    onToggle,
    onChange,
}: {
    calc: FormCalc;
    config: FormConfig;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    slugs: string[];
    open: boolean;
    onToggle: () => void;
    onChange: (next: FormConfig) => void;
}): JSX.Element {
    const [keyDraft, setKeyDraft] = useState<string | null>(null);
    const sources = calcSources(config, fieldsById);
    const range = calcRange(calc, sources);
    const taken = takenCalcKeys(config, slugs, calc.id);
    const draft = keyDraft ?? calc.key;
    const keyError = !FORM_CALC_KEY_RE.test(draft)
        ? __('Sólo minúsculas, números y guion bajo, empezando con una letra.')
        : taken.has(draft)
          ? __('Ese nombre ya lo usa un campo de la lista u otro cálculo.')
          : null;
    // Dónde se puede guardar: un campo numérico de la lista que el formulario NO pregunta.
    const asked = new Set(sources.map((s) => s.fieldId));
    for (const i of config.items) if (i.type === 'field' && i.other_field_id) asked.add(i.other_field_id);
    const usedElsewhere = new Set(config.settings.calcs.filter((c) => c.id !== calc.id && c.save_field_id !== null).map((c) => c.save_field_id!));
    const saveChoices = fields.filter(
        (f) => ['number', 'currency', 'percent'].includes(f.type) && !asked.has(f.id) && !config.items.some((i) => i.type === 'field' && i.field_id === f.id) && !usedElsewhere.has(f.id),
    );
    const parts = new Map(calc.parts.map((p) => [p.field_id, p]));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-testid="form-calc">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                <Calculator className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-primary" />
                <button type="button" className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-left imcrm-text-xs imcrm-font-medium" onClick={onToggle} aria-expanded={open}>
                    {calc.name || calc.key} <code className="imcrm-ml-1 imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-text-[11px] imcrm-font-normal">{`{{${calc.key}}}`}</code>
                </button>
                <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Quitar este cálculo')} onClick={() => onChange(removeCalc(config, calc.id))}>
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
            </div>
            {open && (
                <>
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <Field label={__('Nombre')}>
                            <Input value={calc.name} maxLength={80} onChange={(e) => onChange(updateCalc(config, calc.id, { name: e.target.value }))} data-testid="form-calc-name" />
                        </Field>
                        <Field label={__('Empieza en')}>
                            <NumberInput value={calc.start} onChange={(n) => onChange(updateCalc(config, calc.id, { start: n ?? 0 }))} aria-label={__('Empieza en')} />
                        </Field>
                    </div>
                    <Field label={__('Nombre entre llaves')} hint={keyError ?? __('Escribe {{%s}} en un texto para mostrarlo.').replace('%s', draft)}>
                        <Input
                            value={draft}
                            maxLength={41}
                            aria-invalid={!!keyError}
                            onChange={(e) => setKeyDraft(e.target.value.trim().toLowerCase())}
                            onBlur={() => {
                                if (keyDraft !== null && !keyError) onChange(renameCalcKey(config, calc.id, keyDraft));
                                setKeyDraft(null);
                            }}
                            data-testid="form-calc-key"
                        />
                    </Field>
                    <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Qué suma cada respuesta')}</p>
                    {sources.length === 0 ? (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Agrega preguntas de opciones, Sí o No, escalas o números para poder sumar puntos.')}</p>
                    ) : (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            {sources.map((src) => (
                                <SourceRow
                                    key={src.fieldId}
                                    source={src}
                                    part={parts.get(src.fieldId) ?? null}
                                    onChange={(part) => onChange(setCalcPart(config, calc.id, src.fieldId, part))}
                                />
                            ))}
                        </div>
                    )}
                    {range && (
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="form-calc-range">
                            {range.min === range.max ? __('Siempre da %s.').replace('%s', fmt(range.min)) : __('Puede dar entre %a y %b.').replace('%a', fmt(range.min)).replace('%b', fmt(range.max))}
                        </p>
                    )}
                    <Field
                        label={__('Guardar el resultado en')}
                        hint={saveChoices.length === 0 && calc.save_field_id === null ? __('Para guardarlo, agrega a la lista un campo Número que el formulario no pregunte.') : __('Queda en el registro, para filtrar u ordenar por el puntaje.')}
                    >
                        <Select
                            value={calc.save_field_id === null ? '' : String(calc.save_field_id)}
                            onChange={(e) => onChange(updateCalc(config, calc.id, { save_field_id: e.target.value ? Number(e.target.value) : null }))}
                            data-testid="form-calc-save"
                        >
                            <option value="">{__('No guardarlo')}</option>
                            {calc.save_field_id !== null && !saveChoices.some((f) => f.id === calc.save_field_id) && (
                                <option value={calc.save_field_id}>{fieldsById.get(calc.save_field_id)?.label ?? __('Un campo que ya no sirve')}</option>
                            )}
                            {saveChoices.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </>
            )}
        </div>
    );
}

function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

/** Un número que se puede dejar vacío (null) y escribir con coma. */
function NumberInput({ value, onChange, ...rest }: { value: number | null | undefined; onChange: (n: number | null) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>): JSX.Element {
    const [draft, setDraft] = useState<string | null>(null);
    const shown = draft ?? (value === null || value === undefined ? '' : String(value));
    return (
        <Input
            {...rest}
            inputMode="decimal"
            value={shown}
            onChange={(e) => {
                const t = e.target.value;
                setDraft(t);
                const clean = t.trim().replace(',', '.');
                if (clean === '') onChange(null);
                else if (Number.isFinite(Number(clean))) onChange(Number(clean));
            }}
            onBlur={() => setDraft(null)}
        />
    );
}

function SourceRow({
    source,
    part,
    onChange,
}: {
    source: CalcSource;
    part: { points: Record<string, number>; multiplier: number | null } | null;
    onChange: (part: { points: Record<string, number>; multiplier: number | null } | null) => void;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const points = part?.points ?? {};
    const scored = Object.keys(points).length;
    const summary =
        part?.multiplier !== null && part?.multiplier !== undefined
            ? `× ${fmt(part.multiplier)}`
            : scored > 0
              ? __('%s con puntos').replace('%s', String(scored))
              : __('No suma');
    const setPoint = (key: string, n: number | null): void => {
        const next = { ...points };
        if (n === null || n === 0) delete next[key];
        else next[key] = n;
        onChange({ points: next, multiplier: null });
    };
    return (
        <div className="imcrm-rounded imcrm-border imcrm-border-border/70" data-testid="form-calc-source">
            <button type="button" className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{source.label}</span>
                <span className={`imcrm-shrink-0 imcrm-text-[11px] ${summary === __('No suma') ? 'imcrm-text-muted-foreground' : 'imcrm-font-medium imcrm-text-primary'}`}>{summary}</span>
                <ChevronDown className={`imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-transition-transform ${open ? 'imcrm-rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border/70 imcrm-p-2">
                    {source.kind === 'number' ? (
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                            <span className="imcrm-flex-1">{__('Suma la respuesta multiplicada por')}</span>
                            <NumberInput
                                className="imcrm-h-8 imcrm-w-20"
                                value={part?.multiplier ?? null}
                                placeholder="1"
                                onChange={(n) => onChange(n === null ? null : { points: {}, multiplier: n })}
                                aria-label={__('Factor')}
                                data-testid="form-calc-multiplier"
                            />
                        </label>
                    ) : (
                        source.choices.map((c) => (
                            <label key={c.value} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{c.label}</span>
                                <NumberInput
                                    className="imcrm-h-8 imcrm-w-20"
                                    value={points[c.value] ?? null}
                                    placeholder="0"
                                    onChange={(n) => setPoint(c.value, n)}
                                    aria-label={__('Puntos de «%s»').replace('%s', c.label)}
                                    data-testid="form-calc-points"
                                />
                            </label>
                        ))
                    )}
                    {source.multiple && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Si elige varias, se suman.')}</p>}
                </div>
            )}
        </div>
    );
}
