import { ClipboardList, Columns3, FileText, Globe2, Paintbrush, Settings2, ShieldCheck, type LucideIcon } from 'lucide-react';

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
    | 'compartir'
    | 'documentos'
    | 'formularios';

export interface ListSettingsSection {
    id: ListSettingsSectionId;
    /** Etiqueta corta de la pestaña. */
    label: string;
    icon: LucideIcon;
    /** Título de la sección (encabezado del contenido). */
    title: string;
    /** Una línea en lenguaje humano: qué se hace aquí. */
    description: string;
}

const CAMPOS: ListSettingsSection = {
    id: 'campos',
    label: __('Campos'),
    icon: Columns3,
    title: __('Campos'),
    description: __(
        'La información que guarda cada registro. Arrastra para cambiar el orden en que aparecen.',
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
            'Elige el nivel de acceso de cada rol a los registros de esta lista.',
        ),
    },
    {
        id: 'compartir',
        label: __('Compartir'),
        icon: Globe2,
        title: __('Compartir con gente de afuera'),
        description: __(
            'Dale a cada cliente su portal privado, o publica la lista en una página que cualquiera pueda ver.',
        ),
    },
    {
        // v0.1.266 — plantillas de documentos PDF (ADR-S35).
        id: 'documentos',
        label: __('Documentos'),
        icon: FileText,
        title: __('Documentos PDF'),
        description: __('Cuentas de cobro, recibos y cotizaciones con los datos de cada registro, listos para descargar o mandar por correo.'),
    },
    {
        // v0.1.275 — formularios públicos que crean registros (ADR-S39).
        id: 'formularios',
        label: __('Formularios'),
        icon: ClipboardList,
        title: __('Formularios'),
        description: __('Una página que cualquiera puede llenar —o que insertas en tu sitio— y cada respuesta llega como un registro nuevo.'),
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
