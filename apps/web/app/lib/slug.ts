/**
 * Helpers TS de slugify y validación. Mantenemos paridad con
 * `ImaginaCRM\Lists\SlugManager::slugify()` y `validateFormat()`.
 */

export const SLUG_REGEX = /^[a-z][a-z0-9_]{0,62}$/;
export const MAX_SLUG_LENGTH = 63;

/**
 * Quita acentos y diacríticos del input. Maneja tanto formas
 * precomposed (NFC, e.g. `ó` = `ó`) como descomposed (NFD,
 * e.g. `ó` = `o` + combining acute). macOS tiende a generar
 * NFD al copiar/pegar, lo que rompía el slugify anterior (basado
 * en regex de chars precomposed) — quedaba `gesti_n_sitio_web`
 * en lugar de `gestion_sitio_web` para "Gestión sitio web".
 *
 * El approach con `normalize('NFD')` + strip de combining marks
 * (`̀-ͯ`) es la forma canónica de transliterar latín-1
 * a ASCII en JS sin librerías externas.
 */
function removeAccents(input: string): string {
    return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function slugify(input: string, maxLength: number = MAX_SLUG_LENGTH): string {
    let s = removeAccents(input).toLowerCase();
    s = s.replace(/[^a-z0-9]+/g, '_');
    s = s.replace(/^_+|_+$/g, '');

    if (s === '') return '';

    if (!/^[a-z]/.test(s)) {
        s = `l_${s}`;
    }

    if (s.length > maxLength) {
        s = s.slice(0, maxLength).replace(/_+$/g, '');
    }

    return s;
}

export interface SlugValidationResult {
    ok: boolean;
    message?: string;
}

export function validateSlugFormat(slug: string): SlugValidationResult {
    if (!slug) return { ok: false, message: 'El slug no puede estar vacío.' };
    if (slug.length > MAX_SLUG_LENGTH) {
        return { ok: false, message: `Máximo ${MAX_SLUG_LENGTH} caracteres.` };
    }
    if (!SLUG_REGEX.test(slug)) {
        return {
            ok: false,
            message: 'Usa snake_case: minúsculas, números y guiones bajos. Debe empezar por letra.',
        };
    }
    return { ok: true };
}
