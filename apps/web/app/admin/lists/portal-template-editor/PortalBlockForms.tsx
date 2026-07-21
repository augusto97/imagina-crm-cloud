import { ArrowDown, ArrowUp, X } from 'lucide-react';

import { ColorPicker, type OptionColor } from '@/components/ui/color-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLists } from '@/hooks/useLists';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { GalleryBlockForm, ImageBlockForm, SpacerBlockForm } from '@/admin/template-editor-core/ImageBlockForm';

import type { ResolvedPortalBlock } from './portalLayout';

interface FormProps {
    block: ResolvedPortalBlock;
    fields: FieldEntity[];
    onConfigChange: (config: Record<string, unknown>) => void;
}

/**
 * Forms del inspector — uno por tipo. Las **keys core** del config
 * matchean el shape que el bundle público (`PortalBlock`) espera leer.
 * Las keys adicionales (`variant`, `accent_color`) son aditivas — el
 * bundle las ignora hasta que cada block component se actualice.
 *
 * Forms agregan:
 *  - **Variante** visual cuando el bloque la soporta.
 *  - **Título** custom.
 *  - **Field pickers reales** en lugar de `<input type="text">` con CSVs.
 *  - **Color de acento** donde aplica.
 */
export function PortalBlockForm({ block, fields, onConfigChange }: FormProps): JSX.Element {
    const specific = ((): JSX.Element => {
        switch (block.type) {
            case 'static_text':
                return <StaticTextForm config={block.config} onChange={onConfigChange} />;
            case 'client_data':
                return <ClientDataForm config={block.config} fields={fields} onChange={onConfigChange} />;
            case 'related_records_table':
                return <RelatedRecordsForm config={block.config} onChange={onConfigChange} />;
            case 'editable_form':
                return <EditableFormConfig config={block.config} fields={fields} onChange={onConfigChange} />;
            case 'external_link':
                return <ExternalLinkForm config={block.config} onChange={onConfigChange} />;
            case 'kpi_widget':
                return <KpiForm config={block.config} onChange={onConfigChange} />;
            case 'activity_timeline':
                return <ActivityForm config={block.config} onChange={onConfigChange} />;
            case 'download_files':
                return <DownloadFilesForm config={block.config} fields={fields} onChange={onConfigChange} />;
            case 'comments_thread':
                return <CommentsForm config={block.config} onChange={onConfigChange} />;
            // 0.57.0 — bloques UX/jerarquía
            case 'heading':
                return <HeadingForm config={block.config} onChange={onConfigChange} />;
            case 'hero':
                return <HeroForm config={block.config} onChange={onConfigChange} />;
            case 'stats_grid':
                return <StatsGridForm config={block.config} onChange={onConfigChange} />;
            case 'quick_actions':
                return <QuickActionsForm config={block.config} onChange={onConfigChange} />;
            case 'notice':
                return <NoticeForm config={block.config} onChange={onConfigChange} />;
            case 'divider':
                return <DividerForm config={block.config} onChange={onConfigChange} />;
            case 'faq':
                return <FaqForm config={block.config} onChange={onConfigChange} />;
            case 'contact_card':
                return <ContactCardForm config={block.config} onChange={onConfigChange} />;
            case 'image':
                return <ImageBlockForm config={block.config} onConfigChange={onConfigChange} />;
            case 'spacer':
                return <SpacerBlockForm config={block.config} onConfigChange={onConfigChange} />;
            case 'gallery':
                return <GalleryBlockForm config={block.config} onConfigChange={onConfigChange} />;
            case 'nested_section':
                // Las sub-columnas y sub-bloques se gestionan directamente
                // EN EL CANVAS (drag desde paleta, drag-and-drop entre
                // niveles, ↑/↓/× en cada sub-bloque). Acá no hay opciones
                // del nested_section "como tal".
                return (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Gestioná las sub-columnas y los sub-bloques directamente en el canvas: arrastrá bloques de la paleta a las sub-columnas, click en un sub-bloque para editar sus opciones, y usá los botones ↑/↓/× del sub-bloque para reordenar o eliminar.')}
                    </p>
                );
        }
    })();
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            {specific}
            <MaxHeightField config={block.config} onChange={onConfigChange} />
        </div>
    );
}

/**
 * Campo común a todos los bloques. Si se setea un valor numérico,
 * el bloque en el front respeta esa altura máxima y aplica scroll
 * interno cuando el contenido la excede. Si está vacío, el bloque
 * crece según contenido sin tope (default desde 0.57.2).
 */
