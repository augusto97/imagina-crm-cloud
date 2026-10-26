import { BookmarkPlus, CalendarClock, ClipboardCheck, ClipboardList, Columns3, FileText, Globe2, Inbox, Paintbrush, Settings2, ShieldCheck, Timer, type LucideIcon } from 'lucide-react';

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
    | 'formularios'
    | 'agenda'
    | 'aprobaciones'
    | 'plantillas'
    | 'correo'
    | 'sla';

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
    {
        // D5 — agenda de citas pública (estilo Calendly).
        id: 'agenda',
        label: __('Agenda'),
        icon: CalendarClock,
        title: __('Agenda de citas'),
        description: __('Una página donde tus clientes eligen el servicio, quién los atiende, el día y la hora libres; cada cita llega como un registro.'),
    },
    {
        // C5 — flujos de aprobación (pasos en serie, qué se pone al resolver).
        id: 'aprobaciones',
        label: __('Aprobaciones'),
        icon: ClipboardCheck,
        title: __('Aprobaciones'),
        description: __('Quién tiene que dar el visto bueno a un registro, en qué orden, y qué cambia cuando se aprueba o se rechaza.'),
    },
    {
        // C6 / A9 — plantillas de registro y de checklist.
        id: 'plantillas',
        label: __('Plantillas'),
        icon: BookmarkPlus,
        title: __('Plantillas de registro y de checklist'),
        description: __('Un registro que nace con sus valores, sus subtareas y sus checklists de una vez, y checklists listos para agregar a cualquier registro.'),
    },
    {
        // D2 — mesa de ayuda: el buzón de soporte y cómo entra cada correo.
        id: 'correo',
        label: __('Correo entrante'),
        icon: Inbox,
        title: __('Correo entrante (mesa de ayuda)'),
        description: __('Conecta el buzón de soporte: cada correo nuevo crea un ticket en esta lista, las respuestas del cliente se suman a su ticket y el equipo responde desde la ficha.'),
    },
    {
        // E5 — SLA y escalamiento.
        id: 'sla',
        label: __('SLA'),
        icon: Timer,
        title: __('SLA y escalamiento'),
        description: __('Cuánto tiempo hay para la primera respuesta y para resolver, en horas hábiles, a quién se avisa cuando un ticket está en riesgo y a quién se escala al vencer.'),
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
