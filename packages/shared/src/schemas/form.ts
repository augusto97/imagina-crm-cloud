import { z } from 'zod';
import {
    attributionInputSchema,
    attributionSettingsSchema,
    ATTRIBUTION_SETTINGS_DEFAULT,
    conversionSettingsSchema,
    CONVERSION_SETTINGS_DEFAULT,
    redirectDelaySchema,
    redirectUrlSchema,
    type ConversionResult,
    type PublicConversion,
} from './conversion';
import type { PublicDataConsent } from './data-consent';
import type { FieldType } from './field';
import { publicThemeSchema, readPublicTheme, type PublicChoiceStyle } from './public-theme';
import type { PublicThemeView } from './public-theme-css';
import { FORM_CALC_VALUE_PREFIX, FORM_PAYMENT_MAX_AMOUNT, FORM_SCALE_MAX_BUTTONS, formConditionCalcKeys, formRecallSlugs, type FormCalcLike } from './form-logic';

/**
 * v0.1.275 — Formularios públicos (ADR-S39).
 *
 * Un formulario es una puerta de ENTRADA a una lista: quien lo completa
 * (sin cuenta) crea un registro. Vive en su propia tabla (`forms`, RLS) y
 * se publica por un token opaco, igual que la lista pública de ADR-S14 —
 * pero al revés: aquélla deja LEER, éste deja ESCRIBIR, y sólo los campos
 * que el formulario pregunta.
 *
 * El diseño se guarda como `config` = ítems ordenados + ajustes. Cada ítem
 * de campo apunta al campo por ID (regla de oro nº 1): renombrar el campo
 * o cambiarle el slug no rompe el formulario.
 */

/** Tipos de campo que un formulario puede preguntar. */
export const FORM_FIELD_TYPES = [
    'text',
    'long_text',
    'number',
    'currency',
    'select',
    'multi_select',
    'date',
    'datetime',
    'checkbox',
    'email',
    'url',
    'phone',
    'rating',
    'percent',
    'duration',
    'file',
    // C1 — «¿A qué área va tu consulta?»: se elige entre los equipos.
    'team',
] as const satisfies readonly FieldType[];
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

const FORM_TYPE_SET = new Set<string>(FORM_FIELD_TYPES);
/**
 * ¿Este tipo de campo se puede preguntar en un formulario? Quedan afuera los
 * que no escribe una persona (calculados, lookup, rollup), las personas del
 * equipo (`user`: el visitante no conoce a nadie) y las relaciones (exponer
 * los registros de otra lista a cualquiera con el enlace sería una fuga).
 */
export function isFormFieldType(type: string): type is FormFieldType {
    return FORM_TYPE_SET.has(type);
}

export const FORM_CONDITION_OPS = [
    'eq',
    'neq',
    'in',
    'contains',
    'gt',
    'lt',
    'is_empty',
    'is_not_empty',
] as const;
export type FormConditionOp = (typeof FORM_CONDITION_OPS)[number];

/**
 * «Mostrar sólo si…»: depende de la respuesta a OTRO campo del formulario.
 * Una sola condición por ítem a propósito — la lógica que se arma con un
 * clic es la que la gente entiende; un árbol AND/OR aquí sería un editor de
 * filtros para personas que sólo quieren «si eligió Empresa, pedir el NIT».
 */
export const formFieldConditionSchema = z.object({
    field_id: z.number().int().positive(),
    op: z.enum(FORM_CONDITION_OPS),
    value: z.unknown().optional(),
});
export type FormFieldCondition = z.infer<typeof formFieldConditionSchema>;

/**
 * v0.1.357 — El nombre de un cálculo del formulario: lo que se escribe entre
 * llaves (`{{puntaje}}`) y lo que mira una regla. Mismo formato que el nombre
 * interno de un campo.
 */
export const FORM_CALC_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;
/** v0.1.357 — Las comparaciones de una regla sobre un cálculo (un número). */
export const FORM_CALC_OPS = ['eq', 'neq', 'gt', 'lt'] as const;

/**
 * v0.1.357 — Una regla sobre un cálculo («si el puntaje es mayor que 7»). Se
 * usa en saltos y pantallas finales; en «Mostrar sólo si…» no (el servidor la
 * quita), porque una pregunta no puede depender de un total que todavía se
 * está armando.
 */
export const formCalcConditionSchema = z.object({
    calc: z.string().regex(FORM_CALC_KEY_RE),
    op: z.enum(FORM_CALC_OPS),
    value: z.unknown().optional(),
});
export type FormCalcCondition = z.infer<typeof formCalcConditionSchema>;

/** Una regla: sobre una pregunta (la de siempre) o, desde v0.1.357, sobre un cálculo. */
export const formConditionSchema = z.union([formFieldConditionSchema, formCalcConditionSchema]);
export type FormCondition = z.infer<typeof formConditionSchema>;

/** v0.1.357 — ¿Es una regla sobre un cálculo (y no sobre una pregunta)? */
export function isFormCalcCondition(c: FormCondition): c is FormCalcCondition {
    return typeof (c as FormCalcCondition).calc === 'string';
}

/** v0.1.356 — Hasta cuántas reglas tiene un grupo de condiciones. */
export const FORM_CONDITION_MAX_RULES = 10;

/**
 * v0.1.356 — Varias condiciones: se cumplen TODAS o ALGUNA. Lo que se arma
 * con un clic sigue siendo una condición suelta (la forma de siempre); el
 * grupo aparece al agregar una segunda regla.
 */
export const formConditionGroupSchema = z.object({
    match: z.enum(['all', 'any']).default('all'),
    rules: z.array(formConditionSchema).min(1).max(FORM_CONDITION_MAX_RULES),
});
export type FormConditionGroup = z.infer<typeof formConditionGroupSchema>;

/** Una condición suelta o un grupo. */
export const formShowIfSchema = z.union([formConditionGroupSchema, formConditionSchema]);
export type FormShowIf = z.infer<typeof formShowIfSchema>;

const itemIdSchema = z.string().regex(/^[a-z0-9]{4,24}$/);

/** v0.1.351 — Ancho de una pregunta o imagen (de 6 columnas: todo, mitad, un tercio, dos tercios). */
export const FORM_ITEM_WIDTHS = ['full', 'half', 'third', 'two_thirds'] as const;
export type FormItemWidth = (typeof FORM_ITEM_WIDTHS)[number];

/**
 * Qué archivos acepta una pregunta de archivos. Sea cual sea la elección,
 * los ejecutables y lo que un navegador interpretaría como página (`.exe`,
 * `.html`, `.svg`, scripts…) se rechazan siempre: un formulario público es
 * una puerta abierta a cualquiera.
 */
export const FORM_FILE_ACCEPTS = ['any', 'images', 'pdf', 'images_pdf', 'documents'] as const;
export type FormFileAccept = (typeof FORM_FILE_ACCEPTS)[number];

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp'];
const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'csv', 'rtf'];

export const FORM_FILE_ACCEPT_INFO: Record<FormFileAccept, { label: string; extensions: readonly string[] | null }> = {
    any: { label: 'Cualquier archivo (salvo programas)', extensions: null },
    images: { label: 'Imágenes', extensions: IMAGE_EXTS },
    pdf: { label: 'PDF', extensions: ['pdf'] },
    images_pdf: { label: 'Imágenes o PDF', extensions: [...IMAGE_EXTS, 'pdf'] },
    documents: { label: 'Documentos (PDF, Word, Excel, texto)', extensions: DOC_EXTS },
};

/** Extensiones que un formulario público nunca recibe. */
export const FORM_BLOCKED_EXTENSIONS: readonly string[] = [
    'exe', 'msi', 'msp', 'mst', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'drv', 'ocx',
    'ps1', 'psm1', 'vbs', 'vbe', 'js', 'mjs', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'class', 'apk', 'aab',
    'app', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'bin', 'so', 'dylib',
    'lnk', 'reg', 'gadget', 'inf', 'iso', 'img', 'vhd', 'vhdx', 'html', 'htm', 'xhtml', 'shtml', 'svg',
    'svgz', 'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi', 'pl', 'py', 'rb', 'xap', 'appx', 'msix',
];

const BLOCKED_MIME = /(x-msdownload|x-msdos-program|x-executable|x-sh|x-shellscript|javascript|ecmascript|html|svg|x-php|java-archive|vnd\.android\.package-archive|x-apple-diskimage)/i;

function extensionOf(filename: string): string {
    const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1) : '';
}

/** ¿Este archivo entra en esta pregunta? (por extensión y tipo declarado). */
export function formFileAllowed(accept: FormFileAccept, filename: string, mime: string): { ok: true } | { ok: false; reason: string } {
    const ext = extensionOf(filename);
    if (FORM_BLOCKED_EXTENSIONS.includes(ext) || BLOCKED_MIME.test(mime)) {
        return { ok: false, reason: 'Ese tipo de archivo no se puede enviar por un formulario.' };
    }
    const allowed = FORM_FILE_ACCEPT_INFO[accept].extensions;
    if (allowed && !allowed.includes(ext)) {
        return { ok: false, reason: `Este campo sólo acepta: ${FORM_FILE_ACCEPT_INFO[accept].label}.` };
    }
    return { ok: true };
}

/** Atributo `accept` del selector de archivos (vacío = cualquiera). */
export function formAcceptAttribute(accept: FormFileAccept): string {
    const exts = FORM_FILE_ACCEPT_INFO[accept].extensions;
    return exts ? exts.map((e) => `.${e}`).join(',') : '';
}

