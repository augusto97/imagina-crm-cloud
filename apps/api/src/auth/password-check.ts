import { HttpException, HttpStatus } from '@nestjs/common';
import { incrWithTtl } from '../redis/redis.util';
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
export const passwordCheckFailKey = (userId: number): string => `pwcheckfail:${userId}`;
const failKey = passwordCheckFailKey;

export async function verifyAccountPassword(
    redis: Redis | undefined,
    userId: number,
    hash: string,
    password: string,
): Promise<boolean> {
    // El intento se CUENTA antes de verificar (y se borra si la contraseña era
    // buena). Leer el contador, verificar y recién después sumar dejaba pasar
    // una ráfaga entera: todos los pedidos en vuelo leían el mismo número.
    const n = redis ? await incrWithTtl(redis, failKey(userId), WINDOW_SECONDS).catch(() => 0) : 0;
    if (n > MAX_FAILS) {
        throw new HttpException(
            {
                code: 'too_many_attempts',
                message: 'Demasiados intentos con una contraseña incorrecta. Espera 15 minutos y vuelve a probar.',
                data: { status: 429 },
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
    const valid = await argon2.verify(hash, password).catch(() => false);
    if (redis && valid) await redis.del(failKey(userId)).catch(() => undefined);
    return valid;
}
