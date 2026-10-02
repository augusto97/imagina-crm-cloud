import type { ActionMeta, ActionSpec } from '@/types/automation';

/**
 * Opciones del selector "Tipo de acción".
 *
 * Las acciones de un conector comparten el MISMO tipo (`connector_action`) y
 * se distinguen por su conexión y su clave. Antes el `<select>` usaba el tipo
 * como valor, así que todas las de conector eran la misma opción: una acción
 * de WooCommerce o cualquier otra se mostraba como la PRIMERA del catálogo
 * («Enviar mensaje de WhatsApp»), y elegir otra desde el selector borraba la
 * conexión. Acá cada opción tiene un valor único y el valor de una acción se
 * deriva de su config.
 */
export interface ActionTypeOption {
    value: string;
    label: string;
    group: 'builtin' | 'connector' | 'unknown';
}

export function connectorOptionValue(connectionId: number, actionKey: string): string {
    return `connector:${connectionId}:${actionKey}`;
}

/** Valor del selector para una acción guardada. */
export function actionOptionValue(spec: ActionSpec): string {
    if (spec.type !== 'connector_action') return spec.type;
    const id = Number(spec.config.connection_id);
    const key = typeof spec.config.action_key === 'string' ? spec.config.action_key : '';
    return connectorOptionValue(Number.isFinite(id) ? id : 0, key);
}

export function actionTypeOptions(
    catalog: ActionMeta[],
    current: ActionSpec | null,
    opts: { exclude?: string[] } = {},
): ActionTypeOption[] {
    const exclude = opts.exclude ?? [];
    const out: ActionTypeOption[] = [];
    for (const a of catalog) {
        if (exclude.includes(a.slug)) continue;
        if (a.connector) {
            out.push({
                value: connectorOptionValue(a.connector.connection_id, a.connector.action_key),
                label: `${a.label} · ${a.connector.connection_name}`,
                group: 'connector',
            });
        } else {
            out.push({ value: a.slug, label: a.label, group: 'builtin' });
        }
    }
    // Lo guardado que el catálogo no conoce (una conexión borrada, un tipo
    // viejo) se muestra tal cual: si no, el navegador elige la primera opción
    // y la acción PARECE ser otra.
    if (current) {
        const value = actionOptionValue(current);
        if (!out.some((o) => o.value === value)) {
            out.unshift({
                value,
                label:
                    current.type === 'connector_action'
                        ? `Acción de conector no disponible (${String(current.config.action_key ?? '?')})`
                        : `Tipo desconocido: ${current.type}`,
                group: 'unknown',
            });
        }
    }
    return out;
}

/** La acción nueva al elegir una opción (la config arranca vacía). */
export function specForOption(value: string): ActionSpec {
    const m = /^connector:(\d+):(.+)$/.exec(value);
    if (m) {
        return { type: 'connector_action', config: { connection_id: Number(m[1]), action_key: m[2], values: {} } };
    }
    return { type: value, config: {} };
}

/** Nombre de la acción para títulos (el del conector cuando corresponde). */
export function actionTitle(spec: ActionSpec, catalog: ActionMeta[], fallback: string): string {
    if (spec.type === 'connector_action') {
        const hit = catalog.find(
            (a) =>
                a.connector?.connection_id === Number(spec.config.connection_id)
                && a.connector.action_key === spec.config.action_key,
        );
        return hit ? hit.label : fallback;
    }
    return catalog.find((a) => !a.connector && a.slug === spec.type)?.label ?? fallback;
}