/**
 * v0.1.355 — Cómo se pregunta un campo. Además de las formas de las opciones
 * (lista, botones, tarjetas, desplegable) hay formas propias de algunos tipos:
 * - `search`: lista con buscador (selección, varias opciones, equipo).
 * - `scale`: botones numerados, como el NPS (número, calificación, porcentaje).
 * - `slider`: deslizador (número, moneda, porcentaje, calificación).
 * - `yes_no`: dos botones «Sí» y «No» (casilla).
 * - `signature`: firma dibujada con el dedo o el mouse (archivo).
 * - `ranking`: ordenar opciones (varias opciones, o un texto con opciones propias).
 * Una forma que el tipo no admite se lee como `auto` (ver `formDisplaysFor`).
 */
export const FORM_FIELD_DISPLAYS = [
    'auto',
    'radio',
    'dropdown',
    'buttons',
    'cards',
    'search',
    'scale',
    'slider',
    'yes_no',
    'signature',
    'ranking',
] as const;
export type FormFieldDisplay = (typeof FORM_FIELD_DISPLAYS)[number];

/** Las formas de preguntar que admite cada tipo de campo (la primera, `auto`, siempre). */
export function formDisplaysFor(fieldType: string, multiple = fieldType === 'multi_select'): readonly FormFieldDisplay[] {
    switch (fieldType) {
        case 'select':
            return ['auto', 'radio', 'buttons', 'cards', 'dropdown', 'search'];
        case 'multi_select':
            return ['auto', 'radio', 'buttons', 'cards', 'search', 'ranking'];
        case 'team':
            return multiple ? ['auto', 'radio', 'buttons', 'cards', 'search'] : ['auto', 'radio', 'buttons', 'cards', 'dropdown', 'search'];
        case 'number':
        case 'rating':
            return ['auto', 'scale', 'slider'];
        case 'percent':
            return ['auto', 'slider', 'scale'];
        case 'currency':
            return ['auto', 'slider'];
        case 'checkbox':
            return ['auto', 'yes_no'];
        case 'file':
            return ['auto', 'signature'];
        case 'text':
        case 'long_text':
            return ['auto', 'ranking'];
        default:
            return ['auto'];
    }
}

/**
 * v0.1.355 — Rango de una escala o un deslizador. Vacío (null) = el que
 * corresponde al campo (sus mínimos y máximos, o 1 a 5, o 0 a 100). Las
 * etiquetas van en los extremos («Nada probable» · «Muy probable»).
 */
export const formRangeSchema = z.object({
    min: z.number().finite().min(-1e12).max(1e12).nullable().catch(null).default(null),
    max: z.number().finite().min(-1e12).max(1e12).nullable().catch(null).default(null),
    step: z.number().positive().max(1e12).nullable().catch(null).default(null),
    low_label: z.string().max(60).catch('').default(''),
    mid_label: z.string().max(60).catch('').default(''),
    high_label: z.string().max(60).catch('').default(''),
});
export type FormRange = z.infer<typeof formRangeSchema>;

/** Opciones de una pregunta para ordenar (en un campo de texto). */
export const FORM_RANKING_MAX_OPTIONS = 15;

export const formFieldItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('field'),
    field_id: z.number().int().positive(),
    /** Pregunta que ve el visitante; vacío = la etiqueta del campo. */
    label: z.string().max(300).default(''),
    help: z.string().max(1000).default(''),
    placeholder: z.string().max(200).default(''),
    /** Obligatorio en ESTE formulario (aunque el campo no lo sea en la lista). */
    required: z.boolean().default(false),
    /**
     * Campo oculto: no se muestra, sólo se completa por la dirección
     * (`?origen=instagram`). Para saber de dónde llegó cada respuesta.
     */
    hidden: z.boolean().default(false),
    /**
     * Selección: `auto` (el estilo del tema; con más de 6 opciones, lista
     * desplegable), `radio` (lista), `buttons` (botones), `cards` (tarjetas,
     * con imagen si la opción tiene) o `dropdown` (lista desplegable).
     * v0.1.355 — y las formas propias de otros tipos (`FORM_FIELD_DISPLAYS`).
     */
    display: z.enum(FORM_FIELD_DISPLAYS).catch('auto').default('auto'),
    /** v0.1.355 — Escala o deslizador: mínimo, máximo, paso y etiquetas. */
    range: formRangeSchema.catch(() => formRangeSchema.parse({})).default({}),
    /** v0.1.355 — Sí / No: los textos de los dos botones (vacío = «Sí» y «No»). */
    yes_label: z.string().max(40).catch('').default(''),
    no_label: z.string().max(40).catch('').default(''),
    /**
     * v0.1.355 — «Otro»: la opción del campo que significa «otro» y el campo de
     * TEXTO de la lista donde se guarda lo que escribe la persona al elegirla.
     */
    other_option: z.string().max(200).nullable().catch(null).default(null),
    other_field_id: z.number().int().positive().nullable().catch(null).default(null),
    other_placeholder: z.string().max(120).catch('').default(''),
    /** v0.1.355 — Ordenar en un campo de texto: las opciones a ordenar. */
    ranking_options: z.array(z.string().max(120)).max(FORM_RANKING_MAX_OPTIONS).catch([]).default([]),
    /** Archivos: qué tipos acepta esta pregunta. */
    accept: z.enum(FORM_FILE_ACCEPTS).default('any'),
    show_if: formShowIfSchema.nullable().default(null),
    /** v0.1.351 — Ancho en el formulario: dos o tres preguntas lado a lado. */
    width: z.enum(FORM_ITEM_WIDTHS).catch('full').default('full'),
    /** v0.1.351 — No mostrar la etiqueta (queda para lectores de pantalla). */
    hide_label: z.boolean().catch(false).default(false),
    /** v0.1.351 — Columnas de las opciones (null = las del tema). */
    columns: z.number().int().min(1).max(4).nullable().catch(null).default(null),
    /** v0.1.351 — Imagen por opción (valor → archivo de la empresa), para las tarjetas. */
    option_images: z
        .record(z.string().max(200), z.number().int().positive())
        .refine((r) => Object.keys(r).length <= 60, 'Demasiadas imágenes')
        .catch({})
        .default({}),
});
export type FormFieldItem = z.infer<typeof formFieldItemSchema>;

export const formHeadingItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('heading'),
    text: z.string().max(300).default(''),
    show_if: formShowIfSchema.nullable().default(null),
});

export const formTextItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('text'),
    text: z.string().max(5000).default(''),
    show_if: formShowIfSchema.nullable().default(null),
});

/**
 * v0.1.289 — Salto de página: lo que viene después se muestra en un paso
 * aparte («Paso 2 de 4»). No tiene condición propia: una página cuyas
 * preguntas están todas escondidas se salta sola. `show_if` existe sólo para
 * que todos los ítems compartan la forma (siempre `null`).
 */
export const formPageBreakItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('page_break'),
    /** Título de la página que EMPIEZA aquí (opcional). */
    title: z.string().max(200).default(''),
    show_if: formShowIfSchema.nullable().default(null),
});
export type FormPageBreakItem = z.infer<typeof formPageBreakItemSchema>;

/** v0.1.351 — Una imagen entre las preguntas (un archivo de la empresa). */
export const formImageItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('image'),
    file_id: z.number().int().positive().nullable().default(null),
    /** Texto alternativo (lo leen los lectores de pantalla). */
    alt: z.string().max(300).default(''),
    caption: z.string().max(300).default(''),
    width: z.enum(FORM_ITEM_WIDTHS).catch('full').default('full'),
    /** Alto máximo (px); null = el natural. */
    max_height: z.number().int().min(40).max(1200).nullable().catch(null).default(null),
    show_if: formShowIfSchema.nullable().default(null),
});
export type FormImageItem = z.infer<typeof formImageItemSchema>;

/**
 * v0.1.355 — Matriz: varias preguntas con las mismas respuestas en una
 * grilla («Califica: Atención · Precio · Rapidez» × «Malo · Regular · Bueno»).
 * Cada FILA es un campo de la lista (selección, varias opciones,
 * calificación, número o porcentaje) y cada columna, una respuesta: en una
 * selección se guarda la opción cuyo valor o nombre coincide con la columna;
 * en un número, el número de la columna.
 */
export const FORM_MATRIX_ROW_TYPES = ['select', 'multi_select', 'rating', 'number', 'percent'] as const;
export const FORM_MATRIX_MAX_ROWS = 20;
export const FORM_MATRIX_MAX_COLUMNS = 10;

export const formMatrixRowSchema = z.object({
    field_id: z.number().int().positive(),
    /** Vacío = el nombre del campo. */
    label: z.string().max(200).catch('').default(''),
});
export const formMatrixColumnSchema = z.object({
    /** Lo que se guarda (opción o número); el texto que se ve va en `label`. */
    value: z.string().trim().min(1).max(120),
    label: z.string().max(120).catch('').default(''),
});
export const formMatrixItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('matrix'),
    label: z.string().max(300).default(''),
    help: z.string().max(1000).default(''),
    /** Obligatoria = hay que responder TODAS las filas. */
    required: z.boolean().default(false),
    rows: z.array(formMatrixRowSchema).max(FORM_MATRIX_MAX_ROWS).default([]),
    columns: z.array(formMatrixColumnSchema).max(FORM_MATRIX_MAX_COLUMNS).default([]),
    show_if: formShowIfSchema.nullable().default(null),
});
export type FormMatrixItem = z.infer<typeof formMatrixItemSchema>;

