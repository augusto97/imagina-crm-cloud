/**
 * v0.1.474 — Por qué FECHA filtra el período del tablero a cada widget.
 *
 * El selector de período de arriba del tablero («Este mes», «Este año»,
 * «Personalizado…») pisa el período de cada widget. Hasta v0.1.473 sólo
 * alcanzaba a los widgets con un «campo del período» propio o un campo de
 * fecha de tendencia: un gráfico agrupado por mes (ventas por mes) o un KPI
 * sin fecha quedaban afuera y el tablero «no filtraba». Ahora, en orden:
 *
 *  1. el campo del período del widget (`config.period.field_id`);
 *  2. su campo de fecha (`config.date_field_id`: tendencias, delta,
 *     pronóstico);
 *  3. el campo por el que AGRUPA, si es una fecha (barras «por mes»);
 *  4. el segundo campo, si es una fecha (desglose o columnas de la tabla
 *     dinámica);
 *  5. la fecha elegida para esa LISTA en el tablero
 *     (`settings.period_fields[listId]`), para los KPI, donas y tablas que
 *     no tienen ninguna fecha propia.
 *
 * La misma función la usan el servidor (qué condición agrega) y la pantalla
 * (qué widgets avisan que no se filtran), así nunca dicen cosas distintas.
 */

/** Tipos de campo por los que se puede filtrar un período. */
export const PERIOD_FIELD_TYPES = ['date', 'datetime', 'created_at', 'updated_at'] as const;

export function isPeriodFieldType(type: string | undefined | null): boolean {
    return typeof type === 'string' && (PERIOD_FIELD_TYPES as readonly string[]).includes(type);
}

/** De dónde salió la fecha del período de un widget. */
export type PeriodFieldSource = 'widget' | 'date' | 'group' | 'breakdown' | 'dashboard';

export interface WidgetPeriodField {
    fieldId: number;
    source: PeriodFieldSource;
}

function positiveId(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
}

/**
 * La fecha del período de un widget, o `null` si no tiene ninguna.
 *
 * `typeOf` dice el tipo de un campo de la lista del widget (`undefined` si no
 * existe o quien mira no lo ve): el campo de agrupado y la elección del
 * tablero sólo cuentan si son fechas que la persona puede ver.
 */
export function widgetPeriodField(
    config: Record<string, unknown>,
    typeOf: (fieldId: number) => string | undefined,
    dashboardChoice?: number | null,
): WidgetPeriodField | null {
    const period = config.period as { field_id?: unknown } | null | undefined;
    const own = positiveId(period?.field_id);
    if (own !== undefined) return { fieldId: own, source: 'widget' };
    const date = positiveId(config.date_field_id);
    if (date !== undefined) return { fieldId: date, source: 'date' };
    const group = positiveId(config.group_by_field_id);
    if (group !== undefined && isPeriodFieldType(typeOf(group))) return { fieldId: group, source: 'group' };
    const sub = positiveId(config.sub_group_by_field_id);
    if (sub !== undefined && isPeriodFieldType(typeOf(sub))) return { fieldId: sub, source: 'breakdown' };
    const chosen = positiveId(dashboardChoice ?? undefined);
    if (chosen !== undefined && isPeriodFieldType(typeOf(chosen))) return { fieldId: chosen, source: 'dashboard' };
    return null;
}

/**
 * `settings.period_fields` del tablero: `{ "<listId>": <fieldId> }`. Lectura
 * tolerante: lo que no sea un par de ids enteros positivos se ignora.
 */
export function readDashboardPeriodFields(settings: unknown): Map<number, number> {
    const out = new Map<number, number>();
    if (!settings || typeof settings !== 'object') return out;
    const raw = (settings as { period_fields?: unknown }).period_fields;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const listId = Number(k);
        const fieldId = positiveId(v);
        if (Number.isInteger(listId) && listId > 0 && fieldId !== undefined) out.set(listId, fieldId);
    }
    return out;
}

/** El objeto que se guarda en `settings.period_fields` (sin las listas vacías). */
export function writeDashboardPeriodFields(map: Map<number, number | null>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [listId, fieldId] of map) {
        if (fieldId !== null && fieldId > 0) out[String(listId)] = fieldId;
    }
    return out;
}

interface PeriodFieldCandidate {
    id: number;
    name: string;
    type: string;
}

/** Sin tildes ni mayúsculas, para comparar nombres. */
function plain(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Fechas que casi nunca son «cuándo pasó» (no conviene filtrar por ellas). */
const NOT_AN_EVENT = /nacimiento|cumplea|aniversario|expedicion|vigencia hasta/;
/** Lo que suele decir CUÁNDO pasó algo que se mide: un pago, una venta… */
const EVENT_WORDS: Array<[RegExp, number]> = [
    [/pago|pagado|cobro|cobrad|recaudo/, 60],
    [/venta|vendid|factura|compra|pedido|orden/, 55],
    [/cierre|cerrad|ganad|firma|contrat/, 45],
    [/inicio|alta|ingreso|registro|creacion|creado|emision|fecha/, 30],
    [/vencimiento|vence|entrega|limite/, 20],
];

/**
 * Sugiere la fecha por la que filtrar una lista en el tablero: la que suena
 * a «cuándo pasó» (pago, venta, cierre…), si no la fecha de creación del
 * registro, si no la primera fecha. Nunca una de nacimiento o similar si hay
 * otra. `null` si la lista no tiene fechas.
 */
export function suggestPeriodField(fields: PeriodFieldCandidate[]): number | null {
    const dates = fields.filter((f) => isPeriodFieldType(f.type));
    if (dates.length === 0) return null;
    let bestId: number | null = null;
    let bestScore = -Infinity;
    for (let index = 0; index < dates.length; index++) {
        const f = dates[index]!;
        const name = plain(f.name);
        let score = 0;
        for (const [re, points] of EVENT_WORDS) {
            if (re.test(name)) score = Math.max(score, points);
        }
        if (f.type === 'created_at') score = Math.max(score, 25);
        if (f.type === 'updated_at') score = Math.min(score, 5);
        if (NOT_AN_EVENT.test(name)) score = -50;
        // A igual puntaje, la que va primero en la lista.
        const total = score * 100 - index;
        if (total > bestScore) {
            bestScore = total;
            bestId = f.id;
        }
    }
    return bestId;
}
