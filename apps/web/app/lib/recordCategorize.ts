import type { FieldEntity } from '@/types/field';

/**
 * Heurística de categorización de fields para el layout CRM.
 *
 * Cuando una lista tiene `settings.record_layout === 'crm'`, el
 * `<RecordCrmLayout>` agrupa las propiedades en bloques temáticos
 * (Contacto / Estado / Datos clave / Asignación / Otros) en vez de
 * mostrar el form lineal.
 *
 * Conservadora: si no clasifica claro, va a "Otros". Mejor falso
 * negativo (bajamos un campo a Otros) que falso positivo (clasificamos
 * un campo como teléfono cuando es otra cosa y confundimos al user).
 */

export type FieldCategory = 'contact' | 'status' | 'key_data' | 'assignment' | 'other';

export interface CategorizedField {
    field: FieldEntity;
    category: FieldCategory;
    /**
     * Sub-tipo opcional para refinar el render (ej. dentro de
     * "contact": email | phone | url | text). Permite al header
     * detectar quick actions sin re-aplicar la heurística.
     */
    contactKind?: 'email' | 'phone' | 'url' | 'text';
}

/**
 * Slugs/labels que delatan un campo de teléfono. Usamos también el
 * label porque el slug no siempre lo refleja (user pudo haber puesto
 * label "Celular" pero slug "tel_principal").
 */
const PHONE_PATTERNS = [
    /\b(phone|tel|telefono|teléfono|celular|movil|móvil|whatsapp|wsp|sms|fax)\b/i,
];

function isPhoneLikeField(field: FieldEntity): boolean {
    if (field.type !== 'text') return false;
    const haystack = field.slug + ' ' + field.label;
    return PHONE_PATTERNS.some((re) => re.test(haystack));
}

/**
 * `select` y `multi_select` con pocas opciones se tratan como
 * "estado" (renderean como pill/badge en el header). Si tienen
 * muchas opciones (ej. una lista de países con 200 valores) los
 * dejamos en Otros — un badge con 200 opciones posibles no funciona
 * como indicador.
 */
function isStatusLike(field: FieldEntity): boolean {
    if (field.type === 'checkbox') return true;
    if (field.type !== 'select' && field.type !== 'multi_select') return false;
    const opts = (field.config as { options?: unknown[] }).options;
    if (! Array.isArray(opts)) return false;
    return opts.length > 0 && opts.length <= 8;
}

export function categorizeField(field: FieldEntity): CategorizedField {
    if (field.type === 'email') {
        return { field, category: 'contact', contactKind: 'email' };
    }
    if (field.type === 'url') {
        return { field, category: 'contact', contactKind: 'url' };
    }
    if (isPhoneLikeField(field)) {
        return { field, category: 'contact', contactKind: 'phone' };
    }
    if (field.type === 'user') {
        return { field, category: 'assignment' };
    }
    if (field.type === 'currency' || field.type === 'number') {
        return { field, category: 'key_data' };
    }
    if (field.type === 'date' || field.type === 'datetime') {
        return { field, category: 'key_data' };
    }
    if (isStatusLike(field)) {
        return { field, category: 'status' };
    }
    return { field, category: 'other' };
}

export interface FieldGroups {
    contact: CategorizedField[];
    status: CategorizedField[];
    key_data: CategorizedField[];
    assignment: CategorizedField[];
    other: CategorizedField[];
}

/**
 * Aplica `categorizeField` a la lista entera y devuelve los grupos
 * preservando orden por `position`. El campo `is_primary` siempre
 * va al primer grupo donde caiga (no se duplica).
 */
export function groupFields(fields: FieldEntity[]): FieldGroups {
    const sorted = [...fields].sort((a, b) => a.position - b.position);
    const groups: FieldGroups = {
        contact: [],
        status: [],
        key_data: [],
        assignment: [],
        other: [],
    };
    for (const f of sorted) {
        // Skip relations — el sidebar derecho los maneja por separado.
        if (f.type === 'relation') continue;
        const categorized = categorizeField(f);
        groups[categorized.category].push(categorized);
    }
    return groups;
}

/**
 * Resuelve el "primary field" del record para el header (avatar +
 * título). Preferencia: is_primary > primer text > primer field.
 */
export function pickPrimaryField(fields: FieldEntity[]): FieldEntity | null {
    if (fields.length === 0) return null;
    const primary = fields.find((f) => f.is_primary);
    if (primary) return primary;
    const text = fields.find((f) => f.type === 'text');
    if (text) return text;
    return fields[0] ?? null;
}

/**
 * Genera un color hex determinístico desde un string. Usado para el
 * avatar del record header — mismo título → mismo color, lookup
 * estable visualmente.
 */
export function colorFromString(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    // Paleta curada: primarios + acentos cálidos, evita amarillos
    // pálidos (bajo contraste con texto blanco).
    const palette = [
        '#6366f1', // indigo
        '#0ea5e9', // sky
        '#10b981', // emerald
        '#f59e0b', // amber
        '#ef4444', // red
        '#a855f7', // purple
        '#14b8a6', // teal
        '#ec4899', // pink
        '#8b5cf6', // violet
        '#22c55e', // green
    ];
    return palette[Math.abs(hash) % palette.length]!;
}

/**
 * Iniciales de un valor (max 2 chars). "Carlos Pérez" → "CP";
 * "carlos" → "CA"; "" → "?".
 */
export function initialsFromValue(value: string): string {
    const trimmed = value.trim();
    if (trimmed === '') return '?';
    const parts = trimmed.split(/\s+/).slice(0, 2);
    if (parts.length === 1) {
        return (parts[0] ?? '').slice(0, 2).toUpperCase();
    }
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}
