import { Copy, MousePointerClick, Trash2 } from 'lucide-react';
import { LAYOUT_THEME_PRESETS, type LayoutBlock, type LayoutHeader, type LayoutTheme } from '@imagina-base/shared';

import { BlockStyleEditor } from '@/admin/template-editor-core/BlockStyleEditor';
import { Select } from '@/components/ui/select';
import { hasBlockStyle, readBlockStyle } from '@/lib/blockStyle';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { useLayoutCtx } from '../LayoutContext';
import { resolveTheme } from '../layoutTheme';
import {
    ButtonForm,
    ChartForm,
    DividerForm,
    EmbedForm,
    FieldForm,
    FieldsForm,
    FilesForm,
    GalleryForm,
    HeadingForm,
    ImageForm,
    InfoForm,
    NoticeForm,
    RelatedForm,
    SpacerForm,
    StagesForm,
    TextForm,
    type FormProps,
} from './blockForms';
import { blockIcon, blockLabel } from './blockCatalog';
import { ColumnsGlyph } from './EditorCanvas';
import { useEditor } from './editorState';
import { ColorField, FieldChecklist, FieldSelect, Group, Row, Segmented, TextInput, Toggle } from './inspectorUi';
import { COLUMN_PRESETS, duplicateBlock, findBlock, findSection, removeBlock, removeSection, setSectionColumns, updateBlock, updateSection } from './layoutOps';

/**
 * v0.1.231 — Panel derecho del editor: lo que se puede ajustar de lo que
 * está elegido en el lienzo. Sin selección, el tema de la ficha.
 */
export function Inspector({ onPageChange: _onPageChange }: { onPageChange: (id: string) => void }): JSX.Element {
    const ed = useEditor();
    const sel = ed.selection;
    let body: JSX.Element;
    if (sel?.kind === 'block') {
        const found = findBlock(ed.layout, sel.id);
        body = found ? <BlockInspector key={found.block.id} block={found.block} /> : <ThemeInspector />;
    } else if (sel?.kind === 'section') {
        const found = findSection(ed.layout, sel.id);
        body = found ? <SectionInspector key={sel.id} sectionId={sel.id} /> : <ThemeInspector />;
    } else if (sel?.kind === 'header') {
        body = <HeaderInspector />;
    } else {
        body = <ThemeInspector />;
    }
    return (
        <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto" data-testid="layout-inspector">
            {body}
        </div>
    );
}

