import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MailCheck, MailWarning, X } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';

const DISMISS_KEY = 'imcrm:verify-banner-dismissed';

function readDismissed(userId: number): boolean {
    try {
        return sessionStorage.getItem(DISMISS_KEY) === String(userId);
    } catch {
        return false;
    }
}

/**
 * v0.1.238 — Aviso de "confirmá tu correo" en TODA la app. Desde v0.1.118 la
 * cuenta sin verificar sólo se avisaba en Ajustes → Cuenta → Seguridad, así que
 * después de registrarse nadie se enteraba de que tenía un enlace esperando en
 * su bandeja. No bloquea el uso (decisión de producto de v0.1.118): explica
 * qué hacer, deja reenviar el correo —y si el servidor no puede mandarlo, lo
 * dice en vez de callar— y se puede cerrar hasta la próxima sesión del
 * navegador.
 */
export function EmailVerifyBanner(): JSX.Element | null {
    const user = useSession((s) => s.user);
    const impersonating = useSession((s) => s.impersonating);
    const toast = useToast();
    const [dismissed, setDismissed] = useState(() => (user ? readDismissed(user.id) : false));
    const [resent, setResent] = useState(false);

    const resend = useMutation({
        mutationFn: () => api.resendEmailVerification(),
        onSuccess: () => {
            setResent(true);
            toast.success(__('Te reenviamos el correo de verificación'), __('Revisá también la carpeta de spam.'));
        },
        onError: (err) => toast.error(__('No se pudo reenviar'), err instanceof Error ? err.message : undefined),
    });

    if (user === null || user.email_verified !== false || impersonating || dismissed) return null;

    const dismiss = (): void => {
        try {
            sessionStorage.setItem(DISMISS_KEY, String(user.id));
        } catch {
            /* sin storage: se cierra sólo en esta vista */
        }
        setDismissed(true);
    };

    return (
        <div
            role="status"
            data-testid="email-verify-banner"
            className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-border-b imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm sm:imcrm-items-center sm:imcrm-px-4"
        >
            <MailWarning className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning sm:imcrm-mt-0" aria-hidden />
            <p className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-foreground">
                <span className="imcrm-font-medium">{__('Confirmá tu correo.')}</span>{' '}
                <span className="imcrm-text-muted-foreground">
                    {__('Te mandamos un enlace a')} <strong className="imcrm-break-all imcrm-text-foreground">{user.email}</strong>
                    {__(': abrilo para verificar tu cuenta. Si no lo ves, revisá spam.')}
                </span>
            </p>
            <button
                type="button"
                data-testid="email-verify-resend"
                onClick={() => resend.mutate()}
                disabled={resend.isPending || resent}
                className="imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors hover:imcrm-bg-accent disabled:imcrm-opacity-60"
            >
                {resent ? (
                    <>
                        <MailCheck className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Enviado')}
                    </>
                ) : resend.isPending ? (
                    __('Enviando…')
                ) : (
                    __('Reenviar')
                )}
            </button>
            <button
                type="button"
                onClick={dismiss}
                aria-label={__('Cerrar aviso')}
                className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
            >
                <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
            </button>
        </div>
    );
}
