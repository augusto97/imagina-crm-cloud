/**
 * v0.1.349 — Festivos por país (agenda de citas; ADR-S67 addendum).
 *
 * Los festivos salen de los calendarios OFICIALES de festivos de Google (los
 * mismos que muestra Google Calendar en «Festivos en …»): están al día con los
 * decretos de cada país —un puente nuevo en Argentina, un festivo que se mueve
 * en Chile— sin que haya que sacar una versión de la app. El servidor los baja
 * por iCal público (sin cuenta ni clave), los guarda en caché y, si Google no
 * responde, usa lo último que supo; para Colombia, además, las reglas de la
 * app (Ley Emiliani) son el respaldo.
 *
 * Aquí: el catálogo de países (código ISO → calendario de Google) y cómo se
 * clasifica cada festivo. PURO.
 */

export interface HolidayCountry {
    /** ISO 3166-1 alfa-2. */
    code: string;
    name: string;
    /** Identificador del calendario de festivos de Google (sin el prefijo de idioma). */
    calendar: string;
}

/**
 * Países con calendario oficial de festivos (verificados uno por uno: cada uno
 * responde con su iCal). Latinoamérica primero, después el resto, por nombre.
 */
export const HOLIDAY_COUNTRIES: readonly HolidayCountry[] = [
    { code: 'AR', name: 'Argentina', calendar: 'ar.official' },
    { code: 'BO', name: 'Bolivia', calendar: 'bo.official' },
    { code: 'BR', name: 'Brasil', calendar: 'brazilian.official' },
    { code: 'CL', name: 'Chile', calendar: 'cl.official' },
    { code: 'CO', name: 'Colombia', calendar: 'co.official' },
    { code: 'CR', name: 'Costa Rica', calendar: 'cr.official' },
    { code: 'CU', name: 'Cuba', calendar: 'cu.official' },
    { code: 'EC', name: 'Ecuador', calendar: 'ec.official' },
    { code: 'SV', name: 'El Salvador', calendar: 'sv.official' },
    { code: 'GT', name: 'Guatemala', calendar: 'gt.official' },
    { code: 'HN', name: 'Honduras', calendar: 'hn.official' },
    { code: 'MX', name: 'México', calendar: 'mexican.official' },
    { code: 'NI', name: 'Nicaragua', calendar: 'ni.official' },
    { code: 'PA', name: 'Panamá', calendar: 'pa.official' },
    { code: 'PY', name: 'Paraguay', calendar: 'py.official' },
    { code: 'PE', name: 'Perú', calendar: 'pe.official' },
    { code: 'PR', name: 'Puerto Rico', calendar: 'pr.official' },
    { code: 'DO', name: 'República Dominicana', calendar: 'do.official' },
    { code: 'UY', name: 'Uruguay', calendar: 'uy.official' },
    { code: 'VE', name: 'Venezuela', calendar: 've.official' },
    { code: 'DE', name: 'Alemania', calendar: 'german.official' },
    { code: 'BE', name: 'Bélgica', calendar: 'be.official' },
    { code: 'CA', name: 'Canadá', calendar: 'canadian.official' },
    { code: 'ES', name: 'España', calendar: 'spain.official' },
    { code: 'US', name: 'Estados Unidos', calendar: 'usa.official' },
    { code: 'FR', name: 'Francia', calendar: 'french.official' },
    { code: 'GQ', name: 'Guinea Ecuatorial', calendar: 'gq.official' },
    { code: 'IE', name: 'Irlanda', calendar: 'irish.official' },
    { code: 'IT', name: 'Italia', calendar: 'italian.official' },
    { code: 'NL', name: 'Países Bajos', calendar: 'dutch.official' },
    { code: 'PT', name: 'Portugal', calendar: 'portuguese.official' },
    { code: 'GB', name: 'Reino Unido', calendar: 'uk.official' },
    { code: 'CH', name: 'Suiza', calendar: 'ch.official' },
];

const BY_CODE = new Map(HOLIDAY_COUNTRIES.map((c) => [c.code, c]));

export function holidayCountry(code: string | null | undefined): HolidayCountry | null {
    return code ? BY_CODE.get(code.toUpperCase()) ?? null : null;
}

