import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

/**
 * v0.1.118 — Pantalla del link "Confirmá tu email" del alta.
 *
 * Vive fuera del router de la app (igual que el reset de contraseña): el link
 * llega por correo a `/verify?token=…` y se resuelve antes de montar el shell,
 * así funciona con o sin sesión abierta.
 */
export function getVerifyToken(): string | null {
    try {
        const path = window.location.pathname.replace(/\/+$/, '');
        if (!path.endsWith('/verify')) return null;
        const token = new URLSearchParams(window.location.search).get('token');
        return token && token.length >= 16 ? token : null;
    } catch {
        return null;
    }
}

export function VerifyEmailPage({ token }: { token: string }): JSX.Element {
    const [state, setState] = useState<'working' | 'done' | 'error'>('working');
    const [message, setMessage] = useState('');
    // El token es de UN SOLO USO (GETDEL en el backend): si el efecto corriera
    // dos veces con el mismo token —StrictMode en desarrollo, un remount— el
    // segundo canje encontraría el token ya consumido y mostraría "inválido"
    // sobre una verificación que en realidad salió bien.
    const claimed = useRef('');

    useEffect(() => {
        if (claimed.current === token) return;
        claimed.current = token;
        // Sin bandera de cancelación a propósito: el canje ya ocurrió del lado
        // del servidor, así que el resultado SIEMPRE se pinta (en React 18
        // actualizar un componente desmontado es un no-op silencioso).
        api.verifyEmail(token)
            .then(() => setState('done'))
            .catch((err: unknown) => {
                setMessage(err instanceof Error ? err.message : '');
                setState('error');
            });
    }, [token]);

    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-p-6">
            <div className="imcrm-flex imcrm-w-full imcrm-max-w-sm imcrm-flex-col imcrm-items-center imcrm-gap-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-8 imcrm-text-center imcrm-shadow-imcrm-md">
                {state === 'working' && (
                    <>
                        <Loader2 className="imcrm-h-8 imcrm-w-8 imcrm-animate-spin imcrm-text-muted-foreground" />
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Confirmando tu email…')}
                        </p>
                    </>
                )}
                {state === 'done' && (
                    <>
                        <CheckCircle2 className="imcrm-h-10 imcrm-w-10 imcrm-text-success" />
                        <h1 className="imcrm-text-lg imcrm-font-semibold">{__('¡Email confirmado!')}</h1>
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Ya podés usar tu cuenta con normalidad.')}
                        </p>
                        <Button onClick={() => window.location.assign('/')}>{__('Ir a la app')}</Button>
                    </>
                )}
                {state === 'error' && (
                    <>
                        <XCircle className="imcrm-h-10 imcrm-w-10 imcrm-text-destructive" />
                        <h1 className="imcrm-text-lg imcrm-font-semibold">
                            {__('No pudimos confirmar el email')}
                        </h1>
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {message !== ''
                                ? message
                                : __('El enlace es inválido o expiró. Pedí uno nuevo desde Ajustes → Seguridad.')}
                        </p>
                        <Button variant="outline" onClick={() => window.location.assign('/')}>
                            {__('Ir a la app')}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
