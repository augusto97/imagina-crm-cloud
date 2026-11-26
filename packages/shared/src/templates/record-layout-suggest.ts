/**
 * v0.1.470 — Qué ficha diseñada le queda mejor a una lista que NACE (de una
 * plantilla del sistema, de la IA, de un archivo o de Airtable): ventas →
 * «Oportunidad», soporte → «Ticket», personas → «Perfil», trabajo →
 * «Tarea», el resto → «Resumen».
 *
 * Es UNA función pura que usan el servidor (al crear la lista) y la ficha
 * (para sugerirle el diseño a una lista que ya existía con la ficha simple).
 * Primero mira el NOMBRE —la palabra que aparece antes manda, porque en
 * español el sustantivo principal va primero: «Facturas de clientes» es de
 * facturas, «Clientes potenciales» es de personas— y, si el nombre no dice
 * nada, los CAMPOS (un monto con etapas es un negocio; una prioridad con un
 * correo es un caso; una fecha de entrega con un responsable es una tarea).
 */

export type SuggestedRecordLayout = 'auto' | 'contact' | 'deal' | 'task' | 'support';

export interface SuggestLayoutField {
    slug?: string;
    label: string;
    type: string;
    config?: Record<string, unknown> | null;
}

/** Minúsculas y sin tildes: «Atención al Cliente» → «atencion al cliente». */
function norm(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

/**
 * Palabras de cada tipo de ficha, por el COMIENZO de la palabra (`\b`):
 * «ticket» encuentra «Tickets», «client» encuentra «Clientes».
 */
const NAME_RULES: ReadonlyArray<{ kind: SuggestedRecordLayout; re: RegExp }> = [
    {
        kind: 'support',
        re: /\b(ticket|soporte|support|incidenc|casos?\b|reclam|pqr|queja|solicitud|mesa de ayuda|helpdesk|help desk|bugs?\b|requerimiento|peticion|garantia)/,
    },
    {
        kind: 'deal',
        re: /\b(venta|oportunidad|negocio|pipeline|embudo|deals?\b|cotizac|propuesta|leads?\b|prospect|comercial|sales\b)/,
    },
    {
        kind: 'task',
        re: /\b(tarea|proyecto|actividad|pendiente|to-?do|entregable|sprint|backlog|tasks?\b|project|okr|objetivo|iniciativa|roadmap|trabajo|orden(es)? de trabajo|mantenimiento)/,
    },
    {
        kind: 'contact',
        re: /\b(cliente|contacto|persona|paciente|alumno|estudiante|empleado|colaborador|proveedor|miembro|socio|candidat|invitad|asistente|usuario|customer|contacts?\b|clients?\b|suscriptor|afiliado|donante|voluntario|huesped|inquilino|propietario|beneficiari|prestador)/,
    },
    {
        // Listas que no son de nada de lo anterior: el «Resumen» les queda
        // mejor que un perfil (una factura no tiene «datos de contacto»).
        kind: 'auto',
        re: /\b(factur|cobro|pago|cuota|gasto|pedido|ordenes?\b|orden de compra|compra|inventario|producto|stock|activo|contrato|suscripc|evento|cita|reserva|inmueble|propiedad|vacante|libro|item|cartera|cuentas? (por|de) (cobrar|pagar)|estado de cuenta|presupuesto|nomina|recibo|transacc|movimiento)/,
    },
];

const PRIORITY_RE = /prioridad|priority|urgenc|severidad|severity|impacto/;
const STAGE_RE = /etapa|stage|pipeline|fase|embudo/;
const DEAL_OPTION_RE = /ganad|perdid|negociac|propuesta|cotizad|calificad|won\b|lost\b|closed/;
const DUE_RE = /venc|entrega|due|limite|cierre|deadline|fecha fin|fin\b/;
const PERSON_NAME_RE = /nombre|name|apellido|razon social|empresa|cliente|contacto/;
const REQUESTER_RE = /cliente|solicitante|reporta|usuario|contacto/;

function hay(f: SuggestLayoutField): string {
    return norm(`${f.slug ?? ''} ${f.label}`);
}

function optionLabels(f: SuggestLayoutField): string {
    const opts = (f.config as { options?: unknown } | null | undefined)?.options;
    if (!Array.isArray(opts)) return '';
    return norm(
        opts
            .map((o) => (o && typeof o === 'object' ? `${String((o as { label?: unknown }).label ?? '')} ${String((o as { value?: unknown }).value ?? '')}` : ''))
            .join(' '),
    );
}

/** Por los campos, cuando el nombre no dice nada. */
function byFields(fields: readonly SuggestLayoutField[]): SuggestedRecordLayout {
    const has = (pred: (f: SuggestLayoutField) => boolean): boolean => fields.some(pred);
    const email = has((f) => f.type === 'email');
    const phone = has((f) => f.type === 'phone');
    const priority = has((f) => f.type === 'select' && PRIORITY_RE.test(hay(f)));
    const requester = email || has((f) => (f.type === 'text' || f.type === 'user') && REQUESTER_RE.test(hay(f)));
    if (priority && requester) return 'support';

    const money = has((f) => f.type === 'currency');
    const stage = has((f) => f.type === 'select' && (STAGE_RE.test(hay(f)) || DEAL_OPTION_RE.test(optionLabels(f))));
    if (money && stage) return 'deal';

    const due = has((f) => (f.type === 'date' || f.type === 'datetime') && DUE_RE.test(hay(f)));
    const owner = has((f) => f.type === 'user');
    if (due && (owner || has((f) => f.type === 'checkbox' || f.type === 'percent'))) return 'task';

    const named = has((f) => f.type === 'text' && PERSON_NAME_RE.test(hay(f)));
    if ((email && phone) || ((email || phone) && named)) return 'contact';
    return 'auto';
}

export function suggestRecordLayoutTemplate(input: { name: string; fields: readonly SuggestLayoutField[] }): SuggestedRecordLayout {
    const name = norm(input.name ?? '');
    let best: { kind: SuggestedRecordLayout; at: number } | null = null;
    for (const rule of NAME_RULES) {
        const m = rule.re.exec(name);
        if (m && (best === null || m.index < best.at)) best = { kind: rule.kind, at: m.index };
    }
    if (best) return best.kind;
    return byFields(input.fields ?? []);
}
