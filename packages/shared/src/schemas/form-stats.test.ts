import { describe, expect, it } from 'vitest';

import { formSettingsSchema, submitFormSchema } from './form';
import {
    formStatEventsSchema,
    formStatFields,
    formStatSource,
    formStatSourceLabel,
    formStatsDayRange,
    mergeFormStatCounts,
    saveFormDraftSchema,
    summarizeFormStats,
    type FormStatCounts,
} from './form-stats';

describe('v0.1.358 — estadísticas de formularios', () => {
    it('cada evento suma sus contadores; lo mal formado no suma nada', () => {
        expect(formStatFields({ kind: 'view', src: 'h:google.com', dev: 'mobile' })).toEqual(['v', 'src:h:google.com', 'dev:m']);
        // Un origen con otra forma cuenta como directo, sin inventar claves.
        expect(formStatFields({ kind: 'view', src: 'h:<script>', dev: 'tablet' })).toEqual(['v', 'src:d', 'dev:t']);
        expect(formStatFields({ kind: 'view' })).toEqual(['v', 'src:d', 'dev:d']);
        expect(formStatFields({ kind: 'start' })).toEqual(['s']);
        expect(formStatFields({ kind: 'step', step: 3 })).toEqual(['st:3']);
        expect(formStatFields({ kind: 'step' })).toEqual([]);
        expect(formStatFields({ kind: 'leave', item: 'q1' })).toEqual(['lv:q1']);
        expect(formStatFields({ kind: 'leave' })).toEqual([]);
        expect(formStatEventsSchema.safeParse({ events: [{ kind: 'leave', item: 'q 1' }] }).success).toBe(false);
        expect(formStatEventsSchema.safeParse({ events: [] }).success).toBe(false);
    });

    it('el origen: gana la campaña, después el sitio; la propia app es directo', () => {
        expect(formStatSource({ utm_source: 'Facebook Ads', referrer: 'https://google.com/' })).toBe('u:facebook-ads');
        expect(formStatSource({ utm_source: 'Campaña Verano' })).toBe('u:campana-verano');
        expect(formStatSource({ referrer: 'https://www.google.com/search?q=x' })).toBe('h:google.com');
        expect(formStatSource({ referrer: 'https://l.facebook.com/l.php?u=…' })).toBe('h:facebook.com');
        expect(formStatSource({ referrer: 'https://app.imagina.cloud/lists/3', own_hosts: ['app.imagina.cloud'] })).toBe('d');
        expect(formStatSource({ referrer: '' })).toBe('d');
        expect(formStatSource({ referrer: 'no es una dirección' })).toBe('d');
        expect(formStatSourceLabel('d')).toBe('Directo');
        expect(formStatSourceLabel('u:verano')).toBe('Campaña: verano');
        expect(formStatSourceLabel('h:google.com')).toBe('google.com');
        expect(formStatSourceLabel('u:qr')).toBe('Código QR');
    });

    it('el resumen: totales, tasas, tiempo promedio, pasos, abandonos y días sin datos en cero', () => {
        const rows: Array<{ day: string; counts: FormStatCounts }> = [
            { day: '2026-11-01', counts: { v: 10, s: 6, sub: 3, 'st:1': 6, 'st:2': 4, 'lv:q2': 2, 'src:h:google.com': 7, 'src:d': 3, 'dev:m': 8, 'dev:d': 2, tsum: 300, tn: 3 } },
            { day: '2026-11-03', counts: { v: 5, s: 2, sub: 1, 'st:1': 2, 'lv:q2': 1, 'lv:q5': 4, 'src:d': 5, 'dev:d': 5, tsum: 60, tn: 1 } },
            // Fuera del rango: no cuenta.
            { day: '2026-10-01', counts: { v: 100 } },
        ];
        const out = summarizeFormStats(rows, { from: '2026-11-01', to: '2026-11-03' });
        expect(out.days.map((d) => d.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
        expect(out.days[1]).toEqual({ day: '2026-11-02', views: 0, starts: 0, submits: 0 });
        expect(out.totals).toEqual({ views: 15, starts: 8, submits: 4, start_rate: 8 / 15, completion_rate: 0.5, avg_seconds: 90 });
        expect(out.steps).toEqual([
            { step: 1, reached: 8 },
            { step: 2, reached: 4 },
        ]);
        expect(out.leaves).toEqual([
            { item: 'q5', count: 4 },
            { item: 'q2', count: 3 },
        ]);
        expect(out.sources).toEqual([
            { key: 'd', count: 8 },
            { key: 'h:google.com', count: 7 },
        ]);
        expect(out.devices).toEqual({ mobile: 8, tablet: 0, desktop: 7 });
    });

    it('sin datos: tasas y tiempo en null; los orígenes de más se juntan en «Otros»', () => {
        const empty = summarizeFormStats([], { from: '2026-11-01', to: '2026-11-07' });
        expect(empty.days).toHaveLength(7);
        expect(empty.totals).toEqual({ views: 0, starts: 0, submits: 0, start_rate: null, completion_rate: null, avg_seconds: null });
        const counts: Record<string, number> = {};
        for (let i = 0; i < 14; i++) counts[`src:h:sitio${i}.com`] = 20 - i;
        const many = summarizeFormStats([{ day: '2026-11-01', counts }], { from: '2026-11-01', to: '2026-11-01' });
        expect(many.sources).toHaveLength(11);
        // Los 10 primeros (20…11) y el resto (10 + 9 + 8 + 7) en «Otros».
        expect(many.sources.at(-1)).toEqual({ key: 'o', count: 34 });
    });

    it('mergeFormStatCounts y el rango de días', () => {
        expect(mergeFormStatCounts({ v: 1, s: 2 }, { v: 3, sub: 1, x: Number.NaN })).toEqual({ v: 4, s: 2, sub: 1 });
        expect(formStatsDayRange('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    });

    it('guardar el avance: el ajuste por defecto está apagado y el envío acepta el avance y el tiempo', () => {
        expect(formSettingsSchema.parse({}).save_progress).toEqual({ device: false, email: false });
        // Lo raro de una versión futura no rompe el formulario: vuelve al de siempre.
        expect(formSettingsSchema.parse({ save_progress: 'sí' }).save_progress).toEqual({ device: false, email: false });
        expect(formSettingsSchema.parse({ save_progress: { device: true } }).save_progress).toEqual({ device: true, email: false });
        const ok = submitFormSchema.safeParse({ stamp: 'x', draft: 'a'.repeat(43), elapsed_ms: 12_000 });
        expect(ok.success).toBe(true);
        expect(submitFormSchema.safeParse({ stamp: 'x', draft: 'corto' }).success).toBe(false);
        expect(saveFormDraftSchema.parse({ stamp: 'x', email: ' Ana@Correo.COM ', values: { '12': 'Ana' }, page: 2 }).email).toBe('ana@correo.com');
        expect(saveFormDraftSchema.safeParse({ stamp: 'x', email: 'no-es-correo' }).success).toBe(false);
    });
});