export const formItemSchema = z.discriminatedUnion('type', [
    formFieldItemSchema,
    formHeadingItemSchema,
    formTextItemSchema,
    formPageBreakItemSchema,
    formImageItemSchema,
    formMatrixItemSchema,
]);
export type FormItem = z.infer<typeof formItemSchema>;

/**
 * Una lista donde un elemento roto se descarta sin tirar los demás (una
 * regla escrita por una versión futura, o a mano por la API).
 */
function tolerantArray<T extends z.ZodTypeAny>(schema: () => T, max: number) {
    return z
        .array(z.unknown())
        .catch([])
        .default([])
        .transform((arr) =>
            arr.slice(0, max).flatMap((x) => {
                const r = schema().safeParse(x);
                return r.success ? [r.data as z.infer<T>] : [];
            }),
        );
}

export const FORM_MAX_JUMPS = 40;
export const FORM_MAX_ENDINGS = 10;

/**
 * v0.1.356 — Un salto: al terminar la página `from` (`start` = la primera;
 * si no, el id del salto de página que la abre), si se cumple `when` (null =
 * siempre), ir a `to`: el id del salto de página que abre la página de
 * destino, `end` (terminar) o `ending:<id>` (terminar en esa pantalla final).
 */
export const formJumpSchema = z.object({
    id: z.string().regex(/^[a-z0-9]{4,24}$/),
    from: z.string().regex(/^[a-z0-9]{4,24}$/),
    when: formShowIfSchema.nullable().default(null),
    to: z.string().regex(/^(?:end|ending:[a-z0-9]{4,24}|[a-z0-9]{4,24})$/),
});
export type FormJump = z.infer<typeof formJumpSchema>;

/** v0.1.357 — Hasta cuántos cálculos tiene un formulario y cuántas preguntas suma cada uno. */
export const FORM_MAX_CALCS = 5;
export const FORM_MAX_CALC_PARTS = 60;

/**
 * v0.1.357 — Lo que aporta una pregunta a un cálculo: puntos por cada opción
 * (selección, varias opciones —se suman—, Sí/No y casilla como `true`/
 * `false`, una escala por su número) y, en una respuesta numérica, la
 * respuesta multiplicada por un factor.
 */
export const formCalcPartSchema = z.object({
    field_id: z.number().int().positive(),
    points: z
        .record(z.string().max(200), z.number().finite().min(-1_000_000).max(1_000_000))
        .refine((r) => Object.keys(r).length <= 300, 'Demasiadas opciones con puntos.')
        .default({}),
    multiplier: z.number().finite().min(-10_000).max(10_000).nullable().default(null),
});
export type FormCalcPart = z.infer<typeof formCalcPartSchema>;

/**
 * v0.1.357 — Un cálculo del formulario (puntaje, total, nivel): empieza en
 * `start` y suma lo que aporta cada pregunta respondida en el camino de la
 * persona. Se usa entre llaves (`{{puntaje}}`), en saltos y pantallas
 * finales, y se puede guardar en un campo numérico de la lista.
 */
export const formCalcSchema = z.object({
    id: z.string().regex(/^[a-z0-9]{4,24}$/),
    key: z.string().regex(FORM_CALC_KEY_RE),
    name: z.string().max(80).default(''),
    start: z.number().finite().min(-1_000_000).max(1_000_000).default(0),
    parts: z.array(formCalcPartSchema).max(FORM_MAX_CALC_PARTS).default([]),
    /** Campo numérico de la lista donde se guarda el resultado (no puede ser una pregunta del formulario). */
    save_field_id: z.number().int().positive().nullable().default(null),
});
export type FormCalc = z.infer<typeof formCalcSchema>;

/**
 * v0.1.357 — Pantalla de bienvenida: lo primero que ve la persona, con un
 * botón para empezar. Sus textos pueden recordar lo que llega en la dirección
 * (`{{nombre}}` de una pregunta oculta).
 */
export const formWelcomeSchema = z.object({
    enabled: z.boolean().default(false),
    title: z.string().max(200).default(''),
    message: z.string().max(2000).default(''),
    button_label: z.string().max(60).default('Empezar'),
    /** Imagen de la empresa (como las de las preguntas). */
    file_id: z.number().int().positive().nullable().default(null),
    /** Mostrar «Toma unos N minutos». */
    show_time: z.boolean().default(true),
});
export type FormWelcome = z.infer<typeof formWelcomeSchema>;
const FORM_WELCOME_DEFAULT: FormWelcome = { enabled: false, title: '', message: '', button_label: 'Empezar', file_id: null, show_time: true };

/** v0.1.357 — Cómo se responde: todo a la vista (por páginas) o una pregunta por pantalla. */
export const FORM_LAYOUTS = ['classic', 'conversational'] as const;
export type FormLayout = (typeof FORM_LAYOUTS)[number];

/** v0.1.356 — Una pantalla final con su condición (null = sólo si un salto lleva a ella). */
export const formEndingSchema = z.object({
    id: z.string().regex(/^[a-z0-9]{4,24}$/),
    /** Nombre interno, para reconocerla en el constructor. */
    name: z.string().max(80).default(''),
    title: z.string().max(200).default('¡Gracias!'),
    message: z.string().max(2000).default(''),
    /** v0.1.374 — admite variables (`{{nombre}}`, `{{envio.id}}`) después del dominio. */
    redirect_url: redirectUrlSchema.nullable().default(null),
    when: formShowIfSchema.nullable().default(null),
});
export type FormEnding = z.infer<typeof formEndingSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * v0.1.358 — Guardar el avance: `device` = lo que se va respondiendo queda en
 * ese navegador y, al volver, ofrece seguir donde quedó; `email` = un botón
 * «Guardar y seguir después» manda un enlace al correo para terminarlo en otro
 * momento (o en otro dispositivo). Los archivos y las firmas no se guardan.
 */
export const formSaveProgressSchema = z.object({
    device: z.boolean().default(false),
    email: z.boolean().default(false),
});
export type FormSaveProgress = z.infer<typeof formSaveProgressSchema>;
export const FORM_SAVE_PROGRESS_DEFAULT: FormSaveProgress = { device: false, email: false };

/**
 * v0.1.360 — Enlaces para actualizar un registro: con `enabled`, el equipo (o
 * una automatización, con `{{formulario.<id>.enlace}}`) le manda a alguien un
 * enlace firmado que abre este formulario con lo que SU registro ya tiene; al
 * enviarlo, se actualiza ese registro en vez de crear otro. `days` = cuánto
 * vale cada enlace; `version` sube al invalidarlos todos; `message` = lo que
 * ve al guardar (vacío = «¡Listo! Guardamos tus cambios.»).
 */
export const formEditLinksSchema = z.object({
    enabled: z.boolean().default(false),
    days: z.number().int().min(1).max(365).catch(30).default(30),
    version: z.number().int().min(1).max(1_000_000).catch(1).default(1),
    message: z.string().max(1000).catch('').default(''),
});
export type FormEditLinks = z.infer<typeof formEditLinksSchema>;
export const FORM_EDIT_LINKS_DEFAULT: FormEditLinks = { enabled: false, days: 30, version: 1, message: '' };

/**
 * v0.1.361 — Cobrar al enviar: al recibir la respuesta se arma un link de
 * pago con una conexión de cobro DEL EQUIPO de la empresa (Mercado Pago o
 * Wompi, ADR-S31) y la persona va a pagar. El monto lo decide SIEMPRE el
 * servidor: un valor fijo, el resultado de un cálculo del formulario o lo que
 * la persona escribió en una pregunta de número o moneda (dentro de un
 * mínimo y un máximo). Si el monto da cero, no se cobra.
 */
export const FORM_PAYMENT_SOURCES = ['fixed', 'calc', 'field'] as const;
export type FormPaymentSource = (typeof FORM_PAYMENT_SOURCES)[number];
/** Qué pasa al enviar: llevar directo a pagar o mostrar el botón «Pagar» en la pantalla final. */
export const FORM_PAYMENT_AFTER = ['redirect', 'button'] as const;
const paymentAmount = z.number().min(0).max(FORM_PAYMENT_MAX_AMOUNT);
export const formPaymentSchema = z.object({
    enabled: z.boolean().default(false),
    connection_id: z.number().int().positive().nullable().catch(null).default(null),
    /** El concepto del cobro (acepta respuestas recordadas: «Inscripción de {{nombre}}»); vacío = el título del formulario. */
    title: z.string().max(200).catch('').default(''),
    source: z.enum(FORM_PAYMENT_SOURCES).catch('fixed').default('fixed'),
    /** Monto fijo (source = fixed). */
    amount: paymentAmount.nullable().catch(null).default(null),
    /** Clave del cálculo que da el monto (source = calc). */
    calc_key: z.string().max(40).nullable().catch(null).default(null),
    /** Id del CAMPO número o moneda cuya respuesta es el monto (source = field). */
    field_id: z.number().int().positive().nullable().catch(null).default(null),
    min: paymentAmount.nullable().catch(null).default(null),
    max: paymentAmount.nullable().catch(null).default(null),
    /** Moneda del cobro (Wompi sólo cobra en COP). */
    currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .catch('COP')
        .default('COP'),
    /** Días que sirve el link de pago. */
    expires_days: z.number().int().min(1).max(30).catch(3).default(3),
    after: z.enum(FORM_PAYMENT_AFTER).catch('redirect').default('redirect'),
    /** El botón para pagar. */
    button_label: z.string().max(60).catch('').default(''),
});
export type FormPayment = z.infer<typeof formPaymentSchema>;
export const FORM_PAYMENT_DEFAULT: FormPayment = {
    enabled: false,
    connection_id: null,
    title: '',
    source: 'fixed',
    amount: null,
    calc_key: null,
    field_id: null,
    min: null,
    max: null,
    currency: 'COP',
    expires_days: 3,
    after: 'redirect',
    button_label: '',
};
/**
 * v0.1.368 (ADR-S96) — Suscribir al enviar: el formulario crea una
 * suscripción de débito automático de Mercado Pago con uno de los planes de la
 * empresa (ADR-S96). Si hay varios, la persona elige. El correo sale de la
 * pregunta «correo de quien responde» (Mercado Pago lo exige). Excluyente con
 * «Cobrar al enviar»: un formulario cobra una vez O suscribe.
 */
