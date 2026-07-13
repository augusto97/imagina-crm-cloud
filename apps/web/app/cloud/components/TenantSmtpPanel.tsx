import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DnsRecordCheck, SmtpConfigPublic } from '@imagina-base/shared';
import { Check, Copy, Mail } from 'lucide-react';
import { api, useSession } from '@/cloud/session';
import { CloudApiError } from '@/lib/cloud/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Form = {
    host: string;
    port: string;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
};

const EMPTY: Form = { host: '', port: '587', secure: false, user: '', pass: '', from: '' };

/**
 * Card "Correo (SMTP)" de Ajustes del WORKSPACE (white-label de correo): la
 * empresa configura su propio servidor de envío y los correos que emite
 * (automatizaciones, portal) salen por él. Sin config → se usa el correo de
 * la plataforma. Sólo admin (el backend igualmente lo exige con 403; el front
 * sólo oculta ante error). El password nunca vuelve del backend: dejarlo
 * vacío al guardar CONSERVA el guardado. "Probar envío" manda un correo de
 * prueba al email del propio admin; "Volver al correo de la plataforma"
 * borra la config propia (DELETE).
 */
export function TenantSmtpPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const myEmail = useSession((s) => s.user?.email ?? '');
    const smtpQ = useQuery({
        queryKey: ['tenant-smtp', tenantId],
        queryFn: () => api.tenantSmtpGet(),
        retry: false,
    });

    const [form, setForm] = useState<Form>(EMPTY);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        const c = smtpQ.data;
        if (!c) return;
        setForm({
            host: c.host,
            port: String(c.port || 587),
            secure: c.secure,
            user: c.user,
            pass: '',
            from: c.from,
        });
    }, [smtpQ.data]);

    const invalidate = (): Promise<void> =>
        qc.invalidateQueries({ queryKey: ['tenant-smtp', tenantId] });

    const save = useMutation({
        mutationFn: () =>
            api.tenantSmtpSet({
                host: form.host.trim(),
                port: Number(form.port) || 587,
                secure: form.secure,
                user: form.user.trim(),
                pass: form.pass,
                from: form.from.trim(),
            }),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Configuración SMTP guardada.' });
            void invalidate();
        },
        onError: (e) =>
            setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'No se pudo guardar.' }),
    });

    const sendTest = useMutation({
        mutationFn: () => api.tenantSmtpTest(),
        onSuccess: (r) =>
            setNotice(
                r.ok
                    ? { kind: 'ok', text: `Correo de prueba enviado a ${myEmail || 'tu email'}.` }
                    : { kind: 'err', text: r.error || 'No se pudo enviar la prueba.' },
            ),
        onError: (e) =>
            setNotice({
                kind: 'err',
                text: e instanceof Error ? e.message : 'No se pudo enviar la prueba.',
            }),
    });

    const clear = useMutation({
        mutationFn: () => api.tenantSmtpClear(),
        onSuccess: () => {
            setForm(EMPTY);
            setNotice({ kind: 'ok', text: 'Listo: los correos vuelven a salir por el correo de la plataforma.' });
            void invalidate();
        },
        onError: (e) =>
            setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'No se pudo desactivar.' }),
    });

    // 403 (no admin) o cualquier error → ocultar el panel (mismo patrón que
    // el SMTP global de plataforma).
    if (smtpQ.isError) return null;
    if (!smtpQ.data) return null;

    const c: SmtpConfigPublic = smtpQ.data;
    const busy = save.isPending || sendTest.isPending || clear.isPending;
    const canSave = form.host.trim().length > 0 && form.from.trim().length > 0 && !busy;

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <Mail className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>Correo (SMTP) del workspace</CardTitle>
                            <CardDescription>
                                Servidor de envío propio de tu empresa para automatizaciones y magic links del portal.
                            </CardDescription>
                        </div>
                    </div>
                    <Badge dot variant={c.configured ? 'success' : 'secondary'} className="imcrm-shrink-0">
                        {c.configured ? 'SMTP propio' : 'Correo de la plataforma'}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
            {!c.configured && (
                <div className="imcrm-rounded-md imcrm-bg-muted/60 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                    <span className="imcrm-font-medium imcrm-text-foreground">
                        Usando el correo de la plataforma.
                    </span>{' '}
                    Al configurar un servidor SMTP propio, los correos que envía tu empresa
                    —automatizaciones, magic links del portal— salen por tu propio servidor y con tu
                    remitente.
                </div>
            )}

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    if (canSave) save.mutate();
                }}
                className="imcrm-space-y-4"
            >
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                <Field label="Host">
                    <input
                        className={inputCls}
                        value={form.host}
                        onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                        placeholder="smtp.tu-proveedor.com"
                    />
                </Field>
                <Field label="Puerto">
                    <input
                        className={inputCls}
                        value={form.port}
                        inputMode="numeric"
                        onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                        placeholder="587"
                    />
                </Field>
                <Field label="Usuario">
                    <input
                        className={inputCls}
                        value={form.user}
                        onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                        placeholder="apikey / usuario"
                        autoComplete="off"
                    />
                </Field>
                <Field label={c.configured ? 'Contraseña (dejar vacío = mantener)' : 'Contraseña'}>
                    <input
                        className={inputCls}
                        type="password"
                        value={form.pass}
                        onChange={(e) => setForm((f) => ({ ...f, pass: e.target.value }))}
                        placeholder={c.configured ? '••••••••' : ''}
                        autoComplete="new-password"
                    />
                </Field>
                <Field label="Remitente (From)">
                    <input
                        className={inputCls}
                        value={form.from}
                        onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
                        placeholder="Tu Empresa <no-reply@tu-dominio.com>"
                    />
                </Field>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-self-end imcrm-text-sm">
                    <input
                        type="checkbox"
                        checked={form.secure}
                        onChange={(e) => setForm((f) => ({ ...f, secure: e.target.checked }))}
                    />
                    Conexión segura (SSL/TLS, puerto 465)
                </label>
            </div>

            {c.configured && form.pass.length === 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    Dejá la contraseña vacía para conservar la actual. Escribí una nueva sólo si querés cambiarla.
                </p>
            )}

            {notice && (
                <div
                    className={[
                        'imcrm-rounded-md imcrm-p-2 imcrm-text-sm',
                        notice.kind === 'ok'
                            ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800'
                            : 'imcrm-bg-rose-100 imcrm-text-rose-800',
                    ].join(' ')}
                >
                    {notice.text}
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button type="submit" size="sm" disabled={!canSave}>
                    {save.isPending ? 'Guardando…' : 'Guardar'}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => sendTest.mutate()}
                    disabled={busy}
                    title={myEmail ? `Envía un correo de prueba a ${myEmail}` : undefined}
                >
                    {sendTest.isPending ? 'Enviando…' : 'Probar envío'}
                </Button>
                {c.configured && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="imcrm-ml-auto imcrm-text-muted-foreground"
                        onClick={() => clear.mutate()}
                        disabled={busy}
                    >
                        {clear.isPending ? 'Desactivando…' : 'Volver al correo de la plataforma'}
                    </Button>
                )}
            </div>
            </form>

            {c.configured && <DnsSection />}
            </CardContent>
        </Card>
    );
}

