/**
 * Payload del drag-from-palette al canvas. Discriminated por `kind`:
 * la paleta puede arrastrar tanto "tipos de bloque" como "fields
 * concretos" (cuando el registry expone el tab Campos).
 *
 * MIME custom para evitar que el grid acepte drops externos al
 * editor (ej. archivos del SO).
 */

export const PALETTE_MIME = 'application/x-imcrm-palette';

export type PalettePayload =
    | { kind: 'block-type'; type: string }
    | { kind: 'field'; slug: string };

export function encodePayload(p: PalettePayload): string {
    return JSON.stringify(p);
}

export function decodePayload(raw: string): PalettePayload | null {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (! parsed || typeof parsed !== 'object') return null;
        const obj = parsed as Record<string, unknown>;
        if (obj.kind === 'block-type' && typeof obj.type === 'string') {
            return { kind: 'block-type', type: obj.type };
        }
        if (obj.kind === 'field' && typeof obj.slug === 'string') {
            return { kind: 'field', slug: obj.slug };
        }
        return null;
    } catch {
        return null;
    }
}

export function setDragPayload(e: React.DragEvent, payload: PalettePayload): void {
    const raw = encodePayload(payload);
    e.dataTransfer.setData(PALETTE_MIME, raw);
    e.dataTransfer.setData('text/plain', raw);
    e.dataTransfer.effectAllowed = 'copy';
}

export function readDropPayload(e: DragEvent | React.DragEvent): PalettePayload | null {
    const raw =
        e.dataTransfer?.getData(PALETTE_MIME)
        || e.dataTransfer?.getData('text/plain')
        || '';
    if (! raw) return null;
    return decodePayload(raw);
}
