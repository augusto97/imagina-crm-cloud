/**
 * La pantalla de arranque.
 *
 * v0.1.327 la armó con el logo de la marca en el centro y una barra fina. El
 * usuario la descartó (v0.1.329): al abrir la app instalada, Android ya
 * muestra el ícono en el centro, y repetirlo con otro tamaño se veía como un
 * salto. Ahora, mientras baja el JavaScript, se ve el CONTORNO de la app —el
 * riel, el panel, la barra superior y unas filas grises que laten— con una
 * línea de carga arriba, como Notion o ClickUp: la app parece abrirse al
 * instante y lo que aparece después ocupa el mismo lugar.
 *
 * El `index.html` la arma con lo que la app recordó en este dispositivo
 * (`SPLASH_KEY`): si la última vez había sesión (el esqueleto sólo tiene
 * sentido si lo que sigue es la app, no el login) y los colores reales del
 * riel y de la línea en cada tema (el riel lleva el color de la marca: un
 * riel gris que de golpe se vuelve verde también sería un salto). La primera
 * vez —o sin sesión— sólo hay fondo liso y la línea.
 *
 * React no la reemplaza: queda ENCIMA hasta que la app tiene algo que mostrar
 * (el login o la app) y recién ahí se desvanece.
 */

export const SPLASH_KEY = 'imcrm:splash';
export const SPLASH_ID = 'imcrm-boot';

export interface SplashColors {
    /** Fondo del riel del menú. */
    rail: string | null;
    /** Color de la línea de carga (el primario de la marca). */
    accent: string | null;
}

export interface SplashMemory {
    /** ¿La última vez se abrió la app con sesión? (si no, el login). */
    shell: boolean;
    light: SplashColors | null;
    dark: SplashColors | null;
}

/** Sólo `rgb()`/`rgba()` numéricos: el script del HTML los pone en un `style`. */
export function safeColor(value: string | null | undefined): string | null {
    if (!value) return null;
    const v = value.trim();
    return /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(v) ? v : null;
}

function safeStorage(): Storage | null {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
}

export function readSplash(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SplashMemory {
    const empty: SplashMemory = { shell: false, light: null, dark: null };
    if (!storage) return empty;
    try {
        const raw = JSON.parse(storage.getItem(SPLASH_KEY) ?? 'null') as Partial<SplashMemory> | null;
        if (!raw || typeof raw !== 'object') return empty;
        const colors = (c: unknown): SplashColors | null =>
            c && typeof c === 'object'
                ? {
                      rail: safeColor((c as SplashColors).rail),
                      accent: safeColor((c as SplashColors).accent),
                  }
                : null;
        return { shell: raw.shell === true, light: colors(raw.light), dark: colors(raw.dark) };
    } catch {
        return empty;
    }
}

function write(memory: SplashMemory, storage: Pick<Storage, 'setItem'> | null): void {
    if (!storage) return;
    try {
        storage.setItem(SPLASH_KEY, JSON.stringify(memory));
    } catch {
        /* storage lleno o bloqueado: la próxima arranca con el fondo liso */
    }
}

/** Recuerda si lo que se mostró fue la app (true) o el login (false). */
export function rememberShell(shell: boolean, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): void {
    const current = readSplash(storage);
    if (current.shell === shell) return;
    write({ ...current, shell }, storage);
}

/** Recuerda los colores del tema que está a la vista. */
export function rememberSplashColors(
    theme: 'light' | 'dark',
    colors: SplashColors,
    storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
): void {
    const current = readSplash(storage);
    const next: SplashColors = { rail: safeColor(colors.rail), accent: safeColor(colors.accent) };
    const prev = current[theme];
    if (prev && prev.rail === next.rail && prev.accent === next.accent) return;
    write({ ...current, [theme]: next }, storage);
}

/**
 * El color real de una variable del tema (`--imcrm-sidebar` → `rgb(…)`): se
 * resuelve con un elemento de prueba, así sale igual a lo que pinta la app
 * con el white-label y el tema aplicados.
 */
export function resolveThemeColor(variable: string, doc: Document = document): string | null {
    const probe = doc.createElement('span');
    probe.style.cssText = `position:absolute;width:0;height:0;visibility:hidden;background-color:hsl(var(${variable}))`;
    doc.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return safeColor(value);
}

/** ¿Sigue la pantalla de arranque a la vista? */
export function bootSplashVisible(doc: Document = document): boolean {
    const el = doc.getElementById(SPLASH_ID);
    return el !== null && el.dataset.leaving !== '1';
}

/** La desvanece y la saca del DOM (idempotente). */
export function hideBootSplash(doc: Document = document): void {
    const el = doc.getElementById(SPLASH_ID);
    if (!el || el.dataset.leaving === '1') return;
    el.dataset.leaving = '1';
    el.setAttribute('aria-busy', 'false');
    const reduce =
        typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    window.setTimeout(() => el.remove(), reduce ? 0 : 260);
}
