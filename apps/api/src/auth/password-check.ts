import { HttpException, HttpStatus } from '@nestjs/common';
import * as argon2 from 'argon2';
import type Redis from 'ioredis';

/**
 * SEC-35 (v0.1.239) — Las acciones que piden la contraseña CON la sesión ya
 * abierta (cambiar la contraseña, desactivar el 2FA, borrar la cuenta) no
 * tenían freno: quien se roba una sesión podía probar contraseñas sin límite
 * por ahí — y adivinarla es justo lo que le falta para cambiarla y dejar
 * afuera al dueño. El freno del login es por EMAIL y no aplicaba. Ahora hay un
 * contador por CUENTA (compartido entre nodos): 10 fallos y 15 minutos de
 * espera, igual que el login.
 */
const MAX_FAILS = 10;
const WINDOW_SECONDS = 15 * 60;
const failKey = (userId: number): string => `pwcheckfail:${userId}`;

export async function verifyAccountPassword(
    redis: Redis | undefined,
    userId: number,
    hash: string,
    password: string,
): Promise<boolean> {
    if (redis && Number((await redis.get(failKey(userId)).catch(() => null)) ?? 0) >= MAX_FAILS) {
        throw new HttpException(
            {
                code: 'too_many_attempts',
                message: 'Demasiados intentos con una contraseña incorrecta. Esperá 15 minutos y volvé a probar.',
                data: { status: 429 },
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
    const valid = await argon2.verify(hash, password).catch(() => false);
    if (redis) {
        if (valid) {
            await redis.del(failKey(userId)).catch(() => undefined);
        } else {
            const n = await redis.incr(failKey(userId)).catch(() => 0);
            if (n === 1) await redis.expire(failKey(userId), WINDOW_SECONDS).catch(() => undefined);
        }
    }
    return valid;
}
