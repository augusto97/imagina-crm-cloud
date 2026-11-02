import { z } from 'zod';
import { bulkEditTargetSchema } from './bulk-edit';
import { idSchema } from './common';

/**
 * v0.1.344 — El QR de cada registro y las etiquetas para imprimirlo.
 *
 * El escáner (H3, v0.1.314) LEE códigos; esto los CREA. Un registro tiene su
 * código QR con el ENLACE a su ficha (lo abre el escáner de la app, y desde la
 * cámara del teléfono abre la ficha a quien tiene cuenta) o con el valor de su
 * campo «Código» (SKU, serial, boleta: lo busca el escáner igual que un código
 * de barras de fábrica). Se imprime en hojas de etiquetas adhesivas de las
 * medidas comunes (Carta y A4, las de Avery y sus equivalentes) o en rollos de
 * impresora térmica, y viaja en correos, WhatsApp y PDF con las variables
 * `{{registro.enlace}}`, `{{registro.qr}}` y el modificador `|qr`.
 *
 * Las medidas van en PUNTOS (1 pulgada = 72 pt, 1 mm ≈ 2,8346 pt): las usa el
 * PDF del servidor y la miniatura de la hoja del navegador, así lo que se ve al
 * elegir es lo que sale.
 */

const MM = 72 / 25.4;
const mm = (n: number): number => Math.round(n * MM * 100) / 100;

export interface LabelPreset {
    /** Nombre para elegirla. */
    name: string;
    /** Referencia del fabricante (para encontrarla en la papelería). */
    hint: string;
    /** Hoja (`sheet`) o una etiqueta por página (`roll`, impresora térmica). */
    kind: 'sheet' | 'roll';
    pageW: number;
    pageH: number;
    cols: number;
    rows: number;
    labelW: number;
    labelH: number;
    marginTop: number;
    marginLeft: number;
    gapX: number;
    gapY: number;
}

export const LABEL_PRESETS = {
    letter_30: {
        name: 'Carta · 30 por hoja (3 × 10)',
        hint: '6,7 × 2,5 cm — como Avery 5160',
        kind: 'sheet',
        pageW: 612,
        pageH: 792,
        cols: 3,
        rows: 10,
        labelW: 189,
        labelH: 72,
        marginTop: 36,
        marginLeft: 13.5,
        gapX: 9,
        gapY: 0,
    },
    letter_10: {
        name: 'Carta · 10 por hoja (2 × 5)',
        hint: '10,2 × 5,1 cm — como Avery 5163',
        kind: 'sheet',
        pageW: 612,
        pageH: 792,
        cols: 2,
        rows: 5,
        labelW: 288,
        labelH: 144,
        marginTop: 36,
        marginLeft: 11.25,
        gapX: 13.5,
        gapY: 0,
    },
    letter_4: {
        name: 'Carta · 4 por hoja (2 × 2)',
        hint: '10,8 × 14 cm — escarapelas y entradas',
        kind: 'sheet',
        pageW: 612,
        pageH: 792,
        cols: 2,
        rows: 2,
        labelW: 306,
        labelH: 396,
        marginTop: 0,
        marginLeft: 0,
        gapX: 0,
        gapY: 0,
    },
    a4_21: {
        name: 'A4 · 21 por hoja (3 × 7)',
        hint: '6,35 × 3,81 cm — como Avery L7160',
        kind: 'sheet',
        pageW: 595.28,
        pageH: 841.89,
        cols: 3,
        rows: 7,
        labelW: mm(63.5),
        labelH: mm(38.1),
        marginTop: mm(15.15),
        marginLeft: mm(7.2),
        gapX: mm(2.5),
        gapY: 0,
    },
    a4_8: {
        name: 'A4 · 8 por hoja (2 × 4)',
        hint: '9,9 × 6,8 cm — como Avery L7165',
        kind: 'sheet',
        pageW: 595.28,
        pageH: 841.89,
        cols: 2,
        rows: 4,
        labelW: mm(99.1),
        labelH: mm(67.7),
        marginTop: mm(13.1),
        marginLeft: mm(4.65),
        gapX: mm(2.5),
        gapY: 0,
    },
    roll_50x30: {
        name: 'Rollo · 5 × 3 cm',
        hint: 'Impresora de etiquetas (térmica)',
        kind: 'roll',
        pageW: mm(50),
        pageH: mm(30),
        cols: 1,
        rows: 1,
        labelW: mm(50),
        labelH: mm(30),
        marginTop: 0,
        marginLeft: 0,
        gapX: 0,
        gapY: 0,
    },
    roll_100x50: {
        name: 'Rollo · 10 × 5 cm',
        hint: 'Impresora de etiquetas (térmica)',
        kind: 'roll',
        pageW: mm(100),
        pageH: mm(50),
        cols: 1,
        rows: 1,
        labelW: mm(100),
        labelH: mm(50),
        marginTop: 0,
        marginLeft: 0,
        gapX: 0,
        gapY: 0,
    },
} as const satisfies Record<string, LabelPreset>;

