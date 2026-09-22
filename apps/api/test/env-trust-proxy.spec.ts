import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env';

/**
 * v0.1.202 — en qué proxy se confía (`TRUST_PROXY`).
 *
 * De este valor salen tres cosas que importan: el IP con el que se limita
 * por tasa, el que se le muestra a la persona en "Dispositivos conectados",
 * y el host del que se deriva el issuer OAuth del MCP (ADR-S21 fase 4).
 * Confiar en TODA la cadena `X-Forwarded-*` —el default histórico— deja que
 * un cliente directo se la invente; verificado contra el API real, un
 * `X-Forwarded-Host: atacante.test` se volvía el issuer.
 */
describe('TRUST_PROXY', () => {
    it('por defecto confía en el proxy LOCAL, que es el despliegue de este repo', () => {
        expect(loadEnv({}).TRUST_PROXY).toBe('loopback');
    });

    it('acepta direcciones y rangos (otra capa por delante)', () => {
        expect(loadEnv({ TRUST_PROXY: 'uniquelocal' }).TRUST_PROXY).toBe('uniquelocal');
        expect(loadEnv({ TRUST_PROXY: '10.0.0.0/8, 172.16.0.0/12' }).TRUST_PROXY).toBe('10.0.0.0/8, 172.16.0.0/12');
    });

    it('conserva `true` / `false` para no romper un .env existente', () => {
        expect(loadEnv({ TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
        expect(loadEnv({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    });

    /**
     * El caso que encontró la verificación: un hop-count parece lo natural
     * ("tengo 1 proxy"), pero desde fastify 5.12 significa NO confiar en
     * nadie — el proxy legítimo dejaría de funcionar en silencio y el
     * issuer OAuth por dominio propio (ADR-S17) se rompería.
     */
    it('un NÚMERO avisa y cae al default en vez de dejar al proxy sin efecto', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(loadEnv({ TRUST_PROXY: '1' }).TRUST_PROXY).toBe('loopback');
        expect(warn.mock.calls.flat().join(' ')).toContain('fastify 5.12');
        warn.mockRestore();
    });
});
