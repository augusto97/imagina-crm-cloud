import { FORM_ITEM_WIDTHS, type FormConfig, type FormFieldItem, type FormImageItem, type FormItemWidth, type PublicChoiceStyle } from '@imagina-base/shared';

import { NumberField } from '@/components/design/DesignStyleControls';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { IMAGE_MAX_SIDE } from '@/lib/imageResize';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section } from '../../automations/email/EmailBlockInspector';
import { ImageUpload } from './ImageUpload';
import { DisplayOptions, DisplaySelect } from './QuestionKind';
import { effectiveChoiceDisplay, setOptionImage } from './themeOps';

/**
 * v0.1.351 (ADR-S94) — Diseño de UNA pregunta (ancho, etiqueta, cómo se ven
 * sus opciones y una imagen por opción) y el editor del ítem «Imagen».
 */

const WIDTH_LABELS: Record<FormItemWidth, string> = {
    full: 'Completo',
    half: 'Mitad',
    third: 'Un tercio',
    two_thirds: 'Dos tercios',
};

const STYLE_LABELS: Record<PublicChoiceStyle, string> = { list: 'lista', buttons: 'botones', cards: 'tarjetas' };

/** Tope de opciones con imagen (el del schema del formulario). */
const OPTION_IMAGES_MAX = 60;

function WidthControl({ value, onChange }: { value: FormItemWidth; onChange: (v: FormItemWidth) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Ancho')}</span>
            <div role="group" aria-label={__('Ancho')} className="imcrm-grid imcrm-grid-cols-4 imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5">
                {FORM_ITEM_WIDTHS.map((w) => (
                    <button
                        key={w}
                        type="button"
                        aria-pressed={w === value}
                        onClick={() => onChange(w)}
                        className={cn(
                            'imcrm-flex imcrm-h-7 imcrm-min-w-0 imcrm-items-center imcrm-justify-center imcrm-whitespace-nowrap imcrm-rounded imcrm-px-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground',
                            w === value && 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm',
                        )}
                    >
                        {__(WIDTH_LABELS[w])}
                    </button>
                ))}
            </div>
        </div>
    );
}

function fieldOptions(field: FieldEntity): Array<{ value: string; label: string }> {
    const raw = field.config.options;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((o) => {
        if (!o || typeof o !== 'object') return [];
        const { value, label } = o as { value?: unknown; label?: unknown };
        return typeof value === 'string' ? [{ value, label: typeof label === 'string' && label !== '' ? label : value }] : [];
    });
}

