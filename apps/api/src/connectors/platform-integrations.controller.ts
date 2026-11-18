import { BadRequestException, Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
    integrationKeySchema,
    integrationProviderSchema,
    updateIntegrationCatalogSchema,
    updatePlatformIntegrationAppSchema,
    type PlatformIntegrationCatalogItem,
    type UpdateIntegrationCatalogInput,
    type PlatformIntegrationApp,
    type PlatformIntegrations,
    type UpdatePlatformIntegrationAppInput,
} from '@imagina-base/shared';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConnectorsService } from './connectors.service';
import { IntegrationAppsService } from './integration-apps.service';
import { IntegrationCatalogService } from './integration-catalog.service';

/**
 * Plataforma → Integraciones (superadmin, v0.1.203).
 *
 * Aquí el operador registra UNA vez la app de cada proveedor (Google,
 * Microsoft, Slack). Es lo que le permite a cada empresa conectar su cuenta
 * con un botón, sin ver jamás un client id ni una URL de tokens.
 */
@Controller('platform/integrations')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformIntegrationsController {
    constructor(
        private readonly apps: IntegrationAppsService,
        private readonly connectors: ConnectorsService,
        private readonly catalog: IntegrationCatalogService,
    ) {}

    /** v0.1.438 — Qué apps se ofrecen a las empresas y cuáles van marcadas beta. */
    @Get('catalog')
    async getCatalog(): Promise<{ data: PlatformIntegrationCatalogItem[] }> {
        return { data: await this.catalog.list() };
    }

    @Patch('catalog/:key')
    async updateCatalog(
        @Param('key') raw: string,
        @Body(new ZodValidationPipe(updateIntegrationCatalogSchema)) input: UpdateIntegrationCatalogInput,
    ): Promise<{ data: PlatformIntegrationCatalogItem }> {
        const key = integrationKeySchema.safeParse(raw);
        if (!key.success) {
            throw new BadRequestException({ code: 'integration_unknown', message: 'Esa app no existe.', data: { status: 400 } });
        }
        return { data: await this.catalog.update(key.data, input) };
    }

    @Get()
    async get(): Promise<PlatformIntegrations> {
        const counts = await this.connectors.providerUsage();
        return {
            redirect_uri: this.connectors.oauthRedirectUri(),
            apps: await this.apps.list(counts),
        };
    }

    @Patch(':provider')
    async update(
        @Param('provider') raw: string,
        @Body(new ZodValidationPipe(updatePlatformIntegrationAppSchema)) input: UpdatePlatformIntegrationAppInput,
    ): Promise<PlatformIntegrationApp> {
        const provider = integrationProviderSchema.safeParse(raw);
        if (!provider.success) {
            throw new BadRequestException({
                code: 'integration_provider_unknown',
                message: 'Ese proveedor no existe.',
                data: { status: 400 },
            });
        }
        const counts = await this.connectors.providerUsage();
        return this.apps.update(provider.data, input, counts);
    }
}
