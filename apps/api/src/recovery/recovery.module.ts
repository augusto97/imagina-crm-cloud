import { Module } from '@nestjs/common';
import { UpdateModule } from '../update/update.module';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';

/** v0.1.283 (ADR-S43) — Modo recuperación de un servidor recién instalado. */
@Module({
    imports: [UpdateModule],
    controllers: [RecoveryController],
    providers: [RecoveryService],
})
export class RecoveryModule {}
