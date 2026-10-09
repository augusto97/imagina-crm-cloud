/**
 * v0.1.276 — Atajos de «Recordarme» en la hora de la PERSONA (su navegador):
 * un recordatorio es personal, no de la empresa.
 */
export interface ReminderPreset {
    key: string;
    label: string;
    at: Date;
}

function at(base: Date, days: number, hour: number): Date {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
}

export function reminderPresets(now: Date = new Date()): ReminderPreset[] {
    const out: ReminderPreset[] = [{ key: 'hour', label: 'En 1 hora', at: new Date(now.getTime() + 3_600_000) }];
    const afternoon = at(now, 0, 17);
    if (afternoon.getTime() - now.getTime() > 30 * 60_000) out.push({ key: 'today', label: 'Hoy a las 17:00', at: afternoon });
    out.push({ key: 'tomorrow', label: 'Mañana a las 9:00', at: at(now, 1, 9) });
    out.push({ key: 'days3', label: 'En 3 días', at: at(now, 3, 9) });
    // Próximo lunes (si hoy es lunes, el de la semana que viene).
    const toMonday = ((8 - now.getDay()) % 7) || 7;
    out.push({ key: 'monday', label: 'El lunes a las 9:00', at: at(now, toMonday, 9) });
    return out;
}

/** `Date` → valor de un `<input type="datetime-local">` (hora local). */
export function toLocalInput(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
