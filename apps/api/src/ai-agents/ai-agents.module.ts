import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuthModule } from '../auth/auth.module';
import { CommentsModule } from '../comments/comments.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecordsModule } from '../records/records.module';
import { AgentAiTools } from './agent-ai-tools';
import { AgentProposalsService } from './agent-proposals.service';
import { AgentRunnerService } from './agent-runner.service';
import { AiAgentsController } from './ai-agents.controller';
import { AiAgentsService } from './ai-agents.service';

/**
 * E6 — Agentes de IA (ADR-S67): configuración, motor (cola propia),
 * propuestas y su lugar en el asistente/MCP. La acción «Pedirle a un agente»
 * de las automatizaciones llega por el `AgentHub` (global), así el motor de
 * automatizaciones no depende de este módulo.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, CommentsModule, ActivityModule, ApprovalsModule, NotificationsModule],
    controllers: [AiAgentsController],
    providers: [AiAgentsService, AgentProposalsService, AgentRunnerService, AgentAiTools],
    exports: [AiAgentsService, AgentProposalsService, AgentRunnerService],
})
export class AiAgentsModule {}
