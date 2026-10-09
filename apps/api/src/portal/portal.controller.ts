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
    idSchema,
    layoutDataRequestSchema,
    issueMagicLinkSchema,
    portalCommentSchema,
    portalRequestAccessSchema,
    portalUpdateMeSchema,
    type ActivityDto,
    type CommentDto,
    type ConsumeMagicLinkInput,
    type IssueMagicLinkInput,
    type PortalLayoutData,
    type MagicLinkResult,
    type PortalBoot,
    type PortalAccessCheck,
    type PortalAccessList,
    type PortalAccounts,
    type PortalEmailLinkResult,
    type PortalSwitchResult,
    type PortalCommentInput,
    type PortalRequestAccessInput,
    type PortalRelatedOptions,
    type PortalUpdateMeInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SessionService } from '../auth/session.service';
import { PORTAL_SESSION_COOKIE, SESSION_COOKIE, SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { contentDispositionHeader } from '../files/safe-content-type';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PortalService, type PortalActor } from './portal.service';

const portalPreviewSchema = layoutDataRequestSchema.extend({ record_id: idSchema });

@Controller()
export class PortalController {
    constructor(
        private readonly portal: PortalService,
        private readonly sessions: SessionService,
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

    /**
     * v0.1.241 — antes de dar acceso: ¿ese email ya tiene acceso a otros
     * registros de ESTA empresa, o es de su equipo? (nunca mira otras empresas)
     */
    @Get('lists/:list/portal/access/check')
    @UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
    @RequireCapability('manage_lists')
    checkAccess(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query('email') email: string,
        @Query('record_id') recordId: string,
    ): Promise<PortalAccessCheck> {
        return this.portal.checkAccess(req.tenant!.tenantId, list, String(email ?? ''), Number(recordId) || 0);
    }

    /**
     * Quita el acceso de un cliente. Con `record_id`, sólo el de ese registro
     * (v0.1.241: puede tener varios); la membresía y las sesiones caen cuando
     * no le queda ninguno en la empresa.
     */
    @Delete('lists/:list/portal/access/:userId')
    @HttpCode(204)
    @UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
    @RequireCapability('manage_lists')
    revokeAccess(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('userId') userId: string,
        @Query('record_id') recordId?: string,
    ): Promise<void> {
        const rid = Number(recordId);
        return this.portal.revokeAccess(
            req.tenant!.tenantId,
            list,
            Number(userId) || 0,
            Number.isInteger(rid) && rid > 0 ? rid : undefined,
        );
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

    /** v0.1.233 — el diseño vigente del portal (de aquí arranca el editor). */
    @Get('lists/:list/portal/layout')
    @UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
    @RequireCapability('manage_lists')
    async portalLayout(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: { layout: unknown; origin: string } }> {
        return { data: await this.portal.layoutFor(req.tenant!.tenantId, list) };
    }

    /**
     * v0.1.233 — vista previa del editor del portal: los gráficos y tablas del
     * diseño (sin guardar) para un registro, con el alcance de su cliente.
     */
    @Post('lists/:list/portal/layout-data')
    @HttpCode(200)
    @UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
    @RequireCapability('manage_lists')
    async layoutData(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(portalPreviewSchema)) body: z.infer<typeof portalPreviewSchema>,
    ): Promise<{ data: PortalLayoutData }> {
        return { data: await this.portal.previewLayoutData(req.tenant!.tenantId, list, body.record_id, body.blocks) };
    }

    /**
     * Ruta PÚBLICA: el propio cliente pide un enlace nuevo cuando el anterior
     * venció (v0.1.154). Siempre responde lo mismo — no revela si el email
     * tiene o no acceso — y nunca crea accesos: sólo re-emite para quien la
     * empresa ya autorizó.
     */
    @Post('portal/request-access')
    @HttpCode(200)
    async requestAccess(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(portalRequestAccessSchema)) input: PortalRequestAccessInput,
    ): Promise<{ ok: true }> {
        await this.portal.requestAccess(input.email, req.host);
        return { ok: true };
    }

    /** Ruta pública: consume el token de un solo uso y abre la sesión del client. */
    @Post('portal/consume')
    @HttpCode(200)
    async consume(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(consumeMagicLinkSchema)) input: ConsumeMagicLinkInput,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<{ ok: true }> {
        const { sessionToken } = await this.portal.consume(input.token, {
            userAgent: String(req.headers['user-agent'] ?? ''),
            ip: req.ip,
            host: req.host,
        });
        // v0.1.241 — el navegador cambia de sesión del portal: la anterior se
        // cierra (si no, quedaba viva 30 días sin que nadie la usara).
        const previous = req.cookies?.[PORTAL_SESSION_COOKIE];
        if (previous && previous !== sessionToken) {
            const old = await this.sessions.peek(previous);
            if (old?.portalTenantId !== undefined) await this.sessions.destroy(previous);
        }
        // v0.1.241 — cookie PROPIA del portal: abrir un portal ya no cierra la
        // sesión de trabajo de la app en el mismo navegador.
        reply.setCookie(PORTAL_SESSION_COOKIE, sessionToken, {
            httpOnly: true,
            // SEC-14: en producción SIEMPRE Secure.
            secure: this.env.COOKIE_SECURE || this.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: this.env.SESSION_TTL_SECONDS,
        });
        return { ok: true };
    }

