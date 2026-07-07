import { useEffect, useMemo, useState } from 'react';
import { Copy, Globe, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFields } from '@/hooks/useFields';
import { useUpdateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { ListSummary } from '@/types/list';
import {
    PUBLIC_DEFAULTS,
    PUBLIC_LIMITS,
    type PublicListSettings,
} from '@/types/publicList';

interface Props {
    list: ListSummary;
}

/**
 * Tab "Visibilidad pública" del List Builder (Fase 8 — 2.E).
 *
 * Configura `settings.public` (shape descrito en `PublicListConfig.php`)
 * desde UI en vez de tener que editar JSON via REST PATCH manual.
 *
 * Patrón de UI:
 *  - Toggle master "Habilitar visibilidad pública".
 *  - Cuando off: el panel queda colapsado mostrando solo el toggle +
 *    una nota explicando que ningún visitante puede ver datos.
 *  - Cuando on: aparecen los controles + snippet del shortcode con el
 *    slug actual para copy-paste.
 *
 * El editor de `fixed_filter_tree` NO se incluye en 2.E — es complejo
 * (reusar el `FiltersPanel` existente requeriría refactor). Por ahora
 * los admins pueden setearlo via REST PATCH si necesitan filtros fijos
 * server-side. UI para esto queda como mejora futura.
 */
export function PublicVisibilityPanel({ list }: Props): JSX.Element {
    const update = useUpdateList(list.id);
    const fields = useFields(list.id);

    const initial = useMemo<PublicListSettings>(
        () => readPublic(list.settings),
        [list.settings],
    );
    const [draft, setDraft] = useState<PublicListSettings>(initial);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [copyHint, setCopyHint] = useState<string | null>(null);

    useEffect(() => {
        setDraft(initial);
    }, [initial]);

    const dirty = useMemo(() => !shallowEqual(draft, initial), [draft, initial]);

    const allFields = fields.data ?? [];
    // Solo fields que no son tipo `relation` se pueden ofrecer como
    // visibles públicamente — los relation son IDs internos. Si el
    // admin los necesita, puede agregar el field "real" (text/etc.)
    // que represente el valor.
    const exposableFields = useMemo(
        () => allFields.filter((f) => f.type !== 'relation'),
        [allFields],
    );

    // Slugs ordenables = subset de los visibles. Si el admin desmarca
    // un campo de visible, también lo sacamos de sort_allowed.
    useEffect(() => {
        setDraft((d) => {
            const visible = new Set(d.visible_field_slugs);
            const filtered = d.sort_allowed_slugs.filter((s) => visible.has(s));
            if (filtered.length === d.sort_allowed_slugs.length) return d;
            return { ...d, sort_allowed_slugs: filtered };
        });
    }, [draft.visible_field_slugs]);

    const toggleVisible = (slug: string, checked: boolean): void => {
        setDraft((d) => {
            const next = checked
                ? Array.from(new Set([...d.visible_field_slugs, slug]))
                : d.visible_field_slugs.filter((s) => s !== slug);
            return { ...d, visible_field_slugs: next };
        });
    };

    const toggleSortable = (slug: string, checked: boolean): void => {
        setDraft((d) => ({
            ...d,
            sort_allowed_slugs: checked
                ? Array.from(new Set([...d.sort_allowed_slugs, slug]))
                : d.sort_allowed_slugs.filter((s) => s !== slug),
        }));
    };

    const handleSave = async (): Promise<void> => {
        setSubmitError(null);
        try {
            const settings = mergeIntoSettings(list.settings, draft);
            await update.mutateAsync({ settings });
        } catch (err) {
            setSubmitError(
                err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'),
            );
        }
    };

    const shortcode = `[imcrm-list slug="${list.slug}"]`;
    const handleCopyShortcode = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(shortcode);
            setCopyHint(__('Copiado al portapapeles.'));
            window.setTimeout(() => setCopyHint(null), 2000);
        } catch {
            setCopyHint(__('No se pudo copiar — selecciónalo manualmente.'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <Globe className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                    <div>
                        <CardTitle>{__('Visibilidad pública')}</CardTitle>
                        <CardDescription>
                            {__(
                                'Habilita la lista para que pueda mostrarse en el frontend del sitio vía shortcode o bloque. Solo los campos que marques como visibles llegarán a los visitantes.',
                            )}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                    <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                        className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                    />
                    {__('Habilitar visibilidad pública')}
                </label>

                {!draft.enabled ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">
                        {__(
                            'Esta lista no se expone públicamente. Los endpoints REST públicos devuelven 404 y el shortcode/bloque no renderizan nada.',
                        )}
                    </p>
                ) : (
                    <>
                        {fields.isLoading ? (
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                {__('Cargando campos…')}
                            </div>
                        ) : exposableFields.length === 0 ? (
                            <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-amber-300 imcrm-bg-amber-50 imcrm-px-3 imcrm-py-3 imcrm-text-xs imcrm-text-amber-800 dark:imcrm-border-amber-700 dark:imcrm-bg-amber-950/30 dark:imcrm-text-amber-200">
                                {__('Esta lista todavía no tiene campos no-relación. Agrega al menos uno para exponerlo públicamente.')}
                            </p>
                        ) : (
                            <FieldsSection
                                fields={exposableFields}
                                visibleSlugs={draft.visible_field_slugs}
                                sortableSlugs={draft.sort_allowed_slugs}
                                onToggleVisible={toggleVisible}
                                onToggleSortable={toggleSortable}
                            />
                        )}

                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 md:imcrm-grid-cols-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="pub-per-page">{__('Registros por página')}</Label>
                                <Input
                                    id="pub-per-page"
                                    type="number"
                                    min={PUBLIC_LIMITS.perPageMin}
                                    max={PUBLIC_LIMITS.perPageMax}
                                    value={draft.per_page}
                                    onChange={(e) =>
                                        setDraft((d) => ({
                                            ...d,
                                            per_page: clamp(
                                                parseInt(e.target.value || '0', 10),
                                                PUBLIC_LIMITS.perPageMin,
                                                PUBLIC_LIMITS.perPageMax,
                                            ),
                                        }))
                                    }
                                />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="pub-ttl">{__('Cache (segundos)')}</Label>
                                <Input
                                    id="pub-ttl"
                                    type="number"
                                    min={PUBLIC_LIMITS.cacheTtlMin}
                                    max={PUBLIC_LIMITS.cacheTtlMax}
                                    value={draft.cache_ttl}
                                    onChange={(e) =>
                                        setDraft((d) => ({
                                            ...d,
                                            cache_ttl: clamp(
                                                parseInt(e.target.value || '0', 10),
                                                PUBLIC_LIMITS.cacheTtlMin,
                                                PUBLIC_LIMITS.cacheTtlMax,
                                            ),
                                        }))
                                    }
                                />
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('0 = sin cache. Headers Cache-Control sugieren al CDN cuántos segundos cachear cada respuesta.')}
                                </span>
                            </div>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="pub-permalink">{__('Permalink dedicado (opcional)')}</Label>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-text-sm imcrm-text-muted-foreground imcrm-font-mono">/</span>
                                <Input
                                    id="pub-permalink"
                                    type="text"
                                    placeholder={__('ej. precios')}
                                    value={draft.permalink_base ?? ''}
                                    onChange={(e) => {
                                        // Saneo client-side: solo a-z0-9-, lowercase.
                                        const clean = e.target.value
                                            .toLowerCase()
                                            .replace(/[^a-z0-9-]/g, '')
                                            .slice(0, 64);
                                        setDraft((d) => ({
                                            ...d,
                                            permalink_base: clean === '' ? null : clean,
                                        }));
                                    }}
                                    className="imcrm-font-mono"
                                />
                                <span className="imcrm-text-sm imcrm-text-muted-foreground imcrm-font-mono">/</span>
                            </div>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__(
                                    'Si lo configuras, la lista será accesible en /tu-slug/ además del shortcode. Solo letras minúsculas, números y guiones. Dejá vacío para acceder solo via shortcode.',
                                )}
                            </span>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={draft.search_enabled}
                                    onChange={(e) =>
                                        setDraft((d) => ({ ...d, search_enabled: e.target.checked }))
                                    }
                                    className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                />
                                {__('Permitir búsqueda en la tabla')}
                            </label>
                            <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={draft.viewer_filters_allowed}
                                    onChange={(e) =>
                                        setDraft((d) => ({
                                            ...d,
                                            viewer_filters_allowed: e.target.checked,
                                        }))
                                    }
                                    className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                />
                                {__('Permitir filtros del visitante')}
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('(solo sobre los campos visibles)')}
                                </span>
                            </label>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="pub-default-sort">{__('Orden por defecto')}</Label>
                            <select
                                id="pub-default-sort"
                                value={draft.default_sort ?? ''}
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        default_sort: e.target.value === '' ? null : e.target.value,
                                    }))
                                }
                                className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                            >
                                <option value="">{__('— Sin orden por defecto —')}</option>
                                {draft.sort_allowed_slugs.flatMap((slug) => [
                                    { value: `${slug}:asc`, label: `${slug} (asc)` },
                                    { value: `${slug}:desc`, label: `${slug} (desc)` },
                                ]).map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            {draft.sort_allowed_slugs.length === 0 && (
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Marca al menos un campo como ordenable arriba para elegir orden por defecto.')}
                                </span>
                            )}
                        </div>

                        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-3">
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                <code className="imcrm-truncate imcrm-font-mono imcrm-text-xs">
                                    {shortcode}
                                </code>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleCopyShortcode()}
                                    className="imcrm-gap-1.5"
                                >
                                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Copiar')}
                                </Button>
                            </div>
                            <p className="imcrm-mt-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Pega este shortcode en cualquier página/post del sitio. También está disponible como bloque Gutenberg "Lista Imagina CRM".')}
                            </p>
                            {copyHint !== null && (
                                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-primary">{copyHint}</p>
                            )}
                        </div>
                    </>
                )}

                {submitError !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {submitError}
                    </div>
                )}

                <div className="imcrm-flex imcrm-justify-end">
                    <Button onClick={handleSave} disabled={!dirty || update.isPending}>
                        {update.isPending ? __('Guardando…') : __('Guardar visibilidad')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function FieldsSection({
    fields,
    visibleSlugs,
    sortableSlugs,
    onToggleVisible,
    onToggleSortable,
}: {
    fields: Array<{ slug: string; label: string; type: string }>;
    visibleSlugs: string[];
    sortableSlugs: string[];
    onToggleVisible: (slug: string, checked: boolean) => void;
    onToggleSortable: (slug: string, checked: boolean) => void;
}): JSX.Element {
    const visible = new Set(visibleSlugs);
    const sortable = new Set(sortableSlugs);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <h4 className="imcrm-text-sm imcrm-font-medium">{__('Campos visibles para el público')}</h4>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Solo los campos marcados se incluyen en la respuesta REST y en la tabla del shortcode/bloque.')}
            </p>
            <div className="imcrm-mt-1 imcrm-rounded-md imcrm-border imcrm-border-border">
                <table className="imcrm-w-full imcrm-text-sm">
                    <thead>
                        <tr className="imcrm-border-b imcrm-border-border imcrm-bg-muted/30 imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                            <th className="imcrm-py-2 imcrm-px-3 imcrm-text-left imcrm-font-medium">
                                {__('Campo')}
                            </th>
                            <th className="imcrm-py-2 imcrm-px-3 imcrm-text-center imcrm-font-medium">
                                {__('Visible')}
                            </th>
                            <th className="imcrm-py-2 imcrm-px-3 imcrm-text-center imcrm-font-medium">
                                {__('Ordenable')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {fields.map((f) => {
                            const isVisible = visible.has(f.slug);
                            return (
                                <tr key={f.slug} className="imcrm-border-b imcrm-border-border/40 last:imcrm-border-b-0">
                                    <td className="imcrm-py-2 imcrm-px-3">
                                        <span className="imcrm-font-medium">{f.label}</span>
                                        <span className="imcrm-ml-1 imcrm-text-xs imcrm-text-muted-foreground">
                                            ({f.slug})
                                        </span>
                                    </td>
                                    <td className="imcrm-py-2 imcrm-px-3 imcrm-text-center">
                                        <input
                                            type="checkbox"
                                            checked={isVisible}
                                            onChange={(e) => onToggleVisible(f.slug, e.target.checked)}
                                            className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                            aria-label={`${__('Visible')}: ${f.label}`}
                                        />
                                    </td>
                                    <td className="imcrm-py-2 imcrm-px-3 imcrm-text-center">
                                        <input
                                            type="checkbox"
                                            checked={sortable.has(f.slug)}
                                            disabled={!isVisible}
                                            onChange={(e) => onToggleSortable(f.slug, e.target.checked)}
                                            className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                            aria-label={`${__('Ordenable')}: ${f.label}`}
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function readPublic(settings: Record<string, unknown>): PublicListSettings {
    const raw = settings.public;
    if (raw === null || raw === undefined || typeof raw !== 'object') {
        return { ...PUBLIC_DEFAULTS };
    }
    const p = raw as Record<string, unknown>;
    return {
        enabled: Boolean(p.enabled),
        visible_field_slugs: Array.isArray(p.visible_field_slugs)
            ? (p.visible_field_slugs.filter((s) => typeof s === 'string') as string[])
            : [],
        fixed_filter_tree:
            p.fixed_filter_tree !== null && typeof p.fixed_filter_tree === 'object'
                ? (p.fixed_filter_tree as Record<string, unknown>)
                : null,
        viewer_filters_allowed: p.viewer_filters_allowed !== false,
        sort_allowed_slugs: Array.isArray(p.sort_allowed_slugs)
            ? (p.sort_allowed_slugs.filter((s) => typeof s === 'string') as string[])
            : [],
        default_sort: typeof p.default_sort === 'string' && p.default_sort !== '' ? p.default_sort : null,
        per_page:
            typeof p.per_page === 'number' && p.per_page > 0
                ? Math.min(PUBLIC_LIMITS.perPageMax, p.per_page)
                : PUBLIC_DEFAULTS.per_page,
        search_enabled: p.search_enabled !== false,
        cache_ttl:
            typeof p.cache_ttl === 'number'
                ? clamp(p.cache_ttl, PUBLIC_LIMITS.cacheTtlMin, PUBLIC_LIMITS.cacheTtlMax)
                : PUBLIC_DEFAULTS.cache_ttl,
        permalink_base:
            typeof p.permalink_base === 'string' && p.permalink_base !== ''
                ? p.permalink_base
                : null,
    };
}

function mergeIntoSettings(
    current: Record<string, unknown>,
    publicCfg: PublicListSettings,
): Record<string, unknown> {
    return { ...current, public: publicCfg };
}

function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function shallowEqual(a: PublicListSettings, b: PublicListSettings): boolean {
    if (a.enabled !== b.enabled) return false;
    if (a.viewer_filters_allowed !== b.viewer_filters_allowed) return false;
    if (a.search_enabled !== b.search_enabled) return false;
    if (a.per_page !== b.per_page) return false;
    if (a.cache_ttl !== b.cache_ttl) return false;
    if (a.default_sort !== b.default_sort) return false;
    if (a.permalink_base !== b.permalink_base) return false;
    if (!arrEq(a.visible_field_slugs, b.visible_field_slugs)) return false;
    if (!arrEq(a.sort_allowed_slugs, b.sort_allowed_slugs)) return false;
    // fixed_filter_tree: comparación por JSON (estable en este contexto
    // porque no editamos el shape desde la UI todavía).
    if (JSON.stringify(a.fixed_filter_tree) !== JSON.stringify(b.fixed_filter_tree)) return false;
    return true;
}

function arrEq(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
