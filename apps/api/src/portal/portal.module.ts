import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { CommentsModule } from '../comments/comments.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { DomainsModule } from '../domains/domains.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule, FilesModule, ActivityModule, CommentsModule, AutomationsModule, DomainsModule, DashboardsModule],
    controllers: [PortalController],
    providers: [PortalService],
})
export class PortalModule {}
