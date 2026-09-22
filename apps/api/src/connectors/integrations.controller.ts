import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
    authorizeIntegrationSchema,
    connectIntegrationKeySchema,
    integrationKeySchema,
    verifyIntegrationSchema,
    type AuthorizeIntegrationInput,
    type ConnectIntegrationKeyInput,
    type Connection,
    type IntegrationKey,
    type IntegrationsOverview,
    type OAuthStartResult,
    type Role,
    type VerifyIntegrationInput,
    type VerifyIntegrationResult,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ConnectorsService } from './connectors.service';

/**
 * Galería de apps de la empresa (v0.1.203, ADR-S22 fase 4).
 *
 * Mismo gate que los conectores (`manage_automations`): una app se conecta
 * para usarla desde una automatización. Quién puede conectar para TODO el
 * equipo (admin) o sólo para sí (conexiones privadas habilitadas) lo decide el
 * service, que conoce los ajustes.
 */
@Controller('integrations')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('manage_automations')
export class IntegrationsController {
    constructor(private readonly connectors: ConnectorsService) {}

    @Get()
    async overview(@Req() req: FastifyRequest): Promise<{ data: IntegrationsOverview }> {
        const data = await this.connectors.integrationsOverview(tenantId(req), userId(req), role(req));
        return { data };
    }

    /** Prueba la clave de una app antes de guardarla (y lista cuentas, si aplica). */
    @Post(':key/verify')
    @HttpCode(200)
    async verify(
        @Req() req: FastifyRequest,
        @Param('key') key: string,
        @Body(new ZodValidationPipe(verifyIntegrationSchema)) input: VerifyIntegrationInput,
    ): Promise<{ data: VerifyIntegrationResult }> {
        const data = await this.connectors.verifyIntegration(tenantId(req), userId(req), role(req), parseKey(key), input);
        return { data };
    }

    /** Conecta una app por clave (WhatsApp, Telegram) o actualiza su clave. */
    @Post(':key/connect')
    async connect(
        @Req() req: FastifyRequest,
        @Param('key') key: string,
        @Body(new ZodValidationPipe(connectIntegrationKeySchema)) input: ConnectIntegrationKeyInput,
    ): Promise<{ data: Connection; meta: { warning: string | null } }> {
        const { connection, warning } = await this.connectors.connectIntegrationKey(
            tenantId(req),
            userId(req),
            role(req),
            parseKey(key),
            input,
        );
        return { data: connection, meta: { warning } };
    }

    /** «Conectar» una app OAuth: devuelve la URL del proveedor. */
    @Post(':key/authorize')
    @HttpCode(200)
    async authorize(
        @Req() req: FastifyRequest,
        @Param('key') key: string,
        @Body(new ZodValidationPipe(authorizeIntegrationSchema)) input: AuthorizeIntegrationInput,
    ): Promise<{ data: OAuthStartResult }> {
        const data = await this.connectors.startIntegrationOAuth(
            tenantId(req),
            userId(req),
            role(req),
            parseKey(key),
            input,
        );
        return { data };
    }
}

function parseKey(raw: string): IntegrationKey {
    const parsed = integrationKeySchema.safeParse(raw);
    if (!parsed.success) {
        throw new BadRequestException({
            code: 'integration_unknown',
            message: 'Esa app no existe.',
            data: { status: 400 },
        });
    }
    return parsed.data;
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
