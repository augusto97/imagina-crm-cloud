import {
    BarChart3,
    Bell,
    Bot,
    GraduationCap,
    Lightbulb,
    List as ListIcon,
    ListChecks,
    Megaphone,
    Menu,
    Pin,
    ScanLine,
    Search,
    Settings,
    ShieldAlert,
    Sparkles,
} from 'lucide-react';
import {
    MOBILE_NAV_DEFAULT_ITEMS,
    MOBILE_NAV_MAX_ITEMS,
    MOBILE_NAV_MIN_ITEMS,
    parseMobileNavItem,
    type MobileNavConfig,
    type MobileNavSection,
} from '@imagina-base/shared';
import type { ComponentType, SVGProps } from 'react';

/**
 * La barra de pestañas de abajo del celular (y de la app instalada).
 *
 * v0.1.342 la armó con cinco pestañas fijas (Listas · Mi trabajo · Buscar ·
 * Avisos · Más). v0.1.347 la hace PERSONALIZABLE: cada persona elige cuántos
 * botones lleva y cuáles (ver `mobile-nav.ts` en shared). «Más» va siempre al
 * final: desde ahí se llega a todo lo que no está en la barra.
 *
 * Todo lo de aquí es puro (sin React ni red), así se testea: el catálogo de
 * botones, cómo se resuelve lo guardado contra lo que la persona puede usar y
 * qué pestaña queda marcada en cada pantalla.
 */

/** Un ícono de lucide (trazo) o del catálogo de listas (sólido): los dos sirven. */
export type TabIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** Las acciones abren algo (la búsqueda, la cámara, el asistente); no son una ruta. */
export type MobileTabAction = 'search' | 'scan' | 'assistant';

export interface MobileSectionDef {
    section: MobileNavSection;
    label: string;
    /** Para qué sirve (el renglón del editor). */
    hint: string;
    icon: TabIconComponent;
    /** Ancla de los recorridos (`data-tour`). */
    dataTour: string;
    to?: string;
    action?: MobileTabAction;
    /** Rutas que dejan marcada esta pestaña. */
    prefixes?: string[];
    group: 'go' | 'action';
}

/** El catálogo, en el orden en que se ofrecen. */
export const MOBILE_SECTIONS: readonly MobileSectionDef[] = [
    { section: 'lists', label: 'Listas', hint: 'Tus listas y carpetas', icon: ListIcon, dataTour: 'tabbar-lists', to: '/lists', prefixes: ['/lists', '/folders'], group: 'go' },
    { section: 'mywork', label: 'Mi trabajo', hint: 'Lo que tienes asignado, por fecha', icon: ListChecks, dataTour: 'tabbar-mywork', to: '/my-work', prefixes: ['/my-work', '/approvals'], group: 'go' },
    { section: 'inbox', label: 'Avisos', hint: 'Menciones, asignaciones y aprobaciones', icon: Bell, dataTour: 'tabbar-inbox', to: '/avisos', prefixes: ['/avisos'], group: 'go' },
    { section: 'dashboards', label: 'Tableros', hint: 'Cifras y gráficos de tus listas', icon: BarChart3, dataTour: 'tabbar-dashboards', to: '/dashboards', prefixes: ['/dashboards'], group: 'go' },
    { section: 'favorites', label: 'Favoritos', hint: 'Lo que anclaste para tenerlo a mano', icon: Pin, dataTour: 'tabbar-favorites', to: '/favorites', prefixes: ['/favorites'], group: 'go' },
    { section: 'agents', label: 'Agentes', hint: 'Compañeros de IA que trabajan solos', icon: Bot, dataTour: 'tabbar-agents', to: '/agents', prefixes: ['/agents'], group: 'go' },
    { section: 'learn', label: 'Aprende', hint: 'El manual de cada parte de la app', icon: GraduationCap, dataTour: 'tabbar-learn', to: '/aprende', prefixes: ['/aprende'], group: 'go' },
    { section: 'ideas', label: 'Ideas', hint: 'Automatizaciones listas para activar', icon: Lightbulb, dataTour: 'tabbar-ideas', to: '/ideas', prefixes: ['/ideas'], group: 'go' },
    { section: 'whatsnew', label: 'Novedades', hint: 'Lo nuevo de cada versión', icon: Megaphone, dataTour: 'tabbar-whatsnew', to: '/novedades', prefixes: ['/novedades'], group: 'go' },
    { section: 'settings', label: 'Ajustes', hint: 'Tu cuenta y la empresa', icon: Settings, dataTour: 'tabbar-settings', to: '/settings', prefixes: ['/settings'], group: 'go' },
    { section: 'platform', label: 'Plataforma', hint: 'Consola del operador', icon: ShieldAlert, dataTour: 'tabbar-platform', to: '/platform', prefixes: ['/platform'], group: 'go' },
    { section: 'search', label: 'Buscar', hint: 'Registros, listas y guías por su nombre', icon: Search, dataTour: 'tabbar-search', action: 'search', group: 'action' },
    { section: 'scan', label: 'Escanear', hint: 'Lee un código QR o de barras con la cámara', icon: ScanLine, dataTour: 'tabbar-scan', action: 'scan', group: 'action' },
    { section: 'assistant', label: 'Asistente', hint: 'Pídele algo a la IA con tus palabras', icon: Sparkles, dataTour: 'tabbar-assistant', action: 'assistant', group: 'action' },
];

