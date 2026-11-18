import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';

/**
 * v0.1.393 — Retención de las tablas que crecían sin tope.
 * v0.1.439 — lo que elige el operador (historial de corridas, actividad) y el
 * tamaño de cada tabla en Plataforma → Diagnóstico.
 */
@Module({
    imports: [AuthModule],
    controllers: [RetentionController],
    providers: [RetentionService, SuperadminGuard],
    exports: [RetentionService],
})
export class RetentionModule {}
