import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
    SHOP_DEFAULT_FIELD_LABELS,
    SHOP_MAX_QUESTIONS,
    SHOP_QUESTION_COLUMN_TYPES,
    SHOP_QUESTION_PLACE_LABELS,
    SHOP_QUESTION_PLACES,
    SHOP_QUESTION_TYPE_LABELS,
    SHOP_QUESTION_TYPES,
    newShopItemId,
    type ShopConfig,
    type ShopFieldMode,
    type ShopOptions,
    type ShopQuestion,
    type ShopQuestionType,
} from '@imagina-base/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __, sprintf } from '@/lib/i18n';
import { PanelBody, SubSection, SwitchRow } from '../widgets/widgetUi';
import { Field, MoneyInput, Segmented } from './ShopPanels';

/**
 * v0.1.430 (ADR-S103) — Lo que se pide al pagar en la tienda: los datos fijos
 * (celular, documento y notas: no pedirlos, opcionales u obligatorios, con su
 * nombre) y las PREGUNTAS PROPIAS, cada una con su tipo, si es obligatoria,
 * dónde va y la columna de «Pedidos» donde se guarda (la crea el servidor al
 * guardar si no se elige una).
 */

type Patch = (fn: (c: ShopConfig) => ShopConfig) => void;
type Checkout = ShopConfig['checkout'];

const MODES: ReadonlyArray<readonly [ShopFieldMode, string]> = [
    ['hidden', __('No pedirlo')],
    ['optional', __('Opcional')],
    ['required', __('Obligatorio')],
];

const FIXED: ReadonlyArray<{ key: 'phone' | 'document' | 'notes'; mode: 'ask_phone' | 'ask_document' | 'ask_notes'; hint: string }> = [
    { key: 'phone', mode: 'ask_phone', hint: __('Para avisarle de su pedido o escribirle por WhatsApp.') },
    { key: 'document', mode: 'ask_document', hint: __('Cédula, NIT, RUT, DNI… Cámbiale el nombre al de tu país.') },
    { key: 'notes', mode: 'ask_notes', hint: __('Un espacio para indicaciones: talla, color, horario de entrega.') },
];

export function CheckoutFieldsSection({ config, patch }: { config: ShopConfig; patch: Patch }): JSX.Element {
    const ch = config.checkout;
    const setC = (p: Partial<Checkout>): void => patch((c) => ({ ...c, checkout: { ...c.checkout, ...p } }));
    return (
        <SubSection
            title={__('Lo que se pide al comprar')}
            hint={__('El nombre y el correo se piden siempre: al correo le llega la confirmación del pedido. La dirección la pide la forma de entrega.')}
            tour="shop-checkout-fields"
        >
            <ul className="imcrm-space-y-2" data-testid="shop-checkout-fixed">
                {FIXED.map((f) => (
                    <li key={f.key} className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2.5" data-testid={`shop-fixed-${f.key}`}>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <Input
                                value={ch.labels[f.key]}
                                maxLength={60}
                                placeholder={SHOP_DEFAULT_FIELD_LABELS[f.key]}
                                onChange={(e) => setC({ labels: { ...ch.labels, [f.key]: e.target.value } })}
                                aria-label={sprintf(__('Nombre de «%s»'), SHOP_DEFAULT_FIELD_LABELS[f.key])}
                                className="imcrm-min-w-0 imcrm-flex-1 sm:imcrm-max-w-[12rem]"
                                data-testid={`shop-fixed-${f.key}-label`}
                            />
                            <Segmented value={ch[f.mode]} onChange={(v) => setC({ [f.mode]: v } as Partial<Checkout>)} options={MODES} testId={`shop-ask-${f.key}`} />
                        </div>
                        <p className="imcrm-mt-1 imcrm-text-[11.5px] imcrm-text-muted-foreground">{f.hint}</p>
                    </li>
                ))}
            </ul>
        </SubSection>
    );
}

