import { describe, expect, it } from 'vitest';

import { resolveEmbed } from './embeds';
import { sanitizeRichDoc, type RichDoc } from './rich-text';

/**
 * Un iframe corre código de otro origen dentro de nuestra página: la puerta se
 * abre por dominio conocido, no por lo que pegue el usuario. Estos tests son
 * la garantía de esa regla.
 */
describe('resolveEmbed', () => {
    it('reconoce las formas de YouTube (watch, corto, shorts, embed)', () => {
        const expected = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
        for (const url of [
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://youtu.be/dQw4w9WgXcQ',
            'https://www.youtube.com/shorts/dQw4w9WgXcQ',
            'https://www.youtube.com/embed/dQw4w9WgXcQ',
            'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
        ]) {
            expect(resolveEmbed(url)).toMatchObject({ provider: 'youtube', src: expected });
        }
    });

    it('reconoce Vimeo, Loom, Figma y Drive/Docs', () => {
        expect(resolveEmbed('https://vimeo.com/123456789')).toMatchObject({
            provider: 'vimeo',
            src: 'https://player.vimeo.com/video/123456789',
        });
        expect(resolveEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef')).toMatchObject({
            provider: 'loom',
            src: 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef',
        });
        expect(resolveEmbed('https://www.figma.com/design/abc123/Tablero')).toMatchObject({
            provider: 'figma',
        });
        expect(resolveEmbed('https://drive.google.com/file/d/1AbCdEfGhIjKlMnO/view')).toMatchObject({
            provider: 'drive',
            src: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnO/preview',
        });
        expect(resolveEmbed('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnO/edit#gid=0')).toMatchObject({
            provider: 'drive',
            src: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnO/preview',
        });
    });

    it('rechaza lo que no está en la lista (incluido el dominio parecido)', () => {
        expect(resolveEmbed('https://evil.com/watch?v=abc')).toBeNull();
        // `youtube.com.evil.com` NO es youtube.com.
        expect(resolveEmbed('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
        expect(resolveEmbed('javascript:alert(1)')).toBeNull();
        expect(resolveEmbed('data:text/html,<script>alert(1)</script>')).toBeNull();
        expect(resolveEmbed('https://www.youtube.com/')).toBeNull(); // sin video
        expect(resolveEmbed(42)).toBeNull();
    });
});

describe('sanitizeRichDoc con bloques de v0.1.135', () => {
    const doc = (content: unknown[]): RichDoc => ({ type: 'doc', content }) as RichDoc;

    it('guarda el embed sólo si el proveedor es conocido', () => {
        const clean = sanitizeRichDoc(
            doc([
                { type: 'embedBlock', attrs: { url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube' } },
                { type: 'embedBlock', attrs: { url: 'https://evil.com/x', provider: 'youtube' } },
                { type: 'embedBlock', attrs: { url: 'javascript:alert(1)' } },
            ]),
        );
        expect(clean?.content).toHaveLength(1);
        expect(clean?.content?.[0]?.attrs).toMatchObject({ provider: 'youtube' });
    });

    it('conserva columnas e índice', () => {
        const clean = sanitizeRichDoc(
            doc([
                {
                    type: 'columnsBlock',
                    content: [
                        { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
                        { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
                    ],
                },
                { type: 'tocBlock' },
            ]),
        );
        expect(clean?.content?.[0]?.type).toBe('columnsBlock');
        expect(clean?.content?.[0]?.content).toHaveLength(2);
        expect(clean?.content?.[1]?.type).toBe('tocBlock');
    });
});
