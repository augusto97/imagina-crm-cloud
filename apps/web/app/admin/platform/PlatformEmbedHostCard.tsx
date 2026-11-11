import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, CircleAlert, CircleCheck, CircleMinus, Copy, Gauge, Loader2 } from 'lucide-react';
import { cloudflareCacheRuleExpression, type NetworkCheckResult, type PlatformNetworkView } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.409 (ADR-S102) — Plataforma → Dominios → «Dirección rápida para los
 * sitios web». Lo que se inserta en los sitios de las empresas (el widget de
 * contacto, los formularios y la agenda) sale por una dirección aparte que
 * pasa por Cloudflare: Cloudflare lo entrega desde su red y este servidor casi
 * no lo ve. La app del equipo y los dominios propios siguen como están.
 */
const KEY = ['platform-network'];

export function PlatformEmbedHostCard(): JSX.Element {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: KEY, queryFn: () => api.platformNetworkGet() });
    const [origin, setOrigin] = useState('');
    const [cloudflare, setCloudflare] = useState(true);
    const [result, setResult] = useState<NetworkCheckResult | null>(null);
    const [showSteps, setShowSteps] = useState<boolean | null>(null);

    useEffect(() => {
        if (!q.data) return;
        setOrigin(q.data.embed_origin ?? '');
        setCloudflare(q.data.embed_origin ? q.data.cloudflare : true);
    }, [q.data]);

    const input = { embed_origin: origin.trim() === '' ? null : origin.trim(), cloudflare };
    const check = useMutation({
        mutationFn: () => api.platformNetworkCheck(input),
        onSuccess: setResult,
        onError: () => setResult(null),
    });
    const save = useMutation({
        mutationFn: (body: typeof input) => api.platformNetworkUpdate(body),
        onSuccess: (view) => {
            qc.setQueryData<PlatformNetworkView>(KEY, view);
            setResult(null);
        },
    });

    if (q.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-6 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
            </p>
        );
    }
    if (q.isError || !q.data) {
        return <p className="imcrm-p-6 imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar la dirección rápida.')}</p>;
    }
    const view = q.data;
    const active = view.embed_origin;
    const dirty = (input.embed_origin ?? '') !== (active ?? '') || (active !== null && cloudflare !== view.cloudflare);
    const stepsOpen = showSteps ?? active === null;
    const error = (check.error ?? save.error) as Error | null;
    const exampleHost = suggestHost(view.app_origin);
    const ruleHost = input.embed_origin ?? active ?? `https://${exampleHost}`;

    return (
        <Card data-testid="platform-embed-host" data-tour="platform-embed-host">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <Gauge className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0">
                            <CardTitle>{__('Dirección rápida para los sitios web')}</CardTitle>
                            <CardDescription>
                                {__('El widget de contacto, los formularios y la agenda que las empresas pegan en sus sitios se cargan en cada visita. Con una dirección aparte que pase por Cloudflare, Cloudflare los entrega desde su red y este servidor casi no los ve. La app y los dominios propios de las empresas siguen como están.')}
                            </CardDescription>
                        </div>
                    </div>
                    <Badge dot variant={active ? 'success' : 'secondary'} data-testid="embed-host-status">
                        {active ? `${__('Activa:')} ${hostOf(active)}` : __('Sin configurar')}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-0">
                <div>
                    <button
                        type="button"
                        className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium"
                        onClick={() => setShowSteps(!stepsOpen)}
                        aria-expanded={stepsOpen}
                        data-testid="embed-host-steps-toggle"
                    >
                        <ChevronDown className={cn('imcrm-h-4 imcrm-w-4 imcrm-transition-transform', !stepsOpen && '-imcrm-rotate-90')} aria-hidden />
                        {__('Cómo se configura (una sola vez)')}
                    </button>
                    {stepsOpen && (
                        <ol className="imcrm-mt-2 imcrm-flex imcrm-list-decimal imcrm-flex-col imcrm-gap-2 imcrm-pl-5 imcrm-text-sm" data-testid="embed-host-steps">
                            <li>
                                {__('En Cloudflare → DNS, crea un registro CNAME con el nombre')} <Code>{exampleHost.split('.')[0] ?? 'w'}</Code>{' '}
                                {__('que apunte a')} <Code>{hostOf(view.app_origin)}</Code>. {__('Déjalo en gris (DNS only) por ahora.')}
                                <Hint>
                                    {__('Usa un subdominio directo de tu dominio, como')} <Code>{exampleHost}</Code>
                                    {__(': el certificado gratis de Cloudflare no cubre uno de segundo nivel (w.app.tudominio.com).')}
                                </Hint>
                            </li>
                            <li>{__('En ServerAvatar, agrega esa dirección como alias de la aplicación y vuelve a emitir el certificado de Let\'s Encrypt.')}</li>
                            <li>{__('De vuelta en Cloudflare, pon el registro en naranja (Proxied). En SSL/TLS, usa el modo «Full (strict)».')}</li>
                            <li>
                                {__('En Caching → Cache Rules, crea una regla con esta condición:')}
                                <CopyBlock text={cloudflareCacheRuleExpression(ruleHost)} testId="embed-host-rule" />
                                {__('Acción: «Eligible for cache». Edge TTL: «Use cache-control header if present, bypass cache if not». Browser TTL: «Respect origin».')}
                                <Hint>{__('Cada respuesta ya dice si se puede guardar y por cuánto; lo que no se guarda (envíos, clics, estadísticas) va con «no-store» o por POST.')}</Hint>
                            </li>
                            <li>
                                {__('En Rules → Configuration Rules, para esa misma condición, apaga «Email Obfuscation» y «Rocket Loader»: cambian el HTML y rompen las páginas.')}
                            </li>
                            <li>{__('Si los formularios usan captcha (Turnstile, hCaptcha o reCAPTCHA), agrega la dirección a los dominios permitidos de la clave.')}</li>
                            <li>{__('Escribe la dirección aquí abajo, toca «Comprobar» y, si todo está bien, «Guardar».')}</li>
                        </ol>
                    )}
                </div>

                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <span className="imcrm-text-sm imcrm-font-medium">{__('Dirección')}</span>
                        <Input
                            value={origin}
                            placeholder={exampleHost}
                            onChange={(e) => {
                                setOrigin(e.target.value);
                                setResult(null);
                            }}
                            className="imcrm-font-mono"
                            data-testid="embed-host-input"
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </label>
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-text-sm">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                            checked={cloudflare}
                            onChange={(e) => {
                                setCloudflare(e.target.checked);
                                setResult(null);
                            }}
                            data-testid="embed-host-cloudflare"
                        />
                        <span>
                            <span className="imcrm-font-medium">{__('Las visitas llegan por Cloudflare (nube naranja)')}</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Así el servidor ve la IP real de cada visitante y los límites por visitante siguen funcionando.')}
                            </span>
                        </span>
                    </label>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button variant="outline" size="sm" disabled={input.embed_origin === null || check.isPending} onClick={() => check.mutate()} data-testid="embed-host-check">
                            {check.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : null}
                            {__('Comprobar')}
                        </Button>
                        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(input)} data-testid="embed-host-save">
                            {save.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : null}
                            {__('Guardar')}
                        </Button>
                        {active && (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={save.isPending}
                                onClick={() => save.mutate({ embed_origin: null, cloudflare: false })}
                                data-testid="embed-host-remove"
                            >
                                {__('Dejar de usarla')}
                            </Button>
                        )}
                    </div>
                    {error && (
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-text-destructive" role="alert" data-testid="embed-host-error">
                            <CircleAlert className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                            {error.message}
                        </p>
                    )}
                    {result && <CheckResult result={result} />}
                </div>

                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Los códigos que copien las empresas desde ahora salen por la dirección rápida (salvo las que usan su dominio propio). Los que ya pegaron siguen funcionando por la dirección de la app; para que pasen por Cloudflare, que copien el código de nuevo.')}
                </p>
            </CardContent>
        </Card>
    );
}

