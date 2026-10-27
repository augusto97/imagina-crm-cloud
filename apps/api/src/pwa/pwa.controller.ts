import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpException,
    HttpStatus,
    Inject,
    Param,
    ParseIntPipe,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    pushSubscribeSchema,
    pushUnsubscribeSchema,
    type PushDeviceDto,
    type PushStatusDto,
    type PushSubscribeInput,
    type PushTestResult,
    type PushUnsubscribeInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DomainsService } from '../domains/domains.service';
import { REDIS } from '../redis/redis.module';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { buildManifest } from './manifest';
import { PushService } from './push.service';

function hostOf(req: FastifyRequest): string | undefined {
    const fwd = req.headers['x-forwarded-host'];
    return (Array.isArray(fwd) ? fwd[0] : fwd) ?? req.headers.host;
}

/**
 * H1 — El manifiesto de la app instalable, por Host (sin sesión): lo pide el
 * navegador desde el `<link rel="manifest">` del SPA. Mismo origen que la app
 * (la CSP sigue cerrada: `manifest-src` cae en `default-src 'self'`).
 */
@Controller('public')
export class PwaManifestController {
    constructor(private readonly domains: DomainsService) {}

    @Get('manifest.webmanifest')
    async manifest(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
        const boot = await this.domains.resolveHost(hostOf(req)).catch(() => ({ tenant: null }));
        const manifest = buildManifest({
            tenant: boot.tenant ? { name: boot.tenant.name, app_name: boot.tenant.app_name, primary_color: boot.tenant.primary_color, app_bar_color: boot.tenant.app_bar_color ?? null } : null,
        });
        void reply
            .header('content-type', 'application/manifest+json; charset=utf-8')
            // Cambia poco (nombre y color de la empresa); 10 minutos alcanza.
            .header('cache-control', 'public, max-age=600')
            .header('vary', 'Host, X-Forwarded-Host')
            .send(JSON.stringify(manifest));
    }
}

/**
 * H1 — Notificaciones push de la persona en la empresa activa: activar en este
 * dispositivo, ver/quitar dispositivos y mandarse una prueba. Como las
 * preferencias de avisos, no toca datos de la empresa: vale en solo-lectura.
 * El rol `client` del portal no llega aquí (TenantGuard lo rechaza).
 */
@Controller('me/push')
@UseGuards(SessionGuard, TenantGuard)
export class PushController {
    constructor(
        private readonly push: PushService,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    @Get()
    async status(@Req() req: FastifyRequest): Promise<{ data: PushStatusDto }> {
        return { data: await this.push.status(req.tenant!.tenantId, req.authUserId!) };
    }

    @Post('subscriptions')
    @AllowReadOnly()
    async subscribe(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(pushSubscribeSchema)) body: PushSubscribeInput,
    ): Promise<{ data: PushDeviceDto }> {
        const ua = String(req.headers['user-agent'] ?? '');
        const data = await this.push.subscribe(
            req.tenant!.tenantId,
            { userId: req.authUserId!, sessionToken: req.sessionToken!, impersonated: req.impersonatedBy !== undefined },
            body,
            ua,
        );
        return { data };
    }

    @Post('unsubscribe')
    @HttpCode(204)
    @AllowReadOnly()
    async unsubscribe(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(pushUnsubscribeSchema)) body: PushUnsubscribeInput,
    ): Promise<void> {
        await this.push.unsubscribe(req.tenant!.tenantId, req.authUserId!, body.endpoint);
    }

    @Delete('subscriptions/:id')
    @HttpCode(204)
    @AllowReadOnly()
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.push.remove(req.tenant!.tenantId, req.authUserId!, id);
    }

    @Post('test')
    @HttpCode(200)
    @AllowReadOnly()
    async test(@Req() req: FastifyRequest): Promise<{ data: PushTestResult }> {
        // La prueba no tiene el tope por hora de los avisos: un freno propio
        // (5 cada 10 minutos) para que no sirva para inundar un dispositivo.
        const key = `pushtest:${req.tenant!.tenantId}:${req.authUserId!}`;
        const n = await this.redis.incr(key).catch(() => 1);
        if (n === 1) await this.redis.expire(key, 600).catch(() => undefined);
        if (n > 5) {
            throw new HttpException(
                { code: 'push_test_limit', message: 'Ya enviaste varias pruebas: espera unos minutos', data: { status: 429 } },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        return { data: await this.push.sendTest(req.tenant!.tenantId, req.authUserId!) };
    }
}
