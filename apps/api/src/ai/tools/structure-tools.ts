import { Injectable } from '@nestjs/common';
import {
    AGGREGATE_METRICS,
    BLUEPRINT_VERSION,
    COLOR_PRESETS,
    FIELD_METRICS,
    TIME_BUCKETS,
    aggregateMetricSchema,
    createAutomationSchema,
    createDashboardSchema,
    createViewSchema,
    fieldSlugSchema,
    filterOperatorSchema,
    parseFieldConfig,
    parseViewConfig,
    timeBucketSchema,
    updateFieldSchema,
    updateListSchema,
    viewTypeSchema,
    type AiProposal,
    type AiProposalKind,
    type AiProposalPreview,
    type Capability,
    type CreateAutomationInput,
    type CreateDashboardInput,
    type CreateFieldInput,
    type CreateViewInput,
    type Field,
    type FieldType,
    type FilterNode,
    type List,
    type ListBlueprint,
    type UpdateFieldInput,
    type UpdateListInput,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AutomationsService } from '../../automations/automations.service';
import { DashboardsService } from '../../dashboards/dashboards.service';
import { records } from '../../db/schema';
import { FieldsService } from '../../fields/fields.service';
import { ListsService } from '../../lists/lists.service';
import { TenantDb } from '../../tenancy/tenant-db.service';
import { BlueprintService } from '../../templates/blueprint.service';
import { ViewsService } from '../../views/views.service';
import { ProposalsStore, type AiApplyOutcome, type AiProposalApplier, type StoredProposal } from '../proposals.store';
import { AiToolError, AiToolRegistry, type AiToolContext, type AiToolResult } from './registry';

// ── Vocabulario que habla el modelo (slugs, nunca ids) ──────────────────

/** Tipos que el asistente puede crear. Lookup/rollup quedan para una fase posterior. */
const AI_FIELD_TYPES = [
    'text', 'long_text', 'number', 'currency', 'select', 'multi_select', 'date', 'datetime',
    'checkbox', 'url', 'email', 'phone', 'user', 'relation', 'file', 'rating', 'percent', 'duration', 'computed',
] as const satisfies readonly FieldType[];

const optionSpec = z.object({
    label: z.string().min(1).max(190).describe('Texto visible de la opción'),
    value: z.string().min(1).max(190).optional().describe('Clave interna estable (snake_case). Se deriva del label si falta.'),
    color: z.enum(COLOR_PRESETS).optional().describe('Color del chip'),
});

const fieldSpec = z.object({
    label: z.string().min(1).max(190).describe('Nombre visible del campo'),
    slug: fieldSlugSchema.optional().describe('Identificador interno en snake_case (arranca con letra, máx 63). Se deriva del label si falta.'),
    type: z.enum(AI_FIELD_TYPES),
    description: z.string().max(500).optional().describe('Ayuda para el equipo: cómo se usa este campo'),
    is_required: z.boolean().optional(),
    is_unique: z.boolean().optional().describe('Sin repetidos (p. ej. un número de documento)'),
    options: z.array(optionSpec).max(60).optional().describe('Sólo select / multi_select'),
    currency: z.string().length(3).optional().describe('Sólo currency: código ISO 4217 (USD, COP, EUR…)'),
    precision: z.number().int().min(0).max(4).optional().describe('Decimales (number/currency/percent)'),
    min: z.number().optional(),
    max: z.number().optional().describe('number/currency: máximo. rating: cantidad de estrellas (1-10)'),
    relation_to: z.string().max(63).optional().describe('Sólo relation: slug de la lista destino (existente, o la `key` de otra lista del mismo pedido)'),
    highlight_overdue: z.boolean().optional().describe('date/datetime: pintar en rojo las fechas vencidas'),
    default_country: z.string().length(2).optional().describe('phone: país por defecto ISO-2 (CO, MX, AR…)'),
    computed: z
        .object({
            operation: z.enum(['date_diff_months', 'date_diff_days', 'sum', 'product', 'subtract', 'divide', 'concat', 'abs']),
            inputs: z.array(fieldSlugSchema).min(1).max(20).describe('Slugs de los campos de entrada, en orden'),
            separator: z.string().max(20).optional().describe('Sólo concat'),
        })
        .optional()
        .describe('Sólo computed: cómo se calcula'),
});
type FieldSpec = z.infer<typeof fieldSpec>;

const filterRuleSpec = z.object({
    field: fieldSlugSchema.describe('Slug del campo'),
    op: filterOperatorSchema,
    value: z.unknown().optional().describe('Para select usar el `value` de la opción; para in/nin un array'),
});
type FilterRuleSpec = z.infer<typeof filterRuleSpec>;

const viewSpec = z.object({
    name: z.string().min(1).max(190),
    type: viewTypeSchema.describe('table | kanban | calendar | cards'),
    group_by: fieldSlugSchema.optional().describe('kanban: campo select por el que se arman las columnas (obligatorio). table: agrupar filas por este campo.'),
    date_field: fieldSlugSchema.optional().describe('calendar: campo date/datetime (obligatorio)'),
    filters: z.array(filterRuleSpec).max(20).optional().describe('Condiciones unidas por AND'),
    sort: z.array(z.object({ field: fieldSlugSchema, dir: z.enum(['asc', 'desc']) })).max(5).optional(),
    hidden_columns: z.array(fieldSlugSchema).max(60).optional().describe('table: columnas ocultas'),
    card_fields: z.array(fieldSlugSchema).max(12).optional().describe('cards: campos que se muestran en la tarjeta'),
    is_default: z.boolean().optional(),
});
type ViewSpec = z.infer<typeof viewSpec>;

const listSpec = z.object({
    key: z.string().min(1).max(63).optional().describe('Clave para referenciar esta lista desde otra del mismo pedido (relation_to). Default: el slug del nombre.'),
    name: z.string().min(1).max(190),
    icon: z.string().max(64).optional().describe('Icono del catálogo (briefcase, receipt, users, calendar, rocket, clipboard, building, wallet, flag, star…)'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Color hex del icono'),
    fields: z.array(fieldSpec).min(1).max(60),
    title_field: fieldSlugSchema.optional().describe('Campo de texto que hace de título del registro (default: el primer texto)'),
    views: z.array(viewSpec).max(8).optional().describe('Vistas guardadas además de la tabla por defecto'),
    automations: z
        .array(
            z.object({
                name: z.string().min(1).max(190),
                description: z.string().max(2000).optional(),
                trigger_type: z.string().min(1),
                trigger_config: z.record(z.unknown()).optional(),
                actions: z.array(z.record(z.unknown())).min(1),
                is_active: z.boolean().optional(),
            }),
        )
        .max(10)
        .optional()
        .describe('Automatizaciones de la lista (mismo shape que propose_create_automation)'),
    sample_records: z
        .array(z.record(z.unknown()))
        .max(20)
        .optional()
        .describe('Registros de ejemplo como {slug: valor}. Sólo si la persona los pidió.'),
});
type ListSpec = z.infer<typeof listSpec>;

const AI_WIDGET_TYPES = ['kpi', 'gauge', 'stat_delta', 'chart_bar', 'chart_pie', 'chart_line', 'chart_area', 'funnel', 'table', 'heading', 'text'] as const;

const widgetSpecInput = z.object({
    type: z.enum(AI_WIDGET_TYPES),
    title: z.string().max(190).default(''),
    list: z.string().max(63).optional().describe('Slug de la lista (obligatorio salvo heading/text)'),
    metric: aggregateMetricSchema.optional().describe(`Default count. ${AGGREGATE_METRICS.join(' | ')}`),
    metric_field: fieldSlugSchema.optional().describe('Campo de la métrica (obligatorio para sum/avg/min/max/count_unique/count_empty/count_true/count_false)'),
    group_by: fieldSlugSchema.optional().describe('chart_bar/chart_pie/funnel: campo por el que se agrupa (select, user, checkbox…)'),
    date_field: fieldSlugSchema.optional().describe('chart_line/chart_area/stat_delta: campo de fecha del eje temporal'),
    time_bucket: timeBucketSchema.optional().describe(`Granularidad temporal: ${TIME_BUCKETS.join(' | ')} (default month)`),
    filters: z.array(filterRuleSpec).max(20).optional(),
    limit: z.number().int().min(1).max(50).optional().describe('table: filas'),
    sort_field: fieldSlugSchema.optional().describe('table: campo de orden'),
    sort_dir: z.enum(['asc', 'desc']).optional(),
    columns: z.array(fieldSlugSchema).max(8).optional().describe('table: columnas visibles'),
    goal: z.number().optional().describe('kpi/gauge: meta'),
    prefix: z.string().max(8).optional().describe('kpi: prefijo ($)'),
    suffix: z.string().max(8).optional().describe('kpi: sufijo (%)'),
    period_days: z.number().int().min(1).max(365).optional().describe('stat_delta: días de cada ventana (default 30)'),
    text: z.string().max(2000).optional().describe('heading: subtítulo; text: contenido'),
    width: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]).optional().describe('Ancho en columnas de 12 (default: kpi 3, charts 6, table 12)'),
});
type WidgetSpecInput = z.infer<typeof widgetSpecInput>;

