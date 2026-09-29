/**
 * v0.1.210 — Una fecha-hora del API como `Date`. Llegan de dos formas:
 * naive-UTC (`YYYY-MM-DD HH:MM:SS`, lo que guarda la app) o ISO con zona
 * (`…T12:04:00Z`, lo que escribe la sincronización con una tienda o la API).
 * Sumarle `'Z'` a ciegas rompía la segunda (`…ZZ` → fecha inválida) y la
 * interfaz mostraba el texto crudo.
 */
export function toUtcIso(value: string): string {
    const raw = value.trim().replace(' ', 'T');
    return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
}

export function parseUtcDate(value: string | null | undefined): Date {
    return new Date(value ? toUtcIso(value) : NaN);
}
