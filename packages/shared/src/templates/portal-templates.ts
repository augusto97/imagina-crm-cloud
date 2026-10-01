import type { FieldType } from '../schemas/field';
import type { FilterGroup } from '../schemas/filter';
import type {
    LayoutBlock,
    LayoutDataSource,
    LayoutSection,
    LayoutTheme,
    RecordLayoutV3,
} from '../schemas/record-layout';
import { normalizeWidths, type LayoutFieldLite } from './record-layout-builders';

/**
 * v0.1.237 — Plantillas del PORTAL DEL CLIENTE. Las de la ficha (v0.1.236)
 * están pensadas para el equipo (etapas que se cambian con un clic, todo
 * editable, la actividad interna); el cliente necesita otra cosa: ver en qué
 * está, lo que tiene con la empresa y cómo hablar con ella.
 *
 *  - account «Mi cuenta»: sus datos (los de contacto, corregibles por él),
 *    lo que tiene con la empresa como tarjetas y un canal para escribir.
 *  - statement «Estado de cuenta»: saldo pendiente / pagado / facturado en
 *    una banda, la cuenta por estado y por mes, y la tabla de facturas con
 *    sus comprobantes.
 *  - project «Seguimiento de proyecto»: las etapas (de sólo lectura) en la
 *    cabecera, avance y entrega en una banda, el trabajo como tablero por
 *    estado y la conversación con el equipo.
 *  - support «Mis solicitudes»: abiertas / resueltas en una franja, sus
 *    casos por estado y el canal de ayuda. Si el registro ES el caso, la
 *    franja muestra su prioridad y vencimiento.
 *  - order «Mi pedido»: el estado del pedido como etapas, total y entrega
 *    estimada, lo que pidió y sus comprobantes. Si el registro es el
 *    cliente, sus pedidos.
 *
 * Todas usan el color de la marca de la empresa (el portal es su cara hacia
 * afuera) y se distinguen por la composición, las superficies y las formas.
 *
 * Reglas del portal que respetan por construcción:
 *  - Nada de campos que el portal no puede resolver o que suenan internos:
 *    relaciones, personas del equipo, calculados (no se calculan para el
 *    cliente) y lo que se llama "costo", "margen", "comisión", "interno"…
 *  - Sólo se edita lo marcado `editable`: los datos de contacto en «Mi
 *    cuenta» y nada más. `readOnly` (el portal automático) no marca nada.
 *  - Las listas vinculadas son las que se le PASAN: la galería las hace
 *    elegir con una casilla por lista; el automático sólo usa las que el
 *    admin habilitó para el cliente. Las columnas de cada una son pocas y
 *    reconocibles (título, estado, importe, fecha, comprobante).
 */

export const PORTAL_TEMPLATE_KINDS = ['account', 'statement', 'project', 'support', 'order'] as const;
export type PortalTemplateKind = (typeof PORTAL_TEMPLATE_KINDS)[number];

/** Otra lista con registros del cliente, ya resuelta a su fuente de datos. */
export interface PortalLinkedList {
    /** Identificador estable para elegirla (`rel:12:reverse`, `list:40`). */
    key: string;
    /** La lista del otro lado. */
    list_id: number;
    name: string;
    source: LayoutDataSource;
    fields: readonly LayoutFieldLite[];
}

export interface PortalTemplateInput {
    fields: readonly LayoutFieldLite[];
    linked?: readonly PortalLinkedList[];
    /** El portal automático: nada editable ni conversación. */
    readOnly?: boolean;
}

// ── Reconocer los campos ────────────────────────────────────────────────

const HIDDEN_TYPES: readonly FieldType[] = ['relation', 'user', 'computed', 'lookup', 'rollup'];
const INTERNAL_RE = /intern|privad|confidencial|cost[oe]|margen|comisi|utilidad|ganancia|rentab|secret|s[oó]lo equipo|staff/i;
const STAGE_RE = /estado|status|etapa|stage|fase|pipeline|progreso/i;
const DUE_RE = /venc|entrega|due|l[ií]mite|cierre|pr[oó]xim|deadline|fin\b|cobro|pago/i;
const CONTACT_RE = /contact|whats|tel[eé]f|celular|m[oó]vil|phone|direcci|address|ciudad|city|barrio|nit|rut|documento|c[eé]dula|identific/i;
const PRIORITY_RE = /prioridad|priority|urgenc|severidad|severity|impacto/i;
const PROGRESS_RE = /avance|progreso|progress|complet|porcentaje|%/i;
const QTY_RE = /cant|qty|unidad|units?\b/i;

