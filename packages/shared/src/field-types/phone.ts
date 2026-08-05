/**
 * Teléfonos (v0.1.158, catálogo completo y buscador en v0.1.159).
 *
 * El valor se guarda SIEMPRE en una sola cadena canónica tipo E.164
 * (`+573001112233`): un solo string en el JSONB, comparable, buscable y
 * listo para `tel:`, para WhatsApp y para mandarlo por webhook sin tener
 * que re-armarlo. El indicativo NO es una segunda columna — se deriva del
 * propio valor (ver `splitPhone`), así renombrar países o cambiar la
 * config del campo no invalida datos ya guardados.
 */

export interface CountryDialCode {
    /** ISO 3166-1 alfa-2. */
    iso2: string;
    name: string;
    /** Indicativo SIN el `+`. */
    dial: string;
}

/**
 * Catálogo COMPLETO (todos los territorios con indicativo asignado). Con el
 * buscador del selector una lista larga no molesta, y cortarla obligaría a
 * escribir el `+` a mano justo a quien tiene un cliente en el país que
 * faltaba. Los territorios del plan de numeración norteamericano (+1) llevan
 * su prefijo de 4 dígitos (`1809` = Dominicana) para poder distinguirlos —
 * ver `splitPhone`, donde gana el match más largo.
 */
