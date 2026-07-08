import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsRepository } from '../fields/fields.repository';
import { ListsRepository } from '../lists/lists.repository';
import { SlugsController } from './slugs.controller';
import { SlugsService } from './slugs.service';

@Module({
    imports: [AuthModule],
    controllers: [SlugsController],
    providers: [SlugsService, ListsRepository, FieldsRepository],
})
export class SlugsModule {}
