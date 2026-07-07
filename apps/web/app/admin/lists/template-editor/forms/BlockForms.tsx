import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SIDEBAR_ICON_OPTIONS, type V2Block } from '@/lib/crmTemplates';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * Forms inline para cada tipo de bloque del editor de plantilla CRM.
 * Antes vivían en `BlockConfigDialog.tsx` (Fase 11.0–11.A0). Desde
 * Fase 11.A se rendean dentro del `BlockInspectorPanel` (columna
 * derecha persistente) en lugar de un Dialog modal.
 *
 * Cada form recibe `block` (ya narrowed por tipo) y un `onUpdate`
 * que aplica un patch parcial al config del bloque.
 */

type UpdateFn<B extends V2Block> = (patch: { config: B['config'] }) => void;

// ─────────────────────────────────────────────────────────────────────
//  Header block form
// ─────────────────────────────────────────────────────────────────────

export function HeaderForm({
    block,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'header' }>;
    onUpdate: UpdateFn<Extract<V2Block, { type: 'header' }>>;
}): JSX.Element {
    const updateConfig = (patch: Partial<typeof block.config>): void => {
        onUpdate({ config: { ...block.config, ...patch } });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <Field label={__('Variante')}>
                <select
                    value={block.config.variant}
                    onChange={(e) =>
                        updateConfig({
                            variant: e.target.value as 'hero' | 'compact' | 'minimal' | 'banner',
                        })
                    }
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="hero">{__('Hero (avatar grande + banda)')}</option>
                    <option value="compact">{__('Compacta (una sola fila)')}</option>
                    <option value="minimal">{__('Minimal (sin avatar)')}</option>
                    <option value="banner">{__('Banner (centrado, estilo perfil)')}</option>
                </select>
            </Field>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Elementos visibles')}</Label>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-x-3 imcrm-gap-y-2">
                    <Toggle
                        label={__('Avatar')}
                        checked={block.config.show_avatar}
                        onChange={(v) => updateConfig({ show_avatar: v })}
                    />
                    <Toggle
                        label={__('Badge #ID')}
                        checked={block.config.show_id_badge}
                        onChange={(v) => updateConfig({ show_id_badge: v })}
                    />
                    <Toggle
                        label={__('Subtítulo')}
                        checked={block.config.show_subtitle}
                        onChange={(v) => updateConfig({ show_subtitle: v })}
                    />
                    <Toggle
                        label={__('Fecha de creación')}
                        checked={block.config.show_created_at}
                        onChange={(v) => updateConfig({ show_created_at: v })}
                    />
                    <Toggle
                        label={__('Status pills')}
                        checked={block.config.show_status_strip}
                        onChange={(v) => updateConfig({ show_status_strip: v })}
                    />
                </div>
                {/* 0.57.36 — quitamos el toggle "Botones acción". Las
                 * acciones Guardar/Eliminar viven en la toolbar del
                 * registro (fuera del template), no en este bloque. */}
            </div>

            <Field label={__('Color de acento (opcional)')}>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <input
                        type="color"
                        value={block.config.accent_color ?? '#5a3fcc'}
                        onChange={(e) => updateConfig({ accent_color: e.target.value })}
                        className="imcrm-h-9 imcrm-w-12 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-input"
                    />
                    <Input
                        value={block.config.accent_color ?? ''}
                        onChange={(e) => updateConfig({ accent_color: e.target.value || null })}
                        placeholder={__('Auto (desde título)')}
                        className="imcrm-flex-1 imcrm-h-9 imcrm-text-sm imcrm-font-mono"
                    />
                    {block.config.accent_color !== null && (
                        <button
                            type="button"
                            onClick={() => updateConfig({ accent_color: null })}
                            className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                        >
                            {__('Reset')}
                        </button>
                    )}
                </div>
                <p className="imcrm-mt-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                    {__('Si está vacío, se calcula automáticamente a partir del título del registro.')}
                </p>
            </Field>

            <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-px-3 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Los campos que se muestran como título, subtítulo, status y quick actions se configuran en "Encabezado" arriba del editor, no acá.')}
            </p>
        </div>
    );
}

function Toggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-text-xs">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
            />
            <span>{label}</span>
        </label>
    );
}

export function PropertiesGroupForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'properties_group' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'properties_group' }>>;
}): JSX.Element {
    const updateConfig = (patch: Partial<typeof block.config>): void => {
        onUpdate({ config: { ...block.config, ...patch } });
    };

    const slugSet = new Set(block.config.field_slugs);
    const available = fields.filter((f) => f.type !== 'relation' && ! slugSet.has(f.slug));
    const bySlug = new Map(fields.map((f) => [f.slug, f]));

    const move = (slug: string, dir: -1 | 1): void => {
        const slugs = [...block.config.field_slugs];
        const idx = slugs.indexOf(slug);
        const next = idx + dir;
        if (idx < 0 || next < 0 || next >= slugs.length) return;
        [slugs[idx], slugs[next]] = [slugs[next]!, slugs[idx]!];
        updateConfig({ field_slugs: slugs });
    };

    const remove = (slug: string): void => {
        updateConfig({ field_slugs: block.config.field_slugs.filter((s) => s !== slug) });
    };

    const add = (slug: string): void => {
        if (! slug) return;
        updateConfig({ field_slugs: [...block.config.field_slugs, slug] });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                <Field label={__('Nombre')}>
                    <Input
                        value={block.config.label}
                        onChange={(e) => updateConfig({ label: e.target.value })}
                    />
                </Field>
                <Field label={__('Icono')}>
                    <select
                        value={block.config.icon_key}
                        onChange={(e) => updateConfig({ icon_key: e.target.value })}
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        {SIDEBAR_ICON_OPTIONS.map((o) => (
                            <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                    </select>
                </Field>
            </div>

            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                <Field label={__('Densidad')}>
                    <select
                        value={block.config.density ?? 'compact'}
                        onChange={(e) =>
                            updateConfig({ density: e.target.value as 'compact' | 'comfortable' })
                        }
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="compact">{__('Compacta (label izquierda)')}</option>
                        <option value="comfortable">{__('Cómoda (label arriba)')}</option>
                    </select>
                </Field>
                <Field label={__('Estilo')}>
                    <select
                        value={block.config.variant ?? 'card'}
                        onChange={(e) =>
                            updateConfig({ variant: e.target.value as 'card' | 'inline' })
                        }
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="card">{__('Card con header')}</option>
                        <option value="inline">{__('Inline (sin marco)')}</option>
                    </select>
                </Field>
            </div>

            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                <input
                    type="checkbox"
                    checked={block.config.collapsed_by_default}
                    onChange={(e) => updateConfig({ collapsed_by_default: e.target.checked })}
                />
                {__('Iniciar colapsado')}
            </label>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Campos del grupo')}</Label>
                {block.config.field_slugs.length === 0 ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Vacío. Agregá campos abajo.')}
                    </p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        {block.config.field_slugs.map((slug, i) => {
                            const f = bySlug.get(slug);
                            return (
                                <SlugListItem
                                    key={slug}
                                    label={f ? f.label : slug}
                                    meta={f ? f.type : __('campo no encontrado')}
                                    canUp={i > 0}
                                    canDown={i < block.config.field_slugs.length - 1}
                                    onUp={() => move(slug, -1)}
                                    onDown={() => move(slug, 1)}
                                    onRemove={() => remove(slug)}
                                />
                            );
                        })}
                    </ul>
                )}
                <select
                    onChange={(e) => {
                        add(e.target.value);
                        e.target.value = '';
                    }}
                    disabled={available.length === 0}
                    defaultValue=""
                    className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-xs"
                >
                    <option value="">
                        {available.length === 0
                            ? __('— Sin campos disponibles —')
                            : __('+ Agregar campo…')}
                    </option>
                    {available.map((f) => (
                        <option key={f.id} value={f.slug}>
                            {f.label} ({f.type})
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}

export function NotesForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'notes' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'notes' }>>;
}): JSX.Element {
    const [draft, setDraft] = useState(block.config);

    useEffect(() => {
        setDraft(block.config);
    }, [block.config]);

    const commit = (): void => {
        onUpdate({ config: draft });
    };

    const textFields = fields.filter((f) => f.type === 'long_text' || f.type === 'text');
    const source = draft.source ?? 'literal';

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título')}>
                <Input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    onBlur={commit}
                    placeholder={__('Ej. Recordatorios')}
                />
            </Field>
            <Field label={__('Origen del contenido')}>
                <select
                    value={source}
                    onChange={(e) => {
                        const next = { ...draft, source: e.target.value as 'literal' | 'field' };
                        setDraft(next);
                        onUpdate({ config: next });
                    }}
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="literal">{__('Texto fijo (igual para todos los registros)')}</option>
                    <option value="field">{__('Campo del registro (varía por registro)')}</option>
                </select>
            </Field>
            {source === 'literal' ? (
                <Field label={__('Contenido')}>
                    <Textarea
                        rows={6}
                        value={draft.content}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                        onBlur={commit}
                        placeholder={__('Texto que verán todos en esta lista. Saltos de línea respetados.')}
                    />
                </Field>
            ) : (
                <Field label={__('Campo de texto a mostrar')}>
                    <select
                        value={draft.field_slug ?? ''}
                        onChange={(e) => {
                            const next = { ...draft, field_slug: e.target.value || undefined };
                            setDraft(next);
                            onUpdate({ config: next });
                        }}
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="">{__('— Elegir campo —')}</option>
                        {textFields.map((f) => (
                            <option key={f.id} value={f.slug}>
                                {f.label} ({f.type})
                            </option>
                        ))}
                    </select>
                    {textFields.length === 0 && (
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('No hay campos de texto en esta lista. Agregá uno tipo "Texto" o "Texto largo".')}
                        </p>
                    )}
                </Field>
            )}
        </div>
    );
}

export function RelatedForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'related' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'related' }>>;
}): JSX.Element {
    const relations = fields.filter((f) => f.type === 'relation');

    if (relations.length === 0) {
        return (
            <p className="imcrm-rounded-md imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-warning">
                {__('Esta lista no tiene relation fields. Eliminá este bloque o creá un campo tipo relation primero.')}
            </p>
        );
    }

    return (
        <Field label={__('Relation field')}>
            <select
                value={block.config.field_slug}
                onChange={(e) => onUpdate({ config: { field_slug: e.target.value } })}
                className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
            >
                {relations.map((f) => (
                    <option key={f.id} value={f.slug}>
                        {f.label}
                    </option>
                ))}
            </select>
        </Field>
    );
}

