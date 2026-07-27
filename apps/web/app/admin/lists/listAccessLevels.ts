import { __ } from '@/lib/i18n';
import type { RolePermissions } from '@imagina-base/shared';

/**
 * Niveles de acceso listos para usar (v0.1.126).
 *
 * La matriz cruda (rol × operación, con cuatro selects por fila) obligaba
 * a entender los cuatro ejes para tomar lo que casi siempre es UNA
 * decisión: "este rol mira, este rol trabaja, este rol manda". Cada nivel
 * se traduce al mismo shape `RolePermissions` que ya entiende el backend
 * — no hay concepto nuevo del lado del servidor —, y el ajuste fino sigue
 * disponible para las combinaciones raras.
 */
export interface AccessLevel {
    id: string;
    label: string;
    hint: string;
    perms: Omit<RolePermissions, 'fields_hidden'>;
}

export const ACCESS_LEVELS: readonly AccessLevel[] = [
    {
        id: 'none',
        label: __('Sin acceso'),
        hint: __('No ve esta lista.'),
        perms: { view: 'none', create: false, edit: 'none', delete: 'none' },
    },
    {
        id: 'read',
        label: __('Solo mirar'),
        hint: __('Ve todos los registros, no puede tocarlos.'),
        perms: { view: 'all', create: false, edit: 'none', delete: 'none' },
    },
    {
        id: 'own',
        label: __('Solo lo suyo'),
        hint: __('Ve y edita únicamente los registros que creó.'),
        perms: { view: 'own', create: true, edit: 'own', delete: 'own' },
    },
    {
        id: 'collab',
        label: __('Colaborar'),
        hint: __('Ve y edita todo, pero no elimina.'),
        perms: { view: 'all', create: true, edit: 'all', delete: 'none' },
    },
    {
        id: 'full',
        label: __('Control total'),
        hint: __('Ve, crea, edita y elimina cualquier registro.'),
        perms: { view: 'all', create: true, edit: 'all', delete: 'all' },
    },
];

/**
 * Qué nivel describe estos permisos, o `null` si es una combinación
 * propia (por ejemplo, alguien que usa el scope "asignados", que no
 * tiene nivel prearmado). `fields_hidden` NO participa: ocultar campos
 * es ortogonal al nivel de acceso.
 */
export function levelOf(p: RolePermissions | undefined): string | null {
    if (!p) return null;
    const match = ACCESS_LEVELS.find(
        (l) =>
            l.perms.view === p.view &&
            l.perms.edit === p.edit &&
            l.perms.delete === p.delete &&
            l.perms.create === p.create,
    );
    return match ? match.id : null;
}

export function blankRolePermissions(): RolePermissions {
    return { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] };
}
