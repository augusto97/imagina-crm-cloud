import { sql } from 'drizzle-orm';
import type { Tx } from './client';

/**
 * v0.1.286 — agrupar por una clave que lleva una SUBCONSULTA por fila (el
 * conjunto ordenado de un multi_select, el valor de un lookup / rollup, un
 * calculado que usa un rollup) hace que el planificador estime un costo de
 * ~1M para 100k registros, aunque la subconsulta casi nunca se ejecute (el
 * atajo de 1-2 opciones la esquiva). Con ese costo Postgres COMPILA la
 * consulta con JIT (inlining + optimización): 130-270 ms medidos que se
 * pagan en CADA pedido de la vista agrupada, más que la consulta misma
 * (~200 ms sin JIT, ~450 ms con). La clave de fecha, sin subconsulta, ni lo
 * dispara (costo ~23k).
 *
 * `SET LOCAL` vale sólo para la transacción en curso: no cambia resultados,
 * sólo deja de compilar una consulta corta.
 */
export function groupKeyHasSubquery(type: string): boolean {
    return type === 'multi_select' || type === 'lookup' || type === 'rollup' || type === 'computed';
}

export async function disableJitForTx(tx: Tx): Promise<void> {
    await tx.execute(sql`SET LOCAL jit = off`);
}
