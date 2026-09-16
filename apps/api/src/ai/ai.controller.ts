import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    Get,
    NotFoundException,
    Param,
    Post,
    Patch,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    aiChatRequestSchema,
    updateTenantAiSettingsSchema,
    type AiApplyResult,
    type AiChatEvent,
    type AiChatRequest,
    type AiConversation,
    type AiStatus,
    type Role,
    type TenantAiSettings,
    type UpdateTenantAiSettingsInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AiQuotaExceededError } from './ai-quota.service';
import { AiSettingsService, AiUnavailableError } from './ai-settings.service';
import { AssistantService } from './assistant.service';
import { ProposalsService } from './proposals.service';
import type { AiToolContext } from './tools/registry';

/**
 * Asistente IA por empresa (ADR-S21). Todo con sesión + tenant: el
 * asistente corre como la persona. Los permisos finos los aplica cada
 * herramienta (capability por tool) y `ProposalsService.apply`.
 */
@Controller('ai')
@UseGuards(SessionGuard, TenantGuard)
export class AiController {
    constructor(
        private readonly assistant: AssistantService,
        private readonly proposals: ProposalsService,
        private readonly settings: AiSettingsService,
        private readonly audit: AuditService,
    ) {}

    @Get('status')
    status(@Req() req: FastifyRequest): Promise<AiStatus> {
        return this.assistant.status(ctxOf(req));
    }

    /**
     * Un turno de chat como SSE (`text/event-stream`): cada línea `data:` es
     * un `AiChatEvent`. Se secuestra la respuesta de Fastify para escribir
     * a medida que el modelo habla (sin pasar por el compress ni el
     * serializer). Los errores previos al primer token viajan como evento
     * `error` — el cliente ya está escuchando el stream.
     */
    @Post('chat')
    async chat(
        @Req() req: FastifyRequest,
        @Res() reply: FastifyReply,
        @Body(new ZodValidationPipe(aiChatRequestSchema)) body: AiChatRequest,
    ): Promise<void> {
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        raw.flushHeaders?.();
        const send = (ev: AiChatEvent): void => {
            if (!raw.writableEnded) raw.write(`data: ${JSON.stringify(ev)}\n\n`);
        };
        const ac = new AbortController();
        req.raw.on('close', () => ac.abort());
        try {
            await this.assistant.chat(ctxOf(req), body, send, ac.signal);
        } catch (err) {
            send(errorEvent(err));
        } finally {
            if (!raw.writableEnded) raw.end();
        }
    }

    @Get('conversations/:id')
    async conversation(@Req() req: FastifyRequest, @Param('id') id: string): Promise<AiConversation> {
        const conv = await this.assistant.conversation(ctxOf(req), id);
        if (!conv) {
            throw new NotFoundException({ code: 'ai_conversation_not_found', message: 'La conversación no existe o venció', data: { status: 404 } });
        }
        return conv;
    }

    @Post('proposals/:id/apply')
    async apply(@Req() req: FastifyRequest, @Param('id') id: string): Promise<AiApplyResult> {
        return { proposal: await this.proposals.apply(ctxOf(req), id) };
    }

    // ── Ajustes de la empresa (admin) ────────────────────────────────────

    @Get('settings')
    getSettings(@Req() req: FastifyRequest): Promise<TenantAiSettings> {
        assertAdmin(req);
        return this.settings.getTenant(req.tenant!.tenantId);
    }

    @Patch('settings')
    async updateSettings(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateTenantAiSettingsSchema)) input: UpdateTenantAiSettingsInput,
    ): Promise<TenantAiSettings> {
        assertAdmin(req);
        const tenantId = req.tenant!.tenantId;
        if (input.api_key) {
            const platform = await this.settings.getPlatform();
            if (!platform.allow_tenant_keys) {
                throw new BadRequestException({
                    code: 'tenant_keys_not_allowed',
                    message: 'La plataforma no permite claves IA propias por empresa',
                    data: { status: 400 },
                });
            }
        }
        const out = await this.settings.updateTenant(tenantId, input);
        await this.audit.log({
            tenantId,
            userId: req.authUserId ?? null,
            action: 'workspace.ai_change',
            targetType: 'workspace',
            targetLabel: 'Asistente IA',
            // NUNCA la clave: sólo qué se tocó.
            meta: {
                enabled: input.enabled,
                model: input.model,
                key_changed: Boolean(input.api_key),
                key_cleared: Boolean(input.clear_key),
            },
        });
        return out;
    }
}

function ctxOf(req: FastifyRequest): AiToolContext {
    return { tenantId: req.tenant!.tenantId, userId: req.authUserId!, role: req.tenant!.role as Role };
}

function assertAdmin(req: FastifyRequest): void {
    if (req.tenant?.role !== 'admin') {
        throw new ForbiddenException({ code: 'admin_required', message: 'Sólo un administrador del workspace puede cambiar esto', data: { status: 403 } });
    }
}

function errorEvent(err: unknown): AiChatEvent {
    if (err instanceof AiUnavailableError) return { type: 'error', code: err.code, message: err.message };
    if (err instanceof AiQuotaExceededError) return { type: 'error', code: err.code, message: err.message };
    const status = (err as { status?: number }).status;
    if (status === 401) return { type: 'error', code: 'ai_bad_key', message: 'El proveedor rechazó la clave IA configurada. Revisala en Ajustes → Asistente IA (o Plataforma).' };
    if (status === 429) return { type: 'error', code: 'ai_rate_limited', message: 'El proveedor está limitando las solicitudes. Probá de nuevo en unos segundos.' };
    if (status === 529 || status === 503) return { type: 'error', code: 'ai_overloaded', message: 'El proveedor está sobrecargado. Probá de nuevo en un momento.' };
    if ((err as { name?: string }).name === 'AbortError') return { type: 'error', code: 'aborted', message: 'Conexión cerrada.' };
    const message = err instanceof Error ? err.message : String(err);
    return { type: 'error', code: 'ai_error', message: `No se pudo completar el pedido: ${message}` };
}
