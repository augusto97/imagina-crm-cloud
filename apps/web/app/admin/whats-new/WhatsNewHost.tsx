import { useEffect } from 'react';

import { registerHelpHandlers } from '@/admin/help/helpBus';
import { useIsGuest } from '@/lib/guest';

import { FeaturedWhatsNewDialog } from './FeaturedWhatsNewDialog';
import { WhatsNewPanel } from './WhatsNewPanel';
import { whatsNewPanel } from './whatsNewStore';

/**
 * Monta lo de Novedades en el shell de la app: el panel, el diálogo de
 * destacadas y el `openWhatsNew` del contrato de ayuda (así las otras piezas
 * —primeros pasos, guías— pueden abrir una novedad). Un invitado no tiene
 * novedades (sólo la franja de avisos), así que no se registra para él.
 */
export function WhatsNewHost(): JSX.Element | null {
    const isGuest = useIsGuest();
    useEffect(() => {
        if (isGuest) return;
        return registerHelpHandlers({
            openWhatsNew: (opts) => whatsNewPanel.open(opts?.id ?? null),
        });
    }, [isGuest]);
    // Al salir del shell (cerrar sesión, cambiar a otra app), el panel no queda abierto.
    useEffect(() => () => whatsNewPanel.close(), []);
    if (isGuest) return null;
    return (
        <>
            <WhatsNewPanel />
            <FeaturedWhatsNewDialog />
        </>
    );
}
