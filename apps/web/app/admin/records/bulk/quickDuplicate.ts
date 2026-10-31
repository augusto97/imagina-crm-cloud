import type { BulkRevertResult, BulkStructureResult } from '@imagina-base/shared';

import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';

/**
 * v0.1.340 — Duplicar en UN clic: sin diálogo ni vista previa. Estas
 * funciones puras deciden qué dice el aviso que queda en pantalla (se cierra
 * solo): en verde si salió todo, en ámbar si salió una parte, en rojo con el
 * motivo si no salió nada.
 */

export type QuickToastVariant = 'success' | 'warning' | 'error';

export interface QuickToast {
    variant: QuickToastVariant;
    title: string;
    description?: string;
}

export interface DuplicateOutcome extends QuickToast {
    /** Hay copias creadas que se pueden deshacer de una vez. */
    canUndo: boolean;
}

/** Los motivos distintos, para el aviso: hasta dos y «y N más». */
export function failureReasons(failed: ReadonlyArray<{ message: string }>): string | undefined {
    const unique = [...new Set(failed.map((f) => f.message.trim()).filter((m) => m !== ''))];
    if (unique.length === 0) return undefined;
    const shown = unique.slice(0, 2).join(' · ');
    return unique.length > 2 ? sprintf(__('%1$s · y %2$s motivos más'), shown, formatNumber(unique.length - 2)) : shown;
}

/**
 * Qué dice el aviso después de duplicar. `succeeded` son los registros
 * originales que se copiaron; `created` cuenta también sus subtareas.
 */
export function duplicateOutcome(requested: number, result: BulkStructureResult): DuplicateOutcome {
    const copies = result.succeeded.length;
    const subtasks = Math.max(0, result.created - copies);
    const reasons = failureReasons(result.failed);
    if (copies === 0) {
        return {
            variant: 'error',
            title: requested === 1 ? __('No se pudo duplicar el registro') : __('No se pudieron duplicar los registros'),
            description: reasons ?? __('Vuelve a intentarlo en un momento.'),
            canUndo: false,
        };
    }
    const canUndo = result.edit_id !== null;
    if (result.failed.length > 0) {
        return {
            variant: 'warning',
            title: sprintf(__('Se duplicaron %1$s de %2$s registros'), formatNumber(copies), formatNumber(copies + result.failed.length)),
            ...(reasons ? { description: reasons } : {}),
            canUndo,
        };
    }
    return {
        variant: 'success',
        title: copies === 1 ? __('Registro duplicado') : sprintf(__('%s registros duplicados'), formatNumber(copies)),
        ...(subtasks > 0 ? { description: sprintf(_n('Con %s subtarea.', 'Con sus %s subtareas.', subtasks), formatNumber(subtasks)) } : {}),
        canUndo,
    };
}

/** Qué dice el aviso después de «Deshacer» un duplicado. */
export function undoDuplicateOutcome(result: BulkRevertResult, editedLater: number): QuickToast {
    const kept = result.conflicts + editedLater;
    const reasons = failureReasons(result.failed);
    if (result.reverted === 0) {
        if (kept > 0 && result.failed.length === 0) {
            return {
                variant: 'warning',
                title: __('No se quitó la copia'),
                description: __('Alguien ya la editó. Si igual quieres quitarla, bórrala o deshazlo desde el historial de ediciones masivas.'),
            };
        }
        return { variant: 'error', title: __('No se pudo deshacer'), description: reasons ?? __('Vuelve a intentarlo en un momento.') };
    }
    const title = sprintf(_n('Se quitó la copia', 'Se quitaron %s copias', result.reverted), formatNumber(result.reverted));
    if (kept > 0 || result.failed.length > 0) {
        const parts = [
            ...(kept > 0 ? [sprintf(_n('%s quedó porque alguien la editó.', '%s quedaron porque alguien las editó.', kept), formatNumber(kept))] : []),
            ...(reasons ? [reasons] : []),
        ];
        return { variant: 'warning', title, description: parts.join(' ') };
    }
    return { variant: 'success', title };
}
