import { useState } from 'react';
import {
    AlignLeft,
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    Building2,
    EyeOff,
    BadgeDollarSign,
    GripVertical,
    Grid3x3,
    Hand,
    Heading1,
    Heading2,
    Image as ImageIcon,
    LayoutTemplate,
    Lock,
    MousePointerClick,
    Paintbrush,
    PartyPopper,
    Plus,
    Scale,
    SeparatorHorizontal,
    ShieldCheck,
    SquareDashed,
    Type,
    TrendingUp,
    Minus,
    type LucideIcon,
} from 'lucide-react';
import { DEFAULT_PUBLIC_THEME, formPaymentActive, formSubscriptionActive, type FormConfig, type FormItem, type PublicTheme } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { fieldIconOf } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { attributionColumnIds, availableFields, moveItem, moveItemTo, pageCount, pageNumbers, type FormContentType } from '../formDesignOps';
import { OutlineAddChips, OutlineRow, OutlineSection, type OutlineAddItem } from '../../builder/Outline';
import { PAGE_ELEMENTS, elementVisible, setElementVisible, type PageElementId } from './pageElements';

/**
 * v0.1.377 — «Contenido» del constructor: TODO lo que tiene el formulario, en
 * el orden en que se ve — el encabezado (logo, título, descripción, franja,
 * portada, bienvenida), las preguntas por página y lo del final (avance,
 * verificación, botón, agradecimiento) — cada fila se toca para editarla y,
 * si se puede ocultar, tiene su ojo (v0.1.407: en bloques, lo apagado en «Ocultos»). Así ocultar el título o cambiar el botón
 * es encontrarlo en la lista, no adivinar en qué pestaña está.
 */

export const ELEMENT_ICON: Record<PageElementId, LucideIcon> = {
    '@page': Paintbrush,
    '@card': SquareDashed,
    '@cover': LayoutTemplate,
    '@band': Minus,
    '@logo': Building2,
    '@title': Heading1,
    '@description': AlignLeft,
    '@welcome': Hand,
    '@progress': TrendingUp,
    '@submit': MousePointerClick,
    '@thanks': PartyPopper,
    '@captcha': ShieldCheck,
    '@consent': Scale,
    '@payment': BadgeDollarSign,
    '@subscription': BadgeDollarSign,
};

export function itemTitle(item: FormItem, fieldsById: Map<number, FieldEntity>): string {
    if (item.type === 'heading') return item.text || __('Título de sección');
    if (item.type === 'text') return item.text.split('\n')[0] || __('Texto');
    if (item.type === 'page_break') return item.title || __('Salto de página');
    if (item.type === 'image') return item.caption.trim() || item.alt.trim() || __('Imagen');
    if (item.type === 'matrix') return item.label.trim() || __('Matriz');
    return item.label.trim() || fieldsById.get(item.field_id)?.label || __('Campo borrado');
}

export function itemIcon(item: FormItem, fieldsById: Map<number, FieldEntity>): LucideIcon {
    if (item.type === 'heading') return Heading2;
    if (item.type === 'text') return Type;
    if (item.type === 'page_break') return SeparatorHorizontal;
    if (item.type === 'image') return ImageIcon;
    if (item.type === 'matrix') return Grid3x3;
    return fieldIconOf(fieldsById.get(item.field_id) ?? { type: 'text' }) as LucideIcon;
}

interface Props {
    config: FormConfig;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    selected: string | null;
    onSelect: (id: string) => void;
    onChange: (next: FormConfig) => void;
    onAddField: (fieldId: number) => void;
    onAddContent: (type: FormContentType) => void;
    onAddMatrix: () => void;
    /** Lo que muestra la fila del título (el del formulario o su nombre). */
    titleText: string;
    /** Si la empresa tiene logo (para decir «Sin logo» cuando no hay). */
    hasLogo: boolean;
    base?: PublicTheme;
    /** v0.1.383 — Columnas que escribe una sincronización (id → motivo): no se preguntan. */
    locked?: ReadonlyMap<number, string> | null;
}

