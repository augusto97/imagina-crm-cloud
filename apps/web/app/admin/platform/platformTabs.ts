import { Activity, ArrowRightLeft, Building2, CreditCard, DatabaseBackup, Globe, History, LifeBuoy, Mail, Megaphone, Palette, Plug, RefreshCw, Sparkles, Users, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Pestañas de la consola de plataforma — fuente única compartida por
 * PlatformPage (tablist + panel activo) y el Sidebar (el panel contextual
 * linkea `/platform?tab=<id>`). Labels planos: se envuelven con `__()` en
 * el punto de render. Los ajustes GLOBALES de la app (SMTP de plataforma,
 * actualizaciones) viven aquí, no en Ajustes del workspace.
 */
export type PlatformTabId =
    | 'tenants'
    | 'users'
    | 'plans'
    | 'cobros'
    | 'audit'
    | 'novedades'
    | 'marca'
    | 'correo'
    | 'diagnostico'
    | 'dominios'
    | 'ai'
    | 'integraciones'
    | 'ayuda'
    | 'updates'
    | 'backups'
    | 'transfers';

export interface PlatformTab {
    id: PlatformTabId;
    label: string;
    icon: LucideIcon;
    /** Una línea que dice para qué sirve (índice del celular y subtítulo). */
    hint: string;
    /** v0.1.342 — el tema al que pertenece (agrupa el panel y el índice). */
    group: 'Clientes' | 'La app' | 'Servidor';
}

export const PLATFORM_TABS: ReadonlyArray<PlatformTab> = [
    { id: 'tenants', label: 'Empresas', icon: Building2, group: 'Clientes', hint: 'Las empresas que usan la app, su plan y su estado' },
    { id: 'users', label: 'Usuarios', icon: Users, group: 'Clientes', hint: 'Todas las cuentas: invitar, desactivar, contraseñas' },
    { id: 'plans', label: 'Planes', icon: CreditCard, group: 'Clientes', hint: 'Límites, precios, módulos y la prueba gratis' },
    // v0.1.250 — credenciales de Mercado Pago para cobrar los planes + pagos recientes.
    { id: 'cobros', label: 'Cobros', icon: Wallet, group: 'Clientes', hint: 'Cómo cobras los planes y los pagos recientes' },
    { id: 'audit', label: 'Auditoría', icon: History, group: 'Clientes', hint: 'Quién entró como otra persona para dar soporte' },
    // v0.1.197 — mover UNA empresa a otra instancia (ADR-S23).
    { id: 'transfers', label: 'Migrar empresas', icon: ArrowRightLeft, group: 'Clientes', hint: 'Llevar una empresa a otro servidor' },
    // v0.1.327 — nombre, logo e ícono con los que se presenta la app.
    { id: 'marca', label: 'Marca', icon: Palette, group: 'La app', hint: 'Nombre, logo e ícono de la app' },
    // Fase 7 — lo que ven las personas en «Novedades» (versiones + lo que publica el operador).
    { id: 'novedades', label: 'Novedades', icon: Megaphone, group: 'La app', hint: 'Lo nuevo de cada versión y tus avisos' },
    // Fase 7 — contacto de soporte, videos y guías propias del centro de ayuda.
    { id: 'ayuda', label: 'Ayuda', icon: LifeBuoy, group: 'La app', hint: 'Contacto de soporte, videos y guías propias' },
    // v0.1.203 — apps OAuth registradas por el operador (Google, Microsoft, Slack).
    { id: 'integraciones', label: 'Integraciones', icon: Plug, group: 'La app', hint: 'Las apps de Google, Microsoft y Slack' },
    // v0.1.181 — clave del proveedor IA + políticas (ADR-S21).
    { id: 'ai', label: 'Asistente IA', icon: Sparkles, group: 'La app', hint: 'Clave, modelo y cupos de la IA' },
    { id: 'correo', label: 'Correo (SMTP)', icon: Mail, group: 'Servidor', hint: 'El correo de las cuentas: verificación y recuperación' },
    // v0.1.246 — dominios de las empresas para habilitar/quitar en ServerAvatar.
    { id: 'dominios', label: 'Dominios', icon: Globe, group: 'Servidor', hint: 'Los dominios propios de las empresas' },
    { id: 'updates', label: 'Actualizaciones', icon: RefreshCw, group: 'Servidor', hint: 'Instalar versiones nuevas' },
    { id: 'backups', label: 'Copias de seguridad', icon: DatabaseBackup, group: 'Servidor', hint: 'Copias del servidor y Google Drive' },
    // v0.1.238 — correos recientes y errores del servidor, sin entrar al servidor.
    { id: 'diagnostico', label: 'Diagnóstico', icon: Activity, group: 'Servidor', hint: 'Disco, errores y correos recientes' },
];

/** v0.1.342 — las pestañas agrupadas por tema, en orden. */
export function platformTabGroups(): Array<{ label: PlatformTab['group']; items: PlatformTab[] }> {
    const order: Array<PlatformTab['group']> = ['Clientes', 'La app', 'Servidor'];
    return order.map((label) => ({ label, items: PLATFORM_TABS.filter((t) => t.group === label) }));
}

export function isPlatformTab(value: string | null): value is PlatformTabId {
    return PLATFORM_TABS.some((t) => t.id === value);
}
