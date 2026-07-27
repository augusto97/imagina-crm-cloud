import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { colorVar, type OptionColor } from '@/components/ui/color-picker';
import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Vista Calendar: mes actual con cada record colocado en el día de su
 * `date_field`. Sin librerías externas — un grid 7×N con días del mes y
 * relleno gris para los días del mes anterior/siguiente que completan
 * la primera y última semana.
 *
 * Decisiones de scope:
 * - Solo vista mensual. Vista semana/día llega cuando el caso de uso
 *   lo justifique.
 * - Día = celda con hasta 3 records visibles + "+N más". Click en
 *   record abre el drawer.
 * - Navegación con prev/next/Hoy (mantiene mes actual en estado local
 *   — no parte del saved view config).
 * - Las fechas vienen del backend en UTC; se convierten a la zona del
 *   navegador con `Date.parse + Z` (mismo patrón usado en otras
 *   pantallas).
 */
interface CalendarViewProps {
    fields: FieldEntity[];
    records: RecordEntity[];
    dateField: FieldEntity;
    onCardClick: (record: RecordEntity) => void;
}

interface CalendarCell {
    iso: string; // YYYY-MM-DD en local
    day: number;
    inCurrentMonth: boolean;
    isToday: boolean;
}

const MAX_VISIBLE_PER_DAY = 3;
/** Nombres de mes y día en el idioma de la interfaz. */
const CALENDAR_LOCALE = 'es';

