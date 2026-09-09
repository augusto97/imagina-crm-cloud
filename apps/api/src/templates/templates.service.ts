import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    listBlueprintSchema,
    type ApplyListTemplateInput,
    type CreateListTemplateInput,
    type DuplicateListInput,
    type List,
    type ListBlueprint,
    type ListTemplateSummary,
    type TemplateCategory,
} from '@imagina-base/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { templates } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BlueprintService, type MaterializeResult } from './blueprint.service';
import { SYSTEM_TEMPLATES, systemTemplate, type SystemTemplate } from './system-catalog';

const SYSTEM_PREFIX = 'sys:';

/**
 * Duplicar listas y plantillas (v0.1.166).
 *
 * Dos fuentes de plantillas con UN solo formato: las del sistema (código,
 * `system-catalog.ts`, id `sys:<key>`) y las del workspace (tabla
 * `templates` con `kind = 'list'`, id numérico). La galería las lista
 * juntas; aplicar cualquiera es materializar su blueprint.
 */
@Injectable()
export class TemplatesService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly blueprints: BlueprintService,
        private readonly audit: AuditService,
    ) {}

    // ── Duplicar ─────────────────────────────────────────────────────────

    async duplicate(
        tenantId: number,
        actorId: number,
        listIdOrSlug: string,
        input: DuplicateListInput,
    ): Promise<MaterializeResult> {
        const source = await this.lists.get(tenantId, listIdOrSlug);
        const blueprint = await this.blueprints.serialize(tenantId, [source.id], input.include);
        const result = await this.blueprints.materialize(tenantId, actorId, blueprint, {
            name: input.name ?? `${source.name} (copia)`,
            groupId: source.group_id,
            includeRecords: input.include.records,
        });
        const copy = result.lists[0];
        void this.audit.log({
            tenantId,
            userId: actorId,
            action: 'list.duplicate',
            targetType: 'list',
            targetId: copy?.id ?? null,
            targetLabel: copy?.name ?? source.name,
            meta: { source_list_id: source.id, include: input.include },
        });
        return result;
    }

    // ── Plantillas ───────────────────────────────────────────────────────

    async listAll(tenantId: number): Promise<ListTemplateSummary[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(templates)
                .where(and(eq(templates.tenantId, tenantId), eq(templates.kind, 'list')))
                .orderBy(desc(templates.createdAt)),
        );
        const own = rows.map((r) =>
            summarize({
                id: String(r.id),
                source: 'workspace',
                name: r.name,
                description: r.description,
                icon: r.icon,
                color: r.color,
                category: r.category as TemplateCategory,
                blueprint: listBlueprintSchema.parse(r.blueprint),
                created_at: r.createdAt.toISOString(),
            }),
        );
        const system = SYSTEM_TEMPLATES.map((t) => summarize(fromSystem(t)));
        return [...own, ...system];
    }

    async get(tenantId: number, id: string): Promise<ListTemplateSummary & { blueprint: ListBlueprint }> {
        const resolved = await this.resolve(tenantId, id);
        return { ...summarize(resolved), blueprint: resolved.blueprint };
    }

    async create(
        tenantId: number,
        actorId: number,
        input: CreateListTemplateInput,
    ): Promise<ListTemplateSummary> {
        const source = await this.lists.get(tenantId, String(input.list_id));
        const blueprint = await this.blueprints.serialize(tenantId, [source.id], input.include);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(templates)
                .values({
                    tenantId,
                    kind: 'list',
                    name: input.name,
                    description: input.description ?? null,
                    icon: source.icon,
                    color: source.color,
                    category: input.category ?? 'otros',
                    blueprint,
                    createdBy: actorId,
                })
                .returning(),
        );
        if (!row) throw new Error('Insert de plantilla no devolvió fila');
        void this.audit.log({
            tenantId,
            userId: actorId,
            action: 'template.create',
            targetType: 'list_template',
            targetId: row.id,
            targetLabel: row.name,
            meta: { source_list_id: source.id, include: input.include },
        });
        return summarize({
            id: String(row.id),
            source: 'workspace',
            name: row.name,
            description: row.description,
            icon: row.icon,
            color: row.color,
            category: row.category as TemplateCategory,
            blueprint,
            created_at: row.createdAt.toISOString(),
        });
    }

    async remove(tenantId: number, actorId: number, id: string): Promise<void> {
        if (id.startsWith(SYSTEM_PREFIX)) {
            throw new BadRequestException({
                code: 'system_template',
                message: 'Las plantillas del sistema no se pueden borrar',
                data: { status: 400 },
            });
        }
        const numeric = Number(id);
        const [deleted] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .delete(templates)
                .where(and(eq(templates.tenantId, tenantId), eq(templates.kind, 'list'), eq(templates.id, numeric)))
                .returning({ id: templates.id, name: templates.name }),
        );
        if (!deleted) throw notFound(id);
        void this.audit.log({
            tenantId,
            userId: actorId,
            action: 'template.delete',
            targetType: 'list_template',
            targetId: deleted.id,
            targetLabel: deleted.name,
        });
    }

    async apply(
        tenantId: number,
        actorId: number,
        id: string,
        input: ApplyListTemplateInput,
    ): Promise<MaterializeResult> {
        const tpl = await this.resolve(tenantId, id);
        const result = await this.blueprints.materialize(tenantId, actorId, tpl.blueprint, {
            name: input.name,
            groupId: input.group_id ?? null,
            includeRecords: input.include_records,
        });
        void this.audit.log({
            tenantId,
            userId: actorId,
            action: 'template.apply',
            targetType: 'list',
            targetId: result.lists[0]?.id ?? null,
            targetLabel: result.lists[0]?.name ?? tpl.name,
            meta: { template: tpl.id, lists: result.lists.map((l) => l.id) },
        });
        return result;
    }

    private async resolve(tenantId: number, id: string): Promise<ResolvedTemplate> {
        if (id.startsWith(SYSTEM_PREFIX)) {
            const t = systemTemplate(id.slice(SYSTEM_PREFIX.length));
            if (!t) throw notFound(id);
            return fromSystem(t);
        }
        const numeric = Number(id);
        if (!Number.isInteger(numeric) || numeric <= 0) throw notFound(id);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(templates)
                .where(and(eq(templates.tenantId, tenantId), eq(templates.kind, 'list'), eq(templates.id, numeric)))
                .limit(1),
        );
        if (!row) throw notFound(id);
        return {
            id: String(row.id),
            source: 'workspace',
            name: row.name,
            description: row.description,
            icon: row.icon,
            color: row.color,
            category: row.category as TemplateCategory,
            blueprint: listBlueprintSchema.parse(row.blueprint),
            created_at: row.createdAt.toISOString(),
        };
    }
}

