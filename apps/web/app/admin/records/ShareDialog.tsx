import { forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    CalendarClock,
    Check,
    ChevronDown,
    Code2,
    Copy,
    ExternalLink,
    Eye,
    Globe,
    Link2,
    Lock,
    Users,
    X,
    type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { useListGuests } from '@/hooks/useGuests';
import { useListPermissions } from '@/hooks/usePermissions';
import { usePublicList, useUpdatePublicList, publicListUrl } from '@/hooks/usePublicList';
import { useSavedViews } from '@/hooks/useSavedViews';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { cn } from '@/lib/utils';
import type { UpdatePublicListInput } from '@imagina-base/shared';

import { DomainChips } from '@/admin/forms/DomainChips';
import { IconSquare } from '@/admin/lists/FolderBadge';
import { ListAccessPanel } from '@/admin/lists/ListAccessPanel';
import { publicFieldIds } from '@/admin/lists/publicListFields';
import { Switch } from '@/admin/widgets/widgetUi';
import { PlanModuleNotice, usePlanModuleOff } from '@/components/PlanModuleNotice';

export type ListShareTab = 'people' | 'public';

interface ShareDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    listName: string;
    /** Para el enlace de la lista y el atajo a «Permisos por rol». */
    listSlug?: string;
    listIcon?: string | null;
    listColor?: string | null;
    /** Sólo quien administra la lista da accesos y la publica hacia afuera. */
    canPublish: boolean;
    initialTab?: ListShareTab;
}

/**
 * «Compartir» de una lista (v0.1.128; rediseñado en v0.1.410).
 *
 * Dos pestañas en un control segmentado, como el de formularios y agenda:
 *
 *  1. **Personas**: un buscador para sumar a alguien de la empresa, a un
 *     equipo o a una persona de afuera por su correo, y UNA lista con quién
 *     tiene acceso (antes eran tres secciones apiladas). Abajo, el enlace de
 *     la lista, que sólo abre quien tiene acceso.
 *  2. **Enlace público**: la página de SOLO LECTURA con token opaco
 *     (ADR-S14), con un interruptor, el enlace, qué se ve y hasta cuándo.
 */
