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

/**
 * Cómo avanza un paso (v0.1.324):
 *  - `next` (por defecto): con «Siguiente».
 *  - `click`: cuando la persona hace clic en lo resaltado.
 *  - `appear`: cuando aparece el elemento `waitFor` (un diálogo que se abrió,
 *    la ficha…), lo haya abierto con el clic, el teclado o «Hacerlo por mí».
 *  - `input`: el elemento es un campo de texto; se invita a escribir y el
 *    globo celebra cuando lo hace (avanza con «Siguiente»).
 */
export type TourAdvance = 'next' | 'click' | 'appear' | 'input';

/** Para agrupar los recorridos en la galería. */
export type TourCategory = 'start' | 'daily' | 'build' | 'team';

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
    /** Ver `TourAdvance`. */
    advanceOn?: TourAdvance;
    /** Con `appear`: el `data-tour` cuyo aparecer avanza el paso. */
    waitFor?: string;
    /** Ilustración animada del centro de aprendizaje que acompaña al paso. */
    art?: string;
    /** Un consejo corto debajo del texto. */
    tip?: string;
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
    /** Ilustración de la portada (clave del registro de ilustraciones). */
    cover: string;
    /** Minutos aproximados. */
    minutes: number;
    category: TourCategory;
    /** «Vas a ver»: si falta, los títulos de los pasos. */
    outcomes?: string[];
    /** Artículo del centro de aprendizaje para seguir leyendo (`modulo/articulo`). */
    learn?: string;
    /** Recorridos que conviene hacer después. */
    next?: string[];
}

/** Un paso ya resuelto para esta persona y esta pantalla. */
export interface ResolvedStep {
    /** `intro`/`outro`: la portada y el cierre que arma el motor. */
    kind: 'intro' | 'step' | 'outro';
    id: string;
    target: string | null;
    route: string | null;
    title: string;
    body: string;
    placement?: Placement;
    advanceOn: TourAdvance;
    waitFor: string | null;
    art: string | null;
    tip: string | null;
    waitMs: number;
}

/** Lo que la portada y el cierre muestran del recorrido. */
export interface TourMeta {
    description: string;
    cover: string;
    minutes: number;
    outcomes: string[];
    learn: string | null;
    next: string[];
}
