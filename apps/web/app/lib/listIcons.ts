import {
    Blocks,
    Bookmark,
    Briefcase,
    Bug,
    Building2,
    Calendar,
    CheckSquare,
    ClipboardList,
    Clock,
    Database,
    FileText,
    Flag,
    Folder,
    Globe,
    Heart,
    Home,
    Inbox,
    Layers,
    LifeBuoy,
    Lightbulb,
    List,
    Mail,
    Megaphone,
    Package,
    Phone,
    PieChart,
    Receipt,
    Rocket,
    ShoppingCart,
    Star,
    Tag,
    Target,
    Truck,
    Users,
    Wallet,
    Wrench,
    type LucideIcon,
} from 'lucide-react';

/**
 * Catálogo de iconos para las listas (v0.1.137).
 *
 * El usuario pidió lo que hace ClickUp: cada lista con su icono en vez de
 * un punto igual para todas. Se guarda la CLAVE (`lists.icon`, que ya
 * existía en el backend sin usarse), nunca el componente — así el nombre
 * de un icono de lucide puede cambiar sin romper los datos del cliente.
 * Lista corta y curada a propósito: un buscador con 1.500 iconos no
 * ayuda a elegir.
 */
export const LIST_ICONS: Array<{ key: string; icon: LucideIcon; label: string }> = [
    { key: 'list', icon: List, label: 'Lista' },
    { key: 'folder', icon: Folder, label: 'Carpeta' },
    { key: 'users', icon: Users, label: 'Personas' },
    { key: 'building', icon: Building2, label: 'Empresas' },
    { key: 'briefcase', icon: Briefcase, label: 'Negocios' },
    { key: 'receipt', icon: Receipt, label: 'Facturas' },
    { key: 'wallet', icon: Wallet, label: 'Pagos' },
    { key: 'shopping_cart', icon: ShoppingCart, label: 'Ventas' },
    { key: 'package', icon: Package, label: 'Productos' },
    { key: 'truck', icon: Truck, label: 'Envíos' },
    { key: 'check_square', icon: CheckSquare, label: 'Tareas' },
    { key: 'clipboard', icon: ClipboardList, label: 'Pendientes' },
    { key: 'calendar', icon: Calendar, label: 'Agenda' },
    { key: 'clock', icon: Clock, label: 'Tiempos' },
    { key: 'flag', icon: Flag, label: 'Prioridades' },
    { key: 'target', icon: Target, label: 'Objetivos' },
    { key: 'rocket', icon: Rocket, label: 'Proyectos' },
    { key: 'lightbulb', icon: Lightbulb, label: 'Ideas' },
    { key: 'bug', icon: Bug, label: 'Incidencias' },
    { key: 'lifebuoy', icon: LifeBuoy, label: 'Soporte' },
    { key: 'inbox', icon: Inbox, label: 'Entradas' },
    { key: 'mail', icon: Mail, label: 'Correos' },
    { key: 'phone', icon: Phone, label: 'Llamadas' },
    { key: 'megaphone', icon: Megaphone, label: 'Campañas' },
    { key: 'globe', icon: Globe, label: 'Sitios web' },
    { key: 'file_text', icon: FileText, label: 'Documentos' },
    { key: 'pie_chart', icon: PieChart, label: 'Reportes' },
    { key: 'database', icon: Database, label: 'Datos' },
    { key: 'layers', icon: Layers, label: 'Categorías' },
    { key: 'blocks', icon: Blocks, label: 'Módulos' },
    { key: 'wrench', icon: Wrench, label: 'Servicios' },
    { key: 'tag', icon: Tag, label: 'Etiquetas' },
    { key: 'bookmark', icon: Bookmark, label: 'Guardados' },
    { key: 'star', icon: Star, label: 'Destacados' },
    { key: 'heart', icon: Heart, label: 'Favoritos' },
    { key: 'home', icon: Home, label: 'General' },
];

/**
 * Icono de las listas que no eligieron uno (v0.1.139). Antes caían a un
 * puntito gris igual para todas — el usuario lo pidió explícitamente: toda
 * lista se ve con icono, elija o no.
 */
export const DEFAULT_LIST_ICON: LucideIcon = List;

/** El icono de una lista, o `undefined` si no eligió ninguno (o es viejo). */
export function listIcon(key: string | null | undefined): LucideIcon | undefined {
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
