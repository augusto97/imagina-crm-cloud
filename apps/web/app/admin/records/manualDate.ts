import type { DateFormatId } from '@/lib/tenantFormat';

/** Date → `YYYY-MM-DD` (componentes locales, sin timezone). */
export function toIsoDay(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * v0.1.192 — el cuadro "escribir fecha" del picker habla el MISMO formato
 * que la tabla (el formato regional de la empresa, v0.1.104): la celda
 * decía `30/07/2026` y el cuadro `2026-07-30`, y el usuario no sabía
 * cuál era el orden correcto.
 */
export function formatManualDate(d: Date, format: DateFormatId): string {
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (format === 'dmy') return `${day}/${m}/${y}`;
    if (format === 'mdy') return `${m}/${day}/${y}`;
    return `${y}-${m}-${day}`;
}

/** Placeholder del cuadro, en el orden del formato. */
export function manualDatePlaceholder(format: DateFormatId): string {
    if (format === 'dmy') return 'DD/MM/AAAA';
    if (format === 'mdy') return 'MM/DD/AAAA';
    return 'AAAA-MM-DD';
}

/**
 * Parsea la fecha tipeada a mano. `AAAA-MM-DD` se acepta SIEMPRE; con dos
 * cifras al frente (`/`, `-` o `.` como separador, año de 2 o 4 dígitos)
 * el orden lo dicta el formato de la empresa: `dmy` → día/mes/año,
 * `mdy` → mes/día/año. Devuelve undefined si no es una fecha real.
 */
export function parseManualDate(text: string, format: DateFormatId = 'dmy'): Date | undefined {
    const t = text.trim();
    if (t === '') return undefined;
    let y: number, m: number, d: number;
    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
    if (match) {
        y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
    } else {
        match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
        if (!match) return undefined;
        const a = Number(match[1]);
        const b = Number(match[2]);
        y = Number(match[3]);
        if (format === 'mdy') {
            m = a; d = b;
        } else {
            d = a; m = b;
        }
        if (y < 100) y += 2000;
    }
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const date = new Date(y, m - 1, d);
    // Rechazar overflow (31/02 → 03/03).
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return undefined;
    return date;
}
