/**
 * Duraciones (v0.1.158).
 *
 * El valor se guarda como un NÚMERO de minutos: así el campo se filtra,
 * ordena y agrega (suma de horas de un proyecto, promedio de tiempo de
 * respuesta) con el mismo motor numérico que `number`/`currency`, sin un
 * parser especial en el QueryBuilder. El formato es sólo presentación.
 */

export const DURATION_FORMATS = ['hm', 'clock'] as const;
export type DurationFormat = (typeof DURATION_FORMATS)[number];

const MAX_MINUTES = 60 * 24 * 3650; // 10 años: techo sano contra typos.

export type DurationParse =
    | { ok: true; value: number }
    | { ok: false; error: string };

/**
 * Acepta lo que la gente realmente escribe:
 *   `90` → 90 min · `1:30` → 90 · `1h 30m` → 90 · `2h` → 120 · `45m` → 45
 *   `1d` → 1440 · `1d 2h` → 1560
 */
export function parseDuration(raw: unknown): DurationParse {
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw) || raw < 0) return { ok: false, error: 'Duración inválida.' };
        return capped(Math.round(raw));
    }
    if (typeof raw !== 'string') return { ok: false, error: 'Duración inválida.' };
    const s = raw.trim().toLowerCase();
    if (s === '') return { ok: false, error: 'Duración inválida.' };

    // Reloj: `1:30`, `12:05`, `100:30`.
    const clock = /^(\d{1,5}):([0-5]?\d)$/.exec(s);
    if (clock) {
        return capped(Number(clock[1]) * 60 + Number(clock[2]));
    }

    // Unidades: `1d 2h 30m`, `2h30m`, `45m`, `1.5h`.
    const unit = /(\d+(?:[.,]\d+)?)\s*(d|h|m|min|hs?|días?|dias?|horas?|minutos?)/g;
    let total = 0;
    let matched = false;
    for (;;) {
        const m = unit.exec(s);
        if (m === null) break;
        matched = true;
        const n = Number(String(m[1]).replace(',', '.'));
        if (!Number.isFinite(n)) return { ok: false, error: 'Duración inválida.' };
        const u = String(m[2]);
        const factor = u.startsWith('d') || u.startsWith('dí') || u.startsWith('di')
            ? 60 * 24
            : u.startsWith('h')
                ? 60
                : 1;
        total += n * factor;
    }
    if (matched) {
        // Si quedó texto que no es unidad ni separador, es un typo, no una duración.
        const leftover = s.replace(unit, '').replace(/[\s,y+]/g, '');
        if (leftover !== '') return { ok: false, error: 'Duración inválida.' };
        return capped(Math.round(total));
    }

    // Sólo un número: minutos.
    const plain = Number(s.replace(',', '.'));
    if (!Number.isFinite(plain) || plain < 0) return { ok: false, error: 'Duración inválida.' };
    return capped(Math.round(plain));
}

function capped(minutes: number): DurationParse {
    if (minutes < 0) return { ok: false, error: 'Duración inválida.' };
    if (minutes > MAX_MINUTES) return { ok: false, error: 'La duración es demasiado larga.' };
    return { ok: true, value: minutes };
}

/** `90` → `1h 30m` (o `1:30` con el formato de reloj). */
export function formatDuration(minutes: unknown, format: DurationFormat = 'hm'): string {
    const n = typeof minutes === 'number' ? minutes : Number(minutes);
    if (!Number.isFinite(n) || n < 0) return '';
    const total = Math.round(n);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (format === 'clock') return `${h}:${String(m).padStart(2, '0')}`;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}
