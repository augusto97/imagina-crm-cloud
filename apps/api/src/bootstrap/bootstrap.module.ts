import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsRepository } from '../fields/fields.repository';
import { ListsRepository } from '../lists/lists.repository';
import { ViewsRepository } from '../views/views.repository';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';

@Module({
    imports: [AuthModule],
    controllers: [BootstrapController],
    providers: [BootstrapService, ListsRepository, FieldsRepository, ViewsRepository],
})
export class BootstrapModule {}
