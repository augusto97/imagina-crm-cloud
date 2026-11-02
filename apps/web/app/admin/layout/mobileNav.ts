/**
 * v0.1.342 — Barra de navegación inferior del celular (y de la app
 * instalada): qué pestaña corresponde a cada ruta. Pura, para testearla.
 *
 * Las cinco pestañas: **Listas**, **Mi trabajo**, **Buscar** (abre la
 * búsqueda, no es una ruta), **Avisos** y **Más**. Todo lo que no es de las
 * tres primeras rutas —Favoritos, Dashboards, Agentes, Aprende, Ideas,
 * Novedades, Ajustes, Plataforma— se alcanza desde «Más», así que esa
 * pestaña queda marcada mientras se está en cualquiera de ellas: la persona
 * siempre sabe de qué pestaña viene y cómo volver.
 */
export type MobileTabId = 'lists' | 'mywork' | 'search' | 'inbox' | 'more';

/** Raíz de cada pestaña que es una ruta (Buscar no lo es). */
export const MOBILE_TAB_ROOT: Record<Exclude<MobileTabId, 'search'>, string> = {
    lists: '/lists',
    mywork: '/my-work',
    inbox: '/avisos',
    more: '/menu',
};

function under(pathname: string, base: string): boolean {
    return pathname === base || pathname.startsWith(`${base}/`);
}

export function mobileTabFromPath(pathname: string): Exclude<MobileTabId, 'search'> {
    if (under(pathname, '/my-work') || under(pathname, '/approvals')) return 'mywork';
    if (under(pathname, '/avisos')) return 'inbox';
    if (pathname === '/' || pathname === '' || under(pathname, '/lists') || under(pathname, '/folders')) return 'lists';
    return 'more';
}

/** ¿La ruta es justo la raíz de la pestaña? (Tocarla otra vez sube al inicio.) */
export function isTabRoot(pathname: string, tab: Exclude<MobileTabId, 'search'>): boolean {
    return pathname === MOBILE_TAB_ROOT[tab] || (tab === 'lists' && (pathname === '/' || pathname === ''));
}
