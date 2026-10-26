import { SetMetadata } from '@nestjs/common';

export const ALLOW_GUEST = 'imbase:allow-guest';

/**
 * C3 — Un INVITADO externo (rol `guest`) sólo puede usar los endpoints
 * marcados con este decorador; en todos los demás el TenantGuard le responde
 * 403 (fail-closed). Marcar un endpoint exige revisar que lo que devuelve
 * pase por el ACL de la lista y los registros compartidos con la persona.
 */
export const AllowGuest = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_GUEST, true);
