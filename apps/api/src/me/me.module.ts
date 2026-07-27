import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountDataService } from './account-data.service';
import { MeController } from './me.controller';
import { MeRepository } from './me.repository';
import { MeService } from './me.service';

@Module({
    imports: [AuthModule],
    controllers: [MeController],
    providers: [MeService, MeRepository, AccountDataService],
    exports: [MeService],
})
export class MeModule {}
