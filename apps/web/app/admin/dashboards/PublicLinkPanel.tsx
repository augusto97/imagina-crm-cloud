import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Globe, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { usePublicDashboard, useRegeneratePublicDashboard, useUpdatePublicDashboard } from '@/hooks/useDashboardSharing';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

/** El código para insertar el tablero en otro sitio. */
export function embedSnippet(url: string): string {
    const src = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<iframe src="${src}" width="100%" height="720" style="border:0" loading="lazy" title="Tablero"></iframe>`;
}

/** Dominios escritos uno por línea (o separados por coma) → lista limpia. */
export function parseDomains(text: string): string[] {
    return [...new Set(text.split(/[\n,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))];
}

function CopyButton({ value, label, testId }: { value: string; label: string; testId?: string }): JSX.Element {
    const [done, setDone] = useState(false);
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            className="imcrm-shrink-0 imcrm-gap-1.5"
            data-testid={testId}
            onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => {
                    setDone(true);
                    window.setTimeout(() => setDone(false), 1500);
                });
            }}
        >
            {done ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
            {done ? __('Copiado') : label}
        </Button>
    );
}

/**
 * v0.1.292 (ADR-S50) — Compartir → Enlace público: una dirección de sólo
 * lectura, sin sesión, que también se puede insertar en otro sitio.
 */
export function PublicLinkPanel({ dashboardId, canPublish }: { dashboardId: number; canPublish: boolean }): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();
    const query = usePublicDashboard(dashboardId, canPublish);
    const update = useUpdatePublicDashboard(dashboardId);
    const regenerate = useRegeneratePublicDashboard(dashboardId);
    const data = query.data;
    const [expires, setExpires] = useState('');
    const [domains, setDomains] = useState('');
    const [allowPeriod, setAllowPeriod] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!data) return;
        setExpires(data.expires_at ?? '');
        setDomains(data.allowed_domains.join('\n'));
        setAllowPeriod(data.allow_period);
    }, [data]);

    if (!canPublish) {
        return (
            <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                {__('Sólo quien creó el tablero o un admin pueden publicarlo con un enlace.')}
            </p>
        );
    }
    if (query.isLoading || !data) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando…')}
            </div>
        );
    }

    const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
        setError(null);
        try {
            await fn();
            toast.success(ok);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar.'));
        }
    };

    const url = data.url ?? (data.path ? `${window.location.origin}${data.path}` : null);
    const dirty =
        (data.expires_at ?? '') !== expires ||
        data.allow_period !== allowPeriod ||
        data.allowed_domains.join('\n') !== parseDomains(domains).join('\n');

    if (!data.enabled) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-public-link-off">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                    <Globe className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                        <p className="imcrm-font-medium">{__('Publicar un enlace de sólo lectura')}</p>
                        <p className="imcrm-text-muted-foreground">
                            {__('Cualquiera con el enlace verá el tablero sin iniciar sesión, con los datos que tú puedes ver. También se puede insertar en otro sitio.')}
                        </p>
                    </div>
                </div>
                {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                <div>
                    <Button
                        type="button"
                        size="sm"
                        disabled={update.isPending}
                        onClick={() => void run(() => update.mutateAsync({ enabled: true }), __('Enlace publicado'))}
                        data-testid="imcrm-public-link-publish"
                    >
                        {update.isPending && <Loader2 className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                        {__('Publicar enlace')}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="imcrm-public-link-on">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="pub-url">{__('Enlace público')}</Label>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    <Input id="pub-url" readOnly value={url ?? ''} className="imcrm-min-w-0 imcrm-flex-1 imcrm-font-mono imcrm-text-xs" data-testid="imcrm-public-link-url" onFocus={(e) => e.currentTarget.select()} />
                    {url && <CopyButton value={url} label={__('Copiar')} testId="imcrm-public-link-copy" />}
                    {url && (
                        <Button asChild variant="outline" size="sm" className="imcrm-gap-1.5">
                            <a href={url} target="_blank" rel="noreferrer">
                                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Abrir')}
                            </a>
                        </Button>
                    )}
                </div>
                {data.published_by && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {sprintf(
                            __('Publicado por %1$s el %2$s. Los datos se calculan con lo que esa persona puede ver: si deja de tener acceso, el enlace deja de funcionar.'),
                            data.published_by.name,
                            data.published_at ? formatDateTimeStr(data.published_at) : '',
                        )}
                    </p>
                )}
            </div>

            {data.has_tables && (
                <div className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-amber-500/40 imcrm-bg-amber-500/10 imcrm-p-3 imcrm-text-sm" data-testid="imcrm-public-link-tables">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-amber-600" />
                    <p>{__('Este tablero tiene tablas: cualquiera con el enlace verá esas filas (registros), no sólo totales. Revisa que no muestren datos que no quieres compartir.')}</p>
                </div>
            )}

            <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="pub-expires">{__('Vence (opcional)')}</Label>
                    <Input id="pub-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} data-testid="imcrm-public-link-expires" />
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Funciona hasta el final de ese día. Vacío: no vence.')}</p>
                </div>
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm sm:imcrm-pt-6">
                    <input
                        type="checkbox"
                        className="imcrm-mt-0.5"
                        checked={allowPeriod}
                        onChange={(e) => setAllowPeriod(e.target.checked)}
                        data-testid="imcrm-public-link-period"
                    />
                    <span>
                        {__('Quien mira puede cambiar el período')}
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Los datos se recalculan (hoy, este mes, el año pasado…).')}</span>
                    </span>
                </label>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="pub-domains">{__('Sitios donde se puede insertar')}</Label>
                <Textarea
                    id="pub-domains"
                    rows={2}
                    value={domains}
                    onChange={(e) => setDomains(e.target.value)}
                    placeholder={'ejemplo.com\n*.ejemplo.com'}
                    data-testid="imcrm-public-link-domains"
                />
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Uno por línea. Vacío: se puede insertar en cualquier sitio. El enlace se abre igual desde cualquier lugar.')}</p>
            </div>

            {url && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Código para insertar')}</Label>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-2 imcrm-text-[11px]" data-testid="imcrm-public-link-embed">
                            {embedSnippet(url)}
                        </code>
                        <CopyButton value={embedSnippet(url)} label={__('Copiar código')} />
                    </div>
                </div>
            )}

            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-gap-1.5"
                        disabled={regenerate.isPending}
                        onClick={() => {
                            void (async () => {
                                const ok = await confirm({
                                    title: __('Crear una dirección nueva'),
                                    description: __('La dirección actual deja de funcionar al instante, también donde esté insertada.'),
                                    confirmLabel: __('Crear dirección nueva'),
                                    destructive: true,
                                });
                                if (ok) await run(() => regenerate.mutateAsync(), __('Dirección nueva creada'));
                            })();
                        }}
                        data-testid="imcrm-public-link-regenerate"
                    >
                        <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Nueva dirección')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-text-destructive hover:imcrm-text-destructive"
                        disabled={update.isPending}
                        onClick={() => void run(() => update.mutateAsync({ enabled: false }), __('El tablero ya no es público'))}
                        data-testid="imcrm-public-link-unpublish"
                    >
                        {__('Dejar de publicar')}
                    </Button>
                </div>
                <Button
                    type="button"
                    size="sm"
                    disabled={!dirty || update.isPending}
                    onClick={() =>
                        void run(
                            () => update.mutateAsync({ expires_at: expires === '' ? null : expires, allow_period: allowPeriod, allowed_domains: parseDomains(domains) }),
                            __('Cambios guardados'),
                        )
                    }
                    data-testid="imcrm-public-link-save"
                >
                    {__('Guardar cambios')}
                </Button>
            </div>
        </div>
    );
}