export function ShareDialog({
    open,
    onOpenChange,
    listId,
    listName,
    listSlug,
    listIcon: iconKey,
    listColor: colorHex,
    canPublish,
    initialTab = 'people',
}: ShareDialogProps): JSX.Element {
    const [tab, setTab] = useState<ListShareTab>(initialTab);
    const publicOff = usePlanModuleOff('public_sharing');
    const publicQuery = usePublicList(canPublish && !publicOff ? listId : undefined);
    const published = publicQuery.data?.enabled === true;
    // Los mismos pedidos que hace la pestaña Personas: el contador sale del caché.
    const perms = useListPermissions(canPublish ? listId : undefined);
    const guests = useListGuests(listId, canPublish);
    const accessCount =
        (perms.data?.users ?? []).filter((u) => !u.is_guest).length + (perms.data?.teams ?? []).length + (guests.data ?? []).length;

    const TABS: Array<{ id: ListShareTab; label: string; icon: LucideIcon; extra?: ReactNode }> = [
        {
            id: 'people',
            label: __('Personas'),
            icon: Users,
            extra:
                canPublish && accessCount > 0 ? (
                    <span className="imcrm-rounded-full imcrm-bg-muted-foreground/15 imcrm-px-1.5 imcrm-text-[11px] imcrm-font-semibold imcrm-tabular-nums" data-testid="share-tab-count">
                        {accessCount}
                    </span>
                ) : null,
        },
        {
            id: 'public',
            label: __('Enlace público'),
            icon: Globe,
            extra: published ? <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-success" aria-label={__('Publicada')} /> : null,
        },
    ];

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/45 imcrm-backdrop-blur-sm" />
                <ShareContent data-testid="list-share-dialog" data-tab={tab}>
                    <header className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-pb-3 imcrm-pt-4 sm:imcrm-px-5">
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-3 imcrm-pr-9">
                            <IconSquare icon={listIcon(iconKey) ?? DEFAULT_LIST_ICON} color={listColor(colorHex)} size="lg" />
                            <div className="imcrm-min-w-0">
                                <Dialog.Title className="imcrm-truncate imcrm-text-base imcrm-font-semibold imcrm-leading-tight">
                                    {sprintf(/* translators: %s: list name */ __('Compartir «%s»'), listName)}
                                </Dialog.Title>
                                <Dialog.Description className="imcrm-mt-0.5 imcrm-truncate imcrm-text-[13px] imcrm-text-muted-foreground">
                                    {__('Con personas de tu empresa, con alguien de afuera o con un enlace público.')}
                                </Dialog.Description>
                            </div>
                        </div>
                        <div
                            role="tablist"
                            aria-label={__('Cómo compartir')}
                            className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-0.5 imcrm-self-stretch imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5 sm:imcrm-inline-grid sm:imcrm-self-start"
                        >
                            {TABS.map((t) => {
                                const Icon = t.icon;
                                const on = t.id === tab;
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={on}
                                        onClick={() => setTab(t.id)}
                                        className={cn(
                                            'imcrm-inline-flex imcrm-h-8 imcrm-min-w-0 imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-whitespace-nowrap imcrm-rounded-md imcrm-px-3 imcrm-text-sm imcrm-transition-colors',
                                            on ? 'imcrm-bg-card imcrm-font-medium imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                        )}
                                        data-testid={`list-share-tab-${t.id}`}
                                    >
                                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                                        <span className="imcrm-truncate">{t.label}</span>
                                        {t.extra}
                                    </button>
                                );
                            })}
                        </div>
                    </header>

                    {tab === 'people' ? (
                        <PeopleTab listId={listId} listSlug={listSlug} canPublish={canPublish} onNavigate={() => onOpenChange(false)} />
                    ) : (
                        <PublicTab listId={listId} canPublish={canPublish} publicOff={publicOff} />
                    )}
                </ShareContent>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

// forwardRef: el portal de Radix le pasa una ref al hijo.
const ShareContent = forwardRef<HTMLDivElement, { children: ReactNode; 'data-testid'?: string; 'data-tab'?: string }>(function ShareContent(
    { children, ...rest },
    ref,
) {
    return (
        <Dialog.Content
            ref={ref}
            {...rest}
            // Radix escucha Escape antes que nadie: con el buscador escrito o
            // abierto, Escape limpia la búsqueda (lo hace el buscador) y no
            // cierra la ventana.
            onEscapeKeyDown={(e) => {
                const el = document.activeElement;
                if (el instanceof HTMLInputElement && el.dataset.escapeClears !== undefined && (el.value !== '' || el.getAttribute('aria-expanded') === 'true')) {
                    e.preventDefault();
                }
            }}
            // En el celular ocupa toda la pantalla; en la computadora, una ventana
            // al centro del alto de lo que muestra.
            className={cn(
                'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-bg-card imcrm-shadow-imcrm-xl',
                'sm:imcrm-inset-auto sm:imcrm-left-1/2 sm:imcrm-top-1/2 sm:-imcrm-translate-x-1/2 sm:-imcrm-translate-y-1/2 sm:imcrm-rounded-2xl sm:imcrm-border sm:imcrm-border-border',
                'sm:imcrm-max-h-[min(90dvh,780px)] sm:imcrm-w-[min(600px,calc(100vw-2rem))]',
            )}
        >
            <Dialog.Close asChild>
                <button
                    type="button"
                    aria-label={__('Cerrar')}
                    className="imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-z-10 imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    data-testid="list-share-close"
                >
                    <X className="imcrm-h-4 imcrm-w-4" />
                </button>
            </Dialog.Close>
            {children}
        </Dialog.Content>
    );
});

function useCopy(): { copied: string | null; copy: (text: string, which: string) => Promise<void> } {
    const [copied, setCopied] = useState<string | null>(null);
    return {
        copied,
        copy: async (text, which) => {
            try {
                await navigator.clipboard.writeText(text);
                setCopied(which);
                window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600);
            } catch {
                /* portapapeles bloqueado — no-op */
            }
        },
    };
}

// ── Personas ───────────────────────────────────────────────────────────

function PeopleTab({
    listId,
    listSlug,
    canPublish,
    onNavigate,
}: {
    listId: number;
    listSlug?: string;
    canPublish: boolean;
    onNavigate: () => void;
}): JSX.Element {
    const { copied, copy } = useCopy();
    // El enlace de la LISTA (no el de la pantalla actual: desde el menú
    // lateral se abre con otra cosa a la vista).
    const privateUrl = listSlug
        ? `${window.location.origin}${window.location.pathname}#/lists/${listSlug}/records`
        : window.location.href;

    return (
        <>
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-4 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4 sm:imcrm-px-5" data-testid="list-share-body" data-tab="people">
                {canPublish ? (
                    <ListAccessPanel listId={listId} listSlug={listSlug} onNavigate={onNavigate} />
                ) : (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2.5">
                            <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary" aria-hidden>
                                <Users className="imcrm-h-4 imcrm-w-4" />
                            </span>
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                <span className="imcrm-text-sm imcrm-font-medium">{__('Todos en la empresa')}</span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Entran según su rol y los accesos que tenga la lista.')}</span>
                            </span>
                        </div>
                        <LockedNote text={__('Darle acceso a personas, equipos o alguien de afuera lo hace quien administra la lista.')} />
                    </div>
                )}
            </div>
            <footer className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-2 imcrm-border-t imcrm-border-border imcrm-bg-muted/30 imcrm-px-4 imcrm-py-3 sm:imcrm-px-5">
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <Lock className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                    <span className="imcrm-min-w-0">{__('El enlace de la lista sólo lo abre quien tiene acceso.')}</span>
                </span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="imcrm-shrink-0 imcrm-gap-1.5"
                    onClick={() => void copy(privateUrl, 'private')}
                    data-testid="list-share-copy-private"
                >
                    {copied === 'private' ? <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-success" /> : <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {copied === 'private' ? __('Copiado') : __('Copiar enlace')}
                </Button>
            </footer>
        </>
    );
}

function LockedNote({ text }: { text: string }): JSX.Element {
    return (
        <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="list-share-locked">
            <Lock className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
            {text}
        </p>
    );
}

// ── Enlace público ─────────────────────────────────────────────────────

function todayYmd(): string {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function PublicTab({ listId, canPublish, publicOff }: { listId: number; canPublish: boolean; publicOff: boolean }): JSX.Element {
    const query = usePublicList(canPublish && !publicOff ? listId : undefined);
    const update = useUpdatePublicList(listId);
    const fields = useFields(listId);
    const views = useSavedViews(listId);
    const toast = useToast();
    const { copied, copy } = useCopy();

    const [enabled, setEnabled] = useState(false);
    const [visible, setVisible] = useState<string[]>([]);
    const [viewId, setViewId] = useState<number | null>(null);
    const [expiresAt, setExpiresAt] = useState<string>('');
    const [domains, setDomains] = useState<string[]>([]);
    const [dirty, setDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const reset = (): void => {
        if (!query.data) return;
        setEnabled(query.data.enabled);
        setVisible(query.data.visible_field_slugs);
        setViewId(query.data.view_id);
        setExpiresAt(query.data.expires_at ?? '');
        setDomains(query.data.allowed_domains);
        setDirty(false);
        setSubmitError(null);
    };
    useEffect(reset, [query.data]);

    const allFields = fields.data ?? [];
    const publicUrl = useMemo(() => publicListUrl(query.data?.public_path ?? null), [query.data?.public_path]);
    const embedSnippet = publicUrl
        ? `<iframe src="${publicUrl}" width="100%" height="600" loading="lazy" frameborder="0" style="border:1px solid #e5e7eb;border-radius:8px"></iframe>`
        : '';
    const expired = expiresAt !== '' && expiresAt < todayYmd();

    if (publicOff) {
        return (
            <PublicBody>
                <PlanModuleNotice module="public_sharing" compact />
            </PublicBody>
        );
    }
    if (!canPublish) {
        return (
            <PublicBody>
                <LockedNote text={__('Publicar la lista hacia afuera lo hace quien administra la lista.')} />
            </PublicBody>
        );
    }

    const save = async (patch: UpdatePublicListInput): Promise<boolean> => {
        setSubmitError(null);
        try {
            await update.mutateAsync(patch);
            setDirty(false);
            return true;
        } catch (err) {
            setSubmitError(err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'));
            return false;
        }
    };

    const currentInput = (): UpdatePublicListInput => ({
        enabled,
        visible_field_ids: publicFieldIds(visible, allFields),
        view_id: viewId,
        expires_at: expiresAt === '' ? null : expiresAt,
        allowed_domains: domains,
    });

    /** El interruptor publica o despublica al instante: es la acción principal. */
    const togglePublish = async (next: boolean): Promise<void> => {
        setEnabled(next);
        // Al publicar por primera vez sin campos elegidos no se vería nada:
        // arranca mostrando todo, que es lo que la gente espera.
        const nextVisible = next && visible.length === 0 ? allFields.map((f) => f.slug) : visible;
        setVisible(nextVisible);
        const ok = await save({ ...currentInput(), enabled: next, visible_field_ids: publicFieldIds(nextVisible, allFields) });
        if (ok) toast.success(next ? __('Lista publicada') : __('Lista despublicada'));
        else setEnabled(!next);
    };

    const toggleField = (slug: string): void => {
        setVisible((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
        setDirty(true);
    };

    return (
        <>
            <PublicBody>
                {/* Estado + interruptor */}
                <div
                    className={cn(
                        'imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-p-3.5 imcrm-transition-colors',
                        enabled ? 'imcrm-border-success/30 imcrm-bg-success/[0.06]' : 'imcrm-border-border',
                    )}
                    data-testid="list-share-public-status"
                    data-published={enabled ? '' : undefined}
                >
                    <span
                        className={cn(
                            'imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full',
                            enabled ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                        )}
                        aria-hidden
                    >
                        <Globe className="imcrm-h-5 imcrm-w-5" />
                    </span>
                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                        <span className="imcrm-text-sm imcrm-font-semibold">
                            {enabled ? __('Publicada en una página pública') : __('Página pública apagada')}
                        </span>
                        <span className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                            {enabled
                                ? __('Cualquiera con el enlace la ve, sin cuenta. Es de sólo lectura: nadie puede cambiar nada desde ahí.')
                                : __('Enciéndela para que cualquiera con el enlace vea la lista sin cuenta (sólo lectura). Tú eliges qué se ve.')}
                        </span>
                    </span>
                    <Switch
                        checked={enabled}
                        onChange={(v) => void togglePublish(v)}
                        label={__('Publicar en una página que cualquiera pueda abrir')}
                        disabled={update.isPending || query.isLoading}
                        testId="list-share-public-toggle"
                    />
                </div>

                {enabled && (
                    <>
                        {expired && (
                            <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2.5 imcrm-text-xs imcrm-text-foreground" data-testid="list-share-expired">
                                <CalendarClock className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                {__('El enlace ya venció: nadie lo puede abrir. Cambia o quita la fecha para volver a usarlo.')}
                            </p>
                        )}

                        {/* El enlace */}
                        {publicUrl && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-xl imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-1 imcrm-pl-3">
                                    <Link2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                    <input
                                        readOnly
                                        value={publicUrl}
                                        onFocus={(e) => e.currentTarget.select()}
                                        aria-label={__('Enlace público')}
                                        className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1 imcrm-bg-transparent imcrm-font-mono imcrm-text-xs imcrm-outline-none"
                                        data-testid="list-share-public-url"
                                    />
                                    <a
                                        href={publicUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label={__('Abrir la página pública')}
                                        title={__('Abrir la página pública')}
                                        className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                    >
                                        <ExternalLink className="imcrm-h-4 imcrm-w-4" />
                                    </a>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="imcrm-h-8 imcrm-shrink-0 imcrm-gap-1.5"
                                        onClick={() => void copy(publicUrl, 'public')}
                                        data-testid="list-share-copy-public"
                                    >
                                        {copied === 'public' ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                                        {copied === 'public' ? __('Copiado') : __('Copiar')}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Qué se ve */}
                        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                            <SectionTitle icon={Eye} title={__('Qué se ve')} />
                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <span className="imcrm-text-xs imcrm-font-medium">{__('Registros')}</span>
                                    <Select
                                        value={viewId ?? ''}
                                        onChange={(e) => {
                                            setViewId(e.target.value === '' ? null : parseInt(e.target.value, 10));
                                            setDirty(true);
                                        }}
                                        data-testid="list-share-view"
                                    >
                                        <option value="">{__('Todos los de la lista')}</option>
                                        {(views.data ?? []).map((v) => (
                                            <option key={v.id} value={v.id}>
                                                {sprintf(/* translators: %s: saved view name */ __('Los de la vista «%s»'), v.name)}
                                            </option>
                                        ))}
                                    </Select>
                                    <span className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                        {viewId === null ? __('Salen todos los registros.') : __('Salen sólo los que pasan los filtros de esa vista.')}
                                    </span>
                                </label>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <label htmlFor="list-share-expires" className="imcrm-text-xs imcrm-font-medium">
                                        {__('Vence')}
                                    </label>
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                        <input
                                            id="list-share-expires"
                                            type="date"
                                            value={expiresAt}
                                            onChange={(e) => {
                                                setExpiresAt(e.target.value);
                                                setDirty(true);
                                            }}
                                            className="imcrm-h-9 imcrm-min-w-0 imcrm-flex-1 imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-card imcrm-px-3 imcrm-text-sm imcrm-shadow-imcrm-inset focus-visible:imcrm-border-primary focus-visible:imcrm-outline-none focus-visible:imcrm-ring-4 focus-visible:imcrm-ring-primary/15"
                                            data-testid="list-share-expires"
                                        />
                                        {expiresAt !== '' && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setExpiresAt('');
                                                    setDirty(true);
                                                }}
                                                aria-label={__('Quitar la fecha')}
                                                title={__('Quitar la fecha')}
                                                className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                            >
                                                <X className="imcrm-h-4 imcrm-w-4" />
                                            </button>
                                        )}
                                    </div>
                                    <span className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                        {expiresAt === '' ? __('Sin fecha: no vence.') : __('Después de ese día el enlace deja de abrir.')}
                                    </span>
                                </div>
                            </div>

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                    <span className="imcrm-text-xs imcrm-font-medium">
                                        {__('Columnas')}{' '}
                                        <span className="imcrm-font-normal imcrm-text-muted-foreground" data-testid="list-share-fields-count">
                                            {sprintf(__('%1$d de %2$d'), visible.filter((s) => allFields.some((f) => f.slug === s)).length, allFields.length)}
                                        </span>
                                    </span>
                                    <span className="imcrm-flex imcrm-gap-0.5">
                                        <button
                                            type="button"
                                            className="imcrm-rounded-md imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-text-primary hover:imcrm-bg-primary/10"
                                            onClick={() => {
                                                setVisible(allFields.map((f) => f.slug));
                                                setDirty(true);
                                            }}
                                        >
                                            {__('Todas')}
                                        </button>
                                        <button
                                            type="button"
                                            className="imcrm-rounded-md imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                            onClick={() => {
                                                setVisible([]);
                                                setDirty(true);
                                            }}
                                        >
                                            {__('Ninguna')}
                                        </button>
                                    </span>
                                </div>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" data-testid="list-share-fields">
                                    {allFields.map((f) => {
                                        const on = visible.includes(f.slug);
                                        return (
                                            <button
                                                key={f.id}
                                                type="button"
                                                aria-pressed={on}
                                                onClick={() => toggleField(f.slug)}
                                                className={cn(
                                                    'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-py-1 imcrm-pl-2 imcrm-pr-2.5 imcrm-text-xs imcrm-transition-colors',
                                                    on
                                                        ? 'imcrm-border-primary/40 imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary'
                                                        : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-border-foreground/30 hover:imcrm-text-foreground',
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        'imcrm-flex imcrm-h-3.5 imcrm-w-3.5 imcrm-items-center imcrm-justify-center imcrm-rounded-full',
                                                        on ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border imcrm-border-muted-foreground/40',
                                                    )}
                                                    aria-hidden
                                                >
                                                    {on && <Check className="imcrm-h-2.5 imcrm-w-2.5" strokeWidth={3} />}
                                                </span>
                                                {f.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <span className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                    {__('Lo que no marques nunca sale de la app.')}
                                </span>
                            </div>
                        </section>

                        {/* Insertar en otra web */}
                        <details className="imcrm-group imcrm-rounded-xl imcrm-border imcrm-border-border" data-testid="list-share-embed">
                            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2.5 imcrm-px-3.5 imcrm-py-3 [&::-webkit-details-marker]:imcrm-hidden">
                                <Code2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                    <span className="imcrm-text-sm imcrm-font-medium">{__('Insertar en tu sitio web')}</span>
                                    <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                        {domains.length === 0
                                            ? __('El código y los sitios que pueden insertarla (hoy: cualquiera).')
                                            : sprintf(__('El código y los sitios que pueden insertarla (hoy: %s).'), domains.join(', '))}
                                    </span>
                                </span>
                                <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform group-open:imcrm-rotate-180" aria-hidden />
                            </summary>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-px-3.5 imcrm-py-3">
                                {embedSnippet && (
                                    <div className="imcrm-relative">
                                        <pre className="imcrm-max-h-32 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded-lg imcrm-bg-muted imcrm-p-3 imcrm-pr-24 imcrm-font-mono imcrm-text-[11.5px] imcrm-leading-relaxed" data-testid="list-share-embed-code">
                                            {embedSnippet}
                                        </pre>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-h-7 imcrm-gap-1.5 imcrm-bg-card"
                                            onClick={() => void copy(embedSnippet, 'embed')}
                                            data-testid="list-share-copy-embed"
                                        >
                                            {copied === 'embed' ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                                            {copied === 'embed' ? __('Copiado') : __('Copiar')}
                                        </Button>
                                    </div>
                                )}
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <span className="imcrm-text-xs imcrm-font-medium">{__('Sitios que pueden insertarla')}</span>
                                    <DomainChips
                                        value={domains}
                                        onChange={(v) => {
                                            setDomains(v);
                                            setDirty(true);
                                        }}
                                        testId="list-share-domains"
                                        autoFocus={false}
                                    />
                                    <span className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                        {__('Sin sitios, cualquier web puede insertarla. Escribe tusitio.com y Enter; *.tusitio.com vale para todos sus subdominios.')}
                                    </span>
                                </div>
                            </div>
                        </details>
                    </>
                )}

                {submitError !== null && (
                    <p className="imcrm-rounded-xl imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2.5 imcrm-text-sm imcrm-text-destructive" role="alert">
                        {submitError}
                    </p>
                )}
            </PublicBody>

            {enabled && (
                <footer className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-bg-muted/30 imcrm-px-4 imcrm-py-3 sm:imcrm-px-5" data-testid="list-share-public-footer">
                    <span className={cn('imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs', dirty ? 'imcrm-font-medium imcrm-text-foreground' : 'imcrm-text-muted-foreground')}>
                        <span className={cn('imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full', dirty ? 'imcrm-bg-warning' : 'imcrm-bg-success')} aria-hidden />
                        {dirty ? __('Tienes cambios sin guardar') : __('Todo guardado')}
                    </span>
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        {dirty && (
                            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={update.isPending}>
                                {__('Descartar')}
                            </Button>
                        )}
                        <Button type="button" size="sm" onClick={() => void save(currentInput())} disabled={!dirty || update.isPending} data-testid="list-share-save">
                            {update.isPending ? __('Guardando…') : __('Guardar')}
                        </Button>
                    </span>
                </footer>
            )}
        </>
    );
}

function PublicBody({ children }: { children: ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-4 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4 sm:imcrm-px-5" data-testid="list-share-body" data-tab="public">
            {children}
        </div>
    );
}

function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }): JSX.Element {
    return (
        <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.06em] imcrm-text-muted-foreground">
            <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            {title}
        </h3>
    );
}
