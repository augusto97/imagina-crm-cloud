import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { ActivityController } from './activity.controller';
import { ActivityRepository } from './activity.repository';
import { ActivityService } from './activity.service';

@Module({
    imports: [AuthModule, ListsModule],
    controllers: [ActivityController],
    providers: [ActivityService, ActivityRepository],
    exports: [ActivityService, ActivityRepository],
})
export class ActivityModule {}
