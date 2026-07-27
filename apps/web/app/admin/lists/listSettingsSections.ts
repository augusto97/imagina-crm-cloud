import { Columns3, Globe2, Paintbrush, Settings2, ShieldCheck, type LucideIcon } from 'lucide-react';

import { __ } from '@/lib/i18n';

/**
 * Secciones de la configuración de una lista (v0.1.126).
 *
 * Antes todo vivía en UN scroll con seis tarjetas abiertas a la vez
 * (general + campos + apariencia + portal + permisos + lista pública),
 * lo que hacía imposible encontrar nada. Ahora la página muestra UNA
 * sección por vez, elegida con una tira de pestañas — el mismo patrón
 * que ya usan la página de registros (vistas guardadas) y Ajustes del
 * workspace.
 *
 * La sección activa viaja en el query param `?s=` (linkeable y
 * sobrevive al refresh), igual que en Ajustes.
 */
export type ListSettingsSectionId =
    | 'campos'
    | 'general'
    | 'apariencia'
    | 'permisos'
    | 'compartir';

export interface ListSettingsSection {
    id: ListSettingsSectionId;
    /** Etiqueta corta de la pestaña. */
    label: string;
    icon: LucideIcon;
    /** Título de la sección (encabezado del contenido). */
    title: string;
    /** Una línea en lenguaje humano: qué se hace acá. */
    description: string;
}

const CAMPOS: ListSettingsSection = {
    id: 'campos',
    label: __('Campos'),
    icon: Columns3,
    title: __('Campos'),
    description: __(
        'La información que guarda cada registro. Arrastrá para cambiar el orden en que aparecen.',
    ),
};

export const LIST_SETTINGS_SECTIONS: readonly ListSettingsSection[] = [
    CAMPOS,
    {
        id: 'general',
        label: __('General'),
        icon: Settings2,
        title: __('General'),
        description: __('Nombre, dirección web y descripción de la lista.'),
    },
    {
        id: 'apariencia',
        label: __('Apariencia'),
        icon: Paintbrush,
        title: __('Apariencia'),
        description: __('Cómo se ve la ficha de un registro cuando alguien la abre.'),
    },
    {
        id: 'permisos',
        label: __('Permisos'),
        icon: ShieldCheck,
        title: __('Quién puede hacer qué'),
        description: __(
            'Elegí el nivel de acceso de cada rol a los registros de esta lista.',
        ),
    },
    {
        id: 'compartir',
        label: __('Compartir'),
        icon: Globe2,
        title: __('Compartir con gente de afuera'),
        description: __(
            'Dale a cada cliente su portal privado, o publicá la lista en una página que cualquiera pueda ver.',
        ),
    },
];

const IDS = new Set<string>(LIST_SETTINGS_SECTIONS.map((s) => s.id));

/** `?s=` → sección válida. Cualquier valor desconocido cae en "campos". */
export function resolveListSettingsSection(raw: string | null): ListSettingsSectionId {
    return raw !== null && IDS.has(raw) ? (raw as ListSettingsSectionId) : 'campos';
}

/** Sección por id, con fallback seguro (evita el índice opcional). */
export function listSettingsSection(id: ListSettingsSectionId): ListSettingsSection {
    return LIST_SETTINGS_SECTIONS.find((s) => s.id === id) ?? CAMPOS;
}
