import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

/** v0.1.393 — Retención de las tablas que crecían sin tope. */
@Module({
    providers: [RetentionService],
    exports: [RetentionService],
})
export class RetentionModule {}
