import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { RtOriginInterceptor } from './rt-origin';

/**
 * Realtime global: RealtimeService lo inyectan los módulos de dominio para
 * emitir invalidaciones; el gateway maneja los sockets. @Global para no tener
 * que importarlo en cada módulo que muta datos.
 *
 * v0.1.461 — `RtOriginInterceptor` deja el origen de cada pedido (la pestaña
 * que lo hizo) en un contexto asíncrono para marcar los avisos.
 */
@Global()
@Module({
    imports: [AuthModule],
    providers: [RealtimeService, RealtimeGateway, { provide: APP_INTERCEPTOR, useClass: RtOriginInterceptor }],
    exports: [RealtimeService],
})
export class RealtimeModule {}
