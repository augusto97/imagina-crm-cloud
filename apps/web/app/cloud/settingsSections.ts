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
 * SettingsPage (render del panel activo + select mobile) y el Sidebar (el
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

export type SettingsSectionItem = { id: SettingsSectionId; label: string; icon: LucideIcon };
export type SettingsSectionGroup = { label: string; items: SettingsSectionItem[] };

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
    if (isGuest) {
        return [
            {
                label: 'Cuenta',
                items: [
                    { id: 'seguridad', label: 'Seguridad', icon: ShieldCheck },
                    { id: 'avisos', label: 'Avisos', icon: Bell },
                    { id: 'datos', label: 'Tus datos', icon: DatabaseZap },
                    { id: 'apariencia', label: 'Apariencia', icon: SunMoon },
                ],
            },
        ];
    }
    const groups: SettingsSectionGroup[] = [
        {
            label: 'Workspace',
            items: [
                ...(isAdmin
                    ? ([
                          // v0.1.286 — `GET /billing` es sólo para admins: a
                          // cualquier otro rol "Plan y uso" le quedaba en blanco
                          // (403), y era la sección POR DEFECTO de Ajustes.
                          { id: 'plan', label: 'Plan y uso', icon: Gauge },
                          { id: 'suscripcion', label: 'Suscripción', icon: CreditCard },
                          { id: 'miembros', label: 'Miembros', icon: Users },
                          // C2 — roles propios (capacidades por módulo).
                          { id: 'roles', label: 'Roles', icon: KeyRound },
                          { id: 'marca', label: 'Marca', icon: Palette },
                          { id: 'formato', label: 'Formato regional', icon: Globe },
                          { id: 'correo', label: 'Correo', icon: Mail },
                          // v0.1.289 — entrar al portal con contraseña y captcha de formularios.
                          { id: 'portal', label: 'Portal y formularios', icon: DoorOpen },
                          // Ley 1581 — autorización de tratamiento de datos (formularios y portal).
                          { id: 'privacidad', label: 'Datos personales', icon: Scale },
                          // v0.1.268 (ADR-S36) — archivos en el bucket propio de la empresa.
                          { id: 'almacenamiento', label: 'Almacenamiento', icon: HardDrive },
                          // v0.1.181 — asistente IA (ADR-S21): opt-in, clave propia, modelo.
                          { id: 'asistente', label: 'Asistente IA', icon: Sparkles },
                          // v0.1.114 — quién cambió qué en el workspace.
                          { id: 'auditoria', label: 'Registro de actividad', icon: History },
                      ] satisfies SettingsSectionItem[])
                    : []),
                // C1 — equipos (Ventas, Soporte…): el admin o quien los gestiona.
                ...(isAdmin || canManageTeams
                    ? ([{ id: 'equipos', label: 'Equipos', icon: UsersRound }] satisfies SettingsSectionItem[])
                    : []),
                // v0.1.196 (ADR-S22) — apps conectadas; v0.1.203 pasa a ser la
                // galería «Integraciones» (el id `conectores` se conserva: es
                // la ruta a la que vuelve el callback OAuth). No es admin-only:
                // quien arma automatizaciones ve qué hay conectado, aunque
                // conectar para el equipo sea del admin (lo decide el backend).
                ...(isAdmin || canManageAutomations
                    ? ([
                          { id: 'conectores', label: 'Integraciones', icon: Plug },
                          // v0.1.285 (ADR-S44) — lo que corre solo y dejó de funcionar.
                          { id: 'problemas', label: 'Problemas', icon: TriangleAlert },
                      ] satisfies SettingsSectionItem[])
                    : []),
                // Papelera: TODO miembro la abre (ve lo que borró y los
                // registros borrados de las listas que puede ver); restaurar
                // y vaciar se deciden en el backend.
                { id: 'papelera', label: 'Papelera', icon: Trash2 },
            ],
        },
        {
            label: 'Cuenta',
            items: [
                // v0.1.116 — contraseña + dispositivos conectados.
                { id: 'seguridad', label: 'Seguridad', icon: ShieldCheck },
                // v0.1.276 — qué avisos llegan por correo y el resumen diario.
                { id: 'avisos', label: 'Avisos', icon: Bell },
                { id: 'firma', label: 'Firma de email', icon: PenLine },
                // v0.1.121 — descarga y borrado de datos personales (GDPR).
                { id: 'datos', label: 'Tus datos', icon: DatabaseZap },
                // v0.1.112 — per-usuario y por dispositivo (no viaja al backend).
                { id: 'apariencia', label: 'Apariencia', icon: SunMoon },
            ],
        },
    ];
    // Un rol sin nada de la empresa (agente/lector) no ve un grupo vacío.
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
