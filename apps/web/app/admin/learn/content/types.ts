import type { Capability } from '@imagina-base/shared';

/**
 * El manual del centro de aprendizaje (v0.1.322) como DATOS.
 *
 * Un módulo (Vistas, Automatizaciones…) tiene artículos; un artículo es una
 * lista de bloques. Cada módulo vive en dos archivos de `modules/`:
 *   - `<modulo>.meta.ts`   → `export const meta: LearnModuleMeta` (liviano: va
 *     en la carga del centro, alimenta el índice y el buscador);
 *   - `<modulo>.content.ts` → `export const articles: LearnArticle[]` (el texto
 *     completo; se baja al abrir el módulo).
 * Sumar un módulo = sumar sus dos archivos; no hay índice que tocar a mano.
 *
 * El texto va en el «formato sencillo» de la ayuda: `**negrita**`, `*cursiva*`,
 * `- viñetas`, `1. pasos`, `[enlace](/settings?s=miembros)`. Se dibuja sin
 * innerHTML. Español neutro con tuteo; nunca el nombre del producto (se dice
 * «la app»). Los nombres de botones y pantallas, en **negrita** y tal como se
 * ven en la app.
 */

/** Grupo del índice del centro. */
export type LearnGroup = 'start' | 'organize' | 'automate' | 'share' | 'connect' | 'admin';

export const LEARN_GROUPS: ReadonlyArray<{ id: LearnGroup; label: string; blurb: string }> = [
    { id: 'start', label: 'Empezar', blurb: 'Lo esencial para moverte por la app.' },
    { id: 'organize', label: 'Organizar tu información', blurb: 'Listas, campos, vistas y fichas.' },
    { id: 'automate', label: 'Automatizar y la IA', blurb: 'Que el trabajo repetido se haga solo.' },
    { id: 'share', label: 'Clientes y público', blurb: 'Formularios, portal, citas, documentos y tableros.' },
    { id: 'connect', label: 'Conectar otras apps', blurb: 'WhatsApp, correo, tiendas, cobros y más.' },
    { id: 'admin', label: 'Administrar', blurb: 'Equipo, permisos, empresa y seguridad.' },
];

export type Tone = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

export interface LearnArticleMeta {
    /** Único en todo el manual: `modulo-tema` en minúsculas con guiones. */
    id: string;
    title: string;
    /** Una o dos líneas: qué vas a aprender. */
    summary: string;
    /** Minutos de lectura aproximados. */
    minutes: number;
    level?: 'basic' | 'intermediate' | 'advanced';
    /** Palabras extra para el buscador (sin acentos no hace falta: se normaliza). */
    keywords?: string;
    /**
     * Si lo hace sólo quien tiene esta capacidad. El artículo se muestra igual
     * (para que la persona sepa que existe y a quién pedírselo), con un aviso.
     */
    needs?: Capability;
    /** Sólo para el operador de la plataforma (superadmin): oculto al resto. */
    operatorOnly?: boolean;
}

export interface LearnModuleMeta {
    id: string;
    group: LearnGroup;
    order: number;
    title: string;
    /** Frase corta bajo el título (qué resuelve). */
    tagline: string;
    /** Nombre de un ícono de lucide (`ListChecks`, `Workflow`…). */
    icon: string;
    tone: Tone;
    /** Clave de una ilustración de `illustrations/items/` para la portada. */
    hero: string;
    /** Lo que puedes hacer con este módulo, en viñetas cortas (portada). */
    highlights: string[];
    articles: LearnArticleMeta[];
    operatorOnly?: boolean;
}

/** Un ajuste explicado en una tabla «Ajuste · Qué hace · Cuándo usarlo». */
export interface LearnSettingRow {
    name: string;
    what: string;
    tip?: string;
}

export type LearnBlock =
    /** Párrafos en formato sencillo. */
    | { t: 'p'; md: string }
    /** Título de sección (aparece en «En esta página»). */
    | { t: 'h'; text: string }
    /** Pasos numerados (cada uno en formato sencillo). */
    | { t: 'steps'; items: string[] }
    /** Tabla de ajustes. */
    | { t: 'settings'; title?: string; rows: LearnSettingRow[] }
    /** Recuadro: consejo, ojo, o nota. */
    | { t: 'callout'; tone: 'tip' | 'warn' | 'info'; title?: string; md: string }
    /** Caso real («Ejemplo: …»). */
    | { t: 'example'; title: string; md: string }
    /** Ilustración animada. */
    | { t: 'anim'; key: string; caption?: string }
    /** Captura real paso a paso (si la instalación no la tiene, se usa `fallback`). */
    | { t: 'demo'; key: string; caption?: string; fallback?: string }
    /** Grilla de tarjetas (funciones, opciones, tipos). `icon` = nombre de lucide. */
    | { t: 'cards'; items: Array<{ icon?: string; title: string; md: string; tone?: Tone }> }
    /** Preguntas frecuentes. */
    | { t: 'faq'; items: Array<{ q: string; a: string }> }
    /** Botones: ir a una pantalla de la app, abrir otro artículo o un recorrido. */
    | { t: 'actions'; items: Array<{ label: string; to?: string; article?: string; tour?: string }> }
    /** Atajos de teclado. */
    | { t: 'keys'; items: Array<{ keys: string[]; what: string }> };

export interface LearnArticle {
    id: string;
    /** Bloques del artículo, en orden. */
    blocks: LearnBlock[];
    /** Artículos relacionados (ids, de cualquier módulo). */
    related?: string[];
    /** Pantalla de la app donde se hace (`/lists`, `/settings?s=miembros`…). */
    route?: string;
}

/** Normaliza para buscar: minúsculas y sin acentos. */
export function fold(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}