function MaxHeightField({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const current = typeof config.max_height === 'number' ? config.max_height : '';
    return (
        <details className="imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2">
            <summary className="imcrm-cursor-pointer imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                {__('Avanzado — altura máxima')}
            </summary>
            <div className="imcrm-mt-2">
                <Field label={__('Altura máxima (px)')}>
                    <Input
                        type="number"
                        min={0}
                        value={current}
                        onChange={(e) => {
                            const raw = e.target.value;
                            const num = raw === '' ? null : Number(raw);
                            const next = { ...config };
                            if (num === null || ! Number.isFinite(num) || num <= 0) {
                                delete next.max_height;
                            } else {
                                next.max_height = Math.floor(num);
                            }
                            onChange(next);
                        }}
                        placeholder={__('Vacío = sin tope')}
                    />
                    <Hint>
                        {__('Si lo dejás vacío el bloque crece según contenido. Si ponés un valor, se aplica scroll interno cuando se excede.')}
                    </Hint>
                </Field>
            </div>
        </details>
    );
}

// ─── static_text ──────────────────────────────────────────────────────

function StaticTextForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const html = typeof config.html === 'string' ? config.html : '';
    const title = (config.title as string) ?? '';
    const variant = (config.variant as string) ?? 'card';
    const accent = (config.accent_color as string | null) ?? null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título (opcional)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Ej. "Bienvenido"')}
                />
            </Field>
            <VariantPicker
                value={variant}
                onChange={(v) => onChange({ ...config, variant: v })}
                options={[
                    { value: 'card', label: __('Card con borde') },
                    { value: 'plain', label: __('Sin marco') },
                    { value: 'bordered_left', label: __('Borde izquierdo de acento') },
                ]}
            />
            {variant === 'bordered_left' && (
                <AccentColorField
                    value={accent}
                    onChange={(v) => onChange({ ...config, accent_color: v })}
                />
            )}
            <Field label={__('Contenido (HTML básico)')}>
                <Textarea
                    rows={6}
                    value={html}
                    onChange={(e) => onChange({ ...config, html: e.target.value })}
                    placeholder={__('<p>Bienvenido a tu portal…</p>')}
                />
                <Hint>
                    {__('Tags permitidos: <p>, <strong>, <em>, <a>, <ul>, <ol>, <li>, <br>.')}
                </Hint>
            </Field>
        </div>
    );
}

// ─── client_data ──────────────────────────────────────────────────────

function ClientDataForm({
    config,
    fields,
    onChange,
}: {
    config: Record<string, unknown>;
    fields: FieldEntity[];
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const slugs = Array.isArray(config.visible_field_slugs)
        ? (config.visible_field_slugs as unknown[]).map(String)
        : [];
    const title = (config.title as string) ?? '';
    const variant = (config.variant as string) ?? 'definition_list';

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título (opcional)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Datos del cliente')}
                />
            </Field>
            <VariantPicker
                value={variant}
                onChange={(v) => onChange({ ...config, variant: v })}
                options={[
                    { value: 'definition_list', label: __('Lista — label izq / valor der') },
                    { value: 'cards', label: __('Cards — grid 2 columnas') },
                ]}
            />
            <FieldSlugMultiPicker
                label={__('Campos visibles')}
                value={slugs}
                onChange={(next) => onChange({ ...config, visible_field_slugs: next })}
                options={fields.filter((f) => f.type !== 'relation' && f.type !== 'file')}
                placeholder={__('Agregar campo…')}
            />
        </div>
    );
}

// ─── related_records_table ────────────────────────────────────────────

function RelatedRecordsForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const lists = useLists();
    const listSlug = (config.list_slug as string) ?? '';
    const cols = Array.isArray(config.visible_field_slugs)
        ? (config.visible_field_slugs as unknown[]).map(String)
        : [];
    const perPage = (config.per_page as number) ?? 10;
    const variant = (config.variant as string) ?? 'table';
    const title = (config.title as string) ?? '';

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título (opcional)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Registros relacionados')}
                />
            </Field>
            <VariantPicker
                value={variant}
                onChange={(v) => onChange({ ...config, variant: v })}
                options={[
                    { value: 'table', label: __('Tabla completa') },
                    { value: 'compact_list', label: __('Lista compacta') },
                ]}
            />
            <Field label={__('Lista relacionada')}>
                <Select
                    value={listSlug}
                    onChange={(e) => onChange({ ...config, list_slug: e.target.value })}
                >
                    <option value="">{__('— Elegir lista —')}</option>
                    {(lists.data ?? []).map((l) => (
                        <option key={l.id} value={l.slug}>{l.name}</option>
                    ))}
                </Select>
                <Hint>
                    {__('Los records de esta lista se filtran por scope del portal — el cliente solo ve los suyos.')}
                </Hint>
            </Field>
            <Field label={__('Columnas visibles (slugs)')}>
                <Input
                    value={cols.join(', ')}
                    onChange={(e) => {
                        const next = e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter((s) => s !== '');
                        onChange({ ...config, visible_field_slugs: next });
                    }}
                    placeholder={__('Ej. fecha, monto, estado')}
                />
                <Hint>
                    {__('Slugs separados por coma de los campos de la lista elegida arriba.')}
                </Hint>
            </Field>
            <Field label={__('Máximo registros por página')}>
                <Input
                    type="number"
                    min={1}
                    max={50}
                    value={perPage}
                    onChange={(e) => onChange({ ...config, per_page: Number(e.target.value) })}
                />
            </Field>
        </div>
    );
}

// ─── editable_form ────────────────────────────────────────────────────

function EditableFormConfig({
    config,
    fields,
    onChange,
}: {
    config: Record<string, unknown>;
    fields: FieldEntity[];
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const slugs = Array.isArray(config.editable_field_slugs)
        ? (config.editable_field_slugs as unknown[]).map(String)
        : [];
    const submitLabel = (config.submit_label as string) ?? 'Guardar';
    const title = (config.title as string) ?? '';

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título del formulario')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Actualizar mis datos')}
                />
            </Field>
            <FieldSlugMultiPicker
                label={__('Campos editables')}
                value={slugs}
                onChange={(next) => onChange({ ...config, editable_field_slugs: next })}
                options={fields.filter(
                    (f) => f.type !== 'relation' && f.type !== 'file' && f.type !== 'computed',
                )}
                placeholder={__('Agregar campo…')}
            />
            <Field label={__('Texto del botón')}>
                <Input
                    value={submitLabel}
                    onChange={(e) => onChange({ ...config, submit_label: e.target.value })}
                    placeholder="Guardar"
                />
            </Field>
        </div>
    );
}

// ─── external_link ────────────────────────────────────────────────────

function ExternalLinkForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const title = (config.title as string) ?? '';
    const description = (config.description as string) ?? '';
    const label = (config.label as string) ?? '';
    const href = (config.href as string) ?? '';
    const newWindow = config.new_window !== false;
    const variant = (config.variant as string) ?? 'button';
    const accent = (config.accent_color as string | null) ?? null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <VariantPicker
                value={variant}
                onChange={(v) => onChange({ ...config, variant: v })}
                options={[
                    { value: 'button', label: __('Botón centrado') },
                    { value: 'card_cta', label: __('Card con icono + descripción') },
                    { value: 'hero_cta', label: __('Hero CTA — banner ancho destacado') },
                ]}
            />
            <Field label={__('Título (visible solo en variante card)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Ej. "Pagar factura"')}
                />
            </Field>
            <Field label={__('Descripción (visible solo en variante card)')}>
                <Input
                    value={description}
                    onChange={(e) => onChange({ ...config, description: e.target.value })}
                    placeholder={__('Texto secundario opcional')}
                />
            </Field>
            <Field label={__('Texto del botón')}>
                <Input
                    value={label}
                    onChange={(e) => onChange({ ...config, label: e.target.value })}
                    placeholder={__('Ej. "Abrir"')}
                />
            </Field>
            <Field label={__('URL destino')}>
                <Input
                    type="url"
                    value={href}
                    onChange={(e) => onChange({ ...config, href: e.target.value })}
                    placeholder="https://…"
                />
            </Field>
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-cursor-pointer">
                <input
                    type="checkbox"
                    checked={newWindow}
                    onChange={(e) => onChange({ ...config, new_window: e.target.checked })}
                />
                {__('Abrir en pestaña nueva')}
            </label>
            <AccentColorField
                value={accent}
                onChange={(v) => onChange({ ...config, accent_color: v })}
            />
        </div>
    );
}

// ─── kpi_widget ───────────────────────────────────────────────────────

function KpiForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const lists = useLists();
    const listSlug = (config.list_slug as string) ?? '';
    const fieldId = (config.field_id as number) ?? 0;
    const metric = (config.metric as string) ?? 'count';
    const title = (config.title as string) ?? '';
    const prefix = (config.prefix as string) ?? '';
    const suffix = (config.suffix as string) ?? '';
    const variant = (config.variant as string) ?? 'card';
    const accent = (config.accent_color as string | null) ?? null;
    const icon = (config.icon as string) ?? '';
    const trendText = (config.trend_text as string) ?? '';
    const trendDirection = (config.trend_direction as string) ?? 'neutral';

    // Necesitamos los fields de la lista elegida (no de la lista actual)
    // — pero `useFields` requiere un listId. Buscamos el id por slug.
    const targetList = (lists.data ?? []).find((l) => l.slug === listSlug);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <VariantPicker
                value={variant}
                onChange={(v) => onChange({ ...config, variant: v })}
                options={[
                    { value: 'card', label: __('Card con número grande') },
                    { value: 'inline', label: __('Inline — label + valor en línea') },
                ]}
            />
            <Field label={__('Título (opcional)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Ej. "Total facturado"')}
                />
            </Field>
            <Field label={__('Lista a agregar')}>
                <Select
                    value={listSlug}
                    onChange={(e) => onChange({ ...config, list_slug: e.target.value })}
                >
                    <option value="">{__('— Elegir lista —')}</option>
                    {(lists.data ?? []).map((l) => (
                        <option key={l.id} value={l.slug}>{l.name}</option>
                    ))}
                </Select>
            </Field>
            <Field label={__('Métrica')}>
                <Select
                    value={metric}
                    onChange={(e) => onChange({ ...config, metric: e.target.value })}
                >
                    <option value="count">{__('Contar registros')}</option>
                    <option value="sum">{__('Suma')}</option>
                    <option value="avg">{__('Promedio')}</option>
                    <option value="min">{__('Mínimo')}</option>
                    <option value="max">{__('Máximo')}</option>
                </Select>
            </Field>
            {metric !== 'count' && (
                <Field label={__('Campo numérico a agregar')}>
                    <Input
                        type="number"
                        min={0}
                        value={fieldId}
                        onChange={(e) => onChange({ ...config, field_id: Number(e.target.value) })}
                        placeholder={__('ID del campo')}
                    />
                    <Hint variant={targetList ? 'default' : 'warning'}>
                        {targetList
                            ? __('Buscá el ID del campo numérico en la lista elegida.')
                            : __('Elegí primero la lista arriba.')}
                    </Hint>
                </Field>
            )}
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Field label={__('Prefijo')}>
                    <Input
                        value={prefix}
                        onChange={(e) => onChange({ ...config, prefix: e.target.value })}
                        placeholder="$"
                    />
                </Field>
                <Field label={__('Sufijo')}>
                    <Input
                        value={suffix}
                        onChange={(e) => onChange({ ...config, suffix: e.target.value })}
                        placeholder="USD"
                    />
                </Field>
            </div>
            <AccentColorField
                value={accent}
                onChange={(v) => onChange({ ...config, accent_color: v })}
            />
            <Field label={__('Icono (emoji opcional)')}>
                <Input
                    value={icon}
                    onChange={(e) => onChange({ ...config, icon: e.target.value })}
                    placeholder="💳"
                    maxLength={4}
                />
                <Hint>{__('Cualquier emoji o caracter unicode. Se muestra a la izquierda del valor en variante card.')}</Hint>
            </Field>
            <div className="imcrm-grid imcrm-grid-cols-[1fr_auto] imcrm-gap-2">
                <Field label={__('Trend (opcional)')}>
                    <Input
                        value={trendText}
                        onChange={(e) => onChange({ ...config, trend_text: e.target.value })}
                        placeholder={__('+12% vs mes pasado')}
                    />
                </Field>
                <Field label={__('Dirección')}>
                    <Select
                        value={trendDirection}
                        onChange={(e) => onChange({ ...config, trend_direction: e.target.value })}
                    >
                        <option value="neutral">{__('Neutral')}</option>
                        <option value="up">{__('↑ Sube')}</option>
                        <option value="down">{__('↓ Baja')}</option>
                    </Select>
                </Field>
            </div>
        </div>
    );
}

