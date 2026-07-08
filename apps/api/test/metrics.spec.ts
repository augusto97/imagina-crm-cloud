import { describe, expect, it } from 'vitest';
import { MetricsService } from '../src/observability/metrics.service';

describe('MetricsService', () => {
    it('cuenta requests, errores y lentas; calcula percentiles', () => {
        const m = new MetricsService();
        for (let i = 1; i <= 100; i++) m.record(i, false); // 1..100 ms
        m.record(500, true); // lenta + error
        const s = m.snapshot();
        expect(s.requests_total).toBe(101);
        expect(s.errors_total).toBe(1);
        expect(s.slow_total).toBe(1); // sólo la de 500ms supera SLOW_MS (200)
        // p95 sobre 101 muestras (1..100 + 500): índice alto → cercano al tope.
        expect(s.latency_ms.p95).toBeGreaterThanOrEqual(95);
        expect(s.latency_ms.p99).toBeGreaterThanOrEqual(99);
    });

    it('el buffer circular acota la memoria (window ≤ 1024)', () => {
        const m = new MetricsService();
        for (let i = 0; i < 5000; i++) m.record(10, false);
        const s = m.snapshot();
        expect(s.requests_total).toBe(5000);
        expect(s.latency_ms.window).toBeLessThanOrEqual(1024);
    });
});
