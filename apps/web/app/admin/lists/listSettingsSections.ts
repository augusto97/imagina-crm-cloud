import { BookmarkPlus, ToggleRight, CalendarClock, ClipboardCheck, ClipboardList, Columns3, FileText, Globe2, Inbox, Paintbrush, Settings2, ShieldCheck, ShoppingBag, Timer, type LucideIcon } from 'lucide-react';

import { __ } from '@/lib/i18n';

/**
 * Secciones de la configuración de una lista (v0.1.126).
 *
 * Antes todo vivía en UN scroll con seis tarjetas abiertas a la vez
 * (general + campos + apariencia + portal + permisos + lista pública),
 * lo que hacía imposible encontrar nada. Ahora la página muestra UNA
 * sección por vez. Desde v0.1.406 se elige con un menú vertical por grupos
 * (computador) o un índice (celular), como Ajustes.
 *
 * La sección activa viaja en el query param `?s=` (linkeable y
 * sobrevive al refresh), igual que en Ajustes.
 */
export type ListSettingsSectionId =
    | 'campos'
    | 'general'
    | 'funciones'
    | 'apariencia'
    | 'permisos'
    | 'compartir'
    | 'documentos'
    | 'formularios'
    | 'agenda'
    | 'tienda'
    | 'aprobaciones'
    | 'plantillas'
    | 'correo'
    | 'sla';

/**
 * v0.1.406 — Los grupos del menú de la configuración. Con doce secciones la
 * tira de pestañas ya no entraba (se deslizaba de costado y escondía la
 * mitad); ahora es un menú vertical por grupos (computador) o un índice
 * (celular), como Ajustes.
 */
export type ListSettingsGroupId = 'list' | 'access' | 'intake' | 'work';

export const LIST_SETTINGS_GROUPS: ReadonlyArray<{ id: ListSettingsGroupId; label: string }> = [
    { id: 'list', label: __('La lista') },
    { id: 'access', label: __('Quién la ve') },
    { id: 'intake', label: __('Recibir registros') },
    { id: 'work', label: __('Procesos') },
];

export interface ListSettingsSection {
    id: ListSettingsSectionId;
    /** Etiqueta corta del menú. */
    label: string;
    /** Grupo del menú. */
    group: ListSettingsGroupId;
    /** Una línea corta para el índice del celular. */
    short: string;
    icon: LucideIcon;
    /** Título de la sección (encabezado del contenido). */
    title: string;
    /** Una línea en lenguaje humano: qué se hace aquí. */
    description: string;
}

