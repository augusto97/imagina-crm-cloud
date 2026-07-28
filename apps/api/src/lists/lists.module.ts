import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListGroupsController } from './list-groups.controller';
import { ListGroupsService } from './list-groups.service';
import { ListsController } from './lists.controller';
import { ListsRepository } from './lists.repository';
import { ListsService } from './lists.service';

@Module({
    imports: [AuthModule],
    controllers: [ListsController, ListGroupsController],
    providers: [ListsService, ListsRepository, ListGroupsService],
    exports: [ListsService],
})
export class ListsModule {}
