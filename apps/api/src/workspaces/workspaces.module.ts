import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { BrandingService } from './branding.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
    imports: [AuthModule, MailModule],
    controllers: [WorkspacesController],
    providers: [BrandingService],
})
export class WorkspacesModule {}
