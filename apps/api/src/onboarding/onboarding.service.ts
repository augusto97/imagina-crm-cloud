import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    BULK_REVERT_CHUNK,
    BULK_STRUCTURE_CHUNK,
    ONBOARDING_ADMIN_STEPS,
    ONBOARDING_TEAM_STEPS,
    brandingSchema,
    combineBlueprints,
    favoritesSchema,
    onboardingPrefsSchema,
    pruneBlueprint,
    type ListBlueprint,
    type OnboardingApplyInput,
    type OnboardingApplyResult,
    type OnboardingPrefs,
    type OnboardingPrefsPatch,
    type OnboardingSampleEdit,
    type OnboardingSamplesDeleteResult,
    type OnboardingStatus,
    type OnboardingStepId,
} from '@imagina-base/shared';
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AiSettingsService } from '../ai/ai-settings.service';
import { ConversationsStore } from '../ai/conversations.store';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { DRIZZLE, type Db } from '../db/client';
import { automations, comments, lists, memberships, pushSubscriptions, records, savedViews, tenants, users } from '../db/schema';
import { ListGroupsService } from '../lists/list-groups.service';
import { TenantSmtpService } from '../mail/tenant-smtp.service';
import { BulkHistoryService } from '../records/bulk-history.service';
import { BulkStructureService } from '../records/bulk-structure.service';
import type { Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BlueprintService } from '../templates/blueprint.service';
import { systemTemplate } from '../templates/system-catalog';
import { OnboardingAiService } from './onboarding-ai.service';

/** Lo que la bienvenida deja en `tenants.settings.onboarding` (tolerante: un valor raro no rompe nada). */
const registrySchema = z.object({
    /** id de lista → ids de los registros de ejemplo que creó la bienvenida. */
    sample: z.record(z.array(z.number().int().positive())).catch({}).default({}),
    /** Automatizaciones que creó la bienvenida: no cuentan como «tu» automatización. */
    seeded_automations: z.array(z.number().int().positive()).catch([]).default([]),
});
type Registry = z.infer<typeof registrySchema>;

/** Más listas que esto no entran en un blueprint (`listBlueprintSchema`). */
const MAX_PACK_LISTS = 10;

/**
 * F7 (ADR-S72) — «Empezar fácil»: la bienvenida de una empresa nueva, sus
 * datos de ejemplo y «Primeros pasos».
 *
 * Crear se hace con el MISMO motor de las plantillas
 * (`BlueprintService.materialize`): la bienvenida no inventa otro camino para
 * listas, campos, vistas, tableros ni automatizaciones.
 */
@Injectable()
export class OnboardingService {
    private readonly logger = new Logger(OnboardingService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly groups: ListGroupsService,
        private readonly blueprints: BlueprintService,
        private readonly bulkStructure: BulkStructureService,
        private readonly bulkHistory: BulkHistoryService,
        private readonly audit: AuditService,
        private readonly aiSettings: AiSettingsService,
        private readonly conversations: ConversationsStore,
        private readonly smtp: TenantSmtpService,
        private readonly ai: OnboardingAiService,
    ) {}

    // ── «Primeros pasos» ────────────────────────────────────────────────────

