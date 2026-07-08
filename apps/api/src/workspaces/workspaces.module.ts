import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesController } from './workspaces.controller';

@Module({
    imports: [AuthModule],
    controllers: [WorkspacesController],
})
export class WorkspacesModule {}
