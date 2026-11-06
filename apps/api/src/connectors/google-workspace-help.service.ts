import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import {
    googleScopeLabels,
    integrationDef,
    integrationScopes,
    type GoogleWorkspaceAdminHelp,
    type IntegrationKey,
} from '@imagina-base/shared';
import { PlatformBrandService } from '../brand/platform-brand.service';
import { IntegrationAppsService } from './integration-apps.service';

/**
 * v0.1.384 — Lo que necesita el administrador de Google Workspace para marcar
 * la app como «De confianza»: su ID de cliente (no es secreto: viaja en cada
 * autorización) y lo que pide, en palabras. Es el equivalente de Google al
 * enlace de aprobación de Microsoft 365 (v0.1.363), que Google no tiene.
 */
@Injectable()
export class GoogleWorkspaceHelpService {
    constructor(
        private readonly apps: IntegrationAppsService,
        @Optional() private readonly brand?: PlatformBrandService,
    ) {}

    async help(key: IntegrationKey, opts: { purpose?: 'agenda' | null } = {}): Promise<GoogleWorkspaceAdminHelp> {
        const def = integrationDef(key);
        if (!def || def.auth.kind !== 'oauth' || def.auth.provider !== 'google') {
            throw new BadRequestException({ code: 'not_google', message: 'Esa app no es de Google.' });
        }
        const app = await this.apps.resolve('google');
        const appName = (await this.brand?.get().catch(() => null))?.app_name ?? '';
        return {
            client_id: app.clientId,
            app_name: appName,
            permissions: googleScopeLabels(integrationScopes(def, { purpose: opts.purpose ?? null })),
        };
    }
}
