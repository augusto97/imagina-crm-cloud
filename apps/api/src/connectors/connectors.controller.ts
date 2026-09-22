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
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    connectionDraftTestSchema,
    connectorSettingsSchema,
    convertInlineSecretsSchema,
    createConnectionSchema,
    updateConnectionSchema,
    type Connection,
    type ConnectionDraftTestInput,
    type ConnectionTestResult,
    type ConnectionUsage,
    type ConnectorSettings,
    type ConnectorSettingsView,
    type ConvertInlineSecretsInput,
    type ConvertInlineSecretsResult,
    type CreateConnectionInput,
    type InlineSecretCandidate,
    type OAuthStartResult,
    type Role,
    type UpdateConnectionInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ConnectorsService } from './connectors.service';

/**
 * Conectores (v0.1.196, ADR-S22).
 *
 * Todo exige `manage_automations`: una conexión existe para USARSE desde una
 * automatización, así que quien no puede armar una tampoco tiene por qué ver
 * el inventario de credenciales de la empresa. El gate más fino (crear del
 * equipo = admin) lo aplica el service, que es quien conoce los ajustes.
 */
@Controller('connections')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('manage_automations')
export class ConnectorsController {
    constructor(private readonly connectors: ConnectorsService) {}

    @Get()
    async all(@Req() req: FastifyRequest): Promise<{ data: Connection[] }> {
        const data = await this.connectors.list(tenantId(req), userId(req), role(req));
        return { data };
    }

    @Get('settings')
    async settings(@Req() req: FastifyRequest): Promise<{ data: ConnectorSettingsView }> {
        const settings = await this.connectors.settings(tenantId(req));
        return { data: { ...settings, can_manage: role(req) === 'admin' } };
    }

    @Patch('settings')
    async updateSettings(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(connectorSettingsSchema)) input: ConnectorSettings,
    ): Promise<{ data: ConnectorSettingsView }> {
        assertAdmin(req);
        const settings = await this.connectors.updateSettings(tenantId(req), input);
        return { data: { ...settings, can_manage: true } };
    }

    /** Secretos que hoy viven dentro de las acciones, listos para convertir. */
    @Get('inline-secrets')
    async inline(@Req() req: FastifyRequest): Promise<{ data: InlineSecretCandidate[] }> {
        const data = await this.connectors.scanInline(tenantId(req));
        return { data };
    }

    @Post('convert-inline')
    async convert(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(convertInlineSecretsSchema)) input: ConvertInlineSecretsInput,
    ): Promise<{ data: ConvertInlineSecretsResult }> {
        const data = await this.connectors.convertInline(
            tenantId(req),
            userId(req),
            role(req),
            input,
        );
        return { data };
    }

    /** Prueba el formulario (con o sin conexión guardada detrás). */
    @Post('test')
    @HttpCode(200)
    async test(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(connectionDraftTestSchema)) input: ConnectionDraftTestInput,
    ): Promise<{ data: ConnectionTestResult }> {
        const data = await this.connectors.test(tenantId(req), userId(req), role(req), input);
        return { data };
    }

    @Post()
    async create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createConnectionSchema)) input: CreateConnectionInput,
    ): Promise<{ data: Connection }> {
        const data = await this.connectors.create(tenantId(req), userId(req), role(req), input);
        return { data };
    }

    /** Arranca la autorización OAuth2: devuelve la URL del proveedor. */
    @Post(':id/oauth/start')
    @HttpCode(200)
    async oauthStart(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: OAuthStartResult }> {
        const data = await this.connectors.startOAuth(tenantId(req), userId(req), role(req), id);
        return { data };
    }

    /** Borra los tokens guardados; la app registrada en el proveedor queda. */
    @Post(':id/oauth/disconnect')
    @HttpCode(200)
    async oauthDisconnect(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: Connection }> {
        const data = await this.connectors.disconnectOAuth(
            tenantId(req),
            userId(req),
            role(req),
            id,
        );
        return { data };
    }

    @Get(':id/usage')
    async usage(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: ConnectionUsage[] }> {
        const data = await this.connectors.usage(tenantId(req), id);
        return { data };
    }

    @Patch(':id')
    async update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateConnectionSchema)) input: UpdateConnectionInput,
    ): Promise<{ data: Connection }> {
        const data = await this.connectors.update(tenantId(req), userId(req), role(req), id, input);
        return { data };
    }

    @Delete(':id')
    @HttpCode(204)
    async remove(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Query('force') force?: string,
    ): Promise<void> {
        await this.connectors.remove(
            tenantId(req),
            userId(req),
            role(req),
            id,
            force === '1' || force === 'true',
        );
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function userId(req: FastifyRequest): number {
    return req.authUserId!;
}

function role(req: FastifyRequest): Role {
    return req.tenant!.role as Role;
}

function assertAdmin(req: FastifyRequest): void {
    if (role(req) !== 'admin') {
        throw new ForbiddenException({
            code: 'admin_only',
            message: 'Sólo el admin del workspace puede editar esta configuración',
            data: { status: 403 },
        });
    }
}
