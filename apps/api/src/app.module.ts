import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
    imports: [
        ConfigModule,
        DbModule,
        RedisModule,
        TenancyModule,
        AuthModule,
        WorkspacesModule,
        HealthModule,
    ],
})
export class AppModule {}
