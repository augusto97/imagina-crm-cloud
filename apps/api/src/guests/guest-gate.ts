import { NotFoundException } from '@nestjs/common';
import type { Field, List } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { effectivePermissions, guestCanOpenList, guestExtraHidden, withDependentComputed } from '../lists/list-acl';
import type { ListsService } from '../lists/lists.service';
import { aclOf } from '../tenancy/acl-of';

/**
 * C3 — Para los endpoints abiertos a invitados: la lista, si quien pide es
 * del equipo o si al invitado se la compartieron (entera o con algún registro
 * suelto). Si no, 404 opaco — para el invitado no existe.
 */
export async function listForRequest(lists: ListsService, req: FastifyRequest, idOrSlug: string): Promise<List> {
    const list = await lists.get(req.tenant!.tenantId, idOrSlug);
    if (req.tenant!.role !== 'guest') return list;
    const who = { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
    if (!guestCanOpenList(list.settings as Record<string, unknown>, who, list.id)) {
        throw new NotFoundException({ code: 'list_not_found', message: `Lista '${idOrSlug}' no encontrada`, data: { status: 404 } });
    }
    return list;
}

/**
 * C3 — Los campos que ve un invitado: sin los ocultos para él (los del lector
 * incluidos), sin relaciones ni lo que se trae por ellas, sin botones, y sin
 * los calculados que dependen de cualquiera de ésos.
 */
export function fieldsForGuest(list: List, fields: Field[], req: FastifyRequest): Field[] {
    if (req.tenant!.role !== 'guest') return fields;
    const who = { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
    const hidden = new Set(effectivePermissions(list.settings as Record<string, unknown>, who).fields_hidden);
    const ids = new Set([...fields.filter((f) => hidden.has(f.slug)).map((f) => f.id), ...guestExtraHidden(fields, who)]);
    const all = withDependentComputed(fields, ids);
    return fields.filter((f) => !all.has(f.id));
}