export function KpiForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'kpi' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'kpi' }>>;
}): JSX.Element {
    const updateConfig = (patch: Partial<typeof block.config>): void => {
        onUpdate({ config: { ...block.config, ...patch } });
    };
    const numericFields = fields.filter((f) => f.type === 'number' || f.type === 'currency');

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Campo numérico')}>
                <select
                    value={block.config.field_slug}
                    onChange={(e) => updateConfig({ field_slug: e.target.value })}
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="">{__('— Sin field —')}</option>
                    {numericFields.map((f) => (
                        <option key={f.id} value={f.slug}>{f.label} ({f.type})</option>
                    ))}
                </select>
            </Field>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                <Field label={__('Label (opcional)')}>
                    <Input
                        value={block.config.label ?? ''}
                        onChange={(e) => updateConfig({ label: e.target.value || undefined })}
                        placeholder={__('Ej. "Monto total"')}
                    />
                </Field>
                <Field label={__('Formato')}>
                    <select
                        value={block.config.format ?? 'number'}
                        onChange={(e) => updateConfig({ format: e.target.value as 'number' | 'currency' | 'percent' })}
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="number">{__('Número')}</option>
                        <option value="currency">{__('Moneda')}</option>
                        <option value="percent">{__('Porcentaje')}</option>
                    </select>
                </Field>
            </div>
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-3">
                <Field label={__('Prefijo')}>
                    <Input
                        value={block.config.prefix ?? ''}
                        onChange={(e) => updateConfig({ prefix: e.target.value || undefined })}
                    />
                </Field>
                <Field label={__('Sufijo')}>
                    <Input
                        value={block.config.suffix ?? ''}
                        onChange={(e) => updateConfig({ suffix: e.target.value || undefined })}
                    />
                </Field>
                <Field label={__('Meta (opcional)')}>
                    <Input
                        type="number"
                        value={block.config.goal_value ?? ''}
                        onChange={(e) => updateConfig({ goal_value: e.target.value === '' ? undefined : Number(e.target.value) })}
                    />
                </Field>
            </div>
        </div>
    );
}