interface ResolvedTemplate {
    id: string;
    source: 'system' | 'workspace';
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    category: TemplateCategory;
    blueprint: ListBlueprint;
    created_at: string | null;
}

function fromSystem(t: SystemTemplate): ResolvedTemplate {
    return {
        id: `${SYSTEM_PREFIX}${t.key}`,
        source: 'system',
        name: t.name,
        description: t.description,
        icon: t.icon,
        color: t.color,
        category: t.category,
        blueprint: t.blueprint,
        created_at: null,
    };
}

/** Resumen para la galería: lo justo para decidir sin bajar el blueprint. */
function summarize(t: ResolvedTemplate): ListTemplateSummary {
    return {
        id: t.id,
        source: t.source,
        name: t.name,
        description: t.description,
        icon: t.icon,
        color: t.color,
        category: t.category,
        created_at: t.created_at,
        lists: t.blueprint.lists.map((l) => ({
            name: l.name,
            fields: l.fields.map((f) => ({ label: f.label, type: f.type })),
            views: l.views.map((v) => ({ name: v.name, type: v.type })),
            automations: l.automations.map((a) => a.name),
            records_count: l.records.length,
        })),
        dashboards: t.blueprint.dashboards.map((d) => d.name),
    };
}

function notFound(id: string): NotFoundException {
    return new NotFoundException({
        code: 'template_not_found',
        message: `Plantilla "${id}" no encontrada`,
        data: { status: 404 },
    });
}

export type { List };
