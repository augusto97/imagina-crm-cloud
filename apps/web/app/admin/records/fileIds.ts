/**
 * El valor de un campo Archivo como lista de ids de adjunto. El validador
 * compartido exige un ARRAY; aquí se acepta también lo que dejaron versiones
 * anteriores (un número suelto o un id como texto) para no perder nada.
 */
export function normalizeFileIds(value: unknown): number[] {
    const items = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
    const out: number[] = [];
    for (const v of items) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
        if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}

/** `config.max_files` de un campo Archivo (undefined = sin tope). */
export function maxFilesOf(config: unknown): number | undefined {
    const raw = (config as { max_files?: unknown } | null | undefined)?.max_files;
    return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}