function Title({ icon, text, actions }: { icon?: React.ReactNode; text: string; actions?: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-sticky imcrm-top-0 imcrm-z-10 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2.5">
            {icon && <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary [&>svg]:imcrm-h-3.5 [&>svg]:imcrm-w-3.5">{icon}</span>}
            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-font-semibold">{text}</span>
            {actions}
        </div>
    );
}

function HeadButton({ label, onClick, danger = false, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className={cn(
                'imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground [&>svg]:imcrm-h-3.5 [&>svg]:imcrm-w-3.5',
                danger ? 'hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive' : 'hover:imcrm-bg-accent hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}

// ── Bloque ───────────────────────────────────────────────────────────────

const TITLED = new Set(['fields', 'files', 'chart', 'related', 'field', 'notice', 'record_stats', 'activity', 'comments', 'description', 'stages', 'image', 'gallery', 'embed']);

function BlockInspector({ block }: { block: LayoutBlock }): JSX.Element {
    const ed = useEditor();
    const Icon = blockIcon(block);
    const set: FormProps['set'] = (patch) => {
        const config = { ...block.config, ...patch };
        for (const k of Object.keys(config)) if (config[k] === undefined) delete config[k];
        // Lo que se tipea se agrupa en un solo paso de deshacer por clave.
        ed.commit(updateBlock(ed.layout, block.id, { config }), `blk:${block.id}:${Object.keys(patch).join(',')}`);
    };
    const props = { block, set };
    return (
        <>
            <Title
                icon={<Icon />}
                text={blockLabel(block)}
                actions={
                    <>
                        <HeadButton
                            label={__('Duplicar (Ctrl+D)')}
                            onClick={() => {
                                const r = duplicateBlock(ed.layout, block.id);
                                ed.commit(r.layout);
                                if (r.newId) ed.select({ kind: 'block', id: r.newId });
                            }}
                        >
                            <Copy />
                        </HeadButton>
                        <HeadButton
                            label={__('Eliminar (Supr)')}
                            danger
                            onClick={() => {
                                ed.commit(removeBlock(ed.layout, block.id));
                                ed.select(null);
                            }}
                        >
                            <Trash2 />
                        </HeadButton>
                    </>
                }
            />
            {TITLED.has(block.type) && (
                <div className="imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-3">
                    <Row label={__('Título')} hint={block.type === 'notice' ? undefined : __('Vacío: sin título (o el del campo).')}>
                        <TextInput
                            value={block.title ?? ''}
                            onChange={(v) => ed.commit(updateBlock(ed.layout, block.id, { title: v === '' ? undefined : v.slice(0, 200) }), `blk:${block.id}:title`)}
                            ariaLabel={__('Título del bloque')}
                        />
                    </Row>
                </div>
            )}
            <BlockForm {...props} />
            <div className="imcrm-px-3 imcrm-pb-4">
                <BlockStyleEditor
                    value={readBlockStyle({ style: block.style })}
                    onChange={(next) => ed.commit(updateBlock(ed.layout, block.id, { style: hasBlockStyle(next) ? (next as Record<string, unknown>) : undefined }), `blk:${block.id}:style`)}
                />
            </div>
        </>
    );
}

function BlockForm(props: FormProps): JSX.Element | null {
    switch (props.block.type) {
        case 'field':
            return <FieldForm {...props} />;
        case 'fields':
            return <FieldsForm {...props} />;
        case 'files':
            return <FilesForm {...props} />;
        case 'stages':
            return <StagesForm {...props} />;
        case 'chart':
            return <ChartForm {...props} />;
        case 'related':
            return <RelatedForm {...props} />;
        case 'heading':
            return <HeadingForm {...props} />;
        case 'text':
            return <TextForm {...props} />;
        case 'notice':
            return <NoticeForm {...props} />;
        case 'button':
            return <ButtonForm {...props} />;
        case 'embed':
            return <EmbedForm {...props} />;
        case 'divider':
            return <DividerForm {...props} />;
        case 'image':
            return <ImageForm {...props} />;
        case 'gallery':
            return <GalleryForm {...props} />;
        case 'spacer':
            return <SpacerForm {...props} />;
        case 'description':
            return <InfoForm text={__('El documento del registro: se escribe en la ficha, con el menú «/».')} />;
        case 'record_stats':
            return <InfoForm text={__('Días desde que se creó, cantidad de cambios y comentarios del registro.')} />;
        case 'activity':
            return <InfoForm text={__('Todo lo que pasó con el registro: cambios de campos y comentarios, con la caja para comentar.')} />;
        case 'comments':
            return <InfoForm text={__('Sólo la conversación del registro, con la caja para comentar.')} />;
        case 'portal_access':
            return <InfoForm text={__('Botón para invitar al cliente a su portal. Sólo aparece si la lista tiene el portal activado.')} />;
        case 'payments':
            return <InfoForm text={__('Los links de pago del registro (Mercado Pago o Wompi), si ya pagó, y el botón «Cobrar». Necesita una conexión de cobro en Integraciones.')} />;
        default:
            return null;
    }
}

// ── Sección ──────────────────────────────────────────────────────────────

function SectionInspector({ sectionId }: { sectionId: string }): JSX.Element | null {
    const ed = useEditor();
    const found = findSection(ed.layout, sectionId);
    if (!found) return null;
    const s = found.section;
    const bg = typeof s.style?.bg === 'string' ? s.style.bg : null;
    return (
        <>
            <Title
                text={__('Sección')}
                actions={
                    <HeadButton
                        label={__('Eliminar sección')}
                        danger
                        onClick={() => {
                            ed.commit(removeSection(ed.layout, sectionId));
                            ed.select({ kind: 'page' });
                        }}
                    >
                        <Trash2 />
                    </HeadButton>
                }
            />
            <Group title={__('Sección')}>
                <Row label={__('Título')} hint={__('Opcional: un encabezado sobre la sección.')}>
                    <TextInput value={s.title ?? ''} onChange={(v) => ed.commit(updateSection(ed.layout, sectionId, { title: v === '' ? undefined : v.slice(0, 200) }), `sec:${sectionId}:title`)} />
                </Row>
                <Row label={__('Columnas')} hint={__('En el celular las columnas se apilan solas.')}>
                    <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-1.5">
                        {COLUMN_PRESETS.map((p) => {
                            const active = p.join(',') === s.columns.join(',');
                            return (
                                <button
                                    key={p.join(',')}
                                    type="button"
                                    onClick={() => ed.commit(setSectionColumns(ed.layout, sectionId, p))}
                                    aria-pressed={active}
                                    className={cn('imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-p-1.5 imcrm-text-[10px]', active ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent')}
                                >
                                    <ColumnsGlyph columns={p} active={active} />
                                    {p.join('/')}
                                </button>
                            );
                        })}
                    </div>
                </Row>
                <Row label={__('Banda')} hint={__('Un fondo que se adapta solo al tema claro y oscuro.')}>
                    <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-1.5" role="radiogroup">
                        {([
                            ['none', __('Ninguna')],
                            ['accent', __('Color')],
                            ['muted', __('Gris')],
                        ] as const).map(([key, label]) => {
                            const current = s.style?.tone === 'accent' || s.style?.tone === 'muted' ? s.style.tone : 'none';
                            const active = current === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    onClick={() => {
                                        const style = { ...(s.style ?? {}) };
                                        if (key === 'none') delete style.tone;
                                        else {
                                            style.tone = key;
                                            delete style.bg;
                                        }
                                        ed.commit(updateSection(ed.layout, sectionId, { style: Object.keys(style).length > 0 ? style : undefined }), `sec:${sectionId}:tone`);
                                    }}
                                    className={cn('imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1.5 imcrm-text-xs', active ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-font-medium' : 'imcrm-border-border hover:imcrm-bg-accent')}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </Row>
                <Row label={__('Fondo')}>
                    <ColorField
                        value={bg}
                        noneLabel={__('Sin fondo')}
                        onChange={(v) => {
                            const style = { ...(s.style ?? {}) };
                            if (v) {
                                style.bg = v;
                                delete style.tone;
                            } else delete style.bg;
                            ed.commit(updateSection(ed.layout, sectionId, { style: Object.keys(style).length > 0 ? style : undefined }), `sec:${sectionId}:bg`);
                        }}
                    />
                </Row>
            </Group>
        </>
    );
}

// ── Cabecera ─────────────────────────────────────────────────────────────

function HeaderInspector(): JSX.Element {
    const ed = useEditor();
    const ctx = useLayoutCtx();
    const h = ed.layout.header;
    const set = (patch: Partial<LayoutHeader>, key: string): void => ed.commit({ ...ed.layout, header: { ...h, ...patch } }, `hdr:${key}`);
    const cover = h.cover ?? { kind: 'gradient' as const };
    const avatar = h.avatar ?? { kind: 'initials' as const };
    return (
        <>
            <Title text={ctx.mode === 'portal' ? __('Cabecera del portal') : __('Cabecera de la ficha')} />
            <Group title={__('Mostrar')}>
                <Toggle
                    label={__('Mostrar la cabecera')}
                    checked={(h as { hidden?: unknown }).hidden !== true}
                    onChange={(v) => set({ hidden: v ? undefined : true } as Partial<LayoutHeader>, 'hidden')}
                    hint={__('Sin cabecera, la página empieza directo con las secciones.')}
                />
            </Group>
            <Group title={__('Datos')}>
                <Row label={__('Título')} hint={__('Por defecto, el campo de título de la lista.')}>
                    <FieldSelect fields={ctx.fields} value={h.title_field_id ?? undefined} onChange={(id) => set({ title_field_id: id ?? null }, 'title')} allow={(f) => f.type === 'text' || f.type === 'long_text'} emptyLabel={__('El campo de título de la lista')} />
                </Row>
                <Row label={__('Línea bajo el título')} hint={__('Hasta 4 campos, separados por «·».')}>
                    <FieldChecklist fields={ctx.fields} value={h.subtitle_field_ids ?? []} onChange={(v) => set({ subtitle_field_ids: v }, 'subtitle')} max={4} />
                </Row>
                <Row label={__('Propiedades clave')} hint={__('Hasta 8, como chips editables junto al título.')}>
                    <FieldChecklist fields={ctx.fields} value={h.chip_field_ids ?? []} onChange={(v) => set({ chip_field_ids: v }, 'chips')} max={8} />
                </Row>
                <Row label={__('Etapas')} hint={__('Un campo de selección como pasos clickeables bajo la cabecera.')}>
                    <FieldSelect fields={ctx.fields} value={h.stages_field_id ?? undefined} onChange={(id) => set({ stages_field_id: id ?? null }, 'stages')} allow={(f) => f.type === 'select'} emptyLabel={__('Sin etapas')} />
                </Row>
                {ctx.mode !== 'portal' && <Toggle label={__('Mostrar creado y actualizado')} checked={h.show_meta !== false} onChange={(v) => set({ show_meta: v }, 'meta')} />}
            </Group>
            <Group title={__('Portada')}>
                <Segmented
                    value={cover.kind}
                    onChange={(v) => set({ cover: { ...cover, kind: v } }, 'cover-kind')}
                    options={[
                        { value: 'gradient', label: __('Degradé') },
                        { value: 'color', label: __('Color') },
                        { value: 'image', label: __('Imagen') },
                        { value: 'none', label: __('Ninguna') },
                    ]}
                    ariaLabel={__('Portada')}
                />
                {(cover.kind === 'gradient' || cover.kind === 'color') && (
                    <Row label={__('Color')}>
                        <ColorField value={cover.color} noneLabel={__('El del tema')} onChange={(v) => set({ cover: { ...cover, color: v ?? undefined } }, 'cover-color')} />
                    </Row>
                )}
                {cover.kind === 'image' && (
                    <>
                        <Row label={__('Imagen de un campo')}>
                            <FieldSelect fields={ctx.fields} value={cover.image_field_id} onChange={(id) => set({ cover: { ...cover, image_field_id: id } }, 'cover-field')} allow={(f) => f.type === 'url'} emptyLabel={__('Ninguno: usar un enlace')} />
                        </Row>
                        {!cover.image_field_id && (
                            <Row label={__('Enlace de la imagen')}>
                                <TextInput value={cover.image_url ?? ''} onChange={(v) => set({ cover: { ...cover, image_url: v || undefined } }, 'cover-url')} placeholder="https://" />
                            </Row>
                        )}
                    </>
                )}
            </Group>
            <Group title={__('Avatar')}>
                <Segmented
                    value={avatar.kind === 'icon' ? 'initials' : avatar.kind}
                    onChange={(v) => set({ avatar: { ...avatar, kind: v } }, 'avatar-kind')}
                    options={[
                        { value: 'initials', label: __('Iniciales') },
                        { value: 'image', label: __('Imagen') },
                        { value: 'none', label: __('Ninguno') },
                    ]}
                    ariaLabel={__('Avatar')}
                />
                {avatar.kind === 'image' && (
                    <Row label={__('Imagen de un campo')}>
                        <FieldSelect fields={ctx.fields} value={avatar.field_id} onChange={(id) => set({ avatar: { ...avatar, field_id: id } }, 'avatar-field')} allow={(f) => f.type === 'url'} />
                    </Row>
                )}
            </Group>
        </>
    );
}

// ── Tema ─────────────────────────────────────────────────────────────────

const PRESET_LABEL: Record<string, string> = {
    default: __('Clásico'),
    minimal: __('Minimal'),
    corporate: __('Corporativo'),
    fresh: __('Fresco'),
    warm: __('Cálido'),
};

function ThemeInspector(): JSX.Element {
    const ed = useEditor();
    const theme = ed.layout.theme ?? { preset: 'default' as const };
    const set = (patch: Partial<LayoutTheme>, key: string): void => {
        const next = { ...theme, ...patch } as Record<string, unknown>;
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        ed.commit({ ...ed.layout, theme: next as LayoutTheme }, `theme:${key}`);
    };
    return (
        <>
            <Title icon={<MousePointerClick />} text={ed.catalog.target === 'portal' ? __('Tema del portal') : __('Tema de la ficha')} />
            <p className="imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {ed.catalog.target === 'portal'
                    ? __('Elige un bloque, una sección o la cabecera en el portal para ajustarlos. Aquí se define el aspecto general.')
                    : __('Elige un bloque, una sección o la cabecera en la ficha para ajustarlos. Aquí se define el aspecto general.')}
            </p>
            <Group title={__('Estilo')}>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5">
                    {LAYOUT_THEME_PRESETS.map((p) => {
                        const r = resolveTheme({ preset: p });
                        const active = (theme.preset ?? 'default') === p;
                        return (
                            <button
                                key={p}
                                type="button"
                                onClick={() => set({ preset: p, accent: undefined, radius: undefined, density: undefined, surface: undefined }, 'preset')}
                                aria-pressed={active}
                                data-testid={`theme-${p}`}
                                className={cn('imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-2 imcrm-text-left imcrm-text-xs', active ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-font-semibold' : 'imcrm-border-border hover:imcrm-bg-accent')}
                            >
                                <span className="imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-border imcrm-border-border" style={{ background: r.accent, borderRadius: Math.min(10, r.radius) }} />
                                {PRESET_LABEL[p]}
                            </button>
                        );
                    })}
                </div>
            </Group>
            {ed.catalog.target === 'portal' && <PortalPageGroup />}
            <Group title={__('Ajustes')}>
                <Row label={__('Color de acento')}>
                    <ColorField value={theme.accent ?? null} noneLabel={__('El de la empresa')} onChange={(v) => set({ accent: v }, 'accent')} />
                </Row>
                <Row label={__('Esquinas')}>
                    <Select value={theme.radius ?? ''} onChange={(e) => set({ radius: (e.target.value || undefined) as LayoutTheme['radius'] }, 'radius')} className="imcrm-h-8 imcrm-text-sm">
                        <option value="">{__('Las del estilo')}</option>
                        <option value="none">{__('Rectas')}</option>
                        <option value="sm">{__('Apenas redondeadas')}</option>
                        <option value="md">{__('Redondeadas')}</option>
                        <option value="lg">{__('Muy redondeadas')}</option>
                        <option value="xl">{__('Suaves')}</option>
                    </Select>
                </Row>
                <Row label={__('Espacio entre bloques')}>
                    <Segmented
                        value={theme.density ?? 'auto'}
                        onChange={(v) => set({ density: v === 'auto' ? undefined : v }, 'density')}
                        options={[
                            { value: 'auto', label: __('Auto') },
                            { value: 'compact', label: __('Justo') },
                            { value: 'comfortable', label: __('Normal') },
                            { value: 'spacious', label: __('Amplio') },
                        ]}
                        ariaLabel={__('Espacio entre bloques')}
                    />
                </Row>
                <Row label={__('Bloques')}>
                    <Segmented
                        value={theme.surface ?? 'auto'}
                        onChange={(v) => set({ surface: v === 'auto' ? undefined : v }, 'surface')}
                        options={[
                            { value: 'auto', label: __('Auto') },
                            { value: 'cards', label: __('Tarjetas') },
                            { value: 'outlined', label: __('Con borde') },
                            { value: 'flat', label: __('Planos') },
                        ]}
                        ariaLabel={__('Aspecto de los bloques')}
                    />
                </Row>
            </Group>
        </>
    );
}

/**
 * v0.1.233 — La PÁGINA del portal (fuera de las tarjetas): fondo, ancho
 * máximo y tipografía. Vive en `layout.page`; el portal la aplica al body.
 */
function PortalPageGroup(): JSX.Element {
    const ed = useEditor();
    const page = ((ed.layout as { page?: unknown }).page ?? {}) as { bg?: string; max_width?: number; font?: string };
    const set = (patch: Record<string, unknown>, key: string): void => {
        const next: Record<string, unknown> = { ...page, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        ed.commit({ ...ed.layout, page: next } as typeof ed.layout, `page:${key}`);
    };
    return (
        <Group title={__('Página')}>
            <Row label={__('Fondo de la página')}>
                <ColorField value={page.bg ?? null} noneLabel={__('El del tema')} onChange={(v) => set({ bg: v ?? undefined }, 'bg')} />
            </Row>
            <Row label={__('Ancho máximo')}>
                <Select
                    value={page.max_width ? String(page.max_width) : ''}
                    onChange={(e) => set({ max_width: e.target.value ? Number(e.target.value) : undefined }, 'width')}
                    className="imcrm-h-8 imcrm-text-sm"
                    aria-label={__('Ancho máximo')}
                >
                    <option value="">{__('Automático (1100 px)')}</option>
                    <option value="720">{__('Angosto (720 px)')}</option>
                    <option value="960">{__('Medio (960 px)')}</option>
                    <option value="1280">{__('Ancho (1280 px)')}</option>
                </Select>
            </Row>
            <Row label={__('Tipografía')}>
                <Segmented
                    value={page.font ?? 'sans'}
                    onChange={(v) => set({ font: v === 'sans' ? undefined : v }, 'font')}
                    options={[
                        { value: 'sans', label: __('Moderna') },
                        { value: 'serif', label: __('Clásica') },
                        { value: 'rounded', label: __('Redonda') },
                        { value: 'mono', label: __('Mono') },
                    ]}
                    ariaLabel={__('Tipografía')}
                />
            </Row>
        </Group>
    );
}
