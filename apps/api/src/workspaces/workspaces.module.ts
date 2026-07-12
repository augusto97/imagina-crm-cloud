import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandingService } from './branding.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
    imports: [AuthModule],
    controllers: [WorkspacesController],
    providers: [BrandingService],
})
export class WorkspacesModule {}
