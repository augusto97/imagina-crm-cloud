import { z } from 'zod';

/**
 * v0.1.363 — Aprobación del administrador de Microsoft 365.
 *
 * Muchas empresas con Microsoft 365 no dejan que sus empleados aprueben apps
 * de terceros (y menos si el publicador no está verificado): al conectar
 * Outlook o Teams, Microsoft muestra «Se necesita la aprobación del
 * administrador» y la persona queda trabada. La salida es que un
 * administrador de ESA organización apruebe la app una vez para todos.
 *
 * La app arma ese enlace (`/v2.0/adminconsent`) con los permisos EXACTOS de
 * la integración, para que quien conecta se lo mande a su administrador de
 * TI. Al aprobar, Microsoft vuelve a nuestra URI de redirección de siempre
 * (la única registrada) con `admin_consent=True`; el `state` empieza con
 * `ac_` para distinguir esa vuelta —que llega en el navegador del
 * administrador, sin sesión en la app— de la de una conexión normal.
 */

export const MS_ADMIN_CONSENT_STATE_PREFIX = 'ac_';
/** Días que sirve un enlace: el administrador puede tardar en verlo. */
export const MS_ADMIN_CONSENT_TTL_DAYS = 14;

const OIDC_SCOPES = new Set(['openid', 'email', 'profile', 'offline_access']);

/**
 * Los permisos para el endpoint de aprobación: los de OpenID quedan como son
 * y los de Microsoft Graph van con su recurso completo
 * (`https://graph.microsoft.com/Mail.Send`), como pide ese endpoint.
 */
export function msAdminConsentScopes(scopes: string): string {
    const out: string[] = [];
    for (const raw of scopes.split(/[\s,]+/)) {
        const s = raw.trim();
        if (!s) continue;
        const scope = OIDC_SCOPES.has(s.toLowerCase()) || s.includes('://') ? s : `https://graph.microsoft.com/${s}`;
        if (!out.includes(scope)) out.push(scope);
    }
    return out.join(' ');
}

export function buildMsAdminConsentUrl(p: { clientId: string; scopes: string; redirectUri: string; state: string; tenant?: string }): string {
    // `organizations`: sólo cuentas de trabajo o estudiantiles (las personales
    // no tienen administrador); Microsoft deduce la organización al iniciar sesión.
    // (shared no tiene los tipos de `URL`: la consulta se arma a mano, igual que URLSearchParams.)
    const query = [
        ['client_id', p.clientId],
        ['scope', msAdminConsentScopes(p.scopes)],
        ['redirect_uri', p.redirectUri],
        ['state', p.state],
    ]
        .map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`)
        .join('&');
    return `https://login.microsoftonline.com/${encodeURIComponent(p.tenant ?? 'organizations')}/v2.0/adminconsent?${query}`;
}

/** Qué permite cada permiso, en palabras (para que el administrador sepa qué aprueba). */
const SCOPE_LABELS: Record<string, string> = {
    openid: 'Iniciar sesión con la cuenta de Microsoft',
    email: 'Iniciar sesión con la cuenta de Microsoft',
    profile: 'Iniciar sesión con la cuenta de Microsoft',
    'user.read': 'Ver el nombre y el correo de quien conecta',
    offline_access: 'Seguir conectada sin volver a pedir permiso',
    'mail.send': 'Enviar correos en nombre de quien conecta',
    'calendars.readwrite': 'Ver y crear eventos en su calendario',
    'calendars.read': 'Ver los eventos de su calendario',
    'team.readbasic.all': 'Ver los equipos de Teams de quien conecta',
    'channel.readbasic.all': 'Ver los canales de esos equipos',
    'channelmessage.send': 'Publicar mensajes en canales de Teams',
    'chat.create': 'Crear chats de Teams',
    'chatmessage.send': 'Enviar mensajes en chats de Teams',
};

export function msScopeLabels(scopes: string): string[] {
    const out: string[] = [];
    for (const raw of scopes.split(/[\s,]+/)) {
        const s = raw.trim().replace(/^https:\/\/graph\.microsoft\.com\//i, '');
        if (!s) continue;
        const label = SCOPE_LABELS[s.toLowerCase()] ?? s;
        if (!out.includes(label)) out.push(label);
    }
    return out;
}

/**
 * ¿La vuelta con error de una conexión de Microsoft puede ser la pantalla de
 * «Se necesita la aprobación del administrador»? Microsoft no lo dice con un
 * código propio cuando la persona vuelve «sin dar el consentimiento»
 * (`access_denied`), así que se ofrece la salida ante cualquier rechazo de
 * permisos.
 */
export function isMsConsentError(text: string): boolean {
    return /access_denied|consent_required|interaction_required|AADSTS(65001|65004|90094|90095|90008)|aprobaci[oó]n del administrador|admin(istrator)? (approval|consent)/i.test(text);
}

export const msAdminConsentStatusSchema = z.object({
    integration: z.string(),
    /** El enlace vigente para mandar al administrador (null = todavía no se creó o venció). */
    url: z.string().nullable(),
    requested_at: z.string().nullable(),
    requested_by_name: z.string().nullable(),
    expires_at: z.string().nullable(),
    /** Cuándo un administrador aprobó (Microsoft volvió con `admin_consent=True`). */
    approved_at: z.string().nullable(),
    /** El motivo con el que Microsoft no aceptó la última aprobación. */
    error: z.string().nullable(),
    /** Lo que se aprueba, en palabras. */
    permissions: z.array(z.string()),
});
export type MsAdminConsentStatus = z.infer<typeof msAdminConsentStatusSchema>;
