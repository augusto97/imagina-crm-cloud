import { describe, expect, it } from 'vitest';

import {
    FIELD_TYPE_OPTIONS,
    IMAGE_FIELD_KIND,
    fieldKindOf,
    fieldKindPreset,
    fieldTypeLabelOf,
    fieldTypeOptionOf,
} from './fieldTypeCatalog';
import { thumbSources, visibleFileItems, withThumbWidth } from './fileThumbs';

describe('v0.1.426 — miniaturas de archivos', () => {
    const signed = '/api/v1/files/7/signed?tenant=1&exp=1800000000&sig=abc';

    it('withThumbWidth cambia (o agrega) el ancho sin tocar la firma', () => {
        expect(withThumbWidth(`${signed}&w=320`, 96)).toBe(`${signed}&w=96`);
        expect(withThumbWidth(signed, 640)).toBe(`${signed}&w=640`);
        expect(withThumbWidth('/x/signed', 160)).toBe('/x/signed?w=160');
    });

    it('thumbSources arma src y srcset 1x/2x', () => {
        expect(thumbSources(`${signed}&w=320`, 96, 160)).toEqual({
            src: `${signed}&w=96`,
            srcSet: `${signed}&w=96 1x, ${signed}&w=160 2x`,
        });
    });

    it('en la celda: hasta 4 imágenes y «+N»; después de un archivo con nombre se corta', () => {
        const img = (id: number) => ({ id, image: true as boolean | null });
        const doc = (id: number) => ({ id, image: false as boolean | null });
        const pick = (items: Array<{ id: number; image: boolean | null }>) =>
            visibleFileItems(items, (x) => x.image);
        expect(pick([img(1), img(2), img(3), img(4), img(5), img(6)])).toMatchObject({ more: 2 });
        expect(pick([img(1), img(2), img(3), img(4), img(5), img(6)]).shown.map((x) => x.id)).toEqual([1, 2, 3, 4]);
        // Las imágenes van primero: un PDF subido antes no esconde la foto.
        expect(pick([doc(1), img(2), img(3)]).shown.map((x) => x.id)).toEqual([2, 3, 1]);
        expect(pick([img(1), doc(2), img(3)]).shown.map((x) => x.id)).toEqual([1, 3, 2]);
        // En la celda se corta después del primer archivo con nombre; en la ficha, no.
        expect(pick([doc(1), doc(2), img(3)]).shown.map((x) => x.id)).toEqual([3, 1]);
        expect(visibleFileItems([doc(1), doc(2), img(3)], (x) => x.image, 12, { stopAfterNamed: false }).shown.map((x) => x.id)).toEqual([3, 1, 2]);
        // Cargando (null) cuenta como imagen: no salta de lugar cuando llega.
        expect(pick([{ id: 1, image: null }, { id: 2, image: null }]).shown).toHaveLength(2);
    });
});

describe('v0.1.426 — el campo «Imagen» en el catálogo', () => {
    it('es un archivo con only_images: se nombra y se crea aparte', () => {
        expect(fieldKindOf({ type: 'file', config: { only_images: true } })).toBe(IMAGE_FIELD_KIND);
        expect(fieldKindOf({ type: 'file', config: {} })).toBe('file');
        expect(fieldKindOf({ type: 'text', config: { only_images: true } })).toBe('text');
        expect(fieldTypeLabelOf({ type: 'file', config: { only_images: true } })).toBe('Imagen');
        expect(fieldTypeLabelOf({ type: 'file' })).toBe('Archivo');
        expect(fieldKindPreset(IMAGE_FIELD_KIND)).toEqual({ type: 'file', config: { only_images: true } });
        expect(fieldKindPreset('text')).toEqual({ type: 'text', config: {} });
    });

    it('aparece en el catálogo justo antes de «Archivo», con su config', () => {
        const keys = FIELD_TYPE_OPTIONS.map((o) => o.key);
        expect(keys.indexOf(IMAGE_FIELD_KIND)).toBe(keys.indexOf('file') - 1);
        expect(new Set(keys).size).toBe(keys.length);
        expect(fieldTypeOptionOf({ type: 'file', config: { only_images: true } })).toMatchObject({
            key: IMAGE_FIELD_KIND,
            type: 'file',
            label: 'Imagen',
            config: { only_images: true },
        });
    });
});