export function QuestionsSection({ config, options, patch }: { config: ShopConfig; options: ShopOptions; patch: Patch }): JSX.Element {
    const qs = config.checkout.questions;
    const setQs = (fn: (list: ShopQuestion[]) => ShopQuestion[]): void => patch((c) => ({ ...c, checkout: { ...c.checkout, questions: fn(c.checkout.questions) } }));
    const add = (): void =>
        setQs((list) => [
            ...list,
            { id: newShopItemId(list.map((q) => q.id)), label: '', type: 'text', mode: 'optional', help: '', placeholder: '', options: [], place: 'end', field_id: null },
        ]);
    return (
        <SubSection
            title={__('Preguntas propias')}
            hint={__('Lo que necesites saber de cada compra: «Barrio», «¿Cómo nos conociste?», «Fecha del evento». Cada respuesta queda en una columna de «Pedidos».')}
            tour="shop-checkout-questions"
            testId="shop-questions"
        >
            {qs.length === 0 ? (
                <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{__('Todavía no hay preguntas propias.')}</p>
            ) : (
                <div className="imcrm-space-y-2">
                    {qs.map((q, i) => (
                        <QuestionRow
                            key={q.id}
                            q={q}
                            index={i}
                            count={qs.length}
                            columns={options.order_fields ?? []}
                            taken={qs.filter((x) => x.id !== q.id).map((x) => x.field_id).filter((x): x is number => x !== null)}
                            onChange={(next) => setQs((list) => list.map((x) => (x.id === q.id ? next : x)))}
                            onMove={(dir) =>
                                setQs((list) => {
                                    const out = [...list];
                                    const j = i + dir;
                                    if (j < 0 || j >= out.length) return out;
                                    [out[i], out[j]] = [out[j]!, out[i]!];
                                    return out;
                                })
                            }
                            onRemove={() => setQs((list) => list.filter((x) => x.id !== q.id))}
                        />
                    ))}
                </div>
            )}
            <Button variant="outline" size="sm" className="imcrm-mt-2 imcrm-gap-1" disabled={qs.length >= SHOP_MAX_QUESTIONS} onClick={add} data-testid="shop-question-add">
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agregar una pregunta')}
            </Button>
            {qs.length >= SHOP_MAX_QUESTIONS && <p className="imcrm-mt-1 imcrm-text-[11.5px] imcrm-text-muted-foreground">{sprintf(__('Hasta %d preguntas.'), SHOP_MAX_QUESTIONS)}</p>}
        </SubSection>
    );
}

function QuestionRow({
    q,
    index,
    count,
    columns,
    taken,
    onChange,
    onMove,
    onRemove,
}: {
    q: ShopQuestion;
    index: number;
    count: number;
    columns: ShopOptions['order_fields'];
    taken: number[];
    onChange: (q: ShopQuestion) => void;
    onMove: (dir: -1 | 1) => void;
    onRemove: () => void;
}): JSX.Element {
    const set = (p: Partial<ShopQuestion>): void => onChange({ ...q, ...p });
    // Las opciones se escriben una por renglón: el borrador conserva el renglón vacío mientras se escribe.
    const [optsDraft, setOptsDraft] = useState(q.options.join('\n'));
    const usable = columns.filter((c) => (SHOP_QUESTION_COLUMN_TYPES[q.type] as readonly string[]).includes(c.type) && !taken.includes(c.id));
    const column = q.field_id !== null ? columns.find((c) => c.id === q.field_id) : undefined;
    const setType = (type: ShopQuestionType): void => {
        // Una columna que ya no sirve para el tipo nuevo se suelta (se crea otra al guardar).
        const keep = column && (SHOP_QUESTION_COLUMN_TYPES[type] as readonly string[]).includes(column.type);
        set({ type, field_id: keep ? q.field_id : null });
    };
    const missing = q.label.trim() === '' ? __('Escribe la pregunta: sin texto no se muestra.') : q.type === 'select' && q.options.filter((o) => o.trim()).length === 0 ? __('Escribe al menos una opción.') : '';
    return (
        <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid="shop-question-row" data-q={q.id}>
            <Input
                value={q.label}
                maxLength={120}
                placeholder={__('La pregunta (ej.: ¿Cómo nos conociste?)')}
                onChange={(e) => set({ label: e.target.value })}
                aria-label={__('Pregunta')}
                data-testid="shop-question-label"
            />
            <div className="imcrm-mt-2 imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <Select value={q.type} onChange={(e) => setType(e.target.value as ShopQuestionType)} aria-label={__('Tipo de respuesta')} data-testid="shop-question-type">
                    {SHOP_QUESTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                            {SHOP_QUESTION_TYPE_LABELS[t]}
                        </option>
                    ))}
                </Select>
                <Select value={q.place} onChange={(e) => set({ place: e.target.value as ShopQuestion['place'] })} aria-label={__('Dónde va')} data-testid="shop-question-place">
                    {SHOP_QUESTION_PLACES.map((p) => (
                        <option key={p} value={p}>
                            {SHOP_QUESTION_PLACE_LABELS[p]}
                        </option>
                    ))}
                </Select>
            </div>
            {q.type === 'select' && (
                <Textarea
                    className="imcrm-mt-2"
                    rows={3}
                    value={optsDraft}
                    placeholder={__('Una opción por renglón')}
                    onChange={(e) => {
                        setOptsDraft(e.target.value);
                        set({ options: e.target.value.split('\n').map((x) => x.slice(0, 80)).slice(0, 30) });
                    }}
                    aria-label={__('Opciones')}
                    data-testid="shop-question-options"
                />
            )}
            <div className="imcrm-mt-2 imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <Input value={q.help} maxLength={240} placeholder={__('Ayuda debajo (opcional)')} onChange={(e) => set({ help: e.target.value })} aria-label={__('Ayuda')} />
                {q.type !== 'checkbox' && q.type !== 'date' && (
                    <Input
                        value={q.placeholder}
                        maxLength={120}
                        placeholder={q.type === 'select' ? __('Texto antes de elegir (opcional)') : __('Ejemplo dentro del campo (opcional)')}
                        onChange={(e) => set({ placeholder: e.target.value })}
                        aria-label={__('Ejemplo')}
                    />
                )}
            </div>
            {q.place === 'delivery' && <p className="imcrm-mt-1.5 imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Sólo se pide cuando la forma de entrega pide dirección.')}</p>}
            {missing && <p className="imcrm-mt-1.5 imcrm-text-[11.5px] imcrm-text-amber-700 dark:imcrm-text-amber-400">{missing}</p>}
            <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Segmented
                        value={q.mode}
                        onChange={(mode) => set({ mode })}
                        options={[
                            ['optional', __('Opcional')],
                            ['required', q.type === 'checkbox' ? __('Hay que marcarla') : __('Obligatoria')],
                        ]}
                        testId="shop-question-mode"
                    />
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[12px] imcrm-text-muted-foreground">
                        {__('Se guarda en')}
                        <Select
                            className="imcrm-h-8 imcrm-w-auto imcrm-max-w-[14rem] imcrm-text-[12px]"
                            value={q.field_id === null ? '' : String(q.field_id)}
                            onChange={(e) => set({ field_id: e.target.value === '' ? null : Number(e.target.value) })}
                            aria-label={__('Columna de «Pedidos»')}
                            data-testid="shop-question-column"
                        >
                            <option value="">{q.field_id === null ? __('Una columna nueva (al guardar)') : __('Una columna nueva')}</option>
                            {column && !usable.some((c) => c.id === column.id) && <option value={column.id}>{column.label}</option>}
                            {usable.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.label}
                                </option>
                            ))}
                        </Select>
                    </label>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5">
                    <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label={__('Subir')}>
                        <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={__('Bajar')}>
                        <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" onClick={onRemove} aria-label={__('Quitar la pregunta')} data-testid="shop-question-remove">
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ── Datos y avisos ─────────────────────────────────────────────────────

