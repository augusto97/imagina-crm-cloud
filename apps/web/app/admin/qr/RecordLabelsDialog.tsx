import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation } from '@tanstack/react-query';
import {
    LABEL_PRESETS,
    LABEL_PRESET_KEYS,
    SCAN_SEARCH_FIELD_TYPES,
    labelInnerLayout,
    labelSlots,
    pickScanField,
    resolveTitleFieldId,
    type LabelContent,
    type LabelPresetKey,
} from '@imagina-base/shared';
import { Download, Printer, QrCode, X } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { CloudApiError } from '@/lib/cloud/client';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree } from '@/types/record';

/** Tipos que se pueden imprimir como dato (lo que entra en un renglón). */
const PRINTABLE = new Set([
    'text',
    'long_text',
    'email',
    'url',
    'phone',
    'number',
    'currency',
    'percent',
    'rating',
    'duration',
    'date',
    'datetime',
    'select',
    'multi_select',
    'checkbox',
    'user',
    'autonumber',
    'computed',
    'formula',
    'lookup',
    'rollup',
]);

export type LabelsTarget = { ids: number[] } | { filter_tree?: FilterTree; search?: string; include_subtasks?: boolean };

interface Prefs {
    preset: LabelPresetKey;
    content: LabelContent;
    codeFieldId: number | null;
    fieldIds: number[];
    showTitle: boolean;
    showCode: boolean;
}

function prefsKey(listId: number): string {
    return `imcrm:labels:${listId}`;
}

function readPrefs(listId: number): Partial<Prefs> {
    try {
        const raw = window.localStorage.getItem(prefsKey(listId));
        return raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    } catch {
        return {};
    }
}

function writePrefs(listId: number, p: Prefs): void {
    try {
        window.localStorage.setItem(prefsKey(listId), JSON.stringify(p));
    } catch {
        /* nada */
    }
}

/**
 * v0.1.344 — «Imprimir etiquetas»: un PDF con el QR de cada registro, en hojas
 * adhesivas de las medidas comunes (Carta, A4) o en el rollo de una impresora
 * térmica. Lo arma el servidor (las medidas exactas en puntos y el QR
 * vectorial); aquí se elige la hoja con su miniatura, qué guarda el QR, qué más
 * se imprime y desde qué etiqueta empezar una hoja ya usada.
 */
