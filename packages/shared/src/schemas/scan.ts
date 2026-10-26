import { z } from 'zod';
import { idSchema } from './common';
import type { FieldType } from './field';

/**
 * H3 — Escáner de códigos (QR y de barras).
 *
 * Un código leído con la cámara se BUSCA en los registros: en toda la empresa
 * (botón «Escanear» de la búsqueda global) o en una lista (su barra), por el
 * campo que la lista eligió como «Código» (`settings.scan_field_id`). La
 * coincidencia es EXACTA —un código identifica, no se busca como texto
 * libre— pero sin distinguir mayúsculas ni espacios de los bordes, y un
 * código numérico también encuentra el mismo número guardado en un campo
 * numérico (`0123` = 123).
 */

/** Dónde se busca un código: texto, número e ID automático. */
export const SCAN_SEARCH_FIELD_TYPES: readonly FieldType[] = ['text', 'number', 'autonumber'];
/** Qué campos se pueden LLENAR con lo escaneado (el ID automático lo pone la app). */
export const SCAN_FILL_FIELD_TYPES: readonly FieldType[] = ['text', 'number'];

export const codeSearchQuerySchema = z.object({
    code: z.string().min(1).max(512),
    /** Id o slug de la lista (búsqueda de la barra de una lista). */
    list: z.string().trim().min(1).max(120).optional(),
    /** Un campo puntual de esa lista (si no, el «Código» de la lista o todos los de texto/número). */
    field: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CodeSearchQuery = z.infer<typeof codeSearchQuerySchema>;

export const codeSearchHitSchema = z.object({
    record_id: idSchema,
    parent_id: idSchema.nullable(),
    title: z.string(),
    list_id: idSchema,
    list_slug: z.string(),
    list_name: z.string(),
    list_icon: z.string().nullable(),
    list_color: z.string().nullable(),
    /** El campo donde coincidió el código. */
    field_id: idSchema,
    field_label: z.string(),
});
export type CodeSearchHit = z.infer<typeof codeSearchHitSchema>;

export interface CodeSearchResult {
    /** El código tal como se buscó (normalizado). */
    code: string;
    hits: CodeSearchHit[];
    /** Hubo más coincidencias que el tope. */
    truncated: boolean;
    /** En la búsqueda de una lista: el campo «Código» con el que se buscó (o null = todos). */
    field_id: number | null;
}

/**
 * El código como se busca: sin espacios ni caracteres de control en los
 * bordes. Los lectores GS1 meten un separador de grupo (0x1D) que no se ve y
 * haría fallar la comparación; dentro del código se conserva lo demás.
 */
export function normalizeScanCode(raw: string): string {
    // eslint-disable-next-line no-control-regex
    return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/** El código como número (para compararlo con un campo numérico), o null. */
export function scanCodeAsNumber(code: string): number | null {
    if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(code)) return null;
    const n = Number(code);
    return Number.isFinite(n) ? n : null;
}

/** El campo «Código» elegido en los ajustes de la lista (o null). */
export function readScanFieldId(settings: Record<string, unknown> | null | undefined): number | null {
    const raw = Number((settings ?? {}).scan_field_id);
    return Number.isInteger(raw) && raw > 0 ? raw : null;
}

const CODE_HINT = /(c[oó]dig|sku|barcode|barra|\bean\b|\bupc\b|\bqr\b|serial|serie|referencia|\bref\b|placa|ticket|entrada|boleta|activo|inventario)/i;

/**
 * El campo «Código» de una lista: el elegido en sus ajustes (si sigue siendo
 * de un tipo válido) o, si no eligió ninguno, el que lo dice en el nombre
 * («SKU», «Código de barras», «Serial»…). null = buscar en todos.
 */
export function pickScanField<F extends { id: number; slug: string; label: string; type: string }>(
    fields: readonly F[],
    settings: Record<string, unknown> | null | undefined,
): F | null {
    const candidates = fields.filter((f) => (SCAN_SEARCH_FIELD_TYPES as readonly string[]).includes(f.type));
    const chosen = readScanFieldId(settings);
    if (chosen !== null) {
        const hit = candidates.find((f) => f.id === chosen);
        if (hit) return hit;
    }
    return candidates.find((f) => CODE_HINT.test(f.slug) || CODE_HINT.test(f.label)) ?? null;
}
