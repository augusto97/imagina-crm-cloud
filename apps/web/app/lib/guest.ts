import { useSession } from '@/cloud/session';

/**
 * C3 — ¿La persona entra a ESTA empresa como invitada de afuera? Un invitado
 * ve sólo lo que le compartieron (listas enteras o registros sueltos): la app
 * le arma un shell propio («Compartido conmigo») y oculta todo lo demás. El
 * servidor igual lo frena (fail-closed): esto sólo evita pedir lo que daría 403.
 */
export function useIsGuest(): boolean {
    return useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'guest');
}

/** Igual que `useIsGuest`, fuera de React (helpers de queries). */
export function isGuestNow(): boolean {
    const s = useSession.getState();
    return s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'guest';
}