const PURPOSE_LABEL: Record<DnsRecordCheck['purpose'], string> = {
    spf: 'SPF',
    dkim: 'DKIM',
    dmarc: 'DMARC',
};

const STATUS_META: Record<
    DnsRecordCheck['status'],
    { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
    ok: { label: 'Configurado', variant: 'success' },
    partial: { label: 'Parcial', variant: 'warning' },
    missing: { label: 'Falta', variant: 'destructive' },
    unknown: { label: 'Desconocido', variant: 'secondary' },
};

/**
 * Registros DNS (SPF/DKIM/DMARC) que el admin debe crear en el dominio del
 * remitente para que los correos del SMTP propio no caigan en spam. La
 * verificación es on-demand ("Verificar DNS" → el backend resuelve en vivo).
 */
function DnsSection(): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const [copied, setCopied] = useState<string | null>(null);

    const dnsQ = useQuery({
        queryKey: ['tenant-smtp-dns', tenantId],
        queryFn: () => api.tenantSmtpDns(),
        enabled: false,
        retry: false,
    });

    const handleCopy = async (key: string, text: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* clipboard bloqueado — no-op */
        }
    };

    const report = dnsQ.data;
    const errorText = dnsQ.isError
        ? dnsQ.error instanceof CloudApiError && dnsQ.error.code === 'smtp_not_configured'
            ? 'Guardá primero la configuración SMTP con un remitente válido.'
            : dnsQ.error instanceof Error
              ? dnsQ.error.message
              : 'No se pudo verificar el DNS.'
        : null;

    return (
        <section className="imcrm-space-y-3 imcrm-border-t imcrm-border-border imcrm-pt-4">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div>
                    <h4 className="imcrm-text-sm imcrm-font-medium">
                        Registros DNS (SPF / DKIM / DMARC)
                    </h4>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        Para que tus correos no caigan en spam, creá estos registros en el DNS de tu
                        dominio remitente
                        {report ? (
                            <>
                                {' '}
                                (<span className="imcrm-font-medium imcrm-text-foreground">{report.domain}</span>
                                {report.provider !== 'desconocido' && <> · proveedor detectado: {report.provider}</>}
                                ).
                            </>
                        ) : (
                            '.'
                        )}
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void dnsQ.refetch()}
                    disabled={dnsQ.isFetching}
                >
                    {dnsQ.isFetching ? 'Verificando…' : 'Verificar DNS'}
                </Button>
            </div>

            {errorText && (
                <div className="imcrm-rounded-md imcrm-bg-rose-100 imcrm-p-2 imcrm-text-sm imcrm-text-rose-800">
                    {errorText}
                </div>
            )}

            {report && (
                <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border">
                    {report.records.map((rec) => {
                        const meta = STATUS_META[rec.status];
                        const fqdn = rec.host === '@' ? report.domain : `${rec.host}.${report.domain}`;
                        const copyKey = `${rec.purpose}:${rec.host}`;
                        return (
                            <li key={copyKey} className="imcrm-space-y-2 imcrm-p-3">
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                    <Badge variant="outline">{PURPOSE_LABEL[rec.purpose]}</Badge>
                                    <Badge dot variant={meta.variant}>{meta.label}</Badge>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                        Tipo: <span className="imcrm-font-medium imcrm-text-foreground">{rec.type}</span>
                                    </span>
                                </div>
                                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                                    <div className="imcrm-min-w-0 imcrm-text-sm">
                                        <div className="imcrm-text-xs imcrm-text-muted-foreground">Host</div>
                                        <code className="imcrm-break-all imcrm-font-mono imcrm-text-xs">{rec.host}</code>
                                        <div className="imcrm-break-all imcrm-text-xs imcrm-text-muted-foreground">
                                            ({fqdn})
                                        </div>
                                    </div>
                                    <div className="imcrm-min-w-0 imcrm-text-sm">
                                        <div className="imcrm-text-xs imcrm-text-muted-foreground">Valor</div>
                                        {rec.value ? (
                                            <div className="imcrm-flex imcrm-items-start imcrm-gap-1.5">
                                                <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-xs">
                                                    {rec.value}
                                                </code>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="imcrm-h-6 imcrm-shrink-0 imcrm-px-1.5"
                                                    onClick={() => void handleCopy(copyKey, rec.value)}
                                                    title="Copiar valor"
                                                >
                                                    {copied === copyKey ? (
                                                        <>
                                                            <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                                            <span className="imcrm-ml-1 imcrm-text-xs">Copiado</span>
                                                        </>
                                                    ) : (
                                                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                                    )}
                                                </Button>
                                            </div>
                                        ) : (
                                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                                {rec.note || 'La clave la genera tu proveedor de correo.'}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                {rec.value.length > 0 && rec.note && (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{rec.note}</p>
                                )}
                                {(rec.status === 'partial' || rec.status === 'ok') && rec.current && (
                                    <p className="imcrm-break-all imcrm-text-xs imcrm-text-muted-foreground">
                                        Encontrado: <code className="imcrm-font-mono">{rec.current}</code>
                                    </p>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

const inputCls =
    'imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-py-1.5 imcrm-text-sm';

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
    return (
        <label className="imcrm-block imcrm-space-y-1">
            <span className="imcrm-text-xs imcrm-text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}
