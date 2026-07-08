import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleHasCapability, type Capability } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { REQUIRE_CAPABILITY } from './require-capability.decorator';

/**
 * Valida la capability requerida contra el rol del membership activo
 * (resuelto por TenantGuard en `req.tenant`). Debe correr DESPUÉS de
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
        const role = req.tenant?.role;
        if (!role) {
            throw new ForbiddenException('Tenant no resuelto: falta TenantGuard');
        }
        // OR: basta con tener una de las capabilities aceptadas.
        if (!required.some((cap) => roleHasCapability(role, cap))) {
            throw new ForbiddenException(`Tu rol no tiene ninguna de: ${required.join(', ')}`);
        }
        return true;
    }
}
