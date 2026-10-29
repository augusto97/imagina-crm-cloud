import type { StoreCellAccess, StoreRowGetter } from './store-rules';
import { WP_SETTABLE_POST_STATUSES, type SiteListMarker } from './site-sync';

/**
 * Qué se puede hacer en una lista que viene de un sitio WordPress (v0.1.333,
 * ADR-S83). Las mismas reglas que la tienda (`store-rules.ts`), con lo propio
 * de WordPress:
 *
 *  - **Registros**: no se crean ni se borran aquí — se hace en WordPress.
 *  - **Columnas del sitio**: de sólo lectura, salvo las que la empresa
 *    habilitó (por defecto título, extracto y términos) y sólo con «Editar
 *    desde la app» activado.
 *  - **Columnas propias** (una nota, un responsable): libres. Nunca viajan.
 *  - **La fila manda**: una entrada en la papelera de WordPress no se edita
 *    desde aquí (habría que restaurarla allá).
 *
 * PURAS: las usan el backend (que rechaza la edición) y la interfaz (que
 * bloquea la celda y dice por qué), así nunca dicen cosas distintas.
 */

const HOW_TO_EDIT = 'Se edita en WordPress.';

/** La clave de columna del sitio de un campo, o null si es una columna propia. */
export function siteFieldKey(marker: SiteListMarker, fieldId: number): string | null {
    for (const [key, id] of Object.entries(marker.fields)) if (id === fieldId) return key;
    return null;
}

export function isSiteField(marker: SiteListMarker, fieldId: number): boolean {
    return siteFieldKey(marker, fieldId) !== null;
}

/** Por qué no se puede habilitar una columna (las que calcula WordPress). */
function readOnlyReason(key: string): string {
    switch (key) {
        case 'wp_id':
        case 'edit_link':
        case 'link':
            return 'Lo pone WordPress.';
        case 'modified':
            return 'WordPress la actualiza sola cada vez que alguien guarda.';
        case 'count':
            return 'WordPress la calcula: cuántas entradas tienen este término.';
        case 'author':
        case 'parent':
        case 'template':
        case 'featured_image':
            return HOW_TO_EDIT;
        default:
            return key.startsWith('acf:') || key.startsWith('meta:')
                ? 'Es un dato con varias partes (una lista o un grupo): se edita en WordPress.'
                : HOW_TO_EDIT;
    }
}

export function siteCellAccess(marker: SiteListMarker, fieldId: number, row: StoreRowGetter): StoreCellAccess {
    const key = siteFieldKey(marker, fieldId);
    if (key === null) return { access: 'own' };
    if (!marker.can_edit.includes(key)) return { access: 'locked', reason: readOnlyReason(key) };
    if (!marker.write_back) {
        return {
            access: 'locked',
            reason: 'Viene de WordPress. Para cambiarla desde aquí, activa «Editar desde la app» en la página del sitio.',
        };
    }
    if (!marker.editable.includes(key)) {
        return {
            access: 'locked',
            reason: 'Viene de WordPress. Para cambiarla desde aquí, habilítala en «Columnas que se editan desde la app» (página del sitio).',
        };
    }
    if (row('status') === 'trash') {
        return marker.kind === 'taxonomy'
            ? { access: 'locked', reason: 'Este término se borró en WordPress.' }
            : { access: 'locked', reason: 'Está en la papelera de WordPress: restáurala allá para editarla.' };
    }
    return { access: 'editable' };
}

/**
 * Un valor que WordPress no aceptaría. `null` = está bien. Se chequea ANTES de
 * guardar: si la app lo aceptara y el sitio no, el dato quedaría distinto en
 * los dos lados.
 */
export function siteValueError(marker: SiteListMarker, fieldId: number, value: unknown, _row: StoreRowGetter): string | null {
    const key = siteFieldKey(marker, fieldId);
    if (key === null) return null;
    const empty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
    switch (key) {
        case 'title':
            return empty ? 'El título no puede quedar vacío.' : null;
        case 'name':
            return empty ? 'El nombre no puede quedar vacío.' : null;
        case 'slug': {
            if (empty) return 'El slug no puede quedar vacío: WordPress lo usa para la dirección.';
            const text = String(value).trim();
            if (text.length > 200) return 'El slug es demasiado largo (máximo 200 caracteres).';
            if (/[/?#]/.test(text)) return 'El slug no puede llevar «/», «?» ni «#»: es sólo la última parte de la dirección.';
            return null;
        }
        case 'status':
            if (marker.kind === 'taxonomy') return 'El estado de un término lo marca la sincronización.';
            return (WP_SETTABLE_POST_STATUSES as readonly string[]).includes(String(value))
                ? null
                : 'Ese estado se pone en WordPress (programar una fecha o mandar a la papelera): elige otro.';
        case 'date':
            return empty ? 'La fecha de publicación no puede quedar vacía.' : null;
        case 'menu_order': {
            if (empty) return null;
            const n = typeof value === 'number' ? value : Number(value);
            return Number.isInteger(n) ? null : 'El orden tiene que ser un número entero.';
        }
        default:
            return null;
    }
}
