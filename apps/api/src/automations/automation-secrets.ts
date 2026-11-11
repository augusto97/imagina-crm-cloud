import { AUTOMATION_SECRET_MARKER } from '@imagina-base/shared';

/**
 * v0.1.288 — Secretos de una automatización en su historial de versiones.
 *
 * Una versión es una foto de la config para mostrar y restaurar: no tiene por
 * qué guardar credenciales (el secreto HMAC de un webhook, una cabecera
 * `Authorization`, el token del webhook entrante). Se reemplazan por una marca
 * y, al RESTAURAR, la marca se vuelve a llenar con el secreto ACTUAL de la
 * acción equivalente (mismo tipo y mismo destino) — así restaurar no rompe una
 * integración que sigue igual, y nunca mete el secreto de una acción en otra.
 */

/** Claves cuyo valor es un secreto (las mismas que tapa el MCP, v0.1.193). */
const SECRET_KEY_RE = /(secret|token|password|api_key|apikey|authorization)/i;
/** Cabeceras / parámetros (filas `{key, value}`) cuyo valor es un secreto. */
const SECRET_ROW_RE = /(authorization|token|secret|password|passwd|api[-_]?key|cookie|credential|signature|x-auth)/i;

/**
 * Secretos DENTRO de un texto: la contraseña de una dirección
 * (`https://usuario:clave@host`), los parámetros de la URL con nombre de
 * secreto (`?api_key=…`) y un `Bearer …` escrito a mano (en un cuerpo
 * crudo o en una cabecera con otro nombre). Un token metido en la RUTA
 * de una URL (`/bot123:ABC/sendMessage`) no se puede reconocer: para eso están
 * las conexiones.
 */
