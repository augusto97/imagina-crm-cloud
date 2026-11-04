import { useState } from 'react';
import {
    FORM_MATRIX_MAX_COLUMNS,
    FORM_MATRIX_MAX_ROWS,
    FORM_MATRIX_ROW_TYPES,
    FORM_RANKING_MAX_OPTIONS,
    formDisplaysFor,
    formScaleValues,
    matrixCellValue,
    resolveFormRange,
    type FormConfig,
    type FormFieldDisplay,
    type FormFieldItem,
    type FormMatrixItem,
    type FormRange,
} from '@imagina-base/shared';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { NumberField } from '@/components/design/DesignStyleControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useAppendFieldOption, useCreateField } from '@/hooks/useFields';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { Field, Section } from '../../automations/email/EmailBlockInspector';
import { defaultMatrixColumns as defaultColumnsFor, usedFieldIds } from '../formDesignOps';

/**
 * v0.1.355 — «Cómo se pregunta» un campo (escala, deslizador, sí/no, firma,
 * ordenar, lista con buscador, «Otro») y el editor de la matriz. Lo que se
 * elige aquí es lo que dibuja la página pública y lo que revisa el servidor.
 */

/** Qué se ve con «auto» según el tipo del campo. */
const AUTO_LABEL: Record<string, string> = {
    select: 'Según el tema',
    multi_select: 'Según el tema',
    team: 'Según el tema',
    number: 'Casilla para escribir el número',
    currency: 'Casilla con la moneda',
    percent: 'Casilla con el %',
    rating: 'Estrellas',
    checkbox: 'Casilla para marcar',
    file: 'Subir archivos',
    text: 'Casilla de texto',
    long_text: 'Cuadro de texto',
};

export const DISPLAY_LABELS: Record<FormFieldDisplay, string> = {
    auto: 'Según el tema',
    radio: 'Lista',
    buttons: 'Botones',
    cards: 'Tarjetas',
    dropdown: 'Lista desplegable',
    search: 'Lista con buscador',
    scale: 'Escala de botones (como el NPS)',
    slider: 'Deslizador',
    yes_no: 'Botones «Sí» y «No»',
    signature: 'Firma (con el dedo o el mouse)',
    ranking: 'Ordenar opciones',
};

const DISPLAY_HINTS: Partial<Record<FormFieldDisplay, string>> = {
    search: 'Para listas largas: la persona escribe y elige. En el celular no ocupa la pantalla entera.',
    scale: 'Botones numerados de un extremo al otro, con una etiqueta en cada punta.',
    slider: 'Se arrastra un control entre el mínimo y el máximo. Hasta que se mueve no hay respuesta.',
    yes_no: 'Dos botones grandes. A diferencia de la casilla, «No» también es una respuesta (y sirve para las obligatorias).',
    signature: 'Se guarda como una imagen en este campo de archivos. Funciona con el dedo en el celular.',
    ranking: 'Se arrastran (o se mueven con flechas) del más importante al menos importante.',
};

export function displayLabel(display: FormFieldDisplay, fieldType: string): string {
    return display === 'auto' ? (AUTO_LABEL[fieldType] ?? DISPLAY_LABELS.auto) : DISPLAY_LABELS[display];
}

interface ScalePreset {
    id: string;
    label: string;
    range: Partial<FormRange>;
}
const SCALE_PRESETS: ScalePreset[] = [
    { id: 'nps', label: 'NPS (0 a 10)', range: { min: 0, max: 10, step: 1, low_label: 'Nada probable', mid_label: '', high_label: 'Muy probable' } },
    { id: '1-5', label: '1 a 5', range: { min: 1, max: 5, step: 1, low_label: 'Muy malo', mid_label: '', high_label: 'Excelente' } },
    { id: '1-10', label: '1 a 10', range: { min: 1, max: 10, step: 1, low_label: '', mid_label: '', high_label: '' } },
    {
        id: 'agree',
        label: 'Acuerdo (1 a 5)',
        range: { min: 1, max: 5, step: 1, low_label: 'Muy en desacuerdo', mid_label: 'Neutral', high_label: 'Muy de acuerdo' },
    },
];