export default function RecordLabelsDialog({
    listId,
    fields,
    listSettings,
    target,
    count,
    onClose,
}: {
    listId: number;
    fields: FieldEntity[];
    listSettings: Record<string, unknown> | null | undefined;
    target: LabelsTarget;
    /** Cuántos registros entran (null = no se sabe todavía). */
    count: number | null;
    onClose: () => void;
}): JSX.Element {
    const toast = useToast();
    const saved = useMemo(() => readPrefs(listId), [listId]);
    const codeCandidates = useMemo(() => fields.filter((f) => (SCAN_SEARCH_FIELD_TYPES as readonly string[]).includes(f.type)), [fields]);
    const detected = useMemo(() => pickScanField(codeCandidates, listSettings ?? {}), [codeCandidates, listSettings]);
    const titleId = useMemo(() => resolveTitleFieldId(fields, listSettings ?? {}), [fields, listSettings]);
    const printable = useMemo(() => fields.filter((f) => PRINTABLE.has(f.type) && f.id !== titleId), [fields, titleId]);

    const [preset, setPreset] = useState<LabelPresetKey>(saved.preset && saved.preset in LABEL_PRESETS ? saved.preset : 'letter_30');
    const [content, setContent] = useState<LabelContent>(saved.content === 'field' && codeCandidates.length > 0 ? 'field' : 'link');
    const [codeFieldId, setCodeFieldId] = useState<number | null>(
        saved.codeFieldId && codeCandidates.some((f) => f.id === saved.codeFieldId) ? saved.codeFieldId : (detected?.id ?? null),
    );
    const [fieldIds, setFieldIds] = useState<number[]>((saved.fieldIds ?? []).filter((id) => printable.some((f) => f.id === id)).slice(0, 2));
    const [showTitle, setShowTitle] = useState(saved.showTitle ?? true);
    const [showCode, setShowCode] = useState(saved.showCode ?? true);
    const [start, setStart] = useState(1);

    const p = LABEL_PRESETS[preset];
    const perPage = p.cols * p.rows;
    const skip = p.kind === 'sheet' ? Math.min(Math.max(1, start), perPage) - 1 : 0;
    const total = 'ids' in target ? target.ids.length : count;
    const pages = total === null ? null : Math.max(1, Math.ceil((total + skip) / perPage));
    const codeField = codeCandidates.find((f) => f.id === codeFieldId) ?? null;

    const download = useMutation({
        mutationFn: () =>
            api.recordLabelsPdf(listId, {
                target,
                preset,
                content,
                code_field_id: content === 'field' || showCode ? codeFieldId : null,
                field_ids: fieldIds,
                show_title: showTitle,
                show_code: showCode,
                skip,
            } as never),
        onSuccess: ({ blob, filename, count: printed }) => {
            writePrefs(listId, { preset, content, codeFieldId, fieldIds, showTitle, showCode });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast.success(
                __('PDF de etiquetas listo'),
                sprintf(_n('%d etiqueta. Imprímelo al 100 % (sin «Ajustar a la página»).', '%d etiquetas. Imprímelo al 100 % (sin «Ajustar a la página»).', printed), printed),
            );
        },
        onError: (err) => toast.error(__('No se pudo armar el PDF'), err instanceof CloudApiError ? err.message : String(err)),
    });

    const setField = (slot: 0 | 1, id: number): void => {
        setFieldIds((prev) => {
            const next = [...prev];
            if (id > 0) next[slot] = id;
            else next.splice(slot, 1);
            return [...new Set(next.filter((x): x is number => typeof x === 'number' && x > 0))].slice(0, 2);
        });
    };

    const sample = useMemo(() => {
        const lines = fieldIds.map((id) => printable.find((f) => f.id === id)?.label ?? '').filter(Boolean);
        return { lines, code: showCode ? (content === 'field' || codeField ? (codeField?.label ?? '') : '#42') : '' };
    }, [fieldIds, printable, showCode, content, codeField]);

    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[92vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-3xl imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-labels-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                            <Printer className="imcrm-h-5 imcrm-w-5" />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Imprimir etiquetas con QR')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {total === null
                                    ? __('Una etiqueta por cada registro que muestra la vista.')
                                    : sprintf(_n('Una etiqueta para %d registro.', 'Una etiqueta para cada uno de los %d registros.', total), total)}{' '}
                                {__('Pégalas en tus productos, equipos o carpetas y escanéalas con la app para abrir su ficha.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-grid imcrm-flex-1 imcrm-gap-5 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4 md:imcrm-grid-cols-[1fr_15rem]">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="labels-preset">{__('Hoja de etiquetas')}</Label>
                                <Select id="labels-preset" value={preset} onChange={(e) => setPreset(e.target.value as LabelPresetKey)} data-testid="imcrm-labels-preset">
                                    {LABEL_PRESET_KEYS.map((k) => (
                                        <option key={k} value={k}>
                                            {LABEL_PRESETS[k].name}
                                        </option>
                                    ))}
                                </Select>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">{p.hint}</p>
                            </div>

                            <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <legend className="imcrm-mb-1 imcrm-text-sm imcrm-font-medium">{__('Qué guarda el QR')}</legend>
                                <ChoiceRow
                                    checked={content === 'link'}
                                    onSelect={() => setContent('link')}
                                    title={__('El enlace a la ficha (recomendado)')}
                                    hint={__('Funciona en cualquier lista: el escáner de la app abre la ficha al instante.')}
                                    testId="imcrm-labels-content-link"
                                />
                                <ChoiceRow
                                    checked={content === 'field'}
                                    disabled={codeCandidates.length === 0}
                                    onSelect={() => {
                                        setContent('field');
                                        if (codeFieldId === null) setCodeFieldId(detected?.id ?? codeCandidates[0]?.id ?? null);
                                    }}
                                    title={__('El código de un campo (SKU, serial, boleta)')}
                                    hint={
                                        codeCandidates.length === 0
                                            ? __('Esta lista no tiene un campo de texto o número para usar como código.')
                                            : __('Para quien ya identifica sus cosas con un código: el escáner lo busca por ese campo.')
                                    }
                                    testId="imcrm-labels-content-field"
                                />
                                {(content === 'field' || showCode) && codeCandidates.length > 0 && (
                                    <div className="imcrm-ml-7 imcrm-flex imcrm-flex-col imcrm-gap-1">
                                        <Label htmlFor="labels-code-field" className="imcrm-text-xs">
                                            {__('Campo del código')}
                                        </Label>
                                        <Select
                                            id="labels-code-field"
                                            value={codeFieldId ? String(codeFieldId) : ''}
                                            onChange={(e) => setCodeFieldId(e.target.value ? Number(e.target.value) : null)}
                                            data-testid="imcrm-labels-code-field"
                                        >
                                            {content === 'link' && <option value="">{__('Ninguno (se escribe el número del registro)')}</option>}
                                            {codeCandidates.map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {f.label}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                )}
                            </fieldset>

                            <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <legend className="imcrm-mb-1 imcrm-text-sm imcrm-font-medium">{__('Qué más se imprime')}</legend>
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                    <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} data-testid="imcrm-labels-title" />
                                    {__('El nombre del registro')}
                                </label>
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                    <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} data-testid="imcrm-labels-code" />
                                    {__('El código escrito debajo (por si el QR se daña)')}
                                </label>
                                <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                                    {[0, 1].map((slot) => (
                                        <Select
                                            key={slot}
                                            value={fieldIds[slot] ? String(fieldIds[slot]) : ''}
                                            onChange={(e) => setField(slot as 0 | 1, Number(e.target.value || 0))}
                                            disabled={slot === 1 && !fieldIds[0]}
                                            aria-label={slot === 0 ? __('Primer dato') : __('Segundo dato')}
                                            data-testid={`imcrm-labels-line-${slot}`}
                                        >
                                            <option value="">{slot === 0 ? __('Un dato más (opcional)') : __('Otro dato (opcional)')}</option>
                                            {printable.map((f) => (
                                                <option key={f.id} value={f.id} disabled={fieldIds.includes(f.id) && fieldIds[slot] !== f.id}>
                                                    {f.label}
                                                </option>
                                            ))}
                                        </Select>
                                    ))}
                                </div>
                            </fieldset>

                            {p.kind === 'sheet' && (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="labels-start">{__('Empezar en la etiqueta')}</Label>
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                        <Input
                                            id="labels-start"
                                            type="number"
                                            min={1}
                                            max={perPage}
                                            value={start}
                                            onChange={(e) => setStart(Math.min(perPage, Math.max(1, Number(e.target.value) || 1)))}
                                            className="imcrm-w-24"
                                            data-testid="imcrm-labels-start"
                                        />
                                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {sprintf(__('de %d — para aprovechar una hoja que ya usaste.'), perPage)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2">
                            <SheetPreview preset={preset} skip={skip} count={total} showTitle={showTitle} sample={sample} />
                            <p className="imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-labels-summary">
                                {total === null || pages === null
                                    ? __('Se imprime lo que muestra la vista.')
                                    : p.kind === 'roll'
                                      ? sprintf(_n('%d etiqueta en el rollo.', '%d etiquetas en el rollo.', total), total)
                                      : `${sprintf(_n('%d etiqueta', '%d etiquetas', total), total)} ${sprintf(_n('en %d hoja.', 'en %d hojas.', pages), pages)}`}
                            </p>
                        </div>
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                            <QrCode className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            {__('Imprime al 100 % para que cada QR caiga en su etiqueta.')}
                        </p>
                        <div className="imcrm-flex imcrm-gap-2">
                            <Button variant="ghost" onClick={onClose}>
                                {__('Cancelar')}
                            </Button>
                            <Button onClick={() => download.mutate()} disabled={download.isPending || total === 0} className="imcrm-gap-2" data-testid="imcrm-labels-download">
                                <Download className="imcrm-h-4 imcrm-w-4" />
                                {download.isPending ? __('Armando el PDF…') : __('Descargar PDF')}
                            </Button>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function ChoiceRow({
    checked,
    disabled,
    onSelect,
    title,
    hint,
    testId,
}: {
    checked: boolean;
    disabled?: boolean;
    onSelect: () => void;
    title: string;
    hint: string;
    testId: string;
}): JSX.Element {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={onSelect}
            className={cn(
                'imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-transition-colors',
                checked ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent',
                disabled && 'imcrm-cursor-not-allowed imcrm-opacity-60 hover:imcrm-bg-transparent',
            )}
            data-testid={testId}
        >
            <span
                className={cn(
                    'imcrm-mt-0.5 imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border',
                    checked ? 'imcrm-border-primary' : 'imcrm-border-muted-foreground/50',
                )}
                aria-hidden
            >
                {checked && <span className="imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-primary" />}
            </span>
            <span className="imcrm-min-w-0">
                <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{title}</span>
                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{hint}</span>
            </span>
        </button>
    );
}

/**
 * La primera hoja tal como sale: las etiquetas salteadas en gris, las que se
 * llenan con un QR de muestra y renglones donde va el texto. Con las MISMAS
 * medidas que usa el servidor (`labelSlots`, `labelInnerLayout`).
 */
function SheetPreview({
    preset,
    skip,
    count,
    showTitle,
    sample,
}: {
    preset: LabelPresetKey;
    skip: number;
    count: number | null;
    showTitle: boolean;
    sample: { lines: string[]; code: string };
}): JSX.Element {
    const p = LABEL_PRESETS[preset];
    const slots = labelSlots(preset);
    const lay = labelInnerLayout(p.labelW, p.labelH);
    const filled = count === null ? slots.length : Math.min(slots.length, skip + count);
    const roll = p.kind === 'roll';
    const scale = roll ? 220 / p.pageW : 200 / p.pageH;
    const w = p.pageW * scale;
    const h = p.pageH * scale;
    const lineCount = (showTitle ? 1 : 0) + sample.lines.length + (sample.code ? 1 : 0);
    return (
        <svg
            width={w}
            height={h}
            viewBox={`0 0 ${p.pageW} ${p.pageH}`}
            className="imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-white imcrm-shadow-imcrm-sm"
            role="img"
            aria-label={sprintf(__('Vista de la hoja: %s'), p.name)}
            data-testid="imcrm-labels-preview"
        >
            {slots.map((s, i) => {
                const used = i < skip;
                const on = !used && i < filled;
                const qrX = lay.direction === 'row' ? s.x + lay.pad : s.x + (s.w - lay.qr) / 2;
                const qrY = lay.direction === 'row' ? s.y + (s.h - lay.qr) / 2 : s.y + lay.pad;
                const lineH = Math.min(lay.titleSize * 0.7, lay.text.h / Math.max(1, lineCount) - 2);
                return (
                    <g key={i}>
                        <rect x={s.x + 0.5} y={s.y + 0.5} width={s.w - 1} height={s.h - 1} rx={Math.min(6, s.h * 0.08)} fill={used ? '#eceef2' : '#ffffff'} stroke="#c9ced6" strokeWidth={roll ? 1 : 0.8} strokeDasharray={used ? '3 3' : undefined} />
                        {on && (
                            <>
                                <QrMock x={qrX} y={qrY} size={lay.qr} />
                                {Array.from({ length: lineCount }, (_, j) => (
                                    <rect
                                        key={j}
                                        x={s.x + lay.text.x + (lay.direction === 'column' ? lay.text.w * 0.15 : 0)}
                                        y={s.y + lay.text.y + j * (lineH + 3)}
                                        width={(lay.direction === 'column' ? lay.text.w * 0.7 : lay.text.w) * (j === 0 && showTitle ? 0.9 : 0.6)}
                                        height={Math.max(2, lineH * 0.6)}
                                        rx={1}
                                        fill={j === 0 && showTitle ? '#3f4652' : '#a5acb8'}
                                    />
                                ))}
                            </>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

/** Un QR de muestra (no codifica nada: sólo da la idea de dónde va). */
function QrMock({ x, y, size }: { x: number; y: number; size: number }): JSX.Element {
    const n = 7;
    const c = size / n;
    const on = (i: number, j: number): boolean => {
        const finder = (a: number, b: number) => (a < 3 && b < 3) || (a < 3 && b > 3) || (a > 3 && b < 3);
        if (finder(i, j)) return !(i % 3 === 1 && j % 3 === 1) || (i === 1 && j === 1) || (i === 1 && j === 5) || (i === 5 && j === 1);
        return (i * 3 + j * 5) % 4 === 0;
    };
    const cells: JSX.Element[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (on(i, j)) cells.push(<rect key={`${i}-${j}`} x={x + j * c} y={y + i * c} width={c} height={c} fill="#111" />);
    return <g>{cells}</g>;
}
