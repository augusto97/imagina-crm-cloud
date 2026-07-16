import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainsModule } from '../domains/domains.module';
import { FilesModule } from '../files/files.module';
import { MailModule } from '../mail/mail.module';
import { BrandingService } from './branding.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
    imports: [AuthModule, MailModule, DomainsModule, FilesModule],
    controllers: [WorkspacesController],
    providers: [BrandingService],
})
export class WorkspacesModule {}
