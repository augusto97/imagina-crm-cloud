/**
 * Resuelve merge tags `{{slug}}` en un template contra los valores de un
 * registro. Soporta `{{record.id}}` y `{{slug}}` (valor del campo por slug).
 * Un array (multi_select) se une por coma.
 */
export function applyMergeTags(
    template: string,
    fieldValue: (slug: string) => unknown,
    recordId: number | null,
): string {
    if (!template) return template;
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, token: string) => {
        if (token === 'record.id') return recordId === null ? '' : String(recordId);
        const v = fieldValue(token);
        if (v === null || v === undefined) return '';
        if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
        return String(v);
    });
}