function fieldOptions(field: FieldEntity): Array<{ value: string; label: string }> {
    const raw = field.config.options;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((o) => {
        if (!o || typeof o !== 'object') return [];
        const { value, label } = o as { value?: unknown; label?: unknown };
        return typeof value === 'string' ? [{ value, label: typeof label === 'string' && label !== '' ? label : value }] : [];
    });
}

/** El selector «Cómo se pregunta» (sólo si el tipo tiene más de una forma). */
export function DisplaySelect({
    item,
    field,
    multiple,
    themeLabel,
    onSet,
}: {
    item: FormFieldItem;
    field: FieldEntity;
    multiple: boolean;
    /** Lo que significa «Según el tema» en las opciones (lista, botones, tarjetas). */
    themeLabel: string;
    onSet: (patch: Partial<FormFieldItem>) => void;
}): JSX.Element | null {
    const displays = formDisplaysFor(field.type, multiple);
    if (displays.length <= 1) return null;
    const isChoice = field.type === 'select' || field.type === 'multi_select' || field.type === 'team';
    return (
        <Field label={__('Cómo se pregunta')} hint={DISPLAY_HINTS[item.display] ? __(DISPLAY_HINTS[item.display]!) : undefined}>
            <Select value={displays.includes(item.display) ? item.display : 'auto'} onChange={(e) => onSet(displayPatch(item, field, e.target.value as FormFieldDisplay))} data-testid="form-item-display">
                {displays.map((d) => (
                    <option key={d} value={d}>
                        {d === 'auto' && isChoice ? `${__('Según el tema')} (${__(themeLabel)})` : __(displayLabel(d, field.type))}
                    </option>
                ))}
            </Select>
        </Field>
    );
}

/** Al elegir una forma: la escala del NPS trae sus etiquetas, la firma sólo imágenes. */
function displayPatch(item: FormFieldItem, field: FieldEntity, display: FormFieldDisplay): Partial<FormFieldItem> {
    const patch: Partial<FormFieldItem> = { display };
    if (display === 'signature') patch.accept = 'images';
    if (display === 'scale' && item.range.min === null && item.range.max === null && field.type === 'number') {
        patch.range = { ...item.range, ...SCALE_PRESETS[0]!.range } as FormRange;
    }
    return patch;
}

/** Ajustes de la forma elegida: escala/deslizador, «Sí / No», ordenar y «Otro». */
export function DisplayOptions({
    item,
    field,
    config,
    fields,
    listId,
    onSet,
}: {
    item: FormFieldItem;
    field: FieldEntity;
    config: FormConfig;
    fields: FieldEntity[];
    listId: number;
    onSet: (patch: Partial<FormFieldItem>) => void;
}): JSX.Element | null {
    const shown = formDisplaysFor(field.type).includes(item.display) ? item.display : 'auto';
    const parts: JSX.Element[] = [];
    if (shown === 'scale' || shown === 'slider') parts.push(<RangeEditor key="range" kind={shown} item={item} field={field} onSet={onSet} />);
    if (shown === 'yes_no') {
        parts.push(
            <div key="yesno" className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2" data-testid="form-yesno-labels">
                <Field label={__('Botón «Sí»')}>
                    <Input value={item.yes_label} maxLength={40} placeholder={__('Sí')} onChange={(e) => onSet({ yes_label: e.target.value })} />
                </Field>
                <Field label={__('Botón «No»')}>
                    <Input value={item.no_label} maxLength={40} placeholder={__('No')} onChange={(e) => onSet({ no_label: e.target.value })} />
                </Field>
            </div>,
        );
    }
    if (shown === 'ranking' && (field.type === 'text' || field.type === 'long_text')) {
        parts.push(<RankingOptionsEditor key="rank" item={item} onSet={onSet} />);
    }
    if (shown === 'ranking' && field.type === 'multi_select') {
        parts.push(
            <p key="rankhint" className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Se ordenan TODAS las opciones del campo y se guardan en ese orden.')}
            </p>,
        );
    }
    if ((field.type === 'select' || field.type === 'multi_select') && shown !== 'ranking') {
        parts.push(<OtherEditor key="other" item={item} field={field} config={config} fields={fields} listId={listId} onSet={onSet} />);
    }
    if (parts.length === 0) return null;
    return <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">{parts}</div>;
}