export function ChartForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'chart' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'chart' }>>;
}): JSX.Element {
    const updateConfig = (patch: Partial<typeof block.config>): void => {
        onUpdate({ config: { ...block.config, ...patch } });
    };
    const relations = fields.filter((f) => f.type === 'relation');

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Relation field')}>
                <select
                    value={block.config.relation_field_slug}
                    onChange={(e) => updateConfig({ relation_field_slug: e.target.value })}
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="">{__('— Elegí —')}</option>
                    {relations.map((f) => (
                        <option key={f.id} value={f.slug}>{f.label}</option>
                    ))}
                </select>
                {relations.length === 0 && (
                    <p className="imcrm-text-[11px] imcrm-text-warning">
                        {__('Esta lista no tiene relation fields. Creá uno primero.')}
                    </p>
                )}
            </Field>
            <Field label={__('Field de agrupación (slug en lista destino)')}>
                <Input
                    value={block.config.group_by_field_slug}
                    onChange={(e) => updateConfig({ group_by_field_slug: e.target.value })}
                    placeholder={__('Ej. status, etapa, prioridad')}
                />
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Slug del field en la lista destino por el cual agrupar (ideal: select / multi_select).')}
                </p>
            </Field>
            <Field label={__('Título (opcional)')}>
                <Input
                    value={block.config.title ?? ''}
                    onChange={(e) => updateConfig({ title: e.target.value || undefined })}
                />
            </Field>
        </div>
    );
}

export function FilesForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'files' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'files' }>>;
}): JSX.Element {
    const fileFields = fields.filter((f) => f.type === 'file');

    if (fileFields.length === 0) {
        return (
            <p className="imcrm-text-xs imcrm-text-warning">
                {__('Esta lista no tiene fields de tipo file. Creá uno primero.')}
            </p>
        );
    }

    const toggle = (slug: string): void => {
        const current = block.config.file_field_slugs;
        const next = current.includes(slug)
            ? current.filter((s) => s !== slug)
            : [...current, slug];
        onUpdate({ config: { ...block.config, file_field_slugs: next } });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título')}>
                <Input
                    value={block.config.title ?? ''}
                    onChange={(e) => onUpdate({ config: { ...block.config, title: e.target.value || undefined } })}
                    placeholder={__('Archivos')}
                />
            </Field>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Fields a mostrar')}</Label>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Vacío = todos los file fields. Seleccioná específicos para limitar.')}
                </p>
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    {fileFields.map((f) => (
                        <li key={f.id}>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                <input
                                    type="checkbox"
                                    checked={block.config.file_field_slugs.includes(f.slug)}
                                    onChange={() => toggle(f.slug)}
                                />
                                {f.label}
                            </label>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

export function EmbedForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'embed' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'embed' }>>;
}): JSX.Element {
    const updateConfig = (patch: Partial<typeof block.config>): void => {
        onUpdate({ config: { ...block.config, ...patch } });
    };
    const urlFields = fields.filter((f) => f.type === 'url');

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Fuente del URL')}</Label>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-text-xs">
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                        <input
                            type="radio"
                            name="embed-source"
                            checked={block.config.source === 'literal'}
                            onChange={() => updateConfig({ source: 'literal' })}
                        />
                        {__('URL fijo')}
                    </label>
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                        <input
                            type="radio"
                            name="embed-source"
                            checked={block.config.source === 'field'}
                            onChange={() => updateConfig({ source: 'field' })}
                        />
                        {__('Desde un field URL del record')}
                    </label>
                </div>
            </div>
            {block.config.source === 'literal' ? (
                <Field label={__('URL')}>
                    <Input
                        value={block.config.url ?? ''}
                        onChange={(e) => updateConfig({ url: e.target.value })}
                        placeholder="https://www.youtube.com/embed/..."
                    />
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Solo se permiten: YouTube, Vimeo, Google Maps, Loom, Figma, Calendly.')}
                    </p>
                </Field>
            ) : (
                <Field label={__('Field URL')}>
                    <select
                        value={block.config.field_slug ?? ''}
                        onChange={(e) => updateConfig({ field_slug: e.target.value })}
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="">{__('— Elegí —')}</option>
                        {urlFields.map((f) => (
                            <option key={f.id} value={f.slug}>{f.label}</option>
                        ))}
                    </select>
                    {urlFields.length === 0 && (
                        <p className="imcrm-text-[11px] imcrm-text-warning">
                            {__('No hay fields tipo url en esta lista.')}
                        </p>
                    )}
                </Field>
            )}
            <Field label={__('Título (opcional)')}>
                <Input
                    value={block.config.title ?? ''}
                    onChange={(e) => updateConfig({ title: e.target.value || undefined })}
                />
            </Field>
        </div>
    );
}

