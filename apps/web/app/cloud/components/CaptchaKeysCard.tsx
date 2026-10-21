import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CAPTCHA_PROVIDER_INFO, CAPTCHA_PROVIDERS, type CaptchaProvider } from '@imagina-base/shared';
import { AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.289 — Llaves de la verificación anti-robots (captcha) de los
 * formularios. La misma tarjeta para la PLATAFORMA (las usan todas las
 * empresas que no cargaron las suyas) y para la EMPRESA (ganan sobre las de
 * la plataforma). El secreto nunca vuelve del servidor: sólo sus últimos
 * caracteres; dejarlo vacío al guardar conserva el anterior.
 */
export function CaptchaKeysCard({ scope }: { scope: 'tenant' | 'platform' }): JSX.Element | null {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const key = ['captcha-keys', scope] as const;
    const q = useQuery({ queryKey: key, queryFn: () => api.captchaKeysGet(scope), retry: false });
    const [provider, setProvider] = useState<CaptchaProvider>('turnstile');
    const [siteKey, setSiteKey] = useState('');
    const [secret, setSecret] = useState('');
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (!q.data || hydrated) return;
        if (q.data.provider) setProvider(q.data.provider);
        setSiteKey(q.data.site_key ?? '');
        setHydrated(true);
    }, [q.data, hydrated]);

    const invalidate = (): void => {
        void qc.invalidateQueries({ queryKey: ['forms-captcha'] });
    };
    const save = useMutation({
        mutationFn: () => api.captchaKeysSet(scope, { provider, site_key: siteKey.trim(), secret: secret.trim() }),
        onSuccess: (res) => {
            qc.setQueryData(key, res);
            setSecret('');
            invalidate();
            setNotice({ kind: 'ok', text: __('Guardado. Los formularios con la verificación activada ya la usan.') });
        },
        onError: (err) => setNotice({ kind: 'err', text: err instanceof CloudApiError || err instanceof Error ? err.message : String(err) }),
    });
    const clear = useMutation({
        mutationFn: () => api.captchaKeysClear(scope),
        onSuccess: () => {
            qc.setQueryData(key, { configured: false, provider: null, site_key: null, secret_hint: null, secret_unreadable: false });
            setSiteKey('');
            setSecret('');
            invalidate();
            setNotice({ kind: 'ok', text: scope === 'tenant' ? __('Listo: tus formularios usan las llaves de la plataforma (si hay).') : __('Llaves quitadas.') });
        },
    });

    // Sin permiso (no es admin): el panel no se muestra.
    if (q.isError) return null;
    const st = q.data;
    const info = CAPTCHA_PROVIDER_INFO[provider];
    const sameAsSaved = st?.provider === provider && (st?.site_key ?? '') === siteKey.trim();
    const needSecret = !sameAsSaved || !st?.configured || st.secret_unreadable;

    return (
        <Card data-testid={`captcha-keys-${scope}`}>
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                        <ShieldCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    </span>
                    <CardTitle className="imcrm-flex-1">{__('Verificación anti-robots (captcha)')}</CardTitle>
                    {st?.configured ? (
                        <Badge variant={st.secret_unreadable ? 'destructive' : 'success'}>
                            {st.secret_unreadable ? __('Hay que volver a cargar el secreto') : CAPTCHA_PROVIDER_INFO[st.provider!].label}
                        </Badge>
                    ) : (
                        <Badge variant="outline">{__('Sin llaves')}</Badge>
                    )}
                </div>
                <CardDescription>
                    {scope === 'tenant'
                        ? __('Los formularios con «Pedir verificación anti-robots» la muestran antes de enviar. Si cargas llaves aquí, se usan las de tu empresa; si no, las de la plataforma (si el operador las cargó).')
                        : __('Las usan los formularios de todas las empresas que no cargaron sus propias llaves (en Ajustes → Portal y formularios). Cada formulario decide si la pide.')}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-4">
                {st?.secret_unreadable && (
                    <p className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive">
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        {__('La llave secreta guardada no se puede leer con la clave de cifrado actual del servidor. Escríbela de nuevo y guarda.')}
                    </p>
                )}
                <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-3" role="radiogroup" aria-label={__('Proveedor')}>
                    {CAPTCHA_PROVIDERS.map((p) => {
                        const i = CAPTCHA_PROVIDER_INFO[p];
                        return (
                            <button
                                key={p}
                                type="button"
                                role="radio"
                                aria-checked={provider === p}
                                onClick={() => setProvider(p)}
                                data-testid={`captcha-provider-${p}`}
                                className={cn(
                                    'imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                                    provider === p ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent',
                                )}
                            >
                                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                    {i.label}
                                    {i.recommended && <Badge variant="success" className="imcrm-text-[10px]">{__('Recomendado')}</Badge>}
                                </span>
                                <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__(i.blurb)}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                    <p className="imcrm-mb-2 imcrm-text-xs imcrm-font-semibold">{__('Cómo conseguir las llaves')}</p>
                    <ol className="imcrm-list-decimal imcrm-space-y-1 imcrm-pl-5 imcrm-text-xs imcrm-text-muted-foreground">
                        {info.steps.map((s) => (
                            <li key={s}>{__(s)}</li>
                        ))}
                    </ol>
                    <a
                        href={info.console_url}
                        target="_blank"
                        rel="noreferrer"
                        className="imcrm-mt-2 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
                    >
                        <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                        {__('Abrir el panel de')} {info.label}
                    </a>
                </div>

                <form
                    className="imcrm-space-y-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        setNotice(null);
                        save.mutate();
                    }}
                >
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor={`cap-site-${scope}`}>
                                {__('Llave del sitio')} <span className="imcrm-text-muted-foreground">({info.site_key_label})</span>
                            </Label>
                            <Input
                                id={`cap-site-${scope}`}
                                value={siteKey}
                                onChange={(e) => setSiteKey(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                className="imcrm-font-mono imcrm-text-xs"
                                data-testid="captcha-site-key"
                                required
                            />
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Es pública: viaja en la página del formulario.')}</p>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor={`cap-secret-${scope}`}>
                                {__('Llave secreta')} <span className="imcrm-text-muted-foreground">({info.secret_label})</span>
                            </Label>
                            <Input
                                id={`cap-secret-${scope}`}
                                type="password"
                                value={secret}
                                onChange={(e) => setSecret(e.target.value)}
                                autoComplete="new-password"
                                spellCheck={false}
                                placeholder={!needSecret && st?.secret_hint ? `${__('Guardada')} ${st.secret_hint}` : ''}
                                className="imcrm-font-mono imcrm-text-xs"
                                data-testid="captcha-secret"
                                required={needSecret}
                            />
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {needSecret
                                    ? __('Se guarda cifrada y nunca se vuelve a mostrar.')
                                    : __('Déjala vacía para conservar la guardada.')}
                            </p>
                        </div>
                    </div>
                    {notice && (
                        <p
                            role="status"
                            className={cn('imcrm-text-xs', notice.kind === 'ok' ? 'imcrm-text-success' : 'imcrm-text-destructive')}
                            data-testid="captcha-notice"
                        >
                            {notice.text}
                        </p>
                    )}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button type="submit" size="sm" disabled={save.isPending} data-testid="captcha-save">
                            {__('Guardar llaves')}
                        </Button>
                        {st?.configured && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={clear.isPending}
                                onClick={() =>
                                    void confirm({
                                        title: __('¿Quitar las llaves?'),
                                        description:
                                            scope === 'tenant'
                                                ? __('Tus formularios pasan a usar las llaves de la plataforma; si no hay, dejan de pedir la verificación.')
                                                : __('Los formularios de las empresas sin llaves propias dejan de pedir la verificación.'),
                                        confirmLabel: __('Quitar'),
                                        destructive: true,
                                    }).then((ok) => ok && clear.mutate())
                                }
                            >
                                {__('Quitar llaves')}
                            </Button>
                        )}
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
