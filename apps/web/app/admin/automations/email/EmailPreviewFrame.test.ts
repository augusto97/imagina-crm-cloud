import { describe, expect, it } from 'vitest';
import { EMAIL_DARK_MEDIA } from '@imagina-base/shared';

import { previewHtmlFor } from './EmailPreviewFrame';

describe('previewHtmlFor', () => {
    const html = '<html><head><style>a{}</style></head><body></body></html>';

    it('en claro no toca el HTML', () => {
        expect(previewHtmlFor(html, false)).toBe(html);
    });

    it('con colores propios, el modo oscuro se fuerza para verlo', () => {
        const withDark = html.replace('a{}', `a{}${EMAIL_DARK_MEDIA}{.ib-tx{color:#fff!important;}}`);
        const out = previewHtmlFor(withDark, true);
        expect(out).not.toContain(EMAIL_DARK_MEDIA);
        expect(out).toContain('@media all{.ib-tx');
    });

    it('sin colores propios, simula lo que hacen Gmail/Outlook (invierte los claros)', () => {
        const out = previewHtmlFor(html, true);
        expect(out).toContain('data-ib-sim');
        expect(out).toContain('invert(1)');
    });
});
