import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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

    const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

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
            return d.toLocaleDateString(undefined, { weekday: 'short' });
        });
    }, []);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <header className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <h2 className="imcrm-text-base imcrm-font-medium imcrm-capitalize">{monthLabel}</h2>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                    <Button variant="outline" size="sm" onClick={handleToday}>
                        {__('Hoy')}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePrev}
                        aria-label={__('Mes anterior')}
                    >
                        <ChevronLeft className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleNext}
                        aria-label={__('Mes siguiente')}
                    >
                        <ChevronRight className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                </div>
            </header>

            <div className="imcrm-grid imcrm-grid-cols-7 imcrm-gap-px imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-border imcrm-overflow-hidden">
                {weekdayLabels.map((d) => (
                    <div
                        key={d}
                        className="imcrm-bg-muted/40 imcrm-px-2 imcrm-py-1 imcrm-text-center imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground"
                    >
                        {d}
                    </div>
                ))}
                {cells.map((cell) => {
                    const dayRecords = recordsByDay.get(cell.iso) ?? [];
                    return (
                        <div
                            key={cell.iso}
                            className={cn(
                                'imcrm-min-h-[110px] imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-bg-card imcrm-p-1.5 imcrm-text-xs',
                                !cell.inCurrentMonth && 'imcrm-bg-muted/20 imcrm-text-muted-foreground',
                            )}
                        >
                            <div
                                className={cn(
                                    'imcrm-flex imcrm-items-center imcrm-justify-between',
                                    cell.isToday && 'imcrm-text-primary imcrm-font-semibold',
                                )}
                            >
                                <span>{cell.day}</span>
                                {dayRecords.length > 0 && (
                                    <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-text-[10px]">
                                        {dayRecords.length}
                                    </span>
                                )}
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                {dayRecords.slice(0, MAX_VISIBLE_PER_DAY).map((r) => (
                                    <button
                                        type="button"
                                        key={r.id}
                                        onClick={() => onCardClick(r)}
                                        className="imcrm-truncate imcrm-rounded imcrm-bg-primary/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-left imcrm-text-[11px] imcrm-text-primary hover:imcrm-bg-primary/20"
                                        title={titleString(r, titleField)}
                                    >
                                        {titleString(r, titleField)}
                                    </button>
                                ))}
                                {dayRecords.length > MAX_VISIBLE_PER_DAY && (
                                    <span className="imcrm-px-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                                        {sprintf(
                                            /* translators: %d: number of remaining records */
                                            __('+%d más'),
                                            dayRecords.length - MAX_VISIBLE_PER_DAY,
                                        )}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
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

    for (let i = 0; i < 42; i++) {
        // 6 semanas × 7 días — siempre.
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
