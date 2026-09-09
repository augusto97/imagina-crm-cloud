import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    collectFieldTokens,
    dashboardTemplateSchema,
    resolveFieldRefs,
    tokenizeFieldRefs,
    widgetTypeSchema,
    type ApplyDashboardTemplateInput,
    type BlueprintWidget,
    type CreateDashboardTemplateInput,
    type Dashboard,
    type DashboardTemplate,
    type DashboardTemplateSummary,
    type TemplateCategory,
    type TemplateRoleList,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DashboardsService, type DashboardViewer } from '../dashboards/dashboards.service';
import { templates } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { SYSTEM_DASHBOARD_TEMPLATES, systemDashboardTemplate, type SystemDashboardTemplate } from './system-dashboards';

const SYSTEM_PREFIX = 'sys:';

export interface ApplyDashboardResult {
    dashboard: Dashboard;
    warnings: string[];
}

/**
 * Plantillas de dashboard (v0.1.167). Una plantilla describe widgets sobre
 * ROLES de campo; aplicarla es elegir la lista y el campo real de cada rol
 * (ver `dashboardTemplateSchema` en shared). Las del sistema viven en
 * `system-dashboards.ts`; las del workspace se guardan desde un dashboard
 * existente, con los slugs de sus campos como roles.
 */
