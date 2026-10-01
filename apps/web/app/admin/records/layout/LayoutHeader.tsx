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
                : { background: `linear-gradient(115deg, ${accent} 0%, ${tint(accent, 70)} 45%, ${tint(accent, 25)} 100%)` };
    const avatar = header.avatar ?? { kind: 'initials' as const };
    const titleEditable = titleField !== undefined && fieldEditable(ctx, titleField);

    return (
        <header
            className="imcrm-overflow-hidden imcrm-border imcrm-border-border/80 imcrm-bg-card imcrm-shadow-imcrm-sm"
            style={{ borderRadius: ctx.theme.radius }}
            data-testid="imcrm-layout-header"
        >
            {coverStyle && <div className="imcrm-h-24 sm:imcrm-h-28" style={coverStyle} aria-hidden />}
            <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-px-5 imcrm-pb-4', coverStyle ? 'imcrm-pt-0' : 'imcrm-pt-5')}>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-gap-4">
                    {avatar.kind !== 'none' && (
                        <span
                            className={cn(
                                'imcrm-flex imcrm-h-16 imcrm-w-16 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-overflow-hidden imcrm-rounded-2xl imcrm-text-xl imcrm-font-semibold imcrm-shadow-imcrm-md imcrm-ring-4 imcrm-ring-card',
                                coverStyle && 'imcrm--mt-8',
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
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1 imcrm-pt-3">
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                            <RecordTitleInput
                                field={titleField}
                                value={titleValue}
                                onChange={(next) => titleField && ctx.setValue(titleField.slug, next)}
                                fallback={titleText}
                                editable={titleEditable}
                                className="imcrm--ml-1.5 imcrm-min-w-0 imcrm-flex-1"
                            />
                            {ctx.mode !== 'portal' && <span className="imcrm-lay-idbadge imcrm-shrink-0 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">
                                #{ctx.record.id}
                            </span>}
                        </div>
                        {subtitle.length > 0 && (
                            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                                {subtitle.map((f, i) => (
                                    <span key={f.id} className="imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                                        {i > 0 && <span aria-hidden>·</span>}
                                        <span className="imcrm-truncate">{renderCellValue(f, ctx.values[f.slug])}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    {header.show_meta !== false && (
                        <p className="imcrm-lay-meta imcrm-shrink-0 imcrm-text-right imcrm-text-[11px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                            {__('Creado')} {formatDateTimeStr(ctx.record.created_at)}
                            <br />
                            {__('Actualizado')} {formatDateTimeStr(ctx.record.updated_at)}
                        </p>
                    )}
                </div>
                {chips.length > 0 && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2" data-testid="imcrm-layout-chips">
                        {chips.map((f) => (
                            <HeaderChip key={f.id} field={f} />
                        ))}
                    </div>
                )}
                {header.stages_field_id && (
                    <div className="imcrm-rounded-lg imcrm-bg-muted/50 imcrm-p-1" data-testid="imcrm-layout-stages">
                        <StagesBlock fieldId={header.stages_field_id} compact />
                    </div>
                )}
            </div>
        </header>
    );
}

/** Una propiedad clave junto al título; click → editarla ahí mismo. */
function HeaderChip({ field }: { field: FieldEntity }): JSX.Element {
    const ctx = useLayoutCtx();
    const Icon = fieldTypeIcon(field.type);
    const value = ctx.values[field.slug];
    const editable = fieldEditable(ctx, field);
    const content = (
        <span className="imcrm-inline-flex imcrm-max-w-[280px] imcrm-items-center imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-transition-colors hover:imcrm-bg-accent">
            <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
            <span className="imcrm-shrink-0 imcrm-text-muted-foreground">{field.label}</span>
            <span className="imcrm-min-w-0 imcrm-truncate imcrm-font-medium imcrm-text-foreground">
                {value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0) ? (
                    <span className="imcrm-text-muted-foreground/70">—</span>
                ) : (
                    renderCellValue(field, value)
                )}
            </span>
        </span>
    );
    if (!editable) return content;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className="imcrm-rounded-lg focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring" aria-label={`${__('Editar')} ${field.label}`}>
                    {content}
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
