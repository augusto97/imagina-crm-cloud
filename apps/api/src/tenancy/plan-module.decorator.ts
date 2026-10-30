import { SetMetadata } from '@nestjs/common';
import type { PlanModule as PlanModuleKey } from '@imagina-base/shared';

export const PLAN_MODULE = 'planModule';

/**
 * v0.1.338 (ADR-S87) — El endpoint (o el controller entero) es parte de un
 * módulo que el plan puede no incluir. El `TenantGuard` responde 403
 * `plan_module_disabled` si el plan de la empresa lo tiene desactivado.
 * Lo configurado no se toca: vuelve tal cual al pasar a un plan que lo incluye.
 */
export const PlanModule = (module: PlanModuleKey): MethodDecorator & ClassDecorator => SetMetadata(PLAN_MODULE, module);