export const FORM_SUBSCRIPTION_MAX_PLANS = 6;
export const formSubscriptionSchema = z.object({
    enabled: z.boolean().default(false),
    /** Los planes que se ofrecen (de conexiones de Mercado Pago del equipo). */
    plan_ids: z.array(z.number().int().positive()).max(FORM_SUBSCRIPTION_MAX_PLANS).catch([]).default([]),
    /** El título de la elección de plan («Elige tu plan»). */
    plan_label: z.string().max(120).catch('').default(''),
    after: z.enum(FORM_PAYMENT_AFTER).catch('redirect').default('redirect'),
    /** El botón para autorizar la tarjeta. */
    button_label: z.string().max(60).catch('').default(''),
});
export type FormSubscription = z.infer<typeof formSubscriptionSchema>;
export const FORM_SUBSCRIPTION_DEFAULT: FormSubscription = {
    enabled: false,
    plan_ids: [],
    plan_label: '',
    after: 'redirect',
    button_label: '',
};
/** Un plan visto desde la página pública (sin la conexión). */
export interface PublicFormPlan {
    id: number;
    name: string;
    description: string | null;
    amount: number;
    currency: string;
    frequency: number;
    frequency_type: 'months' | 'days';
    trial_days: number;
    cycles: number | null;
    /** v0.1.373 — Quién cobra: para decir «autorizas el pago en PayPal» o «en Mercado Pago». */
    provider?: 'mercadopago' | 'paypal';
}

/** El estado de un pago visto desde la página pública (al volver del checkout). */
export const FORM_PAYMENT_STATES = ['pending', 'paid', 'failed', 'expired', 'cancelled'] as const;
export type FormPaymentState = (typeof FORM_PAYMENT_STATES)[number];

