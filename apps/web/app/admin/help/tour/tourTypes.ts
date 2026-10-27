import type { Capability } from '@imagina-base/shared';

import type { Placement } from './geometry';

/**
 * Fase 7 — lo que un recorrido necesita saber de quien mira para decidir qué
 * pasos le aplican. Se arma en `HelpCenter` con los mismos datos que usa el
 * resto de la app (capacidades del boot, rol de la empresa, listas visibles).
 */
export interface TourContext {
    /** ¿Tiene esta capacidad? (`imcrm_*`, como `useCan`). */
    can: (cap: Capability) => boolean;
    /** Rol BASE en la empresa. */
    role: string | null;
    /** Administrador de la empresa (rol admin). */
    isAdmin: boolean;
    /** Superadmin de la plataforma. */
    isSuperadmin: boolean;
    /** Pantalla angosta (riel y paneles en el cajón del menú). */
    isMobile: boolean;
    /** Una lista que la persona puede ver (la primera del menú), si hay. */
    firstList: { slug: string; name: string } | null;
    /** Cuántas listas ve. */
    listCount: number;
    /** «la app» o el nombre de la marca (white-label). */
    appName: string;
    /** El navegador ofrece instalar la app (o es un iPhone que puede). */
    canInstall: boolean;
}

export type TourDevice = 'all' | 'desktop' | 'mobile';

export interface TourStep {
    /** Para los tests y para seguir el recorrido en el E2E. */
    id: string;
    /** `data-tour` del elemento señalado. Sin target, el globo va centrado. */
    target?: string;
    /** Ruta a la que se navega antes de mostrar el paso. `null` = el paso no aplica. */
    route?: string | ((ctx: TourContext) => string | null);
    title: string;
    /** Texto corto; `**negrita**` para los nombres de botones. `{app}` = nombre de la app. */
    body: string;
    placement?: Placement;
    /**
     * `next` (por defecto): avanza con «Siguiente». `click`: avanza cuando la
     * persona hace clic en el elemento (el globo ofrece hacerlo por ella).
     */
    advanceOn?: 'next' | 'click';
    /** El paso sólo aplica si esto da true (capacidad, rol…). */
    when?: (ctx: TourContext) => boolean;
    /** En qué pantallas aplica. */
    device?: TourDevice;
    /**
     * En el celular, otra forma del paso (el riel y los paneles viven en el
     * cajón del menú): otro elemento, otro texto, o `skip`.
     */
    mobile?: { target?: string | null; title?: string; body?: string; placement?: Placement } | 'skip';
    /** Cuánto esperar a que aparezca el elemento antes de saltar el paso. */
    waitMs?: number;
}

export interface TourDef {
    id: string;
    title: string;
    /** Una línea: qué muestra el recorrido. */
    description: string;
    /** Si el recorrido existe para esta persona (rol, permisos, datos). */
    available: (ctx: TourContext) => boolean;
    steps: TourStep[];
}

/** Un paso ya resuelto para esta persona y esta pantalla. */
export interface ResolvedStep {
    id: string;
    target: string | null;
    route: string | null;
    title: string;
    body: string;
    placement?: Placement;
    advanceOn: 'next' | 'click';
    waitMs: number;
}
