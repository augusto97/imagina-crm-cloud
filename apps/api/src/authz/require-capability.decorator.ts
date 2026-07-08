import { SetMetadata } from '@nestjs/common';
import type { Capability } from '@imagina-base/shared';

export const REQUIRE_CAPABILITY = 'require_capability';

/**
 * Marca un handler con las capabilities aceptadas (CONTRACT.md §6). El
 * CapabilitiesGuard deja pasar si el rol activo tiene AL MENOS UNA (OR) —
 * p.ej. `view_records` o `view_own_records`. El backend SIEMPRE valida; el
 * frontend solo oculta botones.
 */
export const RequireCapability = (...capabilities: [Capability, ...Capability[]]) =>
    SetMetadata(REQUIRE_CAPABILITY, capabilities);
