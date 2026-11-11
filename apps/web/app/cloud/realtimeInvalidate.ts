import type { QueryClient } from '@tanstack/react-query';
import type { RtInvalidate } from '@imagina-base/shared';

import { layoutDataKeys } from '@/admin/records/layout/useLayoutData';
import { fieldHistoryKeys } from '@/hooks/fieldHistoryKeys';
import { activityKeys } from '@/hooks/useActivity';
import { commentsKeys } from '@/hooks/useComments';
import { customRolesKeys } from '@/hooks/useCustomRoles';
import { invalidateDashboardsForList } from '@/hooks/useDashboards';
import { fieldsKeys } from '@/hooks/useFields';
import { isRecentLocalListsChange, listsKeys } from '@/hooks/useLists';
import { notificationKeys } from '@/hooks/useNotifications';
import { descriptionKeys } from '@/hooks/useRecordDescription';
import {
    AGGREGATES_NS,
    invalidateForList,
    isRecentLocalRecordsChange,
    listIdentifiersFor,
    recordsKeys,
} from '@/hooks/useRecords';
import { viewsKeys } from '@/hooks/useSavedViews';
import { teamsKeys } from '@/hooks/useTeams';
import { timeKeys } from '@/hooks/useTimeTracking';

/**
 * Qué se vuelve a pedir ante cada aviso del realtime (antes vivía dentro de
 * `useRealtime`; aparte para poder probarlo sin un socket).
 *
 * Un aviso de `records` es el caro: una lista que se escribe sin parar (una
 * sincronización, una edición masiva por tandas, automatizaciones) manda uno
 * por segundo, y cada uno volvía a pedir —en CADA pestaña abierta, visible o
 * no— la tabla, los bundles, los totales, las fichas abiertas de cualquier
 * lista y los tableros. Ahora:
 *
 *  - **Pestaña oculta**: no se pide nada. El aviso se guarda (uno por lista) y
 *    se aplica al volver a la pestaña.
 *  - **La lista** (tabla, bundles, totales, ficha): el primer aviso refresca al
 *    instante; los que llegan seguidos se juntan y refrescan como mucho cada
 *    `RECORDS_WINDOW_MS`, y siempre una vez al final (no se pierde el último).
 *  - **Lo derivado** (tableros y gráficos/vinculados de una ficha): igual, con
 *    una ventana más larga; y de las fichas abiertas sólo las que pueden
 *    depender de esa lista.
 */
export const RECORDS_WINDOW_MS = 2_000;
export const DERIVED_WINDOW_MS = 5_000;

export interface RealtimeInvalidatorOptions {
    /** `document.hidden` (inyectable en las pruebas). */
    isHidden?: () => boolean;
}

export interface RealtimeInvalidator {
    handle(ev: RtInvalidate): void;
    /** La pestaña volvió a verse: aplica lo que quedó guardado. */
    onVisible(): void;
    dispose(): void;
}

interface Throttle {
    timer: ReturnType<typeof setTimeout>;
    dirty: boolean;
}

/**
 * ¿Los datos de esta ficha pueden depender de la lista que cambió? Sí si es
 * su propia lista o si alguno de sus bloques lee esa lista. Un bloque que no
 * dice de qué lista es (un gráfico) cuenta como «puede ser»: ante la duda se
 * refresca.
 */
export function layoutDataTouchesList(queryKey: readonly unknown[], data: unknown, listIds: ReadonlySet<string>): boolean {
    if (typeof queryKey[1] === 'string' && listIds.has(queryKey[1])) return true;
    if (!data || typeof data !== 'object') return true;
    const blockLists = (data as Record<string, unknown>).__block_lists;
    let sawBlock = false;
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (key === '__block_lists') continue;
        sawBlock = true;
        const fromMap = blockLists && typeof blockLists === 'object' ? (blockLists as Record<string, unknown>)[key] : undefined;
        const own = (value as { list?: { id?: unknown } } | null)?.list?.id;
        const listId = typeof own === 'number' ? own : typeof fromMap === 'number' ? fromMap : null;
        if (listId === null) return true;
        if (listIds.has(String(listId))) return true;
    }
    return !sawBlock;
}

