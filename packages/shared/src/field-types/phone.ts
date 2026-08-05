/**
 * Teléfonos (v0.1.158).
 *
 * El valor se guarda SIEMPRE en una sola cadena canónica tipo E.164
 * (`+573001112233`): un solo string en el JSONB, comparable, buscable y
 * listo para `tel:`, para WhatsApp y para mandarlo por webhook sin tener
 * que re-armarlo. El indicativo NO es una segunda columna — se deriva del
 * propio valor (ver `splitPhone`), así renombrar países o cambiar la
 * config del campo no invalida datos ya guardados.
 *
 * El catálogo es CURADO, no exhaustivo: cubre América, Europa occidental y
 * los destinos frecuentes. Un país que no esté igual se puede escribir a
 * mano con `+` (la validación sólo exige `+` y dígitos), así que la lista
 * es una comodidad de la UI, nunca un límite de lo que se puede guardar.
 */

export interface CountryDialCode {
    /** ISO 3166-1 alfa-2. */
    iso2: string;
    name: string;
    /** Indicativo SIN el `+`. */
    dial: string;
}

export const COUNTRY_DIAL_CODES: readonly CountryDialCode[] = [
    { iso2: 'AR', name: 'Argentina', dial: '54' },
    { iso2: 'BO', name: 'Bolivia', dial: '591' },
    { iso2: 'BR', name: 'Brasil', dial: '55' },
    { iso2: 'CL', name: 'Chile', dial: '56' },
    { iso2: 'CO', name: 'Colombia', dial: '57' },
    { iso2: 'CR', name: 'Costa Rica', dial: '506' },
    { iso2: 'CU', name: 'Cuba', dial: '53' },
    { iso2: 'DO', name: 'República Dominicana', dial: '1809' },
    { iso2: 'EC', name: 'Ecuador', dial: '593' },
    { iso2: 'SV', name: 'El Salvador', dial: '503' },
    { iso2: 'GT', name: 'Guatemala', dial: '502' },
    { iso2: 'HN', name: 'Honduras', dial: '504' },
    { iso2: 'MX', name: 'México', dial: '52' },
    { iso2: 'NI', name: 'Nicaragua', dial: '505' },
    { iso2: 'PA', name: 'Panamá', dial: '507' },
    { iso2: 'PY', name: 'Paraguay', dial: '595' },
    { iso2: 'PE', name: 'Perú', dial: '51' },
    { iso2: 'PR', name: 'Puerto Rico', dial: '1787' },
    { iso2: 'UY', name: 'Uruguay', dial: '598' },
    { iso2: 'VE', name: 'Venezuela', dial: '58' },
    { iso2: 'US', name: 'Estados Unidos', dial: '1' },
    { iso2: 'CA', name: 'Canadá', dial: '1' },
    { iso2: 'ES', name: 'España', dial: '34' },
    { iso2: 'PT', name: 'Portugal', dial: '351' },
    { iso2: 'FR', name: 'Francia', dial: '33' },
    { iso2: 'IT', name: 'Italia', dial: '39' },
    { iso2: 'DE', name: 'Alemania', dial: '49' },
    { iso2: 'GB', name: 'Reino Unido', dial: '44' },
    { iso2: 'IE', name: 'Irlanda', dial: '353' },
    { iso2: 'NL', name: 'Países Bajos', dial: '31' },
    { iso2: 'BE', name: 'Bélgica', dial: '32' },
    { iso2: 'CH', name: 'Suiza', dial: '41' },
    { iso2: 'AT', name: 'Austria', dial: '43' },
    { iso2: 'SE', name: 'Suecia', dial: '46' },
    { iso2: 'NO', name: 'Noruega', dial: '47' },
    { iso2: 'DK', name: 'Dinamarca', dial: '45' },
    { iso2: 'FI', name: 'Finlandia', dial: '358' },
    { iso2: 'PL', name: 'Polonia', dial: '48' },
    { iso2: 'RO', name: 'Rumania', dial: '40' },
    { iso2: 'GR', name: 'Grecia', dial: '30' },
    { iso2: 'TR', name: 'Turquía', dial: '90' },
    { iso2: 'RU', name: 'Rusia', dial: '7' },
    { iso2: 'IL', name: 'Israel', dial: '972' },
    { iso2: 'AE', name: 'Emiratos Árabes Unidos', dial: '971' },
    { iso2: 'SA', name: 'Arabia Saudita', dial: '966' },
    { iso2: 'ZA', name: 'Sudáfrica', dial: '27' },
    { iso2: 'NG', name: 'Nigeria', dial: '234' },
    { iso2: 'EG', name: 'Egipto', dial: '20' },
    { iso2: 'MA', name: 'Marruecos', dial: '212' },
    { iso2: 'IN', name: 'India', dial: '91' },
    { iso2: 'CN', name: 'China', dial: '86' },
    { iso2: 'JP', name: 'Japón', dial: '81' },
    { iso2: 'KR', name: 'Corea del Sur', dial: '82' },
    { iso2: 'ID', name: 'Indonesia', dial: '62' },
    { iso2: 'PH', name: 'Filipinas', dial: '63' },
    { iso2: 'AU', name: 'Australia', dial: '61' },
    { iso2: 'NZ', name: 'Nueva Zelanda', dial: '64' },
];

