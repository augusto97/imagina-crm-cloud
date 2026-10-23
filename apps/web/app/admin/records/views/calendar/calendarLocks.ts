import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { storeAccessFor, type StoreRules } from '../../storeRules';
import { sourceFields, type CalendarEvent } from './calendarModel';

/**
 * Por qué NO se puede mover (o estirar) un evento, o null si se puede: sin
 * permiso de edición, o un campo que la tienda no deja cambiar desde aquí
 * (las MISMAS reglas que usa el servidor, `storeCellAccess`). Mover toca el
 * inicio y el fin; estirar, el fin o la duración.
 */
export function calendarLockReason(
    event: CalendarEvent,
    what: 'move' | 'resize',
    ctx: { canEdit: boolean; fieldsById: ReadonlyMap<number, FieldEntity>; storeRules: StoreRules | null },
): string | null {
    if (!ctx.canEdit) return __('No tienes permiso para editar registros.');
    const f = sourceFields(event.source, ctx.fieldsById);
    if (!f) return __('El campo de fecha ya no existe.');
    const touched = what === 'move' ? [f.start, ...(f.end ? [f.end] : [])] : [f.end ?? f.duration].filter((x): x is FieldEntity => x !== null);
    for (const field of touched) {
        const access = storeAccessFor(ctx.storeRules, field, event.record);
        if (access?.access === 'locked') return access.reason;
    }
    return null;
}
