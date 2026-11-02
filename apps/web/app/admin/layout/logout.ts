import { forgetPushOnLogout } from '@/lib/pwa/push';

/**
 * Cerrar sesión (o salir de la impersonación) y volver al inicio. Lo usan el
 * menú de la cuenta del escritorio y la página «Más» del celular (v0.1.342).
 * Al impersonar, el servidor devuelve al operador a su propia sesión.
 */
export async function logoutAndReload(impersonating: boolean): Promise<void> {
    const { api, useSession: store } = await import('@/cloud/session');
    // H1 — quien entre después en este equipo no hereda los avisos push
    // (el servidor ya borra los dispositivos de la sesión al cerrarla).
    if (!impersonating) await forgetPushOnLogout().catch(() => undefined);
    try {
        await api.logout();
    } catch {
        // igual limpiamos la sesión local y recargamos
    }
    store.getState().clear();
    window.location.assign('/');
}
