import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleCheck, Copy, Globe, Hourglass, Loader2, RefreshCw, ShoppingBag, Trash2, Wrench } from 'lucide-react';
import type { PlatformDomain, PlatformDomainKind, PlatformDomains, RetiredDomain } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

import { PlatformEmbedHostCard } from './PlatformEmbedHostCard';

/**
 * v0.1.246 — Plataforma → Dominios. El servidor atiende los dominios de las
 * empresas con el camino de ServerAvatar: cada uno se agrega A MANO como
 * alias de la aplicación. Esta es la lista de trabajo del operador:
 *  - "Para habilitar": verificados por la empresa que el servidor todavía no
 *    atiende (los enlaces de esa empresa siguen saliendo por la plataforma);
 *  - "Para quitar del servidor": dominios que una empresa dejó de usar (si
 *    quedan en el certificado y dejan de apuntar aquí, la renovación falla);
 *  - "Funcionando" y "Esperando verificación", como referencia.
 */
const KEY = ['platform-domains'];

export function PlatformDomainsCard(): JSX.Element {
    // v0.1.409 — la dirección rápida no depende de la revisión de dominios
    // (que consulta el DNS de cada empresa y puede tardar).
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <TenantDomains />
            <PlatformEmbedHostCard />
        </div>
    );
}

