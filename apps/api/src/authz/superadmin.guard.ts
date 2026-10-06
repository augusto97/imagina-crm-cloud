import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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
        // SEC-24: una sesión abierta con un enlace del portal nunca es de operador.
        if (req.portalTenantId !== undefined) throw new ForbiddenException('Requiere superadmin de plataforma');
        // v0.1.254 — una sesión IMPERSONADA tampoco: el operador está mirando la
        // app como otra persona. Antes caía en el chequeo de "sesión con
        // contraseña" de abajo → `reauth_required` → la app cerraba la sesión y
        // la impersonación terminaba en el login apenas empezaba.
        if (req.impersonatedBy !== undefined) throw new ForbiddenException('Requiere superadmin de plataforma');
        if (this.env.PLATFORM_SUPERADMINS.length === 0) {
            throw new ForbiddenException('No hay superadmins de plataforma configurados');
        }
        const [row] = await this.db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        const email = row?.email?.toLowerCase();
        // Primero QUIÉN es y después CÓMO entró: `reauth_required` le dice a la
        // app que cierre la sesión, así que sólo se lo puede llevar un
        // superadmin de verdad (a cualquier otro le corresponde un 403).
        if (!email || !this.env.PLATFORM_SUPERADMINS.includes(email)) {
            throw new ForbiddenException('Requiere superadmin de plataforma');
        }
        // Y la consola exige una sesión abierta CON CONTRASEÑA. Las anteriores
        // a v0.1.225 no traen marca: el operador vuelve a iniciar sesión una vez
        // y cualquier sesión acuñada por el agujero del portal queda afuera.
        if (req.sessionVia !== 'password') {
            throw new UnauthorizedException({
                code: 'reauth_required',
                message: 'Volvé a iniciar sesión para usar la consola de plataforma',
                data: { status: 401 },
            });
        }
        return true;
    }
}
