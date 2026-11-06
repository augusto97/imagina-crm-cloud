import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Put,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    deleteAccountSchema,
    mobileNavConfigSchema,
    recordMostUsedVisitsSchema,
    updateEmailSignatureSchema,
    updateFavoritesSchema,
    updateGuideProgressSchema,
    updateMostUsedSchema,
    type DeleteAccountInput,
    type FavoriteView,
    type Favorites,
    type GuideProgress,
    type MeUserSummary,
    type MobileNavConfig,
    type MobileNavState,
    type MostUsedState,
    type RecordMostUsedVisitsInput,
    type UpdateEmailSignatureInput,
    type UpdateFavoritesInput,
    type UpdateGuideProgressInput,
    type UpdateMostUsedInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AllowGuest } from '../tenancy/allow-guest.decorator';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { AccountDataService, type AccountExport } from './account-data.service';
import { MeService } from './me.service';

/**
 * Recursos del usuario autenticado (`/me/*`). El search/lookup de usuarios es
 * tenant-scoped (pickers de menciones/asignación); la firma de email es
 * personal y no necesita tenant resuelto.
 */
@Controller('me')
export class MeController {
    constructor(
        private readonly me: MeService,
        private readonly account: AccountDataService,
    ) {}

    @Get('users-search')
    @UseGuards(SessionGuard, TenantGuard)
    @AllowGuest()
    async searchUsers(
        @Req() req: FastifyRequest,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<{ data: MeUserSummary[] }> {
        const parsedLimit = limit === undefined ? undefined : Number(limit);
        return { data: await this.me.searchUsers(tenantId(req), q ?? '', parsedLimit, req.tenant!.role) };
    }

    /**
     * Menciones al usuario en el workspace activo (la campana del topbar).
     * Shape estilo activity: la UI muestra `changes.snippet` + `created_at`;
     * el "no leído" es client-side (localStorage del bell).
     */
    @Get('mentions')
    @UseGuards(SessionGuard, TenantGuard)
    async mentions(
        @Req() req: FastifyRequest,
        @Query('limit') limit?: string,
    ): Promise<{ data: unknown[] }> {
        return {
            data: await this.me.mentions(tenantId(req), req.authUserId!, Number(limit ?? 20)),
        };
    }

    /** v0.1.252 — `GET /me/users?ids=1,2,3`: varios miembros en una request. */
    @Get('users')
    @UseGuards(SessionGuard, TenantGuard)
    @AllowGuest()
    async getUsers(
        @Req() req: FastifyRequest,
        @Query('ids') ids?: string,
    ): Promise<{ data: MeUserSummary[] }> {
        const parsed = (ids ?? '').split(',').map((s) => Number(s.trim()));
        return { data: await this.me.getUsers(tenantId(req), parsed, req.tenant!.role) };
    }

    @Get('users/:id')
    @UseGuards(SessionGuard, TenantGuard)
    @AllowGuest()
    getUser(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<MeUserSummary> {
        return this.me.getUser(tenantId(req), id, req.tenant!.role);
    }

    /** v0.1.107 — favoritos del menú (listas + dashboards) del usuario en el tenant activo. */
    @Get('favorites')
    @UseGuards(SessionGuard, TenantGuard)
    getFavorites(@Req() req: FastifyRequest): Promise<Favorites> {
        return this.me.getFavorites(tenantId(req), req.authUserId!);
    }

    /**
     * v0.1.260 — las vistas ancladas, resueltas en UN request (nombre, tipo,
     * icono y la lista a la que pertenecen). Las privadas ajenas no vuelven.
     */
    @Get('favorites/views')
    @UseGuards(SessionGuard, TenantGuard)
    favoriteViews(@Req() req: FastifyRequest): Promise<{ data: FavoriteView[] }> {
        return this.me.favoriteViews(tenantId(req), req.authUserId!).then((data) => ({ data }));
    }

    @Patch('favorites')
    @UseGuards(SessionGuard, TenantGuard)
    updateFavorites(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateFavoritesSchema)) patch: UpdateFavoritesInput,
    ): Promise<Favorites> {
        return this.me.setFavorites(tenantId(req), req.authUserId!, patch);
    }

    // ── Fase 7 — recorridos y guías (progreso por persona y empresa) ──────

    @Get('guides')
    @UseGuards(SessionGuard, TenantGuard)
    getGuides(@Req() req: FastifyRequest): Promise<GuideProgress> {
        return this.me.getGuideProgress(tenantId(req), req.authUserId!);
    }

