import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiExceptionFilter, clientErrorStatus } from '../src/common/http-exception.filter';

function hostFor(): { host: never; sent: { status?: number; body?: unknown } } {
    const sent: { status?: number; body?: unknown } = {};
    const reply = {
        status(code: number) {
            sent.status = code;
            return { send: (b: unknown) => { sent.body = b; } };
        },
    };
    const host = {
        switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'GET', url: '/x' }) }),
    };
    return { host: host as never, sent };
}

describe('ApiExceptionFilter (v0.1.252)', () => {
    it('el rate limit de Fastify sale como 429, no como 500', () => {
        const err = Object.assign(new Error('Rate limit exceeded, retry in 1 minute'), { statusCode: 429 });
        const { host, sent } = hostFor();
        new ApiExceptionFilter().catch(err, host);
        expect(sent.status).toBe(429);
        expect(sent.body).toMatchObject({ code: 'rate_limited', data: { status: 429 } });
    });

    it('un body demasiado grande sale como 413', () => {
        const err = Object.assign(new Error('Request body is too large'), { statusCode: 413 });
        const { host, sent } = hostFor();
        new ApiExceptionFilter().catch(err, host);
        expect(sent.status).toBe(413);
    });

    it('un error sin statusCode sigue siendo 500 y una HttpException conserva el suyo', () => {
        const a = hostFor();
        new ApiExceptionFilter().catch(new Error('boom'), a.host);
        expect(a.sent.status).toBe(500);
        const b = hostFor();
        new ApiExceptionFilter().catch(new NotFoundException(), b.host);
        expect(b.sent.status).toBe(404);
    });

    it('clientErrorStatus sólo acepta 4xx', () => {
        expect(clientErrorStatus({ statusCode: 503 })).toBeNull();
        expect(clientErrorStatus({ statusCode: 400 })).toBe(400);
        expect(clientErrorStatus('x')).toBeNull();
    });
});
