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
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    shareListWithGuestSchema,
    shareRecordSchema,
    updateGuestLevelSchema,
    type GuestInviteResult,
    type GuestLevel,
    type GuestSummary,
    type RecordShareDto,
    type ShareRecordInput,
    type SharedWithMeDto,
    type UpdateGuestLevelInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { AllowGuest } from '../tenancy/allow-guest.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { GuestsService } from './guests.service';

/**
 * C3 — Compartir una LISTA entera con alguien de afuera. Mismo permiso que
 * los accesos por persona de la lista (`manage_lists`).
 */
@Controller('lists/:list/guests')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ListGuestsController {
    constructor(private readonly guests: GuestsService) {}

    @Get()
    @RequireCapability('manage_lists')
    async all(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
    ): Promise<{ data: Array<{ user_id: number; name: string; email: string; pending: boolean; level: GuestLevel }> }> {
        return { data: await this.guests.listGuestsOfList(req.tenant!.tenantId, list) };
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_lists')
    share(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(shareListWithGuestSchema)) input: ShareRecordInput,
    ): Promise<GuestInviteResult> {
        return this.guests.shareList(req.tenant!.tenantId, actor(req), list, input);
    }

    @Patch(':userId')
    @RequireCapability('manage_lists')
    async setLevel(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('userId', ParseIntPipe) userId: number,
        @Body(new ZodValidationPipe(updateGuestLevelSchema)) input: UpdateGuestLevelInput,
    ): Promise<{ ok: true }> {
        await this.guests.setListLevel(req.tenant!.tenantId, actor(req), list, userId, input.level);
        return { ok: true };
    }

    @Delete(':userId')
    @HttpCode(204)
    @RequireCapability('manage_lists')
    async unshare(@Req() req: FastifyRequest, @Param('list') list: string, @Param('userId', ParseIntPipe) userId: number): Promise<void> {
        await this.guests.setListLevel(req.tenant!.tenantId, actor(req), list, userId, null);
    }
}

/**
 * C3 — Ficha → «Compartir este registro». Quien comparte tiene que poder
 * EDITAR el registro (lo exige el service, fila por fila).
 */
@Controller('lists/:list/records/:recordId/shares')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordSharesController {
    constructor(private readonly guests: GuestsService) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    async all(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
    ): Promise<{ data: RecordShareDto[] }> {
        return { data: await this.guests.listRecordShares(req.tenant!.tenantId, actor(req), list, recordId) };
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    share(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(shareRecordSchema)) input: ShareRecordInput,
    ): Promise<RecordShareDto> {
        return this.guests.shareRecord(req.tenant!.tenantId, actor(req), list, recordId, input);
    }

    @Patch(':shareId')
    @RequireCapability('edit_records', 'edit_own_records')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('shareId', ParseIntPipe) shareId: number,
        @Body(new ZodValidationPipe(updateGuestLevelSchema)) input: UpdateGuestLevelInput,
    ): Promise<RecordShareDto> {
        return this.guests.updateRecordShare(req.tenant!.tenantId, actor(req), list, recordId, shareId, input.level);
    }

    @Delete(':shareId')
    @HttpCode(204)
    @RequireCapability('edit_records', 'edit_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('shareId', ParseIntPipe) shareId: number,
    ): Promise<void> {
        await this.guests.deleteRecordShare(req.tenant!.tenantId, actor(req), list, recordId, shareId);
    }
}

/** C3 — Ajustes → Miembros → «Invitados» (sólo el admin, como Miembros). */
@Controller('workspaces/current/guests')
@UseGuards(SessionGuard, TenantGuard)
export class WorkspaceGuestsController {
    constructor(private readonly guests: GuestsService) {}

    @Get()
    async all(@Req() req: FastifyRequest): Promise<{ data: GuestSummary[] }> {
        assertAdmin(req);
        return { data: await this.guests.listGuests(req.tenant!.tenantId) };
    }

    @Post(':userId/resend-invite')
    @HttpCode(202)
    async resend(@Req() req: FastifyRequest, @Param('userId', ParseIntPipe) userId: number): Promise<{ ok: true }> {
        assertAdmin(req);
        await this.guests.resendInvite(req.tenant!.tenantId, userId);
        return { ok: true };
    }

    @Delete(':userId')
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('userId', ParseIntPipe) userId: number): Promise<void> {
        assertAdmin(req);
        await this.guests.removeGuest(req.tenant!.tenantId, req.authUserId!, userId);
    }
}

/** C3 — Lo que ve un invitado: «Compartido conmigo». */
@Controller('me/shared')
@UseGuards(SessionGuard, TenantGuard)
export class SharedWithMeController {
    constructor(private readonly guests: GuestsService) {}

    @Get()
    @AllowGuest()
    async mine(@Req() req: FastifyRequest): Promise<{ data: SharedWithMeDto }> {
        return { data: await this.guests.sharedWithMe(req.tenant!.tenantId, req.authUserId!) };
    }
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

function assertAdmin(req: FastifyRequest): void {
    if (req.tenant!.role !== 'admin') {
        throw new ForbiddenException({ code: 'admin_only', message: 'Sólo un admin puede gestionar los invitados', data: { status: 403 } });
    }
}
