import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    addSiteObjectsSchema,
    applySiteKitSchema,
    runSiteSyncSchema,
    setupSiteSyncSchema,
    siteColumnChangeSchema,
    startWordpressConnectSchema,
    updateSiteSyncSchema,
    type AddSiteObjectsInput,
    type ApplySiteKitInput,
    type Role,
    type RunSiteSyncInput,
    type SetupSiteSyncInput,
    type SiteColumnChangeInput,
    type SiteDiscovery,
    type SiteKitResult,
    type SiteSyncStatus,
    type StartWordpressConnectInput,
    type StartWordpressConnectResult,
    type UpdateSiteSyncInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SiteKitsService } from './site-kits.service';
import { SiteSyncService } from './site-sync.service';
import { WordpressConnectService } from './wordpress-connect.service';

/**
 * Sincronización con sitios WordPress (v0.1.333, ADR-S83). Crea listas y trae
 * datos de afuera a nombre de la empresa: exige `manage_lists` y, en el
 * service, poder EDITAR la conexión del sitio (igual que la tienda).
 */
@Controller('connections/:id/site-sync')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('manage_lists')
export class SiteSyncController {
    constructor(
        private readonly sync: SiteSyncService,
        private readonly kits: SiteKitsService,
    ) {}

    @Get()
    async status(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SiteSyncStatus }> {
        return { data: await this.sync.status(tenant(req), user(req), role(req), id) };
    }

    /** Qué tiene el sitio: tipos de contenido, taxonomías y campos de plugins (con ejemplo). */
    @Get('discover')
    async discover(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SiteDiscovery }> {
        return { data: await this.sync.discover(tenant(req), user(req), role(req), id) };
    }

    @Post()
    @HttpCode(201)
    async setup(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(setupSiteSyncSchema)) input: SetupSiteSyncInput,
    ): Promise<{ data: SiteSyncStatus }> {
        return { data: await this.sync.setup(tenant(req), user(req), role(req), id, input) };
    }

    /** Sumar otro tipo de contenido o taxonomía a un sitio que ya sincroniza. */
    @Post('objects')
    async addObjects(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(addSiteObjectsSchema)) input: AddSiteObjectsInput,
    ): Promise<{ data: SiteSyncStatus }> {
        return { data: await this.sync.addObjects(tenant(req), user(req), role(req), id, input) };
    }

    @Patch()
    async update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateSiteSyncSchema)) input: UpdateSiteSyncInput,
    ): Promise<{ data: SiteSyncStatus }> {
        return { data: await this.sync.update(tenant(req), user(req), role(req), id, input) };
    }

    @Post('run')
    @HttpCode(202)
    async run(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(runSiteSyncSchema)) input: RunSiteSyncInput,
    ): Promise<{ data: SiteSyncStatus }> {
        return { data: await this.sync.runNow(tenant(req), user(req), role(req), id, input.full) };
    }

    /** Traer una columna más (un campo de ACF, una taxonomía…). */
    @Post('columns')
    async addColumn(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(siteColumnChangeSchema)) input: SiteColumnChangeInput,
    ): Promise<{ data: SiteSyncStatus }> {
        return { data: await this.sync.addColumn(tenant(req), user(req), role(req), id, input) };
    }

    /** Dejar de traer una columna (el campo QUEDA como columna propia). */
    @Post('columns/remove')
    @HttpCode(200)
    async removeColumn(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(siteColumnChangeSchema)) input: SiteColumnChangeInput,
    ): Promise<{ data: SiteSyncStatus }> {
        return { data: await this.sync.removeColumn(tenant(req), user(req), role(req), id, input) };
    }

    /**
     * Armar un kit en una lista del sitio (auditoría SEO, texto alternativo):
     * columnas del sitio, fórmulas, vistas y un campo con IA (ADR-S84).
     */
    @Post('kits')
    async applyKit(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(applySiteKitSchema)) input: ApplySiteKitInput,
    ): Promise<{ data: SiteKitResult }> {
        return { data: await this.kits.apply(tenant(req), user(req), role(req), id, input) };
    }

    /** Dejar de sincronizar: las listas QUEDAN y pasan a ser listas comunes. */
    @Delete()
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.sync.remove(tenant(req), user(req), role(req), id);
    }
}

/**
 * «Conectar en un clic»: la dirección del sitio → la pantalla «Autorizar
 * aplicación» de WordPress. Mismo gate que el resto de la galería de apps
 * (`manage_automations`; quién conecta para el equipo lo decide el service).
 */
@Controller('integrations/wordpress')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('manage_automations')
export class WordpressConnectController {
    constructor(private readonly connect: WordpressConnectService) {}

    @Post('start')
    @HttpCode(200)
    async start(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(startWordpressConnectSchema)) input: StartWordpressConnectInput,
    ): Promise<{ data: StartWordpressConnectResult }> {
        return { data: await this.connect.start(tenant(req), user(req), role(req), input) };
    }
}

/**
 * La vuelta de «Autorizar aplicación». Como la del OAuth (ADR-S22 fase 3), va
 * aparte: el navegador vuelve por un redirect de WordPress, con la cookie de
 * sesión pero SIN `X-Tenant-Id`; la empresa sale del `state` que emitimos.
 * Responde con un redirect al panel: quien mira es una persona.
 */
@Controller('connections/wordpress')
@UseGuards(SessionGuard)
export class WordpressCallbackController {
    constructor(
        private readonly connect: WordpressConnectService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    @Get('callback')
    async callback(
        @Req() req: FastifyRequest,
        @Res() reply: FastifyReply,
        @Query('state') state?: string,
        @Query('success') success?: string,
        @Query('user_login') userLogin?: string,
        @Query('password') password?: string,
    ): Promise<void> {
        const app = `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/cloud/index.html#`;
        const result = await this.connect.complete(req.authUserId!, { state, success, user_login: userLogin, password });
        if (result.ok && result.connectionId !== null) {
            const warning = result.warning ? `&warning=${encodeURIComponent(result.warning)}` : '';
            await reply.redirect(`${app}/settings/sites/${result.connectionId}?connected=1${warning}`, 302);
            return;
        }
        await reply.redirect(`${app}/settings?s=conectores&oauth=error&msg=${encodeURIComponent(result.error ?? 'Error desconocido')}`, 302);
    }
}

function tenant(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function user(req: FastifyRequest): number {
    return req.authUserId!;
}

function role(req: FastifyRequest): Role {
    return req.tenant!.role as Role;
}
