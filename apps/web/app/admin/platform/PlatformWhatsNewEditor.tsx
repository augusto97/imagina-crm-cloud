import { useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ImagePlus, Info, Loader2, Megaphone, RotateCcw, Star, Trash2, X } from 'lucide-react';
import {
    createWhatsNewSchema,
    updateWhatsNewSchema,
    whatsNewVideo,
    WHATS_NEW_AUDIENCE_ROLES,
    WHATS_NEW_KINDS,
    WHATS_NEW_LIMITS,
    WHATS_NEW_TOUR_SUGGESTIONS,
    type CreateWhatsNewInput,
    type PlatformWhatsNewEntry,
    type UpdateWhatsNewInput,
    type WhatsNewAction,
    type WhatsNewAudienceRole,
    type WhatsNewKind,
} from '@imagina-base/shared';

import { FeaturedWhatsNewContent } from '@/admin/whats-new/FeaturedWhatsNewDialog';
import { WhatsNewCard, type WhatsNewCardItem } from '@/admin/whats-new/WhatsNewCard';
import { WhatsNewNoticeRow } from '@/admin/whats-new/WhatsNewNoticeBanner';
import { kindLabel, WHATS_NEW_KIND_META } from '@/admin/whats-new/whatsNewMeta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePlatformPlans } from '@/hooks/usePlatform';
import { uploadWhatsNewImage, useCreateWhatsNew, useRestoreWhatsNew, useUpdateWhatsNew } from '@/hooks/useWhatsNew';
import { __, sprintf } from '@/lib/i18n';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

export const AUDIENCE_ROLE_LABELS: Record<WhatsNewAudienceRole, string> = {
    admin: 'Administradores',
    manager: 'Gerentes',
    agent: 'Agentes',
    viewer: 'Lectores',
    guest: 'Invitados',
};

/** Pantallas de la app que se sugieren como destino del botón. */
const ROUTE_SUGGESTIONS = [
    '/lists',
    '/my-work',
    '/dashboards',
    '/favorites',
    '/agents',
    '/novedades',
    '/settings',
    '/settings?s=avisos',
    '/settings?s=miembros',
    '/settings?s=equipos',
    '/settings?s=conectores',
    '/settings?s=papelera',
];

type ActionMode = 'none' | 'route' | 'url' | 'tour';
type PublishMode = 'now' | 'schedule' | 'draft';

interface Draft {
    kind: WhatsNewKind;
    title: string;
    summary: string;
    body: string;
    imageUrl: string;
    videoUrl: string;
    actionMode: ActionMode;
    actionLabel: string;
    actionRoute: string;
    actionUrl: string;
    actionTour: string;
    actionTourFallback: string;
    version: string;
    featured: boolean;
    roles: WhatsNewAudienceRole[];
    plans: string[];
    publishMode: PublishMode;
    publishAt: string;
    expiresAt: string;
}

