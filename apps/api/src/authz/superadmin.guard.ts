import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { users } from '../db/schema';

/**
 * Superadmin de PLATAFORMA (no de workspace). Autoriza operaciones que afectan
 * a todo el servidor (auto-actualización, ADR-S13). La lista de emails vive en
 * `PLATFORM_SUPERADMINS` (env), no en la matriz de capabilities por tenant.
 * Debe correr DESPUÉS de SessionGuard (usa `req.authUserId`).
 */
@Injectable()
export class SuperadminGuard implements CanActivate {
    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const userId = req.authUserId;
        if (!userId) throw new ForbiddenException('Sesión requerida');
        if (this.env.PLATFORM_SUPERADMINS.length === 0) {
            throw new ForbiddenException('No hay superadmins de plataforma configurados');
        }
        const [row] = await this.db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        const email = row?.email?.toLowerCase();
        if (!email || !this.env.PLATFORM_SUPERADMINS.includes(email)) {
            throw new ForbiddenException('Requiere superadmin de plataforma');
        }
        return true;
    }
}
