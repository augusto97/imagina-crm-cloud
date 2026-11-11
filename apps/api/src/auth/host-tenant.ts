import { ForbiddenException } from '@nestjs/common';
import { eq, or } from 'drizzle-orm';
import type { Env } from '../config/env';
import type { Db } from '../db/client';
import { tenants } from '../db/schema';

/**
 * ¿De qué empresa es el Host por el que llegó el pedido?
 *
 * La app se sirve igual por la dirección de la plataforma, por el dominio
 * propio de cada empresa (el del equipo o el de su portal) y por su subdominio
 * `slug.base`. El dominio propio lo maneja la EMPRESA (su DNS): quien lo
 * atiende puede ver la cookie de una sesión abierta ahí. Por eso una sesión que
 * se abre en la dirección de una empresa queda ATADA a esa empresa
 * (`boundTenantId`): no sirve para las otras empresas de la persona ni para la
 * consola de plataforma. Las que se abren en la dirección de la plataforma
 * siguen valiendo para todo.
 *
 * Devuelve el id de la empresa del Host, o null si es la dirección de la
 * plataforma (o una que no es de ninguna empresa). A propósito NO mira el plan
 * ni si la empresa está archivada: el dominio sigue siendo suyo.
 *
 * (No se usa `DomainsService`: su módulo importa el de auth.)
 */
export async function tenantBoundToHost(db: Db, env: Env, rawHost: string | undefined): Promise<number | null> {
    if (!rawHost) return null;
    const host = rawHost.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    if (host === '' || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    const base = env.PUBLIC_BASE_DOMAIN !== '' ? env.PUBLIC_BASE_DOMAIN.toLowerCase() : null;
    let platformHost: string | null = null;
    try {
        platformHost = new URL(env.APP_BASE_URL).hostname.toLowerCase();
    } catch {
        platformHost = null;
    }
    if (host === base || host === platformHost) return null;
    const [own] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(or(eq(tenants.customDomain, host), eq(tenants.portalDomain, host)))
        .limit(1);
    if (own) return own.id;
    if (base && host.endsWith(`.${base}`)) {
        const slug = host.slice(0, -(base.length + 1));
        if (/^[a-z0-9-]+$/.test(slug)) {
            const [bySlug] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
            if (bySlug) return bySlug.id;
        }
    }
    return null;
}

/** Lo que una sesión atada a una empresa no puede hacer: actuar sobre toda la cuenta. */
export function assertAccountWideSession(req: { boundTenantId?: number }): void {
    if (req.boundTenantId !== undefined) throw sessionTenantScope();
}

export function sessionTenantScope(): ForbiddenException {
    return new ForbiddenException({
        code: 'session_tenant_scope',
        message: 'Esta sesión se abrió desde la dirección de una empresa y sólo sirve para esa empresa. Para esto, entra desde la dirección principal de la aplicación.',
        data: { status: 403 },
    });
}
