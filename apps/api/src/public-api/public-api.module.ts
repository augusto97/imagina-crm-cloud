import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicApiController } from './public-api.controller';

/** v0.1.441 (G1) — `/whoami` y `/openapi.json` de la API pública. */
@Module({
    imports: [AuthModule],
    controllers: [PublicApiController],
})
export class PublicApiModule {}
