import { Building2, CreditCard, DatabaseBackup, History, Mail, RefreshCw, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Pestañas de la consola de plataforma — fuente única compartida por
 * PlatformPage (tablist + panel activo) y el Sidebar (el panel contextual
 * linkea `/platform?tab=<id>`). Labels planos: se envuelven con `__()` en
 * el punto de render. Los ajustes GLOBALES de la app (SMTP de plataforma,
 * actualizaciones) viven acá, no en Ajustes del workspace.
 */
export type PlatformTabId = 'tenants' | 'users' | 'plans' | 'audit' | 'correo' | 'updates' | 'backups';

export const PLATFORM_TABS: ReadonlyArray<{ id: PlatformTabId; label: string; icon: LucideIcon }> = [
    { id: 'tenants', label: 'Empresas', icon: Building2 },
    { id: 'users', label: 'Usuarios', icon: Users },
    { id: 'plans', label: 'Planes', icon: CreditCard },
    { id: 'audit', label: 'Auditoría', icon: History },
    { id: 'correo', label: 'Correo (SMTP)', icon: Mail },
    { id: 'updates', label: 'Actualizaciones', icon: RefreshCw },
    { id: 'backups', label: 'Copias de seguridad', icon: DatabaseBackup },
];

export function isPlatformTab(value: string | null): value is PlatformTabId {
    return PLATFORM_TABS.some((t) => t.id === value);
}
