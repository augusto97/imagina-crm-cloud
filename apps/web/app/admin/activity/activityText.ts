import { formatFieldNumber } from '@/lib/fieldNumberFormat';
import { __, sprintf } from '@/lib/i18n';
import { formatDateStr, formatDateTimeStr } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';
import type { ActivityEntity } from '@/types/activity';

/**
 * Traducción del log de actividad a lenguaje humano (v0.1.149).
 *
 * El backend guarda el diff por CLAVE JSONB (`{"f101": {from, to}}`) — el id
 * es la verdad, el slug es etiqueta (regla de oro nº 1). Para leerlo hace
 * falta el catálogo de campos de la lista, que la ficha ya tiene cargado. Sin
 * el catálogo (un campo borrado, por ejemplo) se cae al nombre crudo en vez
 * de esconder el cambio: es preferible "cambió f101" a no decir nada.
 */

export interface FieldChange {
    /** Etiqueta legible del campo ("Estado"). */
    label: string;
    field: FieldEntity | undefined;
    from: unknown;
    to: unknown;
}

/** Los cambios de una entrada, ya resueltos contra el catálogo de campos. */
export function changesOf(entry: ActivityEntity, fields: FieldEntity[]): FieldChange[] {
    const raw = entry.changes;
    if (raw === null || typeof raw !== 'object') return [];
    const byKey = new Map(fields.map((f) => [`f${f.id}`, f]));
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const out: FieldChange[] = [];
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value === null || typeof value !== 'object') continue;
        const pair = value as { from?: unknown; to?: unknown; before?: unknown; after?: unknown };
        // `from/to` es el shape del backend cloud; `before/after` quedó del
        // plugin y se acepta por si alguna entrada vieja lo trae.
        const hasPair = 'from' in pair || 'to' in pair || 'before' in pair || 'after' in pair;
        if (!hasPair) continue;
        const field = byKey.get(key) ?? bySlug.get(key);
        out.push({
            label: field?.label ?? key,
            field,
            from: pair.from ?? pair.before ?? null,
            to: pair.to ?? pair.after ?? null,
        });
    }
    return out;
}

/** ¿La entrada la produjo una persona o el sistema (automatización, import)? */
export function actorOf(entry: ActivityEntity): string {
    if (entry.user_name !== null && entry.user_name !== undefined && entry.user_name !== '') {
        return entry.user_name;
    }
    if (entry.user_id !== null && entry.user_id > 0) {
        return sprintf(/* translators: %d: user id */ __('Usuario #%d'), entry.user_id);
    }
    return __('El sistema');
}

/** El verbo de la entrada, en pasado y con sujeto ya puesto aparte. */
export function actionText(entry: ActivityEntity, changeCount: number): string {
    switch (entry.action) {
        case 'record_created':
        case 'record.created':
            return __('creó este registro');
        case 'record_deleted':
        case 'record.deleted':
            return __('eliminó este registro');
        case 'comment.created':
            return __('comentó');
        case 'comment.updated':
            return __('editó un comentario');
        case 'comment.deleted':
            return __('eliminó un comentario');
        case 'automation.run':
            return __('ejecutó una automatización');
        default:
            // record_updated sin diff legible (o con campos que ya no existen).
            return changeCount === 0 ? __('actualizó este registro') : '';
    }
}

/**
 * El valor de un campo, formateado como lo ve el usuario en la ficha: fechas
 * y números con el formato regional de la empresa, selects con su etiqueta,
 * checkbox como Sí/No. `null` para vacío — quien renderiza decide cómo
 * mostrarlo (chip "vacío", tachado, etc.).
 */
export function formatActivityValue(field: FieldEntity | undefined, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value)) {
        if (value.length === 0) return null;
        return value.map((v) => formatActivityValue(field, v) ?? String(v)).join(', ');
    }
    if (field === undefined) {
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    switch (field.type) {
        case 'checkbox':
            return value === true || value === 'true' || value === 1 ? __('Sí') : __('No');
        case 'date':
            return typeof value === 'string' ? formatDateStr(value) : String(value);
        case 'datetime':
            return typeof value === 'string' ? formatDateTimeStr(value) : String(value);
        case 'currency':
        case 'number':
            return typeof value === 'number'
                ? formatFieldNumber(field, value)
                : String(value);
        case 'select':
        case 'multi_select': {
            const opts = (field.config as { options?: Array<{ value?: string; label?: string }> })
                .options;
            const found = Array.isArray(opts)
                ? opts.find((o) => String(o.value) === String(value))
                : undefined;
            return found?.label ?? String(value);
        }
        case 'user':
            return sprintf(/* translators: %s: user id */ __('Usuario #%s'), String(value));
        case 'file':
            return __('un archivo');
        default:
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
}

/**
 * La frase de UN cambio, al estilo ClickUp: "estableció Estado en Activo",
 * "cambió Ciudad de Bogotá a Medellín", "vació Teléfono".
 */
export function changeSentence(change: FieldChange): {
    verb: string;
    from: string | null;
    to: string | null;
} {
    const from = formatActivityValue(change.field, change.from);
    const to = formatActivityValue(change.field, change.to);
    if (from === null && to !== null) return { verb: __('estableció'), from: null, to };
    if (from !== null && to === null) return { verb: __('vació'), from, to: null };
    return { verb: __('cambió'), from, to };
}

/** Fecha relativa corta ("hace 7 min", "ayer"); la exacta va en el title. */
export function relativeTime(iso: string): string {
    const t = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z');
    const ms = Date.now() - t.getTime();
    if (Number.isNaN(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return __('recién');
    if (min < 60) return sprintf(/* translators: %d: minutes */ __('hace %d min'), min);
    const hours = Math.round(min / 60);
    if (hours < 24) return sprintf(/* translators: %d: hours */ __('hace %d h'), hours);
    const days = Math.round(hours / 24);
    if (days === 1) return __('ayer');
    if (days < 30) return sprintf(/* translators: %d: days */ __('hace %d días'), days);
    const months = Math.round(days / 30);
    if (months < 12) return sprintf(/* translators: %d: months */ __('hace %d meses'), months);
    return sprintf(/* translators: %d: years */ __('hace %d años'), Math.round(months / 12));
}

/**
 * Toda la entrada en UNA línea de texto ("Augusto cambió Estado de Activo a
 * Pausado"). La usa el timeline del layout CRM, que no tiene lugar para el
 * bloque de varias líneas del panel lateral.
 */
export function summarizeActivity(entry: ActivityEntity, fields: FieldEntity[]): string {
    const changes = changesOf(entry, fields);
    const actor = actorOf(entry);
    const verb = actionText(entry, changes.length);
    if (changes.length === 0) return `${actor} ${verb}`.trim();
    const parts = changes.map((c) => {
        const s = changeSentence(c);
        if (s.from !== null && s.to !== null) {
            return sprintf(
                /* translators: 1: verb, 2: field, 3: old value, 4: new value */
                __('%1$s %2$s de %3$s a %4$s'),
                s.verb,
                c.label,
                s.from,
                s.to,
            );
        }
        if (s.to !== null) {
            return sprintf(
                /* translators: 1: verb, 2: field, 3: value */
                __('%1$s %2$s en %3$s'),
                s.verb,
                c.label,
                s.to,
            );
        }
        return sprintf(/* translators: 1: verb, 2: field */ __('%1$s %2$s'), s.verb, c.label);
    });
    return `${actor} ${parts.join('; ')}`;
}
