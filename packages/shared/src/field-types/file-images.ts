/**
 * v0.1.426 — El campo «Imagen» y las miniaturas de los archivos.
 *
 * «Imagen» NO es un tipo nuevo: es un campo `file` con `config.only_images`.
 * Un tipo nuevo tocaría ~15 superficies del servidor (filtros, import,
 * export, plantillas, migración…) para lo mismo que ya hace un campo de
 * archivos; con la marca, todo eso sigue igual y sólo cambian el nombre, el
 * ícono, el selector de archivos y la regla «sólo imágenes» al guardar.
 *
 * Imágenes que se aceptan y se achican: PNG, JPG, GIF, WebP y AVIF. Nunca
 * SVG (puede llevar script) ni HEIC/BMP (el navegador no las dibuja, o no se
 * pueden achicar en el servidor).
 */

export const IMAGE_FILE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'] as const;
export type ImageFileMime = (typeof IMAGE_FILE_MIMES)[number];

/** Atributo `accept` del selector de archivos de un campo «Imagen». */
export const IMAGE_FILE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif';
/** Lo mismo por extensión (los formularios públicos filtran por extensión). */
export const IMAGE_FILE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'];
/** Cómo se nombran en los mensajes. */
export const IMAGE_FILE_KINDS_LABEL = 'PNG, JPG, GIF, WebP o AVIF';

/** ¿Un tipo MIME es una de las imágenes que se muestran como miniatura? (sin SVG). */
export function isImageFileMime(mime: unknown): boolean {
    if (typeof mime !== 'string') return false;
    const base = mime.split(';')[0]!.trim().toLowerCase();
    if (base === 'image/jpg' || base === 'image/pjpeg') return true;
    return (IMAGE_FILE_MIMES as readonly string[]).includes(base);
}

/**
 * ¿El campo de archivos es un campo «Imagen»? Lectura tolerante: cualquier
 * config rara (null, texto, `"true"`) cuenta como «no»; sólo `true` vale.
 */
export function fileFieldOnlyImages(config: unknown): boolean {
    return !!config && typeof config === 'object' && (config as { only_images?: unknown }).only_images === true;
}

/** El mensaje cuando a un campo «Imagen» le llega algo que no es una imagen. */
export function onlyImagesMessage(label: string): string {
    return `En «${label}» sólo se pueden subir imágenes (${IMAGE_FILE_KINDS_LABEL}).`;
}

/**
 * Anchos de las miniaturas de los archivos (`/files/:id/signed?…&w=`). Una
 * lista cerrada: así la caché del servidor y la del navegador no se llenan de
 * tamaños sueltos. Otro valor se ignora (se sirve el original).
 */
export const FILE_THUMB_WIDTHS = [96, 160, 320, 640] as const;
export type FileThumbWidth = (typeof FILE_THUMB_WIDTHS)[number];

export function fileThumbWidth(raw: unknown): FileThumbWidth | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return (FILE_THUMB_WIDTHS as readonly number[]).includes(n) ? (n as FileThumbWidth) : null;
}
