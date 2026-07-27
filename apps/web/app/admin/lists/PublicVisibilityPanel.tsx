import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Globe, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useFields } from '@/hooks/useFields';
import { usePublicList, useUpdatePublicList, publicListUrl } from '@/hooks/usePublicList';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { UpdatePublicListInput } from '@imagina-base/shared';

interface Props {
    listId: number;
}

/**
 * Panel "Lista pública" (sección Compartir). Publica la lista de
 * solo-lectura en una URL propia y permite embeberla por iframe, con:
 *  - selección de campos visibles (nunca se filtra un campo no marcado),
 *  - orden permitido + búsqueda,
 *  - restricción por dominio (CSP `frame-ancestors`) para el embed,
 *  - enlace + snippet listos para copiar.
 *
 * v0.1.126: el enlace público (el premio) pasó ARRIBA de la
 * configuración, la tabla de checkboxes se volvió una lista de campos
 * con atajos "Todos / Ninguno", y la copia dejó la jerga de CSP para
 * hablar de "sitios donde puede mostrarse".
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
    const publicUrl = useMemo(
        () => publicListUrl(query.data?.public_path ?? null),
        [query.data?.public_path],
    );
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

    const setAllVisible = (on: boolean): void => {
        setVisible(on ? allFields.map((f) => f.slug) : []);
        if (!on) setSortAllowed([]);
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
                    {__('Cargando…')}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Globe className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                            {__('Página pública')}
                            {query.data?.enabled && <Badge variant="success">{__('Publicada')}</Badge>}
                        </CardTitle>
                        <CardDescription>
                            {__(
                                'Publicá la lista en una dirección que cualquiera puede abrir, sin entrar a la app. Solo se muestran los campos que marques.',
                            )}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-4 imcrm-py-3">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => {
                            setEnabled(e.target.checked);
                            touch();
                        }}
                        className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                    />
                    <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        <span className="imcrm-text-sm imcrm-font-medium">
                            {__('Publicar esta lista')}
                        </span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Solo lectura: nadie puede editar nada desde la página pública.')}
                        </span>
                    </span>
                </label>

                {enabled && (
                    <>
                        {publicUrl && !dirty && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <span className="imcrm-text-sm imcrm-font-medium">
                                        {__('Enlace para compartir')}
                                    </span>
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                        <Input readOnly value={publicUrl} className="imcrm-font-mono imcrm-text-xs" />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="imcrm-shrink-0 imcrm-gap-1.5"
                                            onClick={() => void handleCopy(publicUrl, 'url')}
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
                                <details className="imcrm-text-xs">
                                    <summary className="imcrm-cursor-pointer imcrm-font-medium imcrm-text-muted-foreground">
                                        {__('Insertar dentro de otra web')}
                                    </summary>
                                    <div className="imcrm-mt-2 imcrm-flex imcrm-items-start imcrm-gap-2">
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
                                            className="imcrm-shrink-0 imcrm-gap-1.5"
                                            onClick={() => void handleCopy(embedSnippet, 'embed')}
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

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                <div className="imcrm-flex imcrm-flex-col">
                                    <span className="imcrm-text-sm imcrm-font-medium">
                                        {__('Qué campos se muestran')}
                                    </span>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Lo que no marques acá nunca sale de la app.')}
                                    </span>
                                </div>
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="imcrm-h-7 imcrm-px-2 imcrm-text-xs"
                                        onClick={() => setAllVisible(true)}
                                    >
                                        {__('Todos')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="imcrm-h-7 imcrm-px-2 imcrm-text-xs"
                                        onClick={() => setAllVisible(false)}
                                    >
                                        {__('Ninguno')}
                                    </Button>
                                </div>
                            </div>

                            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border">
                                {allFields.map((field) => {
                                    const isVisible = visible.includes(field.slug);
                                    return (
                                        <li
                                            key={field.id}
                                            className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-3 imcrm-py-2"
                                        >
                                            <label className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-cursor-pointer imcrm-items-center imcrm-gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={isVisible}
                                                    onChange={(e) => toggleVisible(field.slug, e.target.checked)}
                                                    className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                                                />
                                                <span className="imcrm-truncate imcrm-text-sm">{field.label}</span>
                                            </label>
                                            <label
                                                className={cn(
                                                    'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-xs',
                                                    isVisible
                                                        ? 'imcrm-cursor-pointer imcrm-text-muted-foreground'
                                                        : 'imcrm-opacity-40',
                                                )}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={sortAllowed.includes(field.slug)}
                                                    disabled={!isVisible}
                                                    onChange={(e) => toggleSort(field.slug, e.target.checked)}
                                                    className="imcrm-h-3.5 imcrm-w-3.5 imcrm-rounded imcrm-border-input"
                                                />
                                                {__('se puede ordenar')}
                                            </label>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>

                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 md:imcrm-grid-cols-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="pub-default-sort">{__('Orden inicial')}</Label>
                                <Select
                                    id="pub-default-sort"
                                    value={defaultSort}
                                    onChange={(e) => {
                                        setDefaultSort(e.target.value);
                                        touch();
                                    }}
                                >
                                    <option value="">{__('— El de la lista —')}</option>
                                    {sortAllowed.map((slug) => [
                                        <option key={`${slug}:asc`} value={`${slug}:asc`}>
                                            {slug} ↑
                                        </option>,
                                        <option key={`${slug}:desc`} value={`${slug}:desc`}>
                                            {slug} ↓
                                        </option>,
                                    ])}
                                </Select>
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
                                <Label htmlFor="pub-search">{__('Buscador')}</Label>
                                <label className="imcrm-inline-flex imcrm-h-9 imcrm-cursor-pointer imcrm-items-center imcrm-gap-2">
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
                                        {searchEnabled ? __('Visible') : __('Oculto')}
                                    </span>
                                </label>
                            </div>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="pub-domains">{__('Sitios donde se puede insertar')}</Label>
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
                                    'Un dominio por línea. Si lo dejás vacío, cualquier web puede insertar la lista. El enlace directo funciona igual en los dos casos.',
                                )}
                            </p>
                        </div>
                    </>
                )}

                {submitError !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {submitError}
                    </div>
                )}

                <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-3">
                    {enabled && dirty && (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Guardá para generar o actualizar el enlace.')}
                        </p>
                    )}
                    <Button onClick={() => void handleSave()} disabled={!dirty || update.isPending}>
                        {update.isPending ? __('Guardando…') : __('Guardar')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