const automationSpec = z.object({
    list: z.string().max(63).describe('Slug de la lista'),
    name: z.string().min(1).max(190),
    description: z.string().max(2000).optional(),
    trigger_type: z.enum(['record_created', 'record_updated', 'due_date_reached', 'scheduled', 'incoming_webhook']),
    trigger_config: z
        .record(z.unknown())
        .optional()
        .describe(
            'record_updated: {changed_fields: [slugs], field_filters: [{field, op, value}]}. ' +
                'due_date_reached: {due_field: slug, offset_minutes: n (negativo = antes; 1440 = 1 día), field_filters}. ' +
                'scheduled: {cron: "0 9 * * 1"}. record_created/incoming_webhook: {field_filters?}.',
        ),
    actions: z
        .array(z.record(z.unknown()))
        .min(1)
        .max(20)
        .describe(
            'Cada acción: {type, config, condition?}. type ∈ send_email {to, subject, body, is_html?, cc?, bcc?} | ' +
                'update_field {values: {slug: valor}} | create_record {target_list: slug, values: {slug: valor}} | ' +
                'call_webhook {url, method?, headers?, body_template?} | if_else {condition: [{field, op, value}], then_actions: [...], else_actions: [...]}. ' +
                'Merge tags en cualquier texto: {{slug}}, {{slug|label}}, {{before.slug}}, {{record.id}}, {{date.today}}, {{fecha|+1m|-1d}}.',
        ),
    is_active: z.boolean().optional().describe('Default true'),
});
type AutomationSpec = z.infer<typeof automationSpec>;

// ── Payloads (lo que se guarda y después se aplica) ─────────────────────

type Payload =
    | { kind: 'create_list'; blueprint: ListBlueprint; includeRecords: boolean }
    | { kind: 'add_fields'; listId: number; listSlug: string; fields: CreateFieldInput[] }
    | { kind: 'update_field'; listId: number; listSlug: string; fieldId: number; patch: UpdateFieldInput }
    | { kind: 'delete_field'; listId: number; listSlug: string; fieldId: number }
    | { kind: 'create_view'; listId: number; listSlug: string; input: CreateViewInput }
    | { kind: 'create_dashboard'; input: CreateDashboardInput }
    | { kind: 'create_automation'; listId: number; listSlug: string; input: CreateAutomationInput }
    | { kind: 'update_list'; listId: number; listSlug: string; patch: UpdateListInput };

const CAPABILITY_BY_KIND: Record<AiProposalKind, Capability> = {
    create_list: 'manage_lists',
    update_list: 'manage_lists',
    add_fields: 'manage_fields',
    update_field: 'manage_fields',
    delete_field: 'manage_fields',
    create_view: 'manage_views',
    create_dashboard: 'manage_dashboards',
    create_automation: 'manage_automations',
};

/**
 * Herramientas de ESTRUCTURA del asistente (fase 1, ADR-S21): leer el
 * esquema del workspace y PROPONER listas, campos, vistas, tableros y
 * automatizaciones. Ninguna `propose_*` escribe: valida el pedido contra
 * el esquema real (slugs, tipos, config), lo resuelve a ids y lo guarda
 * como propuesta; la persona la aplica desde la tarjeta y recién ahí
 * `apply` llama a los MISMOS services que usa la interfaz (con su ACL,
 * sus límites de plan, su realtime y su bitácora).
 */