/** La dirección del iCal público de los festivos de un país (nombres en español). */
export function holidayIcsUrl(country: HolidayCountry, base = 'https://calendar.google.com'): string {
    const id = encodeURIComponent(`es.${country.calendar}#holiday@group.v.calendar.google.com`);
    return `${base.replace(/\/+$/, '')}/calendar/ical/${id}/public/basic.ics`;
}

/**
 * Qué tipo de festivo es (lo que dice Google en la descripción):
 *  - `national`: festivo de todo el país — no se atiende, salvo que se marque.
 *  - `regional`: sólo de algunas regiones («Festivo en Alberta…») — se atiende,
 *    salvo que se marque que ese día tampoco.
 *  - `half`: medio día festivo — cuenta como festivo (se puede marcar que se atiende).
 */
export type HolidayKind = 'national' | 'regional' | 'half';

export interface HolidayItem {
    /** YYYY-MM-DD. */
    date: string;
    name: string;
    kind: HolidayKind;
}

export function classifyHoliday(description: string): HolidayKind {
    const d = description.toLowerCase();
    if (/medio d[ií]a|half[- ]day/.test(d)) return 'half';
    if (/(festivo|public holiday|feriado) (en|in) /.test(d)) return 'regional';
    return 'national';
}

/** ¿Ese festivo bloquea el día por defecto? (lo nacional y el medio día sí; lo regional no). */
export function holidayBlocksByDefault(kind: HolidayKind): boolean {
    return kind !== 'regional';
}

/**
 * Las fechas en que la persona NO atiende por festivo: los que bloquean por
 * defecto, menos los marcados «atiende», más los regionales marcados «no atiende».
 */
export function blockedHolidayDates(items: readonly HolidayItem[], work: readonly string[], off: readonly string[]): Set<string> {
    const workSet = new Set(work);
    const out = new Set<string>();
    for (const h of items) {
        if (holidayBlocksByDefault(h.kind) ? !workSet.has(h.date) : off.includes(h.date)) out.add(h.date);
    }
    return out;
}

/** País sugerido para la zona horaria de la empresa (para no empezar en blanco). */
const TZ_COUNTRY: Record<string, string> = {
    'America/Bogota': 'CO',
    'America/Mexico_City': 'MX',
    'America/Monterrey': 'MX',
    'America/Merida': 'MX',
    'America/Cancun': 'MX',
    'America/Tijuana': 'MX',
    'America/Chihuahua': 'MX',
    'America/Hermosillo': 'MX',
    'America/Mazatlan': 'MX',
    'America/Lima': 'PE',
    'America/Guayaquil': 'EC',
    'America/Caracas': 'VE',
    'America/Santiago': 'CL',
    'America/Argentina/Buenos_Aires': 'AR',
    'America/Buenos_Aires': 'AR',
    'America/Argentina/Cordoba': 'AR',
    'America/Montevideo': 'UY',
    'America/Asuncion': 'PY',
    'America/La_Paz': 'BO',
    'America/Sao_Paulo': 'BR',
    'America/Panama': 'PA',
    'America/Costa_Rica': 'CR',
    'America/Guatemala': 'GT',
    'America/Tegucigalpa': 'HN',
    'America/El_Salvador': 'SV',
    'America/Managua': 'NI',
    'America/Santo_Domingo': 'DO',
    'America/Puerto_Rico': 'PR',
    'America/Havana': 'CU',
    'America/New_York': 'US',
    'America/Chicago': 'US',
    'America/Denver': 'US',
    'America/Los_Angeles': 'US',
    'America/Phoenix': 'US',
    'America/Toronto': 'CA',
    'America/Vancouver': 'CA',
    'Europe/Madrid': 'ES',
    'Atlantic/Canary': 'ES',
    'Europe/Lisbon': 'PT',
    'Europe/London': 'GB',
    'Europe/Paris': 'FR',
    'Europe/Berlin': 'DE',
    'Europe/Rome': 'IT',
    'Europe/Amsterdam': 'NL',
    'Europe/Brussels': 'BE',
    'Europe/Zurich': 'CH',
    'Europe/Dublin': 'IE',
};

export function holidayCountryForTimeZone(tz: string | null | undefined): string | null {
    return (tz && TZ_COUNTRY[tz]) || null;
}
