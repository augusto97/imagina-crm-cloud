import { describe, expect, it } from 'vitest';
import { applyMergeTags } from '../src/automations/merge-tags';

const fv = (values: Record<string, unknown>) => (slug: string) => values[slug];

describe('applyMergeTags — modificadores de fecha (|+1m|-1d)', () => {
    it('el caso de facturación: período anticipado y vencido', () => {
        const v = fv({ 'before.proximo_cobro': '2026-07-16' });
        // Anticipado: 16/07 → 15/08
        expect(applyMergeTags('{{before.proximo_cobro}}', v, null)).toBe('2026-07-16');
        expect(applyMergeTags('{{before.proximo_cobro|+1m|-1d}}', v, null)).toBe('2026-08-15');
        // Vencido: 16/06 → 15/07
        expect(applyMergeTags('{{before.proximo_cobro|-1m}}', v, null)).toBe('2026-06-16');
        expect(applyMergeTags('{{before.proximo_cobro|-1d}}', v, null)).toBe('2026-07-15');
    });

    it('meses con clamp al último día y cruce de año', () => {
        const v = fv({ f: '2026-01-31', dic: '2026-12-16', ene: '2026-01-10' });
        expect(applyMergeTags('{{f|+1m}}', v, null)).toBe('2026-02-28'); // clamp
        expect(applyMergeTags('{{dic|+1m}}', v, null)).toBe('2027-01-16'); // cruza año
        expect(applyMergeTags('{{ene|-1m}}', v, null)).toBe('2025-12-10'); // hacia atrás cruza año
        expect(applyMergeTags('{{f|+1y}}', v, null)).toBe('2027-01-31');
    });

    it('días con overflow de mes y datetime preserva la hora', () => {
        const v = fv({ f: '2026-07-31', dt: '2026-07-16 10:30:00' });
        expect(applyMergeTags('{{f|+1d}}', v, null)).toBe('2026-08-01');
        expect(applyMergeTags('{{dt|-1d}}', v, null)).toBe('2026-07-15 10:30:00');
    });

    it('valores no-fecha ignoran los modificadores; sin modificadores todo sigue igual', () => {
        const v = fv({ nombre: 'ACME', monto: 350000 });
        expect(applyMergeTags('{{nombre|+1m}}', v, null)).toBe('ACME');
        expect(applyMergeTags('Hola {{nombre}}: {{monto}}', v, null)).toBe('Hola ACME: 350000');
        expect(applyMergeTags('{{record.id}}', v, 42)).toBe('42');
    });
});