@Injectable()
export class DashboardTemplatesService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly dashboards: DashboardsService,
        private readonly audit: AuditService,
    ) {}

    async listAll(tenantId: number): Promise<DashboardTemplateSummary[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(templates)
                .where(and(eq(templates.tenantId, tenantId), eq(templates.kind, 'dashboard')))
                .orderBy(desc(templates.createdAt)),
        );
        const own = rows.map((r) =>
            summarize({
                id: String(r.id),
                source: 'workspace',
                name: r.name,
                description: r.description,
                category: r.category as TemplateCategory,
                template: dashboardTemplateSchema.parse(r.blueprint),
                created_at: r.createdAt.toISOString(),
            }),
        );
        return [...own, ...SYSTEM_DASHBOARD_TEMPLATES.map((t) => summarize(fromSystem(t)))];
    }

    /**
     * Guardar un dashboard como plantilla: cada widget con lista pasa a
     * `{ $list: slug }` y sus campos a `{ $field: slug }`; los roles son
     * exactamente los campos que los widgets referencian (con su tipo, para
     * que al aplicar sólo se ofrezcan campos compatibles).
     */
    async create(
        tenantId: number,
        viewer: DashboardViewer,
        input: CreateDashboardTemplateInput,
    ): Promise<DashboardTemplateSummary> {
        const source = await this.dashboards.get(tenantId, input.dashboard_id, viewer);
        const listIds = [...new Set(source.widgets.map((w) => w.list_id).filter((id) => id > 0))];
        if (listIds.length === 0) {
            throw new BadRequestException({
                code: 'dashboard_without_data',
                message: 'El dashboard no tiene widgets sobre una lista; no hay nada que convertir en plantilla',
                data: { status: 400 },
            });
        }
        const roleLists: TemplateRoleList[] = [];
        const byListId = new Map<number, { key: string; idToSlug: Map<number, string>; fields: Map<number, { label: string; type: string }> }>();
        for (const id of listIds) {
            const list = await this.lists.get(tenantId, String(id));
            const fields = await this.fields.listByListId(tenantId, id);
            byListId.set(id, {
                key: list.slug,
                idToSlug: new Map(fields.map((f) => [f.id, f.slug])),
                fields: new Map(fields.map((f) => [f.id, { label: f.label, type: f.type }])),
            });
            roleLists.push({ key: list.slug, label: list.name, fields: [] });
        }

        const widgets: BlueprintWidget[] = source.widgets.map((wd) => {
            if (wd.list_id === 0) {
                return { type: wd.type, list: 0, title: wd.title, config: wd.config, layout: wd.layout };
            }
            const ctx = byListId.get(wd.list_id)!;
            const config = tokenizeFieldRefs(wd.config, ctx.idToSlug) as Record<string, unknown>;
            const roles = roleLists.find((r) => r.key === ctx.key)!;
            for (const [fid, meta] of ctx.fields) {
                const slug = ctx.idToSlug.get(fid)!;
                if (collectFieldTokens(config).includes(slug) && !roles.fields.some((f) => f.key === slug)) {
                    roles.fields.push({ key: slug, label: meta.label, types: [meta.type as TemplateRoleList['fields'][number]['types'][number]], required: true });
                }
            }
            return { type: wd.type, list: { $list: ctx.key }, title: wd.title, config, layout: wd.layout };
        });

        const template: DashboardTemplate = {
            version: 1,
            lists: roleLists,
            widgets,
            settings: source.settings,
        };
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(templates)
                .values({
                    tenantId,
                    kind: 'dashboard',
                    name: input.name,
                    description: input.description ?? null,
                    category: input.category ?? 'otros',
                    blueprint: template,
                    createdBy: viewer.userId,
                })
                .returning(),
        );
        if (!row) throw new Error('Insert de plantilla no devolvió fila');
        void this.audit.log({
            tenantId,
            userId: viewer.userId,
            action: 'dashboard_template.create',
            targetType: 'dashboard_template',
            targetId: row.id,
            targetLabel: row.name,
            meta: { source_dashboard_id: source.id },
        });
        return summarize({
            id: String(row.id),
            source: 'workspace',
            name: row.name,
            description: row.description,
            category: row.category as TemplateCategory,
            template,
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
                .where(and(eq(templates.tenantId, tenantId), eq(templates.kind, 'dashboard'), eq(templates.id, numeric)))
                .returning({ id: templates.id, name: templates.name }),
        );
        if (!deleted) throw notFound(id);
        void this.audit.log({
            tenantId,
            userId: actorId,
            action: 'dashboard_template.delete',
            targetType: 'dashboard_template',
            targetId: deleted.id,
            targetLabel: deleted.name,
        });
    }

    /**
     * Aplicar: valida el mapeo (la lista es del tenant; cada campo es de esa
     * lista y de un tipo aceptado por el rol) y resuelve los widgets. Un
     * widget que necesita un rol OBLIGATORIO sin mapear se omite con aviso;
     * uno opcional sin mapear queda sin ese campo (el motor cae a `count`).
     */
    async apply(
        tenantId: number,
        actorId: number,
        id: string,
        input: ApplyDashboardTemplateInput,
    ): Promise<ApplyDashboardResult> {
        const tpl = await this.resolve(tenantId, id);
        const warnings: string[] = [];

        const scopes = new Map<string, { listId: number; slugToId: Map<string, number>; required: Set<string> }>();
        for (const roleList of tpl.template.lists) {
            const mapping = input.lists[roleList.key];
            if (!mapping) continue;
            const list = await this.lists.get(tenantId, String(mapping.list_id));
            const fields = await this.fields.listByListId(tenantId, list.id);
            const byId = new Map(fields.map((f) => [f.id, f]));
            const slugToId = new Map<string, number>();
            for (const roleField of roleList.fields) {
                const fid = mapping.fields[roleField.key];
                if (fid === undefined) continue;
                const field = byId.get(fid);
                if (!field) {
                    warnings.push(`«${roleField.label}»: el campo elegido no pertenece a «${list.name}»`);
                    continue;
                }
                if (roleField.types.length > 0 && !roleField.types.includes(field.type)) {
                    warnings.push(`«${roleField.label}»: «${field.label}» no es de un tipo válido para ese rol`);
                    continue;
                }
                slugToId.set(roleField.key, field.id);
            }
            scopes.set(roleList.key, {
                listId: list.id,
                slugToId,
                required: new Set(roleList.fields.filter((f) => f.required).map((f) => f.key)),
            });
        }

        const widgets: WidgetSpec[] = [];
        for (const wd of tpl.template.widgets) {
            const type = widgetTypeSchema.safeParse(wd.type);
            if (!type.success) {
                warnings.push(`Widget «${wd.title || wd.type}»: tipo desconocido`);
                continue;
            }
            if (wd.list === 0) {
                widgets.push({ id: newWidgetId(), type: type.data, list_id: 0, title: wd.title, config: wd.config, layout: wd.layout });
                continue;
            }
            const scope = scopes.get(wd.list.$list);
            if (!scope) {
                warnings.push(`Widget «${wd.title || wd.type}»: sin lista para «${wd.list.$list}»`);
                continue;
            }
            const missing = collectFieldTokens(wd.config).filter((k) => !scope.slugToId.has(k) && scope.required.has(k));
            if (missing.length > 0) {
                warnings.push(`Widget «${wd.title || wd.type}» omitido: falta el campo «${missing[0]}»`);
                continue;
            }
            widgets.push({
                id: newWidgetId(),
                type: type.data,
                list_id: scope.listId,
                title: wd.title,
                config: resolveFieldRefs(wd.config, scope.slugToId) as Record<string, unknown>,
                layout: wd.layout,
            });
        }
        if (widgets.length === 0) {
            throw new BadRequestException({
                code: 'template_unmapped',
                message: 'Ningún widget se pudo crear con ese mapeo de campos',
                data: { status: 400, warnings },
            });
        }

        const dashboard = await this.dashboards.create(tenantId, actorId, {
            name: input.name,
            description: input.description ?? null,
            widgets,
            settings: tpl.template.settings,
            visibility: input.visibility,
            allowed_roles: input.allowed_roles,
        });
        void this.audit.log({
            tenantId,
            userId: actorId,
            action: 'dashboard_template.apply',
            targetType: 'dashboard',
            targetId: dashboard.id,
            targetLabel: dashboard.name,
            meta: { template: tpl.id },
        });
        return { dashboard, warnings };
    }

    private async resolve(tenantId: number, id: string): Promise<Resolved> {
        if (id.startsWith(SYSTEM_PREFIX)) {
            const t = systemDashboardTemplate(id.slice(SYSTEM_PREFIX.length));
            if (!t) throw notFound(id);
            return fromSystem(t);
        }
        const numeric = Number(id);
        if (!Number.isInteger(numeric) || numeric <= 0) throw notFound(id);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(templates)
                .where(and(eq(templates.tenantId, tenantId), eq(templates.kind, 'dashboard'), eq(templates.id, numeric)))
                .limit(1),
        );
        if (!row) throw notFound(id);
        return {
            id: String(row.id),
            source: 'workspace',
            name: row.name,
            description: row.description,
            category: row.category as TemplateCategory,
            template: dashboardTemplateSchema.parse(row.blueprint),
            created_at: row.createdAt.toISOString(),
        };
    }
}

interface Resolved {
    id: string;
    source: 'system' | 'workspace';
    name: string;
    description: string | null;
    category: TemplateCategory;
    template: DashboardTemplate;
    created_at: string | null;
}

function fromSystem(t: SystemDashboardTemplate): Resolved {
    return {
        id: `${SYSTEM_PREFIX}${t.key}`,
        source: 'system',
        name: t.name,
        description: t.description,
        category: t.category,
        template: t.template,
        created_at: null,
    };
}

function summarize(t: Resolved): DashboardTemplateSummary {
    return {
        id: t.id,
        source: t.source,
        name: t.name,
        description: t.description,
        category: t.category,
        lists: t.template.lists,
        widgets: t.template.widgets.map((w) => ({ type: w.type, title: w.title })),
        created_at: t.created_at,
    };
}

function newWidgetId(): string {
    return `w-${Math.random().toString(36).slice(2, 10)}`;
}

function notFound(id: string): NotFoundException {
    return new NotFoundException({
        code: 'template_not_found',
        message: `Plantilla "${id}" no encontrada`,
        data: { status: 404 },
    });
}