export const COUNTRY_DIAL_CODES: readonly CountryDialCode[] = [
    { iso2: 'AF', name: 'Afganistán', dial: '93' },
    { iso2: 'AL', name: 'Albania', dial: '355' },
    { iso2: 'DE', name: 'Alemania', dial: '49' },
    { iso2: 'AD', name: 'Andorra', dial: '376' },
    { iso2: 'AO', name: 'Angola', dial: '244' },
    { iso2: 'AI', name: 'Anguila', dial: '1264' },
    { iso2: 'AG', name: 'Antigua y Barbuda', dial: '1268' },
    { iso2: 'SA', name: 'Arabia Saudita', dial: '966' },
    { iso2: 'DZ', name: 'Argelia', dial: '213' },
    { iso2: 'AR', name: 'Argentina', dial: '54' },
    { iso2: 'AM', name: 'Armenia', dial: '374' },
    { iso2: 'AW', name: 'Aruba', dial: '297' },
    { iso2: 'AU', name: 'Australia', dial: '61' },
    { iso2: 'AT', name: 'Austria', dial: '43' },
    { iso2: 'AZ', name: 'Azerbaiyán', dial: '994' },
    { iso2: 'BS', name: 'Bahamas', dial: '1242' },
    { iso2: 'BD', name: 'Bangladés', dial: '880' },
    { iso2: 'BB', name: 'Barbados', dial: '1246' },
    { iso2: 'BH', name: 'Baréin', dial: '973' },
    { iso2: 'BE', name: 'Bélgica', dial: '32' },
    { iso2: 'BZ', name: 'Belice', dial: '501' },
    { iso2: 'BJ', name: 'Benín', dial: '229' },
    { iso2: 'BM', name: 'Bermudas', dial: '1441' },
    { iso2: 'BY', name: 'Bielorrusia', dial: '375' },
    { iso2: 'BO', name: 'Bolivia', dial: '591' },
    { iso2: 'BA', name: 'Bosnia y Herzegovina', dial: '387' },
    { iso2: 'BW', name: 'Botsuana', dial: '267' },
    { iso2: 'BR', name: 'Brasil', dial: '55' },
    { iso2: 'BN', name: 'Brunéi', dial: '673' },
    { iso2: 'BG', name: 'Bulgaria', dial: '359' },
    { iso2: 'BF', name: 'Burkina Faso', dial: '226' },
    { iso2: 'BI', name: 'Burundi', dial: '257' },
    { iso2: 'BT', name: 'Bután', dial: '975' },
    { iso2: 'CV', name: 'Cabo Verde', dial: '238' },
    { iso2: 'KH', name: 'Camboya', dial: '855' },
    { iso2: 'CM', name: 'Camerún', dial: '237' },
    { iso2: 'CA', name: 'Canadá', dial: '1' },
    { iso2: 'QA', name: 'Catar', dial: '974' },
    { iso2: 'TD', name: 'Chad', dial: '235' },
    { iso2: 'CL', name: 'Chile', dial: '56' },
    { iso2: 'CN', name: 'China', dial: '86' },
    { iso2: 'CY', name: 'Chipre', dial: '357' },
    { iso2: 'VA', name: 'Ciudad del Vaticano', dial: '379' },
    { iso2: 'CO', name: 'Colombia', dial: '57' },
    { iso2: 'KM', name: 'Comoras', dial: '269' },
    { iso2: 'CG', name: 'Congo', dial: '242' },
    { iso2: 'CD', name: 'Congo (RD)', dial: '243' },
    { iso2: 'KP', name: 'Corea del Norte', dial: '850' },
    { iso2: 'KR', name: 'Corea del Sur', dial: '82' },
    { iso2: 'CI', name: 'Costa de Marfil', dial: '225' },
    { iso2: 'CR', name: 'Costa Rica', dial: '506' },
    { iso2: 'HR', name: 'Croacia', dial: '385' },
    { iso2: 'CU', name: 'Cuba', dial: '53' },
    { iso2: 'CW', name: 'Curazao', dial: '599' },
    { iso2: 'DK', name: 'Dinamarca', dial: '45' },
    { iso2: 'DM', name: 'Dominica', dial: '1767' },
    { iso2: 'EC', name: 'Ecuador', dial: '593' },
    { iso2: 'EG', name: 'Egipto', dial: '20' },
    { iso2: 'SV', name: 'El Salvador', dial: '503' },
    { iso2: 'AE', name: 'Emiratos Árabes Unidos', dial: '971' },
    { iso2: 'ER', name: 'Eritrea', dial: '291' },
    { iso2: 'SK', name: 'Eslovaquia', dial: '421' },
    { iso2: 'SI', name: 'Eslovenia', dial: '386' },
    { iso2: 'ES', name: 'España', dial: '34' },
    { iso2: 'US', name: 'Estados Unidos', dial: '1' },
    { iso2: 'EE', name: 'Estonia', dial: '372' },
    { iso2: 'SZ', name: 'Esuatini', dial: '268' },
    { iso2: 'ET', name: 'Etiopía', dial: '251' },
    { iso2: 'PH', name: 'Filipinas', dial: '63' },
    { iso2: 'FI', name: 'Finlandia', dial: '358' },
    { iso2: 'FJ', name: 'Fiyi', dial: '679' },
    { iso2: 'FR', name: 'Francia', dial: '33' },
    { iso2: 'GA', name: 'Gabón', dial: '241' },
    { iso2: 'GM', name: 'Gambia', dial: '220' },
    { iso2: 'GE', name: 'Georgia', dial: '995' },
    { iso2: 'GH', name: 'Ghana', dial: '233' },
    { iso2: 'GI', name: 'Gibraltar', dial: '350' },
    { iso2: 'GD', name: 'Granada', dial: '1473' },
    { iso2: 'GR', name: 'Grecia', dial: '30' },
    { iso2: 'GL', name: 'Groenlandia', dial: '299' },
    { iso2: 'GP', name: 'Guadalupe', dial: '590' },
    { iso2: 'GU', name: 'Guam', dial: '1671' },
    { iso2: 'GT', name: 'Guatemala', dial: '502' },
    { iso2: 'GF', name: 'Guayana Francesa', dial: '594' },
    { iso2: 'GG', name: 'Guernsey', dial: '44' },
    { iso2: 'GN', name: 'Guinea', dial: '224' },
    { iso2: 'GQ', name: 'Guinea Ecuatorial', dial: '240' },
    { iso2: 'GW', name: 'Guinea-Bisáu', dial: '245' },
    { iso2: 'GY', name: 'Guyana', dial: '592' },
    { iso2: 'HT', name: 'Haití', dial: '509' },
    { iso2: 'HN', name: 'Honduras', dial: '504' },
    { iso2: 'HK', name: 'Hong Kong', dial: '852' },
    { iso2: 'HU', name: 'Hungría', dial: '36' },
    { iso2: 'IN', name: 'India', dial: '91' },
    { iso2: 'ID', name: 'Indonesia', dial: '62' },
    { iso2: 'IQ', name: 'Irak', dial: '964' },
    { iso2: 'IR', name: 'Irán', dial: '98' },
    { iso2: 'IE', name: 'Irlanda', dial: '353' },
    { iso2: 'IM', name: 'Isla de Man', dial: '44' },
    { iso2: 'CX', name: 'Isla de Navidad', dial: '61' },
    { iso2: 'IS', name: 'Islandia', dial: '354' },
    { iso2: 'KY', name: 'Islas Caimán', dial: '1345' },
    { iso2: 'CK', name: 'Islas Cook', dial: '682' },
    { iso2: 'FO', name: 'Islas Feroe', dial: '298' },
    { iso2: 'MP', name: 'Islas Marianas del Norte', dial: '1670' },
    { iso2: 'MH', name: 'Islas Marshall', dial: '692' },
    { iso2: 'SB', name: 'Islas Salomón', dial: '677' },
    { iso2: 'TC', name: 'Islas Turcas y Caicos', dial: '1649' },
    { iso2: 'VG', name: 'Islas Vírgenes Británicas', dial: '1284' },
    { iso2: 'VI', name: 'Islas Vírgenes de EE. UU.', dial: '1340' },
    { iso2: 'IL', name: 'Israel', dial: '972' },
    { iso2: 'IT', name: 'Italia', dial: '39' },
    { iso2: 'JM', name: 'Jamaica', dial: '1876' },
    { iso2: 'JP', name: 'Japón', dial: '81' },
    { iso2: 'JE', name: 'Jersey', dial: '44' },
    { iso2: 'JO', name: 'Jordania', dial: '962' },
    { iso2: 'KZ', name: 'Kazajistán', dial: '7' },
    { iso2: 'KE', name: 'Kenia', dial: '254' },
    { iso2: 'KG', name: 'Kirguistán', dial: '996' },
    { iso2: 'KI', name: 'Kiribati', dial: '686' },
    { iso2: 'KW', name: 'Kuwait', dial: '965' },
    { iso2: 'LA', name: 'Laos', dial: '856' },
    { iso2: 'LS', name: 'Lesoto', dial: '266' },
    { iso2: 'LV', name: 'Letonia', dial: '371' },
    { iso2: 'LB', name: 'Líbano', dial: '961' },
    { iso2: 'LR', name: 'Liberia', dial: '231' },
    { iso2: 'LY', name: 'Libia', dial: '218' },
    { iso2: 'LI', name: 'Liechtenstein', dial: '423' },
    { iso2: 'LT', name: 'Lituania', dial: '370' },
    { iso2: 'LU', name: 'Luxemburgo', dial: '352' },
    { iso2: 'MO', name: 'Macao', dial: '853' },
    { iso2: 'MK', name: 'Macedonia del Norte', dial: '389' },
    { iso2: 'MG', name: 'Madagascar', dial: '261' },
    { iso2: 'MY', name: 'Malasia', dial: '60' },
    { iso2: 'MW', name: 'Malaui', dial: '265' },
    { iso2: 'MV', name: 'Maldivas', dial: '960' },
    { iso2: 'ML', name: 'Malí', dial: '223' },
    { iso2: 'MT', name: 'Malta', dial: '356' },
    { iso2: 'MA', name: 'Marruecos', dial: '212' },
    { iso2: 'MQ', name: 'Martinica', dial: '596' },
    { iso2: 'MU', name: 'Mauricio', dial: '230' },
    { iso2: 'MR', name: 'Mauritania', dial: '222' },
    { iso2: 'YT', name: 'Mayotte', dial: '262' },
    { iso2: 'MX', name: 'México', dial: '52' },
    { iso2: 'FM', name: 'Micronesia', dial: '691' },
    { iso2: 'MD', name: 'Moldavia', dial: '373' },
    { iso2: 'MC', name: 'Mónaco', dial: '377' },
    { iso2: 'MN', name: 'Mongolia', dial: '976' },
    { iso2: 'ME', name: 'Montenegro', dial: '382' },
    { iso2: 'MS', name: 'Montserrat', dial: '1664' },
    { iso2: 'MZ', name: 'Mozambique', dial: '258' },
    { iso2: 'MM', name: 'Birmania (Myanmar)', dial: '95' },
    { iso2: 'NA', name: 'Namibia', dial: '264' },
    { iso2: 'NR', name: 'Nauru', dial: '674' },
    { iso2: 'NP', name: 'Nepal', dial: '977' },
    { iso2: 'NI', name: 'Nicaragua', dial: '505' },
    { iso2: 'NE', name: 'Níger', dial: '227' },
    { iso2: 'NG', name: 'Nigeria', dial: '234' },
    { iso2: 'NU', name: 'Niue', dial: '683' },
    { iso2: 'NO', name: 'Noruega', dial: '47' },
    { iso2: 'NC', name: 'Nueva Caledonia', dial: '687' },
    { iso2: 'NZ', name: 'Nueva Zelanda', dial: '64' },
    { iso2: 'OM', name: 'Omán', dial: '968' },
    { iso2: 'NL', name: 'Países Bajos', dial: '31' },
    { iso2: 'PK', name: 'Pakistán', dial: '92' },
    { iso2: 'PW', name: 'Palaos', dial: '680' },
    { iso2: 'PS', name: 'Palestina', dial: '970' },
    { iso2: 'PA', name: 'Panamá', dial: '507' },
    { iso2: 'PG', name: 'Papúa Nueva Guinea', dial: '675' },
    { iso2: 'PY', name: 'Paraguay', dial: '595' },
    { iso2: 'PE', name: 'Perú', dial: '51' },
    { iso2: 'PF', name: 'Polinesia Francesa', dial: '689' },
    { iso2: 'PL', name: 'Polonia', dial: '48' },
    { iso2: 'PT', name: 'Portugal', dial: '351' },
    { iso2: 'PR', name: 'Puerto Rico', dial: '1787' },
    { iso2: 'GB', name: 'Reino Unido', dial: '44' },
    { iso2: 'CF', name: 'República Centroafricana', dial: '236' },
    { iso2: 'CZ', name: 'República Checa', dial: '420' },
    { iso2: 'DO', name: 'República Dominicana', dial: '1809' },
    { iso2: 'RE', name: 'Reunión', dial: '262' },
    { iso2: 'RW', name: 'Ruanda', dial: '250' },
    { iso2: 'RO', name: 'Rumania', dial: '40' },
    { iso2: 'RU', name: 'Rusia', dial: '7' },
    { iso2: 'WS', name: 'Samoa', dial: '685' },
    { iso2: 'AS', name: 'Samoa Americana', dial: '1684' },
    { iso2: 'BL', name: 'San Bartolomé', dial: '590' },
    { iso2: 'KN', name: 'San Cristóbal y Nieves', dial: '1869' },
    { iso2: 'SM', name: 'San Marino', dial: '378' },
    { iso2: 'MF', name: 'San Martín', dial: '590' },
    { iso2: 'PM', name: 'San Pedro y Miquelón', dial: '508' },
    { iso2: 'VC', name: 'San Vicente y las Granadinas', dial: '1784' },
    { iso2: 'LC', name: 'Santa Lucía', dial: '1758' },
    { iso2: 'ST', name: 'Santo Tomé y Príncipe', dial: '239' },
    { iso2: 'SN', name: 'Senegal', dial: '221' },
    { iso2: 'RS', name: 'Serbia', dial: '381' },
    { iso2: 'SC', name: 'Seychelles', dial: '248' },
    { iso2: 'SL', name: 'Sierra Leona', dial: '232' },
    { iso2: 'SG', name: 'Singapur', dial: '65' },
    { iso2: 'SX', name: 'Sint Maarten', dial: '1721' },
    { iso2: 'SY', name: 'Siria', dial: '963' },
    { iso2: 'SO', name: 'Somalia', dial: '252' },
    { iso2: 'LK', name: 'Sri Lanka', dial: '94' },
    { iso2: 'ZA', name: 'Sudáfrica', dial: '27' },
    { iso2: 'SD', name: 'Sudán', dial: '249' },
    { iso2: 'SS', name: 'Sudán del Sur', dial: '211' },
    { iso2: 'SE', name: 'Suecia', dial: '46' },
    { iso2: 'CH', name: 'Suiza', dial: '41' },
    { iso2: 'SR', name: 'Surinam', dial: '597' },
    { iso2: 'TH', name: 'Tailandia', dial: '66' },
    { iso2: 'TW', name: 'Taiwán', dial: '886' },
    { iso2: 'TZ', name: 'Tanzania', dial: '255' },
    { iso2: 'TJ', name: 'Tayikistán', dial: '992' },
    { iso2: 'TL', name: 'Timor Oriental', dial: '670' },
    { iso2: 'TG', name: 'Togo', dial: '228' },
    { iso2: 'TK', name: 'Tokelau', dial: '690' },
    { iso2: 'TO', name: 'Tonga', dial: '676' },
    { iso2: 'TT', name: 'Trinidad y Tobago', dial: '1868' },
    { iso2: 'TN', name: 'Túnez', dial: '216' },
    { iso2: 'TM', name: 'Turkmenistán', dial: '993' },
    { iso2: 'TR', name: 'Turquía', dial: '90' },
    { iso2: 'TV', name: 'Tuvalu', dial: '688' },
    { iso2: 'UA', name: 'Ucrania', dial: '380' },
    { iso2: 'UG', name: 'Uganda', dial: '256' },
    { iso2: 'UY', name: 'Uruguay', dial: '598' },
    { iso2: 'UZ', name: 'Uzbekistán', dial: '998' },
    { iso2: 'VU', name: 'Vanuatu', dial: '678' },
    { iso2: 'VE', name: 'Venezuela', dial: '58' },
    { iso2: 'VN', name: 'Vietnam', dial: '84' },
    { iso2: 'WF', name: 'Wallis y Futuna', dial: '681' },
    { iso2: 'YE', name: 'Yemen', dial: '967' },
    { iso2: 'DJ', name: 'Yibuti', dial: '253' },
    { iso2: 'ZM', name: 'Zambia', dial: '260' },
    { iso2: 'ZW', name: 'Zimbabue', dial: '263' },
];

