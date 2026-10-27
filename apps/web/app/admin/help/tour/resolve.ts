import type { ResolvedStep, TourContext, TourDef } from './tourTypes';

/** `{app}` → el nombre de la app (white-label) o «la app». */
export function fillAppName(text: string, appName: string): string {
    return text.replace(/\{app\}/g, appName);
}

/**
 * En una pantalla táctil no se «hace clic»: se toca. Los textos se escriben
 * para escritorio y aquí se adaptan solos («Haz clic en X» → «Toca X»).
 */
export function touchWording(text: string): string {
    return text
        .replace(/\bHaz clic en /g, 'Toca ')
        .replace(/\bhaz clic en /g, 'toca ')
        .replace(/\bHaz clic para /g, 'Toca para ')
        .replace(/\bhaz clic para /g, 'toca para ');
}

/**
 * Los pasos de un recorrido que aplican a esta persona en esta pantalla:
 * fuera los que no le corresponden por permisos o por dispositivo, y en el
 * celular la versión móvil de cada uno (o ninguna, si no tiene sentido ahí).
 */
export function resolveSteps(def: TourDef, ctx: TourContext): ResolvedStep[] {
    const out: ResolvedStep[] = [];
    for (const step of def.steps) {
        if (step.when && !step.when(ctx)) continue;
        const device = step.device ?? 'all';
        if (device === 'desktop' && ctx.isMobile) continue;
        if (device === 'mobile' && !ctx.isMobile) continue;
        let target: string | null = step.target ?? null;
        let title = step.title;
        let body = step.body;
        let placement = step.placement;
        if (ctx.isMobile && step.mobile !== undefined) {
            if (step.mobile === 'skip') continue;
            if (step.mobile.target !== undefined) target = step.mobile.target;
            if (step.mobile.title !== undefined) title = step.mobile.title;
            if (step.mobile.body !== undefined) body = step.mobile.body;
            if (step.mobile.placement !== undefined) placement = step.mobile.placement;
        }
        let route: string | null = null;
        if (typeof step.route === 'function') {
            route = step.route(ctx);
            if (route === null) continue;
        } else if (typeof step.route === 'string') {
            route = step.route;
        }
        out.push({
            id: step.id,
            target,
            route,
            title: fillAppName(title, ctx.appName),
            body: fillAppName(ctx.isMobile ? touchWording(body) : body, ctx.appName),
            placement,
            advanceOn: target === null ? 'next' : (step.advanceOn ?? 'next'),
            waitMs: step.waitMs ?? (route !== null ? 7000 : 3500),
        });
    }
    return out;
}

/**
 * ¿La ubicación actual ya es la del paso? Misma ruta y, si el paso pide
 * parámetros (`?s=miembros`), que estén con ese valor. Otros parámetros de
 * la ubicación (`?view=3`) no obligan a navegar.
 */
export function routeMatches(route: string, pathname: string, search: string): boolean {
    const [rPath = '', rQuery = ''] = route.split('?');
    if (rPath.replace(/\/+$/, '') !== pathname.replace(/\/+$/, '')) return false;
    if (!rQuery) return true;
    const current = new URLSearchParams(search);
    const wanted = new URLSearchParams(rQuery);
    for (const [k, v] of wanted) if (current.get(k) !== v) return false;
    return true;
}