export function ContentOutline(p: Props): JSX.Element {
    const [adding, setAdding] = useState(false);
    if (adding) {
        return (
            <AddCatalog
                {...p}
                onBack={() => setAdding(false)}
                onAddField={(id) => {
                    p.onAddField(id);
                    setAdding(false);
                }}
                onAddContent={(t) => {
                    p.onAddContent(t);
                    setAdding(false);
                }}
                onAddMatrix={() => {
                    p.onAddMatrix();
                    setAdding(false);
                }}
            />
        );
    }
    const s = p.config.settings;
    const base = p.base ?? DEFAULT_PUBLIC_THEME;
    const multiPage = pageCount(p.config) > 1;
    const details: Partial<Record<PageElementId, string | undefined>> = {
        '@logo': !s.show_logo ? undefined : s.logo_file_id !== null ? __('Logo propio') : p.hasLogo ? __('El de la empresa') : __('Sin logo cargado'),
        '@title': p.titleText,
        '@description': s.description.split('\n')[0] || __('Sin descripción'),
        '@welcome': __('Pantalla antes de empezar'),
        '@submit': `«${s.submit_label || __('Enviar')}»`,
        '@thanks': s.success_title || undefined,
        '@page': __('Fondo, ancho y separación'),
    };
    // v0.1.407 — lo que se ve va en filas; lo apagado, en «Ocultos» al pie de su bloque.
    const split = (ids: PageElementId[]): { rows: JSX.Element[]; chips: OutlineAddItem[] } => {
        const rows: JSX.Element[] = [];
        const chips: OutlineAddItem[] = [];
        for (const id of ids) {
            const visible = elementVisible(p.config, id, base);
            const label = __(PAGE_ELEMENTS[id].label);
            if (visible === false) {
                chips.push({
                    key: id,
                    icon: ELEMENT_ICON[id],
                    label,
                    onAdd: () => {
                        p.onChange(setElementVisible(p.config, id, true, base));
                        p.onSelect(id);
                    },
                    attrs: { 'data-show-element': id },
                });
                continue;
            }
            rows.push(
                <OutlineRow
                    key={id}
                    icon={ELEMENT_ICON[id]}
                    label={label}
                    detail={details[id]}
                    selected={p.selected === id}
                    onSelect={() => p.onSelect(id)}
                    onHide={visible === true ? () => p.onChange(setElementVisible(p.config, id, false, base)) : undefined}
                    attrs={{ 'data-outline-element': id }}
                />,
            );
        }
        return { rows, chips };
    };
    const header = split(['@logo', '@title', '@description', '@band', '@cover', '@welcome']);
    const end = split([
        ...(multiPage ? (['@progress'] as const) : []),
        ...(s.captcha ? (['@captcha'] as const) : []),
        ...(s.data_consent ? (['@consent'] as const) : []),
        ...(formPaymentActive(p.config) ? (['@payment'] as const) : []),
        ...(formSubscriptionActive(p.config) ? (['@subscription'] as const) : []),
        '@submit',
        '@thanks',
    ]);
    const frame = split(['@card', '@page']);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-bg-muted/20 imcrm-p-2.5" data-testid="form-outline">
            <OutlineSection
                zone="top"
                title={__('Encabezado')}
                hint={__('Lo primero que se ve: logo, título y descripción.')}
                footer={header.chips.length ? <OutlineAddChips items={header.chips} separated={header.rows.length > 0} /> : undefined}
                testId="outline-header"
            >
                {header.rows.length ? header.rows : null}
            </OutlineSection>

            <OutlineSection
                zone="middle"
                title={__('Preguntas')}
                hint={__('Lo que responde la persona, en orden. Arrastra para reordenar.')}
                count={p.config.items.length}
                footer={
                    <Button
                        variant="outline"
                        size="sm"
                        className="imcrm-w-full imcrm-justify-center imcrm-gap-1.5 imcrm-border-dashed"
                        onClick={() => setAdding(true)}
                        data-testid="form-add-open"
                        data-tour="form-add"
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar pregunta o contenido')}
                    </Button>
                }
                testId="outline-questions"
            >
                <ItemList {...p} multiPage={multiPage} />
            </OutlineSection>

            <OutlineSection
                zone="bottom"
                title={__('Al enviar')}
                hint={__('Lo que va debajo de las preguntas y lo que se ve después de enviar.')}
                footer={end.chips.length ? <OutlineAddChips items={end.chips} separated={end.rows.length > 0} /> : undefined}
                testId="outline-end"
            >
                {end.rows.length ? end.rows : null}
            </OutlineSection>

            <OutlineSection
                zone="frame"
                title={__('Marco y fondo')}
                hint={__('La tarjeta donde van las preguntas y el fondo alrededor.')}
                footer={frame.chips.length ? <OutlineAddChips items={frame.chips} separated={frame.rows.length > 0} /> : undefined}
                testId="outline-frame"
            >
                {frame.rows.length ? frame.rows : null}
            </OutlineSection>
        </div>
    );
}

