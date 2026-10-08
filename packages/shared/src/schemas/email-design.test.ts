import { describe, expect, it } from 'vitest';

import { emailTemplateDesign, EMAIL_TEMPLATES } from '../templates/email-templates';
import {
    emailBodyMode,
    emailDesignSchema,
    emailSignatureHtml,
    formatEmailFieldValue,
    htmlToPlainText,
    parseEmailDesign,
    readableInk,
    renderEmailHtml,
    renderEmailText,
    safeEmailUrl,
} from './email-design';

const values: Record<string, string> = {
    nombre: 'Ana <b>García</b>',
    link: 'https://pagos.example.com/abc?x=1&y=2',
    evil: 'javascript:alert(1)',
};
const resolve = (t: string): string => t.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_m, k: string) => values[k] ?? '');

const design = emailDesignSchema.parse({
    blocks: [
        { id: 'h', type: 'heading', text: 'Hola {{nombre}}' },
        {
            id: 't',
            type: 'text',
            doc: {
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '<script>x</script> {{nombre}}' }] },
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: '{{evil}}' } }] }],
                    },
                ],
            },
        },
        { id: 'b', type: 'button', label: 'Pagar', url: '{{link}}' },
        { id: 'b2', type: 'button', label: 'Malo', url: '{{evil}}' },
        { id: 'c', type: 'columns', columns: [{ blocks: [{ id: 'x', type: 'heading', text: 'A' }] }, { blocks: [] }] },
        { id: 'f', type: 'fields', slugs: ['monto'] },
    ],
});

describe('renderEmailHtml', () => {
    const html = renderEmailHtml(design, {
        resolve,
        fieldLabel: (s) => (s === 'monto' ? 'Monto' : null),
        fieldValue: () => '1.500.000',
        signatureHtml: '<p>Saludos</p><script>alert(1)</script><a href="javascript:x" onclick="y">ok</a>',
        appendSignature: true,
        subject: 'Hola {{nombre}}',
    });

    it('escapa el texto literal y los valores de las variables', () => {
        expect(html).toContain('Hola Ana &lt;b&gt;García&lt;/b&gt;');
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(html).not.toMatch(/<script/i);
    });

    it('arma enlaces sólo con URLs seguras', () => {
        expect(html).toContain('href="https://pagos.example.com/abc?x=1&amp;y=2"');
        expect(html).not.toContain('javascript:');
    });

    it('usa la estructura compatible con Outlook y Gmail', () => {
        expect(html).toContain('<!--[if mso]>');
        expect(html).toContain('role="presentation"');
        expect(html).toContain('bgcolor=');
        expect(html).toContain('class="ib-col"');
        expect(html).not.toMatch(/display:\s*(flex|grid)/);
    });

    it('agrega la firma limpia y el bloque de datos', () => {
        expect(html).toContain('Saludos');
        expect(html).not.toContain('onclick');
        expect(html).toContain('Monto');
        expect(html).toContain('1.500.000');
    });

    it('vista previa: variables como pastillas y bloques seleccionables', () => {
        const pv = renderEmailHtml(design, { resolve, preview: true, selectedId: 'h' });
        expect(pv).toContain('{{nombre}}');
        expect(pv).toContain('data-ib-block="h"');
        expect(pv).toContain('data-ib-selected="1"');
    });
});

describe('renderEmailText', () => {
    it('genera la alternativa en texto plano', () => {
        const text = renderEmailText(design, {
            resolve,
            fieldLabel: () => 'Monto',
            fieldValue: () => '10',
            signatureHtml: '<p>Saludos,<br>Ana</p>',
            appendSignature: true,
        });
        expect(text).toContain('Hola Ana <b>García</b>');
        expect(text).toContain('Pagar: https://pagos.example.com/abc?x=1&y=2');
        expect(text).not.toContain('javascript');
        expect(text).toContain('Monto: 10');
        expect(text).toContain('-- \nSaludos,\nAna');
    });
});

describe('utilidades', () => {
    it('safeEmailUrl', () => {
        expect(safeEmailUrl('https://a.com')).toBe('https://a.com');
        expect(safeEmailUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
        expect(safeEmailUrl('mailto:a@b.com', 'image')).toBeNull();
        expect(safeEmailUrl('javascript:alert(1)')).toBeNull();
        expect(safeEmailUrl('/relativa')).toBeNull();
    });

    it('emailBodyMode respeta las acciones viejas', () => {
        expect(emailBodyMode({ is_html: true })).toBe('html');
        expect(emailBodyMode({})).toBe('text');
        expect(emailBodyMode({ body_mode: 'design', is_html: false })).toBe('design');
    });

    it('readableInk', () => {
        expect(readableInk('#0e7490')).toBe('#ffffff');
        expect(readableInk('#fde68a')).toBe('#111827');
    });

    it('firma sin scripts ni handlers', () => {
        const s = emailSignatureHtml('<p onmouseover="x()">Hola</p><iframe src="x"></iframe><img src="data:x">', 'Arial', {
            text: '#000',
            accent: '#00f',
        });
        expect(s).not.toMatch(/onmouseover|iframe|data:/);
        expect(s).toContain('style="margin:0 0 4px 0;"');
    });

    it('htmlToPlainText conserva los enlaces', () => {
        expect(htmlToPlainText('<p>Hola <a href="https://x.com">sitio</a></p><ul><li>uno</li></ul>')).toBe(
            'Hola sitio (https://x.com)\n\n- uno',
        );
    });

    it('formatEmailFieldValue con el formato de la empresa', () => {
        const fmt = { number_format: 'dot_comma' as const, date_format: 'dmy' as const, time_format: 'h12' as const, timezone: 'America/Bogota' };
        expect(formatEmailFieldValue({ type: 'currency', config: { currency: 'COP', precision: 0 } }, 1500000, fmt)).toBe('COP 1.500.000');
        expect(formatEmailFieldValue({ type: 'date' }, '2026-10-20', fmt)).toBe('20/10/2026');
        expect(formatEmailFieldValue({ type: 'datetime' }, '2026-10-20T14:30:00Z', fmt)).toBe('20/10/2026 9:30 a. m.');
        expect(formatEmailFieldValue({ type: 'select', config: { options: [{ value: 'p', label: 'Pendiente' }] } }, 'p', fmt)).toBe('Pendiente');
        expect(formatEmailFieldValue({ type: 'checkbox' }, false, fmt)).toBe('No');
        expect(formatEmailFieldValue({ type: 'user' }, 3, fmt, (id) => (id === 3 ? 'Ana' : null))).toBe('Ana');
    });

    it('todas las plantillas validan y renderizan', () => {
        for (const t of EMAIL_TEMPLATES) {
            const d = parseEmailDesign(emailTemplateDesign(t.key, '#123456'));
            expect(d, t.key).not.toBeNull();
            expect(renderEmailHtml(d!, { resolve })).toContain('</html>');
        }
        expect(emailTemplateDesign('notice', '#123456').blocks[0]!.background).toBe('#123456');
    });
});