// ─── activity_timeline ────────────────────────────────────────────────

function ActivityForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const limit = (config.limit as number) ?? 10;
    const title = (config.title as string) ?? '';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Actividad reciente')}
                />
            </Field>
            <Field label={__('Máximo de items a mostrar')}>
                <Input
                    type="number"
                    min={1}
                    max={50}
                    value={limit}
                    onChange={(e) => onChange({ ...config, limit: Number(e.target.value) })}
                />
            </Field>
        </div>
    );
}

// ─── download_files ───────────────────────────────────────────────────

function DownloadFilesForm({
    config,
    fields,
    onChange,
}: {
    config: Record<string, unknown>;
    fields: FieldEntity[];
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const fieldSlug = (config.field_slug as string) ?? '';
    const title = (config.title as string) ?? '';
    const variant = (config.variant as string) ?? 'list';
    const fileFields = fields.filter((f) => f.type === 'file');

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Archivos')}
                />
            </Field>
            <VariantPicker
                value={variant}
                onChange={(v) => onChange({ ...config, variant: v })}
                options={[
                    { value: 'list', label: __('Lista vertical') },
                    { value: 'grid', label: __('Grid de 3 columnas') },
                ]}
            />
            <Field label={__('Campo tipo archivo a mostrar')}>
                <Select
                    value={fieldSlug}
                    onChange={(e) => onChange({ ...config, field_slug: e.target.value })}
                >
                    <option value="">{__('— Elegir campo —')}</option>
                    {fileFields.map((f) => (
                        <option key={f.id} value={f.slug}>{f.label}</option>
                    ))}
                </Select>
                {fileFields.length === 0 && (
                    <Hint variant="warning">
                        {__('La lista no tiene campos tipo "archivo". Agregá uno primero.')}
                    </Hint>
                )}
            </Field>
        </div>
    );
}

// ─── comments_thread ──────────────────────────────────────────────────

function CommentsForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const title = (config.title as string) ?? '';
    const readonly = config.readonly === true;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título de la sección')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Comentarios')}
                />
            </Field>
            <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs imcrm-cursor-pointer">
                <input
                    type="checkbox"
                    checked={readonly}
                    onChange={(e) => onChange({ ...config, readonly: e.target.checked })}
                    className="imcrm-mt-0.5"
                />
                <span>
                    {__('Solo lectura')}
                    <span className="imcrm-block imcrm-text-[10px] imcrm-text-muted-foreground">
                        {__('El cliente ve los comentarios pero no puede escribir.')}
                    </span>
                </span>
            </label>
        </div>
    );
}

// ─── heading ──────────────────────────────────────────────────────────

function HeadingForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const text = (config.text as string) ?? '';
    const eyebrow = (config.eyebrow as string) ?? '';
    const level = (config.level as number) ?? 2;
    const align = (config.align as string) ?? 'left';
    const accent = (config.accent_color as string | null) ?? null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Eyebrow (texto pequeño arriba)')}>
                <Input
                    value={eyebrow}
                    onChange={(e) => onChange({ ...config, eyebrow: e.target.value })}
                    placeholder={__('Ej. "FACTURACIÓN"')}
                />
            </Field>
            <Field label={__('Texto del título')}>
                <Input
                    value={text}
                    onChange={(e) => onChange({ ...config, text: e.target.value })}
                    placeholder={__('Título de sección')}
                />
            </Field>
            <Field label={__('Jerarquía')}>
                <Select
                    value={String(level)}
                    onChange={(e) => onChange({ ...config, level: Number(e.target.value) })}
                >
                    <option value="1">{__('H1 — máximo')}</option>
                    <option value="2">{__('H2 — sección')}</option>
                    <option value="3">{__('H3 — subsección')}</option>
                </Select>
            </Field>
            <Field label={__('Alineación')}>
                <Select
                    value={align}
                    onChange={(e) => onChange({ ...config, align: e.target.value })}
                >
                    <option value="left">{__('Izquierda')}</option>
                    <option value="center">{__('Centrada')}</option>
                </Select>
            </Field>
            <AccentColorField
                value={accent}
                onChange={(v) => onChange({ ...config, accent_color: v })}
            />
        </div>
    );
}

// ─── hero ─────────────────────────────────────────────────────────────

function HeroForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const title = (config.title as string) ?? '';
    const subtitle = (config.subtitle as string) ?? '';
    const ctaLabel = (config.cta_label as string) ?? '';
    const ctaHref = (config.cta_href as string) ?? '';
    const variant = (config.variant as string) ?? 'gradient';
    const align = (config.align as string) ?? 'left';
    const accent = (config.accent_color as string | null) ?? null;
    const bg = (config.background_color as string | null) ?? null;
    const textColor = (config.text_color as string | null) ?? null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <VariantPicker
                value={variant}
                onChange={(v) => onChange({ ...config, variant: v })}
                options={[
                    { value: 'gradient', label: __('Gradiente (con accent)') },
                    { value: 'solid', label: __('Sólido (accent)') },
                    { value: 'plain', label: __('Plano (sin fondo)') },
                ]}
            />
            <Field label={__('Título principal')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Hola, {{nombre}}')}
                />
                <Hint>{__('Usá {{slug}} para interpolar campos del cliente (ej. {{nombre}}).')}</Hint>
            </Field>
            <Field label={__('Subtítulo')}>
                <Input
                    value={subtitle}
                    onChange={(e) => onChange({ ...config, subtitle: e.target.value })}
                    placeholder={__('Bienvenido a tu portal')}
                />
            </Field>
            <Field label={__('Alineación')}>
                <Select
                    value={align}
                    onChange={(e) => onChange({ ...config, align: e.target.value })}
                >
                    <option value="left">{__('Izquierda')}</option>
                    <option value="center">{__('Centrada')}</option>
                </Select>
            </Field>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Field label={__('CTA — texto')}>
                    <Input
                        value={ctaLabel}
                        onChange={(e) => onChange({ ...config, cta_label: e.target.value })}
                        placeholder={__('Ej. "Pagar"')}
                    />
                </Field>
                <Field label={__('CTA — URL')}>
                    <Input
                        type="url"
                        value={ctaHref}
                        onChange={(e) => onChange({ ...config, cta_href: e.target.value })}
                        placeholder="https://…"
                    />
                </Field>
            </div>
            <AccentColorField
                value={accent}
                onChange={(v) => onChange({ ...config, accent_color: v })}
                label={__('Color de acento (CTA)')}
            />
            <Field label={__('Color de fondo (override)')}>
                <HexColorInput
                    value={bg ?? ''}
                    onChange={(v) => onChange({ ...config, background_color: v === '' ? null : v })}
                />
                <Hint>
                    {__('Si lo dejás vacío, el fondo viene del variant arriba. Si ponés un color, reemplaza al gradient/sólido.')}
                </Hint>
            </Field>
            <Field label={__('Color del texto (override)')}>
                <HexColorInput
                    value={textColor ?? ''}
                    onChange={(v) => onChange({ ...config, text_color: v === '' ? null : v })}
                />
                <Hint>
                    {__('Útil cuando ponés un bg claro y el texto blanco default no se ve. Vacío = default del variant.')}
                </Hint>
            </Field>
        </div>
    );
}

// ─── stats_grid ───────────────────────────────────────────────────────

interface StatItem {
    label: string;
    value: string;
    metric: 'static' | 'count' | 'sum' | 'avg' | 'min' | 'max';
    list_slug: string;
    field_id: number;
    prefix: string;
    suffix: string;
}

function StatsGridForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const lists = useLists();
    const items = (Array.isArray(config.items) ? config.items : []) as StatItem[];
    const columns = (config.columns as number) ?? 3;
    const title = (config.title as string) ?? '';

    const updateItem = (idx: number, patch: Partial<StatItem>): void => {
        const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
        onChange({ ...config, items: next });
    };
    const addItem = (): void => {
        if (items.length >= 4) return;
        onChange({
            ...config,
            items: [
                ...items,
                { label: __('Nueva'), value: '0', metric: 'static', list_slug: '', field_id: 0, prefix: '', suffix: '' },
            ],
        });
    };
    const removeItem = (idx: number): void => {
        onChange({ ...config, items: items.filter((_, i) => i !== idx) });
    };
    const moveItem = (idx: number, dir: -1 | 1): void => {
        const target = idx + dir;
        if (target < 0 || target >= items.length) return;
        const next = [...items];
        [next[idx], next[target]] = [next[target]!, next[idx]!];
        onChange({ ...config, items: next });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título (opcional)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Resumen')}
                />
            </Field>
            <Field label={__('Columnas')}>
                <Select
                    value={String(columns)}
                    onChange={(e) => onChange({ ...config, columns: Number(e.target.value) })}
                >
                    <option value="2">{__('2 columnas')}</option>
                    <option value="3">{__('3 columnas')}</option>
                    <option value="4">{__('4 columnas')}</option>
                </Select>
            </Field>
            <Field label={__('Métricas (máx. 4)')}>
                {items.length === 0 ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Sin métricas. Agregá una abajo.')}
                    </p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        {items.map((it, i) => (
                            <li
                                key={i}
                                className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2"
                            >
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                    <Input
                                        value={it.label}
                                        onChange={(e) => updateItem(i, { label: e.target.value })}
                                        placeholder={__('Label')}
                                    />
                                    <div className="imcrm-flex imcrm-gap-0.5 imcrm-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => moveItem(i, -1)}
                                            disabled={i === 0}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-30"
                                            title={__('Subir')}
                                        >
                                            <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveItem(i, 1)}
                                            disabled={i === items.length - 1}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-30"
                                            title={__('Bajar')}
                                        >
                                            <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeItem(i)}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                            title={__('Quitar')}
                                        >
                                            <X className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                    </div>
                                </div>
                                <Select
                                    value={it.metric}
                                    onChange={(e) => updateItem(i, { metric: e.target.value as StatItem['metric'] })}
                                >
                                    <option value="static">{__('Valor estático')}</option>
                                    <option value="count">{__('Contar registros')}</option>
                                    <option value="sum">{__('Suma')}</option>
                                    <option value="avg">{__('Promedio')}</option>
                                    <option value="min">{__('Mínimo')}</option>
                                    <option value="max">{__('Máximo')}</option>
                                </Select>
                                {it.metric === 'static' ? (
                                    <Input
                                        value={it.value}
                                        onChange={(e) => updateItem(i, { value: e.target.value })}
                                        placeholder={__('Valor (ej. 42)')}
                                    />
                                ) : (
                                    <>
                                        <Select
                                            value={it.list_slug}
                                            onChange={(e) => updateItem(i, { list_slug: e.target.value })}
                                        >
                                            <option value="">{__('— Elegir lista —')}</option>
                                            {(lists.data ?? []).map((l) => (
                                                <option key={l.id} value={l.slug}>{l.name}</option>
                                            ))}
                                        </Select>
                                        {it.metric !== 'count' && (
                                            <Input
                                                type="number"
                                                value={it.field_id}
                                                onChange={(e) => updateItem(i, { field_id: Number(e.target.value) })}
                                                placeholder={__('ID del campo numérico')}
                                            />
                                        )}
                                    </>
                                )}
                                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5">
                                    <Input
                                        value={it.prefix}
                                        onChange={(e) => updateItem(i, { prefix: e.target.value })}
                                        placeholder={__('Prefijo')}
                                    />
                                    <Input
                                        value={it.suffix}
                                        onChange={(e) => updateItem(i, { suffix: e.target.value })}
                                        placeholder={__('Sufijo')}
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                <button
                    type="button"
                    onClick={addItem}
                    disabled={items.length >= 4}
                    className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-background imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-50"
                >
                    + {__('Agregar métrica')}
                </button>
            </Field>
        </div>
    );
}

// ─── quick_actions ────────────────────────────────────────────────────

interface QuickAction {
    icon: string;
    label: string;
    href: string;
    new_window: boolean;
}

const QUICK_ACTION_ICONS = [
    'link', 'download', 'upload', 'file-text', 'mail', 'phone', 'message-circle',
    'calendar', 'credit-card', 'help-circle', 'settings', 'user', 'shield', 'zap',
] as const;

function QuickActionsForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const items = (Array.isArray(config.items) ? config.items : []) as QuickAction[];
    const columns = (config.columns as number) ?? 3;
    const title = (config.title as string) ?? '';

    const updateItem = (idx: number, patch: Partial<QuickAction>): void => {
        const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
        onChange({ ...config, items: next });
    };
    const addItem = (): void => {
        onChange({
            ...config,
            items: [...items, { icon: 'link', label: __('Acción'), href: '', new_window: true }],
        });
    };
    const removeItem = (idx: number): void => {
        onChange({ ...config, items: items.filter((_, i) => i !== idx) });
    };
    const moveItem = (idx: number, dir: -1 | 1): void => {
        const target = idx + dir;
        if (target < 0 || target >= items.length) return;
        const next = [...items];
        [next[idx], next[target]] = [next[target]!, next[idx]!];
        onChange({ ...config, items: next });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título (opcional)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Acciones rápidas')}
                />
            </Field>
            <Field label={__('Columnas')}>
                <Select
                    value={String(columns)}
                    onChange={(e) => onChange({ ...config, columns: Number(e.target.value) })}
                >
                    <option value="2">{__('2 columnas')}</option>
                    <option value="3">{__('3 columnas')}</option>
                    <option value="4">{__('4 columnas')}</option>
                </Select>
            </Field>
            <Field label={__('Acciones')}>
                {items.length === 0 ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Sin acciones. Agregá una abajo.')}
                    </p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        {items.map((it, i) => (
                            <li
                                key={i}
                                className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2"
                            >
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                    <Select
                                        value={it.icon}
                                        onChange={(e) => updateItem(i, { icon: e.target.value })}
                                    >
                                        {QUICK_ACTION_ICONS.map((ic) => (
                                            <option key={ic} value={ic}>{ic}</option>
                                        ))}
                                    </Select>
                                    <div className="imcrm-flex imcrm-gap-0.5 imcrm-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => moveItem(i, -1)}
                                            disabled={i === 0}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-30"
                                        >
                                            <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveItem(i, 1)}
                                            disabled={i === items.length - 1}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-30"
                                        >
                                            <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeItem(i)}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                        >
                                            <X className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                    </div>
                                </div>
                                <Input
                                    value={it.label}
                                    onChange={(e) => updateItem(i, { label: e.target.value })}
                                    placeholder={__('Label')}
                                />
                                <Input
                                    type="url"
                                    value={it.href}
                                    onChange={(e) => updateItem(i, { href: e.target.value })}
                                    placeholder="https://…"
                                />
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px]">
                                    <input
                                        type="checkbox"
                                        checked={it.new_window}
                                        onChange={(e) => updateItem(i, { new_window: e.target.checked })}
                                    />
                                    {__('Pestaña nueva')}
                                </label>
                            </li>
                        ))}
                    </ul>
                )}
                <button
                    type="button"
                    onClick={addItem}
                    className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-background imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted"
                >
                    + {__('Agregar acción')}
                </button>
            </Field>
        </div>
    );
}

// ─── notice ───────────────────────────────────────────────────────────

function NoticeForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const title = (config.title as string) ?? '';
    const body = (config.body as string) ?? '';
    const variant = (config.variant as string) ?? 'info';
    const ctaLabel = (config.cta_label as string) ?? '';
    const ctaHref = (config.cta_href as string) ?? '';
    const dismissible = config.dismissible === true;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <VariantPicker
                value={variant}
                onChange={(v) => onChange({ ...config, variant: v })}
                options={[
                    { value: 'info', label: __('Info (azul)') },
                    { value: 'success', label: __('Éxito (verde)') },
                    { value: 'warning', label: __('Advertencia (ámbar)') },
                    { value: 'error', label: __('Error (rojo)') },
                    { value: 'announce', label: __('Anuncio (primario)') },
                ]}
            />
            <Field label={__('Título (opcional)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Ej. "Factura próxima a vencer"')}
                />
            </Field>
            <Field label={__('Mensaje')}>
                <Textarea
                    rows={3}
                    value={body}
                    onChange={(e) => onChange({ ...config, body: e.target.value })}
                />
            </Field>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Field label={__('CTA — texto')}>
                    <Input
                        value={ctaLabel}
                        onChange={(e) => onChange({ ...config, cta_label: e.target.value })}
                        placeholder={__('Ej. "Pagar ahora"')}
                    />
                </Field>
                <Field label={__('CTA — URL')}>
                    <Input
                        type="url"
                        value={ctaHref}
                        onChange={(e) => onChange({ ...config, cta_href: e.target.value })}
                        placeholder="https://…"
                    />
                </Field>
            </div>
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-cursor-pointer">
                <input
                    type="checkbox"
                    checked={dismissible}
                    onChange={(e) => onChange({ ...config, dismissible: e.target.checked })}
                />
                {__('El cliente puede ocultarlo (session-scoped)')}
            </label>
        </div>
    );
}

// ─── divider ──────────────────────────────────────────────────────────

function DividerForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const label = (config.label as string) ?? '';
    const style = (config.style as string) ?? 'solid';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Label centrado (opcional)')}>
                <Input
                    value={label}
                    onChange={(e) => onChange({ ...config, label: e.target.value })}
                    placeholder={__('Ej. "FACTURACIÓN"')}
                />
            </Field>
            <Field label={__('Estilo')}>
                <Select
                    value={style}
                    onChange={(e) => onChange({ ...config, style: e.target.value })}
                >
                    <option value="solid">{__('Sólida')}</option>
                    <option value="dashed">{__('Punteada larga')}</option>
                    <option value="dotted">{__('Punteada')}</option>
                </Select>
            </Field>
        </div>
    );
}

// ─── faq ──────────────────────────────────────────────────────────────

interface FaqItem {
    question: string;
    answer: string;
}

function FaqForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const title = (config.title as string) ?? '';
    const items = (Array.isArray(config.items) ? config.items : []) as FaqItem[];
    const updateItem = (idx: number, patch: Partial<FaqItem>): void => {
        const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
        onChange({ ...config, items: next });
    };
    const addItem = (): void => {
        onChange({
            ...config,
            items: [...items, { question: __('Nueva pregunta'), answer: '' }],
        });
    };
    const removeItem = (idx: number): void => {
        onChange({ ...config, items: items.filter((_, i) => i !== idx) });
    };
    const moveItem = (idx: number, dir: -1 | 1): void => {
        const target = idx + dir;
        if (target < 0 || target >= items.length) return;
        const next = [...items];
        [next[idx], next[target]] = [next[target]!, next[idx]!];
        onChange({ ...config, items: next });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título (opcional)')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Preguntas frecuentes')}
                />
            </Field>
            <Field label={__('Preguntas')}>
                {items.length === 0 ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Sin preguntas. Agregá una abajo.')}
                    </p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        {items.map((it, i) => (
                            <li
                                key={i}
                                className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2"
                            >
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                    <Input
                                        value={it.question}
                                        onChange={(e) => updateItem(i, { question: e.target.value })}
                                        placeholder={__('Pregunta')}
                                    />
                                    <div className="imcrm-flex imcrm-gap-0.5 imcrm-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => moveItem(i, -1)}
                                            disabled={i === 0}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-30"
                                        >
                                            <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveItem(i, 1)}
                                            disabled={i === items.length - 1}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-30"
                                        >
                                            <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeItem(i)}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                        >
                                            <X className="imcrm-h-3 imcrm-w-3" />
                                        </button>
                                    </div>
                                </div>
                                <Textarea
                                    rows={2}
                                    value={it.answer}
                                    onChange={(e) => updateItem(i, { answer: e.target.value })}
                                    placeholder={__('Respuesta')}
                                />
                            </li>
                        ))}
                    </ul>
                )}
                <button
                    type="button"
                    onClick={addItem}
                    className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-background imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted"
                >
                    + {__('Agregar pregunta')}
                </button>
            </Field>
        </div>
    );
}

// ─── contact_card ─────────────────────────────────────────────────────

function ContactCardForm({
    config,
    onChange,
}: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
}): JSX.Element {
    const title = (config.title as string) ?? '';
    const name = (config.name as string) ?? '';
    const role = (config.role as string) ?? '';
    const avatarUrl = (config.avatar_url as string) ?? '';
    const email = (config.email as string) ?? '';
    const phone = (config.phone as string) ?? '';
    const whatsapp = (config.whatsapp as string) ?? '';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Título de la tarjeta')}>
                <Input
                    value={title}
                    onChange={(e) => onChange({ ...config, title: e.target.value })}
                    placeholder={__('Tu asesor')}
                />
            </Field>
            <Field label={__('Nombre del asesor')}>
                <Input
                    value={name}
                    onChange={(e) => onChange({ ...config, name: e.target.value })}
                    placeholder={__('Ej. "María González"')}
                />
            </Field>
            <Field label={__('Rol / cargo')}>
                <Input
                    value={role}
                    onChange={(e) => onChange({ ...config, role: e.target.value })}
                    placeholder={__('Ej. "Account Manager"')}
                />
            </Field>
            <Field label={__('Avatar URL (opcional)')}>
                <Input
                    type="url"
                    value={avatarUrl}
                    onChange={(e) => onChange({ ...config, avatar_url: e.target.value })}
                    placeholder="https://…/avatar.jpg"
                />
                <Hint>{__('Si está vacío, se muestran las iniciales sobre fondo de color.')}</Hint>
            </Field>
            <Field label={__('Email')}>
                <Input
                    type="email"
                    value={email}
                    onChange={(e) => onChange({ ...config, email: e.target.value })}
                    placeholder="asesor@empresa.com"
                />
            </Field>
            <Field label={__('Teléfono')}>
                <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => onChange({ ...config, phone: e.target.value })}
                    placeholder="+57 300 123 4567"
                />
            </Field>
            <Field label={__('WhatsApp (número con código país, sin +)')}>
                <Input
                    value={whatsapp}
                    onChange={(e) => onChange({ ...config, whatsapp: e.target.value })}
                    placeholder="573001234567"
                />
                <Hint>{__('Genera link wa.me/<número> con saludo predefinido.')}</Hint>
            </Field>
        </div>
    );
}

