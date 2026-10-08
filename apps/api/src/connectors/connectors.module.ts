import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsOAuthController } from './connectors-oauth.controller';
import { ConnectorsService } from './connectors.service';
import { IntegrationAppsService } from './integration-apps.service';
import { MailAccountService } from './mail-account.service';
import { MAIL_ACCOUNT_SENDER } from '../mail/mail.types';
import { TENANT_STORAGE } from '../files/file-storage';
import { TenantStorageService } from './tenant-storage.service';
import { IntegrationsController } from './integrations.controller';
import { PlatformIntegrationsController } from './platform-integrations.controller';
import { ENV, type Env } from '../config/env';
import { MssqlRunner } from './sqlserver/mssql-runner';
import { SQL_RUNNER } from './sqlserver/sql-runner';

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
    controllers: [
        ConnectorsController,
        ConnectorsOAuthController,
        IntegrationsController,
        PlatformIntegrationsController,
    ],
    providers: [
        ConnectorsService,
        IntegrationAppsService,
        // v0.1.249 — el correo de la empresa por su cuenta de Google/Microsoft.
        MailAccountService,
        { provide: MAIL_ACCOUNT_SENDER, useExisting: MailAccountService },
        // v0.1.268 (ADR-S36) — el almacenamiento propio de la empresa.
        TenantStorageService,
        { provide: TENANT_STORAGE, useExisting: TenantStorageService },
        // v0.1.243 — SQL Server / Azure SQL. Los tests lo reemplazan por uno falso.
        {
            provide: SQL_RUNNER,
            useFactory: (env: Env) => new MssqlRunner({ allowPrivate: env.SQL_ALLOW_PRIVATE_HOSTS }),
            inject: [ENV],
        },
    ],
    exports: [ConnectorsService, IntegrationAppsService, MailAccountService, MAIL_ACCOUNT_SENDER, TenantStorageService, TENANT_STORAGE, SQL_RUNNER],
})
export class ConnectorsModule {}
