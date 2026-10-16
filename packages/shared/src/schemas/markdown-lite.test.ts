import { describe, expect, it } from 'vitest';
import { markdownToRichDoc, richDocToMarkdown } from './markdown-lite';
import { sanitizeRichDoc } from './rich-text';

describe('v0.1.281 — texto con formato sencillo ⇄ árbol del editor', () => {
    it('párrafos, saltos de línea y marcas en línea', () => {
        const doc = markdownToRichDoc('Hola **{{nombre}}**, ¿cómo estás?\nTe escribimos por *tu pedido*.\n\nVer [el estado](https://acme.co/p/{{record.id}}) ~~viejo~~');
        expect(doc.content).toHaveLength(2);
        const p1 = doc.content![0]!;
        expect(p1.type).toBe('paragraph');
        expect(p1.content!.map((n) => n.type)).toEqual(['text', 'text', 'text', 'hardBreak', 'text', 'text', 'text']);
        expect(p1.content![1]).toEqual({ type: 'text', text: '{{nombre}}', marks: [{ type: 'bold' }] });
        const link = doc.content![1]!.content!.find((n) => n.marks?.some((m) => m.type === 'link'));
        expect(link?.marks?.[0]?.attrs?.href).toBe('https://acme.co/p/{{record.id}}');
        // Sobrevive a la whitelist del servidor sin perder nada.
        expect(sanitizeRichDoc(doc)).toEqual(doc);
    });

    it('las variables son texto literal: un _ o un * adentro no abre una marca', () => {
        const doc = markdownToRichDoc('Cliente: {{nombre_cliente}} y {{valor|pesos}} *nota*');
        const texts = doc.content![0]!.content!;
        expect(texts[0]).toEqual({ type: 'text', text: 'Cliente: {{nombre_cliente}} y {{valor|pesos}} ' });
        expect(texts[1]).toEqual({ type: 'text', text: 'nota', marks: [{ type: 'italic' }] });
    });

    it('títulos, viñetas, numeradas, cita y línea', () => {
        const doc = markdownToRichDoc('## Resumen\n- uno\n- **dos**\n\n3. tres\n4. cuatro\n\n> Gracias\n> por todo\n\n---');
        expect(doc.content!.map((n) => n.type)).toEqual(['heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule']);
        expect(doc.content![0]!.attrs).toEqual({ level: 2 });
        expect(doc.content![1]!.content).toHaveLength(2);
        expect(doc.content![2]!.attrs).toEqual({ start: 3 });
    });

    it('ida y vuelta: lo que se lee se puede volver a mandar igual', () => {
        const src = '## Resumen\n\nHola **{{nombre}}**, ver [aquí](https://acme.co).\n\n- uno\n- dos\n\n1. a\n2. b\n\n> cita\n\n---';
        expect(richDocToMarkdown(markdownToRichDoc(src))).toBe(src);
        expect(richDocToMarkdown(null)).toBe('');
    });

    it('vacío da un documento con un párrafo vacío', () => {
        expect(markdownToRichDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    });
});
