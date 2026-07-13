import {
    CreditCard,
    Gauge,
    Mail,
    Palette,
    PenLine,
    Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Secciones de la página de Ajustes — ÚNICA fuente de verdad, compartida por
 * SettingsPage (render del panel activo + select mobile) y el Sidebar (el
 * panel contextual del shell es LA nav de Ajustes en escritorio). El gate es
 * el de siempre: rol admin del workspace para Suscripción/Miembros/Marca/
 * Correo. Los ajustes GLOBALES (SMTP de plataforma, actualizaciones) viven en
 * la consola de Plataforma (`platformTabs.ts`), no acá.
 */
export type SettingsSectionId =
    | 'plan'
    | 'suscripcion'
    | 'miembros'
    | 'marca'
    | 'correo'
    | 'firma';

export type SettingsSectionItem = { id: SettingsSectionId; label: string; icon: LucideIcon };
export type SettingsSectionGroup = { label: string; items: SettingsSectionItem[] };

export function settingsSectionGroups({ isAdmin }: { isAdmin: boolean }): SettingsSectionGroup[] {
    return [
        {
            label: 'Workspace',
            items: [
                { id: 'plan', label: 'Plan y uso', icon: Gauge },
                ...(isAdmin
                    ? ([
                          { id: 'suscripcion', label: 'Suscripción', icon: CreditCard },
                          { id: 'miembros', label: 'Miembros', icon: Users },
                          { id: 'marca', label: 'Marca', icon: Palette },
                          { id: 'correo', label: 'Correo (SMTP)', icon: Mail },
                      ] satisfies SettingsSectionItem[])
                    : []),
            ],
        },
        {
            label: 'Cuenta',
            items: [{ id: 'firma', label: 'Firma de email', icon: PenLine }],
        },
    ];
}

/**
 * Resuelve la sección activa desde el query param `?s=`: fallback a "plan" si
 * el param no existe o apunta a una sección gateada/incógnita.
 */
export function resolveSettingsSection(
    groups: SettingsSectionGroup[],
    requested: string | null,
): SettingsSectionId {
    const visible = groups.flatMap((g) => g.items);
    return visible.find((i) => i.id === requested)?.id ?? 'plan';
}