export function ActionButtonForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'action_button' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'action_button' }>>;
}): JSX.Element {
    const updateConfig = (patch: Partial<typeof block.config>): void => {
        onUpdate({ config: { ...block.config, ...patch } });
    };

    const targetSource = block.config.target_source ?? 'literal';
    // Filtramos los campos candidatos según el `action_type` — emails
    // van con email fields, urls con url fields, etc. `copy` y `tel`
    // aceptan cualquier campo de texto/número.
    const candidateFields = (() => {
        const at = block.config.action_type;
        if (at === 'mailto') return fields.filter((f) => f.type === 'email');
        if (at === 'url') return fields.filter((f) => f.type === 'url');
        if (at === 'tel') return fields.filter((f) => f.type === 'text' || f.type === 'number');
        return fields.filter((f) =>
            ['text', 'long_text', 'email', 'url', 'number', 'currency'].includes(f.type),
        );
    })();

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Label del botón')}>
                <Input
                    value={block.config.label}
                    onChange={(e) => updateConfig({ label: e.target.value })}
                    placeholder={__('Ej. "Llamar"')}
                />
            </Field>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                <Field label={__('Tipo')}>
                    <select
                        value={block.config.action_type}
                        onChange={(e) => updateConfig({ action_type: e.target.value as 'url' | 'mailto' | 'tel' | 'copy' })}
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="url">{__('URL externa')}</option>
                        <option value="mailto">{__('Email (mailto:)')}</option>
                        <option value="tel">{__('Teléfono (tel:)')}</option>
                        <option value="copy">{__('Copiar al clipboard')}</option>
                    </select>
                </Field>
                <Field label={__('Variante')}>
                    <select
                        value={block.config.variant ?? 'default'}
                        onChange={(e) => updateConfig({ variant: e.target.value as 'default' | 'outline' | 'destructive' })}
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="default">{__('Primario')}</option>
                        <option value="outline">{__('Outline')}</option>
                        <option value="destructive">{__('Destructivo')}</option>
                    </select>
                </Field>
            </div>
            <Field label={__('Origen del target')}>
                <select
                    value={targetSource}
                    onChange={(e) =>
                        updateConfig({ target_source: e.target.value as 'literal' | 'field' })
                    }
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="literal">{__('Valor fijo (igual para todos)')}</option>
                    <option value="field">{__('Campo del registro (varía por registro)')}</option>
                </select>
            </Field>
            {targetSource === 'literal' ? (
                <Field label={__('Target')}>
                    <Input
                        value={block.config.target}
                        onChange={(e) => updateConfig({ target: e.target.value })}
                        placeholder={
                            block.config.action_type === 'url' ? 'https://…' :
                            block.config.action_type === 'mailto' ? 'foo@bar.com' :
                            block.config.action_type === 'tel' ? '+57 300 1234567' :
                            __('Texto a copiar')
                        }
                    />
                </Field>
            ) : (
                <Field label={__('Campo del registro')}>
                    <select
                        value={block.config.target_field_slug ?? ''}
                        onChange={(e) =>
                            updateConfig({ target_field_slug: e.target.value || undefined })
                        }
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="">{__('— Elegir campo —')}</option>
                        {candidateFields.map((f) => (
                            <option key={f.id} value={f.slug}>
                                {f.label} ({f.type})
                            </option>
                        ))}
                    </select>
                    {candidateFields.length === 0 && (
                        <p className="imcrm-text-[11px] imcrm-text-warning">
                            {__('No hay campos compatibles con este tipo de acción en la lista.')}
                        </p>
                    )}
                </Field>
            )}
        </div>
    );
}

