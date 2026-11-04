import { formStatSourceLabel, type FormConfig, type FormStatsDto } from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';

/**
 * v0.1.358 — Cómo se LEEN las estadísticas de un formulario (puro, con
 * tests): el embudo, el nombre de cada pregunta donde lo dejan, los orígenes
 * y el tiempo promedio en palabras.
 */

export interface FunnelRow {
    key: string;
    label: string;
    value: number;
    /** Sobre las visitas (0-1); null si no hubo visitas. */
    share: number | null;
}

/** Vieron → Empezaron → (llegaron al paso N…) → Enviaron. */
export function funnelRows(stats: FormStatsDto): FunnelRow[] {
    const views = stats.totals.views;
    const share = (n: number): number | null => (views > 0 ? Math.min(1, n / views) : null);
    const rows: FunnelRow[] = [
        { key: 'views', label: 'Lo vieron', value: views, share: views > 0 ? 1 : null },
        { key: 'starts', label: 'Empezaron a responder', value: stats.totals.starts, share: share(stats.totals.starts) },
    ];
    // El paso 1 es «empezaron»: desde el 2 en adelante cuenta.
    for (const s of stats.steps) {
        if (s.step < 2) continue;
        rows.push({ key: `step-${s.step}`, label: `Llegaron al paso ${s.step}`, value: s.reached, share: share(s.reached) });
    }
    rows.push({ key: 'submits', label: 'Lo enviaron', value: stats.totals.submits, share: share(stats.totals.submits) });
    return rows;
}

/** El nombre de una pregunta del formulario (la etiqueta propia o la del campo). */
export function questionLabel(itemId: string, config: FormConfig, fields: readonly FieldEntity[]): string {
    const byId = new Map(fields.map((f) => [f.id, f]));
    for (const i of config.items) {
        if (i.id !== itemId) continue;
        if (i.type === 'field') return i.label?.trim() || byId.get(i.field_id)?.label || 'Pregunta';
        if (i.type === 'matrix') return i.label?.trim() || 'Matriz';
    }
    return 'Una pregunta que ya no está';
}

export function sourceLabel(key: string): string {
    return formStatSourceLabel(key);
}

/** «45 s», «2 min 10 s», «1 h 5 min». */
export function durationLabel(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) return '—';
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) {
        const rest = s % 60;
        return rest ? `${m} min ${rest} s` : `${m} min`;
    }
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h} h ${rm} min` : `${h} h`;
}

/** «38 %» (sin decimales salvo por debajo del 10 %). */
export function percentLabel(share: number | null): string {
    if (share === null) return '—';
    const p = share * 100;
    return `${p > 0 && p < 10 ? p.toFixed(1).replace('.', ',') : Math.round(p)} %`;
}
