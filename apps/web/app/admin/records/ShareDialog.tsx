import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, Globe, Link2, Lock, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { usePublicList, useUpdatePublicList, publicListUrl } from '@/hooks/usePublicList';
import { useSavedViews } from '@/hooks/useSavedViews';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { UpdatePublicListInput } from '@imagina-base/shared';

interface ShareDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    listName: string;
    /** Sólo quien administra la lista puede publicarla hacia afuera. */
    canPublish: boolean;
}

/**
 * "Compartir" (v0.1.128) — el diálogo que se abre desde la cabecera de la
 * lista, al estilo de ClickUp.
 *
 * Dos niveles bien separados, porque confundirlos es cómo se filtran datos:
 *
 *  1. **Con tu equipo**: el enlace de siempre, que sólo abre quien tiene
 *     cuenta en el workspace y permiso sobre la lista.
 *  2. **Con cualquiera**: publica una página de SOLO LECTURA en una
 *     dirección con token opaco (ADR-S14). Se elige qué se publica (toda la
 *     lista o una vista guardada, con sus filtros), qué campos se ven,
 *     hasta cuándo vale el enlace y desde qué sitios puede insertarse.
 *
 * La configuración es la misma que vive en Ajustes → Compartir: acá está
 * a un click de donde se usa.
 */
