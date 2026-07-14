import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainsModule } from '../domains/domains.module';
import { MailModule } from '../mail/mail.module';
import { BrandingService } from './branding.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
    imports: [AuthModule, MailModule, DomainsModule],
    controllers: [WorkspacesController],
    providers: [BrandingService],
})
export class WorkspacesModule {}
