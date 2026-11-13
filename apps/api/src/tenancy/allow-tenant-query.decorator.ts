import { SetMetadata } from '@nestjs/common';

/**
 * v0.1.427 — La empresa activa puede venir en `?t=` (además del header
 * `X-Tenant-Id`). Sólo para lecturas que pide el NAVEGADOR solo, sin poder
 * poner cabeceras: una `<img>` de la app. La sesión sigue siendo la cookie
 * (que no viaja desde otro sitio) y la membresía se revisa igual.
 */
export const ALLOW_TENANT_QUERY = 'allowTenantQuery';
export const AllowTenantQuery = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_TENANT_QUERY, true);