const BILLING_RE = /factur|cobro|pago|cuota|invoice|cuenta|recibo|mensualidad|abono/i;
const SUPPORT_RE = /ticket|solicit|soporte|caso|incidenc|reclam|pqr|request|issue|requerim/i;
const WORK_RE = /tarea|task|entreg|hito|milestone|actividad|avance|sprint|fase/i;
const ORDER_RE = /pedido|orden|order|compra|venta/i;
const LINES_RE = /l[ií]nea|item|[ií]tem|producto|detalle/i;

const PENDING_RE = /pend|venc|mora|por pagar|por cobrar|sin pagar|impag|abiert|unpaid|overdue|deud|atras/i;
const PAID_RE = /pagad|cobrad|paid|abonad|saldad|liquidad|al[ _-]?d[ií]a|cancelad/i;
const CLOSED_RE = /cerr|resuel|solucion|finaliz|complet|closed|resolved|done|terminad|entregad|cancel|archiv/i;

const hay = (f: LayoutFieldLite): string => `${f.slug} ${f.label}`;

function optionsOf(f: LayoutFieldLite | undefined): Array<{ value: string; label: string }> {
    const raw = (f?.config as { options?: unknown } | undefined)?.options;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((o) => (o && typeof o === 'object' ? (o as { value?: unknown; label?: unknown }) : null))
        .filter((o): o is { value?: unknown; label?: unknown } => o !== null)
        .map((o) => ({ value: String(o.value ?? ''), label: String(o.label ?? o.value ?? '') }))
        .filter((o) => o.value !== '');
}

/** Valores de un select cuyo valor o etiqueta coincide con el patrón. */
function optionValues(f: LayoutFieldLite | undefined, re: RegExp, except?: RegExp): string[] {
    return optionsOf(f)
        .filter((o) => re.test(`${o.value} ${o.label}`) && !(except && except.test(`${o.value} ${o.label}`)))
        .map((o) => o.value);
}

/** Lo que el portal puede mostrar del registro del cliente. */
function shownFields(fields: readonly LayoutFieldLite[]): LayoutFieldLite[] {
    return fields.filter((f) => !HIDDEN_TYPES.includes(f.type) && !INTERNAL_RE.test(hay(f)));
}

function titleOf(fields: readonly LayoutFieldLite[]): LayoutFieldLite | undefined {
    return fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
}

/** Las piezas con nombre de una lista vinculada. */
function anatomy(l: PortalLinkedList): {
    title?: LayoutFieldLite;
    status?: LayoutFieldLite;
    money?: LayoutFieldLite;
    qty?: LayoutFieldLite;
    date?: LayoutFieldLite;
    file?: LayoutFieldLite;
} {
    const ok = shownFieldsOther(l.fields);
    const title = titleOf(l.fields);
    const status = ok.find((f) => f.type === 'select' && STAGE_RE.test(hay(f))) ?? ok.find((f) => f.type === 'select');
    const money = ok.find((f) => f.type === 'currency') ?? ok.find((f) => f.type === 'number' && !QTY_RE.test(hay(f)));
    const qty = ok.find((f) => f.type === 'number' && QTY_RE.test(hay(f)));
    const date = ok.find((f) => (f.type === 'date' || f.type === 'datetime') && DUE_RE.test(hay(f))) ?? ok.find((f) => f.type === 'date' || f.type === 'datetime');
    const file = ok.find((f) => f.type === 'file');
    return { title, status, money, qty, date, file };
}

/** En otra lista sí se puede mostrar un calculado (el servidor lo calcula al listar). */
function shownFieldsOther(fields: readonly LayoutFieldLite[]): LayoutFieldLite[] {
    return fields.filter((f) => f.type !== 'relation' && f.type !== 'user' && !INTERNAL_RE.test(hay(f)));
}

/** Las columnas que el cliente va a ver de una lista vinculada (también las muestra la galería). */
export function portalLinkedColumns(l: PortalLinkedList, opts: { file?: boolean; qty?: boolean } = {}): LayoutFieldLite[] {
    const a = anatomy(l);
    const out: LayoutFieldLite[] = [];
    for (const f of [a.title, opts.qty ? a.qty : undefined, a.date, a.money, a.status, opts.file ? a.file : undefined]) {
        if (f && !out.some((x) => x.id === f.id)) out.push(f);
    }
    return out;
}

