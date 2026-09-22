import { Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from './connectors.service';

/**
 * Vuelta del proveedor OAuth (v0.1.199, ADR-S22 fase 3).
 *
 * Va en un controller APARTE del de conectores por dos motivos:
 *  - El navegador vuelve por un redirect del proveedor: manda la cookie de
 *    sesión pero NO el header `X-Tenant-Id`, así que no puede pasar por el
 *    `TenantGuard`. La empresa sale del `state` que emitimos nosotros.
 *  - Es la ÚNICA URI de redirección registrada en el proveedor, así que su
 *    ruta tiene que ser fija y previsible.
 *
 * La respuesta es un redirect al panel: quien está mirando es una persona en
 * su navegador, no un cliente de API.
 */
@Controller('connections/oauth')
@UseGuards(SessionGuard)
export class ConnectorsOAuthController {
    constructor(
        private readonly connectors: ConnectorsService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    @Get('callback')
    async callback(
        @Req() req: FastifyRequest,
        @Res() reply: FastifyReply,
        @Query('code') code?: string,
        @Query('state') state?: string,
        @Query('error') error?: string,
        @Query('error_description') errorDescription?: string,
    ): Promise<void> {
        const panel = `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/cloud/index.html#/settings?s=conectores`;

        // El proveedor puede volver con un error en vez de un código (la
        // persona canceló, o la app no tiene permiso): se muestra tal cual.
        if (error) {
            const detail = errorDescription ? `${error}: ${errorDescription}` : error;
            await reply.redirect(`${panel}&oauth=error&msg=${encodeURIComponent(detail)}`, 302);
            return;
        }

        const result = await this.connectors.completeOAuth(
            req.authUserId!,
            code ?? '',
            state ?? '',
        );
        const suffix = result.ok
            ? '&oauth=ok'
            : `&oauth=error&msg=${encodeURIComponent(result.error ?? 'Error desconocido')}`;
        await reply.redirect(panel + suffix, 302);
    }
}
