import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { CommentsModule } from '../comments/comments.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ActivityModule, CommentsModule, AutomationsModule],
    controllers: [PortalController],
    providers: [PortalService],
})
export class PortalModule {}