function CheckResult({ result }: { result: NetworkCheckResult }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="embed-host-result" data-ok={result.ok ? '1' : '0'}>
            <p className={cn('imcrm-text-sm imcrm-font-medium', result.ok ? 'imcrm-text-success' : 'imcrm-text-warning')}>
                {result.ok ? __('Todo bien: ya puedes guardarla.') : __('Falta algo:')}
            </p>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {result.steps.map((s) => {
                    const Icon = s.ok === true ? CircleCheck : s.ok === false ? CircleAlert : CircleMinus;
                    return (
                        <li key={s.id} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm" data-step={s.id} data-ok={s.ok === null ? 'na' : s.ok ? '1' : '0'}>
                            <Icon
                                className={cn(
                                    'imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0',
                                    s.ok === true ? 'imcrm-text-success' : s.ok === false ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground',
                                )}
                                aria-hidden
                            />
                            <span>{s.detail}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Code({ children }: { children: string }): JSX.Element {
    return <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-font-mono imcrm-text-xs">{children}</code>;
}

function Hint({ children }: { children: React.ReactNode }): JSX.Element {
    return <span className="imcrm-mt-0.5 imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{children}</span>;
}

function CopyBlock({ text, testId }: { text: string; testId: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <span className="imcrm-my-1.5 imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/50 imcrm-p-2">
            <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-font-mono imcrm-text-xs" data-testid={testId}>
                {text}
            </code>
            <Button
                variant="ghost"
                size="sm"
                className="imcrm-h-7 imcrm-shrink-0 imcrm-px-2"
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
                {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
            </Button>
        </span>
    );
}

function hostOf(origin: string): string {
    try {
        return new URL(origin).host;
    } catch {
        return origin;
    }
}

/** `base.tudominio.com` → `w.tudominio.com` (al mismo nivel, para el certificado gratis de Cloudflare). */
export function suggestHost(appOrigin: string): string {
    const host = hostOf(appOrigin).replace(/:\d+$/, '');
    const parts = host.split('.');
    if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1] ?? '')) return 'w.tudominio.com';
    const domain = parts.slice(-2).join('.');
    return `w.${domain}`;
}
