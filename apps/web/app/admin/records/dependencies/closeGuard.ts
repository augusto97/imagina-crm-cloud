import type { QueryClient } from '@tanstack/react-query';
import { doneRuleFor, isDoneValue, type RecordDependencies } from '@imagina-base/shared';

import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import { dependencyKeys, fetchRecordDependencies } from '@/hooks/dependencyKeys';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * A8 — «Aviso al cerrar»: pasar el estado de un registro a uno TERMINADO
 * (la misma regla de «Mi trabajo»: el select de estado y sus opciones cuya
 * etiqueta dice completado/hecho/cerrado…) mientras lo bloquean registros
 * abiertos pide confirmación: «Todavía está bloqueado por X, Y. ¿Cerrar
 * igual?». Corre dentro de `useUpdateRecord`, así vale igual en la celda de
 * la tabla, la ficha (modal, página y diseñada) y el kanban.
 *
 * Si la persona cancela, la edición no se manda y se lanza
 * `CloseCancelledError`: quien edita la reconoce con `isCloseCancelled` y
 * vuelve atrás sin mostrar un error.
 */
export class CloseCancelledError extends Error {
    /** El slug del campo de estado que NO se cambió (el resto de la edición sí puede reintentarse). */
    readonly statusSlug: string;
    constructor(statusSlug: string) {
        super(__('Se canceló el cierre.'));
        this.name = 'CloseCancelledError';
        this.statusSlug = statusSlug;
    }
}

export function isCloseCancelled(err: unknown): boolean {
    return err instanceof CloseCancelledError || (err instanceof Error && err.name === 'CloseCancelledError');
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

/** Lista legible en español: «A», «A y B», «A, B y C» (y «… y N más»). */
export function joinNames(names: string[], max = 4): string {
    if (names.length === 0) return '';
    const shown = names.slice(0, max);
    const rest = names.length - shown.length;
    if (rest > 0) return sprintf(__('%1$s y %2$d más'), shown.join(', '), rest);
    if (shown.length === 1) return shown[0]!;
    return `${shown.slice(0, -1).join(', ')} ${__('y')} ${shown[shown.length - 1]}`;
}

/** ¿Esta edición pasa el registro a «terminado»? (pura; la usan la guarda y los tests). */
export function closesRecord(fields: readonly FieldEntity[], values: Record<string, unknown>, current?: Record<string, unknown>): boolean {
    const rule = doneRuleFor(fields);
    if (!rule || !(rule.slug in values)) return false;
    if (!isDoneValue(rule, values[rule.slug])) return false;
    return !(current && isDoneValue(rule, current[rule.slug]));
}

/** Los bloqueantes abiertos, como se nombran en el aviso. */
export function openBlockerNames(deps: RecordDependencies): string[] {
    return deps.blocked_by.filter((l) => !l.done).map((l) => (l.title ? `«${l.title}»` : __('un registro que no puedes ver')));
}

/** Los campos de la lista desde el cache (`['fields', id|slug]`). */
function cachedFields(qc: QueryClient, ids: ReadonlySet<string>): FieldEntity[] | null {
    for (const id of ids) {
        const data = qc.getQueryData<FieldEntity[]>(['fields', id]);
        if (Array.isArray(data)) return data;
    }
    return null;
}

/** El registro tal como está en algún cache de la lista (listado, bundles, ficha). */
function cachedRecord(qc: QueryClient, ids: ReadonlySet<string>, id: number): (RecordEntity & { blocked_by_open?: number }) | null {
    const queries = qc.getQueriesData<unknown>({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'records' && typeof q.queryKey[1] === 'string' && ids.has(q.queryKey[1]),
    });
    const hit = (rows: unknown): RecordEntity | null =>
        Array.isArray(rows) ? ((rows as RecordEntity[]).find((r) => r && r.id === id) ?? null) : null;
    for (const [, data] of queries) {
        if (!data || typeof data !== 'object') continue;
        const d = data as Record<string, unknown>;
        if (d.id === id && typeof d.fields === 'object') return d as unknown as RecordEntity;
        const found =
            hit(d.data) ??
            hit(d.records) ??
            hit(d.unscheduled) ??
            Object.values((d.expanded ?? {}) as Record<string, { records?: { data?: unknown } }>).reduce<RecordEntity | null>(
                (acc, e) => acc ?? hit(e?.records?.data),
                null,
            ) ??
            Object.values((d.cells ?? {}) as Record<string, { records?: unknown }>).reduce<RecordEntity | null>((acc, c) => acc ?? hit(c?.records), null);
        if (found) return found;
    }
    return null;
}

/**
 * La guarda. No hace nada (y no pide nada a la red) salvo que la edición
 * cierre el registro; entonces mira si lo bloquean registros abiertos (con el
 * dato del listado si lo hay, si no pregunta al servidor) y pide confirmar.
 */
export async function guardClose(
    qc: QueryClient,
    confirm: Confirm | null,
    /** Los identificadores de la lista (id y slug: las keys usan cualquiera). */
    ids: ReadonlySet<string>,
    listId: string | number,
    recordId: number,
    values: Record<string, unknown>,
): Promise<void> {
    const fields = cachedFields(qc, ids);
    if (!fields) return;
    const current = cachedRecord(qc, ids, recordId);
    if (!closesRecord(fields, values, current?.fields)) return;
    // El listado ya dice cuántos bloqueantes abiertos tiene: 0 = nada que avisar.
    if (current && current.blocked_by_open === 0) return;
    let deps: RecordDependencies;
    try {
        deps = await qc.fetchQuery({
            queryKey: dependencyKeys.forRecord(listId, recordId),
            queryFn: () => fetchRecordDependencies(listId, recordId),
            staleTime: 0,
        });
    } catch {
        return; // Sin poder leerlas, no se frena la edición.
    }
    const names = openBlockerNames(deps);
    if (names.length === 0) return;
    const description = sprintf(
        /* translators: %s: the open blockers */ __('Todavía está bloqueado por %s. ¿Cerrar igual?'),
        joinNames(names),
    );
    const ok = confirm
        ? await confirm({ title: __('Todavía está bloqueado'), description, confirmLabel: __('Cerrar igual'), cancelLabel: __('Cancelar') })
        : window.confirm(description);
    if (!ok) throw new CloseCancelledError(doneRuleFor(fields)!.slug);
}