/**
 * Bandera del país como emoji, DERIVADA del ISO2 (los indicadores
 * regionales son las letras desplazadas a U+1F1E6). Así no hay que guardar
 * 240 emojis ni mantenerlos sincronizados con la lista.
 */
export function flagEmoji(iso2: string): string {
    if (typeof iso2 !== 'string' || iso2.length !== 2) return '';
    const up = iso2.toUpperCase();
    const a = up.codePointAt(0);
    const b = up.codePointAt(1);
    if (a === undefined || b === undefined) return '';
    if (a < 65 || a > 90 || b < 65 || b > 90) return '';
    return String.fromCodePoint(0x1f1e6 + (a - 65), 0x1f1e6 + (b - 65));
}

/** País del catálogo por ISO2. */
export function countryByIso2(iso2: string | null | undefined): CountryDialCode | null {
    if (typeof iso2 !== 'string' || iso2.length !== 2) return null;
    const up = iso2.toUpperCase();
    return COUNTRY_DIAL_CODES.find((c) => c.iso2 === up) ?? null;
}

/** Indicativo (sin `+`) de un país del catálogo, o `null`. */
export function dialCodeFor(iso2: string | null | undefined): string | null {
    return countryByIso2(iso2)?.dial ?? null;
}

/**
 * Búsqueda del selector: por nombre, por ISO2 o por indicativo (con o sin
 * `+`), ignorando acentos — quien escribe "peru" tiene que encontrar Perú.
 */
