import { readCollectionFields } from './collections';
import { readHelpdeskSettings } from './helpdesk';
import { readSubscriptionFields, type SubscriptionFieldRole } from './subscriptions';

/**
 * v0.1.383 — Columnas que escribe una sincronización y nadie edita a mano.
 *
 * Los cobros (links de pago de Mercado Pago, PayPal o Wompi), las suscripciones
 * con débito automático, la lista importada de Mercado Pago, el registro de
 * cobros de las suscripciones y el SLA de la mesa de ayuda escriben sus
 * columnas solos. Si una persona cambia una a mano, no cambia nada en el
 * proveedor (la suscripción sigue cobrando lo mismo) y la columna queda
 * mintiendo hasta el próximo aviso — o para siempre, si el dato no vuelve a
 * cambiar. Por eso se protegen en TODOS los caminos de edición (celda, ficha,
 * pegar, edición masiva, importar, automatizaciones, asistente) con el motivo.
 *
 * Las columnas que la empresa crea aparte son suyas: se editan libremente y
 * nunca viajan al proveedor (lo único que sale hacia Mercado Pago o PayPal es
 * lo que se elige al crear un link o una suscripción).
 *
 * Una regla PURA sobre `lists.settings`: la usan el servidor (rechaza la
 * edición) y la interfaz (candado con el motivo).
 */
export type ManagedFieldSource = 'helpdesk' | 'collections' | 'subscriptions' | 'subscription_import' | 'charge_log';

export interface ManagedFieldLock {
    field_id: number;
    source: ManagedFieldSource;
    /** Por qué no se edita a mano (y qué hacer en su lugar). */
    reason: string;
    /** Se puede borrar la columna (un dato que sólo se escribe al crear el registro). */
    deletable: boolean;
    /** Dónde se deja de usar la columna para que vuelva a ser propia. */
    free_hint: string | null;
}

/**
 * Marca que el registro de cobros deja en la lista DESTINO (la configuración
 * vive en la lista de suscriptores, ver `readSubscriptionChargeLog`). Las
 * claves siguen la convención (`list_id`, `*_field_id(s)`): migrar una empresa
 * las re-mapea solas.
 */
export const CHARGE_LOG_MARKER_KEY = 'subscription_charge_log_of';

export interface ChargeLogMarker {
    /** La lista de suscriptores que escribe aquí. */
    list_id: number;
    /** La columna del suscriptor (relación). */
    record_field_id: number | null;
    /** Las demás columnas que escribe. */
    field_ids: number[];
}

