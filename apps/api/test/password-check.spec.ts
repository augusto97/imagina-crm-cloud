import * as argon2 from 'argon2';
import type Redis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { verifyAccountPassword } from '../src/auth/password-check';

/** Redis en memoria con lo que usa el freno. */
class FakeRedis {
    private kv = new Map<string, number>();
    get(k: string) {
        return Promise.resolve(this.kv.has(k) ? String(this.kv.get(k)) : null);
    }
    incr(k: string) {
        this.kv.set(k, (this.kv.get(k) ?? 0) + 1);
        return Promise.resolve(this.kv.get(k)!);
    }
    expire() {
        return Promise.resolve(1);
    }
    del(k: string) {
        this.kv.delete(k);
        return Promise.resolve(1);
    }
}

/**
 * SEC-35 (v0.1.239) — con una sesión robada no se pueden probar contraseñas
 * sin límite por "cambiar contraseña", "desactivar 2FA" o "borrar la cuenta".
 */
describe('verifyAccountPassword (freno por cuenta)', () => {
    it('10 fallos bloquean la cuenta 15 min — incluso con la contraseña correcta', async () => {
        const redis = new FakeRedis() as unknown as Redis;
        const hash = await argon2.hash('la-correcta-123');
        for (let i = 0; i < 10; i++) {
            expect(await verifyAccountPassword(redis, 7, hash, `mala-${i}`)).toBe(false);
        }
        await expect(verifyAccountPassword(redis, 7, hash, 'la-correcta-123')).rejects.toMatchObject({
            status: 429,
            response: expect.objectContaining({ code: 'too_many_attempts' }),
        });
        // El contador es por cuenta: otra persona no queda frenada.
        expect(await verifyAccountPassword(redis, 8, hash, 'la-correcta-123')).toBe(true);
    });

    it('un acierto limpia los fallos previos', async () => {
        const redis = new FakeRedis() as unknown as Redis;
        const hash = await argon2.hash('ok-pass-123');
        for (let i = 0; i < 9; i++) await verifyAccountPassword(redis, 1, hash, 'mala');
        expect(await verifyAccountPassword(redis, 1, hash, 'ok-pass-123')).toBe(true);
        for (let i = 0; i < 9; i++) await verifyAccountPassword(redis, 1, hash, 'mala');
        expect(await verifyAccountPassword(redis, 1, hash, 'ok-pass-123')).toBe(true);
    });
});