export function CheckoutPanel({ config, options, patch }: { config: ShopConfig; options: ShopOptions; patch: Patch }): JSX.Element {
    const ch = config.checkout;
    const setC = (p: Partial<ShopConfig['checkout']>): void => patch((c) => ({ ...c, checkout: { ...c.checkout, ...p } }));
    const setT = (p: Partial<ShopConfig['texts']>): void => patch((c) => ({ ...c, texts: { ...c.texts, ...p } }));
    const toggleNotify = (id: number, on: boolean): void =>
        setC({ notify_user_ids: on ? [...ch.notify_user_ids.filter((x) => x !== id), id].slice(0, 20) : ch.notify_user_ids.filter((x) => x !== id) });
    return (
        <PanelBody testId="shop-checkout">
            <CheckoutFieldsSection config={config} patch={patch} />
            <QuestionsSection config={config} options={options} patch={patch} />
            <SubSection title={__('Al confirmar')} tour="shop-checkout-confirm">
                <SwitchRow
                    label={__('Aceptar los términos')}
                    hint={__('Una casilla obligatoria con el enlace a tus términos y a la política de cambios y devoluciones.')}
                    checked={ch.require_terms}
                    onChange={(v) => setC({ require_terms: v })}
                />
                <SwitchRow
                    label={__('Verificación anti-robots')}
                    hint={__('Usa la que configuraste en Ajustes → Portal y formularios. Sin llaves, no se muestra.')}
                    checked={ch.captcha}
                    onChange={(v) => setC({ captcha: v })}
                />
                <Field label={__('Compra mínima')} hint={__('Vacío = sin mínimo. Se compara con el subtotal (sin el envío).')}>
                    <div className="imcrm-w-40">
                        <MoneyInput value={ch.min_order} onChange={(min_order) => setC({ min_order: min_order && min_order > 0 ? min_order : null })} placeholder={__('Sin mínimo')} testId="shop-min-order" />
                    </div>
                </Field>
            </SubSection>
            <SubSection title={__('Después de comprar')}>
                <SwitchRow
                    label={__('Correo de confirmación a quien compra')}
                    hint={__('Con el detalle del pedido, cómo pagar y el enlace para ver su estado. Sale por el correo de tu empresa.')}
                    checked={ch.send_confirmation}
                    onChange={(v) => setC({ send_confirmation: v })}
                />
                <Field label={__('Título del mensaje de gracias')}>
                    <Input value={config.texts.success_title} maxLength={120} onChange={(e) => setT({ success_title: e.target.value })} />
                </Field>
                <Field label={__('Mensaje de gracias')}>
                    <Textarea value={config.texts.success_message} maxLength={600} rows={3} onChange={(e) => setT({ success_message: e.target.value })} />
                </Field>
            </SubSection>
            <SubSection title={__('A quién le avisa cada pedido')} hint={__('Les llega en la campana, al correo y al celular. Si no eliges a nadie, le llega a quien creó la tienda.')}>
                {options.members.length === 0 ? (
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{__('No hay personas en el equipo.')}</p>
                ) : (
                    <ul className="imcrm-flex imcrm-max-h-60 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto" data-testid="shop-notify">
                        {options.members.map((m) => {
                            const on = ch.notify_user_ids.includes(m.id);
                            return (
                                <li key={m.id}>
                                    <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-[13px] hover:imcrm-bg-muted">
                                        <input type="checkbox" checked={on} onChange={(e) => toggleNotify(m.id, e.target.checked)} />
                                        {m.name}
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </SubSection>
        </PanelBody>
    );
}