    async status(tenantId: number, actor: Actor): Promise<OnboardingStatus> {
        const audience: OnboardingStatus['audience'] =
            actor.role === 'admin' ? 'admin' : actor.role === 'guest' || actor.role === 'client' ? 'none' : 'team';
        const [registry, tenantSettings] = await this.readTenant(tenantId);
        const sampleIds = Object.values(registry.sample).flat();

        const facts = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // La papelera no cuenta: la RLS oculta lo borrado de listas, vistas
            // y automatizaciones (ADR-S52); los registros, a mano (`deleted_at`).
            const listRows = await tx
                .select({ id: lists.id, slug: lists.slug, name: lists.name })
                .from(lists)
                .where(eq(lists.tenantId, tenantId))
                .orderBy(desc(lists.updatedAt), desc(lists.id))
                .limit(1);
            const [listCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(lists).where(eq(lists.tenantId, tenantId));
            const [realRecord] = await tx
                .select({ id: records.id })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), isNull(records.deletedAt), sampleIds.length > 0 ? notInArray(records.id, sampleIds) : undefined))
                .limit(1);
            const [ownView] = await tx
                .select({ id: savedViews.id })
                .from(savedViews)
                .where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.createdBy, actor.userId)))
                .limit(1);
            const [team] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), notInArray(memberships.role, ['client', 'guest'])));
            const [ownAutomation] = await tx
                .select({ id: automations.id })
                .from(automations)
                .where(
                    and(
                        eq(automations.tenantId, tenantId),
                        registry.seeded_automations.length > 0 ? notInArray(automations.id, registry.seeded_automations) : undefined,
                    ),
                )
                .limit(1);
            const [ownComment] = await tx
                .select({ id: comments.id })
                .from(comments)
                .where(and(eq(comments.tenantId, tenantId), eq(comments.userId, actor.userId), isNull(comments.deletedAt)))
                .limit(1);
            const [push] = await tx
                .select({ id: pushSubscriptions.id })
                .from(pushSubscriptions)
                .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, actor.userId)))
                .limit(1);
            const [me] = await tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, actor.userId)))
                .limit(1);
            const [admin] = await tx
                .select({ name: users.name, email: users.email })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin'), isNull(users.disabledAt), ne(memberships.userId, actor.userId)))
                .orderBy(asc(memberships.createdAt))
                .limit(1);
            return {
                firstList: listRows[0] ?? null,
                listCount: listCount?.n ?? 0,
                realRecord: realRecord !== undefined,
                ownView: ownView !== undefined,
                teamSize: team?.n ?? 0,
                ownAutomation: ownAutomation !== undefined,
                ownComment: ownComment !== undefined,
                push: push !== undefined,
                settings: (me?.settings ?? {}) as Record<string, unknown>,
                adminName: admin ? admin.name.trim() || admin.email : null,
            };
        });

        const prefs = parsePrefs(facts.settings);
        const favorites = favoritesSchema.safeParse(facts.settings.favorites ?? {});
        const hasFavorite = favorites.success && (favorites.data.lists.length + favorites.data.dashboards.length + favorites.data.views.length > 0);
        const branding = brandingSchema.safeParse(tenantSettings.branding ?? {});
        const hasBranding = branding.success && (branding.data.logo_file_id !== null || branding.data.primary_color !== null || branding.data.app_name !== null);

        const platform = audience === 'admin' ? (await this.aiSettings.getTenant(tenantId)).platform : null;
        const assistantPossible =
            can(actor, 'use_ai_assistant') && platform !== null && platform.enabled && (platform.share_platform_key || platform.allow_tenant_keys);

        const done: Record<OnboardingStepId, boolean> = {
            create_list: facts.listCount > 0,
            add_records: facts.realRecord,
            create_view: facts.ownView,
            invite_team: facts.teamSize > 1,
            automation: facts.ownAutomation,
            branding: hasBranding,
            company_mail: audience === 'admin' ? await this.smtp.ownMail(tenantId) : false,
            install_app: facts.push || prefs.marks.includes('install_app'),
            assistant: assistantPossible ? await this.conversations.hasUsed(tenantId, actor.userId) : false,
            comment_record: facts.ownComment,
            my_work: prefs.marks.includes('my_work'),
            save_view: facts.ownView || hasFavorite,
        };

        const ids =
            audience === 'admin'
                ? ONBOARDING_ADMIN_STEPS.filter((s) => s !== 'assistant' || assistantPossible)
                : audience === 'team'
                  ? ONBOARDING_TEAM_STEPS
                  : [];
        const steps = ids.map((id) => ({ id, done: done[id], skipped: !done[id] && prefs.skipped.includes(id) }));
        const samples = await this.samplesLeft(tenantId, registry);

        return {
            audience,
            steps,
            prefs,
            complete: steps.length > 0 && steps.every((s) => s.done || s.skipped),
            has_lists: facts.listCount > 0,
            first_list: facts.firstList,
            welcome: facts.listCount === 0 && can(actor, 'manage_lists') && !prefs.welcome_dismissed,
            samples,
            seeded_automations: registry.seeded_automations.length,
            assistant_possible: assistantPossible,
            admin_name: facts.adminName,
        };
    }

    /** Mezcla los cambios con lo guardado (nunca reemplaza el objeto entero). */
    async updatePrefs(tenantId: number, userId: number, patch: OnboardingPrefsPatch): Promise<OnboardingPrefs> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .for('update')
                .limit(1);
            if (!row) throw new NotFoundException({ code: 'membership_not_found', message: 'No perteneces a esta empresa.', data: { status: 404 } });
            const next = applyPrefsPatch(parsePrefs((row.settings ?? {}) as Record<string, unknown>), patch);
            await tx
                .update(memberships)
                .set({
                    settings: sql`jsonb_set(coalesce(${memberships.settings}, '{}'::jsonb), '{onboarding}', ${JSON.stringify(next)}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
            return next;
        });
    }

    // ── Crear el espacio ────────────────────────────────────────────────────

    async apply(tenantId: number, actor: Actor, input: OnboardingApplyInput): Promise<OnboardingApplyResult> {
        if (input.source === 'ai') {
            const proposal = await this.ai.claim(tenantId, actor.userId, input.proposal_id);
            try {
                const { blueprint } = pruneBlueprint(proposal.blueprint, input.edits);
                if (blueprint.lists.length === 0) {
                    throw new BadRequestException({ code: 'onboarding_empty', message: 'Deja al menos una lista para crear tu espacio.', data: { status: 400 } });
                }
                const result = await this.create(tenantId, actor, blueprint, {
                    folderName: input.folder_name ?? proposal.business_name,
                    includeSamples: input.include_samples,
                    audit: { source: 'ai' },
                });
                await this.ai.markApplied(tenantId, actor.userId, input.proposal_id);
                return result;
            } catch (err) {
                await this.ai.release(tenantId, actor.userId, input.proposal_id);
                throw err;
            }
        }

        const ids = [...new Set(input.template_ids)];
        const parts = ids.map((id) => {
            const t = systemTemplate(id.slice('sys:'.length));
            if (!t) throw new NotFoundException({ code: 'template_not_found', message: `Plantilla "${id}" no encontrada`, data: { status: 404 } });
            return { name: t.name, blueprint: t.blueprint };
        });
        const blueprint = combineBlueprints(parts);
        if (blueprint.lists.length > MAX_PACK_LISTS) {
            throw new BadRequestException({
                code: 'onboarding_too_many_lists',
                message: `Lo que elegiste suma ${blueprint.lists.length} listas: elige menos plantillas (hasta ${MAX_PACK_LISTS} listas a la vez).`,
                data: { status: 400 },
            });
        }
        const [tenant] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return this.create(tenantId, actor, blueprint, {
            folderName: input.folder_name ?? tenant?.name ?? 'Mi espacio',
            includeSamples: input.include_samples,
            audit: { source: 'templates', templates: ids },
        });
    }

    private async create(
        tenantId: number,
        actor: Actor,
        source: ListBlueprint,
        opts: { folderName: string; includeSamples: boolean; audit: Record<string, unknown> },
    ): Promise<OnboardingApplyResult> {
        // Lo que el rol no puede crear a mano tampoco lo crea la bienvenida.
        const blueprint: ListBlueprint = {
            ...source,
            lists: source.lists.map((l) => (can(actor, 'manage_automations') ? l : { ...l, automations: [] })),
            dashboards: can(actor, 'manage_dashboards') ? source.dashboards : [],
        };
        const folder =
            blueprint.lists.length > 1
                ? await this.groups.create(tenantId, { name: opts.folderName.slice(0, 190), color: blueprint.lists[0]?.color ?? null })
                : null;
        let result: Awaited<ReturnType<BlueprintService['materialize']>>;
        try {
            result = await this.blueprints.materialize(tenantId, actor.userId, blueprint, {
                groupId: folder?.id ?? null,
                includeRecords: opts.includeSamples,
            });
        } catch (err) {
            // Si no llegó a crearse ninguna lista, la carpeta no queda vacía en el menú.
            if (folder) await this.dropEmptyFolder(tenantId, folder.id).catch(() => undefined);
            throw err;
        }
        const listIds = result.lists.map((l) => l.id);

        // Las listas son NUEVAS: todo registro que tengan ahora es de ejemplo.
        const { sampleRows, autoRows } = await this.tenantDb.withTenant(tenantId, async (tx) => ({
            sampleRows:
                opts.includeSamples && listIds.length > 0
                    ? await tx.select({ id: records.id, listId: records.listId }).from(records).where(and(eq(records.tenantId, tenantId), inArray(records.listId, listIds)))
                    : [],
            autoRows:
                listIds.length > 0
                    ? await tx.select({ id: automations.id }).from(automations).where(and(eq(automations.tenantId, tenantId), inArray(automations.listId, listIds)))
                    : [],
        }));
        await this.updateRegistry(tenantId, (reg) => {
            const sample = { ...reg.sample };
            for (const r of sampleRows) sample[String(r.listId)] = [...(sample[String(r.listId)] ?? []), r.id];
            return { sample, seeded_automations: [...new Set([...reg.seeded_automations, ...autoRows.map((a) => a.id)])] };
        });

        void this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'onboarding.apply',
            targetType: 'workspace',
            targetId: tenantId,
            targetLabel: result.lists.map((l) => l.name).join(', '),
            meta: { ...opts.audit, lists: listIds, dashboards: result.dashboardIds, samples: sampleRows.length, folder: folder?.id ?? null },
        });
        if (result.warnings.length > 0) this.logger.warn(`Bienvenida con avisos (empresa ${tenantId}): ${result.warnings.join(' | ').slice(0, 500)}`);

        return {
            lists: result.lists.map((l) => ({ id: l.id, slug: l.slug, name: l.name })),
            dashboard_ids: result.dashboardIds,
            group_id: folder?.id ?? null,
            samples: sampleRows.length,
            warnings: result.warnings,
        };
    }

    // ── Datos de ejemplo ────────────────────────────────────────────────────

    /**
     * Manda a la papelera los datos de ejemplo que quedan (de una lista o de
     * todas) con el MISMO borrado en lote de la app: queda en el historial de
     * cada lista y se deshace igual.
     */
    async deleteSamples(tenantId: number, actor: Actor, listId?: number): Promise<OnboardingSamplesDeleteResult> {
        const [registry] = await this.readTenant(tenantId);
        const out: OnboardingSamplesDeleteResult = { deleted: 0, edits: [] };
        const names: string[] = [];
        for (const [lid, ids] of Object.entries(registry.sample)) {
            const id = Number(lid);
            if (listId !== undefined && id !== listId) continue;
            const alive = await this.aliveSamples(tenantId, id, ids);
            if (alive.length === 0) continue;
            let editId: number | undefined;
            for (let i = 0; i < alive.length; i += BULK_STRUCTURE_CHUNK) {
                const res = await this.bulkStructure.apply(tenantId, actor, String(id), 'delete', alive.slice(i, i + BULK_STRUCTURE_CHUNK), undefined, false, editId);
                editId = res.edit_id ?? editId;
                out.deleted += res.succeeded.length;
            }
            if (editId !== undefined) out.edits.push({ list_id: id, edit_id: editId });
            const [l] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ name: lists.name }).from(lists).where(eq(lists.id, id)).limit(1));
            if (l) names.push(l.name);
        }
        if (out.deleted > 0) {
            void this.audit.log({
                tenantId,
                userId: actor.userId,
                action: 'onboarding.samples_delete',
                targetType: 'workspace',
                targetId: tenantId,
                targetLabel: names.join(', '),
                meta: { deleted: out.deleted, edits: out.edits },
            });
        }
        return out;
    }

    /** «Deshacer»: revierte los borrados en lote que devolvió `deleteSamples`. */
    async restoreSamples(tenantId: number, actor: Actor, edits: OnboardingSampleEdit[]): Promise<{ restored: number }> {
        let restored = 0;
        for (const e of edits) {
            const preview = await this.bulkHistory.revertPreview(tenantId, actor, String(e.list_id), e.edit_id);
            for (let i = 0; i < preview.item_ids.length; i += BULK_REVERT_CHUNK) {
                const res = await this.bulkHistory.revertApply(tenantId, actor, String(e.list_id), e.edit_id, preview.item_ids.slice(i, i + BULK_REVERT_CHUNK), false);
                restored += res.reverted;
            }
        }
        return { restored };
    }

    // ── Internos ────────────────────────────────────────────────────────────

    private async dropEmptyFolder(tenantId: number, groupId: number): Promise<void> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ n: sql<number>`count(*)::int` }).from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.groupId, groupId))),
        );
        if ((row?.n ?? 0) === 0) await this.groups.remove(tenantId, groupId);
    }

    private async samplesLeft(tenantId: number, registry: Registry): Promise<OnboardingStatus['samples']> {
        const entries = Object.entries(registry.sample).filter(([, ids]) => ids.length > 0);
        if (entries.length === 0) return [];
        const listIds = entries.map(([id]) => Number(id));
        const allIds = entries.flatMap(([, ids]) => ids);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({ listId: records.listId, n: sql<number>`count(*)::int` })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), inArray(records.listId, listIds), inArray(records.id, allIds), isNull(records.deletedAt)))
                .groupBy(records.listId);
            if (rows.length === 0) return [];
            const listRows = await tx
                .select({ id: lists.id, slug: lists.slug, name: lists.name })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), inArray(lists.id, rows.map((r) => r.listId))));
            const byId = new Map(listRows.map((l) => [l.id, l]));
            return rows.flatMap((r) => {
                const l = byId.get(r.listId);
                return l && r.n > 0 ? [{ list_id: l.id, list_slug: l.slug, list_name: l.name, count: r.n }] : [];
            });
        });
    }

    private async aliveSamples(tenantId: number, listId: number, ids: number[]): Promise<number[]> {
        if (ids.length === 0) return [];
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), inArray(records.id, ids), isNull(records.deletedAt))),
        );
        return rows.map((r) => r.id);
    }

    private async readTenant(tenantId: number): Promise<[Registry, Record<string, unknown>]> {
        const [row] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const settings = (row?.settings ?? {}) as Record<string, unknown>;
        return [registrySchema.parse(settings.onboarding ?? {}), settings];
    }

    /** Escribe SÓLO `settings.onboarding`, con la fila bloqueada (no pisa otras claves). */
    private async updateRegistry(tenantId: number, fn: (reg: Registry) => Registry): Promise<void> {
        await this.db.transaction(async (tx) => {
            const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).for('update').limit(1);
            const next = fn(registrySchema.parse(((row?.settings ?? {}) as Record<string, unknown>).onboarding ?? {}));
            await tx
                .update(tenants)
                .set({ settings: sql`jsonb_set(coalesce(${tenants.settings}, '{}'::jsonb), '{onboarding}', ${JSON.stringify(next)}::jsonb)` })
                .where(eq(tenants.id, tenantId));
        });
    }
}

export function parsePrefs(settings: Record<string, unknown>): OnboardingPrefs {
    const parsed = onboardingPrefsSchema.safeParse(settings.onboarding ?? {});
    return parsed.success ? parsed.data : onboardingPrefsSchema.parse({});
}

/** Puro: aplica un PATCH parcial a las preferencias guardadas. */
export function applyPrefsPatch(prev: OnboardingPrefs, patch: OnboardingPrefsPatch): OnboardingPrefs {
    const next: OnboardingPrefs = { ...prev, skipped: [...prev.skipped], marks: [...prev.marks] };
    if (patch.hidden !== undefined) next.hidden = patch.hidden;
    if (patch.celebrated !== undefined) next.celebrated = patch.celebrated;
    if (patch.welcome_dismissed !== undefined) next.welcome_dismissed = patch.welcome_dismissed;
    if (patch.skip && !next.skipped.includes(patch.skip)) next.skipped.push(patch.skip);
    if (patch.unskip) next.skipped = next.skipped.filter((s) => s !== patch.unskip);
    if (patch.mark && !next.marks.includes(patch.mark)) next.marks.push(patch.mark);
    return next;
}
