import type { ConnectorAuthType, ConnectorPair } from '@imagina-base/shared';

/**
 * Resolución de una conexión a las PARTES de una petición HTTP (v0.1.196).
 *
 * PURO a propósito, igual que `buildWebhookRequest`: el motor, el probador de
 * la acción y el botón "Probar conexión" tienen que inyectar la credencial
 * exactamente igual. Si esto hiciera I/O, el probador y el motor podrían
 * divergir y volveríamos al problema que el conector viene a resolver.
 */

export interface ConnectionSecrets {
    token?: string;
    username?: string;
    password?: string;
    signing_secret?: string;
}

export interface ConnectionInput {
    baseUrl: string;
    authType: ConnectorAuthType;
    authKey: string;
    headers: ConnectorPair[];
    queryParams: ConnectorPair[];
}

export interface ConnectionParts {
    baseUrl: string;
    /** Cabeceras fijas + la de autenticación, en minúsculas. */
    headers: Record<string, string>;
    query: ConnectorPair[];
    /** Campos del cuerpo que aporta la conexión (auth de tipo `body`). */
    body: ConnectorPair[];
    /** Secreto de firma HMAC del cuerpo, si la conexión lo define. */
    signingSecret: string | null;
    /** Valores en claro que hay que tapar antes de mostrar una prueba. */
    redact: string[];
}

/** Cabeceras cuyo valor NUNCA se muestra tal cual al usuario. */
const SENSITIVE_HEADERS = new Set(['authorization', 'x-imagina-signature']);

export function connectionParts(conn: ConnectionInput, secrets: ConnectionSecrets): ConnectionParts {
    const headers: Record<string, string> = {};
    for (const h of conn.headers) {
        const key = h.key.trim().toLowerCase();
        if (key !== '') headers[key] = h.value;
    }
    const query: ConnectorPair[] = conn.queryParams
        .map((q) => ({ key: q.key.trim(), value: q.value }))
        .filter((q) => q.key !== '');
    const body: ConnectorPair[] = [];

    const token = secrets.token ?? '';
    switch (conn.authType) {
        case 'bearer':
            if (token !== '') headers['authorization'] = `Bearer ${token}`;
            break;
        case 'header': {
            // Sin nombre de cabecera no hay dónde poner el token: se omite en
            // vez de inventar uno, y la prueba de conexión lo deja en evidencia.
            const name = conn.authKey.trim().toLowerCase();
            if (name !== '' && token !== '') headers[name] = token;
            break;
        }
        case 'basic': {
            const user = secrets.username ?? '';
            const pass = secrets.password ?? '';
            if (user !== '' || pass !== '') {
                headers['authorization'] =
                    'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
            }
            break;
        }
        case 'query': {
            const name = conn.authKey.trim();
            if (name !== '' && token !== '') query.push({ key: name, value: token });
            break;
        }
        case 'body': {
            // Muchas APIs de mensajería piden la clave como un campo más del
            // formulario, no como cabecera. Sólo se puede inyectar cuando el
            // cuerpo se arma con filas clave/valor; con un cuerpo escrito a
            // mano manda lo escrito.
            const name = conn.authKey.trim();
            if (name !== '' && token !== '') body.push({ key: name, value: token });
            break;
        }
        case 'none':
        default:
            break;
    }

    const signing = secrets.signing_secret ?? '';
    const redact = [token, secrets.password ?? '', signing].filter((v) => v.length >= 4);
    return {
        baseUrl: conn.baseUrl.trim(),
        headers,
        query,
        body,
        signingSecret: signing !== '' ? signing : null,
        redact,
    };
}

/**
 * Tapa los secretos en claro dondequiera que hayan terminado (URL, cuerpo,
 * cabecera). Se aplica antes de devolver el resultado de una prueba: mostrar
 * lo que se envió es justamente lo que hace útil al probador, y sería absurdo
 * que eso volviera a filtrar la credencial que acabamos de sacar del jsonb.
 */
export function redactValues(text: string, secrets: readonly string[]): string {
    let out = text;
    for (const s of secrets) {
        if (s.length < 4) continue;
        out = out.split(s).join(maskSecret(s));
    }
    return out;
}

/**
 * Une la base de la conexión con lo que escribió la acción.
 *
 * Una URL absoluta gana siempre: la conexión aporta credenciales, no puede
 * redirigir a otro host una acción que dice explícitamente adónde va.
 */
export function joinUrl(base: string, path: string): string {
    const p = path.trim();
    if (/^https?:\/\//i.test(p)) return p;
    const b = base.trim();
    if (b === '') return p;
    if (p === '') return b;
    return b.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, '');
}

/** Enmascara los valores sensibles para poder MOSTRAR lo que se envió. */
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        out[key] = SENSITIVE_HEADERS.has(key) ? maskSecret(value) : value;
    }
    return out;
}

/**
 * Deja ver la FORMA del valor sin revelarlo: el esquema y los últimos cuatro.
 * Que se vea `Bearer ••••2f9a` es justo lo que hace falta para diagnosticar
 * "pegué la clave equivocada" sin volver a exponerla en pantalla.
 */
export function maskSecret(value: string): string {
    const space = value.indexOf(' ');
    const scheme = space > 0 ? value.slice(0, space + 1) : '';
    const rest = space > 0 ? value.slice(space + 1) : value;
    if (rest.length <= 4) return scheme + '••••';
    return scheme + '••••' + rest.slice(-4);
}

/** Últimos 4 caracteres, para reconocer un secreto guardado sin exponerlo. */
export function secretHint(value: string): string | null {
    if (value.length < 4) return value === '' ? null : '••••';
    return '••••' + value.slice(-4);
}
