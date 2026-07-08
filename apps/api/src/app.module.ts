import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { FieldsModule } from './fields/fields.module';
import { HealthModule } from './health/health.module';
import { ListsModule } from './lists/lists.module';
import { RecordsModule } from './records/records.module';
import { RedisModule } from './redis/redis.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
    imports: [
        ConfigModule,
        DbModule,
        RedisModule,
        TenancyModule,
        AuthzModule,
        AuthModule,
        WorkspacesModule,
        ListsModule,
        FieldsModule,
        RecordsModule,
        HealthModule,
    ],
})
export class AppModule {}
