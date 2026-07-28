import { Injectable, NotFoundException } from '@nestjs/common';
import {
    type CreateListGroupInput,
    type ListGroup,
    type UpdateListGroupInput,
} from '@imagina-base/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { listGroups, lists } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * Carpetas del menú de listas (v0.1.130).
 *
 * Un solo nivel a propósito: con muchas listas lo que hace falta es
 * agruparlas, no reproducir la jerarquía espacio → carpeta → lista de
 * ClickUp, que agrega dos niveles de navegación para el mismo resultado.
 *
 * Borrar una carpeta NUNCA borra listas: la FK es ON DELETE SET NULL y las
 * listas vuelven a la raíz del menú.
 */
@Injectable()
export class ListGroupsService {
    constructor(private readonly tenantDb: TenantDb) {}

    async list(tenantId: number): Promise<ListGroup[]> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({ id: listGroups.id, name: listGroups.name, position: listGroups.position })
                .from(listGroups)
                .where(eq(listGroups.tenantId, tenantId))
                .orderBy(asc(listGroups.position), asc(listGroups.id));
            return rows;
        });
    }

    async create(tenantId: number, input: CreateListGroupInput): Promise<ListGroup> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [maxRow] = await tx
                .select({ max: sql<number | null>`max(${listGroups.position})` })
                .from(listGroups)
                .where(eq(listGroups.tenantId, tenantId));
            const position = (maxRow?.max ?? -1) + 1;
            const [row] = await tx
                .insert(listGroups)
                .values({ tenantId, name: input.name, position })
                .returning({ id: listGroups.id, name: listGroups.name, position: listGroups.position });
            return row!;
        });
    }

    async update(tenantId: number, id: number, patch: UpdateListGroupInput): Promise<ListGroup> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const changes: { name?: string; position?: number } = {};
            if (patch.name !== undefined) changes.name = patch.name;
            if (patch.position !== undefined) changes.position = patch.position;
            const [row] = await tx
                .update(listGroups)
                .set(changes)
                .where(and(eq(listGroups.tenantId, tenantId), eq(listGroups.id, id)))
                .returning({ id: listGroups.id, name: listGroups.name, position: listGroups.position });
            if (!row) throw new NotFoundException(notFound());
            return row;
        });
    }

    /**
     * Borra la carpeta. Las listas que estaban adentro vuelven a la raíz —
     * lo hace la FK (SET NULL), pero se deja explícito en el update para que
     * la respuesta ya refleje el estado nuevo sin depender del orden de los
     * triggers.
     */
    async remove(tenantId: number, id: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ id: listGroups.id })
                .from(listGroups)
                .where(and(eq(listGroups.tenantId, tenantId), eq(listGroups.id, id)))
                .limit(1);
            if (!row) throw new NotFoundException(notFound());
            await tx
                .update(lists)
                .set({ groupId: null })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.groupId, id)));
            await tx
                .delete(listGroups)
                .where(and(eq(listGroups.tenantId, tenantId), eq(listGroups.id, id)));
        });
    }
}

function notFound() {
    return { code: 'list_group_not_found', message: 'Carpeta no encontrada', data: { status: 404 } };
}
