import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    HttpCode,
    HttpException,
    HttpStatus,
    Inject,
    NotFoundException,
    Param,
    Post,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { AutomationDispatcher } from './automation-dispatcher.service';
import { AutomationsService } from './automations.service';

/** Cap del payload aceptado (serializado). Un form/webhook razonable entra de sobra. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * SEC-34 (v0.1.239): tope POR TOKEN. El rate limit general es por IP y en
 * memoria de cada nodo: un token filtrado (está en el HTML de un formulario
 * público) se martillaba desde muchas IPs y cada POST era una corrida de la
 * automatización — registros, correos y webhooks salientes sin freno. 60 por
 * minuto y 2.000 por hora alcanzan de sobra para un formulario o una tienda.
 */
const HOOK_LIMITS: ReadonlyArray<{ window: number; max: number }> = [
    { window: 60, max: 60 },
    { window: 3600, max: 2000 },
];

/**
 * v0.1.110 — Webhook ENTRANTE público: `POST /public/hooks/:token` dispara la
 * automatización mapeada al token (trigger `incoming_webhook`) con el body
 * JSON como payload. Sin sesión: el token opaco ES la credencial (mismo
 * criterio que las listas públicas, ADR-S14). Token desconocido → 404 opaco.
 * El run se ENCOLA (BullMQ) — la respuesta no espera a las acciones.
 */
@Controller('public/hooks')
export class AutomationHooksController {
    constructor(
        private readonly automations: AutomationsService,
        private readonly dispatcher: AutomationDispatcher,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    @Post(':token')
    @HttpCode(202)
    async receive(
        @Param('token') token: string,
        @Body() body: unknown,
    ): Promise<{ ok: true }> {
        const hook = await this.automations.resolveHookToken(token);
        if (!hook) {
            throw new NotFoundException({ code: 'not_found', message: 'Not found', data: { status: 404 } });
        }
        if (hook.readOnly) {
            throw new ForbiddenException({
                code: 'workspace_read_only',
                message: 'El workspace está en solo-lectura por el estado de facturación',
                data: { status: 403 },
            });
        }
        await this.enforceLimit(token);
        const payload = normalizePayload(body);
        // v0.1.111 — captura de prueba para el panel "Probar" del editor.
        // Best-effort: si Redis falla acá, el dispatch de abajo va a fallar
        // igual; no rompemos la respuesta por la captura.
        await this.automations
            .captureHookPayload(hook.tenantId, hook.automationId, payload)
            .catch(() => undefined);
        this.dispatcher.dispatchWebhook({
            tenantId: hook.tenantId,
            automationId: hook.automationId,
            payload,
        });
        return { ok: true };
    }

    /** Ventanas fijas en Redis (compartidas entre nodos). Redis caído → no frena. */
    private async enforceLimit(token: string): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        for (const { window, max } of HOOK_LIMITS) {
            const key = `hookrl:${window}:${Math.floor(now / window)}:${token}`;
            let count: number;
            try {
                const res = await this.redis.multi().incr(key).expire(key, window).exec();
                count = Number(res?.[0]?.[1] ?? 0);
            } catch {
                return;
            }
            if (count > max) {
                throw new HttpException(
                    {
                        code: 'rate_limited',
                        message: `Demasiados envíos a este webhook (máx ${max} cada ${window === 60 ? 'minuto' : 'hora'}).`,
                        data: { status: 429 },
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        }
    }
}

/** El payload debe ser un objeto JSON razonable (los arrays se envuelven). */
function normalizePayload(body: unknown): Record<string, unknown> {
    const payload: Record<string, unknown> =
        body !== null && typeof body === 'object' && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : body === undefined || body === null
              ? {}
              : { payload: body };
    let size = 0;
    try {
        size = JSON.stringify(payload).length;
    } catch {
        throw new BadRequestException({ code: 'invalid_payload', message: 'Payload no serializable', data: { status: 400 } });
    }
    if (size > MAX_PAYLOAD_BYTES) {
        throw new BadRequestException({ code: 'payload_too_large', message: 'Payload demasiado grande (máx 64KB)', data: { status: 400 } });
    }
    return payload;
}
