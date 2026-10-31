import type { AiProposalPreview } from '../schemas/ai';
import { aiProposalPreviewSchema } from '../schemas/ai';
import type { FieldProfile, ListProfile } from './profile';
import { foldLabel } from './profile';
import type { ListSuggestionCategory } from './schema';

/**
 * v0.1.341 (ADR-S89) — Sugerencias por REGLAS: gratis, sin IA, a partir del
 * perfil de la lista. Cada una dice POR QUÉ con los números de la lista y
 * sabe cómo aplicarse: con las MISMAS herramientas validadas del asistente
 * (`propose_create_view`, `propose_create_dashboard`), convirtiendo un campo,
 * o llevando a una pantalla. No repite lo que la lista ya tiene.
 */

export type RuleTool = 'propose_create_view' | 'propose_create_dashboard';

export type RuleAction =
    | { type: 'tool'; tool: RuleTool; input: Record<string, unknown>; label: string }
    | { type: 'convert_field'; field_id: number; to: 'select'; label: string }
    | { type: 'link'; href: string; label: string };

export interface RuleSuggestion {
    key: string;
    category: ListSuggestionCategory;
    title: string;
    why: string;
    action: RuleAction;
    preview: AiProposalPreview | null;
}

const DUE_RE = /(venc|entrega|limite|deadline|cierre|proxim|cita|evento|programad|pago|cobro|plazo)/;
const START_RE = /(inicio|comienzo|desde|arranque|start)/;
const END_RE = /(fin\b|final|termin|hasta|entrega|end\b)/;
const MONEY_RE = /(monto|valor|precio|total|importe|saldo|costo|venta|presupuesto|cuota|tarifa)/;
const CONTACT_RE = /(contacto|cliente|lead|prospecto|solicitud|inscrip|candidat|ticket|pedido|reserva|registro|postulac|interesad)/;
/** Campos que identifican a algo (un repetido ahí suele ser un duplicado). */
const IDENTITY_RE = /(nit|documento|cedula|identific|codigo|sku|placa|referencia|correo|email|telefono|celular|whatsapp)/;

const DATE_TYPES = new Set(['date', 'datetime']);

function lower(s: string): string {
    return s.toLocaleLowerCase('es');
}

export function fmtCount(n: number): string {
    return Math.round(n).toLocaleString('es-CO');
}

function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
}

function preview(partial: Partial<AiProposalPreview>): AiProposalPreview {
    return aiProposalPreviewSchema.parse(partial);
}

/** El campo de dinero de la lista (moneda primero; si no, un número que se llama como plata). */
export function moneyField(fields: ReadonlyArray<FieldProfile>): FieldProfile | undefined {
    return fields.find((f) => f.type === 'currency') ?? fields.find((f) => f.type === 'number' && MONEY_RE.test(foldLabel(f.label)));
}

/** La fecha que más importa: un vencimiento gana a una «Fecha» suelta; nunca una de inicio si hay otra. */
export function dueField(fields: ReadonlyArray<FieldProfile>): FieldProfile | undefined {
    const dates = fields.filter((f) => DATE_TYPES.has(f.type));
    return (
        dates.find((f) => DUE_RE.test(foldLabel(f.label))) ??
        dates.find((f) => !START_RE.test(foldLabel(f.label))) ??
        dates[0]
    );
}

function startEnd(fields: ReadonlyArray<FieldProfile>): { start: FieldProfile; end: FieldProfile } | null {
    const dates = fields.filter((f) => DATE_TYPES.has(f.type));
    const start = dates.find((f) => START_RE.test(foldLabel(f.label)));
    const end = dates.find((f) => f !== start && END_RE.test(foldLabel(f.label)) && f.type === start?.type);
    return start && end ? { start, end } : null;
}

