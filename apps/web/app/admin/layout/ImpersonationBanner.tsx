import { useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';

/**
 * Banner persistente de impersonación (ADR-S15 F5). Cuando la sesión activa es
 * de impersonación (el operador entró como este usuario para soporte), muestra
 * una barra visible con la opción de salir y volver a la sesión del operador.
 */
export function ImpersonationBanner(): JSX.Element | null {
    const impersonating = useSession((s) => s.impersonating);
    const [leaving, setLeaving] = useState(false);

    if (!impersonating) return null;

    const stop = async (): Promise<void> => {
        setLeaving(true);
        try {
            await api.post('/auth/stop-impersonating', {});
        } catch {
            /* aunque falle, recargamos: la cookie pudo haber cambiado */
        }
        window.location.reload();
    };

    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-bg-amber-500 imcrm-px-4 imcrm-py-2 imcrm-text-sm imcrm-font-medium imcrm-text-amber-950">
            <ShieldAlert className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
            <span>
                {__('Modo soporte: estás viendo la app impersonando a este usuario')}
                {impersonating.operator_name ? ` · ${__('operador')}: ${impersonating.operator_name}` : ''}
            </span>
            <button
                type="button"
                onClick={() => void stop()}
                disabled={leaving}
                className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-amber-950/15 imcrm-px-2.5 imcrm-py-1 imcrm-font-semibold imcrm-transition-colors hover:imcrm-bg-amber-950/25 disabled:imcrm-opacity-60"
            >
                {leaving && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                {__('Salir de impersonación')}
            </button>
        </div>
    );
}