function RangeEditor({
    kind,
    item,
    field,
    onSet,
}: {
    kind: 'scale' | 'slider';
    item: FormFieldItem;
    field: FieldEntity;
    onSet: (patch: Partial<FormFieldItem>) => void;
}): JSX.Element {
    const r = item.range;
    const set = (patch: Partial<FormRange>): void => onSet({ range: { ...r, ...patch } });
    const resolved = resolveFormRange(kind, field.type, field.config, r);
    const values = kind === 'scale' ? formScaleValues(resolved) : [];
    const unit = field.type === 'percent' ? '%' : undefined;
    const bounds = field.type === 'rating' ? { min: 0, max: 10 } : field.type === 'percent' ? { min: 0, max: 100 } : { min: -1e12, max: 1e12 };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-range-editor">
            {kind === 'scale' && field.type !== 'rating' && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    {SCALE_PRESETS.filter((p) => field.type !== 'percent' || p.id === 'nps').map((p) => (
                        <Button
                            key={p.id}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="imcrm-h-7 imcrm-px-2 imcrm-text-[11px]"
                            onClick={() => set(field.type === 'percent' ? { min: 0, max: 100, step: 10, low_label: p.range.low_label, high_label: p.range.high_label } : p.range)}
                            data-testid={`form-scale-preset-${p.id}`}
                        >
                            {__(p.label)}
                        </Button>
                    ))}
                </div>
            )}
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                <NumberField label={__('Desde')} value={r.min} onChange={(min) => set({ min })} min={bounds.min} max={bounds.max} unit={unit} placeholder={String(resolved.min)} />
                <NumberField label={__('Hasta')} value={r.max} onChange={(max) => set({ max })} min={bounds.min} max={bounds.max} unit={unit} placeholder={String(resolved.max)} />
                <NumberField label={__('De a')} value={r.step} onChange={(step) => set({ step })} min={field.type === 'rating' ? 1 : 0.0001} max={bounds.max > 0 ? bounds.max : 1e12} placeholder={String(resolved.step)} />
            </div>
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                <Field label={__('Al principio')}>
                    <Input value={r.low_label} maxLength={60} placeholder={kind === 'scale' ? __('Nada probable') : ''} onChange={(e) => set({ low_label: e.target.value })} />
                </Field>
                <Field label={__('Al medio')}>
                    <Input value={r.mid_label} maxLength={60} onChange={(e) => set({ mid_label: e.target.value })} />
                </Field>
                <Field label={__('Al final')}>
                    <Input value={r.high_label} maxLength={60} placeholder={kind === 'scale' ? __('Muy probable') : ''} onChange={(e) => set({ high_label: e.target.value })} />
                </Field>
            </div>
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-range-summary">
                {kind === 'scale'
                    ? __('%n botones: %v.').replace('%n', String(values.length)).replace('%v', values.join(' · '))
                    : __('De %a a %b, de a %c.').replace('%a', String(resolved.min)).replace('%b', String(resolved.max)).replace('%c', String(resolved.step))}{' '}
                {__('Vacío = lo que acepta el campo. Una escala tiene como mucho 11 botones.')}
            </p>
        </div>
    );
}

function RankingOptionsEditor({ item, onSet }: { item: FormFieldItem; onSet: (patch: Partial<FormFieldItem>) => void }): JSX.Element {
    const opts = item.ranking_options;
    const set = (next: string[]): void => onSet({ ranking_options: next.slice(0, FORM_RANKING_MAX_OPTIONS) });
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="form-ranking-options">
            <p className="imcrm-text-xs imcrm-font-medium">{__('Opciones para ordenar')}</p>
            {opts.map((o, idx) => (
                <div key={idx} className="imcrm-flex imcrm-items-center imcrm-gap-1">
                    <span className="imcrm-w-5 imcrm-text-right imcrm-text-[11px] imcrm-text-muted-foreground">{idx + 1}.</span>
                    <Input value={o} maxLength={120} onChange={(e) => set(opts.map((x, i) => (i === idx ? e.target.value : x)))} aria-label={__('Opción %d').replace('%d', String(idx + 1))} />
                    <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Quitar')} onClick={() => set(opts.filter((_, i) => i !== idx))}>
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
            ))}
            {opts.length < FORM_RANKING_MAX_OPTIONS && (
                <Button type="button" variant="outline" size="sm" className="imcrm-self-start" onClick={() => set([...opts, ''])} data-testid="form-ranking-add">
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar una opción')}
                </Button>
            )}
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Se guarda en el campo como texto: «1. Precio · 2. Calidad». Hacen falta al menos dos.')}
            </p>
        </div>
    );
}

