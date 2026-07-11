import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';

@Module({
    imports: [AuthModule, ListsModule, RecordsModule],
    controllers: [CommentsController],
    providers: [CommentsService, CommentsRepository],
    exports: [CommentsRepository],
})
export class CommentsModule {}