function ItemList(p: Props & { multiPage: boolean }): JSX.Element {
    const [dragId, setDragId] = useState<string | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);
    const pageOf = pageNumbers(p.config);
    if (p.config.items.length === 0) {
        return (
            <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-4 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground" data-testid="form-structure">
                {__('Todavía no hay preguntas. Toca «Agregar pregunta o contenido».')}
            </p>
        );
    }
    return (
        <ol className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="form-structure">
            {p.multiPage && p.config.items[0]?.type !== 'page_break' && (
                <li className="imcrm-px-1.5 imcrm-pb-0.5 imcrm-pt-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Página')} 1</li>
            )}
            {p.config.items.map((item, idx) => {
                const Icon = itemIcon(item, p.fieldsById);
                const isBreak = item.type === 'page_break';
                return (
                    <li
                        key={item.id}
                        draggable
                        onDragStart={(e) => {
                            setDragId(item.id);
                            e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                            if (!dragId) return;
                            e.preventDefault();
                            const r = e.currentTarget.getBoundingClientRect();
                            setDropAt(e.clientY < r.top + r.height / 2 ? idx : idx + 1);
                        }}
                        onDragEnd={() => {
                            setDragId(null);
                            setDropAt(null);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            if (dragId && dropAt !== null) {
                                const from = p.config.items.findIndex((i) => i.id === dragId);
                                p.onChange(moveItemTo(p.config, dragId, from < dropAt ? dropAt - 1 : dropAt));
                            }
                            setDragId(null);
                            setDropAt(null);
                        }}
                        className={cn(
                            'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-transparent imcrm-px-1.5 imcrm-py-1.5 imcrm-text-sm',
                            isBreak && 'imcrm-mt-2 imcrm-border-dashed imcrm-border-t-border imcrm-bg-muted/40',
                            p.selected === item.id ? 'imcrm-border-primary/40 imcrm-bg-primary/5' : 'hover:imcrm-bg-accent',
                            dropAt === idx && 'imcrm-border-t-primary',
                            dropAt === idx + 1 && idx === p.config.items.length - 1 && 'imcrm-border-b-primary',
                        )}
                        data-structure-item={item.id}
                    >
                        <GripVertical className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-cursor-grab imcrm-text-muted-foreground" />
                        <button type="button" className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-text-left" onClick={() => p.onSelect(item.id)}>
                            <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                            {isBreak && (
                                <span className="imcrm-shrink-0 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {__('Página')} {pageOf.get(item.id) ?? 1}
                                </span>
                            )}
                            <span className={cn('imcrm-truncate', item.type === 'heading' && 'imcrm-font-medium', isBreak && 'imcrm-text-muted-foreground')}>
                                {isBreak ? (item.title ? `· ${item.title}` : '') : itemTitle(item, p.fieldsById)}
                            </span>
                            {item.type === 'field' && item.hidden && <EyeOff className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground" aria-label={__('Oculta')} />}
                            {item.type === 'field' && p.locked?.has(item.field_id) && (
                                <span title={`${__('Lo que respondan aquí no se guarda.')} ${p.locked.get(item.field_id) ?? ''}`} className="imcrm-shrink-0" data-testid="form-item-managed">
                                    <Lock className="imcrm-h-3 imcrm-w-3 imcrm-text-amber-600" aria-label={__('Columna sincronizada: no se guarda')} />
                                </span>
                            )}
                            {item.show_if && <span className="imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-text-[10px] imcrm-text-muted-foreground">{__('si…')}</span>}
                        </button>
                        <span className="imcrm-flex imcrm-opacity-0 group-hover:imcrm-opacity-100 group-focus-within:imcrm-opacity-100">
                            <button type="button" aria-label={__('Subir')} disabled={idx === 0} onClick={() => p.onChange(moveItem(p.config, item.id, -1))} className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30">
                                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                            <button type="button" aria-label={__('Bajar')} disabled={idx === p.config.items.length - 1} onClick={() => p.onChange(moveItem(p.config, item.id, 1))} className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30">
                                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

const CONTENT_TYPES: Array<{ type: FormContentType | 'matrix'; label: string; hint?: string; icon: LucideIcon; testId?: string }> = [
    { type: 'heading', label: 'Título de sección', icon: Heading2 },
    { type: 'text', label: 'Texto o aclaración', icon: Type },
    { type: 'page_break', label: 'Salto de página', hint: 'por pasos', icon: SeparatorHorizontal, testId: 'form-add-page-break' },
    { type: 'image', label: 'Imagen', icon: ImageIcon, testId: 'form-add-image' },
    { type: 'matrix', label: 'Matriz', hint: 'varias preguntas en una tabla', icon: Grid3x3, testId: 'form-add-matrix' },
];

function AddCatalog(p: Props & { onBack: () => void }): JSX.Element {
    const available = availableFields(p.fields, p.config, p.locked);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-3" data-testid="form-add-catalog">
            <button type="button" onClick={p.onBack} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground" data-testid="form-add-back">
                <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Volver al contenido')}
            </button>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Preguntas: los campos de la lista')}</p>
                {available.length === 0 ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Ya están todos los campos que se pueden preguntar.')}</p>
                ) : (
                    available.map((f) => {
                        const Icon = fieldIconOf(f);
                        return (
                            <button
                                key={f.id}
                                type="button"
                                onClick={() => p.onAddField(f.id)}
                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                                data-add-field={f.slug}
                            >
                                <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{f.label}</span>
                                {f.is_required && <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__('obligatorio')}</span>}
                                <Plus className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                            </button>
                        );
                    })
                )}
                <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Las personas del equipo, las relaciones y los campos calculados no se preguntan en un formulario público.')}
                    {attributionColumnIds(p.config).size > 0 && ' ' + __('Las columnas de dónde vino cada registro se llenan solas (Ajustes → Medir conversiones).')}
                </p>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Contenido')}</p>
                {CONTENT_TYPES.map((c) => (
                    <button
                        key={c.type}
                        type="button"
                        onClick={() => (c.type === 'matrix' ? p.onAddMatrix() : p.onAddContent(c.type))}
                        className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                        data-testid={c.testId}
                    >
                        <c.icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                        <span className="imcrm-min-w-0 imcrm-flex-1">{__(c.label)}</span>
                        {c.hint && <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__(c.hint)}</span>}
                    </button>
                ))}
                <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Con saltos de página el formulario se responde por pasos, con una barra de progreso.')}</p>
            </div>
        </div>
    );
}
