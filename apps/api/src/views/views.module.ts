import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { ViewsController } from './views.controller';
import { ViewsRepository } from './views.repository';
import { ViewsService } from './views.service';

@Module({
    imports: [AuthModule, ListsModule],
    controllers: [ViewsController],
    providers: [ViewsService, ViewsRepository],
    exports: [ViewsService],
})
export class ViewsModule {}
