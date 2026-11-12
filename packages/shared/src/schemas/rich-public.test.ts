import { describe, expect, it } from 'vitest';
import { publicLinkHref, publicRichDoc, richDocImageFileIds } from './rich-public';
import type { RichNode } from './rich-text';

const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content });
const p = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });
const t = (text: string, marks?: RichNode['marks']): RichNode => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const opts = { imageKey: (id: number) => (id === 7 ? `img/f7` : null) };

describe('v0.1.420 — publicRichDoc (la descripción para afuera)', () => {
    it('conserva texto con formato, títulos, listas y tablas', () => {
        const out = publicRichDoc(
            doc(
                { type: 'heading', attrs: { level: 2 }, content: [t('Qué incluye')] },
                p(t('Asesoría '), t('personalizada', [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#ff0000' } }])),
                { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Uno'))] }] },
                { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [p(t('Celda'))] }] }] },
            ),
            opts,
        );
        expect(out?.content?.map((n) => n.type)).toEqual(['heading', 'paragraph', 'bulletList', 'table']);
        expect(out?.content?.[0]?.attrs).toEqual({ level: 2 });
        expect(out?.content?.[1]?.content?.[1]?.marks).toEqual([{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#ff0000' } }]);
        expect(out?.content?.[3]?.content?.[0]?.content?.[0]?.attrs).toEqual({ colspan: 2 });
    });

    it('lo interno no sale: menciones a personas o equipos, adjuntos, índice', () => {
        const out = publicRichDoc(
            doc(
                p(t('Hola '), { type: 'mentionUser', attrs: { id: 3, label: 'Ana Pérez' } }, { type: 'mentionTeam', attrs: { id: 2, label: 'Ventas' } }),
                { type: 'fileBlock', attrs: { fileId: 9, name: 'costos.xlsx' } },
                { type: 'tocBlock' },
                p({ type: 'mentionRecord', attrs: { id: 4, label: 'Plan Pro' } }),
            ),
            opts,
        );
        const json = JSON.stringify(out);
        expect(json).not.toContain('Ana');
        expect(json).not.toContain('Ventas');
        expect(json).not.toContain('costos');
        expect(json).toContain('Plan Pro');
    });

    it('imágenes: sólo las que la tienda sirve, con su clave; un video queda como enlace', () => {
        const out = publicRichDoc(
            doc(
                { type: 'imageBlock', attrs: { fileId: 7, alt: 'Foto', src: 'https://evil.example/x.png' } },
                { type: 'imageBlock', attrs: { fileId: 8 } },
                { type: 'imageBlock', attrs: { src: 'https://cdn.example/y.png' } },
                { type: 'embedBlock', attrs: { url: 'https://www.youtube.com/watch?v=abc', provider: 'youtube' } },
            ),
            opts,
        );
        expect(out?.content?.[0]).toEqual({ type: 'image', attrs: { src: 'img/f7', alt: 'Foto' } });
        expect(out?.content).toHaveLength(2);
        expect(out?.content?.[1]?.content?.[0]?.marks?.[0]).toEqual({ type: 'link', attrs: { href: 'https://www.youtube.com/watch?v=abc' } });
    });

    it('enlaces y colores peligrosos se caen', () => {
        const out = publicRichDoc(
            doc(
                p(
                    t('a', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
                    t('b', [{ type: 'link', attrs: { href: '/relativa' } }]),
                    t('c', [{ type: 'textStyle', attrs: { color: 'red;background:url(x)' } }]),
                ),
            ),
            opts,
        );
        for (const n of out?.content?.[0]?.content ?? []) expect(n.marks).toBeUndefined();
        expect(publicLinkHref('mailto:ventas@acme.co')).toBe('mailto:ventas@acme.co');
        expect(publicLinkHref('https://acme.co/x y')).toBeNull();
    });

    it('vacío o sólo espacios = null; techo de nodos', () => {
        expect(publicRichDoc(null, opts)).toBeNull();
        expect(publicRichDoc(doc(p(t('   '))), opts)).toBeNull();
        expect(publicRichDoc(doc({ type: 'bulletList', content: [] }), opts)).toBeNull();
        const big = doc(...Array.from({ length: 50 }, (_, i) => p(t(`línea ${i}`))));
        expect(publicRichDoc(big, { ...opts, maxNodes: 20 })?.content?.length).toBeLessThan(20);
    });

    it('richDocImageFileIds encuentra las imágenes a cualquier profundidad', () => {
        const d = doc({ type: 'columnsBlock', content: [{ type: 'column', content: [{ type: 'imageBlock', attrs: { fileId: 5 } }] }] }, { type: 'imageBlock', attrs: { fileId: 5 } });
        expect(richDocImageFileIds(d)).toEqual([5]);
    });
});
