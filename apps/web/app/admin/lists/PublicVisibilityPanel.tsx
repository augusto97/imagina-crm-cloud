import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Globe, Loader2 } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import { useFields } from '@/hooks/useFields';
import { usePublicList, useUpdatePublicList, publicListUrl } from '@/hooks/usePublicList';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { UpdatePublicListInput } from '@imagina-base/shared';

interface Props {
    listId: number;
}

/**
 * Panel de "Lista pública" del List Builder. Permite exponer la lista de
 * solo-lectura en una URL propia y embeberla por iframe en otros sitios, con:
 *  - selección de campos visibles (nunca se filtra un campo no marcado),
 *  - orden permitido + búsqueda,
 *  - restricción por dominio (CSP `frame-ancestors`) para el embed,
 *  - snippet de iframe listo para copiar.
 */
export function PublicVisibilityPanel({ listId }: Props): JSX.Element {
    const query = usePublicList(listId);
    const update = useUpdatePublicList(listId);
    const fields = useFields(listId);

    const [enabled, setEnabled] = useState(false);
    const [visible, setVisible] = useState<string[]>([]);
    const [sortAllowed, setSortAllowed] = useState<string[]>([]);
    const [defaultSort, setDefaultSort] = useState<string>('');
    const [perPage, setPerPage] = useState(20);
    const [searchEnabled, setSearchEnabled] = useState(true);
    const [domains, setDomains] = useState('');
    const [dirty, setDirty] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [copied, setCopied] = useState<'url' | 'embed' | null>(null);

    useEffect(() => {
        if (query.data) {
            const d = query.data;
            setEnabled(d.enabled);
            setVisible(d.visible_field_slugs);
            setSortAllowed(d.sort_allowed_slugs);
            setDefaultSort(d.default_sort ?? '');
            setPerPage(d.per_page);
            setSearchEnabled(d.search_enabled);
            setDomains(d.allowed_domains.join('\n'));
            setDirty(false);
        }
    }, [query.data]);

    const allFields = fields.data ?? [];
    const publicUrl = useMemo(() => publicListUrl(query.data?.public_path ?? null), [query.data?.public_path]);
    const embedSnippet = publicUrl
        ? `<iframe src="${publicUrl}" width="100%" height="600" frameborder="0" style="border:1px solid #e5e7eb;border-radius:8px"></iframe>`
        : '';

    const touch = (): void => setDirty(true);

    const toggleVisible = (slug: string, on: boolean): void => {
        setVisible((prev) => (on ? [...prev, slug] : prev.filter((s) => s !== slug)));
        if (!on) setSortAllowed((prev) => prev.filter((s) => s !== slug));
        touch();
    };

    const toggleSort = (slug: string, on: boolean): void => {
        setSortAllowed((prev) => (on ? [...prev, slug] : prev.filter((s) => s !== slug)));
        touch();
    };

    const handleCopy = async (text: string, which: 'url' | 'embed'): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(which);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* clipboard bloqueado — no-op */
        }
    };

    const handleSave = async (): Promise<void> => {
        setSubmitError(null);
        const allowed_domains = domains
            .split(/[\n,]/)
            .map((d) => d.trim())
            .filter(Boolean);
        const input: UpdatePublicListInput = {
            enabled,
            visible_field_slugs: visible,
            sort_allowed_slugs: sortAllowed.filter((s) => visible.includes(s)),
            default_sort: defaultSort || null,
            per_page: perPage,
            search_enabled: searchEnabled,
            allowed_domains,
        };
        try {
            await update.mutateAsync(input);
            setDirty(false);
        } catch (err) {
            setSubmitError(
                err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'),
            );
        }
    };

    if (query.isLoading) {
        return (
            <Card>
                <CardContent className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando configuración pública…')}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <Globe className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                    <div>
                        <CardTitle>{__('Lista pública')}</CardTitle>
                        <CardDescription>
                            {__(
                                'Publica esta lista en una URL de solo-lectura y embébela por iframe en otros sitios. Solo se exponen los campos que marques.',
                            )}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-2">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => {
                            setEnabled(e.target.checked);
                            touch();
                        }}
                        className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                    />
                    <span className="imcrm-text-sm imcrm-font-medium">
                        {__('Publicar esta lista')}
                    </span>
                </label>

                {enabled && (
                    <>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <span className="imcrm-text-sm imcrm-font-medium">{__('Campos visibles')}</span>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Marca "Visible" para exponer el campo; "Orden" para permitir ordenar por él.')}
                            </p>
                            <div className="imcrm-overflow-x-auto">
                                <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                                    <thead>
                                        <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                            <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Campo')}</th>
                                            <th className="imcrm-px-2 imcrm-py-2 imcrm-text-center imcrm-font-medium">{__('Visible')}</th>
                                            <th className="imcrm-px-2 imcrm-py-2 imcrm-text-center imcrm-font-medium">{__('Orden')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allFields.map((field) => {
                                            const isVisible = visible.includes(field.slug);
                                            return (
                                                <tr
                                                    key={field.id}
                                                    className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0"
                                                >
                                                    <td className="imcrm-py-2 imcrm-pr-3">
                                                        <span className="imcrm-font-medium">{field.label}</span>
                                                        <span className="imcrm-ml-1 imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">
                                                            ({field.slug})
                                                        </span>
                                                    </td>
                                                    <td className="imcrm-px-2 imcrm-py-2 imcrm-text-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={isVisible}
                                                            onChange={(e) => toggleVisible(field.slug, e.target.checked)}
                                                            className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                                            aria-label={`${__('Visible')} ${field.label}`}
                                                        />
                                                    </td>
                                                    <td className="imcrm-px-2 imcrm-py-2 imcrm-text-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={sortAllowed.includes(field.slug)}
                                                            disabled={!isVisible}
                                                            onChange={(e) => toggleSort(field.slug, e.target.checked)}
                                                            className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input disabled:imcrm-opacity-40"
                                                            aria-label={`${__('Ordenar por')} ${field.label}`}
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 md:imcrm-grid-cols-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="pub-default-sort">{__('Orden por defecto')}</Label>
                                <select
                                    id="pub-default-sort"
                                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                                    value={defaultSort}
                                    onChange={(e) => {
                                        setDefaultSort(e.target.value);
                                        touch();
                                    }}
                                >
                                    <option value="">{__('— Por id —')}</option>
                                    {sortAllowed.map((slug) => [
                                        <option key={`${slug}:asc`} value={`${slug}:asc`}>
                                            {slug} ↑
                                        </option>,
                                        <option key={`${slug}:desc`} value={`${slug}:desc`}>
                                            {slug} ↓
                                        </option>,
                                    ])}
                                </select>
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="pub-per-page">{__('Filas por página')}</Label>
                                <Input
                                    id="pub-per-page"
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={perPage}
                                    onChange={(e) => {
                                        setPerPage(Math.max(1, Math.min(100, Number(e.target.value) || 1)));
                                        touch();
                                    }}
                                />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="pub-search">{__('Búsqueda')}</Label>
                                <label className="imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-2">
                                    <input
                                        id="pub-search"
                                        type="checkbox"
                                        checked={searchEnabled}
                                        onChange={(e) => {
                                            setSearchEnabled(e.target.checked);
                                            touch();
                                        }}
                                        className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                    />
                                    <span className="imcrm-text-sm imcrm-text-muted-foreground">
                                        {searchEnabled ? __('Habilitada') : __('Deshabilitada')}
                                    </span>
                                </label>
                            </div>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="pub-domains">{__('Dominios permitidos para embeber')}</Label>
                            <Textarea
                                id="pub-domains"
                                value={domains}
                                onChange={(e) => {
                                    setDomains(e.target.value);
                                    touch();
                                }}
                                rows={2}
                                placeholder="ejemplo.com&#10;*.midominio.com"
                            />
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__(
                                    'Uno por línea. Si dejas esto vacío, cualquier sitio puede embeber la lista. Con dominios, solo esos podrán mostrarla en un iframe.',
                                )}
                            </p>
                        </div>

                        {publicUrl && !dirty && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <span className="imcrm-text-sm imcrm-font-medium">{__('Enlace público')}</span>
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                        <Input readOnly value={publicUrl} className="imcrm-font-mono imcrm-text-xs" />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="imcrm-gap-1.5 imcrm-shrink-0"
                                            onClick={() => handleCopy(publicUrl, 'url')}
                                        >
                                            {copied === 'url' ? (
                                                <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                                            ) : (
                                                <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                            )}
                                            {__('Copiar')}
                                        </Button>
                                    </div>
                                </div>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <span className="imcrm-text-sm imcrm-font-medium">{__('Código para embeber (iframe)')}</span>
                                    <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                                        <Textarea
                                            readOnly
                                            value={embedSnippet}
                                            rows={2}
                                            className="imcrm-font-mono imcrm-text-xs"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="imcrm-gap-1.5 imcrm-shrink-0"
                                            onClick={() => handleCopy(embedSnippet, 'embed')}
                                        >
                                            {copied === 'embed' ? (
                                                <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                                            ) : (
                                                <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                            )}
                                            {__('Copiar')}
                                        </Button>
                                    </div>
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

                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {enabled
                            ? __('Guarda para generar/actualizar el enlace público.')
                            : __('La lista no es pública.')}
                    </p>
                    <Button onClick={handleSave} disabled={!dirty || update.isPending} className="imcrm-gap-2">
                        {update.isPending ? __('Guardando…') : __('Guardar')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
