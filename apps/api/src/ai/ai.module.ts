import { Global, Module } from '@nestjs/common';
import { AggregateModule } from '../aggregate/aggregate.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { TemplatesModule } from '../templates/templates.module';
import { ViewsModule } from '../views/views.module';
import { AiQuotaService } from './ai-quota.service';
import { AiSettingsService } from './ai-settings.service';
import { AiController } from './ai.controller';
import { AssistantService } from './assistant.service';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { WellKnownController } from './well-known.controller';
import { ConversationsStore } from './conversations.store';
import { PlatformAiController } from './platform-ai.controller';
import { ProposalsService } from './proposals.service';
import { ProposalsStore } from './proposals.store';
import { PersonalTokensController } from './tokens.controller';
import { PersonalTokensService } from './tokens.service';
import { DataTools } from './tools/data-tools';
import { AiToolRegistry } from './tools/registry';
import { StructureTools } from './tools/structure-tools';

/**
 * Asistente IA (ADR-S21, v0.1.181). @Global porque BillingService y
 * PlatformService muestran el consumo IA de cada empresa (cuota por plan y
 * si tiene clave propia) sin que sus módulos tengan que importar éste.
 *
 * El registro de herramientas se arma UNA vez al bootear: las tools de
 * estructura (fase 1) se registran acá; las de datos (fase 2) y el
 * servidor MCP (fase 3) se suman al mismo registro.
 */
@Global()
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ViewsModule, AutomationsModule, DashboardsModule, TemplatesModule, BillingModule, RecordsModule, AggregateModule],
    controllers: [AiController, PlatformAiController, PersonalTokensController, McpController, OauthController, WellKnownController],
    providers: [
        AiSettingsService,
        AiQuotaService,
        ProposalsStore,
        ConversationsStore,
        StructureTools,
        DataTools,
        {
            provide: AiToolRegistry,
            inject: [StructureTools, DataTools],
            useFactory: (structure: StructureTools, data: DataTools): AiToolRegistry => {
                const registry = new AiToolRegistry();
                structure.registerInto(registry);
                data.registerInto(registry);
                return registry;
            },
        },
        ProposalsService,
        AssistantService,
        PersonalTokensService,
        McpService,
        OauthService,
    ],
    exports: [AiSettingsService, AiQuotaService, AiToolRegistry, AssistantService, ProposalsService],
})
export class AiModule {}
