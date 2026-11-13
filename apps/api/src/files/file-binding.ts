import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';

/**
 * v0.1.427 — Las URLs de archivos que arma un pedido CON SESIÓN (la app, el
 * portal del cliente) quedan atadas a esa sesión: sólo las abre el navegador
 * que tiene esa cookie. Copiar la dirección y pegarla en otro lado (otra
 * página, otro navegador, un mensaje) no sirve: sin la sesión, 404.
 *
 * Lo que SÍ es público (la tienda, un formulario, la agenda, una lista o un
 * tablero publicado) no pasa por aquí: sus URLs no llevan sesión porque las ve
 * cualquiera, y quedan protegidas contra el uso desde otros sitios
 * (`common/hotlink.ts`).
 *
 * El interceptor deja la sesión del pedido en un contexto asíncrono y
 * `FilesService.signedUrl` la toma de ahí: así cada servicio que arma URLs
 * para la app o el portal no necesita recibir el request.
 */
const store = new AsyncLocalStorage<string>();

/** La sesión a la que se atan las URLs que se arman ahora (si hay una). */
export function currentFileBinding(): string | undefined {
    return store.getStore();
}

/** Corre `fn` con las URLs de archivos atadas a `token` (tests y tareas internas). */
export function withFileBinding<T>(token: string | undefined, fn: () => T): T {
    return token ? store.run(token, fn) : fn();
}

/**
 * Etiqueta de la sesión que viaja en la URL (`&b=`). Es un resumen: la URL no
 * lleva la sesión ni permite deducirla; el servidor la compara con el resumen
 * de la cookie que llega.
 */
export function sessionBindTag(token: string): string {
    return createHash('sha256').update(`file-bind:${token}`).digest('base64url').slice(0, 22);
}

export const BIND_TAG_RE = /^[A-Za-z0-9_-]{22}$/;

/** Ata las URLs de archivos que arme este controlador a la sesión del pedido. */
@Injectable()
export class FileBindingInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const token = req.sessionToken;
        if (!token) return next.handle();
        // `next.handle()` se llama ADENTRO del contexto: el controlador corre ahí.
        return new Observable((subscriber) => store.run(token, () => next.handle().subscribe(subscriber)));
    }
}