/** ISO → valor de un `<input type="datetime-local">` (hora de este equipo). */
function toLocalInput(iso: string | null): string {
    if (!iso) return '';
    const d = parseUtcDate(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
    if (value.trim() === '') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const EMPTY: Draft = {
    kind: 'feature',
    title: '',
    summary: '',
    body: '',
    imageUrl: '',
    videoUrl: '',
    actionMode: 'none',
    actionLabel: '',
    actionRoute: '',
    actionUrl: '',
    actionTour: '',
    actionTourFallback: '',
    version: '',
    featured: false,
    roles: [],
    plans: [],
    publishMode: 'now',
    publishAt: '',
    expiresAt: '',
};

function draftFrom(entry: PlatformWhatsNewEntry | null): Draft {
    if (!entry) return EMPTY;
    const a = entry.action;
    const isUrl = Boolean(a?.href && /^https:/i.test(a.href));
    const actionMode: ActionMode = !a ? 'none' : a.tour ? 'tour' : isUrl ? 'url' : 'route';
    const future = entry.published_at !== null && parseUtcDate(entry.published_at).getTime() > Date.now();
    return {
        kind: entry.kind,
        title: entry.title,
        summary: entry.summary,
        body: entry.body,
        imageUrl: entry.image_url ?? '',
        videoUrl: entry.video_url ?? '',
        actionMode,
        actionLabel: a?.label ?? '',
        actionRoute: actionMode === 'route' ? a?.href ?? '' : '',
        actionUrl: actionMode === 'url' ? a?.href ?? '' : '',
        actionTour: a?.tour ?? '',
        actionTourFallback: actionMode === 'tour' ? a?.href ?? '' : '',
        version: entry.version ?? '',
        featured: entry.featured,
        roles: [...entry.audience.roles],
        plans: [...entry.audience.plans],
        publishMode: entry.status === 'draft' ? 'draft' : future ? 'schedule' : 'now',
        publishAt: toLocalInput(entry.published_at),
        expiresAt: toLocalInput(entry.expires_at),
    };
}

function actionOf(d: Draft): WhatsNewAction | null {
    const label = d.actionLabel.trim();
    switch (d.actionMode) {
        case 'none':
            return null;
        case 'route':
            return { label, href: d.actionRoute.trim() };
        case 'url':
            return { label, href: d.actionUrl.trim() };
        case 'tour':
            return { label, tour: d.actionTour.trim(), ...(d.actionTourFallback.trim() ? { href: d.actionTourFallback.trim() } : {}) };
    }
}

function contentOf(d: Draft) {
    return {
        kind: d.kind,
        title: d.title,
        summary: d.summary,
        body: d.body,
        image_url: d.imageUrl.trim() || null,
        video_url: d.videoUrl.trim() || null,
        action: actionOf(d),
        version: d.version.trim() || null,
        featured: d.kind === 'notice' ? false : d.featured,
        audience: { roles: d.roles, plans: d.plans },
        expires_at: fromLocalInput(d.expiresAt),
    };
}

/** Lo que falta, dicho en claro (los textos por defecto de la validación no lo son). */
const REQUIRED_MESSAGES: Record<string, string> = {
    title: 'Escribe un título',
    summary: 'Escribe un resumen de una o dos líneas',
    'action.label': 'Escribe el texto del botón',
};

/** Mensaje del primer error de validación por campo (para pintarlo junto al campo). */
function fieldErrors(issues: Array<{ path: Array<string | number>; message: string; code: string }>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of issues) {
        const key = i.path.join('.');
        if (key in out) continue;
        out[key] = i.code === 'too_small' && REQUIRED_MESSAGES[key] ? __(REQUIRED_MESSAGES[key]!) : i.message;
    }
    return out;
}

/** Sólo lo que cambió (así editar sin tocar nada no «adopta» una novedad de versión). */
function changedContent(before: ReturnType<typeof contentOf>, after: ReturnType<typeof contentOf>): UpdateWhatsNewInput {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(after) as Array<keyof typeof after>) {
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = after[k];
    }
    return out as UpdateWhatsNewInput;
}

/**
 * Crear o editar una novedad, con la VISTA PREVIA en vivo de lo que verá la
 * persona (el mismo componente del panel, del diálogo de destacadas o de la
 * franja de avisos).
 */