@Injectable()
export class StructureTools implements AiProposalApplier {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly views: ViewsService,
        private readonly automations: AutomationsService,
        private readonly dashboards: DashboardsService,
        private readonly blueprint: BlueprintService,
        private readonly store: ProposalsStore,
    ) {}

    registerInto(registry: AiToolRegistry): void {
        registry.register({
            name: 'list_lists',
            label: 'Leyendo las listas',
            description: 'Lista todas las listas (tablas) del workspace con su slug, nombre y cantidad de campos. Usala primero para saber qué existe.',
            capability: null,
            input: z.object({}),
            run: (ctx) => this.listLists(ctx),
        });
        registry.register({
            name: 'get_list_schema',
            label: 'Leyendo el esquema de la lista',
            description: 'Devuelve los campos (slug, tipo, opciones), vistas y automatizaciones de una lista. SIEMPRE llamala antes de proponer cambios sobre una lista existente.',
            capability: null,
            input: z.object({ list: z.string().max(63).describe('Slug de la lista') }),
            run: (ctx, input) => this.getListSchema(ctx, input as { list: string }),
        });
        registry.register({
            name: 'propose_create_list',
            label: 'Armando la propuesta de lista',
            description:
                'Propone crear una o varias listas nuevas con sus campos, vistas y automatizaciones. Varias listas en un mismo pedido pueden relacionarse entre sí (relation_to = key). La persona verá una vista previa y decidirá si aplicarla.',
            capability: 'manage_lists',
            input: z.object({ lists: z.array(listSpec).min(1).max(5) }),
            run: (ctx, input) => this.proposeCreateList(ctx, input as { lists: ListSpec[] }),
        });
        registry.register({
            name: 'propose_add_fields',
            label: 'Armando la propuesta de campos',
            description: 'Propone agregar campos a una lista existente.',
            capability: 'manage_fields',
            input: z.object({ list: z.string().max(63), fields: z.array(fieldSpec).min(1).max(30) }),
            run: (ctx, input) => this.proposeAddFields(ctx, input as { list: string; fields: FieldSpec[] }),
        });
        registry.register({
            name: 'propose_update_field',
            label: 'Armando el cambio del campo',
            description:
                'Propone modificar un campo existente: nombre, descripción, obligatorio, sin repetidos, opciones (agregar o reemplazar) o configuración. No cambia el tipo.',
            capability: 'manage_fields',
            input: z.object({
                list: z.string().max(63),
                field: fieldSlugSchema.describe('Slug del campo'),
                label: z.string().min(1).max(190).optional(),
                description: z.string().max(500).nullable().optional(),
                is_required: z.boolean().optional(),
                is_unique: z.boolean().optional(),
                add_options: z.array(optionSpec).max(60).optional().describe('select/multi_select: opciones a AGREGAR a las existentes'),
                replace_options: z.array(optionSpec).max(60).optional().describe('select/multi_select: reemplazar TODAS las opciones (ojo: los valores guardados que no estén quedan huérfanos)'),
                config: z.record(z.unknown()).optional().describe('Reemplazo completo de la configuración (avanzado)'),
            }),
            run: (ctx, input) => this.proposeUpdateField(ctx, input as UpdateFieldSpec),
        });
        registry.register({
            name: 'propose_delete_field',
            label: 'Armando el borrado del campo',
            description: 'Propone ELIMINAR un campo y todos sus valores guardados. Es destructivo: confirmá con la persona antes de proponerlo.',
            capability: 'manage_fields',
            input: z.object({ list: z.string().max(63), field: fieldSlugSchema }),
            run: (ctx, input) => this.proposeDeleteField(ctx, input as { list: string; field: string }),
        });
        registry.register({
            name: 'propose_create_view',
            label: 'Armando la vista',
            description: 'Propone una vista guardada (tabla, kanban, calendario o tarjetas) sobre una lista existente, con filtros, orden y agrupación.',
            capability: 'manage_views',
            input: z.object({ list: z.string().max(63), view: viewSpec }),
            run: (ctx, input) => this.proposeCreateView(ctx, input as { list: string; view: ViewSpec }),
        });
        registry.register({
            name: 'propose_create_dashboard',
            label: 'Armando el tablero',
            description:
                'Propone un tablero (dashboard) con widgets sobre una o varias listas existentes: KPIs, medidores, gráficos por categoría o en el tiempo, embudos y tablas. El layout se arma solo.',
            capability: 'manage_dashboards',
            input: z.object({
                name: z.string().min(1).max(190),
                description: z.string().max(2000).optional(),
                widgets: z.array(widgetSpecInput).min(1).max(24),
            }),
            run: (ctx, input) => this.proposeCreateDashboard(ctx, input as { name: string; description?: string; widgets: WidgetSpecInput[] }),
        });
        registry.register({
            name: 'propose_create_automation',
            label: 'Armando la automatización',
            description: 'Propone una automatización sobre una lista existente: disparador + acciones (correo, actualizar campo, crear registro en otra lista, webhook, condicional).',
            capability: 'manage_automations',
            input: automationSpec,
            run: (ctx, input) => this.proposeCreateAutomation(ctx, input as AutomationSpec),
        });
        registry.register({
            name: 'propose_update_list',
            label: 'Armando el cambio de la lista',
            description: 'Propone cambiar el nombre, icono, color o campo de título de una lista existente.',
            capability: 'manage_lists',
            input: z.object({
                list: z.string().max(63),
                name: z.string().min(1).max(190).optional(),
                icon: z.string().max(64).nullable().optional(),
                color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
                title_field: fieldSlugSchema.optional().describe('Campo de texto que hace de título'),
            }),
            run: (ctx, input) => this.proposeUpdateList(ctx, input as UpdateListSpec),
        });
    }

    // ── Lectura ──────────────────────────────────────────────────────────

    private async listLists(ctx: AiToolContext): Promise<AiToolResult> {
        const lists = await this.lists.list(ctx.tenantId);
        const out = [];
        for (const l of lists) {
            const fields = await this.fields.listByListId(ctx.tenantId, l.id);
            out.push({ slug: l.slug, name: l.name, icon: l.icon, fields_count: fields.length, field_slugs: fields.map((f) => f.slug) });
        }
        return { content: { lists: out, current_list: ctx.listSlug ?? null } };
    }

    private async getListSchema(ctx: AiToolContext, input: { list: string }): Promise<AiToolResult> {
        const list = await this.resolveList(ctx, input.list);
        const [fields, views, autos, count] = await Promise.all([
            this.fields.listByListId(ctx.tenantId, list.id),
            this.views.list(ctx.tenantId, String(list.id)),
            this.automations.list(ctx.tenantId, String(list.id)),
            this.countRecords(ctx.tenantId, list.id),
        ]);
        const allLists = await this.lists.list(ctx.tenantId);
        const listById = new Map(allLists.map((l) => [l.id, l]));
        const fieldById = new Map(fields.map((f) => [f.id, f]));
        return {
            content: {
                list: { slug: list.slug, name: list.name, icon: list.icon, color: list.color, records_count: count },
                fields: fields.map((f) => describeFieldForModel(f, listById, fieldById)),
                views: views.map((v) => ({ id: v.id, name: v.name, type: v.type, is_default: v.is_default })),
                automations: autos.map((a) => ({ id: a.id, name: a.name, trigger_type: a.trigger_type, is_active: a.is_active })),
            },
        };
    }

    // ── Propuestas ───────────────────────────────────────────────────────

    private async proposeCreateList(ctx: AiToolContext, input: { lists: ListSpec[] }): Promise<AiToolResult> {
        const existing = await this.lists.list(ctx.tenantId);
        const existingBySlug = new Map(existing.map((l) => [l.slug, l]));
        const keys = new Set<string>();
        const packLists: ListBlueprint['lists'] = [];

        for (const spec of input.lists) {
            const key = spec.key ?? toSlug(spec.name);
            if (keys.has(key)) throw new AiToolError(`Dos listas del pedido usan la misma key «${key}».`);
            keys.add(key);
        }
        // Un nombre ya usado en el workspace se avisa: el slug se
        // desambigua solo al crear, pero la persona seguramente quería la
        // que ya existe.
        for (const spec of input.lists) {
            const clash = existing.find((l) => l.name.trim().toLowerCase() === spec.name.trim().toLowerCase());
            if (clash) {
                throw new AiToolError(
                    `Ya existe una lista llamada «${clash.name}» (slug ${clash.slug}). Preguntale a la persona si quiere agregarle campos (propose_add_fields) o crear otra con un nombre distinto.`,
                );
            }
        }

        for (const spec of input.lists) {
            const key = spec.key ?? toSlug(spec.name);
            const slugs = new Set<string>();
            const fields = spec.fields.map((f) => {
                const slug = f.slug ?? toSlug(f.label);
                if (slugs.has(slug)) throw new AiToolError(`La lista «${spec.name}» repite el campo «${slug}».`);
                slugs.add(slug);
                const { config } = this.buildFieldConfig(f, slug, {
                    packKeys: keys,
                    existingBySlug,
                    localSlugs: () => slugs,
                    forBlueprint: true,
                });
                return {
                    label: f.label,
                    slug,
                    type: f.type,
                    config,
                    is_required: f.is_required ?? false,
                    is_unique: f.is_unique ?? false,
                    is_indexed: false,
                    description: f.description ?? null,
                };
            });
            const fieldTypeBySlug = new Map(fields.map((f) => [f.slug, f.type]));
            const requireSlug = (slug: string, where: string): void => {
                if (!fieldTypeBySlug.has(slug)) {
                    throw new AiToolError(`${where}: el campo «${slug}» no existe en «${spec.name}». Campos: ${[...fieldTypeBySlug.keys()].join(', ')}.`);
                }
            };

            const settings: Record<string, unknown> = {};
            if (spec.title_field) {
                requireSlug(spec.title_field, 'title_field');
                const t = fieldTypeBySlug.get(spec.title_field);
                if (t !== 'text' && t !== 'long_text') throw new AiToolError(`title_field debe ser un campo de texto («${spec.title_field}» es ${t}).`);
                settings.title_field_id = { $field: spec.title_field };
            }

            const views = (spec.views ?? []).map((v) => {
                const config = this.buildViewConfig(v, (slug) => {
                    requireSlug(slug, `Vista «${v.name}»`);
                    return { id: { $field: slug }, type: fieldTypeBySlug.get(slug)! };
                });
                return { name: v.name, type: v.type, config, is_default: v.is_default ?? false };
            });

            const automations = (spec.automations ?? []).map((a) => {
                const parsed = createAutomationSchema.safeParse({ ...a, is_active: a.is_active ?? true });
                if (!parsed.success) throw new AiToolError(`Automatización «${a.name}»: ${zodIssues(parsed.error)}`);
                this.validateAutomationSlugs(parsed.data, new Set(fieldTypeBySlug.keys()), (target) => {
                    if (keys.has(target)) return { $list: target } as unknown as number;
                    const l = existingBySlug.get(target);
                    if (!l) throw new AiToolError(`Automatización «${a.name}»: la lista destino «${target}» no existe.`);
                    return l.id;
                });
                return {
                    name: parsed.data.name,
                    description: parsed.data.description ?? null,
                    trigger_type: parsed.data.trigger_type,
                    trigger_config: (parsed.data.trigger_config ?? {}) as Record<string, unknown>,
                    actions: parsed.data.actions as unknown[],
                    is_active: parsed.data.is_active ?? true,
                };
            });

            const recordsBp = (spec.sample_records ?? []).map((data, i) => {
                for (const k of Object.keys(data)) requireSlug(k, `Registro de ejemplo ${i + 1}`);
                return { key: `r${i + 1}`, data };
            });

            packLists.push({
                key,
                name: spec.name,
                icon: spec.icon ?? null,
                color: spec.color ?? null,
                settings,
                fields,
                views,
                automations,
                records: recordsBp,
            });
        }

        const blueprint: ListBlueprint = { version: BLUEPRINT_VERSION, lists: packLists, dashboards: [] };
        const includeRecords = packLists.some((l) => l.records.length > 0);
        const preview: AiProposalPreview = {
            lists: packLists.map((l) => ({
                name: l.name,
                fields: l.fields.map((f) => ({ label: f.label, type: f.type })),
                views: l.views.map((v) => ({ name: v.name, type: v.type })),
                automations: l.automations.map((a) => a.name),
                records_count: l.records.length,
            })),
            fields: [],
            widgets: [],
            automation: null,
            changes: [],
        };
        const names = packLists.map((l) => `«${l.name}»`).join(' y ');
        return this.saveProposal(ctx, {
            kind: 'create_list',
            title: packLists.length === 1 ? `Crear la lista ${names}` : `Crear ${packLists.length} listas: ${names}`,
            summary: `Se crean ${packLists.length === 1 ? 'la lista' : 'las listas'} ${names} con ${packLists.reduce((n, l) => n + l.fields.length, 0)} campos${
                packLists.some((l) => l.views.length) ? ', sus vistas' : ''
            }${packLists.some((l) => l.automations.length) ? ' y automatizaciones' : ''}${includeRecords ? ', más registros de ejemplo' : ''}.`,
            destructive: false,
            listSlug: null,
            preview,
            payload: { kind: 'create_list', blueprint, includeRecords },
        });
    }

    private async proposeAddFields(ctx: AiToolContext, input: { list: string; fields: FieldSpec[] }): Promise<AiToolResult> {
        const list = await this.resolveList(ctx, input.list);
        const current = await this.fields.listByListId(ctx.tenantId, list.id);
        const existingLists = await this.lists.list(ctx.tenantId);
        const existingBySlug = new Map(existingLists.map((l) => [l.slug, l]));
        const currentBySlug = new Map(current.map((f) => [f.slug, f]));
        const newSlugs = new Set<string>();
        const inputs: CreateFieldInput[] = [];
        for (const f of input.fields) {
            const slug = f.slug ?? toSlug(f.label);
            if (currentBySlug.has(slug)) throw new AiToolError(`La lista ya tiene un campo «${slug}». Usá propose_update_field para modificarlo.`);
            if (newSlugs.has(slug)) throw new AiToolError(`El pedido repite el campo «${slug}».`);
            newSlugs.add(slug);
            const { config } = this.buildFieldConfig(f, slug, {
                packKeys: new Set(),
                existingBySlug,
                localSlugs: () => new Set([...currentBySlug.keys(), ...newSlugs]),
                forBlueprint: false,
                resolveInput: (s) => currentBySlug.get(s)?.id,
            });
            inputs.push({
                label: f.label,
                slug,
                type: f.type,
                config,
                is_required: f.is_required,
                is_unique: f.is_unique,
                description: f.description ?? null,
            });
        }
        return this.saveProposal(ctx, {
            kind: 'add_fields',
            title: `Agregar ${inputs.length} campo${inputs.length === 1 ? '' : 's'} a «${list.name}»`,
            summary: `Se agregan a «${list.name}»: ${inputs.map((f) => `${f.label} (${f.type})`).join(', ')}.`,
            destructive: false,
            listSlug: list.slug,
            preview: {
                lists: [],
                fields: inputs.map((f) => ({ label: f.label, type: f.type, detail: describeConfig(f.type, f.config ?? {}, existingLists) })),
                widgets: [],
                automation: null,
                changes: [],
            },
            payload: { kind: 'add_fields', listId: list.id, listSlug: list.slug, fields: inputs },
        });
    }

    private async proposeUpdateField(ctx: AiToolContext, input: UpdateFieldSpec): Promise<AiToolResult> {
        const list = await this.resolveList(ctx, input.list);
        const field = await this.resolveField(ctx, list, input.field);
        const patch: UpdateFieldInput = {};
        const changes: AiProposalPreview['changes'] = [];
        if (input.label !== undefined && input.label !== field.label) {
            patch.label = input.label;
            changes.push({ label: 'Nombre', from: field.label, to: input.label });
        }
        if (input.description !== undefined && (input.description ?? null) !== (field.description ?? null)) {
            patch.description = input.description;
            changes.push({ label: 'Descripción', from: field.description ?? null, to: input.description ?? '' });
        }
        if (input.is_required !== undefined && input.is_required !== field.is_required) {
            patch.is_required = input.is_required;
            changes.push({ label: 'Obligatorio', from: yesNo(field.is_required), to: yesNo(input.is_required) });
        }
        if (input.is_unique !== undefined && input.is_unique !== field.is_unique) {
            patch.is_unique = input.is_unique;
            changes.push({ label: 'Sin repetidos', from: yesNo(field.is_unique), to: yesNo(input.is_unique) });
        }
        if (input.add_options || input.replace_options) {
            if (field.type !== 'select' && field.type !== 'multi_select') {
                throw new AiToolError(`«${field.slug}» es ${field.type}: sólo select/multi_select tienen opciones.`);
            }
            const currentOpts = ((field.config as { options?: Array<{ value: string; label: string; color?: string }> }).options ?? []);
            const incoming = normalizeOptions(input.replace_options ?? input.add_options ?? []);
            const merged = input.replace_options
                ? incoming
                : [...currentOpts, ...incoming.filter((o) => !currentOpts.some((c) => c.value === o.value))];
            patch.config = parseFieldConfig(field.type, { ...field.config, options: merged });
            changes.push({
                label: 'Opciones',
                from: currentOpts.map((o) => o.label).join(', ') || null,
                to: merged.map((o) => o.label).join(', '),
            });
        } else if (input.config !== undefined) {
            patch.config = parseFieldConfig(field.type, input.config);
            changes.push({ label: 'Configuración', from: JSON.stringify(field.config), to: JSON.stringify(patch.config) });
        }
        if (Object.keys(patch).length === 0) throw new AiToolError('No hay ningún cambio respecto al campo actual.');
        const parsed = updateFieldSchema.safeParse(patch);
        if (!parsed.success) throw new AiToolError(zodIssues(parsed.error));
        return this.saveProposal(ctx, {
            kind: 'update_field',
            title: `Modificar el campo «${field.label}» de «${list.name}»`,
            summary: `Se cambia ${changes.map((c) => c.label.toLowerCase()).join(', ')} del campo «${field.label}».`,
            destructive: Boolean(input.replace_options),
            listSlug: list.slug,
            preview: { lists: [], fields: [], widgets: [], automation: null, changes },
            payload: { kind: 'update_field', listId: list.id, listSlug: list.slug, fieldId: field.id, patch: parsed.data },
        });
    }

    private async proposeDeleteField(ctx: AiToolContext, input: { list: string; field: string }): Promise<AiToolResult> {
        const list = await this.resolveList(ctx, input.list);
        const field = await this.resolveField(ctx, list, input.field);
        const count = await this.countRecords(ctx.tenantId, list.id);
        return this.saveProposal(ctx, {
            kind: 'delete_field',
            title: `Eliminar el campo «${field.label}» de «${list.name}»`,
            summary: `Se elimina el campo «${field.label}» (${field.type}) y sus valores en ${count} registro${count === 1 ? '' : 's'}. No se puede deshacer.`,
            destructive: true,
            listSlug: list.slug,
            preview: { lists: [], fields: [{ label: field.label, type: field.type, detail: 'se elimina' }], widgets: [], automation: null, changes: [] },
            payload: { kind: 'delete_field', listId: list.id, listSlug: list.slug, fieldId: field.id },
        });
    }

    private async proposeCreateView(ctx: AiToolContext, input: { list: string; view: ViewSpec }): Promise<AiToolResult> {
        const list = await this.resolveList(ctx, input.list);
        const fields = await this.fields.listByListId(ctx.tenantId, list.id);
        const bySlug = new Map(fields.map((f) => [f.slug, f]));
        const config = this.buildViewConfig(input.view, (slug) => {
            const f = bySlug.get(slug);
            if (!f) throw new AiToolError(`La vista referencia el campo «${slug}» que no existe en «${list.name}». Campos: ${fields.map((x) => x.slug).join(', ')}.`);
            return { id: f.id, type: f.type };
        });
        // La config se valida contra el schema real del tipo de vista.
        let parsedConfig: Record<string, unknown>;
        try {
            parsedConfig = parseViewConfig(input.view.type, config);
        } catch (err) {
            throw new AiToolError(`Configuración de la vista inválida: ${err instanceof Error ? err.message : String(err)}`);
        }
        const viewInput: CreateViewInput = createViewSchema.parse({
            name: input.view.name,
            type: input.view.type,
            config: parsedConfig,
            is_default: input.view.is_default ?? false,
        });
        const details: string[] = [];
        if (input.view.group_by) details.push(`agrupada por «${bySlug.get(input.view.group_by)?.label}»`);
        if (input.view.date_field) details.push(`sobre «${bySlug.get(input.view.date_field)?.label}»`);
        if (input.view.filters?.length) details.push(`${input.view.filters.length} filtro${input.view.filters.length === 1 ? '' : 's'}`);
        if (input.view.sort?.length) details.push('con orden');
        return this.saveProposal(ctx, {
            kind: 'create_view',
            title: `Crear la vista «${input.view.name}» en «${list.name}»`,
            summary: `Vista ${viewTypeLabel(input.view.type)} «${input.view.name}»${details.length ? ' ' + details.join(', ') : ''}.`,
            destructive: false,
            listSlug: list.slug,
            preview: {
                lists: [{ name: list.name, fields: [], views: [{ name: input.view.name, type: input.view.type }], automations: [], records_count: 0 }],
                fields: [],
                widgets: [],
                automation: null,
                changes: (input.view.filters ?? []).map((f) => ({
                    label: `Filtro: ${bySlug.get(f.field)?.label ?? f.field}`,
                    from: null,
                    to: `${f.op} ${f.value === undefined ? '' : JSON.stringify(f.value)}`.trim(),
                })),
            },
            payload: { kind: 'create_view', listId: list.id, listSlug: list.slug, input: viewInput },
        });
    }

    private async proposeCreateDashboard(
        ctx: AiToolContext,
        input: { name: string; description?: string; widgets: WidgetSpecInput[] },
    ): Promise<AiToolResult> {
        const lists = await this.lists.list(ctx.tenantId);
        const bySlug = new Map(lists.map((l) => [l.slug, l]));
        const fieldsCache = new Map<number, Field[]>();
        const fieldsOf = async (list: List): Promise<Field[]> => {
            let f = fieldsCache.get(list.id);
            if (!f) {
                f = await this.fields.listByListId(ctx.tenantId, list.id);
                fieldsCache.set(list.id, f);
            }
            return f;
        };

        const widgets: WidgetSpec[] = [];
        const previewWidgets: AiProposalPreview['widgets'] = [];
        let x = 0;
        let y = 0;
        let rowH = 0;
        const place = (w: number, h: number): { x: number; y: number; w: number; h: number } => {
            if (x + w > 12) {
                x = 0;
                y += rowH;
                rowH = 0;
            }
            const layout = { x, y, w, h };
            x += w;
            rowH = Math.max(rowH, h);
            return layout;
        };

        for (const [i, w] of input.widgets.entries()) {
            const where = `Widget ${i + 1} («${w.title || w.type}»)`;
            if (w.type === 'heading' || w.type === 'text') {
                const width = w.width ?? 12;
                const layout = place(width, w.type === 'heading' ? 1 : 2);
                const config: Record<string, unknown> = w.type === 'heading' ? { subtitle: w.text ?? '' } : { text: w.text ?? '' };
                widgets.push({ id: newWidgetId(), type: w.type, list_id: 0, title: w.title, config, layout });
                previewWidgets.push({ type: w.type, title: w.title || (w.text ?? ''), detail: null });
                continue;
            }
            if (!w.list) throw new AiToolError(`${where}: falta la lista.`);
            const list = bySlug.get(w.list);
            if (!list) throw new AiToolError(`${where}: la lista «${w.list}» no existe. Listas: ${lists.map((l) => l.slug).join(', ')}.`);
            const fields = await fieldsOf(list);
            const fBySlug = new Map(fields.map((f) => [f.slug, f]));
            const need = (slug: string | undefined, what: string, types?: readonly FieldType[]): Field | undefined => {
                if (!slug) return undefined;
                const f = fBySlug.get(slug);
                if (!f) throw new AiToolError(`${where}: ${what} «${slug}» no existe en «${list.name}». Campos: ${fields.map((x) => x.slug).join(', ')}.`);
                if (types && !types.includes(f.type)) throw new AiToolError(`${where}: ${what} «${slug}» es ${f.type}; se esperaba ${types.join('/')}.`);
                return f;
            };
            const metric = w.metric ?? 'count';
            const metricField = need(w.metric_field, 'el campo de la métrica');
            if (FIELD_METRICS.includes(metric) && !metricField) {
                throw new AiToolError(`${where}: la métrica ${metric} necesita metric_field.`);
            }
            if (metricField && (metric === 'sum' || metric === 'avg') && !NUMERIC_TYPES.includes(metricField.type)) {
                throw new AiToolError(`${where}: ${metric} sólo aplica a campos numéricos («${metricField.slug}» es ${metricField.type}).`);
            }
            const config: Record<string, unknown> = { metric };
            if (metricField) config.metric_field_id = metricField.id;
            const detail: string[] = [metricLabel(metric, metricField?.label)];

            if (w.type === 'chart_bar' || w.type === 'chart_pie' || w.type === 'funnel') {
                const g = need(w.group_by, 'el campo de agrupación');
                if (!g) throw new AiToolError(`${where}: ${w.type} necesita group_by.`);
                config.group_by_field_id = g.id;
                detail.push(`por ${g.label}`);
                if (g.type === 'date' || g.type === 'datetime') config.time_bucket = w.time_bucket ?? 'month';
            }
            if (w.type === 'chart_line' || w.type === 'chart_area') {
                const d = need(w.date_field ?? w.group_by, 'el campo de fecha', DATE_TYPES);
                if (!d) throw new AiToolError(`${where}: ${w.type} necesita date_field (un campo date/datetime).`);
                config.group_by_field_id = d.id;
                config.date_field_id = d.id;
                config.time_bucket = w.time_bucket ?? 'month';
                detail.push(`por ${timeBucketLabel(config.time_bucket as string)} de ${d.label}`);
            }
            if (w.type === 'stat_delta') {
                const d = need(w.date_field, 'el campo de fecha', DATE_TYPES);
                if (!d) throw new AiToolError(`${where}: stat_delta necesita date_field.`);
                config.date_field_id = d.id;
                config.period_days = w.period_days ?? 30;
                detail.push(`vs. ${config.period_days} días anteriores`);
            }
            if (w.type === 'kpi' || w.type === 'gauge') {
                if (w.goal !== undefined) config.goal = w.goal;
                if (w.prefix) config.prefix = w.prefix;
                if (w.suffix) config.suffix = w.suffix;
                if (w.type === 'gauge' && w.goal === undefined) throw new AiToolError(`${where}: gauge necesita goal (meta).`);
            }
            if (w.type === 'table') {
                config.limit = w.limit ?? 10;
                const s = need(w.sort_field, 'el campo de orden');
                if (s) {
                    config.sort_field_id = s.id;
                    config.sort_dir = w.sort_dir ?? 'asc';
                }
                if (w.columns) config.visible_field_ids = w.columns.map((c) => need(c, 'la columna')!.id);
                detail.splice(0, detail.length, `${config.limit} filas`);
            }
            if (w.filters?.length) {
                config.filter_tree = this.buildFilterTree(w.filters, (slug) => need(slug, 'el campo del filtro')!.id);
                detail.push(`${w.filters.length} filtro${w.filters.length === 1 ? '' : 's'}`);
            }
            const defaults = DEFAULT_SIZE[w.type] ?? { w: 6, h: 4 };
            const layout = place(w.width ?? defaults.w, defaults.h);
            widgets.push({ id: newWidgetId(), type: w.type, list_id: list.id, title: w.title, config, layout });
            previewWidgets.push({ type: w.type, title: w.title || list.name, detail: `${list.name} · ${detail.join(' · ')}` });
        }

        const parsed = createDashboardSchema.safeParse({ name: input.name, description: input.description ?? null, widgets, settings: {} });
        if (!parsed.success) throw new AiToolError(zodIssues(parsed.error));
        const dataWidgets = widgets.filter((w) => w.list_id !== 0).length;
        return this.saveProposal(ctx, {
            kind: 'create_dashboard',
            title: `Crear el tablero «${input.name}»`,
            summary: `Tablero con ${dataWidgets} widget${dataWidgets === 1 ? '' : 's'} sobre ${[...new Set(widgets.filter((w) => w.list_id).map((w) => lists.find((l) => l.id === w.list_id)?.name))].map((n) => `«${n}»`).join(', ')}.`,
            destructive: false,
            listSlug: null,
            preview: { lists: [], fields: [], widgets: previewWidgets, automation: null, changes: [] },
            payload: { kind: 'create_dashboard', input: parsed.data },
        });
    }

    private async proposeCreateAutomation(ctx: AiToolContext, input: AutomationSpec): Promise<AiToolResult> {
        const list = await this.resolveList(ctx, input.list);
        const fields = await this.fields.listByListId(ctx.tenantId, list.id);
        const lists = await this.lists.list(ctx.tenantId);
        const bySlug = new Map(lists.map((l) => [l.slug, l]));
        const parsed = createAutomationSchema.safeParse({
            name: input.name,
            description: input.description,
            trigger_type: input.trigger_type,
            trigger_config: input.trigger_config ?? {},
            actions: input.actions,
            is_active: input.is_active ?? true,
        });
        if (!parsed.success) throw new AiToolError(zodIssues(parsed.error));
        const slugs = new Set(fields.map((f) => f.slug));
        this.validateAutomationSlugs(parsed.data, slugs, (target) => {
            const l = bySlug.get(target);
            if (!l) throw new AiToolError(`La lista destino «${target}» no existe. Listas: ${lists.map((x) => x.slug).join(', ')}.`);
            return l.id;
        });
        const actionLabels = describeActions(parsed.data.actions as Array<{ type: string; config: Record<string, unknown> }>, bySlug);
        return this.saveProposal(ctx, {
            kind: 'create_automation',
            title: `Crear la automatización «${input.name}» en «${list.name}»`,
            summary: `${triggerLabel(parsed.data.trigger_type, parsed.data.trigger_config ?? {}, fields)} → ${actionLabels.join(' → ')}.`,
            destructive: false,
            listSlug: list.slug,
            preview: {
                lists: [],
                fields: [],
                widgets: [],
                automation: { name: input.name, trigger: triggerLabel(parsed.data.trigger_type, parsed.data.trigger_config ?? {}, fields), actions: actionLabels },
                changes: [],
            },
            payload: { kind: 'create_automation', listId: list.id, listSlug: list.slug, input: parsed.data },
        });
    }

    private async proposeUpdateList(ctx: AiToolContext, input: UpdateListSpec): Promise<AiToolResult> {
        const list = await this.resolveList(ctx, input.list);
        const patch: UpdateListInput = {};
        const changes: AiProposalPreview['changes'] = [];
        if (input.name !== undefined && input.name !== list.name) {
            patch.name = input.name;
            changes.push({ label: 'Nombre', from: list.name, to: input.name });
        }
        if (input.icon !== undefined && (input.icon ?? null) !== list.icon) {
            patch.icon = input.icon;
            changes.push({ label: 'Icono', from: list.icon, to: input.icon ?? '' });
        }
        if (input.color !== undefined && (input.color ?? null) !== list.color) {
            patch.color = input.color;
            changes.push({ label: 'Color', from: list.color, to: input.color ?? '' });
        }
        if (input.title_field !== undefined) {
            const field = await this.resolveField(ctx, list, input.title_field);
            if (field.type !== 'text' && field.type !== 'long_text') throw new AiToolError(`El campo de título debe ser de texto («${field.slug}» es ${field.type}).`);
            const current = (list.settings as { title_field_id?: unknown }).title_field_id;
            if (current !== field.id) {
                patch.settings = { ...list.settings, title_field_id: field.id };
                changes.push({ label: 'Campo de título', from: null, to: field.label });
            }
        }
        if (Object.keys(patch).length === 0) throw new AiToolError('No hay ningún cambio respecto a la lista actual.');
        const parsed = updateListSchema.safeParse(patch);
        if (!parsed.success) throw new AiToolError(zodIssues(parsed.error));
        return this.saveProposal(ctx, {
            kind: 'update_list',
            title: `Modificar la lista «${list.name}»`,
            summary: `Se cambia ${changes.map((c) => c.label.toLowerCase()).join(', ')} de «${list.name}».`,
            destructive: false,
            listSlug: list.slug,
            preview: { lists: [], fields: [], widgets: [], automation: null, changes },
            payload: { kind: 'update_list', listId: list.id, listSlug: list.slug, patch: parsed.data },
        });
    }

    // ── Aplicar ──────────────────────────────────────────────────────────

    async apply(ctx: AiToolContext, stored: StoredProposal): Promise<AiApplyOutcome> {
        const payload = stored.payload as Payload;
        switch (payload.kind) {
            case 'create_list': {
                const res = await this.blueprint.materialize(ctx.tenantId, ctx.userId, payload.blueprint, {
                    includeRecords: payload.includeRecords,
                });
                return {
                    message: res.lists.length === 1 ? `Lista «${res.lists[0]!.name}» creada.` : `${res.lists.length} listas creadas.`,
                    links: res.lists.map((l) => ({ label: `Abrir «${l.name}»`, href: `/lists/${l.slug}/records` })),
                    warnings: res.warnings,
                };
            }
            case 'add_fields': {
                const created: string[] = [];
                const warnings: string[] = [];
                for (const f of payload.fields) {
                    try {
                        const field = await this.fields.create(ctx.tenantId, String(payload.listId), f);
                        created.push(field.label);
                    } catch (err) {
                        warnings.push(`Campo «${f.label}»: ${errMessage(err)}`);
                    }
                }
                return {
                    message: created.length ? `Campos agregados: ${created.join(', ')}.` : 'No se agregó ningún campo.',
                    links: [{ label: 'Ver la lista', href: `/lists/${payload.listSlug}/records` }],
                    warnings,
                };
            }
            case 'update_field': {
                const field = await this.fields.update(ctx.tenantId, String(payload.listId), String(payload.fieldId), payload.patch);
                return {
                    message: `Campo «${field.label}» actualizado.`,
                    links: [{ label: 'Ver la lista', href: `/lists/${payload.listSlug}/records` }],
                    warnings: [],
                };
            }
            case 'delete_field': {
                await this.fields.remove(ctx.tenantId, String(payload.listId), String(payload.fieldId));
                return { message: 'Campo eliminado.', links: [{ label: 'Ver la lista', href: `/lists/${payload.listSlug}/records` }], warnings: [] };
            }
            case 'create_view': {
                const view = await this.views.create(ctx.tenantId, String(payload.listId), payload.input);
                return {
                    message: `Vista «${view.name}» creada.`,
                    links: [{ label: `Abrir la vista`, href: `/lists/${payload.listSlug}/records` }],
                    warnings: [],
                };
            }
            case 'create_dashboard': {
                const dash = await this.dashboards.create(ctx.tenantId, ctx.userId, payload.input);
                return {
                    message: `Tablero «${dash.name}» creado.`,
                    links: [{ label: 'Abrir el tablero', href: `/dashboards/${dash.id}` }],
                    warnings: [],
                };
            }
            case 'create_automation': {
                const auto = await this.automations.create(ctx.tenantId, String(payload.listId), payload.input);
                return {
                    message: `Automatización «${auto.name}» creada${auto.is_active ? ' y activa' : ' (pausada)'}.`,
                    links: [{ label: 'Abrir la automatización', href: `/lists/${payload.listSlug}/automations/${auto.id}` }],
                    warnings: [],
                };
            }
            case 'update_list': {
                const list = await this.lists.update(ctx.tenantId, String(payload.listId), payload.patch);
                return { message: `Lista «${list.name}» actualizada.`, links: [{ label: 'Ver la lista', href: `/lists/${list.slug}/records` }], warnings: [] };
            }
            default:
                throw new Error(`Tipo de propuesta desconocido: ${(payload as { kind: string }).kind}`);
        }
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private async saveProposal(
        ctx: AiToolContext,
        p: {
            kind: AiProposalKind;
            title: string;
            summary: string;
            destructive: boolean;
            listSlug: string | null;
            preview: AiProposalPreview;
            payload: Payload;
        },
    ): Promise<AiToolResult> {
        const proposal: AiProposal = {
            id: randomBytes(9).toString('base64url'),
            kind: p.kind,
            title: p.title,
            summary: p.summary,
            destructive: p.destructive,
            list_slug: p.listSlug,
            preview: p.preview,
            applied: false,
            result: null,
            created_at: new Date().toISOString(),
        };
        await this.store.save({
            proposal,
            kind: p.kind,
            payload: p.payload,
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            capability: CAPABILITY_BY_KIND[p.kind],
            conversationId: ctx.conversationId ?? null,
        });
        return {
            content: {
                ok: true,
                proposal_id: proposal.id,
                title: proposal.title,
                note: 'La propuesta quedó lista como TARJETA para la persona. No la apliques vos ni digas que ya está hecho: contale brevemente qué contiene y que puede aplicarla con el botón.',
            },
            proposal,
        };
    }

    private async resolveList(ctx: AiToolContext, slugOrKey: string): Promise<List> {
        const lists = await this.lists.list(ctx.tenantId);
        const hit = lists.find((l) => l.slug === slugOrKey) ?? lists.find((l) => l.name.trim().toLowerCase() === slugOrKey.trim().toLowerCase());
        if (!hit) throw new AiToolError(`La lista «${slugOrKey}» no existe. Listas disponibles: ${lists.map((l) => `${l.slug} (${l.name})`).join(', ')}.`);
        return hit;
    }

    private async resolveField(ctx: AiToolContext, list: List, slug: string): Promise<Field> {
        const fields = await this.fields.listByListId(ctx.tenantId, list.id);
        const f = fields.find((x) => x.slug === slug) ?? fields.find((x) => x.label.trim().toLowerCase() === slug.trim().toLowerCase());
        if (!f) throw new AiToolError(`El campo «${slug}» no existe en «${list.name}». Campos: ${fields.map((x) => `${x.slug} (${x.label}, ${x.type})`).join(', ')}.`);
        return f;
    }

    private async countRecords(tenantId: number, listId: number): Promise<number> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ n: sql<number>`count(*)::int` })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt))),
        );
        return row?.n ?? 0;
    }

    /**
     * Config del campo a partir del vocabulario del modelo, validada con el
     * schema compartido del tipo. `relation_to` se resuelve a una lista
     * existente (id) o a una key del pack (`{$list}`); `computed.inputs`
     * a ids (lista existente) o a `{$field}` (blueprint).
     */
    private buildFieldConfig(
        f: FieldSpec,
        slug: string,
        opts: {
            packKeys: Set<string>;
            existingBySlug: Map<string, List>;
            localSlugs: () => Set<string>;
            forBlueprint: boolean;
            resolveInput?: (slug: string) => number | undefined;
        },
    ): { config: Record<string, unknown> } {
        const config: Record<string, unknown> = {};
        switch (f.type) {
            case 'select':
            case 'multi_select':
                if (!f.options?.length) throw new AiToolError(`El campo «${slug}» (${f.type}) necesita options.`);
                config.options = normalizeOptions(f.options);
                break;
            case 'currency':
                config.currency = (f.currency ?? 'USD').toUpperCase();
                if (f.precision !== undefined) config.precision = f.precision;
                if (f.min !== undefined) config.min = f.min;
                if (f.max !== undefined) config.max = f.max;
                break;
            case 'number':
                if (f.precision !== undefined) config.precision = f.precision;
                if (f.min !== undefined) config.min = f.min;
                if (f.max !== undefined) config.max = f.max;
                break;
            case 'percent':
                if (f.precision !== undefined) config.precision = Math.min(f.precision, 2);
                break;
            case 'rating':
                if (f.max !== undefined) config.max = Math.max(1, Math.min(10, Math.round(f.max)));
                break;
            case 'date':
            case 'datetime':
                if (f.highlight_overdue) config.highlight_overdue = true;
                break;
            case 'phone':
                if (f.default_country) config.default_country = f.default_country.toUpperCase();
                break;
            case 'relation': {
                if (!f.relation_to) throw new AiToolError(`El campo «${slug}» (relation) necesita relation_to (slug de la lista destino).`);
                if (opts.packKeys.has(f.relation_to)) {
                    config.target_list_id = { $list: f.relation_to };
                } else {
                    const target = opts.existingBySlug.get(f.relation_to);
                    if (!target) {
                        throw new AiToolError(
                            `relation_to «${f.relation_to}» no es una lista existente ni una key del pedido. Listas: ${[...opts.existingBySlug.keys()].join(', ')}.`,
                        );
                    }
                    config.target_list_id = target.id;
                }
                break;
            }
            case 'computed': {
                if (!f.computed) throw new AiToolError(`El campo «${slug}» (computed) necesita computed {operation, inputs}.`);
                const local = opts.localSlugs();
                const inputs = f.computed.inputs.map((s) => {
                    if (!local.has(s)) throw new AiToolError(`computed «${slug}»: el campo de entrada «${s}» no existe (definilo antes en la misma lista).`);
                    if (opts.forBlueprint) return { $field: s };
                    const id = opts.resolveInput?.(s);
                    if (id === undefined) throw new AiToolError(`computed «${slug}»: «${s}» tiene que ser un campo YA existente de la lista (no uno del mismo pedido).`);
                    return id;
                });
                config.operation = f.computed.operation;
                config.inputs = inputs;
                if (f.computed.separator !== undefined) config.separator = f.computed.separator;
                break;
            }
            default:
                break;
        }
        // Validación con el schema compartido, salvo lo que lleva tokens del
        // blueprint (se valida al materializar).
        const hasTokens = JSON.stringify(config).includes('"$');
        if (!hasTokens) {
            try {
                return { config: parseFieldConfig(f.type, config) };
            } catch (err) {
                throw new AiToolError(`Config del campo «${slug}» inválida: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return { config };
    }

    /** Config de vista con ids (o tokens `{$field}` en el blueprint). */
    private buildViewConfig(
        v: ViewSpec,
        resolve: (slug: string) => { id: unknown; type: FieldType },
    ): Record<string, unknown> {
        const config: Record<string, unknown> = {};
        if (v.type === 'kanban') {
            if (!v.group_by) throw new AiToolError(`La vista kanban «${v.name}» necesita group_by.`);
            const g = resolve(v.group_by);
            if (g.type !== 'select' && g.type !== 'user' && g.type !== 'checkbox' && g.type !== 'text') {
                throw new AiToolError(`Vista «${v.name}»: kanban se agrupa por un select (o user/checkbox); «${v.group_by}» es ${g.type}.`);
            }
            config.group_by_field_id = g.id;
        } else if (v.type === 'table' && v.group_by) {
            config.group_by_field_id = resolve(v.group_by).id;
        }
        if (v.type === 'calendar') {
            if (!v.date_field) throw new AiToolError(`La vista calendario «${v.name}» necesita date_field.`);
            const d = resolve(v.date_field);
            if (!DATE_TYPES.includes(d.type)) throw new AiToolError(`Vista «${v.name}»: date_field «${v.date_field}» es ${d.type}, se esperaba date/datetime.`);
            config.date_field_id = d.id;
        }
        if (v.type === 'cards' && v.card_fields) config.card_field_ids = v.card_fields.map((s) => resolve(s).id);
        if (v.filters?.length) config.filter_tree = this.buildFilterTree(v.filters, (slug) => resolve(slug).id);
        if (v.sort?.length) config.sort = v.sort.map((s) => ({ field_id: resolve(s.field).id, dir: s.dir }));
        // Los ids de columna de la tabla son los SLUGS (TanStack), no field_ids:
        // se valida que existan y se guardan tal cual.
        if (v.hidden_columns?.length) {
            config.hidden_columns = v.hidden_columns.map((s) => {
                resolve(s);
                return s;
            });
        }
        return config;
    }

    private buildFilterTree(rules: FilterRuleSpec[], resolveId: (slug: string) => unknown): FilterNode {
        return {
            type: 'group',
            logic: 'and',
            children: rules.map((r) => ({
                type: 'condition' as const,
                field_id: resolveId(r.field) as number,
                op: r.op,
                ...(r.value !== undefined ? { value: r.value } : {}),
            })),
        };
    }

    /**
     * Comprueba que los slugs que la automatización referencia existan en
     * la lista (trigger, condiciones, update_field, merge tags) y resuelve
     * las listas destino de `create_record` (slug → id) IN PLACE.
     */
    private validateAutomationSlugs(
        auto: CreateAutomationInput,
        slugs: Set<string>,
        resolveTargetList: (slug: string) => number,
    ): void {
        const bad = new Set<string>();
        const check = (s: unknown): void => {
            if (typeof s === 'string' && s && !slugs.has(s) && !/^f\d+$/.test(s)) bad.add(s);
        };
        const checkCondition = (c: unknown): void => {
            if (Array.isArray(c)) for (const r of c) check((r as { field?: string; slug?: string }).field ?? (r as { slug?: string }).slug);
            else if (c && typeof c === 'object') for (const k of Object.keys(c)) check(k);
        };
        const checkTags = (v: unknown): void => {
            if (typeof v !== 'string') return;
            for (const m of v.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)) {
                const tag = m[1]!.trim();
                if (tag.includes('.')) continue; // before.x / record.id / date.today / payload.x
                check(tag);
            }
        };
        const tc = auto.trigger_config ?? {};
        for (const s of (tc.changed_fields as string[] | undefined) ?? []) check(s);
        check(tc.due_field);
        checkCondition(tc.field_filters);
        const walk = (actions: unknown[]): void => {
            for (const a of actions) {
                const act = a as { type: string; config: Record<string, unknown>; condition?: unknown };
                if (!act || typeof act !== 'object') continue;
                checkCondition(act.condition);
                const cfg = act.config ?? {};
                switch (act.type) {
                    case 'update_field':
                        for (const [k, v] of Object.entries((cfg.values as Record<string, unknown>) ?? {})) {
                            check(k);
                            checkTags(v);
                        }
                        break;
                    case 'create_record': {
                        const target = cfg.target_list ?? cfg.list_id;
                        if (typeof target === 'string' && !/^\d+$/.test(target)) cfg.target_list = resolveTargetList(target);
                        for (const v of Object.values((cfg.values as Record<string, unknown>) ?? {})) checkTags(v);
                        break;
                    }
                    case 'if_else':
                        checkCondition(cfg.condition);
                        walk((cfg.then_actions as unknown[]) ?? []);
                        walk((cfg.else_actions as unknown[]) ?? []);
                        break;
                    default:
                        for (const v of Object.values(cfg)) checkTags(v);
                }
            }
        };
        walk(auto.actions as unknown[]);
        if (bad.size > 0) {
            throw new AiToolError(`La automatización referencia campos que no existen en la lista: ${[...bad].join(', ')}. Campos válidos: ${[...slugs].join(', ')}.`);
        }
    }
}

// ── Tipos auxiliares de input ───────────────────────────────────────────

interface UpdateFieldSpec {
    list: string;
    field: string;
    label?: string;
    description?: string | null;
    is_required?: boolean;
    is_unique?: boolean;
    add_options?: z.infer<typeof optionSpec>[];
    replace_options?: z.infer<typeof optionSpec>[];
    config?: Record<string, unknown>;
}

interface UpdateListSpec {
    list: string;
    name?: string;
    icon?: string | null;
    color?: string | null;
    title_field?: string;
}

// ── Helpers puros ───────────────────────────────────────────────────────

const NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency', 'rating', 'percent', 'duration', 'rollup', 'computed'];
const DATE_TYPES: readonly FieldType[] = ['date', 'datetime'];

const DEFAULT_SIZE: Partial<Record<string, { w: number; h: number }>> = {
    kpi: { w: 3, h: 2 },
    gauge: { w: 3, h: 3 },
    stat_delta: { w: 3, h: 2 },
    chart_bar: { w: 6, h: 4 },
    chart_pie: { w: 6, h: 4 },
    chart_line: { w: 6, h: 4 },
    chart_area: { w: 6, h: 4 },
    funnel: { w: 6, h: 4 },
    table: { w: 12, h: 4 },
};

/** Slug snake_case desde un texto humano (sin acentos, arranca con letra). */
export function toSlug(label: string): string {
    let s = label
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 63)
        .replace(/_+$/g, '');
    if (!s) s = 'campo';
    if (!/^[a-z]/.test(s)) s = `f_${s}`.slice(0, 63);
    return s;
}

function normalizeOptions(opts: Array<{ label: string; value?: string; color?: string }>): Array<{ value: string; label: string; color?: string }> {
    const seen = new Set<string>();
    return opts.map((o) => {
        let value = o.value ?? toSlug(o.label);
        let i = 2;
        while (seen.has(value)) value = `${o.value ?? toSlug(o.label)}_${i++}`;
        seen.add(value);
        return { value, label: o.label, ...(o.color ? { color: o.color } : {}) };
    });
}

function newWidgetId(): string {
    return `w-${Math.random().toString(36).slice(2, 10)}`;
}

function zodIssues(err: z.ZodError): string {
    return err.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; ');
}

function errMessage(err: unknown): string {
    const resp = (err as { getResponse?: () => unknown }).getResponse?.();
    if (resp && typeof resp === 'object' && typeof (resp as { message?: unknown }).message === 'string') {
        return (resp as { message: string }).message;
    }
    return err instanceof Error ? err.message : String(err);
}

function yesNo(v: boolean): string {
    return v ? 'sí' : 'no';
}

function describeFieldForModel(
    f: Field,
    listById: Map<number, List>,
    fieldById: Map<number, Field>,
): Record<string, unknown> {
    const out: Record<string, unknown> = { slug: f.slug, label: f.label, type: f.type };
    if (f.is_required) out.required = true;
    if (f.is_unique) out.unique = true;
    if (f.is_primary) out.is_title = true;
    if (f.description) out.description = f.description;
    const cfg = f.config as Record<string, unknown>;
    if (f.type === 'select' || f.type === 'multi_select') {
        out.options = ((cfg.options as Array<{ value: string; label: string }>) ?? []).map((o) => ({ value: o.value, label: o.label }));
    }
    if (f.type === 'currency') out.currency = cfg.currency;
    if (f.type === 'relation') {
        const t = listById.get(Number(cfg.target_list_id));
        out.relation_to = t ? t.slug : null;
    }
    if (f.type === 'computed') {
        out.operation = cfg.operation;
        out.inputs = ((cfg.inputs as number[]) ?? []).map((id) => fieldById.get(id)?.slug ?? `f${id}`);
    }
    if (f.type === 'lookup' || f.type === 'rollup') {
        out.through = f.through ? `${f.through.relation_label} → ${f.through.other_list_name}${f.through.target_field ? '.' + f.through.target_field.label : ''}` : null;
        if (f.type === 'rollup') out.operation = cfg.operation;
    }
    return out;
}

function describeConfig(type: FieldType, config: Record<string, unknown>, lists: List[]): string | null {
    switch (type) {
        case 'select':
        case 'multi_select':
            return ((config.options as Array<{ label: string }>) ?? []).map((o) => o.label).join(', ') || null;
        case 'currency':
            return String(config.currency ?? 'USD');
        case 'relation': {
            const t = lists.find((l) => l.id === Number(config.target_list_id));
            return t ? `→ ${t.name}` : null;
        }
        case 'computed':
            return String(config.operation ?? '');
        default:
            return null;
    }
}

function viewTypeLabel(type: string): string {
    return { table: 'de tabla', kanban: 'kanban', calendar: 'de calendario', cards: 'de tarjetas' }[type] ?? type;
}

function timeBucketLabel(b: string): string {
    return { day: 'día', week: 'semana', month: 'mes', quarter: 'trimestre', year: 'año' }[b] ?? b;
}

function metricLabel(metric: string, field?: string): string {
    const m: Record<string, string> = {
        count: 'cantidad',
        count_unique: 'valores distintos',
        count_empty: 'vacíos',
        sum: 'suma',
        avg: 'promedio',
        min: 'mínimo',
        max: 'máximo',
        count_true: 'marcados',
        count_false: 'sin marcar',
    };
    return field ? `${m[metric] ?? metric} de ${field}` : m[metric] ?? metric;
}

function triggerLabel(type: string, cfg: Record<string, unknown>, fields: Field[]): string {
    const label = (slug: unknown): string => fields.find((f) => f.slug === slug)?.label ?? String(slug ?? '');
    switch (type) {
        case 'record_created':
            return 'Cuando se crea un registro';
        case 'record_updated': {
            const changed = (cfg.changed_fields as string[] | undefined) ?? [];
            return changed.length ? `Cuando cambia ${changed.map((s) => `«${label(s)}»`).join(', ')}` : 'Cuando se actualiza un registro';
        }
        case 'due_date_reached': {
            const mins = Number(cfg.offset_minutes ?? 0);
            const days = Math.round(Math.abs(mins) / 1440);
            const when = mins === 0 ? 'al llegar' : `${days} día${days === 1 ? '' : 's'} ${mins < 0 ? 'antes' : 'después'} de`;
            return `${when.charAt(0).toUpperCase() + when.slice(1)} «${label(cfg.due_field)}»`;
        }
        case 'scheduled':
            return `Programada (${String(cfg.cron ?? '')})`;
        case 'incoming_webhook':
            return 'Al recibir un webhook';
        default:
            return type;
    }
}

function describeActions(actions: Array<{ type: string; config: Record<string, unknown> }>, lists: Map<string, List>): string[] {
    return actions.map((a) => {
        const cfg = a.config ?? {};
        switch (a.type) {
            case 'send_email':
                return `Enviar correo a ${String(cfg.to ?? '')}`;
            case 'update_field':
                return `Actualizar ${Object.keys((cfg.values as Record<string, unknown>) ?? {}).join(', ')}`;
            case 'create_record': {
                const id = Number(cfg.target_list);
                const target = [...lists.values()].find((l) => l.id === id);
                return `Crear registro en «${target?.name ?? String(cfg.target_list ?? '')}»`;
            }
            case 'call_webhook':
                return `Llamar webhook ${String(cfg.url ?? '')}`;
            case 'if_else':
                return 'Condicional sí / no';
            default:
                return a.type;
        }
    });
}
