import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { FieldsController } from './fields.controller';
import { FieldsRepository } from './fields.repository';
import { FieldsService } from './fields.service';

@Module({
    imports: [AuthModule, ListsModule],
    controllers: [FieldsController],
    providers: [FieldsService, FieldsRepository],
    exports: [FieldsService],
})
export class FieldsModule {}
