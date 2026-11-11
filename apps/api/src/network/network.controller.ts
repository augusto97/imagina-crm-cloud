import { Body, Controller, Get, HttpCode, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import proxyaddr from '@fastify/proxy-addr';
import {
    updatePlatformNetworkSchema,
    type NetCheckProbe,
    type NetworkCheckResult,
    type PlatformNetworkView,
    type UpdatePlatformNetworkInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { isCloudflareIp } from '../common/trust-proxy';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlatformNetworkService } from './platform-network.service';

/** Plataforma → Dominios → «Dirección rápida para los sitios web» (superadmin con contraseña). */
@Controller('platform/network')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformNetworkController {
    constructor(private readonly network: PlatformNetworkService) {}

    @Get()
    get(): PlatformNetworkView {
        return this.network.view();
    }

    @Put()
    update(@Body(new ZodValidationPipe(updatePlatformNetworkSchema)) input: UpdatePlatformNetworkInput): Promise<PlatformNetworkView> {
        return this.network.update(input);
    }

    @Post('check')
    @HttpCode(200)
    check(@Body(new ZodValidationPipe(updatePlatformNetworkSchema)) input: UpdatePlatformNetworkInput): Promise<NetworkCheckResult> {
        return this.network.check(input);
    }
}

/**
 * Lo que el servidor ve de quien pregunta (sin sesión). Lo usa «Comprobar»
 * para saber si una dirección llega a esta app y por dónde. No devuelve la
 * IP: sólo si es de Cloudflare.
 */
@Controller('public')
export class PublicNetCheckController {
    constructor(private readonly network: PlatformNetworkService) {}

    @Get('net-check')
    netCheck(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
        // La cadena tal cual: [socket, …X-Forwarded-For de derecha a izquierda].
        // Si se conectó el proxy de esta máquina, quien le habló a él es el siguiente.
        const chain = proxyaddr.all(req.raw);
        const socket = chain[0] ?? '';
        const local = /^(::ffff:)?127\./.test(socket) || socket === '::1';
        const peer = local ? (chain[1] ?? socket) : socket;
        const out: NetCheckProbe = {
            ok: true,
            app: this.network.fingerprint(),
            via_cloudflare: typeof req.headers['cf-ray'] === 'string',
            peer_is_cloudflare: isCloudflareIp(peer),
            ip_is_cloudflare: isCloudflareIp(req.ip),
        };
        reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex').send(out);
    }
}