type Role = 'billing' | 'support' | 'work' | 'order' | 'lines';

function roleScore(l: PortalLinkedList, role: Role): number {
    const a = anatomy(l);
    const name = `${l.name} ${l.fields.map((f) => f.label).join(' ')}`;
    switch (role) {
        case 'billing':
            return !a.money ? 0 : (BILLING_RE.test(l.name) ? 3 : 0) + (a.status ? 1 : 0) + (a.date ? 1 : 0);
        case 'support':
            return (SUPPORT_RE.test(l.name) ? 3 : 0) + (a.status ? 1 : 0) + (PRIORITY_RE.test(name) ? 1 : 0);
        case 'work':
            return (WORK_RE.test(l.name) ? 3 : 0) + (a.status ? 1 : 0);
        case 'order':
            return (ORDER_RE.test(l.name) ? 3 : 0) + (a.money ? 1 : 0) + (a.status ? 1 : 0);
        case 'lines':
            return (LINES_RE.test(l.name) ? 3 : 0) + (a.qty ? 2 : 0) + (a.money ? 1 : 0);
    }
}

/** La lista que mejor cumple un papel (≥ umbral), o ninguna. */
function pick(linked: readonly PortalLinkedList[], role: Role, min = 3): PortalLinkedList | undefined {
    let best: PortalLinkedList | undefined;
    let score = 0;
    for (const l of linked) {
        const s = roleScore(l, role);
        if (s > score) {
            best = l;
            score = s;
        }
    }
    return score >= min ? best : undefined;
}

const ROLE_OF: Record<PortalTemplateKind, Role[]> = {
    account: [],
    statement: ['billing'],
    project: ['work'],
    support: ['support'],
    order: ['order', 'lines'],
};

/**
 * Qué listas vinculadas conviene marcar de entrada en la galería: en «Mi
 * cuenta», las que el admin ya habilitó para el cliente; en las demás, la que
 * cumple el papel central de la plantilla (las facturas en «Estado de
 * cuenta»). Las demás quedan desmarcadas: mostrar una lista de más al cliente
 * es peor que de menos.
 */
export function suggestPortalLinked(kind: PortalTemplateKind, linked: readonly PortalLinkedList[], enabledListIds: readonly number[] = []): string[] {
    // «Mi cuenta» muestra lo que el admin ya habilitó; las demás, sólo la
    // lista que cumple su papel (unas facturas no son "solicitudes").
    const out = new Set(kind === 'account' ? linked.filter((l) => enabledListIds.includes(l.list_id)).map((l) => l.key) : []);
    for (const role of ROLE_OF[kind]) {
        // Pedidos y líneas se reconocen por el NOMBRE: unas facturas también
        // tienen importe y estado, y no son pedidos.
        const hit = pick(linked, role, role === 'lines' || role === 'order' ? 3 : 2);
        if (hit) out.add(hit.key);
    }
    return [...out];
}

/** ¿La plantilla tiene con qué lucirse en esta lista? Si no, el motivo. */
export function portalTemplateFit(kind: PortalTemplateKind, input: PortalTemplateInput): { ok: boolean; reason?: string } {
    const fields = shownFields(input.fields);
    const linked = input.linked ?? [];
    const stages = fields.find((f) => f.type === 'select' && optionsOf(f).length >= 3 && STAGE_RE.test(hay(f)));
    switch (kind) {
        case 'account':
            return { ok: true };
        case 'statement':
            return pick(linked, 'billing', 1)
                ? { ok: true }
                : { ok: false, reason: 'Necesita una lista vinculada con importes (facturas, pagos, cuotas) marcada abajo.' };
        case 'project': {
            const progress = fields.some((f) => f.type === 'percent');
            const due = fields.some((f) => (f.type === 'date' || f.type === 'datetime') && DUE_RE.test(hay(f)));
            return stages || progress || due || linked.length > 0
                ? { ok: true }
                : { ok: false, reason: 'Funciona con un estado por etapas, un avance (%), una fecha de entrega o una lista de tareas vinculada.' };
        }
        case 'support':
            return pick(linked, 'support', 1) || stages || fields.some((f) => f.type === 'select' && PRIORITY_RE.test(hay(f)))
                ? { ok: true }
                : { ok: false, reason: 'Necesita una lista de solicitudes vinculada (con estado) o que este registro tenga estado o prioridad.' };
        case 'order': {
            const ownOrder = Boolean(stages) && fields.some((f) => f.type === 'currency');
            return ownOrder || pick(linked, 'order', 1) || pick(linked, 'lines', 2)
                ? { ok: true }
                : { ok: false, reason: 'Necesita que este registro tenga estado e importe (un pedido) o una lista de pedidos vinculada.' };
        }
    }
}

