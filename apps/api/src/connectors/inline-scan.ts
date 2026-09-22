import type { ConnectorAuthType, ConnectorPair } from '@imagina-base/shared';

/**
 * Detección de credenciales escritas DENTRO de una acción `call_webhook`
 * (v0.1.196).
 *
 * Es la deuda que el conector viene a saldar: hasta acá el token y el secreto
 * de firma se tipeaban en el editor de automatizaciones y quedaban en claro en
 * el jsonb. Este módulo las encuentra para poder moverlas a una conexión
 * cifrada sin que el usuario tenga que acordarse de cuáles eran.
 *
 * PURO: no toca la base. El servicio lo usa tanto para el listado de
 * candidatos como para aplicar la conversión, y eso garantiza que lo que se
 * muestra y lo que se convierte sean exactamente lo mismo.
 */

/** Cabeceras que son una credencial por definición. */
const CREDENTIAL_HEADERS = new Set([
    'authorization',
    'x-api-key',
    'api-key',
    'apikey',
    'x-auth-token',
    'x-access-token',
    'x-token',
    'x-secret',
    'private-token',
    'token',
]);

/** Nombres que delatan una credencial en cabecera, query o cuerpo. */
const CREDENTIAL_NAME = /(^|[-_])(key|token|secret|auth|password|passwd|pwd)([-_]|$)/i;

/** Un valor con merge tags no es una credencial fija: sale del registro. */
function looksLikeSecretValue(value: string): boolean {
    return value.trim().length >= 8 && !value.includes('{{');
}

function isCredentialName(name: string): boolean {
    const n = name.trim().toLowerCase();
    return CREDENTIAL_HEADERS.has(n) || CREDENTIAL_NAME.test(n);
}

export type InlineFinding = 'auth_header' | 'auth_query' | 'signing_secret' | 'auth_body';

export interface DetectedCredential {
    authType: ConnectorAuthType;
    authKey: string;
    token: string;
    username: string;
    password: string;
    signingSecret: string;
    found: InlineFinding[];
    /** Dónde estaba, para poder sacarlo al convertir. */
    removeHeader: string | null;
    removeQuery: string | null;
    removeBody: string | null;
}

/** Acepta filas `[{key,value}]` o el objeto plano heredado. */
export function readConfigPairs(raw: unknown): ConnectorPair[] {
    if (Array.isArray(raw)) {
        return raw
            .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
            .map((r) => ({ key: String(r.key ?? '').trim(), value: String(r.value ?? '') }))
            .filter((r) => r.key !== '');
    }
    if (raw !== null && typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>)
            .map(([key, value]) => ({ key: key.trim(), value: String(value ?? '') }))
            .filter((r) => r.key !== '');
    }
    return [];
}

/**
 * Busca la credencial de una acción. Devuelve `null` si no hay nada que
 * mover: una acción que sólo pega a un webhook abierto no necesita conexión.
 */
