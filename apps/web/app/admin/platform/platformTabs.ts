import { Building2, CreditCard, DatabaseBackup, History, Mail, RefreshCw, Sparkles, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Pestañas de la consola de plataforma — fuente única compartida por
 * PlatformPage (tablist + panel activo) y el Sidebar (el panel contextual
 * linkea `/platform?tab=<id>`). Labels planos: se envuelven con `__()` en
 * el punto de render. Los ajustes GLOBALES de la app (SMTP de plataforma,
 * actualizaciones) viven acá, no en Ajustes del workspace.
 */
export type PlatformTabId = 'tenants' | 'users' | 'plans' | 'audit' | 'correo' | 'ai' | 'updates' | 'backups';

export const PLATFORM_TABS: ReadonlyArray<{ id: PlatformTabId; label: string; icon: LucideIcon }> = [
    { id: 'tenants', label: 'Empresas', icon: Building2 },
    { id: 'users', label: 'Usuarios', icon: Users },
    { id: 'plans', label: 'Planes', icon: CreditCard },
    { id: 'audit', label: 'Auditoría', icon: History },
    { id: 'correo', label: 'Correo (SMTP)', icon: Mail },
    // v0.1.181 — clave del proveedor IA + políticas (ADR-S21).
    { id: 'ai', label: 'Asistente IA', icon: Sparkles },
    { id: 'updates', label: 'Actualizaciones', icon: RefreshCw },
    { id: 'backups', label: 'Copias de seguridad', icon: DatabaseBackup },
];

export function isPlatformTab(value: string | null): value is PlatformTabId {
    return PLATFORM_TABS.some((t) => t.id === value);
}
