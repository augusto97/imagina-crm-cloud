import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    BLUEPRINT_EXCLUDED_TRIGGER_KEYS,
    SYSTEM_AUTOMATION_TEMPLATES,
    automationTemplateSchema,
    collectAutomationSlugs,
    type AutomationTemplate,
    type AutomationTemplateCategory,
    type AutomationTemplateSummary,
    type CreateAutomationTemplateInput,
    type TemplateRoleField,
} from '@imagina-base/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { templates } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';

const SYSTEM_PREFIX = 'sys:';

/**
 * Plantillas de automatización (v0.1.167). Se APLICAN en el cliente (mapeo
 * de roles → slugs y editor pre-cargado); acá sólo se guardan y se listan.
 * Las del sistema viven en shared (`SYSTEM_AUTOMATION_TEMPLATES`) y se
 * devuelven junto a las del workspace para que la galería tenga una sola
 * fuente.
 */
@Injectable()
export class AutomationTemplatesService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly automations: AutomationsService,
        private readonly audit: AuditService,
    ) {}

    async listAll(tenantId: number): Promise<AutomationTemplateSummary[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(templates)
                .where(and(eq(templates.tenantId, tenantId), eq(templates.kind, 'automation')))
                .orderBy(desc(templates.createdAt)),
        );
        const own: AutomationTemplateSummary[] = rows.map((r) => ({
            id: String(r.id),
            source: 'workspace',
            name: r.name,
            description: r.description,
            category: r.category as AutomationTemplateCategory,
            template: automationTemplateSchema.parse(r.blueprint),
            created_at: r.createdAt.toISOString(),
        }));
        const system: AutomationTemplateSummary[] = SYSTEM_AUTOMATION_TEMPLATES.map((t) => ({
            id: `${SYSTEM_PREFIX}${t.key}`,
            source: 'system',
            name: t.name,
            description: t.description,
            category: t.category,
            template: t.template,
            created_at: null,
        }));
        return [...own, ...system];
    }

    /**
     * Guardar una automatización como plantilla: los roles son los campos
     * que referencia (por slug, con su tipo y etiqueta); el cuerpo queda con
     * esos slugs, que al aplicar se re-escriben. El token del webhook
     * entrante no viaja (es una credencial).
     */
    async create(
        tenantId: number,
        actorId: number,
        input: CreateAutomationTemplateInput,
    ): Promise<AutomationTemplateSummary> {
        const list = await this.lists.get(tenantId, String(input.list_id));
        const auto = await this.automations.get(tenantId, String(list.id), input.automation_id);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const bySlug = new Map(fields.map((f) => [f.slug, f]));

        const trigger: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(auto.trigger_config)) {
            if (!BLUEPRINT_EXCLUDED_TRIGGER_KEYS.includes(k)) trigger[k] = v;
        }
        const roles: TemplateRoleField[] = [];
        for (const slug of collectAutomationSlugs({ trigger_config: trigger, actions: auto.actions })) {
            const f = bySlug.get(slug);
            // Un slug que no es campo de la lista (p. ej. una clave de un
            // payload de webhook) no es un rol: se deja tal cual en el cuerpo.
            if (!f) continue;
            roles.push({ key: slug, label: f.label, types: [f.type], required: true });
        }
        if (roles.length === 0 && auto.actions.length === 0) {
            throw new BadRequestException({
                code: 'automation_empty',
                message: 'La automatización no tiene acciones',
                data: { status: 400 },
            });
        }
        const template: AutomationTemplate = {
            version: 1,
            fields: roles,
            name: input.name,
            description: input.description ?? auto.description ?? null,
            trigger_type: auto.trigger_type,
            trigger_config: trigger,
            actions: auto.actions,
        };
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(templates)
                .values({
                    tenantId,
                    kind: 'automation',
                    name: input.name,
                    description: template.description,
                    category: input.category ?? 'otros',
                    blueprint: template,
                    createdBy: actorId,
                })
                .returning(),
        );
        if (!row) throw new Error('Insert de plantilla no devolvió fila');
        void this.audit.log({
            tenantId,
            userId: actorId,
            action: 'automation_template.create',
            targetType: 'automation_template',
            targetId: row.id,
            targetLabel: row.name,
            meta: { source_automation_id: auto.id, list_id: list.id },
        });
        return {
            id: String(row.id),
            source: 'workspace',
            name: row.name,
            description: row.description,
            category: row.category as AutomationTemplateCategory,
            template,
            created_at: row.createdAt.toISOString(),
        };
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
                .where(and(eq(templates.tenantId, tenantId), eq(templates.kind, 'automation'), eq(templates.id, numeric)))
                .returning({ id: templates.id, name: templates.name }),
        );
        if (!deleted) {
            throw new NotFoundException({
                code: 'template_not_found',
                message: `Plantilla "${id}" no encontrada`,
                data: { status: 404 },
            });
        }
        void this.audit.log({
            tenantId,
            userId: actorId,
            action: 'automation_template.delete',
            targetType: 'automation_template',
            targetId: deleted.id,
            targetLabel: deleted.name,
        });
    }
}