export function PlatformWhatsNewEditor({
    entry,
    open,
    onOpenChange,
}: {
    /** null = una nueva. */
    entry: PlatformWhatsNewEntry | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): JSX.Element {
    const [d, setD] = useState<Draft>(() => draftFrom(entry));
    const [preview, setPreview] = useState<'panel' | 'featured' | 'banner'>(() =>
        entry?.kind === 'notice' ? 'banner' : entry?.featured ? 'featured' : 'panel',
    );
    const [error, setError] = useState<string | null>(null);
    const [touched, setTouched] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const create = useCreateWhatsNew();
    const update = useUpdateWhatsNew();
    const restore = useRestoreWhatsNew();
    const plans = usePlatformPlans();
    const isRelease = entry?.origin === 'release';
    const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setD((prev) => ({ ...prev, [k]: v }));

    const parsed = useMemo(() => {
        const content = contentOf(d);
        return createWhatsNewSchema.safeParse({ ...content, status: 'published', publish_at: null });
    }, [d]);
    const errors = parsed.success ? {} : fieldErrors(parsed.error.issues);
    const scheduleError =
        d.publishMode === 'schedule' && !isRelease && fromLocalInput(d.publishAt) === null ? __('Elige la fecha y la hora') : null;
    const showErr = (key: string): string | null => (touched ? errors[key] ?? null : null);

    const previewItem: WhatsNewCardItem = {
        id: entry?.id ?? 0,
        kind: d.kind,
        title: d.title.trim() || __('Título de la novedad'),
        summary: d.summary.trim() || __('Una línea que diga qué puede hacer ahora la persona y dónde está.'),
        body: d.body,
        image_url: d.imageUrl.trim() && !errors.image_url ? d.imageUrl.trim() : null,
        video_url: d.videoUrl.trim() && whatsNewVideo(d.videoUrl.trim()) ? d.videoUrl.trim() : null,
        action: errors['action.label'] || errors['action.href'] || errors['action.tour'] || errors.action ? null : actionOf(d),
        published_at:
            d.publishMode === 'schedule' && fromLocalInput(d.publishAt)
                ? fromLocalInput(d.publishAt)
                : entry?.published_at ?? new Date().toISOString(),
        is_new: true,
    };

    const save = async (): Promise<void> => {
        setTouched(true);
        setError(null);
        if (!parsed.success || scheduleError) return;
        const content = contentOf(d);
        try {
            if (!entry) {
                const input: CreateWhatsNewInput = {
                    ...parsed.data,
                    status: d.publishMode === 'draft' ? 'draft' : 'published',
                    publish_at: d.publishMode === 'schedule' ? fromLocalInput(d.publishAt) : null,
                };
                await create.mutateAsync(input);
            } else {
                let input: UpdateWhatsNewInput = changedContent(contentOf(draftFrom(entry)), content);
                if (!isRelease && entry.status !== 'hidden') {
                    if (d.publishMode === 'draft') input = { ...input, status: 'draft' };
                    else if (d.publishMode === 'schedule') input = { ...input, status: 'published', publish_at: fromLocalInput(d.publishAt) };
                    else {
                        const wasFuture = entry.published_at !== null && parseUtcDate(entry.published_at).getTime() > Date.now();
                        input = entry.status === 'draft' || wasFuture
                            ? { ...input, status: 'published', publish_at: new Date().toISOString() }
                            : { ...input, status: 'published' };
                    }
                }
                const ok = updateWhatsNewSchema.safeParse(input);
                if (!ok.success) return;
                if (Object.keys(ok.data).length > 0) await update.mutateAsync({ id: entry.id, input: ok.data });
            }
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const doRestore = async (): Promise<void> => {
        if (!entry) return;
        setError(null);
        try {
            const res = await restore.mutateAsync(entry.id);
            setD(draftFrom(res));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const onPickImage = async (file: File | undefined): Promise<void> => {
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            set('imageUrl', await uploadWhatsNewImage(file));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const busy = create.isPending || update.isPending || restore.isPending;
    const toggleIn = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    const audienceText = (() => {
        const roles = d.roles.length === 0 ? __('Todas las personas') : d.roles.map((r) => __(AUDIENCE_ROLE_LABELS[r])).join(', ');
        const planNames = d.plans.map((p) => plans.data?.find((x) => x.slug === p)?.name ?? p);
        const planText = d.plans.length === 0 ? __('de cualquier plan') : sprintf(__('con plan %s'), planNames.join(', '));
        return `${roles} ${planText}`;
    })();

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 motion-safe:imcrm-animate-imcrm-fade-in" />
                <Dialog.Content
                    data-testid="whats-new-editor"
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-background sm:imcrm-inset-4 sm:imcrm-rounded-xl sm:imcrm-border sm:imcrm-border-border sm:imcrm-shadow-imcrm-lg lg:imcrm-inset-x-[max(1rem,calc((100vw-72rem)/2))]"
                >
                    <header className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3 sm:imcrm-px-5">
                        <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                            <Megaphone className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-truncate imcrm-text-base imcrm-font-semibold">
                                {entry ? __('Editar la novedad') : __('Nueva novedad')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                {isRelease
                                    ? sprintf(__('Viene con la versión %s'), entry?.version ?? '')
                                    : __('La verán las personas en «Novedades»')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close
                            aria-label={__('Cerrar')}
                            className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </Dialog.Close>
                    </header>

                    <div className="imcrm-grid imcrm-min-h-0 imcrm-flex-1 imcrm-grid-cols-1 imcrm-overflow-y-auto lg:imcrm-grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:imcrm-overflow-hidden">
                        {/* ───── Formulario ───── */}
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5 imcrm-p-4 sm:imcrm-p-5 lg:imcrm-overflow-y-auto">
                            {isRelease && (
                                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-info/30 imcrm-bg-info/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs">
                                    <Info className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-[hsl(var(--imcrm-info-ink))]" aria-hidden />
                                    <p className="imcrm-flex-1">
                                        {entry?.edited
                                            ? __('La cambiaste: las próximas versiones ya no le cambian el texto.')
                                            : __('Si la cambias, las próximas versiones ya no le cambian el texto. Puedes volver al original cuando quieras.')}
                                    </p>
                                    {entry?.edited && entry.in_catalog && (
                                        <Button type="button" size="sm" variant="outline" className="imcrm-h-7 imcrm-shrink-0" onClick={() => void doRestore()} disabled={busy} data-testid="whats-new-restore">
                                            <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                            {__('Restaurar el texto original')}
                                        </Button>
                                    )}
                                </div>
                            )}

                            <fieldset className="imcrm-m-0 imcrm-min-w-0 imcrm-border-0 imcrm-p-0 imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <legend className="imcrm-mb-1.5 imcrm-text-sm imcrm-font-medium">{__('Tipo')}</legend>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                                    {WHATS_NEW_KINDS.map((k) => {
                                        const Icon = WHATS_NEW_KIND_META[k].icon;
                                        const active = d.kind === k;
                                        return (
                                            <button
                                                key={k}
                                                type="button"
                                                aria-pressed={active}
                                                onClick={() => {
                                                    set('kind', k);
                                                    if (k === 'notice') setPreview('banner');
                                                    else if (preview === 'banner') setPreview(d.featured ? 'featured' : 'panel');
                                                }}
                                                data-whats-new-kind-option={k}
                                                className={cn(
                                                    'imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-text-[13px] imcrm-font-medium imcrm-transition-colors',
                                                    active ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-foreground' : 'imcrm-border-border hover:imcrm-bg-accent',
                                                )}
                                            >
                                                <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                                {kindLabel(k)}
                                            </button>
                                        );
                                    })}
                                </div>
                                {d.kind === 'notice' && (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Un aviso sale en una franja arriba de la app hasta que la persona lo cierra o vence. También lo ven los invitados.')}
                                    </p>
                                )}
                            </fieldset>

                            <Field id="wn-title" label={__('Título')} error={showErr('title')} hint={`${d.title.length}/${WHATS_NEW_LIMITS.title}`}>
                                <Input id="wn-title" value={d.title} maxLength={WHATS_NEW_LIMITS.title} onChange={(e) => set('title', e.target.value)} placeholder={__('Ej.: Exporta tus listas a Excel')} />
                            </Field>
                            <Field id="wn-summary" label={__('Resumen')} error={showErr('summary')} hint={`${d.summary.length}/${WHATS_NEW_LIMITS.summary}`}>
                                <Textarea id="wn-summary" rows={2} value={d.summary} maxLength={WHATS_NEW_LIMITS.summary} onChange={(e) => set('summary', e.target.value)} placeholder={__('Qué puede hacer ahora la persona y dónde está, en una o dos líneas.')} />
                            </Field>
                            <Field id="wn-body" label={__('Más detalle (opcional)')} error={showErr('body')}>
                                <Textarea id="wn-body" rows={5} value={d.body} maxLength={WHATS_NEW_LIMITS.body} onChange={(e) => set('body', e.target.value)} aria-describedby="wn-body-help" />
                                <p id="wn-body-help" className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {__('Se muestra en «Ver más». Formato: **negrita**, *cursiva*, líneas con «- » para viñetas y [texto](https://…) para enlaces.')}
                                </p>
                            </Field>

                            {/* Imagen */}
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <Label htmlFor="wn-image">{__('Imagen (opcional)')}</Label>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp,image/gif"
                                        className="imcrm-sr-only"
                                        id="wn-image-file"
                                        data-testid="whats-new-image-file"
                                        onChange={(e) => void onPickImage(e.target.files?.[0])}
                                    />
                                    <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                                        {uploading ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden /> : <ImagePlus className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                                        {__('Subir una imagen')}
                                    </Button>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('o pega un enlace https')}</span>
                                    {d.imageUrl && (
                                        <Button type="button" size="sm" variant="ghost" onClick={() => set('imageUrl', '')}>
                                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                            {__('Quitar')}
                                        </Button>
                                    )}
                                </div>
                                <Input id="wn-image" value={d.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://" />
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('PNG, JPG, WebP o GIF de hasta 5 MB.')}</p>
                                {showErr('image_url') && <p className="imcrm-text-xs imcrm-text-destructive">{showErr('image_url')}</p>}
                            </div>

                            <Field id="wn-video" label={__('Video (opcional)')} error={d.videoUrl.trim() ? errors.video_url ?? null : null} hint={__('Un enlace de YouTube, Vimeo o Loom.')}>
                                <Input id="wn-video" value={d.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
                            </Field>

                            {/* Botón */}
                            <fieldset className="imcrm-m-0 imcrm-min-w-0 imcrm-border-0 imcrm-p-0 imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <legend className="imcrm-mb-1.5 imcrm-text-sm imcrm-font-medium">{__('Botón')}</legend>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                                    {(
                                        [
                                            ['none', __('Sin botón')],
                                            ['route', __('Una pantalla de la app')],
                                            ['url', __('Un enlace')],
                                            ['tour', __('Un recorrido')],
                                        ] as Array<[ActionMode, string]>
                                    ).map(([m, label]) => (
                                        <button
                                            key={m}
                                            type="button"
                                            aria-pressed={d.actionMode === m}
                                            onClick={() => {
                                                set('actionMode', m);
                                                if (m !== 'none' && d.actionLabel.trim() === '') set('actionLabel', m === 'tour' ? __('Pruébalo') : __('Ver'));
                                            }}
                                            data-whats-new-action-mode={m}
                                            className={cn(
                                                'imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-text-[13px] imcrm-transition-colors',
                                                d.actionMode === m ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium' : 'imcrm-border-border hover:imcrm-bg-accent',
                                            )}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {d.actionMode !== 'none' && (
                                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                        <Field id="wn-action-label" label={__('Texto del botón')} error={showErr('action.label')}>
                                            <Input id="wn-action-label" value={d.actionLabel} maxLength={WHATS_NEW_LIMITS.actionLabel} onChange={(e) => set('actionLabel', e.target.value)} />
                                        </Field>
                                        {d.actionMode === 'route' && (
                                            <Field id="wn-action-route" label={__('Pantalla')} error={showErr('action.href')} hint={__('Empieza con /, por ejemplo /lists')}>
                                                <Input id="wn-action-route" list="wn-route-suggestions" value={d.actionRoute} onChange={(e) => set('actionRoute', e.target.value)} placeholder="/lists" />
                                            </Field>
                                        )}
                                        {d.actionMode === 'url' && (
                                            <Field id="wn-action-url" label={__('Enlace')} error={showErr('action.href')} hint={__('Se abre en otra pestaña.')}>
                                                <Input id="wn-action-url" value={d.actionUrl} onChange={(e) => set('actionUrl', e.target.value)} placeholder="https://" />
                                            </Field>
                                        )}
                                        {d.actionMode === 'tour' && (
                                            <>
                                                <Field id="wn-action-tour" label={__('Recorrido')} error={showErr('action.tour')}>
                                                    <Input id="wn-action-tour" list="wn-tour-suggestions" value={d.actionTour} onChange={(e) => set('actionTour', e.target.value)} placeholder="views" />
                                                </Field>
                                                <Field
                                                    id="wn-action-fallback"
                                                    label={__('Si el recorrido no está, ir a')}
                                                    error={showErr('action.href')}
                                                    hint={__('Una pantalla de la app (recomendado).')}
                                                >
                                                    <Input id="wn-action-fallback" list="wn-route-suggestions" value={d.actionTourFallback} onChange={(e) => set('actionTourFallback', e.target.value)} placeholder="/lists" />
                                                </Field>
                                            </>
                                        )}
                                    </div>
                                )}
                                <datalist id="wn-route-suggestions">
                                    {ROUTE_SUGGESTIONS.map((r) => (
                                        <option key={r} value={r} />
                                    ))}
                                </datalist>
                                <datalist id="wn-tour-suggestions">
                                    {WHATS_NEW_TOUR_SUGGESTIONS.map((t) => (
                                        <option key={t} value={t} />
                                    ))}
                                </datalist>
                            </fieldset>

                            {/* Publicación */}
                            {!isRelease && entry?.status !== 'hidden' && (
                                <fieldset className="imcrm-m-0 imcrm-min-w-0 imcrm-border-0 imcrm-p-0 imcrm-flex imcrm-flex-col imcrm-gap-2">
                                    <legend className="imcrm-mb-1.5 imcrm-text-sm imcrm-font-medium">{__('Publicación')}</legend>
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                                        {(
                                            [
                                                ['now', entry && entry.status === 'published' && entry.published_at && parseUtcDate(entry.published_at).getTime() <= Date.now() ? __('Publicada') : __('Publicar ahora')],
                                                ['schedule', __('Programar')],
                                                ['draft', __('Borrador')],
                                            ] as Array<[PublishMode, string]>
                                        ).map(([m, label]) => (
                                            <button
                                                key={m}
                                                type="button"
                                                aria-pressed={d.publishMode === m}
                                                onClick={() => set('publishMode', m)}
                                                data-whats-new-publish={m}
                                                className={cn(
                                                    'imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-text-[13px] imcrm-transition-colors',
                                                    d.publishMode === m ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium' : 'imcrm-border-border hover:imcrm-bg-accent',
                                                )}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    {d.publishMode === 'schedule' && (
                                        <Field id="wn-publish-at" label={__('Fecha y hora de publicación')} error={touched ? scheduleError : null} hint={__('En la hora de este equipo.')}>
                                            <Input id="wn-publish-at" type="datetime-local" value={d.publishAt} onChange={(e) => set('publishAt', e.target.value)} />
                                        </Field>
                                    )}
                                    {d.publishMode === 'draft' && (
                                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Nadie la ve hasta que la publiques.')}</p>
                                    )}
                                </fieldset>
                            )}
                            {!isRelease && entry?.status === 'hidden' && (
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Está oculta: nadie la ve. Para mostrarla, usa «Mostrar» en la lista.')}</p>
                            )}

                            <Field
                                id="wn-expires"
                                label={d.kind === 'notice' ? __('Deja de verse (recomendado para avisos)') : __('Deja de verse (opcional)')}
                                error={showErr('expires_at')}
                                hint={__('En la hora de este equipo. Vacío = no vence.')}
                            >
                                <Input id="wn-expires" type="datetime-local" value={d.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
                            </Field>

                            {/* Público */}
                            <fieldset className="imcrm-m-0 imcrm-min-w-0 imcrm-border-0 imcrm-p-0 imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <legend className="imcrm-mb-1.5 imcrm-text-sm imcrm-font-medium">{__('Quién la ve')}</legend>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sin marcar nada, la ven todas las personas de todos los planes.')}</p>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-2">
                                    {WHATS_NEW_AUDIENCE_ROLES.map((r) => (
                                        <label key={r} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                                            <input type="checkbox" checked={d.roles.includes(r)} onChange={() => set('roles', toggleIn(d.roles, r))} data-whats-new-role={r} />
                                            {__(AUDIENCE_ROLE_LABELS[r])}
                                        </label>
                                    ))}
                                </div>
                                {d.roles.includes('guest') && d.kind !== 'notice' && (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Los invitados sólo ven avisos.')}</p>
                                )}
                                {(plans.data ?? []).length > 0 && (
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-2 imcrm-pt-1">
                                        {(plans.data ?? []).map((p) => (
                                            <label key={p.slug} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                                                <input type="checkbox" checked={d.plans.includes(p.slug)} onChange={() => set('plans', toggleIn(d.plans, p.slug))} data-whats-new-plan={p.slug} />
                                                {sprintf(__('Plan %s'), p.name)}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </fieldset>

                            {d.kind !== 'notice' && (
                                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-sm">
                                    <input
                                        type="checkbox"
                                        className="imcrm-mt-0.5"
                                        checked={d.featured}
                                        onChange={(e) => {
                                            set('featured', e.target.checked);
                                            setPreview(e.target.checked ? 'featured' : 'panel');
                                        }}
                                        data-testid="whats-new-featured-toggle"
                                    />
                                    <span>
                                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium">
                                            <Star className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" aria-hidden />
                                            {__('Destacada')}
                                        </span>
                                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                            {__('Se presenta en un diálogo al entrar, una sola vez a cada persona. Úsala para lo más importante.')}
                                        </span>
                                    </span>
                                </label>
                            )}

                            <Field id="wn-version" label={__('Versión (opcional)')} error={showErr('version')} hint={__('Para tu referencia; la persona no la ve.')}>
                                <Input id="wn-version" value={d.version} onChange={(e) => set('version', e.target.value)} placeholder="0.1.320" disabled={isRelease} />
                            </Field>
                        </div>

                        {/* ───── Vista previa ───── */}
                        <aside
                            aria-label={__('Vista previa')}
                            className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-bg-canvas imcrm-p-4 sm:imcrm-p-5 lg:imcrm-overflow-y-auto lg:imcrm-border-l lg:imcrm-border-t-0"
                            data-testid="whats-new-preview"
                            // En la vista previa los botones y enlaces no llevan a ningún lado.
                            onClickCapture={(e) => {
                                if ((e.target as HTMLElement).closest('a, [data-whats-new-action]')) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }
                            }}
                        >
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Así la verán')}</h3>
                                <div role="tablist" aria-label={__('Dónde')} className="imcrm-flex imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5 imcrm-text-[11px]">
                                    {(
                                        [
                                            ['panel', __('Panel')],
                                            ...(d.kind === 'notice' ? [['banner', __('Franja')]] : []),
                                            ...(d.featured && d.kind !== 'notice' ? [['featured', __('Diálogo')]] : []),
                                        ] as Array<['panel' | 'featured' | 'banner', string]>
                                    ).map(([id, label]) => (
                                        <button
                                            key={id}
                                            type="button"
                                            role="tab"
                                            aria-selected={preview === id}
                                            onClick={() => setPreview(id)}
                                            className={cn('imcrm-rounded imcrm-px-2 imcrm-py-0.5', preview === id ? 'imcrm-bg-background imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground')}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="whats-new-audience-text">
                                {sprintf(__('La verán: %s.'), audienceText)}
                            </p>
                            {preview === 'banner' && d.kind === 'notice' ? (
                                <div className="imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background">
                                    <WhatsNewNoticeRow notice={previewItem} onDismiss={() => undefined} />
                                </div>
                            ) : preview === 'featured' && d.featured && d.kind !== 'notice' ? (
                                <div className="imcrm-flex imcrm-max-h-[34rem] imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg">
                                    <FeaturedWhatsNewContent
                                        item={previewItem}
                                        renderTitle={(c) => <h4 className="imcrm-text-lg imcrm-font-semibold imcrm-leading-snug imcrm-tracking-tight">{c}</h4>}
                                        renderSummary={(c) => <p className="imcrm-text-sm imcrm-leading-relaxed imcrm-text-muted-foreground">{c}</p>}
                                    />
                                </div>
                            ) : (
                                <WhatsNewCard item={previewItem} highlightNew defaultExpanded />
                            )}
                        </aside>
                    </div>

                    <footer className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-3 sm:imcrm-px-5">
                        {error && <p className="imcrm-mr-auto imcrm-text-sm imcrm-text-destructive" role="alert">{error}</p>}
                        {touched && (!parsed.success || scheduleError) && !error && (
                            <p className="imcrm-mr-auto imcrm-text-sm imcrm-text-destructive" role="alert">{__('Revisa los campos marcados.')}</p>
                        )}
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            {__('Cancelar')}
                        </Button>
                        <Button type="button" onClick={() => void save()} disabled={busy} data-testid="whats-new-save">
                            {busy && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden />}
                            {entry ? __('Guardar') : d.publishMode === 'draft' ? __('Guardar borrador') : d.publishMode === 'schedule' ? __('Programar') : __('Publicar')}
                        </Button>
                    </footer>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Field({
    id,
    label,
    error,
    hint,
    children,
}: {
    id: string;
    label: string;
    error?: string | null;
    hint?: string;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                <Label htmlFor={id}>{label}</Label>
                {hint && !error && <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</span>}
            </div>
            {children}
            {error && (
                <p className="imcrm-text-xs imcrm-text-destructive" id={`${id}-error`}>
                    {error}
                </p>
            )}
        </div>
    );
}
