import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsController } from './lists.controller';
import { ListsRepository } from './lists.repository';
import { ListsService } from './lists.service';

@Module({
    imports: [AuthModule],
    controllers: [ListsController],
    providers: [ListsService, ListsRepository],
    exports: [ListsService],
})
export class ListsModule {}
