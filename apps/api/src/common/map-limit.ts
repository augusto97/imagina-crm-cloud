/**
 * `items.map(fn)` con a lo sumo `limit` promesas en vuelo, conservando el orden
 * del resultado. Los bundles (tablero, vista agrupada, ficha) evalúan varias
 * piezas por request; en paralelo sin tope, unos pocos tableros abiertos
 * agotaban el pool de conexiones y una lista simple pasaba de 30 a 500 ms
 * (auditoría v0.1.252).
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i] as T);
        }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
    return out;
}
