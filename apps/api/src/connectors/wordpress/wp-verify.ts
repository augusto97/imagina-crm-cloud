import { safeWebhookFetch } from '../../common/safe-fetch';
import { redactValues } from '../connection-parts';
import type { IntegrationCreds, VerifyOutcome } from '../integration-calls';
import { IntegrationInputError } from '../integration-errors';
import {
    classifyWpResponse,
    parseWpIndex,
    parseWpUser,
    WP_INDEX_FIELDS,
    wpRestUrl,
    wpRoleLabel,
    wpSiteUrl,
    type WpApiStyle,
    type WpIndex,
    type WpUser,
} from './wp-api';

/**
 * Conectar un sitio WordPress (v0.1.333, ADR-S83): encontrar su API, ver que
 * las contraseñas de aplicación estén encendidas y probar la que se pegó o la
 * que devolvió la pantalla «Autorizar aplicación». Un sitio que no responde NO
 * se guarda (igual que una tienda): casi siempre es la dirección mal escrita,
 * y nada de lo que viene después funciona sin llegar.
 */

export interface WpSite {
    /** Dirección normalizada (la que se guarda en la conexión). */
    base: string;
    style: WpApiStyle;
    index: WpIndex;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Busca la API del sitio: primero con enlaces permanentes (`/wp-json/`) y, si
 * no, el respaldo del núcleo (`?rest_route=/`). Sigue UNA redirección de la
 * raíz (http→https, sin www→con www) porque es lo que pasa cuando la persona
 * escribe la dirección «corta».
 */
export async function discoverWpSite(raw: string): Promise<WpSite> {
    let base = wpSiteUrl(raw);
    let lastProblem: string | null = null;
    let reached = false;
    for (let round = 0; round < 2; round++) {
        let redirected: string | null = null;
        for (const style of ['pretty', 'plain'] as const) {
            const url = wpRestUrl(base, style, '/', [['_fields', WP_INDEX_FIELDS]]);
            let res;
            try {
                res = await safeWebhookFetch(url, {
                    method: 'GET',
                    headers: { accept: 'application/json' },
                    captureBody: true,
                    maxCaptureBytes: 512 * 1024,
                    timeoutMs: 12_000,
                });
            } catch (err) {
                lastProblem = err instanceof Error ? err.message : String(err);
                // Sin red hasta el sitio, la otra forma tampoco va a llegar.
                break;
            }
            reached = true;
            if (REDIRECTS.has(res.status) && res.headers?.location) {
                const target = rebase(res.headers.location, url, style);
                if (target && target !== base) {
                    redirected = target;
                    break;
                }
            }
            if (res.status === 200) {
                const index = parseWpIndex(res.body ?? '');
                if (index) return { base, style, index };
            }
        }
        if (!redirected) break;
        base = wpSiteUrl(redirected);
    }
    if (!reached) {
        throw new IntegrationInputError(`No pudimos llegar al sitio (${lastProblem ?? 'sin respuesta'}). Revisa la dirección.`);
    }
    throw new IntegrationInputError(
        'No encontramos la API de WordPress en esa dirección. Revisa que sea la del sitio y que la API REST no esté desactivada (algunos plugins de seguridad la bloquean).',
    );
}

/** La base del sitio a partir de una redirección de la raíz de la API. */
function rebase(location: string, from: string, style: WpApiStyle): string | null {
    try {
        const to = new URL(location, from);
        let path = to.pathname;
        if (style === 'pretty') {
            const at = path.indexOf('/wp-json');
            if (at >= 0) path = path.slice(0, at);
        }
        return `${to.protocol}//${to.host}${path.replace(/\/+$/, '')}`;
    } catch {
        return null;
    }
}

/** Qué le falta al sitio para que la app se conecte (o null si está listo). */
export function wpSiteProblem(site: WpSite): string | null {
    if (!site.index.namespaces.includes('wp/v2')) {
        return 'El sitio tiene la API REST de WordPress recortada (falta «wp/v2»): suele ser un plugin de seguridad. Habilítala para poder conectarlo.';
    }
    if (!site.index.authorizeUrl) return appPasswordsOffMessage(site.index.namespaces);
    return null;
}

/**
 * Las contraseñas de aplicación están apagadas en el sitio. Wordfence las
 * apaga POR DEFECTO al instalarse (probado: opción «Disable WordPress
 * application passwords» encendida), así que si el sitio lo tiene se dice
 * exactamente dónde está la opción. Se reconoce por su ruta en la API REST
 * (`wordfence/v1`), sin pedir nada más.
 */
export function appPasswordsOffMessage(namespaces: string[]): string {
    if (namespaces.some((n) => n.startsWith('wordfence/'))) {
        return 'Wordfence tiene apagadas las contraseñas de aplicación de WordPress (lo hace solo al instalarse), y la app se conecta con ellas. En WordPress ve a Wordfence → Login Security → Settings (Configuración), desmarca «Disable WordPress application passwords» («Desactivar las contraseñas de aplicación de WordPress») y guarda. Lo demás de Wordfence sigue funcionando igual.';
    }
    return 'Las contraseñas de aplicación están desactivadas en el sitio. WordPress las apaga si el sitio no usa HTTPS, y algunos plugins de seguridad también (Wordfence, Solid Security, All In One WP Security…: busca la opción «Application Passwords» o «Contraseñas de aplicación»). Actívalas para poder conectarlo.';
}

/**
 * Una conexión que andaba y de pronto WordPress responde como a un visitante:
 * ¿se apagaron las contraseñas de aplicación (por ejemplo, instalaron
 * Wordfence) o revocaron la de esta conexión? Se mira el índice de la API
 * (sin credenciales) y, si están apagadas, se dice cómo prenderlas: volver a
 * conectar no lo arreglaría. `null` = siguen encendidas (la revocaron).
 */
export async function explainLostAccess(siteUrl: string): Promise<string | null> {
    try {
        const site = await discoverWpSite(siteUrl);
        return site.index.authorizeUrl ? null : `${appPasswordsOffMessage(site.index.namespaces)} Después, si sigue sin andar, vuelve a conectar el sitio en Ajustes → Integraciones (las listas siguen igual).`;
    } catch {
        return null;
    }
}

/** Prueba usuario + contraseña de aplicación contra `users/me`. */
export async function wpWhoAmI(site: WpSite, login: string, password: string): Promise<{ user: WpUser } | { error: string }> {
    const url = wpRestUrl(site.base, site.style, '/wp/v2/users/me', [['context', 'edit']]);
    const hide = [password];
    let res;
    try {
        res = await safeWebhookFetch(url, {
            method: 'GET',
            headers: {
                accept: 'application/json',
                authorization: `Basic ${Buffer.from(`${login}:${password}`, 'utf8').toString('base64')}`,
            },
            captureBody: true,
            timeoutMs: 12_000,
        });
    } catch (err) {
        return { error: `No pudimos comunicarnos con el sitio (${redactValues(err instanceof Error ? err.message : String(err), hide)}).` };
    }
    const problem = classifyWpResponse(res.status, res.body ?? '');
    if (problem) {
        if (problem.kind === 'not_seen' && !site.index.authorizeUrl) {
            return { error: wpSiteProblem(site) ?? problem.message };
        }
        return { error: problem.message };
    }
    const user = parseWpUser(res.body ?? '');
    if (!user) return { error: 'El sitio respondió algo que no es un usuario de WordPress.' };
    return { user };
}

/** «El usuario no puede editar» — sin eso no hay borradores ni edición. */
export function wpUserProblem(user: WpUser): string | null {
    if (user.canEdit) return null;
    return `El usuario «${user.login || user.name}» no tiene permiso para editar en WordPress (es «${wpRoleLabel(user.roles)}»). Conecta un usuario Editor o Administrador.`;
}

/**
 * La verificación al conectar (o al actualizar la contraseña): descubre cómo
 * habla el sitio, prueba el usuario y devuelve lo que se guarda en los campos
 * ocultos de la conexión.
 */
export async function verifyWordpress(creds: IntegrationCreds): Promise<VerifyOutcome> {
    const out: VerifyOutcome = { ok: false, label: null, error: null, warning: null, options: {} };
    const login = (creds.fields.user_login ?? '').trim();
    if (login === '') return { ...out, error: 'Falta el usuario de WordPress.' };
    let site: WpSite;
    try {
        site = await discoverWpSite(creds.fields.site_url ?? '');
    } catch (err) {
        return { ...out, error: err instanceof Error ? err.message : String(err) };
    }
    const problem = wpSiteProblem(site);
    if (problem) return { ...out, error: problem };
    const who = await wpWhoAmI(site, login, creds.secret);
    if ('error' in who) return { ...out, error: who.error };
    const cant = wpUserProblem(who.user);
    if (cant) return { ...out, error: cant };
    return {
        ok: true,
        label: site.index.name ?? new URL(site.base).host,
        error: null,
        warning: who.user.canManageTerms
            ? null
            : 'El usuario conectado no puede crear categorías ni etiquetas: podrá elegir las que ya existen, pero no crear nuevas.',
        options: {},
        fields: { site_url: site.base, user_login: who.user.login || login, api_style: site.style },
    };
}

/** Una llamada a las contraseñas de aplicación del usuario conectado; `null` si no salió bien. */
async function appPasswordCall(
    site: Pick<WpSite, 'base' | 'style'>,
    login: string,
    password: string,
    method: 'GET' | 'POST' | 'DELETE',
    route: string,
    body?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
    try {
        const res = await safeWebhookFetch(wpRestUrl(site.base, site.style, route), {
            method,
            headers: {
                accept: 'application/json',
                authorization: `Basic ${Buffer.from(`${login}:${password}`, 'utf8').toString('base64')}`,
                ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            captureBody: true,
            timeoutMs: 12_000,
        });
        if (res.status < 200 || res.status >= 300) return null;
        const json = JSON.parse(res.body ?? 'null') as unknown;
        return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
    } catch {
        return null;
    }
}

const APP_PASSWORDS = '/wp/v2/users/me/application-passwords';

/**
 * La contraseña que devuelve «Autorizar aplicación» llega en la URL de vuelta
 * (WordPress la pega como `?password=…`), así que puede quedar en el registro
 * de accesos de un proxy o de un firewall en el camino. Por eso no es la que
 * se guarda: con ella se crea OTRA (que viaja sólo en el cuerpo de una
 * respuesta HTTPS), se borra la de la URL y la nueva toma su nombre. Si el
 * sitio no deja rotarla (un plugin de seguridad), se sigue con la recibida:
 * conectar no puede depender de esto.
 */
export async function rotateWpAppPassword(
    site: Pick<WpSite, 'base' | 'style'>,
    login: string,
    received: string,
    appName: string,
    appId: string,
): Promise<{ password: string; rotated: boolean }> {
    const kept = { password: received, rotated: false };
    const current = await appPasswordCall(site, login, received, 'GET', `${APP_PASSWORDS}/introspect`);
    const oldUuid = typeof current?.uuid === 'string' ? current.uuid : '';
    if (oldUuid === '') return kept;
    // WordPress no deja dos contraseñas con el mismo nombre en un usuario: la
    // nueva nace con un nombre de paso y toma el definitivo al final.
    const created = await appPasswordCall(site, login, received, 'POST', APP_PASSWORDS, { name: `${appName} (nueva)`.slice(0, 120), app_id: appId });
    const fresh = typeof created?.password === 'string' ? created.password.replace(/\s+/g, '') : '';
    const newUuid = typeof created?.uuid === 'string' ? created.uuid : '';
    if (fresh === '' || newUuid === '') return kept;
    // Sin la vieja: la que pasó por la URL deja de valer.
    if ((await appPasswordCall(site, login, fresh, 'DELETE', `${APP_PASSWORDS}/${oldUuid}`)) === null) {
        // La nueva sí vale; la vieja queda en el perfil (se puede borrar a mano).
        return { password: fresh, rotated: false };
    }
    await appPasswordCall(site, login, fresh, 'POST', `${APP_PASSWORDS}/${newUuid}`, { name: appName });
    return { password: fresh, rotated: true };
}

/**
 * Al borrar la conexión, la app borra SU contraseña de aplicación del perfil en
 * WordPress (la que está usando, por `introspect`): una credencial que ya nadie
 * usa no tiene por qué seguir viva. Si el sitio no responde, se sigue igual (el
 * aviso de la confirmación dice que se puede borrar a mano).
 */
export async function revokeWpAppPassword(site: Pick<WpSite, 'base' | 'style'>, login: string, password: string): Promise<boolean> {
    const current = await appPasswordCall(site, login, password, 'GET', `${APP_PASSWORDS}/introspect`);
    const uuid = typeof current?.uuid === 'string' ? current.uuid : '';
    if (uuid === '') return false;
    return (await appPasswordCall(site, login, password, 'DELETE', `${APP_PASSWORDS}/${uuid}`)) !== null;
}
