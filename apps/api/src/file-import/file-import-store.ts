import type { FileImportPlan, FileImportSheetProfile } from '@imagina-base/shared';

/**
 * v0.1.339 (ADR-S88) — Lo que queda en Redis entre analizar y crear (2 h): el
 * perfil de cada hoja, el borrador y una huella del texto de cada hoja. El
 * archivo NO se guarda: al crear, el navegador lo vuelve a mandar y la huella
 * confirma que es el mismo que se revisó.
 */
export interface StoredAnalysis {
    id: string;
    file_name: string;
    source: 'csv' | 'xlsx';
    /** sha256 del texto de cada hoja. */
    hashes: string[];
    sheets: FileImportSheetProfile[];
    /** El borrador de las reglas (la IA guarda el suyo aparte). */
    plan: FileImportPlan;
    defaults: { currency: string; country: string };
    applied: { at: number; lists: number[] } | null;
}

export function analysisKey(tenantId: number, userId: number, id: string): string {
    return `fileimport:a:${tenantId}:${userId}:${id}`;
}

/** Moneda y país por defecto según la zona horaria de la empresa (sin zona: Colombia). */
const BY_ZONE: Record<string, { currency: string; country: string }> = {
    'America/Bogota': { currency: 'COP', country: 'CO' },
    'America/Mexico_City': { currency: 'MXN', country: 'MX' },
    'America/Monterrey': { currency: 'MXN', country: 'MX' },
    'America/Tijuana': { currency: 'MXN', country: 'MX' },
    'America/Cancun': { currency: 'MXN', country: 'MX' },
    'America/Lima': { currency: 'PEN', country: 'PE' },
    'America/Santiago': { currency: 'CLP', country: 'CL' },
    'America/Argentina/Buenos_Aires': { currency: 'ARS', country: 'AR' },
    'America/Buenos_Aires': { currency: 'ARS', country: 'AR' },
    'America/Guayaquil': { currency: 'USD', country: 'EC' },
    'America/Panama': { currency: 'USD', country: 'PA' },
    'America/Caracas': { currency: 'USD', country: 'VE' },
    'America/Montevideo': { currency: 'UYU', country: 'UY' },
    'America/Asuncion': { currency: 'PYG', country: 'PY' },
    'America/La_Paz': { currency: 'BOB', country: 'BO' },
    'America/Costa_Rica': { currency: 'CRC', country: 'CR' },
    'America/Guatemala': { currency: 'GTQ', country: 'GT' },
    'America/El_Salvador': { currency: 'USD', country: 'SV' },
    'America/Tegucigalpa': { currency: 'HNL', country: 'HN' },
    'America/Managua': { currency: 'NIO', country: 'NI' },
    'America/Santo_Domingo': { currency: 'DOP', country: 'DO' },
    'America/Puerto_Rico': { currency: 'USD', country: 'PR' },
    'Europe/Madrid': { currency: 'EUR', country: 'ES' },
    'America/New_York': { currency: 'USD', country: 'US' },
    'America/Chicago': { currency: 'USD', country: 'US' },
    'America/Denver': { currency: 'USD', country: 'US' },
    'America/Los_Angeles': { currency: 'USD', country: 'US' },
    'America/Sao_Paulo': { currency: 'BRL', country: 'BR' },
};

export function defaultsForTimeZone(timeZone: string | null): { currency: string; country: string } {
    return (timeZone && BY_ZONE[timeZone]) || { currency: 'COP', country: 'CO' };
}
