/**
 * Resuelve merge tags `{{slug}}` en un template contra los valores de un
 * registro. Soporta `{{record.id}}` y `{{slug}}` (valor del campo por slug).
 * Un array (multi_select) se une por coma.
 *
 * `escapeValue` (SEC-08): cuando el destino es HTML (email is_html), se pasa un
 * escapador para que los VALORES interpolados (datos del registro, que pueden
 * venir de un cliente del portal o de un import) no inyecten HTML/JS. El
 * template en sí lo autoró el admin y NO se escapa.
 */
export function applyMergeTags(
    template: string,
    fieldValue: (slug: string) => unknown,
    recordId: number | null,
    escapeValue?: (s: string) => string,
): string {
    if (!template) return template;
    const esc = escapeValue ?? ((s: string) => s);
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, token: string) => {
        if (token === 'record.id') return recordId === null ? '' : esc(String(recordId));
        const v = fieldValue(token);
        if (v === null || v === undefined) return '';
        if (Array.isArray(v)) return esc(v.map((x) => String(x)).join(', '));
        return esc(String(v));
    });
}
