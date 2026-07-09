import { useState } from 'react';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CloudApiError } from '@/lib/cloud/client';

/**
 * Devuelve el token de reset si la URL es `/reset?token=…` (el enlace que llega
 * por email). Se evalúa en el entry para montar esta pantalla antes del gate de
 * sesión — el usuario que resetea no está logueado.
 */
export function getResetToken(): string | null {
    try {
        const path = window.location.pathname.replace(/\/+$/, '');
        if (!path.endsWith('/reset')) return null;
        const token = new URLSearchParams(window.location.search).get('token');
        return token && token.length >= 16 ? token : null;
    } catch {
        return null;
    }
}

/** Pantalla de "elegí tu nueva contraseña" tras el enlace de recuperación. */
export function ResetPasswordPage({ token }: { token: string }): JSX.Element {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    async function submit(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        setError(null);
        if (password.length < 8) {
            setError('La contraseña debe tener al menos 8 caracteres.');
            return;
        }
        if (password !== confirm) {
            setError('Las contraseñas no coinciden.');
            return;
        }
        setBusy(true);
        try {
            await api.resetPassword(token, password);
            setDone(true);
        } catch (err) {
            setError(err instanceof CloudApiError ? err.message : 'Error inesperado');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-muted/30 imcrm-p-4">
            <form
                onSubmit={submit}
                className="imcrm-w-full imcrm-max-w-sm imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-sm"
            >
                <div className="imcrm-space-y-1">
                    <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                        Nueva contraseña
                    </h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        Elegí una contraseña para tu cuenta de Imagina Base.
                    </p>
                </div>

                {done ? (
                    <>
                        <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                            Tu contraseña se actualizó. Ya podés entrar con la nueva.
                        </p>
                        <Button className="imcrm-w-full" onClick={() => window.location.assign('/')}>
                            Ir a entrar
                        </Button>
                    </>
                ) : (
                    <>
                        <div className="imcrm-space-y-1.5">
                            <Label htmlFor="new-password">Nueva contraseña</Label>
                            <Input
                                id="new-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        <div className="imcrm-space-y-1.5">
                            <Label htmlFor="confirm-password">Repetir contraseña</Label>
                            <Input
                                id="confirm-password"
                                type="password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                required
                            />
                        </div>
                        {error && (
                            <p className="imcrm-text-sm imcrm-text-destructive" role="alert">
                                {error}
                            </p>
                        )}
                        <Button type="submit" className="imcrm-w-full" disabled={busy}>
                            {busy ? '…' : 'Guardar contraseña'}
                        </Button>
                    </>
                )}
            </form>
        </div>
    );
}
