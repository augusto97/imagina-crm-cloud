import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodTypeAny } from 'zod';

/**
 * Valida el body con el MISMO schema Zod que tipa al frontend (regla de oro
 * nº 2). Los errores salen con el shape del contrato:
 * `{ code, message, data: { status, errors } }` (CONTRACT.md §1).
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
    constructor(private readonly schema: ZodTypeAny) {}

    transform(value: unknown): unknown {
        const result = this.schema.safeParse(value);
        if (!result.success) {
            throw new BadRequestException({
                code: 'validation_failed',
                message: 'Datos inválidos',
                data: { status: 400, errors: flattenZodError(result.error) },
            });
        }
        return result.data;
    }
}

function flattenZodError(error: ZodError): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of error.issues) {
        const path = issue.path.join('.') || '_';
        if (!(path in out)) {
            out[path] = issue.message;
        }
    }
    return out;
}
