import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
    imports: [AuthModule, ListsModule, FieldsModule],
    controllers: [PortalController],
    providers: [PortalService],
})
export class PortalModule {}
