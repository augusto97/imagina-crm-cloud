/**
 * Mirror frontend del matrix de transiciones permitidas. Mantenelo
 * SINCRONIZADO con `src/Fields/FieldTypeMigration.php::MATRIX` —
 * cualquier transición que esté acá pero no en el backend va a ser
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
    },
    long_text: {
        text: 'lossy',
    },
    number: {
        currency: 'safe',
    },
    currency: {
        number: 'safe',
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
