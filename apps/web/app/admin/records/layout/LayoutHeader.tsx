import type { LayoutHeader as HeaderSpec } from '@imagina-base/shared';

import { CompactFieldRow } from '@/admin/records/crm/CompactFieldRow';
import { RecordTitleInput } from '@/admin/records/RecordTitleInput';
import { renderCellValue } from '@/admin/records/renderCellValue';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { fieldEditable, useLayoutCtx } from './LayoutContext';
import { StagesBlock } from './LayoutBlocks';
import { tint } from './layoutTheme';

/**
 * v0.1.230 — Cabecera de la ficha: portada con el acento, avatar, título
 * editable (el campo de título de la lista), una línea de contexto, las
 * propiedades clave como chips editables y, si la plantilla lo pide, las
 * ETAPAS del proceso (un select) clickeables.
 */
export function LayoutHeader({ header }: { header: HeaderSpec }): JSX.Element {
    const ctx = useLayoutCtx();
    const titleField =
        (header.title_field_id ? ctx.fieldsById.get(header.title_field_id) : undefined) ??
        ctx.fields.find((f) => f.is_primary) ??
        ctx.fields.find((f) => f.type === 'text');
    const titleValue = titleField ? ctx.values[titleField.slug] : undefined;
    const titleText = typeof titleValue === 'string' && titleValue !== '' ? titleValue : sprintf(__('Registro #%d'), ctx.record.id);
    const subtitle = header.subtitle_field_ids.map((id) => ctx.fieldsById.get(id)).filter((f): f is FieldEntity => f !== undefined);
    const chips = header.chip_field_ids.map((id) => ctx.fieldsById.get(id)).filter((f): f is FieldEntity => f !== undefined);
    const cover = header.cover ?? { kind: 'gradient' as const };
    const accent = cover.color ?? ctx.theme.accent;
    const coverStyle =
        cover.kind === 'none'
            ? undefined
            : cover.kind === 'image' && coverImage(ctx, cover)
              ? { backgroundImage: `url("${coverImage(ctx, cover)}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : cover.kind === 'color'
                ? { background: accent }
                : // v0.1.234 — un velo del acento, no un bloque de color: la portada
                  // acompaña al título en vez de competir con él.
                  { background: `linear-gradient(115deg, ${tint(accent, 55)} 0%, ${tint(accent, 26)} 50%, ${tint(accent, 8)} 100%)` };
    const avatar = header.avatar ?? { kind: 'initials' as const };
    const titleEditable = titleField !== undefined && fieldEditable(ctx, titleField);

    return (
        <header
            className="imcrm-overflow-hidden imcrm-border imcrm-border-border/80 imcrm-bg-card imcrm-shadow-imcrm-sm"
            style={{ borderRadius: ctx.theme.radius }}
            data-testid="imcrm-layout-header"
        >
            {coverStyle && <div className={cover.kind === 'image' ? 'imcrm-h-28 sm:imcrm-h-32' : 'imcrm-h-14 sm:imcrm-h-16'} style={coverStyle} aria-hidden />}
            <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-px-5 imcrm-pb-4', coverStyle ? 'imcrm-pt-0' : 'imcrm-pt-5')}>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-x-4 imcrm-gap-y-2">
                    {avatar.kind !== 'none' && (
                        <span
                            className={cn(
                                'imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-overflow-hidden imcrm-rounded-xl imcrm-text-lg imcrm-font-semibold imcrm-shadow-imcrm-sm imcrm-ring-4 imcrm-ring-card',
                                coverStyle && 'imcrm--mt-7',
                            )}
                            // Sobre el primario del tema, su tinta (en oscuro el primario es claro).
                            style={{ background: accent, color: cover.color || ctx.theme.accent.startsWith('#') ? '#fff' : 'hsl(var(--imcrm-primary-foreground))' }}
                            aria-hidden
                        >
                            {avatarImage(ctx, avatar) ? (
                                <img src={avatarImage(ctx, avatar)} alt="" className="imcrm-h-full imcrm-w-full imcrm-object-cover" />
                            ) : (
                                initials(titleText)
                            )}
                        </span>
                    )}
                    <div className={cn('imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5', coverStyle ? 'imcrm-pt-2.5' : 'imcrm-pt-1')}>
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                            <RecordTitleInput
                                field={titleField}
                                value={titleValue}
                                onChange={(next) => titleField && ctx.setValue(titleField.slug, next)}
                                fallback={titleText}
                                editable={titleEditable}
                                className="imcrm-lay-title imcrm--ml-1.5 imcrm-min-w-0 imcrm-flex-1"
                            />
                            {ctx.mode !== 'portal' && <span className="imcrm-lay-idbadge imcrm-shrink-0 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">
                                #{ctx.record.id}
                            </span>}
                        </div>
                        {subtitle.some((f) => !isEmpty(ctx.values[f.slug])) && (
                            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-x-4 imcrm-gap-y-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                                {subtitle
                                    .filter((f) => !isEmpty(ctx.values[f.slug]))
                                    .map((f) => {
                                        const Icon = fieldTypeIcon(f.type);
                                        return (
                                            <span key={f.id} className="imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5" title={f.label}>
                                                <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-opacity-70" aria-hidden />
                                                <span className="imcrm-truncate">{renderCellValue(f, ctx.values[f.slug])}</span>
                                            </span>
                                        );
                                    })}
                            </div>
                        )}
                    </div>
                    {header.show_meta !== false && (
                        <p className="imcrm-lay-meta imcrm-shrink-0 imcrm-self-end imcrm-text-right imcrm-text-[11px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                            {__('Creado')} {formatDateTimeStr(ctx.record.created_at)}
                            <br />
                            {__('Actualizado')} {formatDateTimeStr(ctx.record.updated_at)}
                        </p>
                    )}
                </div>
                {header.stages_field_id && (
                    <div className="imcrm-rounded-lg imcrm-bg-muted/50 imcrm-p-1" data-testid="imcrm-layout-stages">
                        <StagesBlock fieldId={header.stages_field_id} compact />
                    </div>
                )}
                {chips.length > 0 && (
                    <div className="imcrm-lay-props imcrm--mx-2 imcrm-border-t imcrm-border-border/70 imcrm-pt-3" data-testid="imcrm-layout-chips">
                        {chips.map((f) => (
                            <HeaderChip key={f.id} field={f} />
                        ))}
                    </div>
                )}
            </div>
        </header>
    );
}

/**
 * Una propiedad clave: etiqueta chica arriba, valor abajo (como las
 * propiedades de una tarea de ClickUp o Linear). Click → editarla ahí mismo.
 */
function HeaderChip({ field }: { field: FieldEntity }): JSX.Element {
    const ctx = useLayoutCtx();
    const Icon = fieldTypeIcon(field.type);
    const value = ctx.values[field.slug];
    const editable = fieldEditable(ctx, field);
    const inner = (
        <>
            <span className="imcrm-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                <Icon className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                <span className="imcrm-truncate">{field.label}</span>
            </span>
            <span className="imcrm-flex imcrm-min-h-[22px] imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-truncate imcrm-text-[13px] imcrm-font-medium imcrm-text-foreground">
                {isEmpty(value) ? <span className="imcrm-font-normal imcrm-text-muted-foreground/60">{editable ? __('Agregar') : '—'}</span> : renderCellValue(field, value)}
            </span>
        </>
    );
    const cls = 'imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left';
    if (!editable) return <div className={cls}>{inner}</div>;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(cls, 'imcrm-transition-colors hover:imcrm-bg-accent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring')}
                    aria-label={`${__('Editar')} ${field.label}`}
                >
                    {inner}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="imcrm-w-[360px] imcrm-p-1">
                <CompactFieldRow
                    field={field}
                    listId={ctx.list.id}
                    recordId={ctx.mode === 'portal' ? undefined : ctx.record.id}
                    allowCreateOptions={ctx.mode !== 'portal'}
                    value={value}
                    onChange={(v) => ctx.setValue(field.slug, v)}
                    error={ctx.errors[field.slug]}
                />
            </PopoverContent>
        </Popover>
    );
}

function isEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function initials(text: string): string {
    const words = text.replace(/[#\d]+/g, '').trim().split(/\s+/).filter(Boolean);
    const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
    return letters || '#';
}

function coverImage(ctx: ReturnType<typeof useLayoutCtx>, cover: NonNullable<HeaderSpec['cover']>): string | undefined {
    if (cover.image_url) return cover.image_url;
    if (cover.image_field_id) {
        const f = ctx.fieldsById.get(cover.image_field_id);
        const v = f ? ctx.values[f.slug] : undefined;
        if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
    }
    return undefined;
}

function avatarImage(ctx: ReturnType<typeof useLayoutCtx>, avatar: NonNullable<HeaderSpec['avatar']>): string | undefined {
    if (avatar.kind !== 'image' || !avatar.field_id) return undefined;
    const f = ctx.fieldsById.get(avatar.field_id);
    const v = f ? ctx.values[f.slug] : undefined;
    return typeof v === 'string' && /^https?:\/\//.test(v) ? v : undefined;
}