/** Indicativo (sin `+`) de un país del catálogo, o `null`. */
export function dialCodeFor(iso2: string | null | undefined): string | null {
    if (typeof iso2 !== 'string' || iso2.length !== 2) return null;
    const up = iso2.toUpperCase();
    return COUNTRY_DIAL_CODES.find((c) => c.iso2 === up)?.dial ?? null;
}

/** Total de dígitos permitido (E.164 llega hasta 15; damos margen). */
const MIN_DIGITS = 6;
const MAX_DIGITS = 17;

export interface PhoneParts {
    /** País del catálogo cuyo indicativo matchea (el más largo gana). */
    country: CountryDialCode | null;
    /** Indicativo SIN `+` (vacío si el valor no lo trae). */
    dial: string;
    /** El resto del número. */
    national: string;
}

/**
 * Parte un valor canónico en indicativo + número. El indicativo NO es
 * ambiguo por el largo: `+1809…` (Dominicana) y `+1…` (EE.UU.) comparten
 * prefijo, así que gana el match MÁS LARGO.
 */
export function splitPhone(value: string): PhoneParts {
    const raw = String(value ?? '').trim();
    if (!raw.startsWith('+')) return { country: null, dial: '', national: raw.replace(/\D/g, '') };
    const digits = raw.slice(1).replace(/\D/g, '');
    let best: CountryDialCode | null = null;
    for (const c of COUNTRY_DIAL_CODES) {
        if (digits.startsWith(c.dial) && (best === null || c.dial.length > best.dial.length)) {
            best = c;
        }
    }
    if (best === null) return { country: null, dial: '', national: digits };
    return { country: best, dial: best.dial, national: digits.slice(best.dial.length) };
}

export type PhoneNormalization =
    | { ok: true; value: string }
    | { ok: false; error: string };

/**
 * Normaliza lo que sea que haya escrito (o importado) el usuario:
 * espacios, guiones, paréntesis y puntos se descartan, `00` inicial se
 * traduce a `+`, y un número SIN indicativo toma el del país configurado
 * en el campo (si el campo no configuró ninguno se guarda tal cual: mejor
 * conservar el dato del cliente que inventarle un país).
 */
export function normalizePhone(raw: unknown, defaultCountry?: string | null): PhoneNormalization {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
        return { ok: false, error: 'Se esperaba un teléfono.' };
    }
    let s = String(raw).trim();
    if (s === '') return { ok: false, error: 'Se esperaba un teléfono.' };
    // Prefijo internacional escrito como `00` (Europa/LatAm) → `+`.
    if (s.startsWith('00')) s = `+${s.slice(2)}`;
    const hasPlus = s.startsWith('+');
    const digits = s.replace(/\D/g, '');
    if (digits === '') return { ok: false, error: 'El teléfono no tiene dígitos.' };
    if (digits.length > MAX_DIGITS) return { ok: false, error: 'El teléfono tiene demasiados dígitos.' };

    if (hasPlus) {
        if (digits.length < MIN_DIGITS) return { ok: false, error: 'El teléfono es demasiado corto.' };
        return { ok: true, value: `+${digits}` };
    }
    const dial = dialCodeFor(defaultCountry ?? null);
    if (dial !== null) {
        // Un `0` de tronco nacional (España, Argentina fijo, etc.) no va
        // en formato internacional.
        const national = digits.replace(/^0+/, '');
        if (national.length < 4) return { ok: false, error: 'El teléfono es demasiado corto.' };
        if (dial.length + national.length > MAX_DIGITS) {
            return { ok: false, error: 'El teléfono tiene demasiados dígitos.' };
        }
        return { ok: true, value: `+${dial}${national}` };
    }
    if (digits.length < MIN_DIGITS) return { ok: false, error: 'El teléfono es demasiado corto.' };
    return { ok: true, value: digits };
}

/**
 * Formato de lectura: `+57 300 111 2233`. Sólo cosmético — lo que viaja a
 * las automatizaciones y a los webhooks es el valor canónico.
 */
export function formatPhone(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') return '';
    const { dial, national } = splitPhone(value);
    const grouped = groupDigits(national);
    if (dial === '') return grouped === '' ? value : grouped;
    return `+${dial} ${grouped}`.trim();
}

/** Agrupa de a 3 (10 dígitos → 3-3-4, el formato que espera casi todo el mundo). */
function groupDigits(digits: string): string {
    if (digits.length === 0) return '';
    if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    const out: string[] = [];
    for (let i = 0; i < digits.length; i += 3) out.push(digits.slice(i, i + 3));
    // Un último grupo de 1 dígito se pega al anterior (queda más legible).
    if (out.length > 1 && (out[out.length - 1] as string).length === 1) {
        const last = out.pop() as string;
        out[out.length - 1] = `${out[out.length - 1] as string}${last}`;
    }
    return out.join(' ');
}
