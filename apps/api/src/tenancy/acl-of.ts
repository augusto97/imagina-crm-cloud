import type { FastifyRequest } from 'fastify';
import type { AclExtras } from '../lists/list-acl';

/**
 * Lo que viaja con quien pide además de su rol (equipos, rol propio y
 * capacidades efectivas, registros compartidos de un invitado), tal como lo
 * resolvió el TenantGuard. Todo actor armado desde un request lo lleva:
 * `{ userId, role, ...aclOf(req) }`.
 */
export function aclOf(req: FastifyRequest): AclExtras {
    const t = req.tenant!;
    return { teamIds: t.teamIds, customRoleId: t.customRoleId, capabilities: t.capabilities, shares: t.shares };
}
