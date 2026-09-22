import { connectorActionSchema, type ConnectorAction } from '@imagina-base/shared';

/**
 * Acciones con NOMBRE de un conector (v0.1.198, ADR-S22 fase 2).
 *
 * Una acción con nombre es un preset guardado de una petición: "Enviar
 * WhatsApp" en vez de "POST /send con estos cuatro campos". Acá se COMPILA a
 * la misma config que consume `buildWebhookRequest`, así hay un solo motor de
 * peticiones salientes: lo que se prueba, lo que ejecuta la automatización y
 * lo que hace el conector son literalmente el mismo código.
 *
 * PURO, como `connectionParts` y `buildWebhookRequest`, por el mismo motivo:
 * el probador de la UI tiene que armar exactamente lo que después se ejecuta.
 */

/** Lo mismo que recibe `buildWebhookRequest`. */
export type MergeFn = (raw: unknown) => string;

export interface CompiledCall {
    /** Config equivalente a la de `call_webhook`, con TODO ya resuelto. */
    cfg: Record<string, unknown>;
    /** Parámetros obligatorios que quedaron vacíos (la acción no debe salir). */
    missing: string[];
}

/**
 * Lee las acciones guardadas en `connections.config.actions`. TOLERANTE a
 * propósito: una acción mal formada (de una versión futura, o de un import)
 * se DESCARTA en vez de tumbar el listado entero de conexiones — el resto de
 * las acciones siguen sirviendo.
 */
export function readConnectorActions(raw: unknown): ConnectorAction[] {
    if (!Array.isArray(raw)) return [];
    const out: ConnectorAction[] = [];
    for (const entry of raw) {
        const parsed = connectorActionSchema.safeParse(entry);
        if (parsed.success) out.push(parsed.data);
    }
    return out;
}

export function findConnectorAction(
    actions: readonly ConnectorAction[] | undefined,
    key: unknown,
): ConnectorAction | null {
    const wanted = String(key ?? '').trim();
    if (wanted === '') return null;
    return actions?.find((a) => a.key === wanted) ?? null;
}

/** Sustituye `{clave}` por el valor resuelto. Lo que no matchea queda igual:
 *  es texto que escribió quien definió la acción, no un error a adivinar. */
function fillPlaceholders(
    template: string,
    values: Map<string, string>,
    encode: boolean,
): string {
    return template.replace(/\{([A-Za-z0-9_.\-[\]]+)\}/g, (whole, key: string) => {
        const value = values.get(key);
        if (value === undefined) return whole;
        return encode ? encodeURIComponent(value) : value;
    });
}

/**
 * Resuelve los valores de la acción y arma la config de la petición.
 *
 * `merge` se aplica UNA sola vez, acá: el caller le pasa a
 * `buildWebhookRequest` una función identidad para que no vuelva a expandir
 * merge tags sobre datos que ya son valores de registro (un registro cuyo
 * texto contenga `{{algo}}` no tiene por qué re-expandirse).
 */
export function compileConnectorCall(
    action: ConnectorAction,
    values: Record<string, unknown>,
    merge: MergeFn,
): CompiledCall {
    const resolved = new Map<string, string>();
    const missing: string[] = [];

    for (const param of action.params) {
        const raw = values[param.key];
        const source = raw === undefined || raw === null || raw === '' ? param.default : raw;
        const value = merge(source);
        resolved.set(param.key, value);
        if (param.required && value.trim() === '') missing.push(param.label || param.key);
    }

    const bodyParams: Array<{ key: string; value: string }> = [];
    const queryParams: Array<{ key: string; value: string }> = [];
    const headers: Array<{ key: string; value: string }> = [];
    for (const param of action.params) {
        const value = resolved.get(param.key) ?? '';
        // Un opcional vacío NO viaja: mandar `nota=` cuando nadie escribió una
        // nota le cambia el significado al pedido para muchas APIs.
        if (!param.required && value === '' && param.location !== 'path') continue;
        if (param.location === 'body') bodyParams.push({ key: param.key, value });
        else if (param.location === 'query') queryParams.push({ key: param.key, value });
        else if (param.location === 'header') headers.push({ key: param.key, value });
    }

    const url = fillPlaceholders(action.path, resolved, true);
    const bodyTemplate =
        action.body_template === ''
            ? ''
            : fillPlaceholders(action.body_template, resolved, false);

    return {
        missing,
        cfg: {
            url,
            method: action.method,
            content_type: action.content_type,
            body_params: bodyParams,
            query_params: queryParams,
            headers,
            body_template: bodyTemplate,
        },
    };
}

/** Descripción corta para el historial del run y la UI ("Enviar WhatsApp"). */
export function describeConnectorAction(action: ConnectorAction | null, key: unknown): string {
    return action?.label ?? `acción «${String(key ?? '')}»`;
}
