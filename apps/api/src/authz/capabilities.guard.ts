import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Capability } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { canAny } from './can';
import { REQUIRE_CAPABILITY } from './require-capability.decorator';

/**
 * Valida la capability requerida contra las capacidades efectivas del
 * membership activo (rol propio o base, resueltas por TenantGuard en `req.tenant`). Debe correr DESPUÉS de
 * SessionGuard + TenantGuard.
 */
@Injectable()
export class CapabilitiesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<Capability[] | undefined>(
            REQUIRE_CAPABILITY,
            [context.getHandler(), context.getClass()],
        );
        if (!required || required.length === 0) {
            return true;
        }

        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const tenant = req.tenant;
        if (!tenant) {
            throw new ForbiddenException('Tenant no resuelto: falta TenantGuard');
        }
        // OR: basta con tener una de las capabilities aceptadas. C2 — las
        // EFECTIVAS (rol propio o base), resueltas por el TenantGuard.
        if (!canAny(tenant, required)) {
            throw new ForbiddenException(`Tu rol no tiene ninguna de: ${required.join(', ')}`);
        }
        return true;
    }
}
