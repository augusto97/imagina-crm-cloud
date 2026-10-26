import { Module, type OnModuleInit } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { CommentsModule } from '../comments/comments.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecordsModule } from '../records/records.module';
import { HelpdeskConfigService } from './helpdesk-config.service';
import { HelpdeskIngestService } from './helpdesk-ingest.service';
import { HelpdeskReplyService } from './helpdesk-reply.service';
import { HelpdeskSlaService } from './helpdesk-sla.service';
import { HelpdeskController, HelpdeskTicketController } from './helpdesk.controller';
import { HelpdeskQueue, HelpdeskQueueBootstrap } from './helpdesk.queue';
import { IMAP_READER, ImapFlowReader } from './imap-reader';

/**
 * D2 + E5 — Mesa de ayuda por correo (buzón IMAP → tickets, respuestas desde
 * la ficha) + SLA y escalamiento. Cola propia (`helpdesk`): lectura de los
 * buzones y el reloj de los SLA.
 */
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, RecordsModule, CommentsModule, FilesModule, ActivityModule, AutomationsModule, NotificationsModule],
    controllers: [HelpdeskController, HelpdeskTicketController],
    providers: [
        { provide: IMAP_READER, useClass: ImapFlowReader },
        HelpdeskQueue,
        HelpdeskQueueBootstrap,
        HelpdeskConfigService,
        HelpdeskSlaService,
        HelpdeskIngestService,
        HelpdeskReplyService,
    ],
    exports: [HelpdeskConfigService, HelpdeskSlaService, HelpdeskReplyService, HelpdeskIngestService],
})
export class HelpdeskModule implements OnModuleInit {
    constructor(
        private readonly bootstrap: HelpdeskQueueBootstrap,
        private readonly ingest: HelpdeskIngestService,
        private readonly sla: HelpdeskSlaService,
    ) {}

    onModuleInit(): void {
        this.bootstrap.setHandlers({
            tick: async () => {
                await this.ingest.tick();
                await this.sla.tick();
            },
            poll: (job) => this.ingest.run(job.tenantId, job.mailboxId),
            slaList: (job) => this.sla.reconcileList(job.tenantId, job.listId),
        });
    }
}
