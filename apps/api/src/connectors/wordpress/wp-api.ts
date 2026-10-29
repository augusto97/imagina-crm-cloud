import { devPrivateEgressAllowed } from '../../common/safe-fetch';
import type { IntegrationCreds } from '../integration-calls';
import { IntegrationInputError } from '../integration-errors';

/**
 * WordPress (v0.1.333, ADR-S83) — cómo se le habla a la API REST de un sitio.
 *
 * PURO, como `wc-api.ts`: la verificación al conectar, el descubrimiento, el
 * motor de sincronización y el envío de lo editado arman las URLs, las
 * cabeceras y los mensajes de error con estas mismas funciones.
 *
 * Detalles de hosting que la persona NUNCA tiene que saber, y que por eso se
 * descubren al conectar y quedan en los campos ocultos de la conexión:
 *  - **api_style**: sin enlaces permanentes, `/wp-json/…` no existe y la API
 *    se alcanza por `?rest_route=/…` (el núcleo lo acepta siempre).
 *  - La contraseña de aplicación viaja por `Authorization: Basic`. Hay
 *    hostings (PHP por CGI/FastCGI) que BORRAN esa cabecera antes de que llegue
 *    a WordPress: el sitio responde como si nadie se hubiera identificado. No
 *    hay un rodeo del lado de la app (WordPress sólo acepta la contraseña de
 *    aplicación por esa cabecera): se explica cómo arreglarlo en el hosting.
 */

export type WpApiStyle = 'pretty' | 'plain';

/** Identifica a la app en la pantalla «Autorizar aplicación» de WordPress (un UUID v4 fijo). */
export const IMAGINA_WP_APP_ID = '6f1c8a2e-4b7d-4c3e-9a5f-2d8b1e0c7a94';

