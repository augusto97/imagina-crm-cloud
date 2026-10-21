/**
 * v0.1.288 — Keys del historial por campo. Aparte de `useFieldHistory` para
 * que `useRecords` (que lo invalida al editar) no arme un ciclo de imports.
 * El id de la lista va en el ÍNDICE 1, como el resto de las familias:
 * `invalidateForList` lo encuentra por id o por slug (regla de oro nº 7).
 */
export const fieldHistoryKeys = {
    all: ['field-history'] as const,
    forField: (listId: string | number, recordId: number, fieldId: number) =>
        ['field-history', String(listId), recordId, fieldId] as const,
};
