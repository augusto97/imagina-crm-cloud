import {
    AlignLeft,
    Calculator,
    Calendar,
    CalendarClock,
    CheckSquare,
    ClipboardCheck,
    CircleDollarSign,
    Clock,
    Eye,
    GitBranch,
    Hash,
    History,
    Link2,
    ScanBarcode,
    UserCheck,
    UserPen,
    CalendarPlus,
    List,
    ListChecks,
    ListTodo,
    Mail,
    MousePointerClick,
    Paperclip,
    Percent,
    Phone,
    Sigma,
    SquareFunction,
    Star,
    Timer,
    Type,
    User,
    Users,
    type LucideIcon,
    Sparkles,
} from 'lucide-react';

import type { FieldTypeSlug } from '@/types/field';

/**
 * Mapa tipo de campo → icono lucide. Único punto de verdad para que
 * las superficies que listan campos (fila de "Campos" del detalle de
 * record, grilla de metadatos, builders) muestren el mismo glifo por
 * tipo — estilo ClickUp, donde cada custom field lleva el icono de su
 * tipo al lado del label.
 */
export const FIELD_TYPE_ICONS: Record<FieldTypeSlug, LucideIcon> = {
    text: Type,
    long_text: AlignLeft,
    number: Hash,
    currency: CircleDollarSign,
    select: List,
    multi_select: ListChecks,
    date: Calendar,
    datetime: CalendarClock,
    checkbox: CheckSquare,
    email: Mail,
    url: Link2,
    user: User,
    team: Users,
    relation: GitBranch,
    file: Paperclip,
    computed: Sigma,
    formula: SquareFunction,
    phone: Phone,
    rating: Star,
    percent: Percent,
    duration: Timer,
    lookup: Eye,
    rollup: Calculator,
    ai: Sparkles,
    time_tracked: Clock,
    checklist_progress: ListTodo,
    autonumber: ScanBarcode,
    created_at: CalendarPlus,
    updated_at: History,
    created_by: UserCheck,
    updated_by: UserPen,
    button: MousePointerClick,
    approval: ClipboardCheck,
};

/** Icono para un tipo (con fallback seguro para tipos desconocidos). */
export function fieldTypeIcon(type: string): LucideIcon {
    return FIELD_TYPE_ICONS[type as FieldTypeSlug] ?? Type;
}