export function detectInlineCredential(cfg: Record<string, unknown>): DetectedCredential | null {
    const out: DetectedCredential = {
        authType: 'none',
        authKey: '',
        token: '',
        username: '',
        password: '',
        signingSecret: '',
        found: [],
        removeHeader: null,
        removeQuery: null,
        removeBody: null,
    };

    for (const h of readConfigPairs(cfg.headers)) {
        const name = h.key.trim().toLowerCase();
        if (!isCredentialName(name) || !looksLikeSecretValue(h.value)) continue;
        if (name === 'authorization') {
            const value = h.value.trim();
            const bearer = /^Bearer\s+(.+)$/i.exec(value);
            const basic = /^Basic\s+(.+)$/i.exec(value);
            if (bearer?.[1]) {
                out.authType = 'bearer';
                out.token = bearer[1].trim();
            } else if (basic?.[1]) {
                const decoded = Buffer.from(basic[1].trim(), 'base64').toString('utf8');
                const sep = decoded.indexOf(':');
                // Un base64 que no decodifica a `usuario:clave` no es Basic
                // real: se conserva como cabecera cruda en vez de inventar un
                // usuario vacío que rompería la petición.
                if (sep > 0) {
                    out.authType = 'basic';
                    out.username = decoded.slice(0, sep);
                    out.password = decoded.slice(sep + 1);
                } else {
                    out.authType = 'header';
                    out.authKey = 'authorization';
                    out.token = value;
                }
            } else {
                out.authType = 'header';
                out.authKey = 'authorization';
                out.token = value;
            }
        } else {
            out.authType = 'header';
            out.authKey = h.key.trim();
            out.token = h.value.trim();
        }
        out.found.push('auth_header');
        out.removeHeader = h.key;
        break;
    }

    if (out.authType === 'none') {
        for (const q of readConfigPairs(cfg.query_params)) {
            if (!isCredentialName(q.key) || !looksLikeSecretValue(q.value)) continue;
            out.authType = 'query';
            out.authKey = q.key.trim();
            out.token = q.value.trim();
            out.found.push('auth_query');
            out.removeQuery = q.key;
            break;
        }
    }

    if (out.authType === 'none') {
        for (const b of readConfigPairs(cfg.body_params)) {
            if (!isCredentialName(b.key) || !looksLikeSecretValue(b.value)) continue;
            out.authType = 'body';
            out.authKey = b.key.trim();
            out.token = b.value.trim();
            out.found.push('auth_body');
            out.removeBody = b.key;
            break;
        }
    }

    const secret = typeof cfg.secret === 'string' ? cfg.secret.trim() : '';
    if (secret !== '') {
        out.signingSecret = secret;
        out.found.push('signing_secret');
    }

    return out.found.length > 0 ? out : null;
}

/**
 * Huella de la credencial: dos acciones al mismo host con credenciales
 * distintas NO son la misma conexión, y fusionarlas rompería una de las dos.
 */
export function credentialFingerprint(d: DetectedCredential): string {
    return [d.authType, d.authKey.toLowerCase(), d.token, d.username, d.password, d.signingSecret].join('\u0000');
}

/** Host de la URL de la acción; `null` si no se puede saber (merge tags). */
export function hostOf(rawUrl: unknown): string | null {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (url === '' || url.includes('{{')) return null;
    try {
        return new URL(url).host || null;
    } catch {
        return null;
    }
}

/** Origen (`https://host`) para proponerlo como base de la conexión. */
export function originOf(rawUrl: unknown): string {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    try {
        return new URL(url).origin;
    } catch {
        return '';
    }
}

/**
 * Saca de la acción lo que pasó a vivir en la conexión y la deja apuntando a
 * ella. La URL se conserva ABSOLUTA a propósito: la conexión aporta
 * credenciales, y reescribir la URL a un path relativo sería cambiar el
 * destino de una automatización que hoy funciona.
 */
export function rewriteActionConfig(
    cfg: Record<string, unknown>,
    connectionId: number,
    detected: DetectedCredential,
): Record<string, unknown> {
    const next: Record<string, unknown> = { ...cfg, connection_id: connectionId };
    delete next.secret;
    if (detected.removeHeader !== null) {
        next.headers = readConfigPairs(cfg.headers).filter(
            (h) => h.key.toLowerCase() !== detected.removeHeader!.toLowerCase(),
        );
    }
    if (detected.removeQuery !== null) {
        next.query_params = readConfigPairs(cfg.query_params).filter(
            (q) => q.key.toLowerCase() !== detected.removeQuery!.toLowerCase(),
        );
    }
    if (detected.removeBody !== null) {
        next.body_params = readConfigPairs(cfg.body_params).filter(
            (b) => b.key.toLowerCase() !== detected.removeBody!.toLowerCase(),
        );
    }
    return next;
}

/** Recorre las acciones incluyendo las ramas de `if_else` (then/else). */
export function walkActions(
    actions: unknown,
    visit: (action: Record<string, unknown>) => void,
): void {
    if (!Array.isArray(actions)) return;
    for (const raw of actions) {
        if (raw === null || typeof raw !== 'object') continue;
        const action = raw as Record<string, unknown>;
        visit(action);
        const cfg = action.config;
        if (cfg !== null && typeof cfg === 'object') {
            const c = cfg as Record<string, unknown>;
            walkActions(c.then_actions, visit);
            walkActions(c.else_actions, visit);
        }
    }
}
