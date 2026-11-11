import { lazyDialog } from '@/lib/lazyDialog';

import { useAssistantPanelOpen } from './assistantPanelStore';

// El panel lee su propio estado (abierto/cerrado); `open` sólo decide cuándo bajarlo.
const Panel = lazyDialog(() =>
    import('./AssistantPanel').then((m) => ({ default: (_props: { open: boolean }) => <m.AssistantPanel /> })),
);

/**
 * El panel del asistente se baja la primera vez que se abre (chat, historial,
 * formato de las respuestas y tarjetas de propuestas): quien no lo usa no lo
 * paga al entrar. Una vez abierto queda montado: cerrar no pierde la
 * conversación ni lo escrito.
 */
export function AssistantPanelHost(): JSX.Element {
    const open = useAssistantPanelOpen();
    return <Panel open={open} />;
}

export function preloadAssistantPanel(): void {
    Panel.preload();
}