export function createRealtimeInvalidator(qc: QueryClient, options: RealtimeInvalidatorOptions = {}): RealtimeInvalidator {
    const isHidden = options.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
    /** Avisos de registros recibidos con la pestaña oculta (uno por lista). */
    const deferred = new Map<string, RtInvalidate>();
    const throttles = new Map<string, Throttle>();

    /** Corre ya; lo que llegue dentro de la ventana corre UNA vez al cerrarla. */
    function throttled(key: string, windowMs: number, run: () => void): void {
        const open = throttles.get(key);
        if (open) {
            open.dirty = true;
            return;
        }
        run();
        const arm = (): ReturnType<typeof setTimeout> =>
            setTimeout(() => {
                const t = throttles.get(key);
                if (!t) return;
                if (!t.dirty) {
                    throttles.delete(key);
                    return;
                }
                t.dirty = false;
                t.timer = arm();
                run();
            }, windowMs);
        throttles.set(key, { timer: arm(), dirty: false });
    }

    function refreshList(listId: number): void {
        // v0.1.105 — por ID *y* SLUG (`invalidateForList`): los avisos traen el
        // id numérico y hay queries registradas bajo el slug.
        invalidateForList(qc, recordsKeys.all, listId);
        // La ficha abierta: descripción, actividad y comentarios viven fuera de
        // `records` (sólo se vuelven a pedir las queries montadas).
        invalidateForList(qc, descriptionKeys.all, listId);
        invalidateForList(qc, activityKeys.all, listId);
        // v0.1.291 — historial por campo y registro de tiempo.
        invalidateForList(qc, fieldHistoryKeys.all, listId);
        invalidateForList(qc, timeKeys.all, listId);
        const ids = listIdentifiersFor(qc, listId);
        void qc.invalidateQueries({
            predicate: (q) =>
                q.queryKey[0] === commentsKeys.all[0]
                && typeof q.queryKey[2] === 'string'
                && ids.has(q.queryKey[2]),
        });
    }

    function refreshDerived(listId: number | undefined): void {
        // v0.1.230 — los gráficos y vinculados de una ficha abierta leen OTRAS
        // listas. Sólo las fichas que pueden depender de la que cambió.
        if (listId === undefined) {
            void qc.invalidateQueries({ queryKey: layoutDataKeys.all });
        } else {
            const ids = listIdentifiersFor(qc, listId);
            void qc.invalidateQueries({
                queryKey: layoutDataKeys.all,
                predicate: (q) => layoutDataTouchesList(q.queryKey, q.state.data, ids),
            });
        }
        // v0.1.286 — los tableros con algún widget sobre esa lista. También con
        // el eco local: la mutación de la tabla no toca los tableros.
        invalidateDashboardsForList(qc, listId);
    }

    function records(ev: RtInvalidate): void {
        if (isHidden()) {
            deferred.set(String(ev.listId ?? '*'), ev);
            return;
        }
        if (ev.listId !== undefined) {
            const listId = ev.listId;
            // El eco de una edición hecha en ESTA pestaña: la mutación ya
            // refrescó la lista (v0.1.253).
            if (!isRecentLocalRecordsChange(listId)) {
                throttled(`list:${listId}`, RECORDS_WINDOW_MS, () => refreshList(listId));
            }
        } else {
            throttled('list:*', RECORDS_WINDOW_MS, () => {
                void qc.invalidateQueries({ queryKey: recordsKeys.all });
                // v0.1.286 — y los totales del pie de la tabla.
                void qc.invalidateQueries({ queryKey: [AGGREGATES_NS] });
            });
        }
        throttled(`derived:${ev.listId ?? '*'}`, DERIVED_WINDOW_MS, () => refreshDerived(ev.listId));
    }

    function handle(ev: RtInvalidate): void {
        switch (ev.topic) {
            case 'lists':
                // El eco de un cambio hecho en ESTA pestaña: la mutación ya
                // refrescó las listas (v0.1.286). `cancelRefetch: false`: si
                // ya se están trayendo, no se corta para pedirlas otra vez.
                if (!isRecentLocalListsChange()) {
                    void qc.invalidateQueries({ queryKey: listsKeys.all }, { cancelRefetch: false });
                }
                break;
            case 'fields':
                if (ev.listId !== undefined) invalidateForList(qc, fieldsKeys.all, ev.listId);
                else void qc.invalidateQueries({ queryKey: fieldsKeys.all });
                // Un campo convertido o borrado cambia lo que calculan.
                invalidateDashboardsForList(qc, ev.listId);
                break;
            case 'records':
                records(ev);
                break;
            case 'views':
                if (ev.listId !== undefined) invalidateForList(qc, viewsKeys.all, ev.listId);
                else void qc.invalidateQueries({ queryKey: viewsKeys.all });
                break;
            case 'notifications':
                // v0.1.276 — llega sólo a la sala de esta persona.
                void qc.invalidateQueries({ queryKey: notificationKeys.all });
                break;
            case 'teams':
                // C1 — alguien creó, cambió o borró un equipo.
                void qc.invalidateQueries({ queryKey: teamsKeys.all });
                break;
            case 'roles':
                // C2 — un rol propio cambió: la tabla de Roles y las
                // capacidades de quien mira (se re-arman con la sesión).
                void qc.invalidateQueries({ queryKey: customRolesKeys.all });
                void qc.invalidateQueries({ queryKey: ['me'] });
                break;
            case 'timer':
                // v0.1.291 — el cronómetro de esta persona cambió en otra
                // pestaña o dispositivo.
                void qc.invalidateQueries({ queryKey: timeKeys.active });
                void qc.invalidateQueries({ queryKey: timeKeys.all });
                break;
        }
    }

    return {
        handle,
        onVisible(): void {
            if (deferred.size === 0 || isHidden()) return;
            const batch = [...deferred.values()];
            deferred.clear();
            for (const ev of batch) records(ev);
        },
        dispose(): void {
            for (const t of throttles.values()) clearTimeout(t.timer);
            throttles.clear();
            deferred.clear();
        },
    };
}
