import {
    BadRequestException,
    Body,
    Controller,
    HttpCode,
    NotFoundException,
    Param,
    Post,
} from '@nestjs/common';
import { AutomationDispatcher } from './automation-dispatcher.service';
import { AutomationsService } from './automations.service';

/** Cap del payload aceptado (serializado). Un form/webhook razonable entra de sobra. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

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