    /**
     * Mezcla lo recibido con lo guardado. Durante una impersonación no se
     * escribe nada: el operador mirando la app como esta persona no debe
     * gastarle el ofrecimiento de bienvenida ni marcarle recorridos.
     */
    @Patch('guides')
    @UseGuards(SessionGuard, TenantGuard)
    updateGuides(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateGuideProgressSchema)) patch: UpdateGuideProgressInput,
    ): Promise<GuideProgress> {
        if (req.impersonatedBy !== undefined) return this.me.getGuideProgress(tenantId(req), req.authUserId!);
        return this.me.updateGuideProgress(tenantId(req), req.authUserId!, patch);
    }

    // ── v0.1.347 — la barra de abajo del celular ─────────────────────────

    /** La barra de la persona y la predeterminada del equipo. */
    @Get('mobile-nav')
    @UseGuards(SessionGuard, TenantGuard)
    getMobileNav(@Req() req: FastifyRequest): Promise<MobileNavState> {
        return this.me.getMobileNav(tenantId(req), req.authUserId!);
    }

    /**
     * Guarda la barra de la persona. Es una preferencia de la interfaz: vale
     * también con la cuenta en solo-lectura. Durante una impersonación no se
     * escribe nada (el operador no le cambia la barra a la persona).
     */
    @Put('mobile-nav')
    @AllowReadOnly()
    @UseGuards(SessionGuard, TenantGuard)
    setMobileNav(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(mobileNavConfigSchema)) config: MobileNavConfig,
    ): Promise<MobileNavState> {
        if (req.impersonatedBy !== undefined) return this.me.getMobileNav(tenantId(req), req.authUserId!);
        return this.me.setMobileNav(tenantId(req), req.authUserId!, config);
    }

    /** Vuelve a la del equipo (o a la de siempre). */
    @Delete('mobile-nav')
    @AllowReadOnly()
    @UseGuards(SessionGuard, TenantGuard)
    resetMobileNav(@Req() req: FastifyRequest): Promise<MobileNavState> {
        if (req.impersonatedBy !== undefined) return this.me.getMobileNav(tenantId(req), req.authUserId!);
        return this.me.setMobileNav(tenantId(req), req.authUserId!, null);
    }

    /** La barra predeterminada del equipo: sólo el admin de la empresa. */
    @Put('mobile-nav/team')
    @UseGuards(SessionGuard, TenantGuard)
    async setTeamMobileNav(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(mobileNavConfigSchema)) config: MobileNavConfig,
    ): Promise<MobileNavState> {
        assertAdmin(req);
        return this.me.setTeamMobileNav(tenantId(req), req.authUserId!, req.impersonatedBy ?? req.authUserId ?? null, config);
    }

    @Delete('mobile-nav/team')
    @UseGuards(SessionGuard, TenantGuard)
    async clearTeamMobileNav(@Req() req: FastifyRequest): Promise<MobileNavState> {
        assertAdmin(req);
        return this.me.setTeamMobileNav(tenantId(req), req.authUserId!, req.impersonatedBy ?? req.authUserId ?? null, null);
    }

    // ── v0.1.385 — «Más usadas» del menú de Listas ───────────────────────

    @Get('most-used')
    @AllowReadOnly()
    @UseGuards(SessionGuard, TenantGuard)
    getMostUsed(@Req() req: FastifyRequest): Promise<MostUsedState> {
        return this.me.getMostUsed(tenantId(req), req.authUserId!);
    }

    /**
     * Anota las visitas que el navegador juntó. Es una preferencia de la
     * interfaz: vale también en solo-lectura. Durante una impersonación no se
     * anota nada (lo que mira el operador no es uso de la persona).
     */
    @Post('most-used/visits')
    @HttpCode(200)
    @AllowReadOnly()
    @UseGuards(SessionGuard, TenantGuard)
    recordMostUsedVisits(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(recordMostUsedVisitsSchema)) body: RecordMostUsedVisitsInput,
    ): Promise<MostUsedState> {
        if (req.impersonatedBy !== undefined) return this.me.getMostUsed(tenantId(req), req.authUserId!);
        return this.me.recordMostUsedVisits(tenantId(req), req.authUserId!, body.visits);
    }

    /** Mostrar u ocultar la sección, o empezar de cero. */
    @Patch('most-used')
    @AllowReadOnly()
    @UseGuards(SessionGuard, TenantGuard)
    updateMostUsed(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateMostUsedSchema)) patch: UpdateMostUsedInput,
    ): Promise<MostUsedState> {
        if (req.impersonatedBy !== undefined) return this.me.getMostUsed(tenantId(req), req.authUserId!);
        return this.me.updateMostUsed(tenantId(req), req.authUserId!, patch);
    }

    // ── Datos personales (v0.1.121, GDPR art. 15 y 17) ──────────────────

    /** Todo lo que la app sabe de esta persona, en un JSON descargable. */
    @Get('data-export')
    @UseGuards(SessionGuard)
    exportData(@Req() req: FastifyRequest): Promise<AccountExport> {
        return this.account.exportData(req.authUserId!);
    }

    /**
     * Chequeo previo del borrado: las empresas donde es el único admin. La UI
     * lo muestra ANTES de pedir la contraseña para no frustrar al usuario.
     */
    @Get('deletion-blockers')
    @UseGuards(SessionGuard)
    async deletionBlockers(
        @Req() req: FastifyRequest,
    ): Promise<{ workspaces: Array<{ id: number; name: string }> }> {
        return { workspaces: await this.account.soleAdminWorkspaces(req.authUserId!) };
    }

    /** Borra la cuenta (anonimiza la identidad). Exige la contraseña. */
    @Post('delete-account')
    @HttpCode(204)
    @UseGuards(SessionGuard)
    async deleteAccount(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(deleteAccountSchema)) input: DeleteAccountInput,
    ): Promise<void> {
        await this.account.deleteAccount(req.authUserId!, input.password);
    }

    @Get('email-signature')
    @UseGuards(SessionGuard)
    async getSignature(@Req() req: FastifyRequest): Promise<{ signature: string }> {
        return { signature: await this.me.getEmailSignature(req.authUserId!) };
    }

    @Patch('email-signature')
    @UseGuards(SessionGuard)
    async updateSignature(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateEmailSignatureSchema)) input: UpdateEmailSignatureInput,
    ): Promise<{ signature: string }> {
        return { signature: await this.me.updateEmailSignature(req.authUserId!, input.signature) };
    }
}

function assertAdmin(req: FastifyRequest): void {
    if (req.tenant!.role !== 'admin') {
        throw new ForbiddenException({
            code: 'admin_only',
            message: 'Sólo el admin de la empresa puede elegir la barra del equipo',
            data: { status: 403 },
        });
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