/** La dirección del sitio, normalizada. Tira un error para la persona si no sirve. */
export function wpSiteUrl(raw: string): string {
    let text = (raw ?? '').trim();
    if (text === '') throw new IntegrationInputError('Falta la dirección del sitio.');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        throw new IntegrationInputError(`«${raw}» no es una dirección válida.`);
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && devPrivateEgressAllowed())) {
        // Sin HTTPS WordPress apaga las contraseñas de aplicación (y la
        // contraseña viajaría en claro): no es una limitación nuestra.
        throw new IntegrationInputError(
            'El sitio tiene que usar HTTPS (la dirección empieza con https://). WordPress no permite contraseñas de aplicación sin conexión segura.',
        );
    }
    // Se conserva el subdirectorio (sitios en example.com/blog) y se descarta
    // lo que sobre: query, hash, un `/wp-admin` o `/wp-json` pegado por error.
    const path = url.pathname.replace(/\/(wp-admin|wp-json|wp-login\.php)(\/.*)?$/i, '').replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}`;
}

function styleOf(creds: IntegrationCreds): WpApiStyle {
    return creds.fields.api_style === 'plain' ? 'plain' : 'pretty';
}

function qs(query: Array<[string, string]>): string {
    return query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** URL de una ruta de la API (`/wp/v2/posts`). Los valores de `query` se codifican; las claves son nuestras. */
export function wpRestUrl(base: string, style: WpApiStyle, route: string, query: Array<[string, string]> = []): string {
    const q = qs(query);
    if (style === 'plain') return `${base}/?rest_route=${route}${q ? `&${q}` : ''}`;
    return `${base}/wp-json${route}${q ? `?${q}` : ''}`;
}

export function wpUrl(creds: IntegrationCreds, route: string, query: Array<[string, string]> = []): string {
    return wpRestUrl(wpSiteUrl(creds.fields.site_url ?? ''), styleOf(creds), route, query);
}

export function wpHeaders(creds: IntegrationCreds, json = false): Record<string, string> {
    const out: Record<string, string> = { accept: 'application/json' };
    if (json) out['content-type'] = 'application/json; charset=utf-8';
    const pair = `${creds.fields.user_login ?? ''}:${creds.secret}`;
    out.authorization = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
    return out;
}

/** Lo que se lee del índice de la API (`/wp-json/`). */
export interface WpIndex {
    name: string | null;
    home: string | null;
    namespaces: string[];
    /** La pantalla «Autorizar aplicación» (null = contraseñas de aplicación apagadas). */
    authorizeUrl: string | null;
}

function parseJson(body: string): unknown {
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return undefined;
    }
}

function obj(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function stripTags(text: string): string {
    return decodeEntities(text.replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
}

/** Las entidades que WordPress deja en títulos y nombres «renderizados». */
export function decodeEntities(text: string): string {
    return text
        .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&apos;/g, "'");
}

export function parseWpIndex(body: string): WpIndex | null {
    const json = obj(parseJson(body));
    if (!json || !Array.isArray(json.namespaces)) return null;
    const auth = obj(obj(obj(json.authentication)?.['application-passwords'])?.endpoints);
    // Sólo una dirección web: es adonde mandamos el navegador de la persona.
    const authorize = typeof auth?.authorization === 'string' && /^https?:\/\//i.test(auth.authorization) ? auth.authorization : null;
    return {
        name: typeof json.name === 'string' && json.name.trim() !== '' ? stripTags(json.name).slice(0, 80) : null,
        home: typeof json.home === 'string' ? json.home : null,
        namespaces: json.namespaces.filter((n): n is string => typeof n === 'string'),
        authorizeUrl: authorize,
    };
}

/** El índice se pide con lo justo: el de un sitio real lista TODAS las rutas (más de 1 MB). */
export const WP_INDEX_FIELDS = 'name,home,namespaces,authentication';

/**
 * La pantalla «Autorizar aplicación» de WordPress con nuestros datos. WordPress
 * vuelve a `success_url` agregando `site_url`, `user_login` y `password`, o a
 * `reject_url` con `success=false`.
 */
export function wpAuthorizeUrl(
    endpoint: string,
    input: { appName: string; appId: string; successUrl: string; rejectUrl: string },
): string {
    const url = new URL(endpoint);
    url.searchParams.set('app_name', input.appName);
    url.searchParams.set('app_id', input.appId);
    url.searchParams.set('success_url', input.successUrl);
    url.searchParams.set('reject_url', input.rejectUrl);
    return url.toString();
}

/** «Editar en WordPress» de una entrada o de un término. */
export function wpEditLink(site: string, kind: 'post_type' | 'taxonomy', object: string, id: number | string): string {
    const base = site.replace(/\/+$/, '');
    if (kind === 'taxonomy') return `${base}/wp-admin/term.php?taxonomy=${encodeURIComponent(object)}&tag_ID=${id}`;
    return `${base}/wp-admin/post.php?post=${id}&action=edit`;
}

/** «Crear en WordPress» (la app no crea entradas: se hace allá). */
export function wpNewLink(site: string, kind: 'post_type' | 'taxonomy', object: string): string {
    const base = site.replace(/\/+$/, '');
    if (kind === 'taxonomy') return `${base}/wp-admin/edit-tags.php?taxonomy=${encodeURIComponent(object)}`;
    return object === 'post' ? `${base}/wp-admin/post-new.php` : `${base}/wp-admin/post-new.php?post_type=${encodeURIComponent(object)}`;
}

// --- Errores -----------------------------------------------------------

export type WpErrorKind = 'auth' | 'not_seen' | 'forbidden' | 'gone' | 'no_route' | 'invalid' | 'blocked' | 'server' | 'other';

export interface WpProblem {
    kind: WpErrorKind;
    code: string;
    message: string;
}

const AUTH_CODES = new Set(['incorrect_password', 'invalid_username', 'invalid_email', 'application_password_revoked', 'rest_application_password_not_found']);
const FORBIDDEN_CODES = /^rest_(forbidden|cannot_|forbidden_context|user_cannot)/;

/**
 * Cuándo se habla con el sitio: al conectar (la contraseña se acaba de pegar o
 * de crear) o al sincronizar (ya funcionó antes). Cambia la causa más probable
 * de un «no te conozco».
 */
export type WpPhase = 'connect' | 'sync';

/**
 * Mandamos usuario y contraseña pero WordPress respondió como a un visitante
 * anónimo. Lo dice de varias formas, según el pedido: «no estás conectado»
 * (401), un 401 de permisos (el código de permiso para un visitante es 401;
 * para un usuario conectado sin permiso, 403) o, en un listado con
 * `status=any`, un 400 «el estado está prohibido» (sólo un visitante no puede
 * pedir borradores). Probado contra un WordPress real: con la contraseña de
 * aplicación revocada, WordPress NO devuelve `incorrect_password` — trata el
 * pedido como anónimo.
 */
function answeredAsAnonymous(status: number, code: string, o: Record<string, unknown> | null): boolean {
    if (status === 401 && !AUTH_CODES.has(code)) return true;
    if (status === 400 && code === 'rest_invalid_param') {
        const inner = obj(obj(obj(o?.data)?.details)?.status);
        return inner?.code === 'rest_forbidden_status';
    }
    return false;
}

const NOT_SEEN_MESSAGE: Record<WpPhase, string> = {
    connect:
        'WordPress no reconoció el usuario y la contraseña de aplicación. Revisa que estén bien copiados. Si lo están, el hosting está borrando la cabecera «Authorization» antes de que llegue al sitio (pasa con PHP por CGI/FastCGI): pídele al hosting que la deje pasar, o agrega al .htaccess la línea «SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1».',
    sync: 'WordPress ya no acepta la contraseña de aplicación de esta conexión: la revocaron desde el perfil del usuario, o el usuario ya no existe. Vuelve a conectar el sitio en Ajustes → Integraciones (las listas siguen igual).',
};

/**
 * El motivo de un error de WordPress, en lenguaje claro, o `null` si salió
 * bien. `sentCredentials` = el pedido llevaba usuario y contraseña: si el
 * sitio responde como a un visitante anónimo, la contraseña no llegó o ya no
 * vale (ver `answeredAsAnonymous`).
 */
export function classifyWpResponse(status: number, body: string, sentCredentials = true, phase: WpPhase = 'connect'): WpProblem | null {
    const json = parseJson(body);
    const o = obj(json);
    const code = typeof o?.code === 'string' ? o.code : '';
    const raw = typeof o?.message === 'string' ? stripTags(o.message) : '';
    const detail = raw ? ` («${raw.replace(/[.\s]+$/, '')}»)` : '';
    if (status >= 200 && status < 300) {
        if (json === undefined && body.trim() !== '') {
            return {
                kind: 'blocked',
                code: 'not_json',
                message:
                    'El sitio respondió una página web en vez de la API. Puede ser un modo mantenimiento, un plugin de seguridad que bloquea la API REST o una dirección que no es la del WordPress.',
            };
        }
        return null;
    }
    if (AUTH_CODES.has(code)) {
        return {
            kind: 'auth',
            code,
            message: `WordPress rechazó el usuario o la contraseña de aplicación${detail}. Si la revocaron desde el perfil del usuario, vuelve a conectar el sitio en Ajustes → Integraciones.`,
        };
    }
    if (sentCredentials && json !== undefined && answeredAsAnonymous(status, code, o)) {
        return { kind: 'not_seen', code: code || 'not_logged_in', message: NOT_SEEN_MESSAGE[phase] };
    }
    if (FORBIDDEN_CODES.test(code) || status === 403) {
        if (json === undefined) {
            return {
                kind: 'blocked',
                code: 'forbidden_html',
                message: `El sitio bloqueó el pedido (respondió ${status} con una página, no con la API): suele ser un firewall o un plugin de seguridad (Wordfence, iThemes, Cloudflare…). Permite la API REST para este usuario.`,
            };
        }
        return {
            kind: 'forbidden',
            code,
            message: `El usuario conectado no tiene permiso para eso en WordPress${detail}. Conecta un usuario Editor o Administrador.`,
        };
    }
    if (code === 'rest_no_route' || (status === 404 && json === undefined)) {
        return {
            kind: 'no_route',
            code: code || 'no_route',
            message: 'Esa parte de la API no existe en el sitio: puede que el tipo de contenido o el plugin que lo crea se haya desactivado.',
        };
    }
    if (status === 404 || code === 'rest_post_invalid_id' || code === 'rest_term_invalid') {
        return { kind: 'gone', code: code || 'not_found', message: 'Ya no existe en WordPress (se borró).' };
    }
    if (status === 400) {
        const params = obj(obj(o?.data)?.params);
        const extra = params ? Object.values(params).filter((v): v is string => typeof v === 'string').map((v) => stripTags(v).replace(/[.\s]+$/, '')) : [];
        return {
            kind: 'invalid',
            code,
            message: `WordPress no aceptó el cambio${detail}${extra.length ? `: ${extra.join(' ')}` : ''}.`,
        };
    }
    if (status === 429 || status >= 500) {
        return { kind: 'server', code: code || `http_${status}`, message: `El sitio respondió ${status}${detail}. Puede ser pasajero: se vuelve a intentar.` };
    }
    return { kind: 'other', code, message: `WordPress respondió ${status}${detail}.` };
}

/** Lo que dice `users/me?context=edit` del usuario conectado. */
export interface WpUser {
    id: number;
    login: string;
    name: string;
    roles: string[];
    canEdit: boolean;
    canManageTerms: boolean;
}

export function parseWpUser(body: string): WpUser | null {
    const o = obj(parseJson(body));
    if (!o || !(Number(o.id) > 0)) return null;
    const caps = obj(o.capabilities) ?? {};
    const roles = Array.isArray(o.roles) ? o.roles.filter((r): r is string => typeof r === 'string') : [];
    return {
        id: Number(o.id),
        login: typeof o.username === 'string' ? o.username : typeof o.slug === 'string' ? o.slug : '',
        name: typeof o.name === 'string' ? stripTags(o.name) : '',
        roles,
        canEdit: caps.edit_posts === true || caps.edit_pages === true,
        canManageTerms: caps.manage_categories === true,
    };
}

/** Rol de WordPress en palabras («Suscriptor», «Editor»). */
export function wpRoleLabel(roles: string[]): string {
    const labels: Record<string, string> = {
        administrator: 'Administrador',
        editor: 'Editor',
        author: 'Autor',
        contributor: 'Colaborador',
        subscriber: 'Suscriptor',
        customer: 'Cliente',
        shop_manager: 'Gestor de la tienda',
    };
    return roles.map((r) => labels[r] ?? r).join(', ') || 'sin rol';
}
