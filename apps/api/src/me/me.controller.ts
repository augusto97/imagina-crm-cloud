import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    updateEmailSignatureSchema,
    updateFavoritesSchema,
    type Favorites,
    type MeUserSummary,
    type UpdateEmailSignatureInput,
    type UpdateFavoritesInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { MeService } from './me.service';

/**
 * Recursos del usuario autenticado (`/me/*`). El search/lookup de usuarios es
 * tenant-scoped (pickers de menciones/asignación); la firma de email es
 * personal y no necesita tenant resuelto.
 */
@Controller('me')
export class MeController {
    constructor(private readonly me: MeService) {}

    @Get('users-search')
    @UseGuards(SessionGuard, TenantGuard)
    async searchUsers(
        @Req() req: FastifyRequest,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<{ data: MeUserSummary[] }> {
        const parsedLimit = limit === undefined ? undefined : Number(limit);
        return { data: await this.me.searchUsers(tenantId(req), q ?? '', parsedLimit) };
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

    @Get('users/:id')
    @UseGuards(SessionGuard, TenantGuard)
    getUser(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<MeUserSummary> {
        return this.me.getUser(tenantId(req), id);
    }

    /** v0.1.107 — favoritos del menú (listas + dashboards) del usuario en el tenant activo. */
    @Get('favorites')
    @UseGuards(SessionGuard, TenantGuard)
    getFavorites(@Req() req: FastifyRequest): Promise<Favorites> {
        return this.me.getFavorites(tenantId(req), req.authUserId!);
    }

    @Patch('favorites')
    @UseGuards(SessionGuard, TenantGuard)
    updateFavorites(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateFavoritesSchema)) patch: UpdateFavoritesInput,
    ): Promise<Favorites> {
        return this.me.setFavorites(tenantId(req), req.authUserId!, patch);
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

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
