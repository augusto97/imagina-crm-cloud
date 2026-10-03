import { Activity, ArrowRightLeft, Building2, CreditCard, DatabaseBackup, Globe, History, Mail, Plug, RefreshCw, Sparkles, Users, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Pestañas de la consola de plataforma — fuente única compartida por
 * PlatformPage (tablist + panel activo) y el Sidebar (el panel contextual
 * linkea `/platform?tab=<id>`). Labels planos: se envuelven con `__()` en
 * el punto de render. Los ajustes GLOBALES de la app (SMTP de plataforma,
 * actualizaciones) viven acá, no en Ajustes del workspace.
 */
export type PlatformTabId =
    | 'tenants'
    | 'users'
    | 'plans'
    | 'cobros'
    | 'audit'
    | 'correo'
    | 'diagnostico'
    | 'dominios'
    | 'ai'
    | 'integraciones'
    | 'updates'
    | 'backups'
    | 'transfers';

export const PLATFORM_TABS: ReadonlyArray<{ id: PlatformTabId; label: string; icon: LucideIcon }> = [
    { id: 'tenants', label: 'Empresas', icon: Building2 },
    { id: 'users', label: 'Usuarios', icon: Users },
    { id: 'plans', label: 'Planes', icon: CreditCard },
    // v0.1.250 — credenciales de Mercado Pago para cobrar los planes + pagos recientes.
    { id: 'cobros', label: 'Cobros', icon: Wallet },
    { id: 'audit', label: 'Auditoría', icon: History },
    { id: 'correo', label: 'Correo (SMTP)', icon: Mail },
    // v0.1.238 — correos recientes y errores del servidor, sin entrar al servidor.
    { id: 'diagnostico', label: 'Diagnóstico', icon: Activity },
    // v0.1.246 — dominios de las empresas para habilitar/quitar en ServerAvatar.
    { id: 'dominios', label: 'Dominios', icon: Globe },
    // v0.1.181 — clave del proveedor IA + políticas (ADR-S21).
    { id: 'ai', label: 'Asistente IA', icon: Sparkles },
    // v0.1.203 — apps OAuth registradas por el operador (Google, Microsoft, Slack).
    { id: 'integraciones', label: 'Integraciones', icon: Plug },
    { id: 'updates', label: 'Actualizaciones', icon: RefreshCw },
    { id: 'backups', label: 'Copias de seguridad', icon: DatabaseBackup },
    // v0.1.197 — mover UNA empresa a otra instancia (ADR-S23).
    { id: 'transfers', label: 'Migrar empresas', icon: ArrowRightLeft },
];

export function isPlatformTab(value: string | null): value is PlatformTabId {
    return PLATFORM_TABS.some((t) => t.id === value);
}