export function searchCountries(query: string): readonly CountryDialCode[] {
    const q = foldAccents(String(query ?? '').trim().toLowerCase());
    if (q === '') return COUNTRY_DIAL_CODES;
    const digits = q.replace(/[^\d]/g, '');
    return COUNTRY_DIAL_CODES.filter(
        (c) =>
            foldAccents(c.name.toLowerCase()).includes(q)
            || c.iso2.toLowerCase() === q
            || (digits !== '' && c.dial.startsWith(digits)),
    );
}

function foldAccents(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Total de dígitos permitido (E.164 llega hasta 15; damos margen). */
const MIN_DIGITS = 6;
const MAX_DIGITS = 17;

/** Dueño canónico de los indicativos que comparten varios países. */
const PRIMARY_FOR_DIAL: Record<string, string> = {
    '1': 'US',
    '7': 'RU',
    '44': 'GB',
    '61': 'AU',
    '262': 'RE',
    '590': 'GP',
    '599': 'CW',
};

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
        if (!digits.startsWith(c.dial)) continue;
        if (best === null || c.dial.length > best.dial.length) {
            best = c;
        } else if (c.dial.length === best.dial.length && PRIMARY_FOR_DIAL[c.dial] === c.iso2) {
            // Empate: varios países comparten el MISMO indicativo (+1 lo usan
            // EE.UU. y Canadá; +44 el Reino Unido, Jersey y Man). El número no
            // alcanza para desambiguar, así que se elige un dueño canónico en
            // vez de que decida el orden alfabético de la lista.
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

/**
 * Sólo la parte nacional, agrupada — lo que se muestra al lado de la
 * bandera cuando el país ya está indicado por ella (estilo ClickUp).
 */
export function formatPhoneNational(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') return '';
    const grouped = groupDigits(splitPhone(value).national);
    return grouped === '' ? String(value) : grouped;
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
