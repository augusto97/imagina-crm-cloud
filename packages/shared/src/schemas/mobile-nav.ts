import { z } from 'zod';

/**
 * v0.1.347 — La barra de abajo del celular (y de la app instalada),
 * personalizable. Cada persona elige CUÁNTOS botones lleva y CUÁLES; «Más»
 * va siempre al final y no se elige: desde ahí se llega a todo lo demás, así
 * que nadie puede quedarse sin salida (ni sin cerrar sesión).
 *
 * Se guarda en la cuenta de la persona, por empresa
 * (`memberships.settings.mobile_nav`): la ve igual en el teléfono y en la app
 * instalada, y en cada empresa puede tener otra (sus listas y sus tableros
 * son distintos). El admin puede dejar una barra predeterminada para el
 * equipo (`tenants.settings.mobile_nav`), que vale para quien no eligió la
 * suya. Sin nada guardado, la de siempre.
 *
 * Un botón es una SECCIÓN de la app (Listas, Tableros…), una ACCIÓN (Buscar,
 * Escanear, el asistente) o un lugar puntual: una lista o un tablero, por su
 * ID (regla de oro nº 1: el nombre o el slug pueden cambiar, el ID no).
 */
export const MOBILE_NAV_SECTIONS = [
    'lists',
    'mywork',
    'search',
    'inbox',
    'favorites',
    'dashboards',
    'scan',
    'assistant',
    'agents',
    'learn',
    'ideas',
    'whatsnew',
    'settings',
    'platform',
] as const;
export type MobileNavSection = (typeof MOBILE_NAV_SECTIONS)[number];

/** Botones que se eligen (sin contar «Más», que va siempre). */
export const MOBILE_NAV_MIN_ITEMS = 2;
export const MOBILE_NAV_MAX_ITEMS = 5;

/** La barra de siempre: Listas · Mi trabajo · Buscar · Avisos (+ Más). */
export const MOBILE_NAV_DEFAULT_ITEMS: readonly string[] = ['lists', 'mywork', 'search', 'inbox'];

export type MobileNavItemRef =
    | { kind: 'section'; section: MobileNavSection }
    | { kind: 'list'; id: number }
    | { kind: 'dashboard'; id: number };

const SECTION_SET = new Set<string>(MOBILE_NAV_SECTIONS);
const ENTITY_RE = /^(list|dashboard):([1-9]\d{0,15})$/;

/** Lee un botón guardado (`'dashboards'`, `'list:12'`, `'dashboard:3'`); null si no es válido. */
export function parseMobileNavItem(raw: unknown): MobileNavItemRef | null {
    if (typeof raw !== 'string') return null;
    if (SECTION_SET.has(raw)) return { kind: 'section', section: raw as MobileNavSection };
    const m = ENTITY_RE.exec(raw);
    if (!m) return null;
    const id = Number(m[2]);
    if (!Number.isSafeInteger(id)) return null;
    return m[1] === 'list' ? { kind: 'list', id } : { kind: 'dashboard', id };
}

export function mobileNavItemKey(ref: MobileNavItemRef): string {
    return ref.kind === 'section' ? ref.section : `${ref.kind}:${ref.id}`;
}

export const mobileNavItemSchema = z
    .string()
    .max(40)
    .refine((v) => parseMobileNavItem(v) !== null, { message: 'Botón desconocido' });

export const mobileNavConfigSchema = z.object({
    items: z
        .array(mobileNavItemSchema)
        .min(MOBILE_NAV_MIN_ITEMS)
        .max(MOBILE_NAV_MAX_ITEMS)
        .refine((items) => new Set(items).size === items.length, { message: 'Un botón está repetido' }),
    /** Los nombres debajo de los íconos (con 6 botones se pueden esconder). */
    labels: z.boolean().default(true),
});
export type MobileNavConfig = z.infer<typeof mobileNavConfigSchema>;

/**
 * Lo que devuelve `GET /me/mobile-nav`: la barra de la persona (null = no
 * eligió) y la del equipo (null = el admin no dejó ninguna).
 */
export const mobileNavStateSchema = z.object({
    own: mobileNavConfigSchema.nullable(),
    team: mobileNavConfigSchema.nullable(),
});
export type MobileNavState = z.infer<typeof mobileNavStateSchema>;

/** Lectura tolerante de lo guardado: un valor raro cuenta como «nada elegido». */
export function readMobileNavConfig(raw: unknown): MobileNavConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const parsed = mobileNavConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

export type MobileNavSource = 'own' | 'team' | 'default';

/** La barra que vale: la propia; si no, la del equipo; si no, la de siempre. */
export function effectiveMobileNav(state: Partial<MobileNavState> | null | undefined): { config: MobileNavConfig; source: MobileNavSource } {
    if (state?.own) return { config: state.own, source: 'own' };
    if (state?.team) return { config: state.team, source: 'team' };
    return { config: { items: [...MOBILE_NAV_DEFAULT_ITEMS], labels: true }, source: 'default' };
}
