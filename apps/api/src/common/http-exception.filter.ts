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
        } else if (pgErrorResponse(exception) !== null) {
            // Errores de Postgres que son del DATO recibido o de una carrera
            // entre dos pedidos, no del servidor: un valor que la base no
            // acepta (400), un duplicado por doble envío (409), una consulta
            // que superó el tiempo máximo (503). Antes todos salían 500.
            const mapped = pgErrorResponse(exception)!;
            status = mapped.status;
            body = { code: mapped.code, message: mapped.message, data: { status } };
            const req = host.switchToHttp().getRequest<FastifyRequest | undefined>();
            this.logger.warn(`${req?.method ?? ''} ${(req?.url ?? '').split('?')[0]} → ${status} (Postgres ${pgErrorCode(exception)})`);
            if (status >= 500) {
                recordServerError({
                    source: 'database',
                    method: req?.method ?? null,
                    path: (req?.url ?? '').split('?')[0] || null,
                    message: errorMessage(exception),
                    detail: null,
                });
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

/**
 * Código SQLSTATE de un error de Postgres. drizzle lo envuelve
 * (`DrizzleQueryError` → `cause` = el `DatabaseError` de pg): se recorre la
 * cadena de `cause` hasta encontrarlo.
 */
export function pgErrorCode(exception: unknown): string | null {
    let cur: unknown = exception;
    for (let i = 0; i < 5 && typeof cur === 'object' && cur !== null; i++) {
        const code = (cur as { code?: unknown }).code;
        if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && 'severity' in cur) return code;
        cur = (cur as { cause?: unknown }).cause;
    }
    return null;
}

/** Datos que la base no acepta: texto con NUL, JSON con escapes inválidos, número/fecha fuera de rango. */
const INVALID_INPUT_CODES = new Set([
    '22P02', // invalid_text_representation (bigint/numeric/json mal formado)
    '22P05', // untranslatable_character (\u0000 en jsonb)
    '22021', // character_not_in_repertoire (0x00 en texto)
    '22003', // numeric_value_out_of_range (id más allá de bigint)
    '22007', // invalid_datetime_format
    '22008', // datetime_field_overflow
    '22001', // string_data_right_truncation
]);

/** Respuesta para un error de Postgres que NO es del servidor; null si lo es. */
export function pgErrorResponse(exception: unknown): { status: number; code: string; message: string } | null {
    const code = pgErrorCode(exception);
    if (code === null) return null;
    if (INVALID_INPUT_CODES.has(code)) {
        return {
            status: 400,
            code: 'invalid_input',
            message: 'Algún dato enviado no es válido (un carácter no admitido o un valor fuera de rango).',
        };
    }
    if (code === '23505') {
        return {
            status: 409,
            code: 'conflict',
            message: 'Ya existe un elemento con esos datos (quizá se envió dos veces). Recarga y vuelve a intentarlo.',
        };
    }
    if (code === '57014') {
        return {
            status: 503,
            code: 'timeout',
            message: 'La operación tardó demasiado y se canceló. Inténtalo de nuevo en un momento o acota lo que pides.',
        };
    }
    return null;
}

/** Mensaje del error de Postgres (no el «Failed query: …» de drizzle, que trae la consulta y sus parámetros). */
function errorMessage(exception: unknown): string {
    let cur: unknown = exception;
    for (let i = 0; i < 5 && cur instanceof Error; i++) {
        if ('severity' in cur) return cur.message;
        cur = (cur as { cause?: unknown }).cause;
    }
    return exception instanceof Error ? exception.message : String(exception);
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
