import { Body, Controller, Get, Patch, Res, UseGuards } from '@nestjs/common';
import { updatePlatformLegalSchema, type PlatformLegalView, type UpdatePlatformLegalInput } from '@imagina-base/shared';
import type { FastifyReply } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LegalService } from './legal.service';

/**
 * Páginas públicas de la plataforma: inicio, privacidad y condiciones.
 * Sin sesión e indexables (Google las revisa). CSP cerrada: no corre nada.
 */
@Controller('public/legal')
export class PublicLegalController {
    constructor(private readonly legal: LegalService) {}

    @Get()
    async home(@Res() reply: FastifyReply): Promise<void> {
        this.send(reply, await this.legal.render('home'));
    }

    @Get('privacidad')
    async privacy(@Res() reply: FastifyReply): Promise<void> {
        this.send(reply, await this.legal.render('privacy'));
    }

    @Get('terminos')
    async terms(@Res() reply: FastifyReply): Promise<void> {
        this.send(reply, await this.legal.render('terms'));
    }

    private send(reply: FastifyReply, html: string): void {
        reply
            .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            .header('X-Content-Type-Options', 'nosniff')
            .header('Cache-Control', 'public, max-age=300')
            .type('text/html; charset=utf-8')
            .send(html);
    }
}

/** Plataforma → Integraciones → «Páginas públicas» (superadmin). */
@Controller('platform/legal')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformLegalController {
    constructor(private readonly legal: LegalService) {}

    @Get()
    get(): Promise<PlatformLegalView> {
        return this.legal.view();
    }

    @Patch()
    update(
        @Body(new ZodValidationPipe(updatePlatformLegalSchema)) input: UpdatePlatformLegalInput,
    ): Promise<PlatformLegalView> {
        return this.legal.update(input);
    }
}
