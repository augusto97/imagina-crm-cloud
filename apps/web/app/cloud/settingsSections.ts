import {
    Bell,
    CreditCard,
    DoorOpen,
    Gauge,
    Globe,
    KeyRound,
    HardDrive,
    Mail,
    History,
    Palette,
    ShieldCheck,
    DatabaseZap,
    Plug,
    PenLine,
    Scale,
    Sparkles,
    SunMoon,
    Trash2,
    TriangleAlert,
    Users,
    UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Secciones de la página de Ajustes — ÚNICA fuente de verdad, compartida por
 * SettingsPage (render de la sección activa + el índice del celular) y el Sidebar (el
 * panel contextual del shell es LA nav de Ajustes en escritorio). El gate es
 * el de siempre: rol admin del workspace para Suscripción/Miembros/Marca/
 * Correo. Los ajustes GLOBALES (SMTP de plataforma, actualizaciones) viven en
 * la consola de Plataforma (`platformTabs.ts`), no aquí.
 */
export type SettingsSectionId =
    | 'plan'
    | 'suscripcion'
    | 'miembros'
    | 'roles'
    | 'equipos'
    | 'marca'
    | 'formato'
    | 'correo'
    | 'portal'
    | 'privacidad'
    | 'almacenamiento'
    | 'conectores'
    | 'problemas'
    | 'papelera'
    | 'asistente'
    | 'firma'
    | 'apariencia'
    | 'auditoria'
    | 'datos'
    | 'seguridad'
    | 'avisos';

/** `hint`: una línea que dice para qué sirve (el índice del celular y el subtítulo de la sección). */
export type SettingsSectionItem = { id: SettingsSectionId; label: string; icon: LucideIcon; hint: string };
export type SettingsSectionGroup = { label: string; items: SettingsSectionItem[] };

const ITEMS: Record<SettingsSectionId, SettingsSectionItem> = {
    plan: { id: 'plan', label: 'Plan y uso', icon: Gauge, hint: 'Lo que incluye tu plan y cuánto estás usando' },
    suscripcion: { id: 'suscripcion', label: 'Suscripción', icon: CreditCard, hint: 'Pagar, renovar y ver tus pagos' },
    marca: { id: 'marca', label: 'Marca', icon: Palette, hint: 'Logo, colores, nombre y dominio propio' },
    formato: { id: 'formato', label: 'Formato regional', icon: Globe, hint: 'Números, fechas y zona horaria' },
    miembros: { id: 'miembros', label: 'Miembros', icon: Users, hint: 'Invitar a tu equipo y elegir su rol' },
    equipos: { id: 'equipos', label: 'Equipos', icon: UsersRound, hint: 'Grupos como Ventas o Soporte' },
    roles: { id: 'roles', label: 'Roles', icon: KeyRound, hint: 'Qué puede hacer cada rol' },
    conectores: { id: 'conectores', label: 'Integraciones', icon: Plug, hint: 'WhatsApp, Google, tu tienda y otras apps' },
    correo: { id: 'correo', label: 'Correo', icon: Mail, hint: 'Desde qué cuenta salen tus correos' },
    almacenamiento: { id: 'almacenamiento', label: 'Almacenamiento', icon: HardDrive, hint: 'Dónde se guardan los archivos' },
    asistente: { id: 'asistente', label: 'Asistente IA', icon: Sparkles, hint: 'Activar el asistente y usar tu propia clave' },
    portal: { id: 'portal', label: 'Portal y formularios', icon: DoorOpen, hint: 'Cómo entran tus clientes y el captcha' },
    privacidad: { id: 'privacidad', label: 'Datos personales', icon: Scale, hint: 'Autorización de tratamiento de datos' },
    problemas: { id: 'problemas', label: 'Problemas', icon: TriangleAlert, hint: 'Lo que corre solo y dejó de funcionar' },
    auditoria: { id: 'auditoria', label: 'Registro de actividad', icon: History, hint: 'Quién cambió qué en la empresa' },
    papelera: { id: 'papelera', label: 'Papelera', icon: Trash2, hint: 'Recupera lo borrado en los últimos 30 días' },
    seguridad: { id: 'seguridad', label: 'Seguridad', icon: ShieldCheck, hint: 'Contraseña, verificación en dos pasos y dispositivos' },
    avisos: { id: 'avisos', label: 'Avisos', icon: Bell, hint: 'Qué te llega al correo y al teléfono' },
    firma: { id: 'firma', label: 'Firma de email', icon: PenLine, hint: 'La firma de tus correos' },
    datos: { id: 'datos', label: 'Tus datos', icon: DatabaseZap, hint: 'Descargar o borrar tu cuenta' },
    apariencia: { id: 'apariencia', label: 'Apariencia', icon: SunMoon, hint: 'Modo claro u oscuro' },
};

/**
 * v0.1.342 — Secciones agrupadas por TEMA (antes «Empresa» era una lista
 * plana de 15 cosas): la empresa, las personas, las conexiones, los
 * clientes, el mantenimiento y tu cuenta. El gate de cada sección es el de
 * siempre; un grupo que queda vacío para un rol no se muestra.
 */
export function settingsSectionGroups({
    isAdmin,
    canManageAutomations = false,
    canManageTeams = false,
    isGuest = false,
}: {
    isAdmin: boolean;
    /** v0.1.196 — Conectores: quien arma automatizaciones ve el inventario. */
    canManageAutomations?: boolean;
    /** C1 — Equipos: el admin o quien tiene «Gestionar equipos». */
    canManageTeams?: boolean;
    /** C3 — un invitado de afuera sólo ve SU cuenta. */
    isGuest?: boolean;
}): SettingsSectionGroup[] {
    const pick = (...ids: Array<SettingsSectionId | false>): SettingsSectionItem[] =>
        ids.filter((id): id is SettingsSectionId => id !== false).map((id) => ITEMS[id]);
    if (isGuest) {
        return [{ label: 'Cuenta', items: pick('seguridad', 'avisos', 'datos', 'apariencia') }];
    }
    const groups: SettingsSectionGroup[] = [
        // v0.1.286 — `GET /billing` es sólo para admins: a cualquier otro rol
        // "Plan y uso" le quedaba en blanco (403).
        { label: 'Empresa', items: pick(isAdmin && 'plan', isAdmin && 'suscripcion', isAdmin && 'marca', isAdmin && 'formato') },
        {
            label: 'Personas',
            // C1 — equipos: el admin o quien los gestiona. C2 — roles propios.
            items: pick(isAdmin && 'miembros', (isAdmin || canManageTeams) && 'equipos', isAdmin && 'roles'),
        },
        {
            label: 'Conexiones',
            // v0.1.196 (ADR-S22) — Integraciones no es admin-only: quien arma
            // automatizaciones ve qué hay conectado (conectar lo decide el backend).
            // El id `conectores` se conserva: es la ruta del callback OAuth.
            items: pick((isAdmin || canManageAutomations) && 'conectores', isAdmin && 'correo', isAdmin && 'almacenamiento', isAdmin && 'asistente'),
        },
        { label: 'Clientes', items: pick(isAdmin && 'portal', isAdmin && 'privacidad') },
        {
            label: 'Mantenimiento',
            // Papelera: TODO miembro la abre (lo que borró y lo de las listas que ve).
            items: pick((isAdmin || canManageAutomations) && 'problemas', isAdmin && 'auditoria', 'papelera'),
        },
        { label: 'Cuenta', items: pick('seguridad', 'avisos', 'firma', 'datos', 'apariencia') },
    ];
    // Un rol sin nada de un tema (agente/lector) no ve un grupo vacío.
    return groups.filter((g) => g.items.length > 0);
}

/**
 * Resuelve la sección activa desde el query param `?s=`. Si el param no existe
 * o apunta a una sección que este rol no ve: "Plan y uso" para un admin y
 * "Seguridad" (su cuenta) para el resto — v0.1.286, antes caía a "plan" y a un
 * no-admin la página le quedaba en blanco.
 */
export function resolveSettingsSection(
    groups: SettingsSectionGroup[],
    requested: string | null,
): SettingsSectionId {
    const visible = groups.flatMap((g) => g.items);
    const hit = visible.find((i) => i.id === requested)?.id;
    if (hit) return hit;
    return visible.some((i) => i.id === 'plan') ? 'plan' : 'seguridad';
}