/** "julio de 2026" → "Julio de 2026" (el `capitalize` de CSS daba "Julio De"). */
function capitalizeFirst(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export function CalendarView({
    fields,
    records,
    dateField,
    onCardClick,
}: CalendarViewProps): JSX.Element {
    const [cursor, setCursor] = useState<Date>(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });

    const cells = useMemo<CalendarCell[]>(() => buildMonthCells(cursor), [cursor]);
    // Día con la lista completa desplegada ("+N más").
    const [expandedDay, setExpandedDay] = useState<string | null>(null);

    // Indexa records por día local (YYYY-MM-DD).
    const recordsByDay = useMemo(() => {
        const map = new Map<string, RecordEntity[]>();
        for (const r of records) {
            const raw = r.fields[dateField.slug];
            if (typeof raw !== 'string' || raw === '') continue;
            const iso = parseToLocalIso(raw);
            if (iso === null) continue;
            if (!map.has(iso)) map.set(iso, []);
            map.get(iso)!.push(r);
        }
        return map;
    }, [records, dateField.slug]);

    const titleField = useMemo(() => pickTitleField(fields, dateField.id), [fields, dateField.id]);

    // La interfaz es en español: el locale del NAVEGADOR mostraba "July 2026"
    // y MON/TUE en un calendario que dice "Hoy" y "Ver menos" (v0.1.125).
    const monthLabel = capitalizeFirst(
        cursor.toLocaleDateString(CALENDAR_LOCALE, { month: 'long', year: 'numeric' }),
    );

    const handlePrev = (): void =>
        setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
    const handleNext = (): void =>
        setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
    const handleToday = (): void => {
        const n = new Date();
        setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    };

    const weekdayLabels = useMemo(() => {
        // 7 días desde un lunes para etiquetas localizadas.
        const monday = new Date(2024, 0, 1); // 1 enero 2024 = lunes
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            return d.toLocaleDateString(CALENDAR_LOCALE, { weekday: 'short' });
        });
    }, []);

    // v0.1.125 — los eventos toman el color del primer campo select del
    // registro (el mismo de los chips de la tabla y las columnas del Kanban):
    // un calendario en un solo tono no deja distinguir nada de un vistazo.
    const colorField = useMemo(
        () => fields.find((f) => f.type === 'select' && f.id !== dateField.id),
        [fields, dateField.id],
    );
    const optionColor = (record: RecordEntity): OptionColor | undefined => {
        if (!colorField) return undefined;
        const value = record.fields[colorField.slug];
        if (typeof value !== 'string' || value === '') return undefined;
        const options = (colorField.config as { options?: Array<{ value: string; color?: string }> })
            .options;
        const opt = Array.isArray(options) ? options.find((o) => o.value === value) : undefined;
        return (opt?.color as OptionColor | undefined) ?? undefined;
    };

    const monthCount = cells.reduce(
        (n, c) => n + (c.inCurrentMonth ? (recordsByDay.get(c.iso)?.length ?? 0) : 0),
        0,
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                <div className="imcrm-flex imcrm-items-baseline imcrm-gap-2">
                    <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">
                        {monthLabel}
                    </h2>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {sprintf(
                            /* translators: %d: records in the visible month */
                            __('%d registros'),
                            monthCount,
                        )}
                    </span>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <Button variant="outline" size="sm" onClick={handleToday} className="imcrm-h-8">
                        {__('Hoy')}
                    </Button>
                    {/* Navegación agrupada: dos flechas pegadas leen como un
                        control único (antes eran dos botones sueltos). */}
                    <div className="imcrm-flex imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border">
                        <button
                            type="button"
                            onClick={handlePrev}
                            aria-label={__('Mes anterior')}
                            className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <ChevronLeft className="imcrm-h-4 imcrm-w-4" />
                        </button>
                        <span className="imcrm-w-px imcrm-bg-border" aria-hidden />
                        <button
                            type="button"
                            onClick={handleNext}
                            aria-label={__('Mes siguiente')}
                            className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <ChevronRight className="imcrm-h-4 imcrm-w-4" />
                        </button>
                    </div>
                </div>
            </header>

            <div className="imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm">
                <div className="imcrm-grid imcrm-grid-cols-7 imcrm-border-b imcrm-border-border imcrm-bg-muted/40">
                    {weekdayLabels.map((d, i) => (
                        <div
                            key={d}
                            className={cn(
                                'imcrm-px-2 imcrm-py-2 imcrm-text-center imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground',
                                i >= 5 && 'imcrm-text-muted-foreground/70',
                            )}
                        >
                            {d}
                        </div>
                    ))}
                </div>
                <div className="imcrm-grid imcrm-grid-cols-7">
                    {cells.map((cell, idx) => {
                        const dayRecords = recordsByDay.get(cell.iso) ?? [];
                        const expanded = expandedDay === cell.iso;
                        const visible = expanded ? dayRecords : dayRecords.slice(0, MAX_VISIBLE_PER_DAY);
                        const isWeekend = idx % 7 >= 5;
                        return (
                            <div
                                key={cell.iso}
                                className={cn(
                                    'imcrm-flex imcrm-min-h-[116px] imcrm-flex-col imcrm-gap-1 imcrm-border-b imcrm-border-r imcrm-border-border/70 imcrm-p-1.5 imcrm-text-xs imcrm-transition-colors',
                                    // Sin bordes colgando en la última columna/fila.
                                    idx % 7 === 6 && 'imcrm-border-r-0',
                                    idx >= cells.length - 7 && 'imcrm-border-b-0',
                                    cell.inCurrentMonth
                                        ? isWeekend
                                            ? 'imcrm-bg-muted/20'
                                            : 'imcrm-bg-card'
                                        : 'imcrm-bg-muted/40 imcrm-text-muted-foreground',
                                    'hover:imcrm-bg-accent/40',
                                )}
                            >
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                                    {/* Hoy = disco primary, como un calendario de verdad. */}
                                    <span
                                        className={cn(
                                            'imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-[12px] imcrm-font-semibold',
                                            cell.isToday
                                                ? 'imcrm-bg-primary imcrm-text-primary-foreground'
                                                : cell.inCurrentMonth
                                                  ? 'imcrm-text-foreground'
                                                  : 'imcrm-text-muted-foreground/70',
                                        )}
                                    >
                                        {cell.day}
                                    </span>
                                    {dayRecords.length > 0 && (
                                        <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground">
                                            {dayRecords.length}
                                        </span>
                                    )}
                                </div>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    {visible.map((r) => {
                                        const color = optionColor(r);
                                        const solid = colorVar(color);
                                        return (
                                            <button
                                                type="button"
                                                key={r.id}
                                                onClick={() => onCardClick(r)}
                                                className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-truncate imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-left imcrm-text-[11px] imcrm-font-medium imcrm-transition-opacity hover:imcrm-opacity-80"
                                                style={
                                                    solid !== undefined
                                                        ? {
                                                              backgroundColor: `color-mix(in srgb, ${solid} 16%, transparent)`,
                                                              color: 'hsl(var(--imcrm-foreground))',
                                                          }
                                                        : {
                                                              backgroundColor:
                                                                  'hsl(var(--imcrm-primary) / 0.12)',
                                                              color: 'hsl(var(--imcrm-foreground))',
                                                          }
                                                }
                                                title={titleString(r, titleField)}
                                            >
                                                <span
                                                    aria-hidden
                                                    className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full"
                                                    style={{
                                                        backgroundColor:
                                                            solid ?? 'hsl(var(--imcrm-primary))',
                                                    }}
                                                />
                                                <span className="imcrm-truncate">
                                                    {titleString(r, titleField)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {dayRecords.length > MAX_VISIBLE_PER_DAY && (
                                        // Antes era texto muerto: ahora despliega el día.
                                        <button
                                            type="button"
                                            onClick={() => setExpandedDay(expanded ? null : cell.iso)}
                                            className="imcrm-self-start imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                        >
                                            {expanded
                                                ? __('Ver menos')
                                                : sprintf(
                                                      /* translators: %d: number of remaining records */
                                                      __('+%d más'),
                                                      dayRecords.length - MAX_VISIBLE_PER_DAY,
                                                  )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {monthCount === 0 && (
                <p className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <CalendarDays className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Ningún registro cae en este mes.')}
                </p>
            )}
        </div>
    );
}

function buildMonthCells(cursor: Date): CalendarCell[] {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOfGrid = new Date(firstOfMonth);
    // Lunes como día 1 (getDay() en JS: Domingo=0). Calculamos cuántos
    // días retroceder para caer en el lunes de la primera fila.
    const dayOfWeek = (firstOfMonth.getDay() + 6) % 7; // Lunes=0..Domingo=6
    startOfGrid.setDate(firstOfMonth.getDate() - dayOfWeek);

    const cells: CalendarCell[] = [];
    const today = new Date();
    const todayIso = toLocalIso(today);

    // 5 o 6 semanas según lo que ocupe el mes: forzar 42 celdas dejaba una
    // fila entera de días del mes siguiente (ruido puro).
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const total = Math.ceil((dayOfWeek + daysInMonth) / 7) * 7;
    for (let i = 0; i < total; i++) {
        const d = new Date(startOfGrid);
        d.setDate(startOfGrid.getDate() + i);
        const iso = toLocalIso(d);
        cells.push({
            iso,
            day: d.getDate(),
            inCurrentMonth: d.getMonth() === month,
            isToday: iso === todayIso,
        });
    }
    return cells;
}

function toLocalIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

/**
 * Convierte el string que llega del backend (UTC ISO o YYYY-MM-DD) al
 * iso local del día en que cae. Para columnas tipo `date` el back envía
 * "YYYY-MM-DD" — sin TZ, lo dejamos como está. Para `datetime` envía
 * "YYYY-MM-DD HH:MM:SS" UTC; lo parseamos como UTC y derivamos el día
 * local.
 */
function parseToLocalIso(raw: string): string | null {
    // YYYY-MM-DD puro (date field).
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
    }
    // datetime → asumir UTC (el back lo guarda así en CLAUDE.md §11).
    const ts = Date.parse(raw.replace(' ', 'T') + 'Z');
    if (Number.isNaN(ts)) return null;
    return toLocalIso(new Date(ts));
}

function pickTitleField(fields: FieldEntity[], excludeId: number): FieldEntity | undefined {
    const primary = fields.find((f) => f.is_primary);
    if (primary) return primary;
    return fields.find((f) => f.id !== excludeId && (f.type === 'text' || f.type === 'email'));
}

function titleString(record: RecordEntity, titleField?: FieldEntity): string {
    if (titleField) {
        const v = record.fields[titleField.slug];
        if (typeof v === 'string' && v !== '') return v;
    }
    return sprintf(
        /* translators: %d: record id */
        __('Registro #%d'),
        record.id,
    );
}
