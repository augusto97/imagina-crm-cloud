// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { WhatsNewRichText } from './WhatsNewRichText';

const html = (text: string): string =>
    render(
        <MemoryRouter>
            <WhatsNewRichText text={text} />
        </MemoryRouter>,
    ).container.innerHTML;

describe('cuerpo de una novedad (formato sencillo, nunca HTML crudo)', () => {
    afterEach(cleanup);

    it('negrita, viñetas y enlaces seguros', () => {
        const out = html('**Cómo activarlo**\n\n- Abre [Ajustes](/settings?s=avisos).\n- Lee la [guía](https://ejemplo.com/guia).');
        expect(out).toContain('<strong');
        expect(out).toContain('<ul');
        expect(out).toContain('href="/settings?s=avisos"');
        expect(out).toContain('href="https://ejemplo.com/guia"');
        expect(out).toContain('rel="noopener noreferrer"');
    });

    it('el HTML se ve como texto y los enlaces peligrosos no son enlaces', () => {
        const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> [a](javascript:alert(1)) [b](http://inseguro.test) [c](//otro.test/x)');
        expect(out).not.toContain('<script');
        expect(out).not.toContain('<img');
        expect(out).toContain('&lt;script&gt;');
        expect(out).not.toMatch(/href="javascript/i);
        expect(out).not.toContain('href="http://');
        expect(out).not.toContain('href="//');
    });

    it('vacío no dibuja nada', () => {
        expect(html('   ')).toBe('');
    });
});
