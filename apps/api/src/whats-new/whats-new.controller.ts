import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    createWhatsNewSchema,
    markWhatsNewSeenSchema,
    updateWhatsNewSchema,
    whatsNewEventSchema,
    whatsNewFeedQuerySchema,
    type CreateWhatsNewInput,
    type MarkWhatsNewSeenInput,
    type PlatformWhatsNewEntry,
    type PlatformWhatsNewList,
    type UpdateWhatsNewInput,
    type WhatsNewEventInput,
    type WhatsNewFeed,
    type WhatsNewFeedQuery,
    type WhatsNewImageUpload,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowGuest } from '../tenancy/allow-guest.decorator';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { IMAGE_MIME_BY_EXT } from './image-sniff';
import { WhatsNewAdminService } from './whats-new-admin.service';
import { WhatsNewService, type WhatsNewViewer } from './whats-new.service';

function viewerOf(req: FastifyRequest): WhatsNewViewer {
    return {
        userId: req.authUserId!,
        tenantId: req.tenant!.tenantId,
        baseRole: req.tenant!.role,
        impersonating: req.impersonatedBy !== undefined,
    };
}

/**
 * Las novedades de la persona en la empresa activa (el rol y el plan deciden
 * qué ve; lo visto es de la persona). Un invitado entra, pero sólo le llegan
 * avisos (lo filtra el servicio). Marcar no toca datos de la empresa: vale en
 * solo-lectura. El cliente del portal no llega aquí (TenantGuard lo rechaza).
 */
@Controller('me/whats-new')
@UseGuards(SessionGuard, TenantGuard)
export class WhatsNewController {
    constructor(private readonly svc: WhatsNewService) {}

    @Get()
    @AllowGuest()
    feed(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(whatsNewFeedQuerySchema)) q: WhatsNewFeedQuery,
    ): Promise<WhatsNewFeed> {
        return this.svc.feed(viewerOf(req), q);
    }

    @Post('seen')
    @AllowGuest()
    @AllowReadOnly()
    @HttpCode(200)
    seen(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(markWhatsNewSeenSchema)) body: MarkWhatsNewSeenInput,
    ): Promise<{ unseen_count: number }> {
        return this.svc.markSeen(viewerOf(req), body);
    }

    @Post(':id/events')
    @AllowGuest()
    @AllowReadOnly()
    @HttpCode(200)
    async event(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(whatsNewEventSchema)) body: WhatsNewEventInput,
    ): Promise<{ ok: true }> {
        await this.svc.event(viewerOf(req), id, body.event);
        return { ok: true };
    }
}

/**
 * Plataforma → Novedades (operador). Superadmin con sesión de contraseña.
 */
@Controller('platform/whats-new')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformWhatsNewController {
    constructor(private readonly admin: WhatsNewAdminService) {}

    @Get()
    list(): Promise<PlatformWhatsNewList> {
        return this.admin.list();
    }

    @Post()
    @HttpCode(201)
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createWhatsNewSchema)) input: CreateWhatsNewInput,
    ): Promise<PlatformWhatsNewEntry> {
        return this.admin.create(input, req.authUserId!);
    }

    /** Sube una imagen (multipart, campo `file`). Devuelve su URL pública. */
    @Post('images')
    @HttpCode(201)
    async uploadImage(@Req() req: FastifyRequest): Promise<WhatsNewImageUpload> {
        const part = await req.file();
        if (!part) {
            throw new BadRequestException({ code: 'missing_file', message: 'Falta la imagen', data: { status: 400 } });
        }
        return this.admin.uploadImage(part.file);
    }

    @Patch(':id')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateWhatsNewSchema)) input: UpdateWhatsNewInput,
    ): Promise<PlatformWhatsNewEntry> {
        return this.admin.update(id, input, req.authUserId!);
    }

    @Post(':id/restore')
    @HttpCode(200)
    restore(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<PlatformWhatsNewEntry> {
        return this.admin.restore(id, req.authUserId!);
    }

    @Delete(':id')
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.admin.remove(id, req.authUserId!);
    }
}

/**
 * Las imágenes de las novedades, SIN sesión: una novedad no es secreta (y así
 * se ven también en la pantalla de la persona sin armar URLs firmadas). El
 * nombre es aleatorio y el tipo se decidió por los bytes al subir; se sirven
 * con `nosniff` y `CSP: sandbox`, y se cachean para siempre (el nombre no se
 * reutiliza).
 */
@Controller('public/whats-new')
export class WhatsNewImagesController {
    constructor(private readonly admin: WhatsNewAdminService) {}

    @Get('images/:name')
    async image(@Param('name') name: string, @Res() reply: FastifyReply): Promise<void> {
        const stream = await this.admin.openImage(name);
        if (!stream) {
            void reply.code(404).send({ code: 'not_found', message: 'No encontrada', data: { status: 404 } });
            return;
        }
        const ext = name.slice(name.lastIndexOf('.') + 1) as keyof typeof IMAGE_MIME_BY_EXT;
        stream.on('error', () => reply.raw.destroy());
        void reply
            .header('content-type', IMAGE_MIME_BY_EXT[ext])
            .header('content-disposition', 'inline')
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "default-src 'none'; sandbox")
            .header('cache-control', 'public, max-age=31536000, immutable')
            .send(stream);
    }
}
