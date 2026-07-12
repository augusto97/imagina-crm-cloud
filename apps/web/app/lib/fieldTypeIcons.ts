import {
    AlignLeft,
    Calendar,
    CalendarClock,
    CheckSquare,
    CircleDollarSign,
    GitBranch,
    Hash,
    Link2,
    List,
    ListChecks,
    Mail,
    Paperclip,
    Sigma,
    Type,
    User,
    type LucideIcon,
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
    relation: GitBranch,
    file: Paperclip,
    computed: Sigma,
};

/** Icono para un tipo (con fallback seguro para tipos desconocidos). */
export function fieldTypeIcon(type: string): LucideIcon {
    return FIELD_TYPE_ICONS[type as FieldTypeSlug] ?? Type;
}
