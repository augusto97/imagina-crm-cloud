import { useMemo, useState } from 'react';
import { jsonbKeyForField, type Field, type RecordDto } from '@imagina-base/shared';
import { formatValue } from '@/cloud/lib/fieldValue';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Vista de calendario: ubica los records en una grilla mensual según un campo
 * `date`/`datetime`. Navegación ‹ › por mes. Read-only (click → drawer). Es el
 * tipo de vista `calendar` del CONTRACT §7; referencia el campo por id.
 */
export function CalendarView({
    fields,
    records,
    onOpen,
}: {
    fields: Field[];
    records: RecordDto[];
    onOpen: (record: RecordDto) => void;
}): JSX.Element {
    const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
    const [dateFieldId, setDateFieldId] = useState<number | null>(dateFields[0]?.id ?? null);
    const titleField = fields.find((f) => f.type === 'text') ?? fields[0];
    const dateField = fields.find((f) => f.id === dateFieldId) ?? null;

    const [cursor, setCursor] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() };
    });

    const byDay = useMemo(() => {
        const map = new Map<string, RecordDto[]>();
        if (!dateField) return map;
        const key = jsonbKeyForField(dateField.id);
        for (const r of records) {
            const raw = r.data[key];
            const day = toDayKey(raw);
            if (!day) continue;
            (map.get(day) ?? map.set(day, []).get(day)!).push(r);
        }
        return map;
    }, [records, dateField]);

    if (!dateField) {
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-min-h-32 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
                Agregá un campo <code className="imcrm-mx-1">date</code> para usar el calendario.
            </div>
        );
    }

    const cells = monthGrid(cursor.year, cursor.month);

    const shift = (delta: number) =>
        setCursor((c) => {
            const m = c.month + delta;
            return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
        });

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <button
                        onClick={() => shift(-1)}
                        aria-label="Mes anterior"
                        className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-1 imcrm-text-sm hover:imcrm-bg-muted"
                    >
                        ‹
                    </button>
                    <span className="imcrm-min-w-40 imcrm-text-center imcrm-text-sm imcrm-font-medium imcrm-capitalize">
                        {MONTHS[cursor.month]} {cursor.year}
                    </span>
                    <button
                        onClick={() => shift(1)}
                        aria-label="Mes siguiente"
                        className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-1 imcrm-text-sm hover:imcrm-bg-muted"
                    >
                        ›
                    </button>
                </div>
                {dateFields.length > 1 && (
                    <select
                        aria-label="Campo de fecha"
                        value={dateField.id}
                        onChange={(e) => setDateFieldId(Number(e.target.value))}
                        className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-text-sm"
                    >
                        {dateFields.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <div className="imcrm-grid imcrm-grid-cols-7 imcrm-gap-px imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                {WEEKDAYS.map((d) => (
                    <div key={d} className="imcrm-px-2 imcrm-py-1">
                        {d}
                    </div>
                ))}
            </div>
            <div className="imcrm-grid imcrm-min-h-0 imcrm-flex-1 imcrm-grid-cols-7 imcrm-gap-px imcrm-overflow-auto imcrm-rounded-lg imcrm-bg-border">
                {cells.map((cell, i) => {
                    const items = cell ? (byDay.get(cell.key) ?? []) : [];
                    return (
                        <div
                            key={cell ? cell.key : `pad-${i}`}
                            className={[
                                'imcrm-min-h-24 imcrm-space-y-1 imcrm-p-1',
                                cell ? 'imcrm-bg-card' : 'imcrm-bg-muted/20',
                            ].join(' ')}
                        >
                            {cell && (
                                <div className="imcrm-px-1 imcrm-text-xs imcrm-text-muted-foreground">
                                    {cell.day}
                                </div>
                            )}
                            {items.map((r) => (
                                <button
                                    key={r.id}
                                    onClick={() => onOpen(r)}
                                    className="imcrm-block imcrm-w-full imcrm-truncate imcrm-rounded imcrm-bg-primary/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-left imcrm-text-xs hover:imcrm-bg-primary/20"
                                >
                                    {titleField
                                        ? formatValue(titleField, r.data[jsonbKeyForField(titleField.id)]) || `#${r.id}`
                                        : `#${r.id}`}
                                </button>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** Normaliza un valor de fecha a `yyyy-mm-dd` local, o null si no parsea. */
function toDayKey(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    // `date` ya viene como yyyy-mm-dd; `datetime` como ISO — tomamos la fecha.
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Grilla de 6 semanas (lunes primero) con padding null antes/después del mes. */
function monthGrid(year: number, month: number): Array<{ key: string; day: number } | null> {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay(): 0=domingo … 6=sábado. Convertimos a lunes-primero (0=lunes).
    const lead = (first.getDay() + 6) % 7;
    const cells: Array<{ key: string; day: number } | null> = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${pad(month + 1)}-${pad(d)}`;
        cells.push({ key, day: d });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}