export function DividerForm({
    block,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'divider' }>;
    onUpdate: UpdateFn<Extract<V2Block, { type: 'divider' }>>;
}): JSX.Element {
    return (
        <Field label={__('Label (opcional)')}>
            <Input
                value={block.config.label ?? ''}
                onChange={(e) => onUpdate({ config: { label: e.target.value || undefined } })}
                placeholder={__('Vacío = línea sola')}
            />
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Si está vacío, se renderea como una línea horizontal simple. Con texto, aparece centrado entre dos líneas.')}
            </p>
        </Field>
    );
}

export function HeadingForm({
    block,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'heading' }>;
    onUpdate: UpdateFn<Extract<V2Block, { type: 'heading' }>>;
}): JSX.Element {
    const updateConfig = (patch: Partial<typeof block.config>): void => {
        onUpdate({ config: { ...block.config, ...patch } });
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Texto')}>
                <Input
                    value={block.config.text}
                    onChange={(e) => updateConfig({ text: e.target.value })}
                    placeholder={__('Ej. "Información comercial"')}
                />
            </Field>
            <Field label={__('Nivel jerárquico')}>
                <select
                    value={block.config.level}
                    onChange={(e) => updateConfig({ level: Number(e.target.value) as 2 | 3 | 4 })}
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value={2}>{__('H2 — Título grande')}</option>
                    <option value={3}>{__('H3 — Subtítulo')}</option>
                    <option value={4}>{__('H4 — Etiqueta pequeña')}</option>
                </select>
            </Field>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────
//  Stats block form
// ─────────────────────────────────────────────────────────────────────

const AUTO_METRICS: Array<{
    value: 'days_in_system' | 'days_since_changes' | 'comments' | 'changes';
    label: string;
}> = [
    { value: 'days_in_system', label: 'Días en sistema' },
    { value: 'days_since_changes', label: 'Días sin cambios' },
    { value: 'comments', label: 'Comentarios' },
    { value: 'changes', label: 'Cambios' },
];

type StatsItem =
    | { kind: 'auto'; metric: 'days_in_system' | 'days_since_changes' | 'comments' | 'changes' }
    | { kind: 'field'; field_slug: string; label?: string };

export function StatsForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'stats' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'stats' }>>;
}): JSX.Element {
    const mode = block.config.mode ?? 'auto';
    const items: StatsItem[] = block.config.items ?? [];

    const updateConfig = (patch: Partial<typeof block.config>): void => {
        onUpdate({ config: { ...block.config, ...patch } });
    };

    type AutoMetric = 'days_in_system' | 'days_since_changes' | 'comments' | 'changes';
    const addAuto = (metric: AutoMetric): void => {
        updateConfig({ items: [...items, { kind: 'auto', metric }] });
    };
    const addField = (field_slug: string): void => {
        if (! field_slug) return;
        updateConfig({ items: [...items, { kind: 'field', field_slug }] });
    };
    const remove = (idx: number): void => {
        updateConfig({ items: items.filter((_, i) => i !== idx) });
    };
    const move = (idx: number, dir: -1 | 1): void => {
        const next = [...items];
        const target = idx + dir;
        if (target < 0 || target >= next.length) return;
        [next[idx], next[target]] = [next[target]!, next[idx]!];
        updateConfig({ items: next });
    };
    const updateLabel = (idx: number, label: string): void => {
        const next = [...items];
        const it = next[idx];
        if (it && it.kind === 'field') {
            next[idx] = { ...it, label: label || undefined };
            updateConfig({ items: next });
        }
    };

    const fieldsBySlug = new Map(fields.map((f) => [f.slug, f]));
    const availableFields = fields.filter((f) =>
        ['number', 'currency', 'date', 'datetime', 'checkbox', 'select', 'text'].includes(f.type),
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Modo')}>
                <select
                    value={mode}
                    onChange={(e) =>
                        updateConfig({ mode: e.target.value as 'auto' | 'custom' })
                    }
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="auto">{__('Automático (métricas estándar)')}</option>
                    <option value="custom">{__('Personalizado (elegí qué mostrar)')}</option>
                </select>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {mode === 'auto'
                        ? __('Muestra: días en sistema, días sin cambios, comentarios y cambios.')
                        : __('Combiná métricas automáticas con valores de campos del registro.')}
                </p>
            </Field>

            {mode === 'custom' && (
                <>
                    <Field label={__('Métricas visibles')}>
                        {items.length === 0 ? (
                            <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Sin métricas. Agregá una abajo.')}
                            </p>
                        ) : (
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                {items.map((it, i) => {
                                    const label =
                                        it.kind === 'auto'
                                            ? AUTO_METRICS.find((m) => m.value === it.metric)?.label
                                            : (it.label || fieldsBySlug.get(it.field_slug)?.label || it.field_slug);
                                    const meta =
                                        it.kind === 'auto'
                                            ? __('auto')
                                            : (fieldsBySlug.get(it.field_slug)?.type ?? __('campo no encontrado'));
                                    return (
                                        <li
                                            key={i}
                                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1.5"
                                        >
                                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                                {it.kind === 'field' ? (
                                                    <Input
                                                        value={it.label ?? ''}
                                                        onChange={(e) => updateLabel(i, e.target.value)}
                                                        placeholder={label}
                                                        className="imcrm-h-7 imcrm-text-xs"
                                                    />
                                                ) : (
                                                    <span className="imcrm-text-xs imcrm-font-medium">{label}</span>
                                                )}
                                                <span className="imcrm-ml-2 imcrm-text-[10px] imcrm-text-muted-foreground">
                                                    {meta}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => move(i, -1)}
                                                disabled={i === 0}
                                                className="imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30"
                                                title={__('Subir')}
                                            >
                                                <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => move(i, 1)}
                                                disabled={i === items.length - 1}
                                                className="imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30"
                                                title={__('Bajar')}
                                            >
                                                <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => remove(i)}
                                                className="imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                                title={__('Eliminar')}
                                            >
                                                <X className="imcrm-h-3 imcrm-w-3" />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Field>

                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <select
                            onChange={(e) => {
                                if (e.target.value) {
                                    addAuto(e.target.value as 'days_in_system' | 'days_since_changes' | 'comments' | 'changes');
                                    e.target.value = '';
                                }
                            }}
                            defaultValue=""
                            className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-xs"
                        >
                            <option value="">{__('+ Métrica automática…')}</option>
                            {AUTO_METRICS.map((m) => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                        <select
                            onChange={(e) => {
                                if (e.target.value) {
                                    addField(e.target.value);
                                    e.target.value = '';
                                }
                            }}
                            disabled={availableFields.length === 0}
                            defaultValue=""
                            className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-xs"
                        >
                            <option value="">
                                {availableFields.length === 0
                                    ? __('— Sin campos —')
                                    : __('+ Valor de campo…')}
                            </option>
                            {availableFields.map((f) => (
                                <option key={f.id} value={f.slug}>
                                    {f.label} ({f.type})
                                </option>
                            ))}
                        </select>
                    </div>
                </>
            )}
        </div>
    );
}

export function CommentsThreadForm({
    block,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'comments_thread' }>;
    onUpdate: UpdateFn<Extract<V2Block, { type: 'comments_thread' }>>;
}): JSX.Element {
    return (
        <Field label={__('Título (opcional)')}>
            <Input
                value={block.config.title ?? ''}
                onChange={(e) => onUpdate({ config: { title: e.target.value || undefined } })}
                placeholder={__('Comentarios')}
            />
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('El hilo lista los comentarios del record actual. En el editor se ve read-only; en el panel CRM real es interactivo.')}
            </p>
        </Field>
    );
}

export function MarkdownForm({
    block,
    fields,
    onUpdate,
}: {
    block: Extract<V2Block, { type: 'markdown' }>;
    fields: FieldEntity[];
    onUpdate: UpdateFn<Extract<V2Block, { type: 'markdown' }>>;
}): JSX.Element {
    const [draft, setDraft] = useState(block.config);

    useEffect(() => {
        setDraft(block.config);
    }, [block.config]);

    const commit = (): void => onUpdate({ config: draft });

    const textFields = fields.filter((f) => f.type === 'long_text' || f.type === 'text');
    const source = draft.source ?? 'literal';

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título')}>
                <Input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    onBlur={commit}
                />
            </Field>
            <Field label={__('Origen del contenido')}>
                <select
                    value={source}
                    onChange={(e) => {
                        const next = { ...draft, source: e.target.value as 'literal' | 'field' };
                        setDraft(next);
                        onUpdate({ config: next });
                    }}
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="literal">{__('Markdown fijo (igual para todos)')}</option>
                    <option value="field">{__('Campo del registro (varía por registro)')}</option>
                </select>
            </Field>
            {source === 'literal' ? (
                <Field label={__('Contenido (markdown)')}>
                    <Textarea
                        rows={8}
                        value={draft.content}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                        onBlur={commit}
                        placeholder={'# Título\n## Sub\n- item\n**bold** *itálica* `code` [link](https://...)'}
                    />
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Markdown ligero: # ## ### · - · 1. · **bold** · *italic* · `code` · [link](url)')}
                    </p>
                </Field>
            ) : (
                <Field label={__('Campo de texto a renderear como markdown')}>
                    <select
                        value={draft.field_slug ?? ''}
                        onChange={(e) => {
                            const next = { ...draft, field_slug: e.target.value || undefined };
                            setDraft(next);
                            onUpdate({ config: next });
                        }}
                        className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="">{__('— Elegir campo —')}</option>
                        {textFields.map((f) => (
                            <option key={f.id} value={f.slug}>
                                {f.label} ({f.type})
                            </option>
                        ))}
                    </select>
                    {textFields.length === 0 && (
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('No hay campos de texto en esta lista.')}
                        </p>
                    )}
                </Field>
            )}
        </div>
    );
}

// --- helpers compartidos -----------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label className="imcrm-text-xs">{label}</Label>
            {children}
        </div>
    );
}

function SlugListItem({
    label,
    meta,
    canUp,
    canDown,
    onUp,
    onDown,
    onRemove,
}: {
    label: string;
    meta: string;
    canUp: boolean;
    canDown: boolean;
    onUp: () => void;
    onDown: () => void;
    onRemove: () => void;
}): JSX.Element {
    return (
        <li className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs">
            <span className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-overflow-hidden">
                <span className="imcrm-truncate imcrm-font-medium">{label}</span>
                <span className="imcrm-truncate imcrm-text-[10px] imcrm-text-muted-foreground">{meta}</span>
            </span>
            <button
                type="button"
                onClick={onUp}
                disabled={! canUp}
                className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30"
                aria-label={__('Subir')}
            >
                <ArrowUp className="imcrm-h-3 imcrm-w-3" />
            </button>
            <button
                type="button"
                onClick={onDown}
                disabled={! canDown}
                className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30"
                aria-label={__('Bajar')}
            >
                <ArrowDown className="imcrm-h-3 imcrm-w-3" />
            </button>
            <button
                type="button"
                onClick={onRemove}
                className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                aria-label={__('Quitar')}
            >
                <X className="imcrm-h-3 imcrm-w-3" />
            </button>
        </li>
    );
}
