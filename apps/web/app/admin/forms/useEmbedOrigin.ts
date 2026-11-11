import { useSession } from '@/cloud/session';

/**
 * v0.1.409 (ADR-S102) — La dirección rápida (por Cloudflare) que mandó el
 * servidor para los códigos de insertar, salvo que se esté mirando desde el
 * dominio propio de una empresa: ahí manda su dominio (white-label).
 */
export function useEmbedOrigin(fromServer: string | null | undefined): string | null {
    const onTenantDomain = useSession((s) => s.domainTenant !== null);
    return !onTenantDomain && fromServer ? fromServer : null;
}