export function redactSecretsInText(text: string): string {
    if (text.length < 8) return text;
    let out = text;
    if (/https?:\/\//i.test(out)) {
        out = out.replace(/(https?:\/\/[^\s/?#@:]*:)([^\s/?#@]+)(@)/gi, (_m, a: string, _pass: string, at: string) => `${a}${AUTOMATION_SECRET_MARKER}${at}`);
        out = out.replace(/([?&]([^=&#\s]+)=)([^&#\s"'<>]+)/g, (m, lead: string, name: string, value: string) =>
            SECRET_ROW_RE.test(name) && !/^\{\{[^}]*\}\}$/.test(value) ? `${lead}${AUTOMATION_SECRET_MARKER}` : m,
        );
    }
    // Un token escrito a mano tras `Bearer`: tiene algún número o signo (así
    // una frase que diga «Bearer …» no se toca).
    out = out.replace(/\bBearer\s+(?!\{\{)(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{12,}/g, `Bearer ${AUTOMATION_SECRET_MARKER}`);
    return out;
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

export function redactAutomationSecrets<T>(value: T): T {
    if (typeof value === 'string') return redactSecretsInText(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => redactAutomationSecrets(v)) as unknown as T;
    if (!isPlain(value)) return value;
    // Una fila clave/valor (cabeceras, parámetros de la URL, campos del
    // cuerpo) con nombre de secreto: `{key, value}` o `{name, value}`.
    const rowName = typeof value.key === 'string' ? value.key : typeof value.name === 'string' ? value.name : null;
    if (rowName !== null && 'value' in value && SECRET_ROW_RE.test(rowName) && hasValue(value.value) && typeof value.value !== 'object') {
        return { ...value, value: AUTOMATION_SECRET_MARKER } as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = SECRET_KEY_RE.test(k) && typeof v === 'string' && hasValue(v) ? AUTOMATION_SECRET_MARKER : redactAutomationSecrets(v);
    }
    return out as T;
}

/** ¿Hay alguna marca de secreto adentro? */
export function hasRedactedSecrets(value: unknown): boolean {
    if (typeof value === 'string') return value.includes(AUTOMATION_SECRET_MARKER);
    if (Array.isArray(value)) return value.some(hasRedactedSecrets);
    if (isPlain(value)) return Object.values(value).some(hasRedactedSecrets);
    return false;
}

/**
 * Llena las marcas de `incoming` con lo que hay en la MISMA posición de
 * `current` (filas `{key, value}` se emparejan por su clave, no por índice).
 * Lo que no tiene par queda vacío: un secreto nunca se inventa.
 */
function fillFrom(incoming: unknown, current: unknown): unknown {
    if (incoming === AUTOMATION_SECRET_MARKER) return typeof current === 'string' ? current : '';
    // Un texto con el secreto tapado ADENTRO (una URL con `?api_key=[oculto]`):
    // vuelve el texto actual sólo si es el mismo salvo por lo tapado.
    if (typeof incoming === 'string' && incoming.includes(AUTOMATION_SECRET_MARKER)) {
        return typeof current === 'string' && redactSecretsInText(current) === incoming ? current : incoming;
    }
    if (Array.isArray(incoming)) {
        const cur = Array.isArray(current) ? current : [];
        return incoming.map((item, i) => {
            if (isPlain(item) && typeof item.key === 'string') {
                const twin = cur.find((c) => isPlain(c) && c.key === item.key);
                return fillFrom(item, twin);
            }
            if (isPlain(item) && typeof item.name === 'string' && 'value' in item) {
                const twin = cur.find((c) => isPlain(c) && c.name === item.name);
                return fillFrom(item, twin);
            }
            return fillFrom(item, cur[i]);
        });
    }
    if (!isPlain(incoming)) return incoming;
    const cur = isPlain(current) ? current : {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(incoming)) out[k] = hasRedactedSecrets(v) ? fillFrom(v, cur[k]) : v;
    return out;
}

interface ActionLike {
    type?: unknown;
    config?: unknown;
}

/** La "identidad" de una acción para emparejarla con su versión actual. */
function signature(a: ActionLike): string {
    const c = isPlain(a.config) ? a.config : {};
    // La URL, con sus secretos tapados: así la acción que llega tapada se
    // empareja con la actual (que los tiene en claro).
    return [a.type, redactSecretsInText(String(c.url ?? '')), c.connection_id ?? '', c.action_key ?? ''].map((x) => String(x)).join('|');
}

function flatten(actions: unknown, out: ActionLike[] = []): ActionLike[] {
    if (!Array.isArray(actions)) return out;
    for (const a of actions) {
        if (!isPlain(a)) continue;
        out.push(a);
        const c = isPlain(a.config) ? a.config : {};
        flatten(c.then_actions, out);
        flatten(c.else_actions, out);
        flatten(c.actions, out);
    }
    return out;
}

/**
 * Restaura los secretos de una versión antes de guardarla: cada acción con
 * marcas toma los secretos de la acción ACTUAL con su misma identidad (tipo +
 * URL/conexión), y el disparador, los del disparador actual.
 */
export function restoreRedactedSecrets(
    incoming: { actions?: unknown; trigger_config?: unknown },
    current: { actions: unknown; triggerConfig: unknown },
): { actions?: unknown; trigger_config?: unknown } {
    const out: { actions?: unknown; trigger_config?: unknown } = { ...incoming };
    if (incoming.trigger_config !== undefined && hasRedactedSecrets(incoming.trigger_config)) {
        out.trigger_config = fillFrom(incoming.trigger_config, current.triggerConfig);
    }
    if (incoming.actions !== undefined && hasRedactedSecrets(incoming.actions)) {
        const pool = flatten(current.actions);
        const used = new Set<ActionLike>();
        const walk = (list: unknown): unknown => {
            if (!Array.isArray(list)) return list;
            return list.map((a) => {
                if (!isPlain(a)) return a;
                const cfg = isPlain(a.config) ? { ...a.config } : {};
                for (const k of ['then_actions', 'else_actions', 'actions']) if (Array.isArray(cfg[k])) cfg[k] = walk(cfg[k]);
                let next: Record<string, unknown> = { ...a, config: cfg };
                const own = { ...cfg, then_actions: undefined, else_actions: undefined, actions: undefined };
                if (hasRedactedSecrets(own)) {
                    const twin = pool.find((p) => !used.has(p) && signature(p) === signature(a));
                    if (twin) used.add(twin);
                    next = { ...next, config: { ...(fillFrom(own, twin?.config) as Record<string, unknown>), ...pick(cfg, ['then_actions', 'else_actions', 'actions']) } };
                }
                return next;
            });
        };
        out.actions = walk(incoming.actions);
    }
    return out;
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
    return out;
}
