/**
 * Resuelve merge tags `{{slug}}` en un template contra los valores de un
 * registro. Soporta `{{record.id}}` y `{{slug}}` (valor del campo por slug).
 * Un array (multi_select) se une por coma.
 *
 * Modificadores de FECHA (v0.1.86, facturación con período anticipado/
 * vencido): `{{campo|+1m}}`, `{{campo|-1d}}`, encadenables —
 * `{{before.proximo_cobro|+1m|-1d}}` = "un mes menos un día después de la
 * fecha que venció" (el fin del período anticipado). Unidades: d (días),
 * m (meses, con clamp al último día — 31/01 +1m → 28/02), y (años). Si el
 * valor base no es una fecha (YYYY-MM-DD...), los modificadores se ignoran
 * y el valor pasa tal cual.
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
    return template.replace(
        /\{\{\s*([a-zA-Z0-9_.]+)((?:\|[+-]\d+[dmy])*)\s*\}\}/g,
        (_m, token: string, mods: string) => {
            let v: unknown;
            if (token === 'record.id') {
                v = recordId === null ? '' : String(recordId);
            } else {
                v = fieldValue(token);
            }
            if (v === null || v === undefined) return '';
            if (Array.isArray(v)) return esc(v.map((x) => String(x)).join(', '));
            let out = String(v);
            if (mods) out = applyDateModifiers(out, mods);
            return esc(out);
        },
    );
}

/**
 * Aplica una cadena de modificadores (`|+1m|-1d`) a un valor fecha
 * `YYYY-MM-DD` (o datetime `YYYY-MM-DD ...` — se preserva la cola). Si el
 * valor no parsea como fecha, se devuelve intacto.
 */
function applyDateModifiers(value: string, mods: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
    if (!m) return value;
    let y = Number(m[1]);
    let mo = Number(m[2]); // 1-12
    let d = Number(m[3]);
    const tail = m[4] ?? '';

    for (const mod of mods.split('|').filter(Boolean)) {
        const mm = /^([+-])(\d+)([dmy])$/.exec(mod);
        if (!mm) continue;
        const sign = mm[1] === '-' ? -1 : 1;
        const n = sign * Number(mm[2]);
        if (mm[3] === 'd') {
            // Date.UTC normaliza overflow/underflow de días.
            const dt = new Date(Date.UTC(y, mo - 1, d + n));
            y = dt.getUTCFullYear();
            mo = dt.getUTCMonth() + 1;
            d = dt.getUTCDate();
        } else {
            // Meses/años: aritmética de componentes con CLAMP al último día
            // del mes destino (31/01 +1m → 28/02, no 03/03).
            const totalMonths = mm[3] === 'm' ? n : n * 12;
            const base = (mo - 1) + totalMonths;
            y += Math.floor(base / 12);
            mo = ((base % 12) + 12) % 12 + 1;
            const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
            if (d > lastDay) d = lastDay;
        }
    }
    const pad = (x: number): string => String(x).padStart(2, '0');
    return `${y}-${pad(mo)}-${pad(d)}${tail}`;
}
