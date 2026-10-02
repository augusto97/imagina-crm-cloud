import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleCheck, Copy, Globe, Hourglass, Loader2, RefreshCw, Trash2, Wrench } from 'lucide-react';
import type { DomainKind, PlatformDomain, PlatformDomains, RetiredDomain } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

/**
 * v0.1.246 — Plataforma → Dominios. El servidor atiende los dominios de las
 * empresas con el camino de ServerAvatar: cada uno se agrega A MANO como
 * alias de la aplicación. Esta es la lista de trabajo del operador:
 *  - "Para habilitar": verificados por la empresa que el servidor todavía no
 *    atiende (los enlaces de esa empresa siguen saliendo por la plataforma);
 *  - "Para quitar del servidor": dominios que una empresa dejó de usar (si
 *    quedan en el certificado y dejan de apuntar acá, la renovación falla);
 *  - "Funcionando" y "Esperando verificación", como referencia.
 */
const KEY = ['platform-domains'];

export function PlatformDomainsCard(): JSX.Element {
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
                            {__('No hay dominios esperando. Cuando una empresa verifique uno, te llega un correo y aparece acá.')}
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
                        {__('Esperá a que el dominio diga «Apunta acá»: la empresa tiene que crear un CNAME hacia')}{' '}
                        <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-text-xs">{target}</code>.{' '}
                        {__('Sin eso, Let\'s Encrypt rechaza el certificado.')}
                    </li>
                    <li>{__('En ServerAvatar, abrí la aplicación de Imagina Base y agregá el dominio como alias (dominio adicional).')}</li>
                    <li>{__('En el SSL de la aplicación, volvé a emitir el certificado de Let\'s Encrypt para que incluya el alias.')}</li>
                    <li>{__('Tocá «Comprobar». Cuando diga «Responde», los enlaces de esa empresa ya salen por su dominio.')}</li>
                </ol>
                <p className="imcrm-mt-3 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Los alias comparten un solo certificado: si una empresa deja de usar su dominio, sacalo también del servidor (aparece en «Para quitar del servidor»), o la próxima renovación puede fallar para todos.')}
                </p>
            </CardContent>
        </Card>
    );
}

function DomainList({ rows, testId }: { rows: PlatformDomain[]; testId: string }): JSX.Element {
    return (
        <ul className="imcrm-divide-y imcrm-divide-border" data-testid={testId}>
            {rows.map((d) => (
                <DomainRow key={`${d.tenant_id}-${d.kind}-${d.domain}`} row={d} />
            ))}
        </ul>
    );
}

const KIND_LABEL: Record<DomainKind, string> = { app: 'Equipo', portal: 'Portal de clientes' };

function DomainRow({ row }: { row: PlatformDomain }): JSX.Element {
    const qc = useQueryClient();
    const check = useMutation({
        mutationFn: () => api.platformDomainCheck(row.tenant_id, row.kind),
        onSuccess: (fresh) => {
            qc.setQueryData<PlatformDomains>(KEY, (prev) =>
                prev
                    ? {
                          ...prev,
                          domains: prev.domains.map((d) =>
                              d.tenant_id === fresh.tenant_id && d.kind === fresh.kind && d.state === fresh.state ? fresh : d,
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
                    {row.tenant_name} · {__(KIND_LABEL[row.kind])}
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

function DnsBadge({ row }: { row: PlatformDomain }): JSX.Element {
    const dns = row.dns;
    if (!dns || dns.status === 'unknown') return <Badge variant="secondary">{__('DNS sin respuesta')}</Badge>;
    if (dns.status === 'ok') return <Badge variant="success">{__('Apunta acá')}</Badge>;
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
                    {__('Estas empresas dejaron de usar su dominio. Sacá el alias en ServerAvatar y volvé a emitir el SSL; después marcalo como hecho.')}
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