/** Todas las sugerencias por reglas de la lista, en orden de valor. */
export function buildRuleSuggestions(p: ListProfile): RuleSuggestion[] {
    const out: RuleSuggestion[] = [];
    const slug = p.list.slug;
    const listHref = `/lists/${encodeURIComponent(slug)}`;
    const visible = p.fields;
    const status = p.status ? visible.find((f) => f.id === p.status!.fieldId) : undefined;
    const money = moneyField(visible);
    const due = dueField(visible);
    const has = p.total > 0 && p.sampled > 0;
    const sampleNote = p.total > p.sampled ? ` (en los ${fmtCount(p.sampled)} más recientes)` : '';

    // 1) Tablero por estado (kanban).
    if (status && !p.views.some((v) => v.type === 'kanban' && v.group_by_field_id === status.id)) {
        const opts = (status.options ?? []).filter((o) => o.value !== '');
        const busiest = [...opts].sort((a, b) => b.count - a.count)[0];
        const why = has
            ? `«${status.label}» reparte tus ${fmtCount(p.sampled)} registros en ${opts.length} etapas${busiest && busiest.count > 0 ? ` (la más llena: «${busiest.label}», con ${fmtCount(busiest.count)})` : ''}. En columnas se ve dónde se acumula el trabajo y se mueve arrastrando.`
            : `«${status.label}» tiene ${opts.length} opciones: en un tablero cada una es una columna y los registros se mueven arrastrando.`;
        out.push({
            key: `view.kanban.f${status.id}`,
            category: 'view',
            title: `Tablero por «${status.label}»`,
            why: money ? `${why} Además suma «${money.label}» en cada columna.` : why,
            action: {
                type: 'tool',
                tool: 'propose_create_view',
                label: 'Crear la vista',
                input: {
                    list: slug,
                    view: { name: `Por ${lower(status.label)}`, type: 'kanban', group_by: status.slug, ...(money ? { value_field: money.slug } : {}) },
                },
            },
            preview: null,
        });
    }

    // 2) Calendario de la fecha principal.
    if (due && !p.views.some((v) => v.type === 'calendar' && v.date_field_id === due.id)) {
        const d = due.date;
        const why =
            has && d
                ? `«${due.label}» tiene fecha en ${fmtCount(due.filled)} de ${fmtCount(p.sampled)} registros${d.next30 > 0 ? `; ${fmtCount(d.next30)} ${plural(d.next30, 'cae', 'caen')} en los próximos 30 días` : ''}. En el calendario ves qué viene sin buscar.`
                : `Ve cada registro el día de «${due.label}», por mes, semana o día.`;
        out.push({
            key: `view.calendar.f${due.id}`,
            category: 'view',
            title: `Calendario de «${due.label}»`,
            why,
            action: {
                type: 'tool',
                tool: 'propose_create_view',
                label: 'Crear la vista',
                input: {
                    list: slug,
                    view: {
                        name: `Calendario de ${lower(due.label)}`,
                        type: 'calendar',
                        date_field: due.slug,
                        ...(status ? { color_by: 'field', color_field: status.slug } : {}),
                    },
                },
            },
            preview: null,
        });
    }

    // 3) Vencidos sin cerrar.
    if (due?.date && due.date.past_open > 0 && !p.views.some((v) => v.type === 'table' && v.filter_field_ids.includes(due.id))) {
        const doneValues = p.status?.doneValues ?? [];
        const filters: Array<Record<string, unknown>> = [{ field: due.slug, op: 'between_relative', value: 'before_today' }];
        if (status && doneValues.length > 0) filters.push({ field: status.slug, op: 'nin', value: doneValues });
        const n = due.date.past_open;
        out.push({
            key: `view.overdue.f${due.id}`,
            category: 'view',
            title: 'Vista «Vencidos»',
            why: `${fmtCount(n)} ${plural(n, 'registro tiene', 'registros tienen')} «${due.label}» anterior a hoy${status && doneValues.length > 0 ? ` y ${plural(n, 'sigue', 'siguen')} sin cerrar` : ''}${sampleNote}. Una vista que los junte, ordenados del más atrasado, se mantiene sola.`,
            action: {
                type: 'tool',
                tool: 'propose_create_view',
                label: 'Crear la vista',
                input: {
                    list: slug,
                    view: { name: 'Vencidos', type: 'table', filters, sort: [{ field: due.slug, dir: 'asc' }] },
                },
            },
            preview: null,
        });
    }

    // 4) Línea de tiempo (gantt) con inicio y fin.
    const se = startEnd(visible);
    if (se && !p.views.some((v) => v.type === 'gantt')) {
        out.push({
            key: `view.gantt.f${se.start.id}.f${se.end.id}`,
            category: 'view',
            title: 'Línea de tiempo (Gantt)',
            why: `Tus registros tienen «${se.start.label}» y «${se.end.label}»: en una línea de tiempo se ven como barras, se reprograman arrastrando y se notan los cruces.`,
            action: {
                type: 'tool',
                tool: 'propose_create_view',
                label: 'Crear la vista',
                input: {
                    list: slug,
                    view: {
                        name: 'Línea de tiempo',
                        type: 'gantt',
                        start_field: se.start.slug,
                        end_field: se.end.slug,
                        ...(status ? { color_by: 'field', color_field: status.slug } : {}),
                    },
                },
            },
            preview: null,
        });
    }

    // 5) Carga de trabajo por persona.
    const person = visible.find((f) => f.type === 'user' && (f.distinct ?? 0) >= 2);
    if (person && due && p.sampled >= 10 && !p.views.some((v) => v.type === 'workload')) {
        out.push({
            key: `view.workload.f${person.id}`,
            category: 'view',
            title: `Carga de trabajo por «${person.label}»`,
            why: `${fmtCount(person.distinct ?? 0)} personas tienen registros asignados en «${person.label}». Una vista de carga muestra quién está saturado cada semana según «${due.label}».`,
            action: {
                type: 'tool',
                tool: 'propose_create_view',
                label: 'Crear la vista',
                input: { list: slug, view: { name: 'Carga de trabajo', type: 'workload', person_field: person.slug, start_field: due.slug } },
            },
            preview: null,
        });
    }

    // 6) Un tablero de resumen.
    if (p.dashboards.length === 0) {
        const widgets: Array<Record<string, unknown>> = [{ type: 'kpi', title: 'Registros', list: slug, metric: 'count', width: money ? 3 : 4 }];
        const pv: Array<{ type: string; title: string; detail: string | null }> = [{ type: 'kpi', title: 'Registros', detail: 'Cantidad' }];
        if (money) {
            widgets.push({ type: 'kpi', title: `Total ${lower(money.label)}`, list: slug, metric: 'sum', metric_field: money.slug, width: 3 });
            pv.push({ type: 'kpi', title: `Total ${lower(money.label)}`, detail: `Suma de «${money.label}»` });
        }
        if (due?.date && due.date.past_open > 0) {
            const doneValues = p.status?.doneValues ?? [];
            const filters: Array<Record<string, unknown>> = [{ field: due.slug, op: 'between_relative', value: 'before_today' }];
            if (status && doneValues.length > 0) filters.push({ field: status.slug, op: 'nin', value: doneValues });
            widgets.push({ type: 'kpi', title: 'Vencidos', list: slug, metric: 'count', filters, width: money ? 3 : 4 });
            pv.push({ type: 'kpi', title: 'Vencidos', detail: `«${due.label}» anterior a hoy` });
        }
        if (status) {
            widgets.push({ type: 'chart_pie', title: `Por ${lower(status.label)}`, list: slug, group_by: status.slug });
            pv.push({ type: 'chart_pie', title: `Por ${lower(status.label)}`, detail: 'Reparto' });
        }
        const timeField = due ?? visible.find((f) => DATE_TYPES.has(f.type));
        if (timeField) {
            widgets.push({
                type: 'chart_bar',
                title: 'Por mes',
                list: slug,
                group_by: timeField.slug,
                time_bucket: 'month',
                orientation: 'vertical',
                ...(money ? { metric: 'sum', metric_field: money.slug } : {}),
            });
            pv.push({ type: 'chart_bar', title: 'Por mes', detail: money ? `Suma de «${money.label}» por «${timeField.label}»` : `Cantidad por «${timeField.label}»` });
        }
        if (person) {
            widgets.push({ type: 'chart_bar', title: `Por ${lower(person.label)}`, list: slug, group_by: person.slug });
            pv.push({ type: 'chart_bar', title: `Por ${lower(person.label)}`, detail: 'Cantidad por persona' });
        }
        if (widgets.length >= 3) {
            out.push({
                key: 'dashboard.summary',
                category: 'dashboard',
                title: `Tablero de «${p.list.name}»`,
                why: has
                    ? `Todavía no hay un tablero con esta lista. Con ${fmtCount(p.total)} registros, uno te muestra los totales${status ? ', el reparto por etapa' : ''}${timeField ? ' y cómo evoluciona mes a mes' : ''} de un vistazo.`
                    : `Deja armado el tablero de la lista: se llena solo a medida que cargas registros.`,
                action: { type: 'tool', tool: 'propose_create_dashboard', label: 'Crear el tablero', input: { name: `Resumen de ${p.list.name}`.slice(0, 190), widgets } },
                preview: preview({ widgets: pv }),
            });
        }
    }

    // 7) Un texto con pocos valores distintos → selección.
    if (!p.mirror) {
        for (const f of visible) {
            if (f.type !== 'text' || f.unique || f.id === p.list.title_field_id || f.distinct === null) continue;
            if (f.filled < 15 || f.distinct < 2 || f.distinct > 12 || f.distinct > f.filled / 3) continue;
            if (IDENTITY_RE.test(foldLabel(f.label))) continue;
            const examples = (f.top ?? []).slice(0, 3).map((t) => `«${t.value}»`).join(', ');
            out.push({
                key: `field.select.f${f.id}`,
                category: 'field',
                title: `Convertir «${f.label}» en selección`,
                why: `«${f.label}» tiene sólo ${fmtCount(f.distinct)} valores distintos en ${fmtCount(f.filled)} registros${examples ? ` (${examples}…)` : ''}. Como selección se elige de una lista, se agrupa, se filtra y se acaban los errores de tipeo.`,
                action: { type: 'convert_field', field_id: f.id, to: 'select', label: 'Convertir' },
                preview: preview({ changes: [{ label: f.label, from: 'Texto', to: `Selección con ${f.distinct} opciones` }] }),
            });
            break;
        }
    }

    // 8) Valores repetidos donde no deberían (correo, teléfono, documento).
    for (const f of visible) {
        const top = f.dupes?.top;
        if (f.unique || !f.dupes || !top) continue;
        const identity = f.type === 'email' || f.type === 'phone' || (f.type === 'text' && IDENTITY_RE.test(foldLabel(f.label)));
        if (!identity) continue;
        const d = f.dupes;
        out.push({
            key: `quality.dupes.f${f.id}`,
            category: 'quality',
            title: `Registros repetidos en «${f.label}»`,
            why: `${fmtCount(d.values)} ${plural(d.values, 'valor de', 'valores de')} «${f.label}» ${plural(d.values, 'aparece', 'aparecen')} en más de un registro (el que más, ${fmtCount(d.top_count)} veces)${sampleNote}. Suelen ser el mismo cliente cargado dos veces.`,
            action: {
                type: 'link',
                label: 'Ver los repetidos',
                href: `${listHref}/records?gf=${f.id}&gv=${encodeURIComponent(top)}`,
            },
            preview: null,
        });
        break;
    }

    // 9) Campos que nadie llena.
    if (p.sampled >= 20) {
        const cutoff = Date.now() - 14 * 86_400_000;
        const empty = visible.filter(
            (f) =>
                f.filled === 0 &&
                !f.required &&
                f.type !== 'checkbox' &&
                f.type !== 'ai' &&
                f.type !== 'autonumber' &&
                (f.created_at ? Date.parse(f.created_at) < cutoff : true) &&
                ['text', 'long_text', 'number', 'currency', 'select', 'multi_select', 'date', 'datetime', 'url', 'email', 'user', 'file', 'phone', 'rating', 'percent', 'duration'].includes(f.type),
        );
        if (empty.length > 0) {
            const names = empty.slice(0, 3).map((f) => `«${f.label}»`).join(', ');
            out.push({
                key: `quality.empty.${empty.map((f) => `f${f.id}`).join('.').slice(0, 100)}`,
                category: 'quality',
                title: empty.length === 1 ? `«${empty[0]!.label}» está sin usar` : `${empty.length} campos sin usar`,
                why: `${names}${empty.length > 3 ? ` y ${empty.length - 3} más` : ''} ${plural(empty.length, 'está vacío', 'están vacíos')} en los ${fmtCount(p.sampled)} registros. Si no se usan, ocultarlos de las vistas o quitarlos deja la tabla más fácil de leer.`,
                action: { type: 'link', label: 'Revisar los campos', href: `${listHref}/edit?s=campos&field=${empty[0]!.id}` },
                preview: null,
            });
        }
    }

    // 10) Recibir registros con un formulario.
    const contactish = visible.some((f) => f.type === 'email' || f.type === 'phone') || CONTACT_RE.test(foldLabel(`${p.list.name} ${p.list.slug}`));
    if (p.forms === 0 && contactish && !p.mirror) {
        out.push({
            key: 'share.form',
            category: 'share',
            title: 'Recibe registros con un formulario',
            why: `Un enlace para que tus clientes llenen «${p.list.name}» solos: cada respuesta llega como un registro, sin copiar y pegar.`,
            action: { type: 'link', label: 'Crear el formulario', href: `${listHref}/edit?s=formularios` },
            preview: null,
        });
    }

    return out;
}
