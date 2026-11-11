/** Default de `DB_POOL_MAX`: conexiones a Postgres por proceso. */
export const DEFAULT_DB_POOL_MAX = 30;

/** Tamaño del pool según `DB_POOL_MAX` (2-200); si no es válido, el default. */
export function poolMax(): number {
    const n = Number(process.env.DB_POOL_MAX);
    return Number.isInteger(n) && n >= 2 && n <= 200 ? n : DEFAULT_DB_POOL_MAX;
}
