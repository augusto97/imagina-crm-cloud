/**
 * v0.1.411 — Carpetas de automatizaciones (puro, sin zod: lo usan el servidor y
 * el índice de la lista).
 *
 * Una carpeta es un NOMBRE: la automatización guarda el nombre de su carpeta y
 * la lista guarda el orden (y las carpetas todavía vacías) en
 * `settings.automation_folders`. Dos nombres que sólo cambian en mayúsculas,
 * tildes o espacios son la MISMA carpeta.
 */

/** Clave para comparar nombres: sin mayúsculas, tildes ni espacios de más. */
export function folderKey(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

/** El nombre limpio que se guarda (espacios de más fuera). */
export function cleanFolderName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').slice(0, 60);
}

/** La carpeta existente que coincide con `name` (con su escritura), o null. */
export function matchFolder(existing: readonly string[], name: string): string | null {
    const k = folderKey(name);
    return existing.find((f) => folderKey(f) === k) ?? null;
}

/** Lee el arreglo guardado en la lista, con tolerancia (lo raro se descarta). */
export function readSavedFolders(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const v of raw) {
        if (typeof v !== 'string') continue;
        const name = cleanFolderName(v);
        if (name && !matchFolder(out, name)) out.push(name);
        if (out.length >= 100) break;
    }
    return out;
}

/**
 * Las carpetas de una lista, en orden: primero las guardadas (en su orden) y
 * después las que usan las automatizaciones y no están guardadas (por nombre).
 */
export function mergeAutomationFolders(saved: readonly string[], used: ReadonlyArray<string | null | undefined>): string[] {
    const out = readSavedFolders(saved);
    const extra: string[] = [];
    for (const u of used) {
        if (typeof u !== 'string') continue;
        const name = cleanFolderName(u);
        if (!name || matchFolder(out, name) || matchFolder(extra, name)) continue;
        extra.push(name);
    }
    extra.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    return [...out, ...extra];
}