export function ShareDialog({
    open,
    onOpenChange,
    listId,
    listName,
    canPublish,
}: ShareDialogProps): JSX.Element {
    const query = usePublicList(canPublish ? listId : undefined);
    const update = useUpdatePublicList(listId);
    const fields = useFields(listId);
    const views = useSavedViews(listId);
    const toast = useToast();

    const [enabled, setEnabled] = useState(false);
    const [visible, setVisible] = useState<string[]>([]);
    const [viewId, setViewId] = useState<number | null>(null);
    const [expiresAt, setExpiresAt] = useState<string>('');
    const [domains, setDomains] = useState('');
    const [dirty, setDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [copied, setCopied] = useState<'private' | 'public' | 'embed' | null>(null);

    useEffect(() => {
        if (query.data) {
            setEnabled(query.data.enabled);
            setVisible(query.data.visible_field_slugs);
            setViewId(query.data.view_id);
            setExpiresAt(query.data.expires_at ?? '');
            setDomains(query.data.allowed_domains.join('\n'));
            setDirty(false);
        }
    }, [query.data]);

    const allFields = fields.data ?? [];
    const publicUrl = useMemo(
        () => publicListUrl(query.data?.public_path ?? null),
        [query.data?.public_path],
    );
    const embedSnippet = publicUrl
        ? `<iframe src="${publicUrl}" width="100%" height="600" frameborder="0" style="border:1px solid #e5e7eb;border-radius:8px"></iframe>`
        : '';
    const privateUrl = window.location.href;

    const copy = async (text: string, which: 'private' | 'public' | 'embed'): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(which);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* portapapeles bloqueado — no-op */
        }
    };

    const save = async (patch: UpdatePublicListInput): Promise<void> => {
        setSubmitError(null);
        try {
            await update.mutateAsync(patch);
            setDirty(false);
        } catch (err) {
            setSubmitError(
                err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'),
            );
        }
    };

    const currentInput = (): UpdatePublicListInput => ({
        enabled,
        visible_field_slugs: visible,
        view_id: viewId,
        expires_at: expiresAt === '' ? null : expiresAt,
        allowed_domains: domains
            .split(/[\n,]/)
            .map((d) => d.trim())
            .filter(Boolean),
    });

    /** El toggle publica/despublica al instante: es la acción principal. */
    const togglePublish = async (next: boolean): Promise<void> => {
        setEnabled(next);
        // Al publicar por primera vez sin campos elegidos no se vería nada:
        // arrancamos mostrando todo, que es lo que la gente espera.
        const nextVisible =
            next && visible.length === 0 ? allFields.map((f) => f.slug) : visible;
        setVisible(nextVisible);
        await save({ ...currentInput(), enabled: next, visible_field_slugs: nextVisible });
        toast.success(next ? __('Lista publicada') : __('Lista despublicada'));
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-flex imcrm-max-h-[85vh] imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-3.5">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-truncate imcrm-text-base imcrm-font-semibold">
                                {sprintf(
                                    /* translators: %s: list name */
                                    __('Compartir «%s»'),
                                    listName,
                                )}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Con tu equipo, o con cualquiera por un enlace.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-5 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4">
                        {/* ── 1. Con el equipo ─────────────────────────── */}
                        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                                <Users className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                                {__('Con tu equipo')}
                            </h3>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Este enlace sólo lo abre quien tenga cuenta y permiso sobre la lista.')}
                            </p>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <Input readOnly value={privateUrl} className="imcrm-font-mono imcrm-text-xs" />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-shrink-0 imcrm-gap-1.5"
                                    onClick={() => void copy(privateUrl, 'private')}
                                >
                                    {copied === 'private' ? (
                                        <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                                    ) : (
                                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    )}
                                    {__('Copiar')}
                                </Button>
                            </div>
                        </section>

                        {/* ── 2. Con cualquiera ────────────────────────── */}
                        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-4">
                            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                                <Globe className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                                {__('Con cualquiera')}
                            </h3>

                            {!canPublish ? (
                                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2.5 imcrm-text-xs imcrm-text-muted-foreground">
                                    <Lock className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                    {__('Publicar la lista hacia afuera lo hace quien administra la lista.')}
                                </p>
                            ) : (
                                <>
                                    <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-4 imcrm-py-3">
                                        <input
                                            type="checkbox"
                                            checked={enabled}
                                            disabled={update.isPending || query.isLoading}
                                            onChange={(e) => void togglePublish(e.target.checked)}
                                            className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                        />
                                        <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                            <span className="imcrm-text-sm imcrm-font-medium">
                                                {__('Publicar en una página que cualquiera pueda abrir')}
                                            </span>
                                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                                {__('Solo lectura. Nadie puede editar nada desde ahí.')}
                                            </span>
                                        </span>
                                    </label>

                                    {enabled && publicUrl && !dirty && (
                                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                                            <span className="imcrm-text-xs imcrm-font-medium">
                                                {__('Enlace público')}
                                            </span>
                                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                                <Input
                                                    readOnly
                                                    value={publicUrl}
                                                    className="imcrm-font-mono imcrm-text-xs"
                                                />
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="imcrm-shrink-0 imcrm-gap-1.5"
                                                    onClick={() => void copy(publicUrl, 'public')}
                                                >
                                                    {copied === 'public' ? (
                                                        <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    ) : (
                                                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    )}
                                                    {__('Copiar')}
                                                </Button>
                                            </div>
                                            <details className="imcrm-text-xs">
                                                <summary className="imcrm-cursor-pointer imcrm-text-muted-foreground">
                                                    {__('Insertar en otra web')}
                                                </summary>
                                                <div className="imcrm-mt-2 imcrm-flex imcrm-items-start imcrm-gap-2">
                                                    <Textarea
                                                        readOnly
                                                        rows={2}
                                                        value={embedSnippet}
                                                        className="imcrm-font-mono imcrm-text-xs"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="imcrm-shrink-0 imcrm-gap-1.5"
                                                        onClick={() => void copy(embedSnippet, 'embed')}
                                                    >
                                                        {copied === 'embed' ? (
                                                            <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                                                        ) : (
                                                            <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                                        )}
                                                        {__('Copiar')}
                                                    </Button>
                                                </div>
                                            </details>
                                        </div>
                                    )}

                                    {enabled && (
                                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                                    <Label htmlFor="share-view">{__('Qué se publica')}</Label>
                                                    <Select
                                                        id="share-view"
                                                        value={viewId ?? ''}
                                                        onChange={(e) => {
                                                            setViewId(
                                                                e.target.value === ''
                                                                    ? null
                                                                    : parseInt(e.target.value, 10),
                                                            );
                                                            setDirty(true);
                                                        }}
                                                    >
                                                        <option value="">{__('Toda la lista')}</option>
                                                        {(views.data ?? []).map((v) => (
                                                            <option key={v.id} value={v.id}>
                                                                {sprintf(
                                                                    /* translators: %s: saved view name */
                                                                    __('Vista: %s'),
                                                                    v.name,
                                                                )}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                                        {viewId === null
                                                            ? __('Salen todos los registros.')
                                                            : __('Salen sólo los que pasan los filtros de esa vista.')}
                                                    </p>
                                                </div>
                                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                                    <Label htmlFor="share-expires">
                                                        {__('El enlace vence el')}
                                                    </Label>
                                                    <Input
                                                        id="share-expires"
                                                        type="date"
                                                        value={expiresAt}
                                                        onChange={(e) => {
                                                            setExpiresAt(e.target.value);
                                                            setDirty(true);
                                                        }}
                                                    />
                                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                                        {expiresAt === ''
                                                            ? __('Sin fecha: no vence.')
                                                            : __('Después de esa fecha el enlace deja de abrir.')}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                                    <Label>{__('Campos visibles')}</Label>
                                                    <div className="imcrm-flex imcrm-gap-1">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="imcrm-h-6 imcrm-px-2 imcrm-text-xs"
                                                            onClick={() => {
                                                                setVisible(allFields.map((f) => f.slug));
                                                                setDirty(true);
                                                            }}
                                                        >
                                                            {__('Todos')}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="imcrm-h-6 imcrm-px-2 imcrm-text-xs"
                                                            onClick={() => {
                                                                setVisible([]);
                                                                setDirty(true);
                                                            }}
                                                        >
                                                            {__('Ninguno')}
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                                                    {allFields.map((f) => {
                                                        const on = visible.includes(f.slug);
                                                        return (
                                                            <button
                                                                key={f.id}
                                                                type="button"
                                                                aria-pressed={on}
                                                                onClick={() => {
                                                                    setVisible((prev) =>
                                                                        on
                                                                            ? prev.filter((s) => s !== f.slug)
                                                                            : [...prev, f.slug],
                                                                    );
                                                                    setDirty(true);
                                                                }}
                                                                className={cn(
                                                                    'imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-transition-colors',
                                                                    on
                                                                        ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary'
                                                                        : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                                                )}
                                                            >
                                                                {f.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                                    {__('Lo que no marques nunca sale de la app.')}
                                                </p>
                                            </div>

                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                                <Label htmlFor="share-domains">
                                                    {__('Sitios donde se puede insertar')}
                                                </Label>
                                                <Textarea
                                                    id="share-domains"
                                                    rows={2}
                                                    value={domains}
                                                    onChange={(e) => {
                                                        setDomains(e.target.value);
                                                        setDirty(true);
                                                    }}
                                                    placeholder="ejemplo.com&#10;*.midominio.com"
                                                />
                                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                                    {__('Uno por línea. Vacío = cualquier web puede insertarla.')}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {submitError !== null && (
                                <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                    {submitError}
                                </div>
                            )}
                        </section>
                    </div>

                    {canPublish && enabled && (
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {dirty ? __('Hay cambios sin guardar.') : __('Todo guardado.')}
                            </p>
                            <Button
                                onClick={() => void save(currentInput())}
                                disabled={!dirty || update.isPending}
                            >
                                {update.isPending ? __('Guardando…') : __('Guardar')}
                            </Button>
                        </div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