function TenantDomains(): JSX.Element {
    const q = useQuery({ queryKey: KEY, queryFn: () => api.platformDomainsGet() });

    if (q.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-6 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Revisando los dominios de las empresas…')}
            </p>
        );
    }
    if (q.isError || !q.data) {
        return <p className="imcrm-p-6 imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar los dominios.')}</p>;
    }
    const data = q.data;
    const toEnable = data.domains.filter((d) => d.state === 'verified' && d.serving !== 'ok');
    const working = data.domains.filter((d) => d.state === 'verified' && d.serving === 'ok');
    const pending = data.domains.filter((d) => d.state === 'pending');

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="platform-domains">
            <HowToCard target={data.target} />
            {data.site_routing !== null && <SiteRoutingCard state={data.site_routing} onRecheck={() => void q.refetch()} checking={q.isFetching} />}

            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <Wrench className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                                {__('Para habilitar')}
                                <Badge variant={toEnable.length > 0 ? 'warning' : 'secondary'}>{toEnable.length}</Badge>
                            </CardTitle>
                            <CardDescription>
                                {__('La empresa ya verificó que el dominio es suyo, pero el servidor todavía no lo atiende. Mientras tanto sus enlaces salen por el dominio de la plataforma.')}
                            </CardDescription>
                        </div>
                        <div className="imcrm-flex imcrm-gap-2">
                            {toEnable.length > 1 && <CopyButton text={toEnable.map((d) => d.domain).join(', ')} label={__('Copiar todos')} />}
                            <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
                                <RefreshCw className={q.isFetching ? 'imcrm-h-4 imcrm-w-4 imcrm-animate-spin' : 'imcrm-h-4 imcrm-w-4'} />
                                {__('Actualizar')}
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="imcrm-pt-0">
                    {toEnable.length === 0 ? (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-2 imcrm-text-sm imcrm-text-muted-foreground">
                            <CircleCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-success" aria-hidden />
                            {__('No hay dominios esperando. Cuando una empresa verifique uno, te llega un correo y aparece aquí.')}
                        </p>
                    ) : (
                        <DomainList rows={toEnable} testId="domains-to-enable" />
                    )}
                </CardContent>
            </Card>

            {data.retired.length > 0 && <RetiredCard rows={data.retired} />}

            {working.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <CircleCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-success" aria-hidden />
                            {__('Funcionando')}
                            <Badge variant="secondary">{working.length}</Badge>
                        </CardTitle>
                        <CardDescription>{__('Responden con su certificado. Los enlaces de esas empresas ya salen por su dominio.')}</CardDescription>
                    </CardHeader>
                    <CardContent className="imcrm-pt-0">
                        <DomainList rows={working} testId="domains-working" />
                    </CardContent>
                </Card>
            )}

            {pending.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Hourglass className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                            {__('Esperando verificación')}
                            <Badge variant="secondary">{pending.length}</Badge>
                        </CardTitle>
                        <CardDescription>
                            {__('La empresa pidió el dominio pero todavía no creó el registro TXT que prueba que es suyo. No hace falta hacer nada en el servidor todavía.')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="imcrm-pt-0">
                        <DomainList rows={pending} testId="domains-pending" />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function HowToCard({ target }: { target: string }): JSX.Element {
    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Globe className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Dominios de las empresas')}</CardTitle>
                        <CardDescription>
                            {__('Cada empresa puede usar su dominio para el equipo y otro para el portal de sus clientes. En este servidor se habilitan a mano en ServerAvatar.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-pt-0">
                <ol className="imcrm-flex imcrm-list-decimal imcrm-flex-col imcrm-gap-1.5 imcrm-pl-5 imcrm-text-sm" data-testid="domains-howto">
                    <li>
                        {__('Espera a que el dominio diga «Apunta aquí»: la empresa tiene que crear un CNAME hacia')}{' '}
                        <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-text-xs">{target}</code>.{' '}
                        {__('Sin eso, Let\'s Encrypt rechaza el certificado.')}
                    </li>
                    <li>{__('En ServerAvatar, abre la aplicación de Imagina Base y agrega el dominio como alias (dominio adicional).')}</li>
                    <li>{__('En el SSL de la aplicación, vuelve a emitir el certificado de Let\'s Encrypt para que incluya el alias.')}</li>
                    <li>{__('Toca «Comprobar». Cuando diga «Responde», los enlaces de esa empresa ya salen por su dominio.')}</li>
                </ol>
                <p className="imcrm-mt-3 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Los alias comparten un solo certificado: si una empresa deja de usar su dominio, sácalo también del servidor (aparece en «Para quitar del servidor»), o la próxima renovación puede fallar para todos.')}
                </p>
            </CardContent>
        </Card>
    );
}

function DomainList({ rows, testId }: { rows: PlatformDomain[]; testId: string }): JSX.Element {
    return (
        <ul className="imcrm-divide-y imcrm-divide-border" data-testid={testId}>
            {rows.map((d) => (
                <DomainRow key={`${d.tenant_id}-${d.kind}-${d.shop_id ?? 0}-${d.domain}`} row={d} />
            ))}
        </ul>
    );
}

const KIND_LABEL: Record<PlatformDomainKind, string> = { app: 'Equipo', portal: 'Portal de clientes', shop: 'Tienda' };

function kindText(row: PlatformDomain): string {
    return row.kind === 'shop' && row.shop_name ? `${__('Tienda')} «${row.shop_name}»` : __(KIND_LABEL[row.kind]);
}

function DomainRow({ row }: { row: PlatformDomain }): JSX.Element {
    const qc = useQueryClient();
    const check = useMutation({
        mutationFn: () => api.platformDomainCheck(row.tenant_id, row.kind, row.shop_id),
        onSuccess: (fresh) => {
            qc.setQueryData<PlatformDomains>(KEY, (prev) =>
                prev
                    ? {
                          ...prev,
                          domains: prev.domains.map((d) =>
                              d.tenant_id === fresh.tenant_id && d.kind === fresh.kind && d.shop_id === fresh.shop_id && d.state === fresh.state ? fresh : d,
                          ),
                      }
                    : prev,
            );
        },
    });
    return (
        <li className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1.5 imcrm-py-2.5" data-domain={row.domain}>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <p className="imcrm-truncate imcrm-font-mono imcrm-text-sm">{row.domain}</p>
                <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                    {row.tenant_name} · {kindText(row)}
                </p>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                <DnsBadge row={row} />
                {row.serving !== null && (
                    <Badge dot variant={row.serving === 'ok' ? 'success' : 'warning'} data-testid="serving-badge">
                        {row.serving === 'ok' ? __('Responde') : __('No responde')}
                    </Badge>
                )}
                <CopyButton text={row.domain} />
                {row.state === 'verified' && (
                    <Button variant="outline" size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
                        {check.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <RefreshCw className="imcrm-h-4 imcrm-w-4" />}
                        {__('Comprobar')}
                    </Button>
                )}
            </div>
        </li>
    );
}

/**
 * v0.1.423 — Lo que las tiendas con dominio propio necesitan del servidor web,
 * UNA vez por servidor: que le pase a la app `/`, `/p/…`, `/sitemap.xml`,
 * `/robots.txt` y `/_imagina/site` (si no es una tienda, la app contesta 404 y
 * el servidor web sigue sirviendo la app como siempre).
 */
export const SITE_ROUTING_NGINX = `# Tiendas con dominio propio (v0.1.423): estas rutas las responde la app.
# Si no es el dominio de una tienda, contesta 404 y se sirve la app como siempre.
location = / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_intercept_errors on;
    error_page 404 502 503 504 = /cloud/index.html;
}
location ~ ^/(?:p/|sitemap\\.xml$|robots\\.txt$|_imagina/) {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_intercept_errors on;
    error_page 404 502 503 504 = /cloud/index.html;
}`;

function SiteRoutingCard({ state, onRecheck, checking }: { state: 'ok' | 'missing' | 'unknown'; onRecheck: () => void; checking: boolean }): JSX.Element {
    return (
        <Card className={state === 'ok' ? undefined : 'imcrm-border-warning/40'} data-testid="site-routing">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <ShoppingBag className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                {__('Tiendas con dominio propio')}
                                <Badge dot variant={state === 'ok' ? 'success' : 'warning'} data-testid="site-routing-state">
                                    {state === 'ok' ? __('Listo en este servidor') : state === 'missing' ? __('Falta un paso en el servidor') : __('No se pudo comprobar')}
                                </Badge>
                            </CardTitle>
                            <CardDescription>
                                {state === 'ok'
                                    ? __('El servidor ya le pasa a la app las páginas de las tiendas (inicio, productos y mapa del sitio). Cada dominio nuevo de una tienda sólo necesita su alias y el certificado.')
                                    : __('Además del alias y el certificado, el servidor tiene que pasarle a la app las páginas de las tiendas. Es un paso único por servidor: mientras falte, el dominio abre la tienda por la dirección de la plataforma y Google no la indexa.')}
                            </CardDescription>
                        </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={onRecheck} disabled={checking}>
                        <RefreshCw className={checking ? 'imcrm-h-4 imcrm-w-4 imcrm-animate-spin' : 'imcrm-h-4 imcrm-w-4'} />
                        {__('Comprobar')}
                    </Button>
                </div>
            </CardHeader>
            {state !== 'ok' && (
                <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-pt-0 imcrm-text-sm">
                    <ol className="imcrm-flex imcrm-list-decimal imcrm-flex-col imcrm-gap-1.5 imcrm-pl-5">
                        <li>{__('En ServerAvatar, abre la aplicación de Imagina Base → «Nginx Config».')}</li>
                        <li>{__('Pega estas dos reglas ANTES de la regla «location /» y guarda.')}</li>
                        <li>{__('Toca «Comprobar». Con Caddy no hace falta: viene en el Caddyfile del release (cópialo de nuevo si lo armaste antes).')}</li>
                    </ol>
                    <div className="imcrm-relative">
                        <pre className="imcrm-max-h-72 imcrm-overflow-auto imcrm-rounded-md imcrm-bg-muted imcrm-p-3 imcrm-text-xs" data-testid="site-routing-snippet">
                            {SITE_ROUTING_NGINX}
                        </pre>
                        <div className="imcrm-absolute imcrm-right-2 imcrm-top-2">
                            <CopyButton text={SITE_ROUTING_NGINX} label={__('Copiar')} />
                        </div>
                    </div>
                </CardContent>
            )}
        </Card>
    );
}

function DnsBadge({ row }: { row: PlatformDomain }): JSX.Element {
    const dns = row.dns;
    if (!dns || dns.status === 'unknown') return <Badge variant="secondary">{__('DNS sin respuesta')}</Badge>;
    if (dns.status === 'ok') return <Badge variant="success">{__('Apunta aquí')}</Badge>;
    const title = dns.current ? `${__('Apunta a')} ${dns.current}` : undefined;
    return (
        <Badge variant="warning" title={title} data-testid="dns-badge">
            {dns.status === 'partial' ? __('Apunta a otro lado') : __('Sin apuntar todavía')}
        </Badge>
    );
}

function RetiredCard({ rows }: { rows: RetiredDomain[] }): JSX.Element {
    const qc = useQueryClient();
    const dismiss = useMutation({
        mutationFn: (domain: string) => api.platformDomainDismissRetired(domain),
        onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    });
    return (
        <Card className="imcrm-border-warning/40">
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Trash2 className="imcrm-h-4 imcrm-w-4 imcrm-text-warning" aria-hidden />
                    {__('Para quitar del servidor')}
                    <Badge variant="warning">{rows.length}</Badge>
                </CardTitle>
                <CardDescription>
                    {__('Estas empresas dejaron de usar su dominio. Saca el alias en ServerAvatar y vuelve a emitir el SSL; después márcalo como hecho.')}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-pt-0">
                <ul className="imcrm-divide-y imcrm-divide-border" data-testid="domains-retired">
                    {rows.map((r) => (
                        <li key={r.domain} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1.5 imcrm-py-2.5">
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-truncate imcrm-font-mono imcrm-text-sm">{r.domain}</p>
                                <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                    {r.tenant_name} · {__('lo quitó el')} {formatDateTimeStr(r.removed_at)}
                                </p>
                            </div>
                            <CopyButton text={r.domain} />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => dismiss.mutate(r.domain)}
                                disabled={dismiss.isPending && dismiss.variables === r.domain}
                            >
                                <Check className="imcrm-h-4 imcrm-w-4" />
                                {__('Ya lo saqué')}
                            </Button>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}

function CopyButton({ text, label }: { text: string; label?: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            variant="ghost"
            size="sm"
            title={__('Copiar')}
            onClick={() => {
                void navigator.clipboard
                    .writeText(text)
                    .then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                    })
                    .catch(() => undefined);
            }}
        >
            {copied ? <Check className="imcrm-h-4 imcrm-w-4 imcrm-text-success" /> : <Copy className="imcrm-h-4 imcrm-w-4" />}
            {label ?? (copied ? __('Copiado') : null)}
        </Button>
    );
}
