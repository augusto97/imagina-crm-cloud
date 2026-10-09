import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import type { ApiError } from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { recordServerError } from '../observability/diagnostics';

/**
 * Normaliza TODO error al shape del contrato (CONTRACT.md §1):
 * `{ code, message, data: { status, errors? } }`.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(ApiExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const reply = host.switchToHttp().getResponse<FastifyReply>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let body: ApiError = {
            code: 'internal_error',
            message: 'Error interno',
            data: { status },
        };

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const response = exception.getResponse();
            if (isApiError(response)) {
                body = response;
            } else {
                const message =
                    typeof response === 'string'
                        ? response
                        : ((response as Record<string, unknown>).message as string | undefined) ??
                          exception.message;
                body = {
                    code: codeForStatus(status),
                    message: Array.isArray(message) ? message.join('; ') : String(message),
                    data: { status },
                };
            }
        } else if (clientErrorStatus(exception) !== null) {
            // v0.1.252 — errores de CLIENTE que vienen de Fastify/plugins y no
            // son HttpException (el rate limit, un body demasiado grande, un
            // content-type que no se acepta): se respetan con su 4xx. Antes
            // caían al 500 «Error interno» — el límite de pedidos respondía
            // 500 y cada rechazo quedaba como error del servidor.
            status = clientErrorStatus(exception)!;
            const message = status === 429
                ? 'Demasiados pedidos seguidos: espera un momento y vuelve a intentar.'
                : exception instanceof Error && exception.message !== '' ? exception.message : 'Pedido rechazado';
            body = { code: codeForStatus(status), message, data: { status } };
        } else {
            this.logger.error(exception instanceof Error ? exception.stack : String(exception));
            // v0.1.238 — queda a la vista en Plataforma → Diagnóstico.
            const req = host.switchToHttp().getRequest<FastifyRequest | undefined>();
            recordServerError({
                source: 'request',
                method: req?.method ?? null,
                path: req?.url ?? null,
                message: exception instanceof Error ? exception.message : String(exception),
                detail: exception instanceof Error ? (exception.stack ?? '').split('\n').slice(1, 5).join('\n') : null,
            });
        }

        void reply.status(status).send(body);
    }
}

/** `statusCode` 4xx de un error de Fastify o de un plugin; si no, null. */
export function clientErrorStatus(exception: unknown): number | null {
    if (typeof exception !== 'object' || exception === null) return null;
    const code = (exception as { statusCode?: unknown }).statusCode;
    return typeof code === 'number' && Number.isInteger(code) && code >= 400 && code < 500 ? code : null;
}

function isApiError(value: unknown): value is ApiError {
    return (
        typeof value === 'object' &&
        value !== null &&
        'code' in value &&
        'message' in value &&
        'data' in value
    );
}

function codeForStatus(status: number): string {
    switch (status) {
        case 400:
            return 'bad_request';
        case 401:
            return 'unauthorized';
        case 403:
            return 'forbidden';
        case 404:
            return 'not_found';
        case 409:
            return 'conflict';
        case 413:
            return 'payload_too_large';
        case 415:
            return 'unsupported_media_type';
        case 429:
            return 'rate_limited';
        default:
            return 'error';
    }
}
