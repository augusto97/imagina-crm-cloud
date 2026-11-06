import { z } from 'zod';

/**
 * v0.1.384 — Lo que en Google hace las veces de «la aprobación del
 * administrador» de Microsoft 365 (v0.1.363).
 *
 * En Google Workspace el administrador puede no dejar que la gente use apps de
 * terceros sin revisarlas. Google no tiene un enlace de aprobación como el de
 * Microsoft: muestra «Acceso bloqueado» / «Error 400: admin_policy_enforced»
 * en SU pantalla —sin volver a la app— y la salida es que el administrador
 * marque la app como «De confianza» en la consola de Google, buscándola por su
 * ID de cliente. Aquí está el mensaje listo para mandarle a TI.
 *
 * Y lo otro que pasa sólo con Google: en la pantalla de permisos cada uno es
 * una casilla, y se puede conectar destildando el que hace falta. La conexión
 * quedaría «conectada» pero sin poder crear el evento o mandar el correo, así
 * que se avisa al volver (`googleGrantMissing`).
 */

/** Qué permite cada permiso de Google, en palabras. */
export const GOOGLE_SCOPE_LABELS: Record<string, string> = {
    openid: 'Ver tu nombre y tu correo',
    email: 'Ver tu nombre y tu correo',
    profile: 'Ver tu nombre y tu correo',
    'https://www.googleapis.com/auth/userinfo.email': 'Ver tu nombre y tu correo',
    'https://www.googleapis.com/auth/userinfo.profile': 'Ver tu nombre y tu correo',
    'https://www.googleapis.com/auth/gmail.send': 'Enviar correos en tu nombre',
    'https://www.googleapis.com/auth/calendar.events': 'Ver y editar los eventos de tus calendarios',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly': 'Ver la lista de tus calendarios',
    'https://www.googleapis.com/auth/spreadsheets': 'Ver y editar tus hojas de cálculo de Google',
    'https://www.googleapis.com/auth/drive.file': 'Ver y editar los archivos de Google Drive que crea la app',
};

const IDENTITY = new Set(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile']);

function scopeList(scopes: string | readonly string[]): string[] {
    const raw = typeof scopes === 'string' ? scopes.split(/[\s,]+/) : [...scopes];
    return raw.map((s) => s.trim()).filter(Boolean);
}

/** Los permisos en palabras, sin repetir. */
export function googleScopeLabels(scopes: string | readonly string[]): string[] {
    const out: string[] = [];
    for (const s of scopeList(scopes)) {
        const label = GOOGLE_SCOPE_LABELS[s] ?? GOOGLE_SCOPE_LABELS[s.toLowerCase()] ?? s;
        if (!out.includes(label)) out.push(label);
    }
    return out;
}

/**
 * Los permisos pedidos que Google NO concedió (la persona destildó la casilla).
 * Los de identidad no cuentan. Sin saber qué se concedió, no falta nada: una
 * respuesta sin `scope` no se trata como un rechazo.
 */
export function googleGrantMissing(requested: string, granted: string): string[] {
    if (granted.trim() === '') return [];
    const have = new Set(scopeList(granted).map((s) => s.toLowerCase()));
    return scopeList(requested).filter((s) => !IDENTITY.has(s.toLowerCase()) && !have.has(s.toLowerCase()));
}

/**
 * ¿El error que trajo Google puede ser el bloqueo del administrador de Google
 * Workspace? Google casi nunca vuelve a la app en ese caso (lo muestra en su
 * pantalla), pero cuando vuelve lo hace con estos códigos.
 */
export function isGoogleWorkspaceBlockError(text: string): boolean {
    return /admin_policy_enforced|org_internal|access_blocked|blocked by (your|the) (admin|administrator)|administrator has (blocked|restricted)|bloque[oó] .*administrador|administrador .*bloque/i.test(text);
}

/** Lo que necesita el administrador de Google Workspace para confiar en la app. */
export const googleWorkspaceAdminHelpSchema = z.object({
    /** El ID de cliente de la app de Google de la plataforma (no es secreto: viaja en cada autorización). */
    client_id: z.string(),
    /** El nombre de la app tal como la ven en la plataforma. */
    app_name: z.string(),
    /** Lo que pide la app que se quiere conectar, en palabras. */
    permissions: z.array(z.string()),
});
export type GoogleWorkspaceAdminHelp = z.infer<typeof googleWorkspaceAdminHelpSchema>;

/** Los pasos en la consola de Google Workspace (admin.google.com). */
export function googleWorkspaceAdminSteps(clientId: string): string[] {
    return [
        'Entra a admin.google.com con tu cuenta de administrador de Google Workspace.',
        'Ve a Seguridad → Acceso y control de datos → Controles de API.',
        'En «Acceso de apps de terceros», toca «Gestionar el acceso de apps de terceros» y después «Configurar app nueva».',
        `Busca la app por su ID de cliente: ${clientId}`,
        'Elígela, aplícala a toda la organización (o a la unidad organizativa de quien la va a usar) y, en el acceso a los datos de Google, marca «De confianza». Guarda.',
        'El cambio puede tardar unos minutos. Después, quien la va a usar vuelve a tocar «Conectar».',
    ];
}

/** El mensaje listo para copiar y mandarle al administrador de TI. */
export function googleWorkspaceAdminMessage(help: GoogleWorkspaceAdminHelp, appLabel: string): string {
    const steps = googleWorkspaceAdminSteps(help.client_id).map((s, i) => `${i + 1}. ${s}`);
    const perms = help.permissions.length > 0 ? `\n\nLa app sólo pide: ${help.permissions.join('; ').toLowerCase()}.` : '';
    return [
        `Hola. Quiero conectar ${appLabel} a ${help.app_name || 'la app que usamos en la empresa'}, pero Google me dice que el administrador bloqueó la app («Acceso bloqueado» o «admin_policy_enforced»).`,
        `¿Me ayudas a marcarla como de confianza? Es una sola vez para toda la organización:${perms}`,
        steps.join('\n'),
        '¡Gracias!',
    ].join('\n\n');
}
