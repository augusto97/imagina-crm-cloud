import {
    workloadBucketCapacity,
    workloadLevel,
    type WorkloadBucket,
    type WorkloadBundle,
    type WorkloadLevel,
    type WorkloadMetric,
    type WorkloadPerson,
    type WorkloadZoom,
} from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';

/**
 * B2 — Lo que la vista «Carga de trabajo» necesita además de shared: cómo se
 * escribe un valor (registros u horas), los colores de cada nivel (en claro y
 * en oscuro, con los tokens semánticos del tema) y las etiquetas de las
 * columnas. Puro: se prueba sin montar la vista.
 */

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];

function parts(ymd: string): { y: number; m: number; d: number; dow: number } {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/**
 * Un valor de la carga: registros («3»), u horas en esfuerzo y tiempo («6 h»,
 * «6,5 h», «45 min»). Los decimales y separadores son los de la empresa.
 */
export function formatWorkloadValue(value: number, metric: WorkloadMetric): string {
    if (metric === 'count') return formatNumber(Math.round(value * 10) / 10, { maxFrac: 1 });
    const minutes = Math.max(0, value);
    if (minutes > 0 && minutes < 60) return sprintf(__('%s min'), formatNumber(Math.round(minutes)));
    const hours = Math.round((minutes / 60) * 10) / 10;
    return sprintf(__('%s h'), formatNumber(hours, { maxFrac: 1 }));
}

/** «6 h de 8 h» / «3 de 10 registros». */
export function formatUsage(value: number, capacity: number, metric: WorkloadMetric): string {
    if (metric === 'count') {
        return sprintf(__('%1$s de %2$s registros'), formatWorkloadValue(value, metric), formatWorkloadValue(capacity, metric));
    }
    return sprintf(__('%1$s de %2$s'), formatWorkloadValue(value, metric), formatWorkloadValue(capacity, metric));
}

/** Porcentaje de uso (0 sin capacidad); redondeado. */
export function usagePercent(value: number, capacity: number): number {
    if (capacity <= 0) return value > 0 ? 999 : 0;
    return Math.round((value / capacity) * 100);
}

/**
 * Clases por nivel. Los tonos son los semánticos del tema (éxito, aviso,
 * peligro) mezclados con transparencia sobre la superficie y, para el TEXTO,
 * sus tintas (`text-success/warning/destructive` usan la tinta legible del
 * tema en claro y en oscuro).
 */
export const LEVEL_CLASSES: Record<WorkloadLevel, { cell: string; bar: string; text: string }> = {
    empty: { cell: '', bar: '', text: 'imcrm-text-muted-foreground' },
    ok: { cell: 'imcrm-bg-success/10', bar: 'imcrm-bg-success/45', text: 'imcrm-text-success' },
    near: { cell: 'imcrm-bg-warning/15', bar: 'imcrm-bg-warning/60', text: 'imcrm-text-warning' },
    over: { cell: 'imcrm-bg-destructive/10 imcrm-ring-1 imcrm-ring-inset imcrm-ring-destructive/50', bar: 'imcrm-bg-destructive/60', text: 'imcrm-text-destructive' },
};

export const LEVEL_LABEL: Record<WorkloadLevel, string> = {
    empty: __('Libre'),
    ok: __('Con espacio'),
    near: __('Cerca del límite'),
    over: __('Por encima de la capacidad'),
};

/** Cabecera de una columna: «lu 26», «26 oct» (semana) o «oct 2026». */
export function bucketLabel(bucket: Pick<WorkloadBucket, 'key' | 'start'>, zoom: WorkloadZoom): { top: string; bottom: string } {
    const p = parts(bucket.key);
    if (zoom === 'day') return { top: WEEKDAYS[p.dow] ?? '', bottom: String(p.d) };
    if (zoom === 'week') return { top: __('Semana'), bottom: `${p.d} ${MONTHS[p.m - 1]}` };
    return { top: String(p.y), bottom: MONTHS[p.m - 1] ?? '' };
}

/** «26 oct – 8 nov 2026». */
export function rangeLabel(from: string, to: string): string {
    const a = parts(from);
    const b = parts(to);
    const left = a.y === b.y ? `${a.d} ${MONTHS[a.m - 1]}` : `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
    return `${left} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** «26 oct» de un día (para el título del panel y las fechas de un registro). */
export function shortDate(ymd: string): string {
    const p = parts(ymd);
    return `${p.d} ${MONTHS[p.m - 1]}`;
}

/** ¿Es fin de semana (sábado o domingo)? */
export function isWeekendYmd(ymd: string): boolean {
    const dow = parts(ymd).dow;
    return dow === 0 || dow === 6;
}

/** ¿La columna contiene `today`? */
export function bucketHas(bucket: Pick<WorkloadBucket, 'start' | 'end'>, today: string): boolean {
    return bucket.start <= today && today <= bucket.end;
}

/** Valor, capacidad y nivel de una celda (persona × columna). */
export function cellState(
    bundle: Pick<WorkloadBundle, 'grid' | 'meta'>,
    person: Pick<WorkloadPerson, 'key' | 'capacity'>,
    bucket: WorkloadBucket,
    unassignedKey: string,
): { value: number; capacity: number; level: WorkloadLevel } {
    const value = bundle.grid[person.key]?.[bucket.key] ?? 0;
    if (person.key === unassignedKey) return { value, capacity: 0, level: value > 0 ? 'ok' : 'empty' };
    const capacity = workloadBucketCapacity(person.capacity, bundle.meta.metric, bucket.days);
    return { value, capacity, level: workloadLevel(value, capacity) };
}

/** Iniciales para el avatar de una fila («Ana Pérez» → «AP»). */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
    return `${words[0]![0] ?? ''}${words[words.length - 1]![0] ?? ''}`.toUpperCase();
}

export const DAY_LABELS_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export const DAY_LABELS_LONG = [__('domingo'), __('lunes'), __('martes'), __('miércoles'), __('jueves'), __('viernes'), __('sábado')];

/** «lunes a viernes», «lunes, miércoles y viernes», «ningún día». */
export function workDaysLabel(days: readonly number[]): string {
    const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    if (sorted.length === 0) return __('ningún día');
    const isRun = sorted.every((d, i) => i === 0 || (d - sorted[i - 1]! + 7) % 7 === 1);
    if (isRun && sorted.length > 2) return sprintf(__('%1$s a %2$s'), DAY_LABELS_LONG[sorted[0]!] ?? '', DAY_LABELS_LONG[sorted[sorted.length - 1]!] ?? '');
    const names = sorted.map((d) => DAY_LABELS_LONG[d] ?? '');
    if (names.length === 1) return names[0]!;
    return sprintf(__('%1$s y %2$s'), names.slice(0, -1).join(', '), names[names.length - 1] ?? '');
}
