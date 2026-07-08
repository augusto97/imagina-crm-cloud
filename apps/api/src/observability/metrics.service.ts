import { Injectable } from '@nestjs/common';

/**
 * Métricas en memoria (sin dependencias): contadores de request + un buffer
 * circular de latencias recientes para p50/p95. Suficiente para un `/metrics`
 * de observabilidad básica; en producción se complementa con pg_stat_statements
 * (STANDALONE §12) y scraping externo.
 */
@Injectable()
export class MetricsService {
    private total = 0;
    private errors = 0;
    private slow = 0;
    private readonly startedAt = Date.now();
    private readonly latencies: number[] = [];
    private cursor = 0;
    private static readonly WINDOW = 1024;
    /** Umbral de "request lenta" (ms) — se loguea y se cuenta aparte. */
    static readonly SLOW_MS = 200;

    record(durationMs: number, isError: boolean): void {
        this.total += 1;
        if (isError) this.errors += 1;
        if (durationMs > MetricsService.SLOW_MS) this.slow += 1;
        // Buffer circular: O(1), memoria acotada.
        if (this.latencies.length < MetricsService.WINDOW) {
            this.latencies.push(durationMs);
        } else {
            this.latencies[this.cursor] = durationMs;
            this.cursor = (this.cursor + 1) % MetricsService.WINDOW;
        }
    }

    snapshot(): {
        uptime_s: number;
        requests_total: number;
        errors_total: number;
        slow_total: number;
        latency_ms: { p50: number; p95: number; p99: number; window: number };
    } {
        const sorted = [...this.latencies].sort((a, b) => a - b);
        const pct = (q: number): number => {
            if (sorted.length === 0) return 0;
            const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
            return Math.round(sorted[idx]! * 100) / 100;
        };
        return {
            uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
            requests_total: this.total,
            errors_total: this.errors,
            slow_total: this.slow,
            latency_ms: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), window: sorted.length },
        };
    }
}