const BY_SECTION = new Map(MOBILE_SECTIONS.map((d) => [d.section, d]));

export function mobileSectionDef(section: MobileNavSection): MobileSectionDef {
    return BY_SECTION.get(section)!;
}

/** «Más»: siempre al final, no se elige. */
export const MORE_TAB = { key: 'more', label: 'Más', icon: Menu as TabIconComponent, dataTour: 'tabbar-more', to: '/menu' } as const;

/** Una lista o un tablero que la persona puede ver (lo arma el hook con los datos). */
export interface MobileNavEntity {
    name: string;
    /** Ruta de la lista (`/lists/<slug>/records`) o del tablero (`/dashboards/<id>`). */
    to: string;
    /** Prefijo que la deja marcada. */
    prefix: string;
    icon: TabIconComponent;
}

export interface MobileNavContext {
    /** Secciones que esta persona puede usar (las demás se saltean). */
    available: (section: MobileNavSection) => boolean;
    /** Listas que ve, por ID. `undefined` = todavía cargando. */
    lists?: ReadonlyMap<number, MobileNavEntity>;
    /** Tableros que ve, por ID. `undefined` = todavía cargando. */
    dashboards?: ReadonlyMap<number, MobileNavEntity>;
}

export interface MobileTab {
    /** Lo guardado (`'dashboards'`, `'list:12'`). */
    key: string;
    label: string;
    icon: TabIconComponent;
    dataTour: string;
    to?: string;
    action?: MobileTabAction;
    prefixes: string[];
    /** Para el badge: ¿es la de Avisos o la de Novedades? */
    section?: MobileNavSection;
    /** Una lista o un tablero que todavía se está cargando. */
    pending?: boolean;
}

function sectionTab(def: MobileSectionDef): MobileTab {
    return {
        key: def.section,
        label: def.label,
        icon: def.icon,
        dataTour: def.dataTour,
        to: def.to,
        action: def.action,
        prefixes: def.prefixes ?? [],
        section: def.section,
    };
}

/**
 * Lo guardado → las pestañas que se dibujan (sin «Más»).
 *  - Lo que la persona ya no puede usar se saltea (perdió el permiso, el plan
 *    no lo incluye, se borró la lista). Avisos apagados ceden su lugar a
 *    Favoritos, como en la barra de siempre.
 *  - Una lista o tablero que todavía carga queda en su lugar (sin saltos).
 *  - Si quedan menos de dos, se completa con la barra de siempre.
 */
