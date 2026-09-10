import type { ComponentType, SVGProps } from 'react';
import {
    BookmarkIcon,
    BriefcaseIcon,
    BugAntIcon,
    BuildingOffice2Icon,
    CalendarDaysIcon,
    ChartPieIcon,
    CircleStackIcon,
    ClipboardDocumentCheckIcon,
    ClipboardDocumentListIcon,
    ClockIcon,
    CubeIcon,
    DocumentTextIcon,
    EnvelopeIcon,
    FlagIcon,
    FolderIcon,
    GlobeAltIcon,
    HeartIcon,
    HomeIcon,
    InboxIcon,
    LifebuoyIcon,
    LightBulbIcon,
    ListBulletIcon,
    MegaphoneIcon,
    PhoneIcon,
    ReceiptPercentIcon,
    RocketLaunchIcon,
    ShoppingCartIcon,
    Square3Stack3DIcon,
    Squares2X2Icon,
    StarIcon,
    TagIcon,
    TruckIcon,
    UsersIcon,
    ViewfinderCircleIcon,
    WalletIcon,
    WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid';

/**
 * Componente de icono del catálogo: cualquier SVG que acepte `className` y
 * `style` (los sólidos de heroicons y los de lucide cumplen los dos).
 */
export type ListIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Catálogo de iconos para las listas (v0.1.137).
 *
 * El usuario pidió lo que hace ClickUp: cada lista con su icono en vez de
 * un punto igual para todas. Se guarda la CLAVE (`lists.icon`, que ya
 * existía en el backend sin usarse), nunca el componente — así el set de
 * iconos puede cambiar sin romper los datos del cliente. Lista corta y
 * curada a propósito: un buscador con 1.500 iconos no ayuda a elegir.
 *
 * v0.1.174 — el set pasa de los trazos finos de lucide a los **sólidos** de
 * heroicons (20px, diseñados para tamaños chicos): a 14px un icono de línea
 * de 1.5px casi no se distingue en el menú, y los de ClickUp son macizos por
 * esa razón. Las CLAVES se conservan tal cual (lo guardado sigue valiendo);
 * sólo cambia el dibujo. Un icono de trazo (lucide) sigue sirviendo como
 * fallback donde el catálogo no tiene entrada.
 */
export const LIST_ICONS: Array<{ key: string; icon: ListIconComponent; label: string }> = [
    { key: 'list', icon: ListBulletIcon, label: 'Lista' },
    { key: 'folder', icon: FolderIcon, label: 'Carpeta' },
    { key: 'users', icon: UsersIcon, label: 'Personas' },
    { key: 'building', icon: BuildingOffice2Icon, label: 'Empresas' },
    { key: 'briefcase', icon: BriefcaseIcon, label: 'Negocios' },
    { key: 'receipt', icon: ReceiptPercentIcon, label: 'Facturas' },
    { key: 'wallet', icon: WalletIcon, label: 'Pagos' },
    { key: 'shopping_cart', icon: ShoppingCartIcon, label: 'Ventas' },
    { key: 'package', icon: CubeIcon, label: 'Productos' },
    { key: 'truck', icon: TruckIcon, label: 'Envíos' },
    { key: 'check_square', icon: ClipboardDocumentCheckIcon, label: 'Tareas' },
    { key: 'clipboard', icon: ClipboardDocumentListIcon, label: 'Pendientes' },
    { key: 'calendar', icon: CalendarDaysIcon, label: 'Agenda' },
    { key: 'clock', icon: ClockIcon, label: 'Tiempos' },
    { key: 'flag', icon: FlagIcon, label: 'Prioridades' },
    { key: 'target', icon: ViewfinderCircleIcon, label: 'Objetivos' },
    { key: 'rocket', icon: RocketLaunchIcon, label: 'Proyectos' },
    { key: 'lightbulb', icon: LightBulbIcon, label: 'Ideas' },
    { key: 'bug', icon: BugAntIcon, label: 'Incidencias' },
    { key: 'lifebuoy', icon: LifebuoyIcon, label: 'Soporte' },
    { key: 'inbox', icon: InboxIcon, label: 'Entradas' },
    { key: 'mail', icon: EnvelopeIcon, label: 'Correos' },
    { key: 'phone', icon: PhoneIcon, label: 'Llamadas' },
    { key: 'megaphone', icon: MegaphoneIcon, label: 'Campañas' },
    { key: 'globe', icon: GlobeAltIcon, label: 'Sitios web' },
    { key: 'file_text', icon: DocumentTextIcon, label: 'Documentos' },
    { key: 'pie_chart', icon: ChartPieIcon, label: 'Reportes' },
    { key: 'database', icon: CircleStackIcon, label: 'Datos' },
    { key: 'layers', icon: Square3Stack3DIcon, label: 'Categorías' },
    { key: 'blocks', icon: Squares2X2Icon, label: 'Módulos' },
    { key: 'wrench', icon: WrenchScrewdriverIcon, label: 'Servicios' },
    { key: 'tag', icon: TagIcon, label: 'Etiquetas' },
    { key: 'bookmark', icon: BookmarkIcon, label: 'Guardados' },
    { key: 'star', icon: StarIcon, label: 'Destacados' },
    { key: 'heart', icon: HeartIcon, label: 'Favoritos' },
    { key: 'home', icon: HomeIcon, label: 'General' },
];

/**
 * Icono de las listas que no eligieron uno (v0.1.139). Antes caían a un
 * puntito gris igual para todas — el usuario lo pidió explícitamente: toda
 * lista se ve con icono, elija o no.
 */
export const DEFAULT_LIST_ICON: ListIconComponent = ListBulletIcon;

/** Icono de las carpetas sin elección (v0.1.173), sólido como el resto. */
export const DEFAULT_FOLDER_ICON: ListIconComponent = FolderIcon;

/** El icono de una lista, o `undefined` si no eligió ninguno (o es viejo). */
export function listIcon(key: string | null | undefined): ListIconComponent | undefined {
    if (typeof key !== 'string' || key === '') return undefined;
    return LIST_ICONS.find((o) => o.key === key)?.icon;
}

/**
 * Colores para el icono. Se guardan como hex en `lists.color` (la columna
 * ya existía) para no atarse a los presets del tema.
 */
export const LIST_ICON_COLORS: Array<{ hex: string; label: string }> = [
    { hex: '#64748b', label: 'Gris' },
    { hex: '#ef4444', label: 'Rojo' },
    { hex: '#f97316', label: 'Naranja' },
    { hex: '#eab308', label: 'Amarillo' },
    { hex: '#22c55e', label: 'Verde' },
    { hex: '#14b8a6', label: 'Turquesa' },
    { hex: '#0ea5e9', label: 'Celeste' },
    { hex: '#6366f1', label: 'Índigo' },
    { hex: '#a855f7', label: 'Violeta' },
    { hex: '#ec4899', label: 'Rosa' },
];

/** Hex válido (`#rrggbb`) o `undefined` — nunca se inyecta lo que venga. */
export function listColor(color: string | null | undefined): string | undefined {
    return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined;
}