const CAMPOS: ListSettingsSection = {
    id: 'campos',
    label: __('Campos'),
        group: 'list',
        short: __('Qué información guarda cada registro'),
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
        group: 'list',
        short: __('Nombre, ícono, duplicar o eliminar'),
        icon: Settings2,
        title: __('General'),
        description: __('Nombre, dirección web y descripción de la lista.'),
    },
    {
        id: 'apariencia',
        label: __('Apariencia'),
        group: 'list',
        short: __('Cómo se ve la ficha de un registro'),
        icon: Paintbrush,
        title: __('Apariencia'),
        description: __('Cómo se ve la ficha de un registro cuando alguien la abre.'),
    },
    {
        // v0.1.475 (ADR-S115) — qué funciones de la ficha usa esta lista.
        id: 'funciones',
        label: __('Funciones'),
        group: 'list',
        short: __('Subtareas, checklists, tiempo y más'),
        icon: ToggleRight,
        title: __('Funciones de la lista'),
        description: __('Elige qué usa esta lista. Una lista simple no necesita subtareas ni checklists; una de proyectos sí. Apagar una función no borra nada.'),
    },
    {
        id: 'permisos',
        label: __('Permisos'),
        group: 'access',
        short: __('Qué puede hacer cada rol o persona'),
        icon: ShieldCheck,
        title: __('Quién puede hacer qué'),
        description: __(
            'Elige el nivel de acceso de cada rol a los registros de esta lista.',
        ),
    },
    {
        id: 'compartir',
        label: __('Compartir'),
        group: 'access',
        short: __('Portal del cliente y página pública'),
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
        group: 'work',
        short: __('Cotizaciones, cuentas de cobro y otros PDF'),
        icon: FileText,
        title: __('Documentos PDF'),
        description: __('Cuentas de cobro, recibos y cotizaciones con los datos de cada registro, listos para descargar o mandar por correo.'),
    },
    {
        // v0.1.275 — formularios públicos que crean registros (ADR-S39).
        id: 'formularios',
        label: __('Formularios'),
        group: 'intake',
        short: __('Páginas que crean registros'),
        icon: ClipboardList,
        title: __('Formularios'),
        description: __('Una página que cualquiera puede llenar —o que insertas en tu sitio— y cada respuesta llega como un registro nuevo.'),
    },
    {
        // D5 — agenda de citas pública (estilo Calendly).
        id: 'agenda',
        label: __('Agenda'),
        group: 'intake',
        short: __('Tus clientes agendan una cita'),
        icon: CalendarClock,
        title: __('Agenda de citas'),
        description: __('Una página donde tus clientes eligen el servicio, quién los atiende, el día y la hora libres; cada cita llega como un registro.'),
    },
    {
        // v0.1.412 (ADR-S103) — tienda pública: la lista es el catálogo.
        id: 'tienda',
        label: __('Tienda'),
        group: 'intake',
        short: __('Vende los registros como productos'),
        icon: ShoppingBag,
        title: __('Tienda'),
        description: __('Una página donde tus clientes ven los productos de esta lista, arman su carrito y te hacen el pedido. Cada compra llega como un registro de Pedidos.'),
    },
    {
        // C5 — flujos de aprobación (pasos en serie, qué se pone al resolver).
        id: 'aprobaciones',
        label: __('Aprobaciones'),
        group: 'work',
        short: __('Quién da el visto bueno y en qué orden'),
        icon: ClipboardCheck,
        title: __('Aprobaciones'),
        description: __('Quién tiene que dar el visto bueno a un registro, en qué orden, y qué cambia cuando se aprueba o se rechaza.'),
    },
    {
        // C6 / A9 — plantillas de registro y de checklist.
        id: 'plantillas',
        label: __('Plantillas'),
        group: 'work',
        short: __('Registros y checklists listos para usar'),
        icon: BookmarkPlus,
        title: __('Plantillas de registro y de checklist'),
        description: __('Un registro que nace con sus valores, sus subtareas y sus checklists de una vez, y checklists listos para agregar a cualquier registro.'),
    },
    {
        // D2 — mesa de ayuda: el buzón de soporte y cómo entra cada correo.
        id: 'correo',
        label: __('Correo entrante'),
        group: 'intake',
        short: __('Cada correo nuevo crea un ticket'),
        icon: Inbox,
        title: __('Correo entrante (mesa de ayuda)'),
        description: __('Conecta el buzón de soporte: cada correo nuevo crea un ticket en esta lista, las respuestas del cliente se suman a su ticket y el equipo responde desde la ficha.'),
    },
    {
        // E5 — SLA y escalamiento.
        id: 'sla',
        label: __('SLA'),
        group: 'work',
        short: __('Tiempos de respuesta y a quién se escala'),
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

/** Orden del menú (dentro de cada grupo, en este orden). */
const NAV_ORDER: readonly ListSettingsSectionId[] = [
    'campos', 'general', 'apariencia', 'funciones',
    'permisos', 'compartir',
    'formularios', 'agenda', 'tienda', 'correo',
    'plantillas', 'aprobaciones', 'documentos', 'sla',
];

/**
 * Las secciones agrupadas para el menú, sólo las que `allowed` deja ver.
 * Un grupo sin secciones no aparece.
 */
export function groupedListSettingsSections(
    allowed: (id: ListSettingsSectionId) => boolean,
): Array<{ id: ListSettingsGroupId; label: string; sections: ListSettingsSection[] }> {
    const ordered = NAV_ORDER.map(listSettingsSection).filter((s) => allowed(s.id));
    return LIST_SETTINGS_GROUPS.map((g) => ({
        ...g,
        sections: ordered.filter((s) => s.group === g.id),
    })).filter((g) => g.sections.length > 0);
}
