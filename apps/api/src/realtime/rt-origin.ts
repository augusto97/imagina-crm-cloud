import { AsyncLocalStorage } from 'node:async_hooks';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { RT_ORIGIN_HEADER, RT_ORIGIN_REQUEST, RT_ORIGIN_SYSTEM, RT_TAB_ID_RE, rtTabOrigin } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { Observable, finalize } from 'rxjs';

/**
 * v0.1.461 — De dónde sale cada aviso del realtime (`RtInvalidate.origin`).
 *
 * El origen queda en un contexto asíncrono mientras se atiende un pedido o se
 * corre un trabajo, y `RealtimeService` lo toma de ahí al avisar: así los ~140
 * lugares que avisan no necesitan recibirlo como argumento.
 *
 *  - Un pedido de una pestaña de la app → `tab:<id>` (el id viaja en
 *    `X-Rt-Origin`); un pedido sin pestaña → `request`.
 *  - Un trabajo de una cola → `job:<cola>` (`createWorker` lo envuelve).
 *  - Fuera de todo eso → `system`.
 *
 * El contexto del pedido se CIERRA cuando el controlador termina: lo que siguió
 * corriendo después (un `void promesa`) ya no lo cubre la mutación de la
 * pestaña —que refresca al recibir la respuesta— y tiene que llegarle como un
 * aviso más (`system`).
 */
interface RtOriginScope {
    origin: string;
    open: boolean;
}

const store = new AsyncLocalStorage<RtOriginScope>();

/** El origen de lo que se escribe ahora. */
export function currentRtOrigin(): string {
    const scope = store.getStore();
    return scope && scope.open ? scope.origin : RT_ORIGIN_SYSTEM;
}

/** Corre `fn` con los avisos marcados con `origin` (trabajos de una cola, tests). */
export function withRtOrigin<T>(origin: string, fn: () => T): T {
    return store.run({ origin, open: true }, fn);
}

/** El origen de un pedido según su cabecera `X-Rt-Origin` (un id mal formado no cuenta). */
export function rtOriginOfHeader(raw: unknown): string {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && RT_TAB_ID_RE.test(value) ? rtTabOrigin(value) : RT_ORIGIN_REQUEST;
}

/** Interceptor global: el controlador (y lo que llama) corre con el origen del pedido. */
@Injectable()
export class RtOriginInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() !== 'http') return next.handle();
        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const scope: RtOriginScope = { origin: rtOriginOfHeader(req.headers[RT_ORIGIN_HEADER]), open: true };
        // `next.handle()` se llama ADENTRO del contexto: el controlador corre ahí
        // (igual que `FileBindingInterceptor`). Al terminar, el contexto se cierra.
        return new Observable((subscriber) =>
            store.run(scope, () =>
                next
                    .handle()
                    .pipe(
                        finalize(() => {
                            scope.open = false;
                        }),
                    )
                    .subscribe(subscriber),
            ),
        );
    }
}