// ─── Helpers UI ───────────────────────────────────────────────────────

function Field({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label className="imcrm-text-xs">{label}</Label>
            {children}
        </div>
    );
}

function Hint({
    children,
    variant,
}: {
    children: React.ReactNode;
    variant?: 'default' | 'warning';
}): JSX.Element {
    return (
        <p
            className={
                variant === 'warning'
                    ? 'imcrm-text-[11px] imcrm-text-warning'
                    : 'imcrm-text-[11px] imcrm-text-muted-foreground'
            }
        >
            {children}
        </p>
    );
}

function VariantPicker({
    value,
    onChange,
    options,
}: {
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
}): JSX.Element {
    return (
        <Field label={__('Variante visual')}>
            <Select value={value} onChange={(e) => onChange(e.target.value)}>
                {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </Select>
        </Field>
    );
}

function AccentColorField({
    value,
    onChange,
    label,
}: {
    value: string | null;
    onChange: (v: string | null) => void;
    label?: string;
}): JSX.Element {
    return (
        <Field label={label ?? __('Color de acento (opcional)')}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <ColorPicker
                    value={value as OptionColor | null}
                    onChange={(c) => onChange((c as string | null) ?? null)}
                />
                <Hint>{__('Default: color primario del tema.')}</Hint>
            </div>
        </Field>
    );
}

/**
 * Input HEX libre (free-form) con color swatch nativo. A diferencia
 * del `<ColorPicker>` paletizado, permite cualquier color custom.
 * Útil para overrides como bg del hero donde el admin quiere un
 * matiz específico fuera de la paleta del tema.
 */
function HexColorInput({
    value,
    onChange,
}: {
    value: string;
    onChange: (v: string) => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
            <input
                type="color"
                value={value === '' ? '#ffffff' : value}
                onChange={(e) => onChange(e.target.value)}
                className="imcrm-h-9 imcrm-w-12 imcrm-rounded imcrm-border imcrm-border-input imcrm-bg-background imcrm-cursor-pointer"
            />
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="#rrggbb"
                className="imcrm-flex-1"
            />
            {value !== '' && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground imcrm-no-drag"
                    aria-label={__('Limpiar color')}
                >
                    {__('Limpiar')}
                </button>
            )}
        </div>
    );
}

/**
 * Multi-picker de slugs reordenable. Reemplaza el `<input type="text">`
 * con CSVs del editor anterior.
 */
function FieldSlugMultiPicker({
    label,
    value,
    onChange,
    options,
    placeholder,
}: {
    label: string;
    value: string[];
    onChange: (next: string[]) => void;
    options: FieldEntity[];
    placeholder: string;
}): JSX.Element {
    const bySlug = new Map(options.map((f) => [f.slug, f]));
    const available = options.filter((f) => ! value.includes(f.slug));
    const move = (slug: string, dir: -1 | 1): void => {
        const idx = value.indexOf(slug);
        const target = idx + dir;
        if (idx < 0 || target < 0 || target >= value.length) return;
        const next = [...value];
        [next[idx], next[target]] = [next[target]!, next[idx]!];
        onChange(next);
    };
    const remove = (slug: string): void => {
        onChange(value.filter((s) => s !== slug));
    };
    return (
        <Field label={label}>
            {value.length === 0 ? (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Vacío. Agregá campos desde el dropdown.')}
                </p>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    {value.map((slug, i) => {
                        const f = bySlug.get(slug);
                        return (
                            <li
                                key={slug}
                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs"
                            >
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                                    {f ? f.label : slug}
                                    {f && (
                                        <span className="imcrm-ml-2 imcrm-text-[10px] imcrm-text-muted-foreground">
                                            ({f.type})
                                        </span>
                                    )}
                                    {!f && (
                                        <span className="imcrm-ml-2 imcrm-text-[10px] imcrm-text-warning">
                                            ({__('no encontrado')})
                                        </span>
                                    )}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => move(slug, -1)}
                                    disabled={i === 0}
                                    className="imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30"
                                    title={__('Subir')}
                                >
                                    <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => move(slug, 1)}
                                    disabled={i === value.length - 1}
                                    className="imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30"
                                    title={__('Bajar')}
                                >
                                    <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => remove(slug)}
                                    className="imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                    title={__('Quitar')}
                                >
                                    <X className="imcrm-h-3 imcrm-w-3" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <select
                onChange={(e) => {
                    const slug = e.target.value;
                    if (slug !== '') {
                        onChange([...value, slug]);
                        e.target.value = '';
                    }
                }}
                defaultValue=""
                disabled={available.length === 0}
                className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-xs"
            >
                <option value="">
                    {available.length === 0 ? __('— Sin campos disponibles —') : placeholder}
                </option>
                {available.map((f) => (
                    <option key={f.id} value={f.slug}>
                        {f.label} ({f.type})
                    </option>
                ))}
            </select>
        </Field>
    );
}
