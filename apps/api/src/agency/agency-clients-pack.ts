import { BLUEPRINT_VERSION, type AgencyBillingState, type ListBlueprint } from '@imagina-base/shared';
import { f, kanban, list, opt, ref, select, table } from '../templates/blueprint-dsl';

/**
 * v0.1.452 (I3, ADR-S108) — La lista «Empresas cliente» que la agencia tiene
 * en SU espacio: un registro por empresa cliente. Es una lista COMÚN (con sus
 * vistas, sus automatizaciones —avisarle por WhatsApp a quien está por
 * vencer—, su tablero) y de ella cuelgan los links de pago del cobro en línea.
 * Sólo las columnas que escribe la agencia quedan con candado (marca
 * `agency_clients_of`); el correo de cobro, el teléfono y las notas son de la
 * agencia.
 *
 * Los papeles se guardan por ID en `tenants.settings.agency_clients_list` de
 * la agencia (el slug puede cambiar al renombrar, el id no: regla de oro nº 1).
 */

export const AGENCY_CLIENT_ROLES = ['name', 'status', 'plan', 'price', 'paid_until', 'last_payment', 'pay_link', 'email', 'phone', 'notes'] as const;
export type AgencyClientRole = (typeof AGENCY_CLIENT_ROLES)[number];

/** Las que escribe la agencia (candado). */
export const PROTECTED_AGENCY_CLIENT_ROLES: readonly AgencyClientRole[] = ['name', 'status', 'plan', 'price', 'paid_until', 'last_payment', 'pay_link'];

export const AGENCY_CLIENT_SLUG: Record<AgencyClientRole, string> = {
    name: 'empresa',
    status: 'estado',
    plan: 'plan',
    price: 'valor',
    paid_until: 'pagado_hasta',
    last_payment: 'ultimo_pago',
    pay_link: 'link_para_pagar',
    email: 'correo_de_cobro',
    phone: 'telefono',
    notes: 'notas',
};

/** El valor del select «Estado» para cada estado del pago (y la pausa). */
export const AGENCY_CLIENT_STATUS: Record<AgencyBillingState | 'paused', { value: string; label: string; color: string }> = {
    ok: { value: 'al_dia', label: 'Al día', color: '#16a34a' },
    due_soon: { value: 'por_vencer', label: 'Por vencer', color: '#d97706' },
    grace: { value: 'en_gracia', label: 'En gracia', color: '#ea580c' },
    unpaid: { value: 'solo_lectura', label: 'Solo lectura', color: '#dc2626' },
    paused: { value: 'pausada', label: 'Pausada', color: '#6b7280' },
    none: { value: 'sin_plan', label: 'Sin plan', color: '#94a3b8' },
};

export function agencyClientsBlueprint(input: { currency: string }): ListBlueprint {
    const money = { currency: input.currency, precision: input.currency === 'COP' || input.currency === 'CLP' ? 0 : 2 };
    const statusOpts = (['ok', 'due_soon', 'grace', 'unpaid', 'paused', 'none'] as const).map((k) =>
        opt(AGENCY_CLIENT_STATUS[k].value, AGENCY_CLIENT_STATUS[k].label, AGENCY_CLIENT_STATUS[k].color),
    );
    const s = AGENCY_CLIENT_SLUG;
    const toCollect = {
        type: 'group',
        logic: 'or',
        children: ['por_vencer', 'en_gracia', 'solo_lectura'].map((v) => ({ type: 'condition', field_id: ref(s.status), op: 'eq', value: v })),
    };
    return {
        version: BLUEPRINT_VERSION,
        lists: [
            list(
                'clientes',
                'Empresas cliente',
                'building_office',
                '#0F766E',
                [
                    f('Empresa', s.name, 'text', { description: 'La empresa cliente de tu agencia.' }),
                    select('Estado', s.status, statusOpts),
                    f('Plan', s.plan, 'text', { description: 'El plan que le cobras y cada cuánto.' }),
                    f('Valor', s.price, 'currency', { config: money, description: 'Lo que paga por período.' }),
                    f('Pagado hasta', s.paid_until, 'date'),
                    f('Último pago', s.last_payment, 'date'),
                    f('Link para pagar', s.pay_link, 'url', { description: 'El link de pago pendiente, si hay uno (se borra cuando paga).' }),
                    f('Correo de cobro', s.email, 'email', { description: 'Adónde le llegan los links de pago. Lo puedes cambiar.' }),
                    f('Teléfono', s.phone, 'phone'),
                    f('Notas', s.notes, 'long_text'),
                    f('Fecha', 'fecha', 'created_at'),
                ],
                {
                    settings: { title_field_id: ref(s.name) },
                    views: [
                        table('Todos', true, { sort: [{ field_id: ref(s.paid_until), dir: 'asc' }] }),
                        kanban('Por estado', s.status),
                        table('Por cobrar', false, { filter_tree: toCollect, sort: [{ field_id: ref(s.paid_until), dir: 'asc' }] }),
                    ],
                },
            ),
        ],
        dashboards: [],
    };
}

/** Del resultado de `materialize` a los ids que guarda la agencia. */
export function agencyClientFieldIds(fieldIds: Record<string, Record<string, number>>): Partial<Record<AgencyClientRole, number>> {
    const ids = fieldIds.clientes ?? {};
    const out: Partial<Record<AgencyClientRole, number>> = {};
    for (const role of AGENCY_CLIENT_ROLES) {
        const id = ids[AGENCY_CLIENT_SLUG[role]];
        if (typeof id === 'number') out[role] = id;
    }
    return out;
}

/** Lo que la agencia guarda de su lista (lectura tolerante). */
export interface AgencyClientsListRef {
    list_id: number;
    fields: Partial<Record<AgencyClientRole, number>>;
}

export function readAgencyClientsListRef(raw: unknown): AgencyClientsListRef | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const id = Number(r.list_id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const fields: Partial<Record<AgencyClientRole, number>> = {};
    const src = r.fields && typeof r.fields === 'object' ? (r.fields as Record<string, unknown>) : {};
    for (const role of AGENCY_CLIENT_ROLES) {
        const v = src[role];
        if (typeof v === 'number' && Number.isInteger(v) && v > 0) fields[role] = v;
    }
    return { list_id: id, fields };
}