// ── Construir la plantilla ──────────────────────────────────────────────

const THEMES: Record<PortalTemplateKind, LayoutTheme> = {
    account: { preset: 'default', radius: 'lg' },
    statement: { preset: 'default', surface: 'outlined', radius: 'sm', density: 'compact' },
    project: { preset: 'default', radius: 'md' },
    support: { preset: 'default', radius: 'xl', density: 'spacious' },
    order: { preset: 'minimal', radius: 'md' },
};

export const PORTAL_TEMPLATE_PAGE_NAME: Record<PortalTemplateKind, string> = {
    account: 'Mi cuenta',
    statement: 'Estado de cuenta',
    project: 'Mi proyecto',
    support: 'Mis solicitudes',
    order: 'Mi pedido',
};

function evenColumns(n: number): number[] {
    if (n <= 1) return [12];
    if (n === 2) return [6, 6];
    if (n === 3) return [4, 4, 4];
    return [3, 3, 3, 3];
}

function inFilter(fieldId: number, values: string[], op: 'in' | 'nin' = 'in'): FilterGroup {
    return { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: fieldId, op, value: values }] };
}

export function portalTemplateLayout(kind: PortalTemplateKind, input: PortalTemplateInput): RecordLayoutV3 {
    const all = input.fields;
    const fields = shownFields(all);
    const linked = (input.linked ?? []).slice(0, 4);
    const readOnly = input.readOnly === true;
    const title = titleOf(all);
    const used = new Set<number>(title ? [title.id] : []);
    const free = (f: LayoutFieldLite): boolean => !used.has(f.id);
    const take = <T extends LayoutFieldLite | undefined>(f: T): T => {
        if (f) used.add(f.id);
        return f;
    };
    const takeAll = (list: LayoutFieldLite[]): LayoutFieldLite[] => {
        for (const f of list) used.add(f.id);
        return list;
    };
    const ofType = (...types: FieldType[]): LayoutFieldLite[] => fields.filter((f) => types.includes(f.type));
    const compact = <T,>(xs: (T | null | undefined | false)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined && x !== false);

    // ── Piezas del registro ──
    const stages = fields.find((f) => f.type === 'select' && optionsOf(f).length >= 3 && STAGE_RE.test(hay(f)));
    const priority = fields.find((f) => f.type === 'select' && PRIORITY_RE.test(hay(f)) && f.id !== stages?.id);
    const due = fields.find((f) => (f.type === 'date' || f.type === 'datetime') && DUE_RE.test(hay(f)));
    const progress = fields.find((f) => f.type === 'percent' && PROGRESS_RE.test(hay(f))) ?? fields.find((f) => f.type === 'percent');
    const money = fields.find((f) => f.type === 'currency');
    const qty = fields.find((f) => f.type === 'number' && QTY_RE.test(hay(f)));
    const contactFields = (): LayoutFieldLite[] =>
        fields.filter((f) => free(f) && (f.type === 'email' || f.type === 'phone' || f.type === 'url' || ((f.type === 'text' || f.type === 'long_text') && CONTACT_RE.test(hay(f)))));
    const subtitleFrom = (): LayoutFieldLite[] => fields.filter((f) => free(f) && (f.type === 'email' || f.type === 'phone')).slice(0, 2);
    const chipsFrom = (pool: LayoutFieldLite[], max: number): number[] => {
        const out: number[] = [];
        for (const f of pool) {
            if (out.length >= max || !free(f)) continue;
            out.push(f.id);
            used.add(f.id);
        }
        return out;
    };

    // ── Bloques ──
    const group = (id: string, gTitle: string, icon: string, list: LayoutFieldLite[], layout: 'grid' | 'list' | 'stacked', editable = false): LayoutBlock | null =>
        list.length === 0
            ? null
            : {
                  id,
                  type: 'fields',
                  title: gTitle,
                  config: {
                      field_ids: list.map((f) => f.id),
                      layout,
                      ...(layout === 'grid' ? { columns: 2 } : {}),
                      icon,
                      collapsible: false,
                      ...(editable && !readOnly ? { editable: true } : {}),
                  },
              };
    const card = (f: LayoutFieldLite, display: string, blockTitle?: string): LayoutBlock => ({
        id: `card-${display}-${f.id}`,
        type: 'field',
        ...(blockTitle ? { title: blockTitle } : {}),
        config: { field_id: f.id, display, card: true },
    });
    const kpiField = (f: LayoutFieldLite): LayoutBlock => card(f, f.type === 'percent' ? 'ring' : f.type === 'rating' ? 'stars' : 'big', f.label);
    const kpi = (l: PortalLinkedList, id: string, kTitle: string, icon: string, metric: 'count' | 'sum', metricField?: LayoutFieldLite, filter?: FilterGroup): LayoutBlock => ({
        id,
        type: 'chart',
        title: kTitle,
        config: {
            source: l.source,
            kind: 'kpi',
            metric,
            ...(metricField ? { metric_field_id: metricField.id } : {}),
            ...(filter ? { filter_tree: filter } : {}),
            icon,
        },
    });
    const related = (l: PortalLinkedList, id: string, rTitle: string, view: 'cards' | 'list' | 'board' | 'table', limit: number, opts: { file?: boolean; qty?: boolean } = {}): LayoutBlock => {
        const a = anatomy(l);
        const cols = portalLinkedColumns(l, opts);
        return {
            id,
            type: 'related',
            title: rTitle,
            config: {
                source: l.source,
                view: view === 'board' && !a.status ? 'list' : view,
                field_ids: cols.map((f) => f.id),
                limit,
                ...(view === 'board' && a.status ? { group_field_id: a.status.id } : {}),
                ...(a.date ? { sort_field_id: a.date.id, sort_dir: 'desc' } : {}),
            },
        };
    };
    const filesBlock = (bTitle: string): LayoutBlock | null => {
        const files = takeAll(fields.filter((f) => free(f) && f.type === 'file'));
        return files.length > 0 ? { id: 'files', type: 'files', title: bTitle, config: { field_ids: files.map((f) => f.id) } } : null;
    };
    const conversation = (cTitle: string): LayoutBlock | null => (readOnly ? null : { id: 'conversation', type: 'comments', title: cTitle, config: {} });
    const notice = (id: string, text: string, tone: 'info' | 'tip' | 'success' = 'tip'): LayoutBlock => ({ id, type: 'notice', config: { tone, text } });
    const band = (id: string, blocks: LayoutBlock[], tone: 'accent' | 'muted' = 'accent', widths?: number[]): LayoutSection | null =>
        blocks.length === 0 ? null : { id, columns: widths ?? evenColumns(blocks.length), blocks: blocks.map((b) => [b]), style: { tone } };
    const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

    const sections: LayoutSection[] = [];
    let subtitle: LayoutFieldLite[] = [];
    let chips: number[] = [];
    let stagesId: number | null = null;
    let cover: 'gradient' | 'color' | 'none' = 'gradient';

    switch (kind) {
        case 'statement': {
            const bill = pick(linked, 'billing', 1);
            subtitle = takeAll(subtitleFrom().slice(0, 1));
            chips = chipsFrom(ofType('select'), 2);
            cover = 'color';
            if (!bill) {
                sections.push({ id: 'empty', columns: [12], blocks: [[notice('no-billing', 'Vinculá una lista con importes (por ejemplo, Facturas) para mostrar el estado de cuenta.', 'info')]] });
                break;
            }
            const a = anatomy(bill);
            const pending = optionValues(a.status, PENDING_RE);
            const paid = optionValues(a.status, PAID_RE, PENDING_RE);
            const ownDue = take(due);
            const ownMoney = take(money);
            const band1 = compact<LayoutBlock>([
                a.status && pending.length > 0 && a.money ? kpi(bill, 'kpi-pending', 'Saldo pendiente', 'dollar', 'sum', a.money, inFilter(a.status.id, pending)) : null,
                a.status && paid.length > 0 && a.money ? kpi(bill, 'kpi-paid', 'Pagado', 'check', 'sum', a.money, inFilter(a.status.id, paid)) : null,
                a.money ? kpi(bill, 'kpi-total', 'Total facturado', 'trending', 'sum', a.money) : kpi(bill, 'kpi-count', bill.name, 'briefcase', 'count'),
                ownDue ? card(ownDue, 'countdown', 'Próximo vencimiento') : ownMoney ? card(ownMoney, 'big', ownMoney.label) : null,
            ]);
            const b = band('summary', band1.slice(0, 4));
            if (b) sections.push(b);
            const charts = compact<LayoutBlock>([
                a.status
                    ? {
                          id: 'by-status',
                          type: 'chart',
                          title: 'Cómo está tu cuenta',
                          config: { source: bill.source, kind: 'pie', metric: a.money ? 'sum' : 'count', ...(a.money ? { metric_field_id: a.money.id } : {}), group_by_field_id: a.status.id },
                      }
                    : null,
                a.date
                    ? {
                          id: 'by-month',
                          type: 'chart',
                          title: a.money ? `${a.money.label} por mes` : `${bill.name} por mes`,
                          config: {
                              source: bill.source,
                              kind: 'bar',
                              metric: a.money ? 'sum' : 'count',
                              ...(a.money ? { metric_field_id: a.money.id } : {}),
                              group_by_field_id: a.date.id,
                              time_bucket: 'month',
                          },
                      }
                    : null,
            ]);
            if (charts.length > 0) sections.push({ id: 'charts', columns: charts.length === 2 ? [5, 7] : [12], blocks: charts.map((c) => [c]) });
            sections.push({ id: 'invoices', columns: [12], blocks: [[related(bill, 'invoices', `Tus ${lower(bill.name)}`, 'table', 50, { file: true })]] });
            const billingData = takeAll([...contactFields(), ...fields.filter((f) => free(f) && f.type === 'text')].slice(0, 6));
            sections.push({
                id: 'help',
                columns: [7, 5],
                blocks: [
                    compact<LayoutBlock>([notice('help-tip', '¿Tenés una duda con un pago o una factura? Escribinos acá y te respondemos.'), conversation('Dudas con tu cuenta')]),
                    compact<LayoutBlock>([group('billing-data', 'Datos de facturación', 'dollar', billingData, 'list'), filesBlock('Documentos')]),
                ],
            });
            break;
        }
        case 'project': {
            stagesId = take(stages)?.id ?? null;
            subtitle = [];
            chips = chipsFrom([...ofType('select'), ...ofType('multi_select')], 3);
            const work = pick(linked, 'work', 1) ?? linked[0];
            const pProgress = take(progress);
            const pDue = take(due);
            const pMoney = take(money);
            const heroBlocks = compact<LayoutBlock>([
                pProgress ? card(pProgress, 'ring', pProgress.label) : null,
                pDue ? card(pDue, 'countdown', 'Entrega') : null,
                work ? kpi(work, 'kpi-work', work.name, 'briefcase', 'count') : null,
                pMoney ? card(pMoney, 'big', pMoney.label) : null,
            ]);
            const b = band('progress', heroBlocks.slice(0, 4));
            if (b) sections.push(b);
            const longText = takeAll(fields.filter((f) => free(f) && f.type === 'long_text'));
            const dates = takeAll(fields.filter((f) => free(f) && (f.type === 'date' || f.type === 'datetime')));
            const details = takeAll(fields.filter((f) => free(f) && !['file', 'long_text', 'email', 'phone', 'url'].includes(f.type)));
            const contact = takeAll(contactFields());
            sections.push({
                id: 'work',
                columns: [8, 4],
                blocks: [
                    compact<LayoutBlock>([
                        work ? related(work, 'work-board', 'Así va el trabajo', 'board', 30) : null,
                        longText[0] ? card(longText[0], 'quote', longText[0].label) : null,
                        group('more-notes', 'Más información', 'sticky_note', longText.slice(1), 'stacked'),
                        conversation('Conversación con el equipo'),
                    ]),
                    compact<LayoutBlock>([
                        ...dates.slice(0, 2).map((f) => card(f, 'calendar', f.label)),
                        group('dates', 'Otras fechas', 'calendar', dates.slice(2), 'list'),
                        group('details', 'Detalles', 'tag', details, 'list'),
                        group('contact', 'Contacto', 'mail', contact, 'list'),
                        filesBlock('Entregables'),
                        ...linked.filter((l) => l !== work).map((l, i) => related(l, `more-${i}`, l.name, 'list', 6)),
                    ]),
                ],
            });
            break;
        }
        case 'support': {
            const sup = pick(linked, 'support', 1);
            subtitle = takeAll(subtitleFrom());
            if (sup) {
                chips = chipsFrom(ofType('select'), 2);
                const a = anatomy(sup);
                const closed = optionValues(a.status, CLOSED_RE);
                const strip = compact<LayoutBlock>([
                    a.status && closed.length > 0 ? kpi(sup, 'kpi-open', 'Abiertas', 'alert', 'count', undefined, inFilter(a.status.id, closed, 'nin')) : null,
                    a.status && closed.length > 0 ? kpi(sup, 'kpi-closed', 'Resueltas', 'check', 'count', undefined, inFilter(a.status.id, closed)) : null,
                    kpi(sup, 'kpi-total', `Total de ${lower(sup.name)}`, 'briefcase', 'count'),
                ]);
                const b = band('strip', strip, 'muted');
                if (b) sections.push(b);
                sections.push({
                    id: 'cases',
                    columns: [7, 5],
                    blocks: [
                        [related(sup, 'cases', `Tus ${lower(sup.name)}`, 'board', 30)],
                        compact<LayoutBlock>([
                            notice('help', '¿Necesitás ayuda? Escribinos y te respondemos lo antes posible.', 'info'),
                            conversation('Escribinos'),
                            group('contact', 'Tus datos', 'circle_user', takeAll(contactFields()), 'list'),
                            filesBlock('Archivos'),
                        ]),
                    ],
                });
            } else {
                // El registro ES el caso: su prioridad, vencimiento y estado.
                const sPriority = take(priority);
                const sStatus = take(stages ?? fields.find((f) => free(f) && f.type === 'select'));
                const sDue = take(due);
                const strip = compact<LayoutBlock>([
                    sStatus ? card(sStatus, 'big', sStatus.label) : null,
                    sPriority ? card(sPriority, 'big', sPriority.label) : null,
                    sDue ? card(sDue, 'countdown', 'Respuesta antes de') : null,
                ]);
                const b = band('strip', strip, 'muted');
                if (b) sections.push(b);
                const longText = takeAll(fields.filter((f) => free(f) && f.type === 'long_text'));
                const details = takeAll(fields.filter((f) => free(f) && !['file', 'long_text'].includes(f.type)));
                sections.push({
                    id: 'case',
                    columns: [7, 5],
                    blocks: [
                        compact<LayoutBlock>([longText[0] ? card(longText[0], 'quote', 'Lo que nos contaste') : null, conversation('Conversación')]),
                        compact<LayoutBlock>([group('details', 'Detalle de tu solicitud', 'lifebuoy', details, 'list'), filesBlock('Archivos')]),
                    ],
                });
            }
            break;
        }
        case 'order': {
            const orders = pick(linked, 'order', 1);
            const lines = pick(linked, 'lines', 2);
            const ownIsOrder = Boolean(stages) && Boolean(money);
            cover = 'color';
            if (ownIsOrder || !orders) {
                stagesId = take(stages)?.id ?? null;
                const oMoney = take(money);
                const oDue = take(due);
                const oQty = take(qty);
                const b = band(
                    'order',
                    compact<LayoutBlock>([
                        oMoney ? card(oMoney, 'big', 'Total') : null,
                        oDue ? card(oDue, 'countdown', 'Entrega estimada') : null,
                        oQty ? card(oQty, 'big', oQty.label) : null,
                        lines ? kpi(lines, 'kpi-lines', 'Productos', 'cart', 'count') : null,
                    ]).slice(0, 4),
                );
                if (b) sections.push(b);
                const longText = takeAll(fields.filter((f) => free(f) && f.type === 'long_text'));
                const contact = takeAll(contactFields());
                const dates = takeAll(fields.filter((f) => free(f) && (f.type === 'date' || f.type === 'datetime')));
                const details = takeAll(fields.filter((f) => free(f) && !['file', 'long_text'].includes(f.type)));
                sections.push({
                    id: 'detail',
                    columns: [7, 5],
                    blocks: [
                        compact<LayoutBlock>([
                            lines ? related(lines, 'lines', 'Lo que pediste', 'table', 50, { qty: true }) : null,
                            longText[0] ? card(longText[0], 'quote', 'Indicaciones') : null,
                            conversation('¿Dudas con tu pedido?'),
                        ]),
                        compact<LayoutBlock>([
                            group('shipping', 'Datos de entrega', 'building', contact, 'list'),
                            ...dates.slice(0, 1).map((f) => card(f, 'calendar', f.label)),
                            group('details', 'Detalles', 'tag', [...dates.slice(1), ...details], 'list'),
                            filesBlock('Comprobantes'),
                        ]),
                    ],
                });
            } else {
                subtitle = takeAll(subtitleFrom());
                chips = chipsFrom(ofType('select'), 2);
                const a = anatomy(orders);
                const done = optionValues(a.status, CLOSED_RE);
                const b = band(
                    'orders-kpis',
                    compact<LayoutBlock>([
                        kpi(orders, 'kpi-orders', `Tus ${lower(orders.name)}`, 'cart', 'count'),
                        a.status && done.length > 0 ? kpi(orders, 'kpi-active', 'En curso', 'zap', 'count', undefined, inFilter(a.status.id, done, 'nin')) : null,
                        a.money ? kpi(orders, 'kpi-spent', 'Total comprado', 'dollar', 'sum', a.money) : null,
                    ]),
                );
                if (b) sections.push(b);
                sections.push({ id: 'orders', columns: [12], blocks: [[related(orders, 'orders', `Tus ${lower(orders.name)}`, a.status ? 'board' : 'cards', 30)]] });
                sections.push({
                    id: 'help',
                    columns: [7, 5],
                    blocks: [
                        compact<LayoutBlock>([conversation('¿Dudas con un pedido?')]),
                        compact<LayoutBlock>([group('shipping', 'Datos de entrega', 'building', takeAll(contactFields()), 'list'), filesBlock('Comprobantes')]),
                    ],
                });
            }
            break;
        }
        default: {
            // account «Mi cuenta» — el email y el teléfono van bajo el nombre Y
            // en el bloque de contacto: ahí es donde el cliente los corrige.
            subtitle = subtitleFrom();
            chips = chipsFrom([...(stages ? [stages] : []), ...ofType('select'), ...ofType('multi_select')], 3);
            const numbers = takeAll(fields.filter((f) => free(f) && ['currency', 'number', 'percent', 'rating'].includes(f.type)).slice(0, 2));
            const ownDue = take(due);
            const kpis = compact<LayoutBlock>([
                ...numbers.map(kpiField),
                ownDue ? card(ownDue, 'countdown', ownDue.label) : null,
                ...linked.map((l, i) => kpi(l, `kpi-${i}`, `Tus ${lower(l.name)}`, 'briefcase', 'count')),
            ]).slice(0, 4);
            const b = band('welcome', kpis);
            if (b) sections.push(b);
            const contact = takeAll(contactFields());
            const info = takeAll(fields.filter((f) => free(f) && f.type !== 'file'));
            // Lo que tiene con la empresa, a lo ancho: las tarjetas necesitan aire.
            if (linked.length > 0) {
                sections.push({
                    id: 'linked',
                    columns: [12],
                    blocks: [linked.map((l, i) => related(l, `linked-${i}`, i === 0 ? 'Lo que tenés con nosotros' : l.name, i === 0 ? 'cards' : 'list', 6))],
                });
            }
            sections.push({
                id: 'main',
                columns: [7, 5],
                blocks: [
                    compact<LayoutBlock>([linked.length > 0 ? null : group('info', 'Tu información', 'user', info, 'grid'), conversation('Escribinos')]),
                    compact<LayoutBlock>([
                        group('contact', 'Tus datos de contacto', 'mail', contact, 'list', true),
                        linked.length > 0 ? group('info', 'Tu información', 'user', info, 'list') : null,
                        filesBlock('Tus archivos'),
                    ]),
                ],
            });
        }
    }

    // Una columna sin nada se cae: una sección sin bloques no se guarda.
    const clean = sections
        .map((s) => {
            const keep = s.blocks.map((col, i) => ({ col, w: s.columns[i] ?? 0 })).filter((x) => x.col.length > 0);
            if (keep.length === s.blocks.length) return s;
            if (keep.length === 0) return null;
            return { ...s, columns: keep.length === 1 ? [12] : normalizeWidths(keep.map((x) => x.w)), blocks: keep.map((x) => x.col) };
        })
        .filter((s): s is LayoutSection => s !== null);
    if (clean.length === 0) {
        clean.push({ id: 'main', columns: [12], blocks: [[{ id: 'info', type: 'fields', title: 'Tus datos', config: { field_ids: fields.filter((f) => f.id !== title?.id && f.type !== 'file').map((f) => f.id), layout: 'grid', columns: 2, collapsible: false } }]] });
    }

    return {
        v: 3,
        theme: THEMES[kind],
        header: {
            title_field_id: title?.id ?? null,
            subtitle_field_ids: subtitle.map((f) => f.id),
            chip_field_ids: chips,
            stages_field_id: stagesId,
            cover: { kind: cover },
            avatar: { kind: kind === 'order' ? 'none' : 'initials' },
            show_meta: false,
        },
        pages: [{ id: 'inicio', name: PORTAL_TEMPLATE_PAGE_NAME[kind], icon: 'layout', sections: clean }],
    };
}
