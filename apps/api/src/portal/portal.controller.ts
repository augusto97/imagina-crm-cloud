import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Inject,
    Param,
    Patch,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    consumeMagicLinkSchema,
    issueMagicLinkSchema,
    portalCommentSchema,
    portalUpdateMeSchema,
    type ActivityDto,
    type CommentDto,
    type ConsumeMagicLinkInput,
    type IssueMagicLinkInput,
    type MagicLinkResult,
    type PortalBoot,
    type PortalAccessList,
    type PortalCommentInput,
    type PortalRelatedOptions,
    type PortalUpdateMeInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PortalService } from './portal.service';

@Controller()
export class PortalController {
    constructor(
        private readonly portal: PortalService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /**
     * Un admin emite el magic link de acceso al portal de un record.
     *
     * SEC: exige `manage_lists` (acción de admin). NO se acepta `access_portal`
     * aquí: esa es la capability del CONSUMIDOR del portal (rol `client`), y
     * con semántica OR permitiría que un client emitiera links para el record
     * y el email que quisiera → apropiación de sesión de un admin. Ver SEC-01.
     */
    @Post('lists/:list/portal/magic-link')
    @UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
    @RequireCapability('manage_lists')
    issue(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(issueMagicLinkSchema)) input: IssueMagicLinkInput,
    ): Promise<MagicLinkResult> {
        return this.portal.issue(req.tenant!.tenantId, list, input);
    }

    /**
     * Quién tiene acceso al portal de un record (v0.1.153) — con la fecha de
     * su última entrada. El acceso SIEMPRE quedó guardado; faltaba mostrarlo.
     */
    @Get('lists/:list/portal/access')
    @UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
    @RequireCapability('manage_lists')
    access(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query('record_id') recordId: string,
    ): Promise<PortalAccessList> {
        return this.portal.accessFor(req.tenant!.tenantId, list, Number(recordId) || 0);
    }

    /** Quita el acceso de un cliente (borra el vínculo y revoca sus sesiones). */
    @Delete('lists/:list/portal/access/:userId')
    @HttpCode(204)
    @UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
    @RequireCapability('manage_lists')
    revokeAccess(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('userId') userId: string,
    ): Promise<void> {
        return this.portal.revokeAccess(req.tenant!.tenantId, list, Number(userId) || 0);
    }

    /**
     * Listas que se PUEDEN mostrar en el portal (tienen un campo relation
     * hacia esta lista, o un campo `user`). Alimenta el panel del portal.
     */
    @Get('lists/:list/portal/related-options')
    @UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
    @RequireCapability('manage_lists')
    async relatedOptions(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
    ): Promise<PortalRelatedOptions> {
        return { options: await this.portal.relatedOptions(req.tenant!.tenantId, list) };
    }

    /** Ruta pública: consume el token de un solo uso y abre la sesión del client. */
    @Post('portal/consume')
    @HttpCode(200)
    async consume(
        @Body(new ZodValidationPipe(consumeMagicLinkSchema)) input: ConsumeMagicLinkInput,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<{ ok: true }> {
        const { sessionToken } = await this.portal.consume(input.token);
        reply.setCookie(SESSION_COOKIE, sessionToken, {
            httpOnly: true,
            // SEC-14: en producción SIEMPRE Secure.
            secure: this.env.COOKIE_SECURE || this.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: this.env.SESSION_TTL_SECONDS,
        });
        return { ok: true };
    }

    /** Boot del portal para el client autenticado. */
    @Get('portal/me')
    @UseGuards(SessionGuard)
    me(@Req() req: FastifyRequest): Promise<PortalBoot> {
        return this.portal.me(req.authUserId!);
    }

    // --- Endpoints de los bloques del portal (client autenticado) ----------
    // Los bloques del SPA fetchean crudo y esperan el envelope `{data: …}`,
    // así que estas rutas lo devuelven explícito. El scoping al record del
    // cliente se resuelve SIEMPRE server-side (portal_links) — jamás por
    // parámetros del request.

    /** El cliente edita su propio record (whitelist del template). */
    @Patch('portal/me')
    @UseGuards(SessionGuard)
    updateMe(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(portalUpdateMeSchema)) input: PortalUpdateMeInput,
    ): Promise<{ ok: true }> {
        return this.portal.updateMe(req.authUserId!, input);
    }

    @Get('portal/me/comments')
    @UseGuards(SessionGuard)
    async myComments(@Req() req: FastifyRequest): Promise<{ data: CommentDto[] }> {
        return { data: await this.portal.myComments(req.authUserId!) };
    }

    @Post('portal/me/comments')
    @HttpCode(201)
    @UseGuards(SessionGuard)
    async createMyComment(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(portalCommentSchema)) input: PortalCommentInput,
    ): Promise<{ data: CommentDto }> {
        return { data: await this.portal.createMyComment(req.authUserId!, input) };
    }

    @Get('portal/me/activity')
    @UseGuards(SessionGuard)
    async myActivity(
        @Req() req: FastifyRequest,
        @Query('limit') limit?: string,
    ): Promise<{ data: ActivityDto[] }> {
        return { data: await this.portal.myActivity(req.authUserId!, Number(limit ?? 50)) };
    }

    /** Records de otra lista visibles bajo el scope del portal. */
    @Get('portal/lists/:slug/records')
    @UseGuards(SessionGuard)
    listRecords(
        @Req() req: FastifyRequest,
        @Param('slug') slug: string,
        @Query('page') page?: string,
        @Query('per_page') perPage?: string,
    ) {
        return this.portal.listRecords(req.authUserId!, slug, Number(page ?? 1), Number(perPage ?? 10));
    }

    /** Totales bajo el scope del portal (KPI / stats grid). */
    @Get('portal/lists/:slug/aggregates')
    @UseGuards(SessionGuard)
    async aggregates(
        @Req() req: FastifyRequest,
        @Param('slug') slug: string,
        @Query('fields') fields?: string,
    ) {
        return { data: await this.portal.aggregates(req.authUserId!, slug, fields ?? '') };
    }
}
