import { describe, expect, it, vi } from 'vitest';
import { CloudApiError } from './client';
import { isTransientError, withTransientRetry } from './transientRetry';

describe('withTransientRetry (v0.1.238)', () => {
    it('reintenta una vez ante un 5xx, un 502 del proxy o un fetch caído', async () => {
        for (const first of [
            new CloudApiError('Error interno', 500, 'internal_error'),
            new CloudApiError('Error de red', 502, 'network_error'),
            new TypeError('Failed to fetch'),
        ]) {
            const fn = vi.fn().mockRejectedValueOnce(first).mockResolvedValueOnce('ok');
            await expect(withTransientRetry(fn, 0)).resolves.toBe('ok');
            expect(fn).toHaveBeenCalledTimes(2);
        }
    });

    it('no reintenta credenciales malas ni el freno por intentos', async () => {
        for (const err of [
            new CloudApiError('Credenciales inválidas', 401, 'invalid_credentials'),
            new CloudApiError('Demasiados intentos', 429, 'too_many_attempts'),
            // 503 deliberado, con su mensaje: se muestra tal cual.
            new CloudApiError('Este servidor todavía no tiene un correo configurado', 503, 'mail_unavailable'),
        ]) {
            const fn = vi.fn().mockRejectedValue(err);
            await expect(withTransientRetry(fn, 0)).rejects.toBe(err);
            expect(fn).toHaveBeenCalledTimes(1);
        }
    });

    it('reintenta UNA sola vez: el segundo fallo llega al llamador', async () => {
        const err = new CloudApiError('Error interno', 500, 'internal_error');
        const fn = vi.fn().mockRejectedValue(err);
        await expect(withTransientRetry(fn, 0)).rejects.toBe(err);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(isTransientError(err)).toBe(true);
        expect(isTransientError(new Error('otra cosa'))).toBe(false);
    });
});