    /** v0.1.241 — salir del portal (sólo la sesión del portal de este navegador). */
    @Post('portal/logout')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<{ ok: true }> {
        await this.sessions.destroy(req.sessionToken!);
        reply.clearCookie(PORTAL_SESSION_COOKIE, { path: '/' });
        // Sesiones del portal abiertas antes de v0.1.241 vivían en la cookie general.
        if (req.cookies?.[SESSION_COOKIE] === req.sessionToken) reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return { ok: true };
    }

    /** v0.1.241 — las cuentas de la persona (registros a los que tiene acceso). */
    @Get('portal/accounts')
    @UseGuards(SessionGuard)
    accounts(@Req() req: FastifyRequest): Promise<PortalAccounts> {
        return this.portal.accounts(portalActor(req));
    }

    /** v0.1.241 — abrir una cuenta de otra empresa (ruta de un solo uso). */
    @Post('portal/accounts/:id/switch')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    switchAccount(@Req() req: FastifyRequest, @Param('id') id: string): Promise<PortalSwitchResult> {
        return this.portal.switchAccount(portalActor(req), Number(id) || 0);
    }

    /** v0.1.241 — mandarme al correo un enlace con TODAS mis cuentas. */
    @Post('portal/accounts/email-link')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    emailAllAccounts(@Req() req: FastifyRequest): Promise<PortalEmailLinkResult> {
        return this.portal.emailAllAccounts(portalActor(req));
    }

    /** Boot del portal para el client autenticado. */
    @Get('portal/me')
    @UseGuards(SessionGuard)
    me(@Req() req: FastifyRequest): Promise<PortalBoot> {
        return this.portal.me(portalActor(req));
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
        return this.portal.updateMe(portalActor(req), input);
    }

    @Get('portal/me/comments')
    @UseGuards(SessionGuard)
    async myComments(@Req() req: FastifyRequest): Promise<{ data: CommentDto[] }> {
        return { data: await this.portal.myComments(portalActor(req)) };
    }

    @Post('portal/me/comments')
    @HttpCode(201)
    @UseGuards(SessionGuard)
    async createMyComment(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(portalCommentSchema)) input: PortalCommentInput,
    ): Promise<{ data: CommentDto }> {
        return { data: await this.portal.createMyComment(portalActor(req), input) };
    }

    @Get('portal/me/activity')
    @UseGuards(SessionGuard)
    async myActivity(
        @Req() req: FastifyRequest,
        @Query('limit') limit?: string,
    ): Promise<{ data: ActivityDto[] }> {
        return { data: await this.portal.myActivity(portalActor(req), Number(limit ?? 50)) };
    }

    /** v0.1.267 — PDF publicado en el portal, del registro del cliente. */
    @Get('portal/me/documents/:id')
    @UseGuards(SessionGuard)
    async myDocument(
        @Req() req: FastifyRequest,
        @Res() reply: FastifyReply,
        @Param('id') id: string,
    ): Promise<void> {
        const doc = await this.portal.myDocument(portalActor(req), Number(id));
        const name = doc.filename.toLowerCase().endsWith('.pdf') ? doc.filename : `${doc.filename}.pdf`;
        void reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', contentDispositionHeader('attachment', name))
            .header('x-content-type-options', 'nosniff')
            .header('cache-control', 'private, no-store')
            .send(doc.buffer);
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
        return this.portal.listRecords(portalActor(req), slug, Number(page ?? 1), Number(perPage ?? 10));
    }

    /** Totales bajo el scope del portal (KPI / stats grid). */
    @Get('portal/lists/:slug/aggregates')
    @UseGuards(SessionGuard)
    async aggregates(
        @Req() req: FastifyRequest,
        @Param('slug') slug: string,
        @Query('fields') fields?: string,
    ) {
        return { data: await this.portal.aggregates(portalActor(req), slug, fields ?? '') };
    }
}

/**
 * SEC-24 — quién llama al portal: el usuario y la empresa de su enlace.
 * v0.1.241 — más el acceso con el que entró y el que eligió en el portal
 * (`X-Portal-Account`, validado contra SUS vínculos en `requireLink`).
 */
function portalActor(req: FastifyRequest): PortalActor {
    const raw = req.headers['x-portal-account'];
    const requested = Number(Array.isArray(raw) ? raw[0] : raw);
    return {
        userId: req.authUserId!,
        tenantId: req.portalTenantId ?? null,
        ...(req.portalLinkId !== undefined ? { linkId: req.portalLinkId } : {}),
        ...(Number.isInteger(requested) && requested > 0 ? { requestedLinkId: requested } : {}),
        account: req.portalAccount === true,
    };
}
