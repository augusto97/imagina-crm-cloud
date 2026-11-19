import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { helpSupportSchema } from '@imagina-base/shared';
import { LifeBuoy, Palette } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBrandingData } from '@/hooks/useBranding';
import { __ } from '@/lib/i18n';

import { useAgencySupport, useUpdateAgencySupport } from './useAgency';

/**
 * v0.1.450 (ADR-S108) — Lo que ven las empresas cliente de la agencia:
 * - la MARCA de la app (nombre, logo, colores, ícono) es la de la agencia,
 *   la de Ajustes → Marca de la agencia: aquí sólo se recuerda y se enlaza;
 * - el contacto de SOPORTE del panel de Ayuda es el de la agencia, nunca el
 *   de la plataforma.
 */
export function AgencyBrandCard(): JSX.Element {
    const brand = useBrandingData();
    const support = useAgencySupport();
    const save = useUpdateAgencySupport();
    const [form, setForm] = useState({ email: '', whatsapp: '', url: '', note: '' });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        if (!support.data) return;
        setForm({
            email: support.data.email ?? '',
            whatsapp: support.data.whatsapp ?? '',
            url: support.data.url ?? '',
            note: support.data.note ?? '',
        });
    }, [support.data]);

    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setNotice(null);
        setErrors((prev) => (prev[k] ? { ...prev, [k]: '' } : prev));
        setForm((f) => ({ ...f, [k]: e.target.value }));
    };
    const configured = Boolean(support.data && (support.data.email || support.data.whatsapp || support.data.url));
    const appName = brand.data?.app_name?.trim() || null;
    const hasLogo = Boolean(brand.data?.logo_url);

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        setNotice(null);
        const blank = (v: string): string | null => (v.trim() === '' ? null : v.trim());
        const parsed = helpSupportSchema.safeParse({ email: blank(form.email), whatsapp: blank(form.whatsapp), url: blank(form.url), note: blank(form.note) });
        if (!parsed.success) {
            const next: Record<string, string> = {};
            for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
            setErrors(next);
            return;
        }
        setErrors({});
        save.mutate(parsed.data, {
            onSuccess: () => setNotice({ kind: 'ok', text: __('Guardado. Tus clientes ya lo ven en su Ayuda.') }),
            onError: (err) => setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) }),
        });
    };

    return (
        <Card data-testid="agency-brand-card" data-tour="agency-brand">
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                    <Palette className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                    {__('Lo que ven tus clientes')}
                </CardTitle>
                <CardDescription>
                    {__('Tus empresas cliente ven la app con la marca de tu agencia: su nombre, logo, colores e ícono. Para sus propios clientes (portal, formularios, agenda, tienda) usan la marca de cada empresa.')}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-3">
                        {hasLogo ? (
                            <img src={brand.data!.logo_url!} alt="" className="imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-rounded-md imcrm-object-contain imcrm-ring-1 imcrm-ring-border" />
                        ) : (
                            <span
                                aria-hidden
                                className="imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-rounded-md imcrm-ring-1 imcrm-ring-border"
                                style={{ background: brand.data?.primary_color ?? 'hsl(var(--imcrm-primary))' }}
                            />
                        )}
                        <div className="imcrm-min-w-0 imcrm-text-sm">
                            <p className="imcrm-truncate imcrm-font-medium" data-testid="agency-brand-name">
                                {appName ?? __('Sin nombre de app: se usa el nombre de tu agencia')}
                            </p>
                            <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                                {hasLogo ? __('Con tu logo y tus colores.') : __('Sin logo todavía: se ven tus iniciales y tu color.')}
                            </p>
                        </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                        <Link to="/settings?s=marca" data-testid="agency-brand-edit">
                            {__('Cambiar la marca')}
                        </Link>
                    </Button>
                </div>

                <form className="imcrm-flex imcrm-flex-col imcrm-gap-3" onSubmit={submit} noValidate data-testid="agency-support-form">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <LifeBuoy className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                        <span className="imcrm-text-sm imcrm-font-medium">{__('Contacto de soporte de tus clientes')}</span>
                        {support.data &&
                            (configured ? <Badge variant="success">{__('Visible')}</Badge> : <Badge variant="outline">{__('Sin datos')}</Badge>)}
                    </div>
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                        {__('Aparece al final de la Ayuda de tus empresas cliente como «¿Necesitas más ayuda?». Sin ningún dato, esa parte no se muestra.')}
                    </p>
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <Field id="agency-support-email" label={__('Correo de soporte')} error={errors.email}>
                            <Input id="agency-support-email" type="email" value={form.email} onChange={set('email')} placeholder="soporte@tuagencia.com" data-testid="agency-support-email" />
                        </Field>
                        <Field id="agency-support-wa" label={__('WhatsApp')} hint={__('Con el indicativo del país.')} error={errors.whatsapp}>
                            <Input id="agency-support-wa" value={form.whatsapp} onChange={set('whatsapp')} placeholder="+57 300 123 4567" data-testid="agency-support-whatsapp" />
                        </Field>
                        <Field id="agency-support-url" label={__('Centro de ayuda (opcional)')} hint={__('Una página tuya con más información (https://…).')} error={errors.url}>
                            <Input id="agency-support-url" type="url" value={form.url} onChange={set('url')} placeholder="https://" data-testid="agency-support-url" />
                        </Field>
                        <Field id="agency-support-note" label={__('Nota (opcional)')} hint={__('Una línea: horario, tiempo de respuesta…')} error={errors.note}>
                            <Input id="agency-support-note" value={form.note} onChange={set('note')} maxLength={240} placeholder={__('Lunes a viernes, de 8 a 6.')} />
                        </Field>
                    </div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button type="submit" size="sm" disabled={save.isPending || !support.data} data-testid="agency-support-save">
                            {__('Guardar')}
                        </Button>
                        {notice && (
                            <span role="status" className={notice.kind === 'ok' ? 'imcrm-text-sm imcrm-text-success' : 'imcrm-text-sm imcrm-text-destructive'}>
                                {notice.text}
                            </span>
                        )}
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-space-y-1">
            <Label htmlFor={id}>{label}</Label>
            {children}
            {error ? <p className="imcrm-text-xs imcrm-text-destructive">{error}</p> : hint && <p className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}