export function FieldItemDesign({
    item,
    field,
    themeChoiceStyle,
    config,
    fields,
    listId,
    onSet,
}: {
    item: FormFieldItem;
    field: FieldEntity;
    /** Estilo de las opciones del tema del formulario. */
    themeChoiceStyle: PublicChoiceStyle;
    /** v0.1.355 — el formulario y los campos de la lista (para «Otro»). */
    config: FormConfig;
    fields: FieldEntity[];
    listId: number;
    onSet: (patch: Partial<FormFieldItem>) => void;
}): JSX.Element {
    // v0.1.355 — las opciones (columnas, imágenes) sólo valen para las formas de opciones.
    const choiceShown = ['auto', 'radio', 'buttons', 'cards', 'dropdown'].includes(item.display);
    const isChoice = (field.type === 'select' || field.type === 'multi_select' || field.type === 'team') && choiceShown;
    const multiple = field.type === 'multi_select' || (field.type === 'team' && field.config.multiple === true);
    const options = field.type === 'team' ? [] : fieldOptions(field);
    const optionCount = field.type === 'team' ? 0 : options.length;
    const shown = effectiveChoiceDisplay(item.display, themeChoiceStyle, optionCount, multiple);
    const imagesAllowed = field.type === 'select' || field.type === 'multi_select';
    const imageCount = Object.keys(item.option_images).length;

    return (
        <Section title={__('Diseño de esta pregunta')}>
            <DisplaySelect item={item} field={field} multiple={multiple} themeLabel={STYLE_LABELS[themeChoiceStyle]} onSet={onSet} />
            {isChoice && item.display === 'auto' && !multiple && optionCount > 6 && (
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Con más de 6 opciones, «Según el tema» la muestra como lista desplegable.')}
                </p>
            )}
            <DisplayOptions item={item} field={field} config={config} fields={fields} listId={listId} onSet={onSet} />
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="form-item-design">
                <WidthControl value={item.width} onChange={(width) => onSet({ width })} />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Dos preguntas de «Mitad» seguidas quedan lado a lado. En el celular, una debajo de la otra.')}
                </p>
            </div>
            <Check label={__('Ocultar la etiqueta')} checked={item.hide_label} onChange={(v) => onSet({ hide_label: v })} testId="form-item-hide-label" />
            {item.hide_label && (
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Sigue disponible para los lectores de pantalla. Úsalo con un texto de ejemplo que diga qué se pide.')}
                </p>
            )}

            {isChoice && (
                <>
                    {multiple && item.display === 'dropdown' && (
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Con varias opciones no hay lista desplegable: se muestran según el tema.')}
                        </p>
                    )}
                    {shown !== 'dropdown' && (
                        <Field label={__('Columnas')}>
                            <Select
                                value={item.columns === null ? '' : String(item.columns)}
                                onChange={(e) => onSet({ columns: e.target.value === '' ? null : Number(e.target.value) })}
                                data-testid="form-item-columns"
                            >
                                <option value="">{__('Según el tema')}</option>
                                {[1, 2, 3, 4].map((n) => (
                                    <option key={n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    )}
                    {imagesAllowed && shown === 'cards' && options.length > 0 && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-option-images">
                            <p className="imcrm-text-xs imcrm-font-medium">{__('Imagen de cada opción')}</p>
                            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                                {__('Opcional. Se ve en la tarjeta de la opción; la que no tiene imagen muestra sólo el texto.')}
                            </p>
                            {options.slice(0, OPTION_IMAGES_MAX).map((o) => (
                                <ImageUpload
                                    key={o.value}
                                    compact
                                    label={o.label}
                                    fileId={item.option_images[o.value] ?? null}
                                    maxSide={IMAGE_MAX_SIDE.option}
                                    onChange={(id) => onSet(setOptionImage(item, o.value, id))}
                                    testId={`form-option-image-${o.value}`}
                                />
                            ))}
                            {options.length > OPTION_IMAGES_MAX && (
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {__('Sólo las primeras %d opciones pueden llevar imagen.').replace('%d', String(OPTION_IMAGES_MAX))}
                                </p>
                            )}
                        </div>
                    )}
                    {imagesAllowed && shown !== 'cards' && imageCount > 0 && (
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Las imágenes de las opciones se ven con «Tarjetas».')}
                        </p>
                    )}
                </>
            )}
        </Section>
    );
}

export function ImageItemEditor({ item, onSet }: { item: FormImageItem; onSet: (patch: Partial<FormImageItem>) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="form-image-item">
            <ImageUpload
                label={__('Imagen')}
                fileId={item.file_id}
                maxSide={IMAGE_MAX_SIDE.item}
                onChange={(id) => onSet({ file_id: id })}
                hint={__('Se achica sola antes de subirla. Una foto, un mapa, un logo de quien organiza…')}
                testId="form-image-item-upload"
            />
            <Field label={__('Texto alternativo')} hint={__('Lo leen los lectores de pantalla. Describe qué muestra la imagen.')}>
                <Input value={item.alt} maxLength={300} onChange={(e) => onSet({ alt: e.target.value })} data-testid="form-image-alt" />
            </Field>
            <Field label={__('Pie de foto')} hint={__('Opcional. Aparece debajo de la imagen.')}>
                <Input value={item.caption} maxLength={300} onChange={(e) => onSet({ caption: e.target.value })} />
            </Field>
            <Section title={__('Diseño')}>
                <WidthControl value={item.width} onChange={(width) => onSet({ width })} />
                <NumberField
                    label={__('Alto máximo')}
                    unit="px"
                    min={40}
                    max={1200}
                    step={10}
                    value={item.max_height}
                    placeholder={__('natural')}
                    onChange={(v) => onSet({ max_height: v == null ? null : Math.round(v) })}
                />
            </Section>
        </div>
    );
}
