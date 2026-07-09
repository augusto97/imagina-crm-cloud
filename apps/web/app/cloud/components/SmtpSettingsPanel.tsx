import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SmtpConfigPublic } from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';

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
 * Config SMTP de plataforma (ADR-S11). Sólo la ve el superadmin: si
 * `GET /system/smtp` responde 403, el componente no renderiza nada. El
 * password nunca vuelve del backend; se deja en blanco (dejarlo vacío al
 * guardar borra la contraseña, así que se advierte). Un botón envía un correo
 * de prueba con la config recién guardada.
 */
export function SmtpSettingsPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const smtpQ = useQuery({
        queryKey: ['smtp-config'],
        queryFn: () => api.smtpGet(),
        retry: false,
    });

    const [form, setForm] = useState<Form>(EMPTY);
    const [testTo, setTestTo] = useState('');
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

    const save = useMutation({
        mutationFn: () =>
            api.smtpSet({
                host: form.host.trim(),
                port: Number(form.port) || 587,
                secure: form.secure,
                user: form.user.trim(),
                pass: form.pass,
                from: form.from.trim(),
            }),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Configuración SMTP guardada.' });
            void qc.invalidateQueries({ queryKey: ['smtp-config'] });
        },
        onError: (e) =>
            setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'No se pudo guardar.' }),
    });

    const sendTest = useMutation({
        mutationFn: () => api.smtpTest(testTo.trim()),
        onSuccess: () =>
            setNotice({ kind: 'ok', text: `Correo de prueba encolado hacia ${testTo.trim()}.` }),
        onError: (e) =>
            setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'No se pudo enviar la prueba.' }),
    });

    // 403 (no superadmin) o cualquier error → ocultar el panel.
    if (smtpQ.isError) {
        if (smtpQ.error instanceof CloudApiError) {
            // 403 esperado para no-superadmin; otros errores tampoco bloquean.
        }
        return null;
    }
    if (!smtpQ.data) return null;

    const c: SmtpConfigPublic = smtpQ.data;
    const canSave = form.host.trim().length > 0 && form.from.trim().length > 0 && !save.isPending;

    return (
        <section className="imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5">
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between">
                <div>
                    <h2 className="imcrm-text-sm imcrm-font-semibold">Sistema · Correo (SMTP)</h2>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        Servidor de envío para recuperación de accesos, magic links y notificaciones (superadmin).
                    </p>
                </div>
                <span
                    className={[
                        'imcrm-rounded-full imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium',
                        c.configured
                            ? 'imcrm-bg-emerald-100 imcrm-text-emerald-700'
                            : 'imcrm-bg-muted imcrm-text-muted-foreground',
                    ].join(' ')}
                >
                    {c.configured ? 'Configurado' : 'Sin configurar'}
                </span>
            </div>

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
                        placeholder="Imagina Base <no-reply@tu-dominio.com>"
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

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-gap-2">
                <Button size="sm" onClick={() => save.mutate()} disabled={!canSave}>
                    {save.isPending ? 'Guardando…' : 'Guardar'}
                </Button>
                <div className="imcrm-ml-auto imcrm-flex imcrm-items-end imcrm-gap-2">
                    <Field label="Enviar prueba a">
                        <input
                            className={inputCls}
                            value={testTo}
                            onChange={(e) => setTestTo(e.target.value)}
                            placeholder="tu@correo.com"
                        />
                    </Field>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => sendTest.mutate()}
                        disabled={!testTo.includes('@') || sendTest.isPending}
                    >
                        {sendTest.isPending ? 'Enviando…' : 'Probar'}
                    </Button>
                </div>
            </div>
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
