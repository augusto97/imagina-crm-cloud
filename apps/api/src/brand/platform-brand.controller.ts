import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import {
    updatePlatformBrandSchema,
    type PlatformBrand,
    type PlatformBrandImage,
    type UpdatePlatformBrandInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlatformBrandService } from './platform-brand.service';

/** Plataforma → Marca (superadmin con sesión de contraseña). */
@Controller('platform/brand')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformBrandController {
    constructor(private readonly brand: PlatformBrandService) {}

    @Get()
    get(): Promise<PlatformBrand> {
        return this.brand.get();
    }

    @Put()
    update(
        @Body(new ZodValidationPipe(updatePlatformBrandSchema)) input: UpdatePlatformBrandInput,
    ): Promise<PlatformBrand> {
        return this.brand.update(input);
    }

    /** Sube un PNG (multipart, campo `file`). Devuelve su URL pública y su tamaño. */
    @Post('images')
    @HttpCode(201)
    async upload(@Req() req: FastifyRequest): Promise<PlatformBrandImage> {
        const part = await req.file();
        if (!part) {
            throw new BadRequestException({ code: 'missing_file', message: 'Falta la imagen', data: { status: 400 } });
        }
        return this.brand.uploadImage(part.file);
    }
}

/**
 * Las imágenes de la marca, SIN sesión: el login, la pantalla de arranque y
 * el manifiesto las piden antes de entrar. PNG por sus bytes, `nosniff`,
 * `CSP: sandbox`, y cache para siempre (el nombre no se reutiliza).
 */
@Controller('public/brand')
export class PublicBrandController {
    constructor(private readonly brand: PlatformBrandService) {}

    @Get('images/:name')
    async image(@Param('name') name: string, @Res() reply: FastifyReply): Promise<void> {
        const stream = await this.brand.openImage(name);
        if (!stream) {
            void reply.code(404).send({ code: 'not_found', message: 'No encontrada', data: { status: 404 } });
            return;
        }
        stream.on('error', () => reply.raw.destroy());
        void reply
            .header('content-type', 'image/png')
            .header('content-disposition', 'inline')
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "default-src 'none'; sandbox")
            .header('cache-control', 'public, max-age=31536000, immutable')
            .send(stream);
    }
}