export function readChargeLogMarker(settings: unknown): ChargeLogMarker | null {
    const raw = (settings as Record<string, unknown> | null | undefined)?.[CHARGE_LOG_MARKER_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const m = raw as Record<string, unknown>;
    const listId = Number(m.list_id);
    if (!Number.isInteger(listId) || listId <= 0) return null;
    const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
    const ids = Array.isArray(m.field_ids) ? m.field_ids.map(id).filter((v): v is number => v !== null) : [];
    return { list_id: listId, record_field_id: id(m.record_field_id), field_ids: ids };
}

/** La marca que corresponde a una configuración del registro de cobros (o null si no escribe nada). */
export function chargeLogMarkerFor(sourceListId: number, fields: Record<string, number | null>): ChargeLogMarker | null {
    const record = typeof fields.record === 'number' && fields.record > 0 ? fields.record : null;
    const ids = Object.entries(fields)
        .filter(([role, v]) => role !== 'record' && typeof v === 'number' && v > 0)
        .map(([, v]) => v as number);
    if (record === null && ids.length === 0) return null;
    return { list_id: sourceListId, record_field_id: record, field_ids: [...new Set(ids)] };
}

const PAYMENT_REASON = 'Lo escribe el pago (Mercado Pago, PayPal o Wompi) cuando llega el aviso: no se edita a mano.';
const PAYMENT_LINK_REASON = 'Es el link de pago que creó la app: no se edita a mano. Para cobrar de nuevo, crea otro link en «Cobros».';
const SUBSCRIPTION_REASONS: Record<SubscriptionFieldRole, string> = {
    status: 'Lo escribe la suscripción (Mercado Pago o PayPal). Para pausarla, reanudarla o cancelarla, usa la sección «Suscripción» de la ficha.',
    amount: 'Es lo que cobra la suscripción. Para cambiarlo, usa «Cambiar el valor» en la sección «Suscripción» de la ficha: aquí no cambia el cobro.',
    plan: 'Lo escribe la suscripción (Mercado Pago o PayPal): no se edita a mano.',
    next_charge: 'Lo escribe la suscripción (Mercado Pago o PayPal): no se edita a mano.',
    paid_until: 'Lo escribe la suscripción con cada cobro aprobado: no se edita a mano.',
    failed: 'Lo escribe la suscripción con cada cobro rechazado: no se edita a mano.',
    link: 'Es el link para autorizar el débito automático: no se edita a mano.',
};
const COLLECTIONS_FREE = 'Para usarla a mano, quítala en «Columnas» de la sección «Cobros» de cualquier ficha de la lista.';
const SUBSCRIPTIONS_FREE = 'Para usarla a mano, quítala en «Columnas» de la sección «Suscripción» de cualquier ficha de la lista.';
const CHARGE_LOG_FREE = 'Para usarla a mano, quítala en «Columnas y registro de cobros» (sección «Suscripción» de la ficha de un suscriptor).';
export const HELPDESK_FREE_HINT = 'Para usarla a mano, apaga el SLA o elige otra columna en Ajustes de la lista → Mesa de ayuda.';

/** Todas las columnas protegidas de una lista, sin repetir (gana la primera regla). */
export function managedFieldLocks(listSettings: unknown): ManagedFieldLock[] {
    const out: ManagedFieldLock[] = [];
    const seen = new Set<number>();
    const add = (id: number | null | undefined, source: ManagedFieldSource, reason: string, freeHint: string | null, deletable = false): void => {
        if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || seen.has(id)) return;
        seen.add(id);
        out.push({ field_id: id, source, reason, deletable, free_hint: freeHint });
    };

    // D2/E5 — el SLA de la mesa de ayuda.
    const sla = readHelpdeskSettings(listSettings).sla;
    if (sla.enabled) {
        const reason = 'Lo calcula el SLA de la mesa de ayuda: no se edita a mano.';
        add(sla.first_due_field_id, 'helpdesk', reason, HELPDESK_FREE_HINT);
        add(sla.resolution_due_field_id, 'helpdesk', reason, HELPDESK_FREE_HINT);
        add(sla.sla_status_field_id, 'helpdesk', reason, HELPDESK_FREE_HINT);
    }

    // v0.1.367 — las columnas de la suscripción del registro.
    const subs = readSubscriptionFields(listSettings);
    if (subs) {
        for (const role of Object.keys(SUBSCRIPTION_REASONS) as SubscriptionFieldRole[]) {
            add(subs[role], 'subscriptions', SUBSCRIPTION_REASONS[role], SUBSCRIPTIONS_FREE);
        }
    }

    // v0.1.376 — lo que la importación trae de Mercado Pago al crear el registro.
    // Se escribe una sola vez: borrar la columna no rompe nada.
    const extras = (listSettings as { subscription_import_fields?: Record<string, unknown> } | null | undefined)?.subscription_import_fields;
    if (extras && typeof extras === 'object') {
        const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
        add(num(extras.external_id_field_id), 'subscription_import', 'Es el número de la suscripción en Mercado Pago: no se edita a mano.', null, true);
        add(num(extras.since_field_id), 'subscription_import', 'Es la fecha en que empezó la suscripción en Mercado Pago: no se edita a mano.', null, true);
    }

    // v0.1.365 — las columnas del cobro (links de pago).
    const coll = readCollectionFields(listSettings);
    if (coll) {
        add(coll.link, 'collections', PAYMENT_LINK_REASON, COLLECTIONS_FREE);
        add(coll.status, 'collections', PAYMENT_REASON, COLLECTIONS_FREE);
        add(coll.paid_at, 'collections', PAYMENT_REASON, COLLECTIONS_FREE);
        add(coll.paid_amount, 'collections', PAYMENT_REASON, COLLECTIONS_FREE);
        add(coll.method, 'collections', PAYMENT_REASON, COLLECTIONS_FREE);
    }

    // v0.1.371 — la lista donde queda cada cobro de las suscripciones.
    const log = readChargeLogMarker(listSettings);
    if (log) {
        add(log.record_field_id, 'charge_log', 'Es el suscriptor de este cobro: no se cambia a mano.', CHARGE_LOG_FREE);
        for (const id of log.field_ids) add(id, 'charge_log', 'Lo escribe el registro de cobros de las suscripciones: no se edita a mano.', CHARGE_LOG_FREE);
    }
    return out;
}

/** Los ids de las columnas protegidas de una lista. */
export function managedFieldIds(listSettings: unknown): number[] {
    return managedFieldLocks(listSettings).map((l) => l.field_id);
}

/** id → candado (para buscar rápido). */
export function managedFieldLockMap(listSettings: unknown): Map<number, ManagedFieldLock> {
    return new Map(managedFieldLocks(listSettings).map((l) => [l.field_id, l]));
}

/**
 * ¿La lista está dedicada a una sincronización de cobros? (la lista importada
 * de Mercado Pago o la del registro de cobros). Ahí la interfaz marca también
 * las columnas propias, para que se vea que nunca viajan al proveedor.
 */
export function isPaymentSyncList(listSettings: unknown): boolean {
    if (readChargeLogMarker(listSettings)) return true;
    const extras = (listSettings as { subscription_import_fields?: unknown } | null | undefined)?.subscription_import_fields;
    return !!extras && typeof extras === 'object' && readSubscriptionFields(listSettings) !== null;
}