/** «Otro»: la opción que lo abre y el campo de texto donde va lo que se escribe. */
function OtherEditor({
    item,
    field,
    config,
    fields,
    listId,
    onSet,
}: {
    item: FormFieldItem;
    field: FieldEntity;
    config: FormConfig;
    fields: FieldEntity[];
    listId: number;
    onSet: (patch: Partial<FormFieldItem>) => void;
}): JSX.Element {
    const toast = useToast();
    const createField = useCreateField(listId);
    const appendOption = useAppendFieldOption(listId);
    const options = fieldOptions(field);
    const used = usedFieldIds(config);
    const targets = fields.filter((f) => (f.type === 'text' || f.type === 'long_text') && (!used.has(f.id) || f.id === item.other_field_id));
    const on = item.other_option !== null;
    const [busy, setBusy] = useState(false);

    const enable = async (): Promise<void> => {
        const existing = options.find((o) => /^otr[oa]s?$/i.test(o.label.trim()) || /^otr[oa]s?$/i.test(o.value));
        setBusy(true);
        try {
            let value = existing?.value;
            if (!value) {
                value = 'otro';
                await appendOption.mutateAsync({ fieldId: field.id, value, label: 'Otro' });
            }
            onSet({ other_option: value, other_field_id: item.other_field_id ?? targets[0]?.id ?? null });
        } catch {
            toast.error(__('No se pudo agregar la opción «Otro»'), __('Agrégala a mano en el campo y vuelve a intentarlo.'));
        } finally {
            setBusy(false);
        }
    };
    const createTarget = async (): Promise<void> => {
        setBusy(true);
        try {
            const created = await createField.mutateAsync({ label: `${field.label} (otro)`, type: 'text' } as never);
            onSet({ other_field_id: created.id });
        } catch {
            toast.error(__('No se pudo crear el campo'), __('Puede que no tengas permiso para cambiar los campos de la lista.'));
        } finally {
            setBusy(false);
        }
    };

    if (!on) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="form-other-editor">
                <Button type="button" variant="outline" size="sm" className="imcrm-self-start" disabled={busy} onClick={() => void enable()} data-testid="form-other-enable">
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar «Otro» con un espacio para escribir')}
                </Button>
            </div>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2.5" data-testid="form-other-editor">
            <p className="imcrm-text-xs imcrm-font-medium">{__('«Otro»')}</p>
            <Field label={__('La opción que significa «otro»')}>
                <Select value={item.other_option ?? ''} onChange={(e) => onSet({ other_option: e.target.value || null })}>
                    {options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </Select>
            </Field>
            <Field label={__('Lo que escribe se guarda en')} hint={__('Un campo de texto de la lista. Sólo se guarda si elige esa opción.')}>
                <Select
                    value={item.other_field_id === null ? '' : String(item.other_field_id)}
                    onChange={(e) => onSet({ other_field_id: e.target.value ? Number(e.target.value) : null })}
                    data-testid="form-other-target"
                >
                    <option value="">{__('Elige un campo de texto')}</option>
                    {targets.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
            </Field>
            {item.other_field_id === null && (
                <Button type="button" variant="outline" size="sm" className="imcrm-self-start" disabled={busy} onClick={() => void createTarget()} data-testid="form-other-create">
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Crear el campo «%s (otro)»').replace('%s', field.label)}
                </Button>
            )}
            <Field label={__('Texto de ejemplo')}>
                <Input value={item.other_placeholder} maxLength={120} placeholder={__('¿Cuál?')} onChange={(e) => onSet({ other_placeholder: e.target.value })} />
            </Field>
            <Button type="button" variant="ghost" size="sm" className="imcrm-self-start imcrm-text-muted-foreground" onClick={() => onSet({ other_option: null, other_field_id: null })}>
                {__('Quitar «Otro»')}
            </Button>
        </div>
    );
}

// ─────────────────────────── Matriz ───────────────────────────

const MATRIX_PRESETS: Array<{ id: string; label: string; columns: Array<{ value: string; label: string }> }> = [
    { id: 'quality', label: 'Malo · Regular · Bueno · Excelente', columns: ['Malo', 'Regular', 'Bueno', 'Excelente'].map((l) => ({ value: l, label: l })) },
    { id: 'freq', label: 'Nunca · A veces · Siempre', columns: ['Nunca', 'A veces', 'Siempre'].map((l) => ({ value: l, label: l })) },
    { id: '1-5', label: '1 a 5', columns: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })) },
];

