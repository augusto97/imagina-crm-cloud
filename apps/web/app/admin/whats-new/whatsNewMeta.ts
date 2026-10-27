import { CircleCheck, Megaphone, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react';
import { WHATS_NEW_KIND_LABELS, type WhatsNewKind } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';

type BadgeTone = 'default' | 'info' | 'success' | 'warning';

/**
 * Cómo se ve cada tipo: chip con la tinta de su color (legible en claro y en
 * oscuro: el Badge usa los tokens `*-ink`) y un ícono.
 */
export const WHATS_NEW_KIND_META: Record<WhatsNewKind, { tone: BadgeTone; icon: LucideIcon }> = {
    feature: { tone: 'default', icon: Sparkles },
    improvement: { tone: 'info', icon: TrendingUp },
    fix: { tone: 'success', icon: CircleCheck },
    notice: { tone: 'warning', icon: Megaphone },
};

export function kindLabel(kind: WhatsNewKind): string {
    return __(WHATS_NEW_KIND_LABELS[kind]);
}

/** Plural para los filtros («Nuevas funciones», «Mejoras»…). */
export const WHATS_NEW_KIND_PLURALS: Record<WhatsNewKind, string> = {
    feature: 'Nuevas funciones',
    improvement: 'Mejoras',
    fix: 'Correcciones',
    notice: 'Avisos',
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «Octubre de 2026» (en la hora local de quien mira). */
export function monthLabel(date: Date): string {
    if (Number.isNaN(date.getTime())) return '';
    const m = MONTHS[date.getMonth()]!;
    return `${m.charAt(0).toUpperCase()}${m.slice(1)} de ${date.getFullYear()}`;
}

/** «26 de octubre» (o con el año si no es el actual). */
export function dayLabel(date: Date, now: Date = new Date()): string {
    if (Number.isNaN(date.getTime())) return '';
    const base = `${date.getDate()} de ${MONTHS[date.getMonth()]}`;
    return date.getFullYear() === now.getFullYear() ? base : `${base} de ${date.getFullYear()}`;
}

/** Agrupa por mes conservando el orden (lo más nuevo primero). */
export function groupByMonth<T extends { published_at: string }>(items: readonly T[], parse: (s: string) => Date): Array<{ key: string; label: string; items: T[] }> {
    const groups: Array<{ key: string; label: string; items: T[] }> = [];
    for (const item of items) {
        const d = parse(item.published_at);
        const key = Number.isNaN(d.getTime()) ? 'sin-fecha' : `${d.getFullYear()}-${d.getMonth()}`;
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.items.push(item);
        else groups.push({ key, label: monthLabel(d), items: [item] });
    }
    return groups;
}