export const formSettingsSchema = z.object({
    title: z.string().max(200).default(''),
    description: z.string().max(5000).default(''),
    submit_label: z.string().max(60).default('Enviar'),
    success_title: z.string().max(200).default('¡Gracias!'),
    success_message: z.string().max(2000).default('Recibimos tu respuesta.'),
    /**
     * Al enviar, llevar a esta dirección (https) en vez del mensaje. v0.1.374:
     * admite variables (`{{nombre}}`, `{{envio.id}}`, `{{valor}}`) después del
     * dominio.
     */
    redirect_url: redirectUrlSchema.nullable().default(null),
    /** v0.1.374 — Segundos que se ve el «¡Gracias!» antes de ir a la dirección. */
    redirect_delay: redirectDelaySchema,
    /** Botón «Enviar otra respuesta» en la pantalla de gracias. */
    allow_another: z.boolean().default(true),
    /** Completar campos desde la dirección: `?nombre=Ana&origen=web`. */
    allow_prefill: z.boolean().default(true),
    /** Sitios que pueden insertarlo por iframe; vacío = cualquiera. */
    allowed_domains: z.array(z.string().max(253)).max(50).default([]),
    /** Color del botón y los detalles; null = el color de la marca. */
    accent_color: hexColor.nullable().default(null),
    show_logo: z.boolean().default(true),
    /**
     * v0.1.369 — Un logo propio para ESTE formulario (un archivo de la
     * empresa, nunca SVG). Null = el logo de la empresa. Con `show_logo`
     * apagado no se muestra ninguno.
     */
    logo_file_id: z.number().int().positive().nullable().default(null),
    /** Deja de recibir respuestas después de este día (inclusive). */
    closes_at: isoDate.nullable().default(null),
    /** Deja de recibir respuestas al llegar a este número. */
    max_submissions: z.number().int().min(1).max(1_000_000).nullable().default(null),
    closed_message: z.string().max(1000).default('Este formulario ya no está recibiendo respuestas.'),
    /**
     * v0.1.289 — Pedir verificación anti-robots (captcha). El proveedor y las
     * llaves NO viven aquí: salen de la empresa o, si no tiene, de la
     * plataforma (`resolveCaptcha`). Sin llaves en ningún lado, no se pide.
     */
    captcha: z.boolean().default(false),
    /**
     * v0.1.289 — La pregunta de tipo email con el correo de quien responde
     * (para confirmar el correo y para mandarle la copia). Id del CAMPO.
     */
    respondent_email_field_id: z.number().int().positive().nullable().default(null),
    /**
     * Doble opt-in: la respuesta queda PENDIENTE hasta que la persona abre el
     * enlace que le llega al correo; recién ahí se crea el registro.
     */
    confirm_email: z.boolean().default(false),
    /** Mandarle a quien responde una copia de sus respuestas. */
    send_copy: z.boolean().default(false),
    /**
     * Pedir la autorización de tratamiento de datos personales (Ley 1581) con
     * el texto de la empresa (Ajustes → Datos personales). Encendida por
     * defecto: apenas la empresa activa su texto, todos sus formularios la
     * piden; se apaga por formulario (p. ej. uno que no recoge datos
     * personales). Sin texto activo en la empresa no se pide.
     */
    data_consent: z.boolean().default(true),
    /**
     * C6 — El registro que crea el formulario sale de esta plantilla de
     * registro de la lista (valores, subtareas y checklists). Lo que el
     * formulario completa PISA lo de la plantilla. null = alta normal.
     */
    record_template_id: z.number().int().positive().nullable().default(null),
    /**
     * v0.1.351 (ADR-S94) — Diseño de la página: colores, tipografía, tamaños,
     * bordes, fondo, portada… null = el de siempre (el «Clásico»).
     */
    theme: publicThemeSchema.nullable().catch(null).default(null),
    /**
     * v0.1.356 — Saltos entre páginas: al terminar una página, si se cumple
     * la condición, ir a otra más adelante o terminar. Se mira el primero que
     * se cumple de esa página. Uno roto (de una versión futura, o que apunta a
     * algo que ya no existe) se descarta solo, sin tirar los demás.
     */
    jumps: tolerantArray(() => formJumpSchema, FORM_MAX_JUMPS),
    /**
     * v0.1.356 — Pantallas finales: la primera cuya condición se cumple (o la
     * que pide un salto) reemplaza al «¡Gracias!» de siempre.
     */
    endings: tolerantArray(() => formEndingSchema, FORM_MAX_ENDINGS),
    /** v0.1.357 — Cálculos (puntaje, total…). Uno roto se descarta sin tirar los demás. */
    calcs: tolerantArray(() => formCalcSchema, FORM_MAX_CALCS),
    /** v0.1.357 — Pantalla de bienvenida. */
    welcome: formWelcomeSchema.catch(FORM_WELCOME_DEFAULT).default(FORM_WELCOME_DEFAULT),
    /** v0.1.357 — Todo a la vista o una pregunta por pantalla (lo desconocido = el de siempre). */
    layout: z.enum(FORM_LAYOUTS).catch('classic').default('classic'),
    /** v0.1.358 — Guardar el avance (en el dispositivo y/o con un enlace al correo). */
    save_progress: formSaveProgressSchema.catch(FORM_SAVE_PROGRESS_DEFAULT).default(FORM_SAVE_PROGRESS_DEFAULT),
    /** v0.1.360 — Enlaces para que alguien actualice su registro con este formulario. */
    edit_links: formEditLinksSchema.catch(FORM_EDIT_LINKS_DEFAULT).default(FORM_EDIT_LINKS_DEFAULT),
    /** v0.1.361 — Cobrar al enviar. */
    payment: formPaymentSchema.catch(FORM_PAYMENT_DEFAULT).default(FORM_PAYMENT_DEFAULT),
    /** v0.1.368 — Suscribir al enviar (débito automático de Mercado Pago). */
    subscription: formSubscriptionSchema.catch(FORM_SUBSCRIPTION_DEFAULT).default(FORM_SUBSCRIPTION_DEFAULT),
    /** v0.1.374 (ADR-S97) — Medir conversiones en el sitio donde está insertado. */
    conversion: conversionSettingsSchema.catch(CONVERSION_SETTINGS_DEFAULT).default(CONVERSION_SETTINGS_DEFAULT),
    /** v0.1.374 — Guardar de dónde vino cada registro (campaña, clic del anuncio, página). */
    attribution: attributionSettingsSchema.catch(ATTRIBUTION_SETTINGS_DEFAULT).default(ATTRIBUTION_SETTINGS_DEFAULT),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export const FORM_MAX_ITEMS = 120;

export const formConfigSchema = z.object({
    items: z.array(formItemSchema).max(FORM_MAX_ITEMS).default([]),
    settings: formSettingsSchema.default({}),
});
export type FormConfig = z.infer<typeof formConfigSchema>;

export interface FormDto {
    id: number;
    list_id: number;
    name: string;
    enabled: boolean;
    config: FormConfig;
    /** Dirección pública relativa (`/api/v1/public/f/:token`), con o sin publicar. */
    public_path: string;
    /**
     * La dirección ABSOLUTA para compartir e insertar: por el dominio propio
     * de la empresa si lo tiene y responde (si no, el de la plataforma).
     */
    public_url?: string;
    /** El origen de esa dirección (para el script que ajusta el alto al insertarlo). */
    public_origin?: string;
    submissions_count: number;
    last_submitted_at: string | null;
    created_at: string;
    updated_at: string;
}

export const createFormSchema = z.object({
    name: z.string().trim().min(1).max(120),
    config: formConfigSchema.optional(),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    config: formConfigSchema.optional(),
    /** Emite una dirección nueva: la anterior deja de funcionar. */
    regenerate_token: z.boolean().optional(),
});
export type UpdateFormInput = z.infer<typeof updateFormSchema>;

// ─────────────────────────── Público ───────────────────────────

export interface PublicFormOption {
    value: string;
    label: string;
    /** v0.1.351 — imagen de la opción (tarjetas). */
    image_url?: string | null;
}

/** Lo que el visitante necesita de cada campo — nada de la lista entera. */
export interface PublicFormFieldItem {
    id: string;
    type: 'field';
    /** Clave del valor en el envío: el id del campo como texto. */
    key: string;
    /** Para completar desde la dirección (`?slug=valor`). */
    slug: string;
    field_type: FormFieldType;
    label: string;
    help: string;
    placeholder: string;
    required: boolean;
    hidden: boolean;
    /**
     * Cómo se dibuja: `radio`/`checkboxes` (opciones, según `choice_style`),
     * `dropdown`, o (v0.1.355) `search`, `scale`, `slider`, `yes_no`,
     * `signature` y `ranking`. Un tipo sin forma propia usa `radio` y la
     * página dibuja su control de siempre.
     */
    display: PublicFormDisplay;
    /** v0.1.355 — Se eligen varias opciones (varias opciones, equipos, ordenar en «varias opciones»). */
    multiple?: boolean;
    /** v0.1.355 — Escala o deslizador ya resueltos. */
    range?: PublicFormRange;
    yes_label?: string;
    no_label?: string;
    /** v0.1.355 — «Otro»: la opción que lo abre y la clave (id del campo de texto) donde va lo escrito. */
    other?: { value: string; key: string; placeholder: string };
    /** v0.1.355 — Lo que se ordena (en «varias opciones», las opciones del campo). */
    ranking?: PublicFormOption[];
    /** v0.1.351 — Cómo se dibujan las opciones cuando no es lista desplegable. */
    choice_style?: PublicChoiceStyle;
    /** v0.1.351 — Columnas de las opciones (null = las del tema). */
    columns?: number | null;
    /** v0.1.351 — Ancho en la grilla del formulario. */
    width?: FormItemWidth;
    hide_label?: boolean;
    options?: PublicFormOption[];
    /** Sólo lo que el control necesita: máximos, decimales, símbolo, país. */
    config: {
        max_files?: number;
        max?: number;
        min?: number;
        precision?: number;
        currency?: string;
        default_country?: string;
        max_length?: number;
        /** Archivos: atributo `accept` del selector y su descripción. */
        accept?: string;
        accept_label?: string;
    };
    show_if: FormShowIf | null;
}

/** v0.1.355 */
export type PublicFormDisplay = 'radio' | 'dropdown' | 'checkboxes' | 'search' | 'scale' | 'slider' | 'yes_no' | 'signature' | 'ranking';

/** v0.1.355 — Rango ya resuelto de una escala o un deslizador. */
export interface PublicFormRange {
    min: number;
    max: number;
    step: number;
    low_label: string;
    mid_label: string;
    high_label: string;
}

/** v0.1.355 — Una fila de una matriz: un campo y lo que se guarda en cada columna. */
export interface PublicFormMatrixRow {
    /** El id del campo como texto (la clave del valor en el envío). */
    key: string;
    field_id: number;
    slug: string;
    label: string;
    field_type: string;
    /** Lo que se guarda al elegir cada columna; null = esa columna no aplica a la fila. */
    values: Array<string | number | null>;
}

export interface PublicFormMatrixItem {
    id: string;
    type: 'matrix';
    label: string;
    help: string;
    required: boolean;
    /** Varias respuestas por fila (filas de «varias opciones»). */
    multiple: boolean;
    columns: Array<{ label: string }>;
    rows: PublicFormMatrixRow[];
    show_if: FormShowIf | null;
}

export type PublicFormItem =
    | PublicFormFieldItem
    | PublicFormMatrixItem
    | { id: string; type: 'heading'; text: string; show_if: FormShowIf | null }
    | { id: string; type: 'text'; text: string; show_if: FormShowIf | null }
    | { id: string; type: 'page_break'; title: string; show_if: null }
    | {
          id: string;
          type: 'image';
          url: string | null;
          alt: string;
          caption: string;
          width: FormItemWidth;
          max_height: number | null;
          show_if: FormShowIf | null;
      };

/** v0.1.289 — Lo que la página pública necesita para dibujar el captcha. */
export interface PublicFormCaptcha {
    provider: 'turnstile' | 'hcaptcha' | 'recaptcha';
    site_key: string;
}

export interface PublicFormMeta {
    title: string;
    description: string;
    submit_label: string;
    success_title: string;
    success_message: string;
    redirect_url: string | null;
    allow_another: boolean;
    allow_prefill: boolean;
    accent_color: string;
    logo_url: string | null;
    company: string;
    /** Separadores de la empresa para leer «150.000». */
    number_format: 'comma_dot' | 'dot_comma' | 'space_comma';
    items: PublicFormItem[];
    /** null = recibe respuestas; si no, el mensaje de cerrado. */
    closed: string | null;
    /** Sello de carga (anti-robots): el envío tiene que traerlo. */
    stamp: string;
    max_upload_bytes: number;
    /** v0.1.289 — verificación anti-robots a dibujar antes de enviar (null = no se pide). */
    captcha?: PublicFormCaptcha | null;
    /** v0.1.289 — la respuesta se confirma desde el correo (doble opt-in). */
    confirm_email?: boolean;
    /** Autorización de tratamiento de datos a aceptar antes de enviar (null = no se pide). */
    data_consent?: PublicDataConsent | null;
    /**
     * v0.1.351 — Lo que la página necesita del diseño para ARMARSE (etiquetas,
     * opciones, avance, portada…). Los colores y tamaños van en el CSS.
     */
    theme?: PublicThemeView;
    /** v0.1.356 — Saltos entre páginas (`from`/`to` = ids de los saltos de página). */
    jumps?: PublicFormJump[];
    /** v0.1.356 — Pantallas finales (en vez del «¡Gracias!» de siempre). */
    endings?: PublicFormEnding[];
    /** v0.1.356 — `{{nombre}}` de los textos → la clave de esa respuesta. */
    recall?: Record<string, string>;
    /** v0.1.357 — Todo a la vista o una pregunta por pantalla. */
    layout?: FormLayout;
    /** v0.1.357 — Pantalla de bienvenida (null = sin bienvenida). */
    welcome?: PublicFormWelcome | null;
    /**
     * v0.1.357 — Los cálculos del formulario. `parts` viaja sólo si la página
     * lo necesita mientras se responde (un salto o un texto de las preguntas
     * lo usa); si no, es null y el resultado llega en la respuesta del envío
     * (así el puntaje de una evaluación no se ve en el código de la página).
     */
    calcs?: PublicFormCalc[];
    /** v0.1.358 — Guardar el avance (null = no se guarda). */
    save_progress?: FormSaveProgress | null;
    /**
     * v0.1.360 — ¿Acepta enlaces para actualizar un registro? (la página sólo
     * pide los datos del registro si lo acepta) y el mensaje al guardar.
     */
    edit_links?: { message: string } | null;
    /**
     * v0.1.361 — Cobrar al enviar: de dónde sale el monto (para mostrar el
     * total antes de enviar; el servidor lo vuelve a calcular), la moneda y
     * el botón. null = no se cobra.
     */
    payment?: PublicFormPayment | null;
    /** v0.1.368 — suscribir al enviar: los planes que se ofrecen. */
    subscription?: PublicFormSubscription | null;
    /** v0.1.374 — Qué avisarle al sitio al enviar (null = nada). */
    conversion?: PublicConversion | null;
    /** v0.1.374 — Segundos del «¡Gracias!» antes de ir a la página de gracias. */
    redirect_delay?: number;
}

/** v0.1.368 — Suscribir al enviar, visto desde la página. */
export interface PublicFormSubscription {
    plans: PublicFormPlan[];
    plan_label: string;
    after: 'redirect' | 'button';
    button_label: string;
}

/** v0.1.368 — Lo que la página muestra al volver de Mercado Pago o PayPal (`?suscripcion=`). */
export interface PublicFormSubscriptionStatus {
    /** pending = todavía no autorizó; active = autorizó; failed = autorizó pero el cobro no pasó; cancelled. */
    state: 'pending' | 'active' | 'failed' | 'cancelled';
    plan: string;
    amount: number;
    currency: string;
    frequency: number;
    frequency_type: 'months' | 'days';
    /** Si todavía no autorizó: el link para terminar (si no, null). */
    url: string | null;
    /** v0.1.373 — Quién cobra (Mercado Pago o PayPal). */
    provider?: 'mercadopago' | 'paypal';
}

export interface PublicFormPayment {
    source: FormPaymentSource;
    /** Monto fijo (source = fixed). */
    amount: number | null;
    /** Cálculo que da el monto (source = calc). */
    calc_key: string | null;
    /** Campo cuya respuesta es el monto (source = field), con sus límites. */
    field_id: number | null;
    min: number | null;
    max: number | null;
    currency: string;
    after: 'redirect' | 'button';
    button_label: string;
}

/** v0.1.361 — Lo que la página muestra al volver del pago. */
export interface PublicFormPaymentStatus {
    status: FormPaymentState;
    title: string;
    amount: number;
    currency: string;
    /** El link para pagar, mientras siga pendiente y vigente. */
    url: string | null;
}

/** v0.1.357 */
export interface PublicFormWelcome {
    title: string;
    message: string;
    button_label: string;
    image_url: string | null;
    /** «Toma unos N minutos» (null = no se muestra). */
    minutes: number | null;
}

/** v0.1.357 */
export interface PublicFormCalc {
    key: string;
    name: string;
    start: number;
    /** Lo que aporta cada pregunta (`key` = la clave de la respuesta). null = se calcula en el servidor. */
    parts: Array<{ key: string; points: Record<string, number>; multiplier: number | null }> | null;
}

/** v0.1.356 */
export interface PublicFormJump {
    from: string;
    when: FormShowIf | null;
    to: string;
}

/** v0.1.356 */
export interface PublicFormEnding {
    id: string;
    title: string;
    message: string;
    redirect_url: string | null;
    when: FormShowIf | null;
}

export const submitFormSchema = z.object({
    /** Clave = id del campo como texto (`"12"`). */
    values: z.record(z.string().regex(/^\d{1,12}$/), z.unknown()).default({}),
    /** Archivos subidos antes: clave = id del campo, valor = sus comprobantes. */
    uploads: z.record(z.string().regex(/^\d{1,12}$/), z.array(z.string().max(300)).max(20)).default({}),
    stamp: z.string().max(200),
    /** Campo trampa: una persona nunca lo ve ni lo llena. */
    hp: z.string().max(500).optional(),
    /** v0.1.289 — el token del captcha (si el formulario lo pide). */
    captcha: z.string().max(4096).optional(),
    /** Aceptó la autorización de tratamiento de datos (la casilla). */
    consent: z.boolean().optional(),
    /** La versión del texto que se le mostró. */
    consent_version: z.number().int().positive().max(1_000_000).optional(),
    /** v0.1.358 — El avance guardado que se está terminando (se borra al enviar). */
    draft: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/).optional(),
    /** v0.1.358 — Cuánto tardó desde que empezó a responder (para el tiempo promedio). */
    elapsed_ms: z.number().int().min(0).max(7 * 86_400_000).optional(),
    /** v0.1.360 — El enlace para actualizar un registro (actualiza ése en vez de crear otro). */
    edit: z.string().regex(/^\d{1,12}\.\d{9,11}\.[0-9a-f]{32}$/).optional(),
    /** v0.1.368 — El plan que eligió (si el formulario suscribe y ofrece varios). */
    plan_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    /** v0.1.374 — De dónde vino (la dirección del sitio o del enlace): campaña, clic del anuncio, página. */
    attribution: attributionInputSchema,
});
export type SubmitFormInput = z.infer<typeof submitFormSchema>;

export interface SubmitFormResult {
    ok: true;
    redirect_url: string | null;
    /** v0.1.356 — La pantalla final que corresponde (null = el «¡Gracias!» del formulario). */
    ending_id?: string | null;
    /** v0.1.357 — El resultado de cada cálculo (clave → número), para la pantalla final. */
    calcs?: Record<string, number>;
    /**
     * v0.1.289 — doble opt-in: la respuesta quedó PENDIENTE y se mandó el
     * correo para confirmarla. `email_hint` = el correo enmascarado.
     */
    pending_confirmation?: boolean;
    email_hint?: string;
    /** v0.1.360 — Se actualizó un registro que ya existía (no se creó otro). */
    updated?: boolean;
    /**
     * v0.1.361 — Cobrar al enviar: el link para pagar (y su monto), o por qué
     * no se pudo armar. La respuesta YA quedó guardada en los dos casos.
     */
    payment?: { url: string; amount: number; currency: string; after: 'redirect' | 'button'; button_label: string } | null;
    payment_error?: string;
    /**
     * v0.1.368 — Suscribir al enviar: el link para que autorice el pago en
     * Mercado Pago o PayPal, o por qué no se pudo armar. La respuesta YA quedó guardada.
     */
    subscription?: {
        url: string;
        plan: string;
        amount: number;
        currency: string;
        frequency: number;
        frequency_type: 'months' | 'days';
        after: 'redirect' | 'button';
        button_label: string;
        /** v0.1.373 — Quién cobra (Mercado Pago o PayPal). */
        provider?: 'mercadopago' | 'paypal';
    } | null;
    subscription_error?: string;
    /** v0.1.374 — Para el evento del sitio (valor, id único del envío). */
    conversion?: ConversionResult | null;
}

export interface FormUploadResult {
    token: string;
    name: string;
    size: number;
}

// ─────────────────────────── Lógica pura ───────────────────────────

/** Id corto y estable para un ítem nuevo. */
export function newFormItemId(): string {
    let s = '';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

/**
 * Formulario de arranque para una lista: pregunta sus campos escribibles en
 * orden (hasta 12), con los obligatorios de la lista ya marcados. Es un
 * punto de partida — se edita en el constructor.
 */
export function defaultFormConfig(
    listName: string,
    fields: ReadonlyArray<{ id: number; type: string; is_required?: boolean }>,
): FormConfig {
    const askable = fields.filter((f) => isFormFieldType(f.type)).slice(0, 12);
    return formConfigSchema.parse({
        items: askable.map((f) => ({
            id: newFormItemId(),
            type: 'field',
            field_id: f.id,
            required: f.is_required === true,
        })),
        settings: { title: listName },
    });
}

// ─────────────────────── Preguntas públicas ───────────────────────

/** Lo mínimo de un campo que hace falta para armar su pregunta. */
export interface FormFieldLike {
    id: number;
    slug: string;
    label: string;
    type: string;
    config: Record<string, unknown>;
    is_required: boolean;
    description?: string | null;
}

function optionsOf(field: { config: Record<string, unknown> }): PublicFormOption[] {
    const raw = field.config.options;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((o) => {
        if (!o || typeof o !== 'object') return [];
        const { value, label } = o as { value?: unknown; label?: unknown };
        if (typeof value !== 'string') return [];
        return [{ value, label: typeof label === 'string' && label !== '' ? label : value }];
    });
}

function cfgNum(cfg: Record<string, unknown>, key: string): number | undefined {
    const v = cfg[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Las formas que existían antes de v0.1.355 (las únicas que dibuja la agenda). */
const BASIC_DISPLAYS = new Set<FormFieldDisplay>(['auto', 'radio', 'dropdown', 'buttons', 'cards']);

/**
 * v0.1.355 — La forma que de verdad se usa: la elegida si el tipo la admite;
 * si no, `auto`. `basic` deja sólo las de las opciones (la agenda).
 */
export function effectiveFormDisplay(
    display: FormFieldDisplay,
    fieldType: string,
    multiple = fieldType === 'multi_select',
    basic = false,
): FormFieldDisplay {
    if (basic && !BASIC_DISPLAYS.has(display)) return 'auto';
    return formDisplaysFor(fieldType, multiple).includes(display) ? display : 'auto';
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n));
}
/** Redondea al decimal del paso (evita 0.30000000000000004). */
function tidy(n: number): number {
    return Number(n.toFixed(6));
}

/**
 * v0.1.355 — El rango de una escala o un deslizador con los valores del
 * campo: lo que se elija nunca puede caer fuera de lo que el campo acepta.
 */
export function resolveFormRange(
    kind: 'scale' | 'slider',
    fieldType: string,
    cfg: Record<string, unknown>,
    range: Partial<FormRange> | null | undefined,
): PublicFormRange {
    const r = range ?? {};
    const fmin = cfgNum(cfg, 'min');
    const fmax = cfgNum(cfg, 'max');
    let lo: number;
    let hi: number;
    let min: number;
    let max: number;
    let step: number;
    if (fieldType === 'rating') {
        lo = 0;
        hi = clamp(Math.round(fmax ?? 5), 1, 10);
        min = r.min ?? (kind === 'scale' ? 1 : 0);
        max = r.max ?? hi;
        step = Math.max(1, Math.round(r.step ?? 1));
    } else if (fieldType === 'percent') {
        lo = 0;
        hi = 100;
        min = r.min ?? 0;
        max = r.max ?? 100;
        step = r.step ?? (kind === 'scale' ? 10 : 1);
    } else {
        lo = fmin ?? -1e12;
        hi = fmax ?? 1e12;
        min = r.min ?? fmin ?? (kind === 'scale' ? 1 : 0);
        const fallbackMax = kind === 'scale' ? min + 4 : fieldType === 'currency' ? 1_000_000 : 100;
        max = r.max ?? fmax ?? fallbackMax;
        step = r.step ?? (fieldType === 'currency' && kind === 'slider' ? Math.max(1, (max - min) / 100) : 1);
    }
    min = clamp(min, lo, hi);
    max = clamp(max, lo, hi);
    if (fieldType === 'rating') {
        min = Math.round(min);
        max = Math.round(max);
    }
    if (!(step > 0)) step = 1;
    if (max <= min) max = clamp(min + step, lo, hi);
    if (max <= min) min = clamp(max - step, lo, hi);
    if (kind === 'scale') {
        // Una escala son botones: entre 2 y 11.
        const count = Math.floor((max - min) / step + 1e-9) + 1;
        if (count > FORM_SCALE_MAX_BUTTONS) max = tidy(min + step * (FORM_SCALE_MAX_BUTTONS - 1));
        else max = tidy(min + step * (count - 1));
    }
    return {
        min: tidy(min),
        max: tidy(max),
        step: tidy(step),
        low_label: (r.low_label ?? '').trim(),
        mid_label: (r.mid_label ?? '').trim(),
        high_label: (r.high_label ?? '').trim(),
    };
}

/** v0.1.355 — Las opciones a ordenar de un campo de texto (sin repetir ni vacías). */
export function rankingTextOptions(options: readonly string[]): string[] {
    const out: string[] = [];
    for (const o of options) {
        const t = o.trim();
        if (t && !out.includes(t)) out.push(t);
    }
    return out.slice(0, FORM_RANKING_MAX_OPTIONS);
}

/** v0.1.355 — Cómo queda un orden en un campo de texto: «1. Precio · 2. Calidad». */
export function formatRankingText(ordered: readonly string[], long: boolean): string {
    return ordered.map((o, i) => `${i + 1}. ${o}`).join(long ? '\n' : ' · ');
}

/**
 * v0.1.355 — Lo que se guarda en una fila de matriz al elegir una columna.
 * En una selección, la opción cuyo valor o nombre coincide con la columna
 * (sin importar mayúsculas); en un número, el número de la columna si el
 * campo lo acepta. null = esa columna no sirve para esa fila.
 */
export function matrixCellValue(
    field: { type: string; config: Record<string, unknown> },
    column: { value: string; label?: string },
): string | number | null {
    const norm = (v: string): string => v.trim().toLowerCase();
    if (field.type === 'select' || field.type === 'multi_select') {
        const opts = optionsOf(field);
        if (opts.length === 0) return column.value;
        const exact = opts.find((o) => o.value === column.value);
        if (exact) return exact.value;
        const keys = [norm(column.value), norm(column.label ?? '')].filter(Boolean);
        const byName = opts.find((o) => keys.includes(norm(o.label)) || keys.includes(norm(o.value)));
        return byName ? byName.value : null;
    }
    const n = Number(column.value.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    if (field.type === 'rating') {
        const max = clamp(Math.round(cfgNum(field.config, 'max') ?? 5), 1, 10);
        return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
    }
    if (field.type === 'percent') return n >= 0 && n <= 100 ? n : null;
    if (field.type === 'number') {
        const min = cfgNum(field.config, 'min');
        const max = cfgNum(field.config, 'max');
        if (min !== undefined && n < min) return null;
        if (max !== undefined && n > max) return null;
        return n;
    }
    return null;
}

function isMatrixRowType(type: string): boolean {
    return (FORM_MATRIX_ROW_TYPES as readonly string[]).includes(type);
}

function publicField(
    item: FormFieldItem,
    field: FormFieldLike,
    teamOptions: readonly PublicFormOption[],
    opts: PublicFormItemsOptions,
    byId: Map<number, FormFieldLike>,
): PublicFormFieldItem {
    const cfg = field.config;
    const type = field.type as FormFieldType;
    // C1 — un campo «Equipo» se elige entre los equipos de la empresa (sólo
    // viajan su id y su nombre, y sólo si el formulario lo pregunta).
    const baseOptions =
        type === 'select' || type === 'multi_select' ? optionsOf(field) : type === 'team' ? [...teamOptions] : undefined;
    // v0.1.351 — la imagen de cada opción (sólo las que están en el formulario).
    const options = baseOptions?.map((o) => {
        const fid = item.option_images[o.value];
        const url = fid !== undefined && opts.imageUrl ? opts.imageUrl(fid) : null;
        return url ? { ...o, image_url: url } : o;
    });
    const multiple = type === 'multi_select' || (type === 'team' && cfg.multiple === true);
    let shown = effectiveFormDisplay(item.display, type, multiple, opts.basicDisplays === true);
    // v0.1.355 — ordenar necesita al menos dos opciones.
    const rankingOptions: PublicFormOption[] | undefined =
        shown !== 'ranking'
            ? undefined
            : type === 'multi_select'
              ? (options ?? []).map((o) => ({ value: o.value, label: o.label }))
              : rankingTextOptions(item.ranking_options).map((o) => ({ value: o, label: o }));
    if (shown === 'ranking' && (rankingOptions?.length ?? 0) < 2) shown = 'auto';

    const themeStyle = opts.choiceStyle ?? 'list';
    let display: PublicFormFieldItem['display'];
    switch (shown) {
        case 'search':
        case 'scale':
        case 'slider':
        case 'yes_no':
        case 'signature':
        case 'ranking':
            display = shown;
            break;
        default:
            display = multiple
                ? 'checkboxes'
                : shown === 'dropdown'
                  ? 'dropdown'
                  : shown === 'auto' && (options?.length ?? 0) > 6
                    ? 'dropdown'
                    : 'radio';
    }
    const choice_style: PublicChoiceStyle =
        shown === 'buttons' || shown === 'cards' ? shown : shown === 'radio' ? 'list' : themeStyle;
    const config: PublicFormFieldItem['config'] = {};
    const max_files = cfgNum(cfg, 'max_files');
    const max = cfgNum(cfg, 'max');
    const min = cfgNum(cfg, 'min');
    const precision = cfgNum(cfg, 'precision');
    const max_length = cfgNum(cfg, 'max_length');
    if (max_files !== undefined) config.max_files = max_files;
    if (max !== undefined) config.max = max;
    if (min !== undefined) config.min = min;
    if (precision !== undefined) config.precision = precision;
    if (max_length !== undefined) config.max_length = max_length;
    if (typeof cfg.currency === 'string') config.currency = cfg.currency;
    if (typeof cfg.default_country === 'string') config.default_country = cfg.default_country;
    if (type === 'file') {
        const accept = shown === 'signature' ? 'images' : item.accept;
        config.accept = formAcceptAttribute(accept);
        config.accept_label = FORM_FILE_ACCEPT_INFO[accept].label;
        if (shown === 'signature') config.max_files = 1;
    }
    const out: PublicFormFieldItem = {
        id: item.id,
        type: 'field',
        key: String(field.id),
        slug: field.slug,
        field_type: type,
        label: item.label.trim() || field.label,
        help: item.help.trim() || (field.description ?? ''),
        placeholder: item.placeholder,
        required: (item.required || field.is_required) && !item.hidden,
        hidden: item.hidden,
        display,
        choice_style,
        columns: item.columns,
        width: item.width,
        hide_label: item.hide_label,
        ...(options ? { options } : {}),
        config,
        show_if: item.show_if,
    };
    if (multiple) out.multiple = true;
    if (shown === 'scale' || shown === 'slider') out.range = resolveFormRange(shown, type, cfg, item.range);
    if (shown === 'yes_no') {
        out.yes_label = item.yes_label.trim() || 'Sí';
        out.no_label = item.no_label.trim() || 'No';
    }
    if (rankingOptions && shown === 'ranking') out.ranking = rankingOptions;
    // v0.1.355 — «Otro»: la opción existe en el campo y el texto va a un campo de texto de la lista.
    if ((type === 'select' || type === 'multi_select') && item.other_option !== null && item.other_field_id !== null && !opts.basicDisplays) {
        const target = byId.get(item.other_field_id);
        if (target && (target.type === 'text' || target.type === 'long_text') && (options ?? []).some((o) => o.value === item.other_option)) {
            out.other = {
                value: item.other_option,
                key: String(target.id),
                placeholder: item.other_placeholder.trim() || '¿Cuál?',
            };
        }
    }
    return out;
}

/** v0.1.355 — La matriz pública: filas con su campo y lo que guarda cada columna. */
function publicMatrix(item: FormMatrixItem, byId: Map<number, FormFieldLike>): PublicFormMatrixItem | null {
    const rowFields = item.rows.flatMap((r) => {
        const f = byId.get(r.field_id);
        return f && isMatrixRowType(f.type) ? [{ row: r, field: f }] : [];
    });
    if (rowFields.length === 0 || item.columns.length < 2) return null;
    // Todas las filas eligen una o todas eligen varias (como la primera).
    const multiple = rowFields[0]!.field.type === 'multi_select';
    const rows = rowFields
        .filter(({ field }) => (field.type === 'multi_select') === multiple)
        .map(({ row, field }) => ({
            key: String(field.id),
            field_id: field.id,
            slug: field.slug,
            label: row.label.trim() || field.label,
            field_type: field.type,
            values: item.columns.map((c) => matrixCellValue(field, c)),
        }));
    return {
        id: item.id,
        type: 'matrix',
        label: item.label.trim(),
        help: item.help.trim(),
        required: item.required,
        multiple,
        columns: item.columns.map((c) => ({ label: c.label.trim() || c.value })),
        rows,
        show_if: item.show_if,
    };
}

export interface PublicFormItemsOptions {
    /** v0.1.351 — URL pública (firmada) de un archivo de la empresa; null = no se puede. */
    imageUrl?: (fileId: number) => string | null;
    /** Estilo de las opciones del tema (cuando la pregunta no elige uno). */
    choiceStyle?: PublicChoiceStyle;
    /**
     * v0.1.355 — Sólo las formas de las opciones (lista, botones, tarjetas,
     * desplegable): la página de la agenda no dibuja las demás.
     */
    basicDisplays?: boolean;
}

/**
 * Lo que viaja al visitante: sólo las preguntas, nada del resto de la lista.
 * La usan la página pública Y la vista previa del constructor — lo que se ve
 * al diseñar es, por construcción, lo que ve quien lo completa.
 */
export function buildPublicFormItems(
    config: FormConfig,
    fields: ReadonlyArray<FormFieldLike>,
    /** C1 — los equipos de la empresa (id → nombre) para las preguntas «Equipo». */
    teamOptions: readonly PublicFormOption[] = [],
    opts: PublicFormItemsOptions = {},
): PublicFormItem[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const theme = config.settings?.theme ? readPublicTheme(config.settings.theme) : null;
    const o: PublicFormItemsOptions = { choiceStyle: theme?.choices.style ?? 'list', ...opts };
    const out: PublicFormItem[] = [];
    for (const item of config.items) {
        if (item.type === 'heading' || item.type === 'text') {
            out.push({ id: item.id, type: item.type, text: item.text, show_if: item.show_if });
            continue;
        }
        if (item.type === 'page_break') {
            out.push({ id: item.id, type: 'page_break', title: item.title, show_if: null });
            continue;
        }
        if (item.type === 'image') {
            const url = item.file_id !== null && o.imageUrl ? o.imageUrl(item.file_id) : null;
            out.push({
                id: item.id,
                type: 'image',
                url,
                alt: item.alt,
                caption: item.caption,
                width: item.width,
                max_height: item.max_height,
                show_if: item.show_if,
            });
            continue;
        }
        if (item.type === 'matrix') {
            if (o.basicDisplays) continue;
            const m = publicMatrix(item, byId);
            if (m) out.push(m);
            continue;
        }
        const field = byId.get(item.field_id);
        if (!field || !isFormFieldType(field.type)) continue;
        out.push(publicField(item, field, teamOptions, o, byId));
    }
    return out;
}

/** v0.1.351 — Los archivos (imágenes) que usa un formulario: ítems de imagen e imágenes de opciones. */
/**
 * v0.1.356 — Todos los textos del formulario donde se puede recordar una
 * respuesta con `{{nombre}}`: preguntas, ayudas, títulos, textos, títulos de
 * página, la descripción y las pantallas finales.
 */
export function formRecallTexts(config: FormConfig): string[] {
    const st = config.settings;
    // v0.1.361 — el concepto del cobro también recuerda respuestas («Inscripción de {{nombre}}»).
    const out: string[] = [st.title, st.description, st.success_title, st.success_message, st.welcome.title, st.welcome.message, st.payment.title];
    for (const e of st.endings) out.push(e.title, e.message);
    for (const i of config.items) {
        if (i.type === 'field') out.push(i.label, i.help);
        else if (i.type === 'matrix') out.push(i.label, i.help);
        else if (i.type === 'heading' || i.type === 'text') out.push(i.text);
        else if (i.type === 'page_break') out.push(i.title);
        else if (i.type === 'image') out.push(i.caption);
    }
    return out.filter((t) => typeof t === 'string' && t.includes('{{'));
}

/**
 * v0.1.356 — `{{nombre}}` → la clave (id del campo) de esa respuesta, sólo
 * para los nombres que aparecen en algún texto y que el formulario pregunta
 * (una pregunta, una oculta que se completa desde la dirección, una fila de
 * una matriz o lo escrito en un «Otro»). Nada más de la lista viaja.
 */
export function formRecallMap(config: FormConfig, fields: ReadonlyArray<{ id: number; slug: string }>): Record<string, string> {
    const asked = new Set<number>();
    for (const i of config.items) {
        if (i.type === 'field') {
            asked.add(i.field_id);
            if (i.other_field_id) asked.add(i.other_field_id);
        } else if (i.type === 'matrix') for (const r of i.rows) asked.add(r.field_id);
    }
    const bySlug = new Map(fields.map((f) => [f.slug, f.id]));
    const out: Record<string, string> = {};
    const re = /\{\{\s*([a-z][a-z0-9_]{0,62})\s*(?:\|[^{}]{0,80})?\}\}/g;
    // v0.1.357 — `{{puntaje}}` de un cálculo (su nombre nunca choca con el de un campo: el servidor lo cuida).
    const calcKeys = new Set(config.settings.calcs.map((c) => c.key));
    for (const t of formRecallTexts(config)) {
        for (const m of t.matchAll(re)) {
            const id = bySlug.get(m[1]!);
            if (id !== undefined && asked.has(id)) out[m[1]!] = String(id);
            else if (calcKeys.has(m[1]!) && id === undefined) out[m[1]!] = FORM_CALC_VALUE_PREFIX + m[1]!;
        }
    }
    return out;
}

/**
 * v0.1.357 — Los textos que se ven MIENTRAS se responde (no los del final):
 * si un cálculo aparece en alguno, la página lo tiene que poder hacer.
 */
export function formLiveTexts(config: FormConfig): string[] {
    const st = config.settings;
    const out: string[] = [st.title, st.description, st.welcome.title, st.welcome.message];
    for (const i of config.items) {
        if (i.type === 'field') out.push(i.label, i.help);
        else if (i.type === 'heading' || i.type === 'text') out.push(i.text);
        else if (i.type === 'page_break') out.push(i.title);
        else if (i.type === 'image') out.push(i.caption);
        else if (i.type === 'matrix') out.push(i.label, i.help);
    }
    return out.filter((t) => typeof t === 'string' && t.includes('{{'));
}

/**
 * v0.1.361 — ¿El formulario cobra al enviar? Sí si está encendido, tiene una
 * conexión y el monto sale de algo que existe (un monto fijo mayor a cero, un
 * cálculo del formulario o una pregunta del formulario).
 */
export function formPaymentActive(config: FormConfig): boolean {
    // v0.1.368 — un formulario que suscribe no cobra además una vez.
    if (formSubscriptionActive(config)) return false;
    const p = config.settings.payment;
    if (!p.enabled || p.connection_id === null) return false;
    if (p.source === 'fixed') return p.amount !== null && p.amount > 0;
    if (p.source === 'calc') return p.calc_key !== null && config.settings.calcs.some((c) => c.key === p.calc_key);
    return p.field_id !== null && config.items.some((i) => i.type === 'field' && i.field_id === p.field_id);
}


/**
 * v0.1.368 — ¿El formulario suscribe al enviar? Sí si está encendido, ofrece
 * al menos un plan y sabe de qué pregunta sale el correo (Mercado Pago lo pide).
 */
export function formSubscriptionActive(config: FormConfig): boolean {
    const s = config.settings.subscription;
    if (!s.enabled || s.plan_ids.length === 0) return false;
    const emailId = config.settings.respondent_email_field_id;
    return emailId !== null && config.items.some((i) => i.type === 'field' && i.field_id === emailId);
}

/**
 * v0.1.357 — ¿La página necesita hacer este cálculo mientras se responde? Sí
 * si un salto lo mira o un texto de las preguntas lo muestra. Si no, el
 * resultado lo da el servidor al enviar (y lo que vale cada respuesta no
 * queda escrito en la página: el puntaje de una evaluación no se ve antes).
 */
export function formCalcIsLive(config: FormConfig, key: string): boolean {
    if (config.settings.jumps.some((j) => formConditionCalcKeys(j.when).includes(key))) return true;
    // v0.1.361 — el cálculo que da el monto a pagar se muestra antes de enviar.
    const pay = config.settings.payment;
    if (pay.enabled && pay.source === 'calc' && pay.calc_key === key) return true;
    return formLiveTexts(config).some((t) => formRecallSlugs(t).includes(key));
}

/**
 * v0.1.357 — Cuánto toma responder el formulario, en minutos («Toma unos 3
 * minutos»): unos segundos por pregunta, más los textos largos, los archivos,
 * la firma, ordenar y cada fila de una matriz. Las ocultas no cuentan.
 */
export function formEstimateMinutes(config: FormConfig): number {
    let seconds = 0;
    for (const i of config.items) {
        if (i.type === 'matrix') seconds += 6 + i.rows.length * 6;
        else if (i.type === 'field' && !i.hidden) {
            const d = i.display;
            seconds += d === 'signature' || d === 'ranking' ? 25 : d === 'scale' || d === 'yes_no' || d === 'slider' ? 6 : 12;
        }
    }
    return Math.max(1, Math.round(seconds / 60));
}

/** v0.1.357 — Los cálculos del formulario como los hace la lógica pura (`key` de cada parte = id del campo como texto). */
export function formCalcsForLogic(config: FormConfig): FormCalcLike[] {
    return config.settings.calcs.map((c) => ({
        key: c.key,
        start: c.start,
        parts: c.parts.map((p) => ({ key: String(p.field_id), points: p.points, multiplier: p.multiplier })),
    }));
}

export function formConfigFileIds(config: FormConfig): number[] {
    const ids = new Set<number>();
    for (const item of config.items) {
        if (item.type === 'image' && item.file_id !== null) ids.add(item.file_id);
        if (item.type === 'field') for (const id of Object.values(item.option_images)) ids.add(id);
    }
    // v0.1.357 — la imagen de la bienvenida.
    if (config.settings.welcome.file_id !== null) ids.add(config.settings.welcome.file_id);
    // v0.1.369 — el logo propio del formulario.
    if (config.settings.logo_file_id !== null) ids.add(config.settings.logo_file_id);
    return [...ids];
}

