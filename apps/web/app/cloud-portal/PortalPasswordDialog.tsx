import { useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, X } from 'lucide-react';

import { portalApi } from '@/cloud-portal/portalClient';
import { CloudApiError } from '@/lib/cloud/client';

/**
 * v0.1.289 — El cliente crea o cambia SU contraseña del portal de esta
 * empresa. No es la contraseña de ninguna otra cuenta: sólo sirve para entrar
 * a este portal (y no se pide la anterior: «olvidé mi contraseña» es entrar
 * con un enlace por correo y crear una nueva desde aquí).
 */
export function PortalPasswordDialog({
    open,
    onOpenChange,
    hasPassword,
    companyName,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    hasPassword: boolean;
    companyName: string;
    onSaved: () => void;
}): JSX.Element {
    const [password, setPassword] = useState('');
    const [repeat, setRepeat] = useState('');
    const [error, setError] = useState<string | null>(null);
    const save = useMutation({
        mutationFn: () => portalApi.portalSetPassword(password),
        onSuccess: () => {
            setPassword('');
            setRepeat('');
            onSaved();
            onOpenChange(false);
        },
        onError: (err) => setError(err instanceof CloudApiError || err instanceof Error ? err.message : 'No se pudo guardar.'),
    });
    const tooShort = password.length > 0 && password.length < 8;
    const mismatch = repeat.length > 0 && repeat !== password;

    return (
        <RDialog.Root
            open={open}
            onOpenChange={(o) => {
                if (!o) {
                    setError(null);
                    setPassword('');
                    setRepeat('');
                }
                onOpenChange(o);
            }}
        >
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <RDialog.Content
                    data-testid="portal-password-dialog"
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[min(26rem,calc(100vw-2rem))] -imcrm-translate-x-1/2 -imcrm-translate-y-1/2 imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-lg"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                            <KeyRound className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <RDialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {hasPassword ? 'Cambiar tu contraseña' : 'Crear una contraseña'}
                            </RDialog.Title>
                            <RDialog.Description className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                                {companyName ? `Para entrar al portal de ${companyName}` : 'Para entrar a este portal'} con tu
                                correo y esta contraseña, sin esperar un enlace. Sólo sirve para este portal.
                            </RDialog.Description>
                        </div>
                        <RDialog.Close
                            className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted"
                            aria-label="Cerrar"
                        >
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </RDialog.Close>
                    </div>
                    <form
                        className="imcrm-space-y-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setError(null);
                            if (password.length < 8 || password !== repeat) return;
                            save.mutate();
                        }}
                    >
                        <label className="imcrm-block imcrm-space-y-1">
                            <span className="imcrm-text-sm imcrm-font-medium">Nueva contraseña</span>
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                data-testid="portal-password-new"
                                className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                            />
                            {tooShort && <span className="imcrm-block imcrm-text-xs imcrm-text-destructive">Mínimo 8 caracteres.</span>}
                        </label>
                        <label className="imcrm-block imcrm-space-y-1">
                            <span className="imcrm-text-sm imcrm-font-medium">Repítela</span>
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={repeat}
                                onChange={(e) => setRepeat(e.target.value)}
                                data-testid="portal-password-repeat"
                                className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                            />
                            {mismatch && <span className="imcrm-block imcrm-text-xs imcrm-text-destructive">No coinciden.</span>}
                        </label>
                        {hasPassword && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                Al cambiarla se cierran tus otras sesiones de este portal (este dispositivo sigue adentro).
                            </p>
                        )}
                        {error && (
                            <p role="alert" className="imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </p>
                        )}
                        <button
                            type="submit"
                            disabled={save.isPending || password.length < 8 || password !== repeat}
                            data-testid="portal-password-save"
                            className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-bg-primary imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground disabled:imcrm-opacity-60"
                        >
                            {save.isPending ? 'Guardando…' : 'Guardar contraseña'}
                        </button>
                    </form>
                </RDialog.Content>
            </RDialog.Portal>
        </RDialog.Root>
    );
}
