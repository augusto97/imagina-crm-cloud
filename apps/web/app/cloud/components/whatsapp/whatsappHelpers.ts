import type { WhatsappTemplate } from '@imagina-base/shared';

/**
 * D3 — Piezas puras del editor de WhatsApp (sin React): se prueban aparte.
 */

/** `values.variables` puede venir como objeto o como JSON en texto (asistente). */
export function readVariables(raw: unknown): Record<string, string> {
    let obj: unknown = raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
        try {
            obj = JSON.parse(raw);
        } catch {
            return {};
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
    }
    return out;
}

/** La plantilla elegida (prefiere el idioma guardado). */
export function selectedTemplate(templates: WhatsappTemplate[], name: string, language: string): WhatsappTemplate | null {
    const hits = templates.filter((t) => t.name === name);
    if (hits.length === 0) return null;
    return hits.find((t) => t.language === language) ?? hits[0] ?? null;
}


/**
 * «Hola {{nombre}}» → «Hola [Nombre]»: en la vista previa del editor una
 * variable del registro se lee por su campo (si no, parece una variable de la
 * plantilla sin completar).
 */
export function labelMergeTags(text: string, fields: ReadonlyArray<{ slug: string; label: string }>): string {
    return text.replace(/\{\{\s*([^}|\s]+)\s*(?:\|[^}]*)?\}\}/g, (_m, tag: string) => {
        const field = fields.find((f) => f.slug === tag);
        return `[${field ? field.label : tag}]`;
    });
}
