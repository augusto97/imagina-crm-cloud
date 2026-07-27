import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, LogOut, MailCheck, MailWarning, Monitor, Smartphone } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

/**
 * v0.1.116 — Seguridad de la cuenta: cambiar la contraseña estando adentro
 * (antes sólo se podía por el email de "olvidé mi contraseña") y ver/cerrar
 * las sesiones abiertas en otros dispositivos.
 *
 * El id de cada sesión es un hash del token — el token nunca sale del
 * servidor, así que este panel no puede filtrar credenciales.
 */

/** User-Agent crudo → algo legible ("Chrome en Windows"). */
function describeDevice(ua: string): { label: string; mobile: boolean } {
    if (ua === '') return { label: __('Dispositivo desconocido'), mobile: false };
    const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
    const browser =
        /Edg\//.test(ua) ? 'Edge'
        : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
        : /Firefox\//.test(ua) ? 'Firefox'
        : __('Navegador');
    const os =
        /Windows/i.test(ua) ? 'Windows'
        : /Macintosh|Mac OS/i.test(ua) ? 'macOS'
        : /Android/i.test(ua) ? 'Android'
        : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
        : /Linux/i.test(ua) ? 'Linux'
        : '';
    return { label: os !== '' ? `${browser} · ${os}` : browser, mobile };
}

export function SecurityCard(): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const user = useSession((s) => s.user);
    const [resent, setResent] = useState(false);
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [repeat, setRepeat] = useState('');

    const sessions = useQuery({
        queryKey: ['account-sessions'],
        queryFn: async () => (await api.activeSessions()).data,
        staleTime: 15_000,
    });

    const change = useMutation({
        mutationFn: () => api.changePassword({ current_password: current, new_password: next }),
        onSuccess: (res) => {
            setCurrent('');
            setNext('');
            setRepeat('');
            void qc.invalidateQueries({ queryKey: ['account-sessions'] });
            toast.success(
                __('Contraseña actualizada'),
                res.revoked_sessions > 0
                    ? `${__('Se cerraron')} ${res.revoked_sessions} ${__('sesiones en otros dispositivos.')}`
                    : undefined,
            );
        },
        onError: (err: unknown) => {
            toast.error(
                __('No se pudo cambiar la contraseña'),
                err instanceof Error ? err.message : undefined,
            );
        },
    });

    const revokeOne = useMutation({
        mutationFn: (id: string) => api.revokeSession(id),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['account-sessions'] }),
    });

    const revokeOthers = useMutation({
        mutationFn: () => api.revokeOtherSessions(),
        onSuccess: (res) => {
            void qc.invalidateQueries({ queryKey: ['account-sessions'] });
            toast.success(`${__('Sesiones cerradas:')} ${res.revoked_sessions}`);
        },
    });

    const mismatch = repeat !== '' && next !== repeat;
    const canSubmit = current !== '' && next.length >= 8 && next === repeat && !change.isPending;
    const list = sessions.data ?? [];
    const others = list.filter((s) => !s.current).length;

    const resend = useMutation({
        mutationFn: () => api.resendEmailVerification(),
        onSuccess: () => {
            setResent(true);
            toast.success(__('Te reenviamos el correo de verificación'));
        },
    });

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-8">
            {/* ── Verificación del email (v0.1.118) ──────────────────── */}
            {user !== null && user.email_verified === false && (
                <section className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-4">
                    <MailWarning className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-warning" />
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-2">
                        <div>
                            <p className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                                {__('Confirmá tu dirección de correo')}
                            </p>
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Te mandamos un enlace a')} <strong>{user.email}</strong>.{' '}
                                {__('Sirve para recuperar tu cuenta y recibir avisos importantes.')}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="imcrm-self-start"
                            disabled={resend.isPending || resent}
                            onClick={() => resend.mutate()}
                        >
                            {resent ? (
                                <>
                                    <MailCheck className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Correo enviado')}
                                </>
                            ) : (
                                __('Reenviar el correo')
                            )}
                        </Button>
                    </div>
                </section>
            )}

            {/* ── Contraseña ─────────────────────────────────────────── */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <div>
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <KeyRound className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Contraseña')}
                    </h2>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Al cambiarla se cierran las sesiones de los otros dispositivos. Esta sesión sigue abierta.')}
                    </p>
                </div>

                <form
                    className="imcrm-flex imcrm-max-w-md imcrm-flex-col imcrm-gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (canSubmit) change.mutate();
                    }}
                >
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="pw-current">{__('Contraseña actual')}</Label>
                        <Input
                            id="pw-current"
                            type="password"
                            autoComplete="current-password"
                            value={current}
                            onChange={(e) => setCurrent(e.target.value)}
                        />
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="pw-new">{__('Contraseña nueva')}</Label>
                        <Input
                            id="pw-new"
                            type="password"
                            autoComplete="new-password"
                            value={next}
                            onChange={(e) => setNext(e.target.value)}
                        />
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Mínimo 8 caracteres.')}
                        </p>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="pw-repeat">{__('Repetir la nueva')}</Label>
                        <Input
                            id="pw-repeat"
                            type="password"
                            autoComplete="new-password"
                            value={repeat}
                            onChange={(e) => setRepeat(e.target.value)}
                            aria-invalid={mismatch}
                        />
                        {mismatch && (
                            <p className="imcrm-text-xs imcrm-text-destructive">
                                {__('Las contraseñas no coinciden.')}
                            </p>
                        )}
                    </div>
                    <Button type="submit" disabled={!canSubmit} className="imcrm-self-start">
                        {change.isPending && <Loader2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                        {__('Cambiar contraseña')}
                    </Button>
                </form>
            </section>

            {/* ── Dispositivos ───────────────────────────────────────── */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div>
                        <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                            <Monitor className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                            {__('Dispositivos conectados')}
                        </h2>
                        <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Dónde está abierta tu cuenta. Si ves algo que no reconocés, cerralo y cambiá la contraseña.')}
                        </p>
                    </div>
                    {others > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={revokeOthers.isPending}
                            onClick={() => revokeOthers.mutate()}
                            className="imcrm-shrink-0"
                        >
                            <LogOut className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Cerrar las demás')}
                        </Button>
                    )}
                </div>

                {sessions.isLoading ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                        {list.map((s) => {
                            const device = describeDevice(s.user_agent);
                            const Icon = device.mobile ? Smartphone : Monitor;
                            return (
                                <li
                                    key={s.id}
                                    className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-3"
                                >
                                    <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                                        <Icon className="imcrm-h-4 imcrm-w-4" />
                                    </span>
                                    <div className="imcrm-min-w-0 imcrm-flex-1">
                                        <p className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                                            {device.label}
                                            {s.current && (
                                                <span className="imcrm-ml-2 imcrm-rounded imcrm-bg-primary/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary">
                                                    {__('este dispositivo')}
                                                </span>
                                            )}
                                            {s.impersonated && (
                                                <span className="imcrm-ml-2 imcrm-rounded imcrm-bg-amber-500/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-amber-600">
                                                    {__('soporte')}
                                                </span>
                                            )}
                                        </p>
                                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {s.ip !== '' ? `${s.ip} · ` : ''}
                                            {__('última actividad')} {formatDateTimeStr(s.last_seen_at)}
                                        </p>
                                    </div>
                                    {!s.current && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={revokeOne.isPending}
                                            onClick={() => revokeOne.mutate(s.id)}
                                        >
                                            {__('Cerrar')}
                                        </Button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
