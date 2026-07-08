import { SetMetadata } from '@nestjs/common';
import type { Capability } from '@imagina-base/shared';

export const REQUIRE_CAPABILITY = 'require_capability';

/**
 * Marca un handler con la capability requerida (CONTRACT.md §6). El
 * CapabilitiesGuard la valida contra el rol del membership activo. El backend
 * SIEMPRE valida; el frontend solo oculta botones.
 */
export const RequireCapability = (capability: Capability) =>
    SetMetadata(REQUIRE_CAPABILITY, capability);
