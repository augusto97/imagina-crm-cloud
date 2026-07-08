import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import type { ApiError } from '@imagina-crm/shared';
import type { FastifyReply } from 'fastify';

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
        } else {
            this.logger.error(exception instanceof Error ? exception.stack : String(exception));
        }

        void reply.status(status).send(body);
    }
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
        case 429:
            return 'rate_limited';
        default:
            return 'error';
    }
}
