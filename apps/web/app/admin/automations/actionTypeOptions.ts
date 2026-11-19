import { ON_ERROR_EXEMPT_ACTIONS, acceptsWasApiCalls, convertWasApiCall, integrationDef, isRetryableAction, readOnError, readWasApiCall } from '@imagina-base/shared';
import type { ActionMeta, ActionSpec } from '@/types/automation';

/**
 * Opciones del selector "Tipo de acción".
 *
 * Las acciones de un conector comparten el MISMO tipo (`connector_action`) y
 * se distinguen por su conexión y su clave. Antes el `<select>` usaba el tipo
 * como valor, así que todas las de conector eran la misma opción: una acción
 * de WooCommerce o cualquier otra se mostraba como la PRIMERA del catálogo
 * («Enviar mensaje de WhatsApp»), y elegir otra desde el selector borraba la
 * conexión. Aquí cada opción tiene un valor único y el valor de una acción se
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

/** La app de la galería de una acción de conector, según el catálogo. */
function connectorApp(spec: ActionSpec, catalog: ActionMeta[]): string | null {
    if (spec.type !== 'connector_action') return null;
    const id = Number(spec.config.connection_id);
    return catalog.find((a) => a.connector?.connection_id === id)?.connector?.integration_key ?? null;
}

/**
 * v0.1.400 — La acción que queda al elegir otra en «Tipo de acción», sin
 * perder lo que ya estaba escrito.
 *
 * Antes la acción arrancaba VACÍA: pasar «Enviar mensaje de WhatsApp» de la
 * cuenta de WAS a la de Whats obligaba a volver a escribir el número y el
 * mensaje (y se perdía la condición de la acción). Ahora:
 *  - la condición de la acción se conserva siempre;
 *  - entre acciones de conector se conservan los datos que la acción nueva
 *    entiende (mismo nombre de dato: número, mensaje, para, asunto…);
 *  - una «Llamar webhook externo» que manda a la API de WAS se convierte a
 *    «Enviar mensaje / archivo por WhatsApp» con su número y su mensaje.
 */
export function carryOverSpec(prev: ActionSpec | null, next: ActionSpec, catalog: ActionMeta[]): ActionSpec {
    if (!prev) return next;
    const out: ActionSpec = prev.condition !== undefined ? { ...next, condition: prev.condition } : { ...next };
    // v0.1.460 — «Si este paso falla» también se conserva, salvo en un
    // contenedor (no falla por sí mismo) o un «Reintentar» que el paso nuevo
    // no admite (no llama a otro servicio).
    if (prev.on_error && !ON_ERROR_EXEMPT_ACTIONS.includes(next.type) && (readOnError(prev.on_error).mode !== 'retry' || isRetryableAction(next.type))) {
        out.on_error = prev.on_error;
    }
    if (next.type !== 'connector_action') return out;
    const nextApp = connectorApp(next, catalog);
    const nextKey = String(next.config.action_key ?? '');
    const params = integrationDef(nextApp)?.actions.find((a) => a.key === nextKey)?.params.map((p) => p.key) ?? null;
    let carried: Record<string, unknown> = {};
    if (prev.type === 'connector_action') {
        const prevValues = (prev.config.values ?? {}) as Record<string, unknown>;
        if (params) carried = Object.fromEntries(Object.entries(prevValues).filter(([k]) => params.includes(k)));
        else if (Number(prev.config.connection_id) === Number(next.config.connection_id)) carried = { ...prevValues };
    } else if (prev.type === 'call_webhook' && acceptsWasApiCalls(nextApp)) {
        const call = readWasApiCall(prev.config);
        const converted = call ? convertWasApiCall(call, prev.config, nextApp!) : null;
        if (converted?.ok) carried = Object.fromEntries(Object.entries(converted.values).filter(([k]) => !params || params.includes(k)));
    }
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(carried)) if (v !== undefined && v !== null && String(v) !== '') values[k] = String(v);
    return { ...out, config: { ...next.config, values: { ...values, ...((next.config.values ?? {}) as Record<string, string>) } } };
}
