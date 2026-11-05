import {
    COLLECTION_FIELD_ROLES,
    suggestCollectionFields,
    type CollectionFieldRole,
    type CollectionFields,
} from '@imagina-base/shared';

export type Choice = number | 'create' | null;

export interface FieldLike {
    id: number;
    label: string;
    type: string;
    config?: unknown;
}

/** Para qué sirve cada columna, en una línea. */
export const ROLE_HINTS: Record<CollectionFieldRole, string> = {
    link: 'El link que se le manda al cliente.',
    status: 'Pendiente, Pagado, Rechazado… se actualiza solo.',
    paid_at: 'Cuándo pagó. Puede ser una fecha que ya usas (por ejemplo, la que dispara tu renovación).',
    paid_amount: 'Cuánto pagó.',
    method: 'Tarjeta, PSE, Nequi…',
};

/**
 * Lo que se propone cuando la lista todavía no eligió columnas: las que YA
 * tiene y sirven (un «Link de pago» hecho a mano) y, para el link, el estado y
 * la fecha, columnas nuevas.
 */
export function proposeCollectionChoices(fields: FieldLike[], current: CollectionFields | null): Record<CollectionFieldRole, Choice> {
    const out = {} as Record<CollectionFieldRole, Choice>;
    // Ya eligió: se muestra lo guardado tal cual («No guardar» también es una
    // elección; no se le vuelve a proponer una columna).
    if (current) {
        const alive = new Set(fields.map((f) => f.id));
        for (const role of COLLECTION_FIELD_ROLES) out[role] = current[role] !== null && alive.has(current[role]!) ? current[role] : null;
        return out;
    }
    const suggested = suggestCollectionFields(fields, null);
    for (const role of COLLECTION_FIELD_ROLES) {
        if (suggested[role] !== null) out[role] = suggested[role];
        else out[role] = role === 'link' || role === 'status' || role === 'paid_at' ? 'create' : null;
    }
    return out;
}

