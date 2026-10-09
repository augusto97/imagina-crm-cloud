import { useEffect, useState } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { PlatformLegalView, UpdatePlatformLegalInput } from '@imagina-base/shared';
import { AlertTriangle, Check, Copy, ExternalLink, FileText } from 'lucide-react';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

export const LEGAL_QUERY_KEY = ['platform-legal'] as const;

/**
 * Plataforma → Integraciones → «Páginas públicas» (v0.1.247).
 *
 * Google exige, para publicar y verificar la app, una página principal
 * PÚBLICA que describa la app y una política de privacidad que diga qué se
 * hace con los datos de Google. Microsoft y Slack piden lo mismo. La
 * plataforma las sirve ya armadas; aquí se completa quién es el responsable y,
 * si se quiere, se ajustan los textos.
 */
export function PlatformLegalCard({ q }: { q: UseQueryResult<PlatformLegalView> }): JSX.Element {
    const qc = useQueryClient();
    const view = q.data;
    const [form, setForm] = useState({ app_name: '', company_name: '', contact_email: '', website_url: '', description: '' });
    const [privacy, setPrivacy] = useState<string | null>(null);
    const [terms, setTerms] = useState<string | null>(null);
    const [editing, setEditing] = useState<'privacy' | 'terms' | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (!view || hydrated) return;
        const s = view.settings;
        setForm({
            app_name: s.app_name,
            company_name: s.company_name,
            contact_email: s.contact_email,
            website_url: s.website_url,
            description: s.description,
        });
        setPrivacy(s.privacy_md);
        setTerms(s.terms_md);
        setHydrated(true);
    }, [view, hydrated]);

    const save = useMutation({
        mutationFn: (input: UpdatePlatformLegalInput) => api.platformLegalSet(input),
        onSuccess: (res) => {
            qc.setQueryData(LEGAL_QUERY_KEY, res);
            setPrivacy(res.settings.privacy_md);
            setTerms(res.settings.terms_md);
            setNotice({ kind: 'ok', text: __('Guardado. Las páginas ya muestran los cambios.') });
        },
        onError: (err) => setNotice({ kind: 'err', text: err instanceof CloudApiError || err instanceof Error ? err.message : String(err) }),
    });

    if (q.isError) return <p className="imcrm-text-sm imcrm-text-destructive">{String(q.error)}</p>;
    if (!view) return <Card><CardContent className="imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</CardContent></Card>;

    const missing = view.missing;
    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [k]: e.target.value }));

    return (
        <Card data-testid="platform-legal">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                        <FileText className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    </span>
                    <CardTitle className="imcrm-flex-1">{__('Páginas públicas')}</CardTitle>
                    {missing.length === 0 ? (
                        <Badge variant="success">{__('Listas')}</Badge>
                    ) : (
                        <Badge variant="outline">{__('Faltan datos')}</Badge>
                    )}
                </div>
                <CardDescription>
                    {__(
                        'Google, Microsoft y Slack piden una página principal pública y una política de privacidad para publicar y verificar la app. La plataforma ya las sirve armadas (incluida la cláusula de «uso limitado» que exige Google): completa quién es el responsable y usa estos enlaces en las guías de abajo. Si prefieres usar las de tu propio sitio, también sirve.',
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-4">
                <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-3" data-testid="legal-urls">
                    <UrlChip label={__('Página principal')} url={view.urls.home} />
                    <UrlChip label={__('Política de privacidad')} url={view.urls.privacy} />
                    <UrlChip label={__('Condiciones del servicio')} url={view.urls.terms} />
                </div>
                {missing.length > 0 && (
                    <p className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-warning" data-testid="legal-missing">
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        <span>
                            {__('Para que sirvan en una verificación falta')}: {missing.join(', ')}.
                        </span>
                    </p>
                )}
                <form
                    className="imcrm-space-y-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        setNotice(null);
                        save.mutate({ ...form, privacy_md: privacy, terms_md: terms });
                    }}
                >
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <Field id="legal-app" label={__('Nombre de la app')} hint={__('El mismo que pongas en la pantalla de consentimiento de Google.')}>
                            <Input id="legal-app" value={form.app_name} onChange={set('app_name')} maxLength={80} required />
                        </Field>
                        <Field id="legal-company" label={__('Empresa responsable')} hint={__('Razón social de quien opera la plataforma.')}>
                            <Input id="legal-company" value={form.company_name} onChange={set('company_name')} maxLength={160} data-testid="legal-company" />
                        </Field>
                        <Field id="legal-email" label={__('Correo de contacto y privacidad')} hint={__('También sirve como «correo de asistencia» en Google.')}>
                            <Input id="legal-email" type="email" value={form.contact_email} onChange={set('contact_email')} data-testid="legal-email" />
                        </Field>
                        <Field id="legal-web" label={__('Tu sitio web (opcional)')} hint={__('Se enlaza al pie de las páginas.')}>
                            <Input id="legal-web" type="url" placeholder="https://" value={form.website_url} onChange={set('website_url')} />
                        </Field>
                    </div>
                    <Field id="legal-desc" label={__('Descripción para la página principal')} hint={__('Vacío = la sugerida, que explica qué hace la app y para qué usa las integraciones.')}>
                        <Textarea id="legal-desc" rows={3} value={form.description} placeholder={view.defaults.description.replace(/\{\{app_name\}\}/g, form.app_name || 'La app')} onChange={set('description')} />
                    </Field>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button type="button" size="sm" variant={editing === 'privacy' ? 'secondary' : 'outline'} onClick={() => setEditing(editing === 'privacy' ? null : 'privacy')}>
                            {__('Editar la política de privacidad')}
                            {privacy !== null && <span className="imcrm-ml-1 imcrm-text-[11px] imcrm-text-muted-foreground">({__('propia')})</span>}
                        </Button>
                        <Button type="button" size="sm" variant={editing === 'terms' ? 'secondary' : 'outline'} onClick={() => setEditing(editing === 'terms' ? null : 'terms')}>
                            {__('Editar las condiciones')}
                            {terms !== null && <span className="imcrm-ml-1 imcrm-text-[11px] imcrm-text-muted-foreground">({__('propias')})</span>}
                        </Button>
                    </div>
                    {editing && (
                        <TextEditor
                            value={editing === 'privacy' ? privacy : terms}
                            fallback={editing === 'privacy' ? view.defaults.privacy_md : view.defaults.terms_md}
                            onChange={editing === 'privacy' ? setPrivacy : setTerms}
                        />
                    )}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button type="submit" size="sm" disabled={save.isPending || form.app_name.trim() === ''} data-testid="legal-save">
                            {__('Guardar')}
                        </Button>
                        {notice && (
                            <span className={notice.kind === 'ok' ? 'imcrm-text-sm imcrm-text-success' : 'imcrm-text-sm imcrm-text-destructive'}>
                                {notice.text}
                            </span>
                        )}
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-space-y-1">
            <Label htmlFor={id}>{label}</Label>
            {children}
            {hint && <p className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

function TextEditor({
    value,
    fallback,
    onChange,
}: {
    value: string | null;
    fallback: string;
    onChange: (v: string | null) => void;
}): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Formato: «## Título», «- ítem», **negrita** y [texto](https://…). Los marcadores {{app_name}}, {{company}}, {{email}}, {{app_url}} y {{updated}} se completan solos. Es un punto de partida: revísalo con tu asesor legal.')}
            </p>
            <Textarea rows={16} className="imcrm-font-mono imcrm-text-xs" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} />
            {value !== null && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
                    {__('Volver al texto sugerido')}
                </Button>
            )}
        </div>
    );
}

function UrlChip({ label, url }: { label: string; url: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <div className="imcrm-min-w-0 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-py-2">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-text-xs imcrm-font-medium">{label}</span>
                <span className="imcrm-flex imcrm-shrink-0 imcrm-gap-1">
                    <a href={url} target="_blank" rel="noreferrer" className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted" title={__('Abrir')}>
                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                    </a>
                    <button
                        type="button"
                        className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted"
                        title={__('Copiar')}
                        onClick={() => {
                            void navigator.clipboard?.writeText(url).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            });
                        }}
                    >
                        {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                    </button>
                </span>
            </div>
            <code className="imcrm-mt-1 imcrm-block imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground" title={url}>
                {url.replace(/^https?:\/\//, '')}
            </code>
        </div>
    );
}