export function resolveMobileTabs(config: MobileNavConfig, ctx: MobileNavContext): MobileTab[] {
    const out: MobileTab[] = [];
    const seen = new Set<string>();
    const push = (tab: MobileTab): void => {
        if (seen.has(tab.key) || out.length >= MOBILE_NAV_MAX_ITEMS) return;
        seen.add(tab.key);
        out.push(tab);
    };
    for (const raw of config.items) {
        const ref = parseMobileNavItem(raw);
        if (!ref) continue;
        if (ref.kind === 'section') {
            if (ctx.available(ref.section)) push(sectionTab(mobileSectionDef(ref.section)));
            else if (ref.section === 'inbox' && ctx.available('favorites')) push(sectionTab(mobileSectionDef('favorites')));
            continue;
        }
        const map = ref.kind === 'list' ? ctx.lists : ctx.dashboards;
        const key = `${ref.kind}:${ref.id}`;
        const dataTour = ref.kind === 'list' ? 'tabbar-list' : 'tabbar-dashboard';
        if (ref.kind === 'dashboard' && !ctx.available('dashboards')) continue;
        if (map === undefined) {
            push({ key, label: '', icon: ref.kind === 'list' ? ListIcon : BarChart3, dataTour, prefixes: [], pending: true });
            continue;
        }
        const entity = map.get(ref.id);
        if (!entity) continue;
        push({ key, label: entity.name, icon: entity.icon, dataTour, to: entity.to, prefixes: [entity.prefix] });
    }
    if (out.length < MOBILE_NAV_MIN_ITEMS) {
        for (const raw of [...MOBILE_NAV_DEFAULT_ITEMS, 'favorites']) {
            const ref = parseMobileNavItem(raw);
            if (ref?.kind === 'section' && ctx.available(ref.section)) push(sectionTab(mobileSectionDef(ref.section)));
            if (out.length >= MOBILE_NAV_MIN_ITEMS) break;
        }
    }
    return out;
}

function under(pathname: string, base: string): boolean {
    return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * La pestaña que queda marcada en `pathname`: la de la ruta MÁS específica
 * (una lista puntual le gana a «Listas»). Lo que no es de ninguna —Ajustes,
 * Aprende, un tablero que no está en la barra…— se alcanza desde «Más», así
 * que queda marcada «Más»: la persona siempre sabe de dónde viene.
 */
export function activeMobileTab(pathname: string, tabs: readonly Pick<MobileTab, 'key' | 'prefixes'>[]): string {
    let best: string | null = null;
    let bestLen = -1;
    for (const tab of tabs) {
        for (const prefix of tab.prefixes) {
            if (under(pathname, prefix) && prefix.length > bestLen) {
                best = tab.key;
                bestLen = prefix.length;
            }
        }
        // La raíz de la app abre en Listas.
        if (tab.key === 'lists' && (pathname === '/' || pathname === '') && bestLen < 0) best = 'lists';
    }
    return best ?? MORE_TAB.key;
}

/** ¿La ruta es justo el inicio de la pestaña? (Tocarla otra vez sube al principio.) */
export function isTabRoot(pathname: string, tab: Pick<MobileTab, 'key' | 'to'>): boolean {
    if (tab.key === 'lists' && (pathname === '/' || pathname === '')) return true;
    return tab.to !== undefined && pathname === tab.to;
}

/**
 * «Cantidad de botones» del editor (con «Más»): achicar quita del final;
 * agrandar suma, en orden, lo que la persona puede usar y todavía no está.
 */
export function withItemCount(items: readonly string[], total: number, available: (section: MobileNavSection) => boolean): string[] {
    const want = Math.min(Math.max(total - 1, MOBILE_NAV_MIN_ITEMS), MOBILE_NAV_MAX_ITEMS);
    if (items.length >= want) return items.slice(0, want);
    const next = [...items];
    for (const raw of [...MOBILE_NAV_DEFAULT_ITEMS, 'dashboards', 'favorites', 'scan', ...MOBILE_SECTIONS.map((d) => d.section)]) {
        if (next.length >= want) break;
        const ref = parseMobileNavItem(raw);
        if (ref?.kind === 'section' && available(ref.section) && !next.includes(raw)) next.push(raw);
    }
    return next;
}

/** Mueve un botón una posición (-1 arriba/izquierda, +1 abajo/derecha). */
export function moveItem(items: readonly string[], index: number, delta: -1 | 1): string[] {
    const to = index + delta;
    if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    return next;
}
