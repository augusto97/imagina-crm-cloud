import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { FieldsModule } from './fields/fields.module';
import { HealthModule } from './health/health.module';
import { ListsModule } from './lists/lists.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RecordsModule } from './records/records.module';
import { RedisModule } from './redis/redis.module';
import { SlugsModule } from './slugs/slugs.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { ViewsModule } from './views/views.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
    imports: [
        ConfigModule,
        DbModule,
        RedisModule,
        TenancyModule,
        AuthzModule,
        RealtimeModule,
        AuthModule,
        WorkspacesModule,
        ListsModule,
        FieldsModule,
        RecordsModule,
        ViewsModule,
        BootstrapModule,
        SlugsModule,
        HealthModule,
    ],
})
export class AppModule {}
