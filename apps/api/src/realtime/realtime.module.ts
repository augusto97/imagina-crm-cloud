import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/**
 * Realtime global: RealtimeService lo inyectan los módulos de dominio para
 * emitir invalidaciones; el gateway maneja los sockets. @Global para no tener
 * que importarlo en cada módulo que muta datos.
 */
@Global()
@Module({
    imports: [AuthModule],
    providers: [RealtimeService, RealtimeGateway],
    exports: [RealtimeService],
})
export class RealtimeModule {}
