import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AiAgentsModule } from '../ai-agents/ai-agents.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuthModule } from '../auth/auth.module';
import { ChecklistsModule } from '../checklists/checklists.module';
import { CommentsModule } from '../comments/comments.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { AiAssistController } from './ai-assist.controller';
import { RecordAgentsService } from './record-agents.service';
import { RecordAiContextService } from './record-ai-context.service';
import { RecordAiService } from './record-ai.service';

/**
 * v0.1.456 (ADR-S109) — IA en el día a día: resumen del registro, escribir
 * con IA, sugerir respuestas y pedirle a un agente desde la ficha (uno o en
 * lote). Módulo hoja: importa los dominios que lee y nadie lo importa a él.
 * La IA (clave, cuota) y la bitácora son globales; los cobros también.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, CommentsModule, ActivityModule, ApprovalsModule, ChecklistsModule, AiAgentsModule],
    controllers: [AiAssistController],
    providers: [RecordAiContextService, RecordAiService, RecordAgentsService],
})
export class AiAssistModule {}
