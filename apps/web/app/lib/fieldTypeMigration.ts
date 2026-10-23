import { __ } from '@/lib/i18n';

/**
 * Mirror frontend del matrix de transiciones permitidas. Mantenlo
 * SINCRONIZADO con `src/Fields/FieldTypeMigration.php::MATRIX` —
 * cualquier transición que esté aquí pero no en el backend va a ser
 * rechazada con error de validación.
 *
 * El backend es la fuente de verdad: el frontend solo lo usa para
 * filtrar el dropdown del editor y mostrar el badge de riesgo.
 */

export type TypeRisk = 'safe' | 'lossy' | 'destructive';

const MATRIX: Record<string, Record<string, TypeRisk>> = {
    text: {
        long_text: 'safe',
        email: 'lossy',
        url: 'lossy',
        phone: 'lossy',
    },
    long_text: {
        text: 'lossy',
    },
    number: {
        currency: 'safe',
        percent: 'lossy',
        rating: 'lossy',
        duration: 'safe',
    },
    currency: {
        number: 'safe',
    },
    phone: {
        text: 'safe',
    },
    percent: {
        number: 'safe',
    },
    rating: {
        number: 'safe',
    },
    duration: {
        number: 'safe',
        text: 'safe',
    },
    date: {
        datetime: 'safe',
    },
    datetime: {
        date: 'lossy',
    },
    select: {
        multi_select: 'safe',
        text: 'safe',
    },
    multi_select: {
        select: 'destructive',
    },
    email: {
        text: 'safe',
        url: 'lossy',
    },
    url: {
        text: 'safe',
        email: 'lossy',
    },
    // v0.1.300 — un ID automático se puede volver texto (conserva los códigos y
    // deja de asignarse solo). Hacia el ID automático no se convierte: se crea.
    autonumber: {
        text: 'safe',
    },
    // Fórmulas (A1): un calculado pasa a fórmula (se arma la equivalente,
    // nada que migrar); una fórmula pasa a un campo común con el valor que
    // calculaba (deja de calcularse sola).
    computed: {
        formula: 'safe',
    },
    formula: {
        text: 'lossy',
        long_text: 'lossy',
        number: 'lossy',
        currency: 'lossy',
        percent: 'lossy',
        duration: 'lossy',
        rating: 'lossy',
        date: 'lossy',
        datetime: 'lossy',
        checkbox: 'lossy',
        email: 'lossy',
        url: 'lossy',
        phone: 'lossy',
    },
};

export function isTransitionAllowed(from: string, to: string): boolean {
    if (from === to) return true;
    return MATRIX[from]?.[to] !== undefined;
}

export function riskOf(from: string, to: string): TypeRisk | null {
    if (from === to) return 'safe';
    return MATRIX[from]?.[to] ?? null;
}

export function allowedTargetsFor(from: string): Array<{ type: string; risk: TypeRisk }> {
    const targets = MATRIX[from] ?? {};
    return Object.entries(targets).map(([type, risk]) => ({ type, risk }));
}

/**
 * Fórmulas (A1) — qué pasa al convertir hacia o desde una fórmula (se muestra
 * en el editor del campo al elegir el tipo nuevo).
 */
export function formulaConversionNote(from: string, to: string): string | null {
    if (from === 'computed' && to === 'formula') {
        return __('Se armó la fórmula equivalente: revísala antes de guardar. En una fórmula un campo vacío cuenta como 0 en una cuenta y dividir por cero da error.');
    }
    if (from === 'formula' && to !== 'formula') {
        return __('La columna se queda con el valor que calcula la fórmula hoy en cada registro y deja de calcularse sola. Después se edita a mano.');
    }
    return null;
}