export function MatrixEditor({
    item,
    config,
    fields,
    fieldsById,
    listId,
    onSet,
}: {
    item: FormMatrixItem;
    config: FormConfig;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    listId: number;
    onSet: (patch: Partial<FormMatrixItem>) => void;
}): JSX.Element {
    const toast = useToast();
    const appendOption = useAppendFieldOption(listId);
    const [busy, setBusy] = useState(false);
    const used = usedFieldIds(config);
    const firstType = item.rows[0] ? fieldsById.get(item.rows[0].field_id)?.type : undefined;
    const multiple = firstType === 'multi_select';
    const candidates = fields.filter(
        (f) =>
            (FORM_MATRIX_ROW_TYPES as readonly string[]).includes(f.type) &&
            !used.has(f.id) &&
            (firstType === undefined || (f.type === 'multi_select') === multiple),
    );
    const rows = item.rows.map((r) => ({ row: r, field: fieldsById.get(r.field_id) }));
    // Celdas que una fila no puede guardar (una selección sin esa opción).
    const gaps = rows.flatMap(({ field }) =>
        field && (field.type === 'select' || field.type === 'multi_select')
            ? item.columns.filter((c) => matrixCellValue(field, c) === null).map((c) => ({ field, column: c }))
            : field
              ? item.columns.filter((c) => matrixCellValue(field, c) === null).map((c) => ({ field, column: c }))
              : [],
    );
    const fixable = gaps.filter((g) => g.field.type === 'select' || g.field.type === 'multi_select');

    const setRows = (next: FormMatrixItem['rows']): void => onSet({ rows: next.slice(0, FORM_MATRIX_MAX_ROWS) });
    const setCols = (next: FormMatrixItem['columns']): void => onSet({ columns: next.slice(0, FORM_MATRIX_MAX_COLUMNS) });
    const addMissing = async (): Promise<void> => {
        setBusy(true);
        try {
            for (const g of fixable) await appendOption.mutateAsync({ fieldId: g.field.id, value: g.column.value, label: g.column.label || g.column.value });
            toast.success(__('Opciones agregadas'), __('Ahora cada fila tiene todas las columnas.'));
        } catch {
            toast.error(__('No se pudieron agregar todas las opciones'), __('Puede que no tengas permiso para cambiar los campos de la lista.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="form-matrix-editor">
            <Field label={__('Pregunta')} hint={__('Ej.: «¿Cómo calificas cada aspecto?»')}>
                <Input value={item.label} maxLength={300} onChange={(e) => onSet({ label: e.target.value })} data-testid="form-matrix-label" />
            </Field>
            <Field label={__('Ayuda')}>
                <Input value={item.help} maxLength={1000} onChange={(e) => onSet({ help: e.target.value })} />
            </Field>

            <Section title={__('Filas (un campo por fila)')}>
                {rows.length === 0 && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Cada fila guarda su respuesta en un campo de la lista: selección, varias opciones, calificación, número o porcentaje.')}
                    </p>
                )}
                {rows.map(({ row, field }, idx) => (
                    <div key={row.field_id} className="imcrm-flex imcrm-items-center imcrm-gap-1" data-matrix-row={row.field_id}>
                        <Input
                            value={row.label}
                            placeholder={field?.label ?? __('Campo borrado')}
                            maxLength={200}
                            onChange={(e) => setRows(item.rows.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r)))}
                            aria-label={__('Texto de la fila')}
                        />
                        <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Subir')} disabled={idx === 0} onClick={() => setRows(swap(item.rows, idx, idx - 1))}>
                            <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Bajar')} disabled={idx === rows.length - 1} onClick={() => setRows(swap(item.rows, idx, idx + 1))}>
                            <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Quitar la fila')} onClick={() => setRows(item.rows.filter((_, i) => i !== idx))}>
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        </Button>
                    </div>
                ))}
                {item.rows.length < FORM_MATRIX_MAX_ROWS &&
                    (candidates.length > 0 ? (
                        <Select
                            value=""
                            onChange={(e) => {
                                const id = Number(e.target.value);
                                if (!id) return;
                                const next = [...item.rows, { field_id: id, label: '' }];
                                setRows(next);
                                if (item.columns.length === 0) {
                                    const f = fieldsById.get(id);
                                    const cols = defaultColumnsFor(f);
                                    if (cols.length) setCols(cols);
                                }
                            }}
                            aria-label={__('Agregar una fila')}
                            data-testid="form-matrix-add-row"
                        >
                            <option value="">{__('+ Agregar una fila (elige el campo)')}</option>
                            {candidates.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    ) : (
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {multiple
                                ? __('No quedan campos de «varias opciones» sin usar en el formulario.')
                                : __('No quedan campos de selección, calificación o número sin usar en el formulario.')}
                        </p>
                    ))}
            </Section>

            <Section title={__('Columnas (las respuestas)')}>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    {MATRIX_PRESETS.map((p) => (
                        <Button key={p.id} type="button" size="sm" variant="outline" className="imcrm-h-7 imcrm-px-2 imcrm-text-[11px]" onClick={() => setCols(p.columns)}>
                            {__(p.label)}
                        </Button>
                    ))}
                    {rows[0]?.field && (
                        <Button type="button" size="sm" variant="outline" className="imcrm-h-7 imcrm-px-2 imcrm-text-[11px]" onClick={() => setCols(defaultColumnsFor(rows[0]!.field))} data-testid="form-matrix-cols-from-field">
                            {__('Las de «%s»').replace('%s', rows[0].field.label)}
                        </Button>
                    )}
                </div>
                {item.columns.map((c, idx) => (
                    <div key={idx} className="imcrm-flex imcrm-items-center imcrm-gap-1">
                        <Input
                            value={c.label || c.value}
                            maxLength={120}
                            onChange={(e) => {
                                const text = e.target.value;
                                setCols(item.columns.map((x, i) => (i === idx ? { value: text.trim() || x.value, label: text } : x)));
                            }}
                            aria-label={__('Columna %d').replace('%d', String(idx + 1))}
                        />
                        <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Quitar la columna')} onClick={() => setCols(item.columns.filter((_, i) => i !== idx))}>
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        </Button>
                    </div>
                ))}
                {item.columns.length < FORM_MATRIX_MAX_COLUMNS && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-self-start"
                        onClick={() => setCols([...item.columns, { value: `Opción ${item.columns.length + 1}`, label: `Opción ${item.columns.length + 1}` }])}
                        data-testid="form-matrix-add-col"
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar una columna')}
                    </Button>
                )}
                {item.columns.length < 2 && <p className="imcrm-text-[11px] imcrm-text-destructive">{__('Hacen falta al menos dos columnas.')}</p>}
                {gaps.length > 0 && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-amber-500/10 imcrm-p-2 imcrm-text-[11px] imcrm-leading-snug" data-testid="form-matrix-gaps">
                        {gaps.slice(0, 6).map((g, i) => (
                            <span key={i}>
                                {__('«%f» no tiene «%c»: esa casilla no se podrá elegir.').replace('%f', g.field.label).replace('%c', g.column.label || g.column.value)}
                            </span>
                        ))}
                        {fixable.length > 0 && (
                            <Button type="button" size="sm" variant="outline" className="imcrm-self-start" disabled={busy} onClick={() => void addMissing()} data-testid="form-matrix-fix">
                                {__('Agregar las opciones que faltan a los campos')}
                            </Button>
                        )}
                    </div>
                )}
            </Section>

            <Section title={__('Respuesta')}>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" checked={item.required} onChange={(e) => onSet({ required: e.target.checked })} />
                    {__('Obligatoria: hay que responder todas las filas')}
                </label>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {multiple ? __('Con «varias opciones» se puede marcar más de una casilla por fila.') : __('Una respuesta por fila.')}
                </p>
            </Section>
        </div>
    );
}

function swap<T>(list: readonly T[], a: number, b: number): T[] {
    const next = [...list];
    [next[a], next[b]] = [next[b]!, next[a]!];
    return next;
}
