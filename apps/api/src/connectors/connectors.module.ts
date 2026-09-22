import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsOAuthController } from './connectors-oauth.controller';
import { ConnectorsService } from './connectors.service';

/**
 * Conectores (v0.1.196, ADR-S22).
 *
 * @Global porque el motor de automatizaciones y el probador de webhooks
 * necesitan resolver credenciales, y hacerlo por import explícito crearía un
 * ciclo: automations → connectors → (audit, tenancy) y de vuelta.
 */
@Global()
@Module({
    // El `SessionGuard` del controller se resuelve en el contexto de ESTE
    // módulo: sin importar AuthModule, Nest no encuentra `SessionService`.
    imports: [AuthModule],
    controllers: [ConnectorsController, ConnectorsOAuthController],
    providers: [ConnectorsService],
    exports: [ConnectorsService],
})
export class ConnectorsModule {}
