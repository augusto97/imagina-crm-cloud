import { describe, expect, it } from 'vitest';
import { fieldConfigSchemas, parseFieldConfig } from '../schemas/field';
import { buildPublicFormItems, formConfigSchema } from '../schemas/form';
import {
    fileFieldOnlyImages,
    fileThumbWidth,
    isImageFileMime,
    onlyImagesMessage,
} from './file-images';

describe('v0.1.426 — campo «Imagen» (file con only_images)', () => {
    it('la config del campo de archivos acepta only_images y tolera valores raros', () => {
        expect(parseFieldConfig('file', { only_images: true })).toMatchObject({ only_images: true });
        expect(parseFieldConfig('file', { max_files: 3 })).toEqual({ max_files: 3 });
        // Un valor raro no rompe la config: se descarta.
        const odd = fieldConfigSchemas.file.parse({ only_images: 'sí', max_files: 2 });
        expect(odd.only_images).toBeUndefined();
        expect(odd.max_files).toBe(2);
    });

    it('fileFieldOnlyImages: sólo `true` cuenta', () => {
        expect(fileFieldOnlyImages({ only_images: true })).toBe(true);
        expect(fileFieldOnlyImages({ only_images: 'true' })).toBe(false);
        expect(fileFieldOnlyImages({})).toBe(false);
        expect(fileFieldOnlyImages(null)).toBe(false);
        expect(fileFieldOnlyImages('only_images')).toBe(false);
    });

    it('isImageFileMime: png/jpeg/gif/webp/avif sí; svg, heic y pdf no', () => {
        for (const m of ['image/png', 'image/jpeg', 'image/jpg', 'IMAGE/WEBP', 'image/gif', 'image/avif', 'image/png; charset=binary']) {
            expect(isImageFileMime(m)).toBe(true);
        }
        for (const m of ['image/svg+xml', 'image/heic', 'image/bmp', 'application/pdf', '', null, 42]) {
            expect(isImageFileMime(m)).toBe(false);
        }
    });

    it('fileThumbWidth: sólo los anchos de la lista', () => {
        expect(fileThumbWidth('160')).toBe(160);
        expect(fileThumbWidth(96)).toBe(96);
        expect(fileThumbWidth('150')).toBeNull();
        expect(fileThumbWidth('')).toBeNull();
        expect(fileThumbWidth(undefined)).toBeNull();
        expect(fileThumbWidth('abc')).toBeNull();
    });

    it('el mensaje nombra el campo y los formatos', () => {
        expect(onlyImagesMessage('Foto')).toBe('En «Foto» sólo se pueden subir imágenes (PNG, JPG, GIF, WebP o AVIF).');
    });

    it('en un formulario público, la pregunta de un campo «Imagen» sólo acepta imágenes', () => {
        const c = formConfigSchema.parse({ items: [{ id: 'aaaa1', type: 'field', field_id: 7 }, { id: 'aaaa2', type: 'field', field_id: 8 }], settings: {} });
        const items = buildPublicFormItems(c, [
            { id: 7, slug: 'foto', label: 'Foto', type: 'file', config: { only_images: true }, is_required: false },
            { id: 8, slug: 'adjunto', label: 'Adjunto', type: 'file', config: {}, is_required: false },
        ]);
        const [foto, adjunto] = items as Array<{ config: { accept?: string; accept_label?: string } }>;
        expect(foto?.config.accept).toBe('.png,.jpg,.jpeg,.gif,.webp,.avif');
        expect(foto?.config.accept_label).toContain('Imágenes');
        // Un campo de archivos común sigue aceptando lo que diga la pregunta.
        expect(adjunto?.config.accept).toBe('');
    });
});