export type LabelPresetKey = keyof typeof LABEL_PRESETS;
export const LABEL_PRESET_KEYS = Object.keys(LABEL_PRESETS) as [LabelPresetKey, ...LabelPresetKey[]];

/** Etiquetas por PDF (más que esto, se acota con filtros y se imprime en partes). */
export const LABEL_MAX = 1000;

/**
 * Qué guarda el QR: el enlace a la ficha (`link`, funciona en cualquier lista)
 * o el valor del campo «Código» (`field`, para quien ya identifica sus cosas
 * con un SKU o un serial y quiere que el código impreso sea ese).
 */
export const LABEL_CONTENTS = ['link', 'field'] as const;
export type LabelContent = (typeof LABEL_CONTENTS)[number];

export const recordLabelsSchema = z
    .object({
        target: bulkEditTargetSchema,
        preset: z.enum(LABEL_PRESET_KEYS).default('letter_30'),
        content: z.enum(LABEL_CONTENTS).default('link'),
        /** Con `field`: qué campo (si no, el «Código» de la lista). */
        code_field_id: idSchema.nullable().default(null),
        /** Hasta dos datos más debajo del título (precio, ubicación…). */
        field_ids: z.array(idSchema).max(2).default([]),
        show_title: z.boolean().default(true),
        /** El código escrito debajo (lo lee una persona si el QR se daña). */
        show_code: z.boolean().default(true),
        /** Etiquetas a saltear al principio (para aprovechar una hoja ya empezada). */
        skip: z.number().int().min(0).max(99).default(0),
    })
    .strict();
export type RecordLabelsInput = z.infer<typeof recordLabelsSchema>;

/** Lo que devuelve `GET /lists/:list/qr/:recordId`: el QR de un registro. */
export interface RecordQrInfo {
    record_id: number;
    title: string;
    /** El enlace a la ficha (lo que guarda el QR por defecto). */
    link: string;
    /** Imagen PNG del QR del enlace (URL firmada, sin sesión). */
    link_qr_url: string;
    /** El campo «Código» de la lista y su valor para ESTE registro (si tiene). */
    code: { field_id: number; field_label: string; value: string; qr_url: string } | null;
}

/** Ruta de la ficha de un registro (la misma que abre el router de la app). */
export function recordLinkPath(listSlug: string, recordId: number): string {
    return `/lists/${encodeURIComponent(listSlug)}/records/${recordId}`;
}

/**
 * Un enlace a la ficha de un registro de ESTA app, venga del dominio que
 * venga (la plataforma, el dominio propio de la empresa o la dirección con la
 * que se entró): lo que importa es la ruta. Acepta la ruta directa
 * (`/lists/x/records/5`), la de la tabla (`/lists/x/records?record=5`) y las
 * viejas con `#`.
 */
