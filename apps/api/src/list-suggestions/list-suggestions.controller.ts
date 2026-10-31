import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    listSuggestionKeySchema,
    runListSuggestionsAiSchema,
    updateListSuggestionsSettingsSchema,
    type ApplyListSuggestionResult,
    type ListSuggestionsResponse,
    type ListSuggestionsSettings,
    type RunListSuggestionsAiInput,
    type UpdateListSuggestionsSettingsInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AiToolContext } from '../ai/tools/registry';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ListSuggestionsAiService } from './list-suggestions-ai.service';
import { ListSuggestionsService } from './list-suggestions.service';

const dismissSchema = z.object({ title: z.string().trim().max(190).optional() });
const keyPipe = new ZodValidationPipe(listSuggestionKeySchema);

/**
 * v0.1.341 (ADR-S89) — Sugerencias por lista. Sólo admin y gerente (lo
 * decide el service, con el rol base); cada sugerencia exige además la
 * capacidad de lo que crea. Cerrado a invitados (sin `@AllowGuest()`) y al
 * rol cliente (TenantGuard).
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard)
export class ListSuggestionsController {
    constructor(
        private readonly service: ListSuggestionsService,
        private readonly ai: ListSuggestionsAiService,
    ) {}

    /** `?summary=1`: sólo el conteo para el aviso de la cabecera (no consulta a la IA). */
    @Get('lists/:list/suggestions')
    get(@Req() req: FastifyRequest, @Param('list') list: string, @Query('summary') summary?: string): Promise<ListSuggestionsResponse> {
        return this.service.get(toolCtx(req), list, { summary: summary === '1' || summary === 'true' });
    }

    /** «Recomendar con IA»: arranca el análisis (en segundo plano) y devuelve el estado. */
    @Post('lists/:list/suggestions/ai')
    @HttpCode(202)
    runAi(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(runListSuggestionsAiSchema)) input: RunListSuggestionsAiInput,
    ): Promise<ListSuggestionsResponse> {
        return this.ai.start(toolCtx(req), list, input);
    }

    @Post('lists/:list/suggestions/:key/apply')
    @HttpCode(200)
    apply(@Req() req: FastifyRequest, @Param('list') list: string, @Param('key', keyPipe) key: string): Promise<ApplyListSuggestionResult> {
        return this.service.apply(toolCtx(req), list, key);
    }

    @Post('lists/:list/suggestions/:key/dismiss')
    @HttpCode(204)
    async dismiss(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('key', keyPipe) key: string,
        @Body(new ZodValidationPipe(dismissSchema)) body: z.infer<typeof dismissSchema>,
    ): Promise<void> {
        await this.service.dismiss(toolCtx(req), list, key, body.title);
    }

    @Post('lists/:list/suggestions/:key/restore')
    @HttpCode(204)
    async restore(@Req() req: FastifyRequest, @Param('list') list: string, @Param('key', keyPipe) key: string): Promise<void> {
        await this.service.restore(toolCtx(req), list, key);
    }

    @Get('suggestions/settings')
    settings(@Req() req: FastifyRequest): Promise<ListSuggestionsSettings> {
        return this.service.getSettings(toolCtx(req));
    }

    @Patch('suggestions/settings')
    updateSettings(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateListSuggestionsSettingsSchema)) patch: UpdateListSuggestionsSettingsInput,
    ): Promise<ListSuggestionsSettings> {
        return this.service.updateSettings(toolCtx(req), patch);
    }
}

function toolCtx(req: FastifyRequest): AiToolContext {
    return { tenantId: req.tenant!.tenantId, userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
