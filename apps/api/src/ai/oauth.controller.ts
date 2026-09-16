import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { oauthApproveInputSchema, type OauthApproveInput, type OauthAuthorizationRequest, type OauthDecision } from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OAUTH_PATHS, OauthService, type RegisteredClient, type TokenResponse } from './oauth.service';
import { OauthError, requestOrigin } from './oauth.util';

/**
 * Endpoints OAuth 2.1 del MCP (v0.1.184) bajo `/api/v1/oauth/*`. Los de
 * protocolo (`register`, `authorize`, `token`, `revoke`) son públicos y hablan
 * el shape de las RFC (los clientes no entienden nuestro envelope); los de la
 * pantalla "Autorizar" (`authorize/:id`, `approve`, `deny`) van con la sesión
 * normal de la app.
 */
@Controller('oauth')
export class OauthController {
    constructor(
        private readonly oauth: OauthService,
        private readonly audit: AuditService,
    ) {}

    /** RFC 7591 — registro dinámico. Abierto a propósito (así funcionan claude.ai y Cursor); rate-limit por IP. */
    @Post('register')
    @HttpCode(201)
    async register(@Body() body: unknown, @Res() reply: FastifyReply): Promise<void> {
        try {
            const client: RegisteredClient = await this.oauth.registerClient(body);
            void reply.header('Cache-Control', 'no-store').code(201).send(client);
        } catch (err) {
            sendOauthError(reply, err);
        }
    }

    /** Punto de entrada del navegador: valida el pedido y manda a la pantalla del SPA. */
    @Get('authorize')
    async authorize(@Req() req: FastifyRequest, @Query() query: Record<string, unknown>, @Res() reply: FastifyReply): Promise<void> {
        const origin = requestOrigin(req);
        try {
            const start = await this.oauth.startAuthorization(origin, query);
            if (start.kind === 'redirect') {
                void reply.redirect(start.to, 302);
                return;
            }
            void reply.redirect(`${origin}${OAUTH_PATHS.consentPage}?req=${encodeURIComponent(start.requestId)}`, 302);
        } catch (err) {
            // Cliente o redirect inválidos: NO se redirige (sería un open
            // redirect); se muestra el error en texto plano.
            const e = err instanceof OauthError ? err : new OauthError('server_error', 'Error inesperado', 500);
            void reply
                .code(e.status)
                .header('Content-Type', 'text/plain; charset=utf-8')
                .send(`No se pudo iniciar la autorización (${e.error}): ${e.description}`);
        }
    }

    @Get('authorize/:id')
    @UseGuards(SessionGuard)
    request(@Param('id') id: string): Promise<OauthAuthorizationRequest> {
        return this.oauth.getRequest(id);
    }

    @Post('authorize/:id/approve')
    @UseGuards(SessionGuard)
    async approve(
        @Req() req: FastifyRequest,
        @Param('id') id: string,
        @Body(new ZodValidationPipe(oauthApproveInputSchema)) input: OauthApproveInput,
    ): Promise<OauthDecision> {
        const request = await this.oauth.getRequest(id);
        const decision = await this.oauth.approve(id, req.authUserId!, input);
        await this.audit.log({
            tenantId: input.tenant_id,
            userId: req.authUserId!,
            action: 'token.create',
            targetType: 'oauth_client',
            targetId: null,
            targetLabel: request.client_name,
            meta: { scope: input.scope, via: 'oauth', redirect_host: request.redirect_host },
        });
        return decision;
    }

    @Post('authorize/:id/deny')
    @UseGuards(SessionGuard)
    deny(@Param('id') id: string): Promise<OauthDecision> {
        return this.oauth.deny(id);
    }

    /** RFC 6749 §4.1.3 (code + PKCE) y §6 (refresh). Body `x-www-form-urlencoded` o JSON. */
    @Post('token')
    async token(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Res() reply: FastifyReply): Promise<void> {
        try {
            const out: TokenResponse = await this.oauth.token(asRecord(body), authorization);
            // Nest responde 201 a los POST por defecto; OAuth exige 200.
            void reply.code(200).header('Cache-Control', 'no-store').header('Pragma', 'no-cache').send(out);
        } catch (err) {
            sendOauthError(reply, err);
        }
    }

    /** RFC 7009. */
    @Post('revoke')
    async revoke(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Res() reply: FastifyReply): Promise<void> {
        try {
            await this.oauth.revoke(asRecord(body), authorization);
            void reply.header('Cache-Control', 'no-store').code(200).send({});
        } catch (err) {
            sendOauthError(reply, err);
        }
    }
}

function asRecord(body: unknown): Record<string, unknown> {
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function sendOauthError(reply: FastifyReply, err: unknown): void {
    const e = err instanceof OauthError ? err : new OauthError('server_error', err instanceof Error ? err.message : 'Error inesperado', 500);
    let r = reply.code(e.status).header('Cache-Control', 'no-store');
    if (e.status === 401) r = r.header('WWW-Authenticate', 'Basic realm="imagina-base"');
    void r.send({ error: e.error, error_description: e.description });
}