export function parseRecordLink(code: string): { listSlug: string; recordId: number } | null {
    // Sin `URL` (shared no depende del DOM ni de Node): esquema, host, ruta y `#`.
    const u = /^https?:\/\/[^/?#\s]+([^#\s]*)(#\S*)?$/i.exec(code.trim());
    if (!u) return null;
    const hash = u[2] ?? '';
    const route = hash.startsWith('#/') ? hash.slice(1) : u[1] || '/';
    const direct = /^\/lists\/([a-z0-9_-]+)\/records\/(\d+)(?:[/?#]|$)/i.exec(route);
    const query = direct ? null : /^\/lists\/([a-z0-9_-]+)\/records\?(?:.*&)?record=(\d+)/i.exec(route);
    const m = direct ?? query;
    if (!m) return null;
    const recordId = Number(m[2]);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) return null;
    return { listSlug: decodeURIComponent(m[1]!).toLowerCase(), recordId };
}

export interface LabelSlot {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Dónde va cada etiqueta de una página (de izquierda a derecha y de arriba abajo). */
export function labelSlots(key: LabelPresetKey): LabelSlot[] {
    const p: LabelPreset = LABEL_PRESETS[key];
    const out: LabelSlot[] = [];
    for (let r = 0; r < p.rows; r++) {
        for (let c = 0; c < p.cols; c++) {
            out.push({
                x: p.marginLeft + c * (p.labelW + p.gapX),
                y: p.marginTop + r * (p.labelH + p.gapY),
                w: p.labelW,
                h: p.labelH,
            });
        }
    }
    return out;
}

export interface LabelInnerLayout {
    /** Margen interno de la etiqueta. */
    pad: number;
    /** Lado del QR. */
    qr: number;
    /** El QR a la izquierda (etiqueta apaisada) o arriba (etiqueta alta). */
    direction: 'row' | 'column';
    /** Dónde va el texto (relativo a la etiqueta). */
    text: { x: number; y: number; w: number; h: number };
    /** Tamaños de letra del título, de los datos y del código. */
    titleSize: number;
    lineSize: number;
    codeSize: number;
}

/**
 * El acomodo dentro de una etiqueta: en una apaisada el QR ocupa el alto a la
 * izquierda y el texto el resto; en una alta (escarapela, entrada) el QR va
 * arriba, centrado, y el texto debajo. La letra escala con la etiqueta.
 */
export function labelInnerLayout(w: number, h: number): LabelInnerLayout {
    const pad = Math.max(4, Math.round(Math.min(w, h) * 0.07 * 10) / 10);
    if (w >= h * 1.25) {
        const qr = Math.max(24, h - pad * 2);
        const tx = pad + qr + pad;
        const titleSize = clamp(h * 0.13, 7, 16);
        return {
            pad,
            qr,
            direction: 'row',
            text: { x: tx, y: pad, w: Math.max(10, w - tx - pad), h: h - pad * 2 },
            titleSize,
            lineSize: clamp(titleSize * 0.82, 6, 13),
            codeSize: clamp(titleSize * 0.72, 5.5, 11),
        };
    }
    const qr = Math.max(24, Math.min(w - pad * 2, h * 0.58));
    const ty = pad + qr + pad * 0.8;
    const titleSize = clamp(w * 0.07, 8, 22);
    return {
        pad,
        qr,
        direction: 'column',
        text: { x: pad, y: ty, w: w - pad * 2, h: Math.max(10, h - ty - pad) },
        titleSize,
        lineSize: clamp(titleSize * 0.75, 7, 16),
        codeSize: clamp(titleSize * 0.62, 6, 13),
    };
}

/**
 * Un texto recortado para que entre en `lines` renglones de `width` puntos a
 * ese tamaño de letra (estimado: un carácter medio ocupa ~0,52 del tamaño).
 * Mejor un «…» que un texto que se sale de la etiqueta adhesiva.
 */
export function fitLabelText(text: string, width: number, size: number, lines = 1): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    const perLine = Math.max(4, Math.floor(width / (size * 0.52)));
    const max = perLine * Math.max(1, lines);
    if (clean.length <= max) return clean;
    return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function clamp(n: number, min: number, max: number): number {
    return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
}
