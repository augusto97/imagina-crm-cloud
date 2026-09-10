import { ChartBarIcon } from '@heroicons/react/20/solid';

import { listColor, listIcon, type ListIconComponent } from './listIcons';

/**
 * Icono de un dashboard (v0.1.145).
 *
 * Los dashboards del menú se pintaban con el mismo puntito gris que tenían
 * las listas antes de v0.1.137 — el usuario lo marcó otra vez. Ahora llevan
 * icono: el que eligió quien lo creó (`settings.icon`, del MISMO catálogo
 * que las listas, así no hay dos vocabularios de iconos en la app) o el
 * genérico de tablero (sólido desde v0.1.174, como el resto del catálogo).
 */
export function dashboardIcon(settings: Record<string, unknown> | undefined): ListIconComponent {
    const key = settings?.['icon'];
    return (typeof key === 'string' ? listIcon(key) : undefined) ?? ChartBarIcon;
}

/** Color del icono, si eligió uno. */
export function dashboardColor(settings: Record<string, unknown> | undefined): string | undefined {
    const hex = settings?.['color'];
    return typeof hex === 'string' ? listColor(hex) : undefined;
}
