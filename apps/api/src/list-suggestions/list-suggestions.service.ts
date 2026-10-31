import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    DEFAULT_LIST_SUGGESTION_MODE,
    FALLBACK_TIME_ZONE,
    LIST_SUGGESTIONS_PURPOSE_BELOW,
    LIST_SUGGESTIONS_REANALYZE_DAYS,
    buildRuleSuggestions,
    listFingerprint,
    listSuggestionKeySchema,
    listSuggestionModeSchema,
    profileListRecords,
    readMirrorListMarker,
    readPortalConfig,
    resolveTitleFieldId,
    zonedToday,
    type ApplyListSuggestionResult,
    type FieldType,
    type ListProfile,
    type ListSuggestion,
    type ListSuggestionCategory,
    type ListSuggestionMode,
    type ListSuggestionsAiState,
    type ListSuggestionsResponse,
    type ListSuggestionsSettings,
    type RuleSuggestion,
    type SuggestFieldInput,
    type UpdateListSuggestionsSettingsInput,
} from '@imagina-base/shared';
import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AiSettingsService, AiUnavailableError } from '../ai/ai-settings.service';
import { ProposalsService } from '../ai/proposals.service';
import { AiToolRegistry, toolAllowed, type AiToolContext } from '../ai/tools/registry';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { DRIZZLE, type Db } from '../db/client';
import { automations, dashboards, fields, forms, lists, memberships, records, savedViews, tenants } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { friendlyAiReason } from '../onboarding/onboarding-ai.service';
import { RecordsService } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { ListSuggestionsStore, type StoredAiJob, type StoredAiResult, type StoredAiSuggestion, type StoredMark } from './list-suggestions.store';

/** Registros de la muestra (los más recientes): acota el costo de abrir el panel en una lista grande. */
export const LIST_SUGGESTIONS_SAMPLE = 2000;
const RUNNING_STALE_MS = 5 * 60 * 1000;

/**
 * v0.1.341 (ADR-S89) — Sugerencias por lista.
 *
 * Quién: sólo admin y gerente (rol base; un rol propio basado en gerente
 * también), y cada sugerencia exige la capacidad de lo que crea (un gerente
 * no ve «convertir el campo»: no administra campos). El perfil se calcula con
 * el ACL de quien mira (alcance de lectura y campos ocultos), así una
 * sugerencia nunca revela algo que esa persona no ve.
 *
 * Costo: las reglas son gratis (una muestra de hasta 2.000 registros, en
 * cache 10 min). La IA corre sólo con el botón; ver ListSuggestionsAiService.
 */
@Injectable()
export class ListSuggestionsService {
    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly records: RecordsService,
        private readonly fieldsService: FieldsService,
        private readonly store: ListSuggestionsStore,
        private readonly settings: AiSettingsService,
        private readonly registry: AiToolRegistry,
        private readonly proposals: ProposalsService,
        private readonly audit: AuditService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ── Quién ───────────────────────────────────────────────────────────

    static allowedRole(ctx: Pick<AiToolContext, 'role'>): boolean {
        return ctx.role === 'admin' || ctx.role === 'manager';
    }

    private assertAllowed(ctx: AiToolContext): void {
        if (!ListSuggestionsService.allowedRole(ctx)) {
            throw new ForbiddenException({ code: 'list_suggestions_forbidden', message: 'Las sugerencias son para administradores y gerentes.', data: { status: 403 } });
        }
    }

    // ── Ajustes ─────────────────────────────────────────────────────────

    async mode(tenantId: number): Promise<ListSuggestionMode> {
        const [row] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const raw = ((row?.settings ?? {}) as Record<string, unknown>).suggestions;
        const parsed = listSuggestionModeSchema.safeParse((raw as { mode?: unknown } | undefined)?.mode);
        return parsed.success ? parsed.data : DEFAULT_LIST_SUGGESTION_MODE;
    }

    async hiddenFor(tenantId: number, userId: number): Promise<boolean> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .limit(1);
            const raw = ((row?.settings ?? {}) as Record<string, unknown>).suggestions;
            return (raw as { hidden?: unknown } | undefined)?.hidden === true;
        });
    }

    async getSettings(ctx: AiToolContext): Promise<ListSuggestionsSettings> {
        const [mode, hidden, platform] = await Promise.all([this.mode(ctx.tenantId), this.hiddenFor(ctx.tenantId, ctx.userId), this.settings.listSuggestAiMonthly()]);
        return { mode, hidden_for_me: hidden, can_configure: ctx.role === 'admin', ai_monthly: (await this.settings.tenantHasOwnKey(ctx.tenantId)) ? null : platform };
    }

    async updateSettings(ctx: AiToolContext, patch: UpdateListSuggestionsSettingsInput): Promise<ListSuggestionsSettings> {
        this.assertAllowed(ctx);
        if (patch.mode !== undefined) {
            if (ctx.role !== 'admin') {
                throw new ForbiddenException({ code: 'list_suggestions_mode_forbidden', message: 'Sólo un administrador elige qué sugerencias ve la empresa.', data: { status: 403 } });
            }
            const mode = patch.mode;
            await this.db.transaction(async (tx) => {
                const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for('update').limit(1);
                const current = (((row?.settings ?? {}) as Record<string, unknown>).suggestions ?? {}) as Record<string, unknown>;
                const next = { ...current, mode };
                await tx
                    .update(tenants)
                    .set({ settings: sql`jsonb_set(coalesce(${tenants.settings}, '{}'::jsonb), '{suggestions}', ${JSON.stringify(next)}::jsonb)` })
                    .where(eq(tenants.id, ctx.tenantId));
            });
            void this.audit.log({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'list_suggestions.mode', targetType: 'workspace', targetId: ctx.tenantId, targetLabel: mode, meta: { mode } });
        }
        if (patch.hidden_for_me !== undefined) {
            const hidden = patch.hidden_for_me;
            await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                await tx
                    .update(memberships)
                    .set({
                        settings: sql`jsonb_set(coalesce(${memberships.settings}, '{}'::jsonb), '{suggestions}', ${JSON.stringify({ hidden })}::jsonb)`,
                        updatedAt: new Date(),
                    })
                    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.userId)));
            });
        }
        return this.getSettings(ctx);
    }

    // ── Perfil ──────────────────────────────────────────────────────────

    /**
     * El perfil de la lista para quien mira: los campos que ve, una muestra de
     * los registros que alcanza (los más recientes) y lo que la lista ya tiene
     * (vistas, automatizaciones, tableros, formularios, vínculos).
     */
    async profile(ctx: AiToolContext, listKey: string, opts: { fresh?: boolean } = {}): Promise<ListProfile> {
        const tz = (this.timeZones ? await this.timeZones.get(ctx.tenantId) : null) ?? FALLBACK_TIME_ZONE;
        return this.records.readScoped(ctx.tenantId, ctx, listKey, async (tx, scope) => {
            const listId = scope.list.id;
            if (!opts.fresh) {
                const cached = await this.store.getProfile(ctx.tenantId, listId, ctx.userId);
                if (cached) return cached;
            }
            const visible = scope.fields.filter((f) => !scope.hiddenIds.has(f.id));
            const base = and(eq(records.tenantId, ctx.tenantId), eq(records.listId, listId), isNull(records.deletedAt), isNull(records.parentId), scope.where({}));
            const [totalRow] = await tx.select({ n: count() }).from(records).where(base);
            const rows = await tx
                .select({ data: records.data, created_at: records.createdAt, updated_at: records.updatedAt })
                .from(records)
                .where(base)
                .orderBy(desc(records.id))
                .limit(LIST_SUGGESTIONS_SAMPLE);

            // Listas del otro lado de las relaciones (en los dos sentidos).
            const relRows = await tx
                .select({ id: fields.id, listId: fields.listId, label: fields.label, config: fields.config })
                .from(fields)
                .where(
                    and(
                        eq(fields.tenantId, ctx.tenantId),
                        isNull(fields.deletedAt),
                        eq(fields.type, 'relation'),
                        or(eq(fields.listId, listId), sql`(${fields.config}->>'target_list_id') = ${String(listId)}`),
                    ),
                );
            const otherIds = new Set<number>();
            for (const r of relRows) {
                const target = Number((r.config as Record<string, unknown>).target_list_id);
                if (r.listId === listId && Number.isInteger(target) && target !== listId) otherIds.add(target);
                if (r.listId !== listId) otherIds.add(r.listId);
            }
            const others = otherIds.size
                ? await tx
                      .select({ id: lists.id, slug: lists.slug, name: lists.name })
                      .from(lists)
                      .where(and(eq(lists.tenantId, ctx.tenantId), inArray(lists.id, [...otherIds]), isNull(lists.deletedAt)))
                : [];
            const otherById = new Map(others.map((l) => [l.id, l]));
            const otherFields = others.length
                ? await tx
                      .select({ listId: fields.listId, slug: fields.slug, label: fields.label, type: fields.type })
                      .from(fields)
                      .where(and(eq(fields.tenantId, ctx.tenantId), inArray(fields.listId, others.map((l) => l.id)), isNull(fields.deletedAt)))
                      .orderBy(fields.position)
                : [];

            const input: SuggestFieldInput[] = visible.map((f) => {
                const config = (f.config ?? {}) as Record<string, unknown>;
                const options = Array.isArray(config.options)
                    ? (config.options as Array<Record<string, unknown>>)
                          .filter((o) => typeof o?.value === 'string')
                          .map((o) => ({ value: String(o.value), label: typeof o.label === 'string' && o.label ? o.label : String(o.value) }))
                    : undefined;
                const target = Number(config.target_list_id);
                const rel = f.type === 'relation' ? otherById.get(target) : undefined;
                return {
                    id: f.id,
                    slug: f.slug,
                    label: f.label,
                    type: f.type as FieldType,
                    required: f.is_required,
                    unique: f.is_unique,
                    ...(options ? { options } : {}),
                    relation: rel ? { slug: rel.slug, name: rel.name } : null,
                    created_at: typeof f.created_at === 'string' ? f.created_at : null,
                };
            });
            const today = zonedToday(tz);
            const prof = profileListRecords(input, rows, { today });

            const viewRows = await tx
                .select({ name: savedViews.name, type: savedViews.type, config: savedViews.config })
                .from(savedViews)
                .where(and(eq(savedViews.tenantId, ctx.tenantId), eq(savedViews.listId, listId), isNull(savedViews.deletedAt)));
            const autoRows = await tx
                .select({ name: automations.name, triggerType: automations.triggerType, actions: automations.actions, isActive: automations.isActive })
                .from(automations)
                .where(and(eq(automations.tenantId, ctx.tenantId), eq(automations.listId, listId), isNull(automations.deletedAt)));
            const dashRows = await tx
                .select({ name: dashboards.name })
                .from(dashboards)
                .where(and(eq(dashboards.tenantId, ctx.tenantId), isNull(dashboards.deletedAt), sql`${dashboards.widgets} @> ${JSON.stringify([{ list_id: listId }])}::jsonb`))
                .limit(20);
            const [formRow] = await tx.select({ n: count() }).from(forms).where(and(eq(forms.tenantId, ctx.tenantId), eq(forms.listId, listId)));

            const profile: ListProfile = {
                list: { id: listId, slug: scope.list.slug, name: scope.list.name, title_field_id: resolveTitleFieldId(visible as never, scope.list.settings) },
                total: Number(totalRow?.n ?? 0),
                sampled: rows.length,
                created_30d: prof.created_30d,
                updated_30d: prof.updated_30d,
                today,
                status: prof.status,
                fields: prof.fields,
                views: viewRows.map((v) => viewSummary(v.name, v.type, (v.config ?? {}) as Record<string, unknown>)),
                automations: autoRows.map((a) => ({
                    name: a.name,
                    trigger_type: a.triggerType,
                    action_types: (Array.isArray(a.actions) ? a.actions : []).map((x) => String((x as { type?: unknown }).type ?? '')).filter(Boolean).slice(0, 10),
                    active: a.isActive,
                })),
                dashboards: dashRows.map((d) => ({ name: d.name })),
                forms: Number(formRow?.n ?? 0),
                portal_enabled: readPortalConfig(scope.list.settings).portal.enabled === true,
                mirror: readMirrorListMarker(scope.list.settings) !== null,
                linked: others.slice(0, 5).map((l) => {
                    const out = relRows.find((r) => r.listId === listId && Number((r.config as Record<string, unknown>).target_list_id) === l.id);
                    const inn = relRows.find((r) => r.listId === l.id);
                    return {
                        slug: l.slug,
                        name: l.name,
                        direction: out ? ('out' as const) : ('in' as const),
                        via: (out ?? inn)?.label ?? '',
                        fields: otherFields.filter((f) => f.listId === l.id).slice(0, 30).map((f) => ({ slug: f.slug, label: f.label, type: f.type as FieldType })),
                    };
                }),
            };
            await this.store.setProfile(ctx.tenantId, listId, ctx.userId, profile);
            return profile;
        });
    }

    // ── Lo que ve el panel ──────────────────────────────────────────────

    async get(ctx: AiToolContext, listKey: string, opts: { summary?: boolean } = {}): Promise<ListSuggestionsResponse> {
        const [mode, hidden] = await Promise.all([this.mode(ctx.tenantId), this.hiddenFor(ctx.tenantId, ctx.userId)]);
        const canConfigure = ctx.role === 'admin';
        if (!ListSuggestionsService.allowedRole(ctx) || mode === 'off') {
            return {
                enabled: false,
                mode,
                hidden_for_me: hidden,
                can_configure: canConfigure,
                new_count: 0,
                suggestions: [],
                marks: {},
                ai: idleAi(mode === 'off' ? 'La empresa apagó las sugerencias.' : 'Las sugerencias son para administradores y gerentes.'),
                sample: { total: 0, sampled: 0 },
            };
        }
        const profile = await this.profile(ctx, listKey);
        const listId = profile.list.id;
        const [marks, aiResult, job] = await Promise.all([this.store.marks(ctx.tenantId, listId), this.store.getAi(ctx.tenantId, listId), this.store.getJob(ctx.tenantId, listId)]);

        const rules = this.rulesFor(ctx, profile);
        const aiList = mode === 'all' && aiResult ? aiResult.suggestions.filter((s) => this.toolOk(ctx, s.tool)) : [];
        const suggestions: ListSuggestion[] = [
            ...rules.map((r) => publicRule(r, marks.get(r.key))),
            ...aiList.map((s) => publicAi(s, marks.get(s.key))),
        ];
        // Lo aplicado se sigue mostrando («Aplicadas · Ver») aunque la regla ya
        // no salga: la vista o el tablero ahora existen.
        const shown = new Set(suggestions.map((s) => s.key));
        const recentApplied = [...marks.entries()]
            .filter(([k, m]) => m.status === 'applied' && !shown.has(k) && !k.startsWith('idea.') && Date.now() - Date.parse(m.at) < 60 * 86_400_000)
            .sort((a, b) => b[1].at.localeCompare(a[1].at))
            .slice(0, 10);
        for (const [key, m] of recentApplied) {
            suggestions.push({
                key,
                source: m.source ?? (key.startsWith('ai.') ? 'ai' : 'rules'),
                category: m.category ?? categoryFromKey(key),
                title: m.title,
                why: '',
                action: { type: 'apply', label: 'Aplicar' },
                preview: null,
                status: 'applied',
                applied: { at: m.at, message: m.message ?? 'Aplicada.', links: m.links ?? [] },
            });
        }
        const markMap: Record<string, 'applied' | 'dismissed'> = {};
        for (const [k, m] of marks) markMap[k] = m.status;
        return {
            enabled: true,
            mode,
            hidden_for_me: hidden,
            can_configure: canConfigure,
            new_count: suggestions.filter((s) => s.status === 'new').length,
            suggestions,
            marks: markMap,
            ai: opts.summary ? idleAi(null) : await this.aiState(ctx, mode, profile, aiResult, job),
            sample: { total: profile.total, sampled: profile.sampled },
        };
    }

    /** Las reglas que esta persona puede aplicar. */
    rulesFor(ctx: AiToolContext, profile: ListProfile): RuleSuggestion[] {
        return buildRuleSuggestions(profile).filter((r) => {
            if (r.action.type === 'tool') return this.toolOk(ctx, r.action.tool);
            if (r.action.type === 'convert_field') return can(ctx, 'manage_fields');
            if (r.key === 'share.form') return can(ctx, 'manage_forms');
            if (r.key.startsWith('quality.empty')) return can(ctx, 'manage_fields');
            return true;
        });
    }

    toolOk(ctx: AiToolContext, tool: string): boolean {
        const def = this.registry.get(tool);
        return def !== undefined && toolAllowed(ctx, def.capability);
    }

    /** Estado del botón «Recomendar con IA»: si se puede, cuántos quedan, y el análisis en curso o el último. */
    async aiState(ctx: AiToolContext, mode: ListSuggestionMode, profile: ListProfile, result: StoredAiResult | null, job: StoredAiJob | null): Promise<ListSuggestionsAiState> {
        let available = false;
        let reason: string | null = null;
        let remaining: number | null = null;
        let limit: number | null = null;
        if (mode !== 'all') reason = 'La empresa eligió sólo sugerencias sin IA.';
        else if (!can(ctx, 'use_ai_assistant')) reason = 'Tu rol no puede usar la IA.';
        else {
            try {
                const access = await this.settings.resolve(ctx.tenantId, { requireOptIn: false });
                if (access.source === 'tenant') available = true;
                else {
                    limit = await this.settings.listSuggestAiMonthly();
                    remaining = Math.max(0, limit - (await this.store.usedQuota(ctx.tenantId)));
                    if (limit === 0) reason = 'Las sugerencias con IA no están activadas en este servidor.';
                    else if (remaining === 0)
                        reason = `Ya usaste los ${limit} análisis con IA de este mes. Las sugerencias sin IA siguen, y con una clave propia (Ajustes → Asistente IA) no hay tope.`;
                    else available = true;
                }
            } catch (err) {
                if (!(err instanceof AiUnavailableError)) throw err;
                reason = friendlyAiReason(err);
            }
        }
        let state: ListSuggestionsAiState['state'] = result ? 'done' : 'idle';
        let stage: ListSuggestionsAiState['stage'] = null;
        let error: string | null = null;
        if (job?.state === 'running') {
            if (Date.now() - job.started_at < RUNNING_STALE_MS) {
                state = 'running';
                stage = job.stage;
            } else {
                state = 'error';
                error = 'El análisis tardó demasiado. Vuelve a intentarlo.';
            }
        } else if (job?.state === 'error') {
            state = 'error';
            error = job.error;
        }
        let canReanalyze = true;
        let hint: string | null = null;
        if (result) {
            const ageDays = (Date.now() - Date.parse(result.analyzed_at)) / 86_400_000;
            const same = listFingerprint(profile, result.purpose) === result.fingerprint;
            if (same && ageDays < LIST_SUGGESTIONS_REANALYZE_DAYS) {
                canReanalyze = false;
                const left = Math.max(1, Math.ceil(LIST_SUGGESTIONS_REANALYZE_DAYS - ageDays));
                hint = `La lista no cambió desde el último análisis: volvería a salir lo mismo. Se puede repetir cuando cambien sus campos, vistas o la cantidad de registros, si cuentas otro propósito, o en ${left} ${left === 1 ? 'día' : 'días'}.`;
            }
        }
        return {
            available: available && state !== 'running',
            reason: state === 'running' ? 'Hay un análisis en curso.' : reason,
            remaining,
            limit,
            state,
            stage,
            error,
            analyzed_at: result?.analyzed_at ?? null,
            can_reanalyze: canReanalyze,
            reanalyze_hint: hint,
            purpose: result?.purpose ?? null,
            ask_purpose: profile.total < LIST_SUGGESTIONS_PURPOSE_BELOW,
        };
    }

    // ── Aplicar y descartar ─────────────────────────────────────────────

    async apply(ctx: AiToolContext, listKey: string, key: string): Promise<ApplyListSuggestionResult> {
        this.assertAllowed(ctx);
        const mode = await this.mode(ctx.tenantId);
        if (mode === 'off') throw notFound();
        const profile = await this.profile(ctx, listKey, { fresh: true });
        const listId = profile.list.id;
        const marks = await this.store.marks(ctx.tenantId, listId);
        if (marks.get(key)?.status === 'applied') {
            throw new ConflictException({ code: 'list_suggestion_applied', message: 'Esta sugerencia ya se aplicó.', data: { status: 409 } });
        }

        let title: string;
        let category: ListSuggestionCategory;
        let run: () => Promise<{ message: string; links: Array<{ label: string; href: string }>; warnings: string[] }>;
        let pub: (m: StoredMark) => ListSuggestion;
        if (key.startsWith('ai.')) {
            const result = mode === 'all' ? await this.store.getAi(ctx.tenantId, listId) : null;
            const s = result?.suggestions.find((x) => x.key === key);
            if (!s || !this.toolOk(ctx, s.tool)) throw notFound();
            title = s.title;
            category = s.category;
            run = () => this.applyTool(ctx, profile.list.slug, s.tool, s.input);
            pub = (m) => publicAi(s, m);
        } else {
            const r = this.rulesFor(ctx, profile).find((x) => x.key === key);
            if (!r) throw notFound();
            title = r.title;
            category = r.category;
            const action = r.action;
            if (action.type === 'link') {
                throw new ConflictException({ code: 'list_suggestion_is_link', message: 'Esta sugerencia se resuelve en otra pantalla.', data: { status: 409 } });
            }
            run =
                action.type === 'tool'
                    ? () => this.applyTool(ctx, profile.list.slug, action.tool, action.input)
                    : () => this.convertField(ctx, profile, action.field_id);
            pub = (m) => publicRule(r, m);
        }

        if (!(await this.store.claimApply(ctx.tenantId, listId, key))) {
            throw new ConflictException({ code: 'list_suggestion_applying', message: 'Esta sugerencia ya se está aplicando.', data: { status: 409 } });
        }
        try {
            const outcome = await run();
            const mark: StoredMark = {
                status: 'applied',
                at: new Date().toISOString(),
                by: ctx.userId,
                title,
                category,
                source: key.startsWith('ai.') ? 'ai' : 'rules',
                message: outcome.message,
                links: outcome.links,
            };
            await this.store.setMark(ctx.tenantId, listId, key, mark);
            await this.store.dropProfiles(ctx.tenantId, listId);
            void this.audit.log({
                tenantId: ctx.tenantId,
                userId: ctx.userId,
                action: 'list_suggestion.apply',
                targetType: 'list',
                targetId: listId,
                targetLabel: title.slice(0, 190),
                meta: { key, source: key.startsWith('ai.') ? 'ai' : 'rules' },
            });
            return { suggestion: pub(mark), warnings: outcome.warnings };
        } finally {
            await this.store.releaseApply(ctx.tenantId, listId, key);
        }
    }

    /**
     * Aplica con la MISMA herramienta validada del asistente: se vuelve a
     * correr ahora (el esquema pudo cambiar desde que se sugirió) y su
     * propuesta se aplica por `ProposalsService` — capacidad, límites del
     * plan, realtime y bitácora incluidos.
     */
    private async applyTool(ctx: AiToolContext, listSlug: string, tool: string, input: Record<string, unknown>) {
        const res = await this.registry.execute({ ...ctx, listSlug }, tool, input);
        if (res.isError || !res.proposal) {
            const msg = (res.content as { error?: unknown } | undefined)?.error;
            throw new ConflictException({
                code: 'list_suggestion_stale',
                message: `Esta sugerencia ya no se puede aplicar${typeof msg === 'string' ? `: ${msg}` : '. La lista cambió desde que se calculó.'}`,
                data: { status: 409 },
            });
        }
        const applied = await this.proposals.apply(ctx, res.proposal.id);
        return { message: applied.result?.message ?? 'Listo.', links: applied.result?.links ?? [], warnings: applied.result?.warnings ?? [] };
    }

    private async convertField(ctx: AiToolContext, profile: ListProfile, fieldId: number) {
        if (!can(ctx, 'manage_fields')) {
            throw new ForbiddenException({ code: 'list_suggestion_forbidden', message: 'Tu rol no administra los campos.', data: { status: 403 } });
        }
        const field = profile.fields.find((f) => f.id === fieldId);
        if (!field || field.type !== 'text') throw notFound();
        const updated = await this.fieldsService.update(ctx.tenantId, String(profile.list.id), String(fieldId), { type: 'select' } as never);
        const n = Array.isArray((updated.config as Record<string, unknown> | undefined)?.options) ? ((updated.config as { options: unknown[] }).options.length) : 0;
        void this.audit.log({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: 'field.type_change',
            targetType: 'field',
            targetId: fieldId,
            targetLabel: field.label,
            meta: { list: profile.list.slug, from: 'text', to: 'select', via: 'list_suggestion' },
        });
        return {
            message: `«${field.label}» ahora es una selección${n > 0 ? ` con ${n} opciones` : ''}.`,
            links: [{ label: 'Ver la lista', href: `/lists/${encodeURIComponent(profile.list.slug)}/records` }],
            warnings: [],
        };
    }

    async dismiss(ctx: AiToolContext, listKey: string, key: string, title: string | undefined): Promise<void> {
        this.assertAllowed(ctx);
        if (!listSuggestionKeySchema.safeParse(key).success) throw notFound();
        const profile = await this.profile(ctx, listKey);
        await this.store.setMark(ctx.tenantId, profile.list.id, key, {
            status: 'dismissed',
            at: new Date().toISOString(),
            by: ctx.userId,
            title: (title ?? key).slice(0, 190),
        });
    }

    async restore(ctx: AiToolContext, listKey: string, key: string): Promise<void> {
        this.assertAllowed(ctx);
        const profile = await this.profile(ctx, listKey);
        const marks = await this.store.marks(ctx.tenantId, profile.list.id);
        if (marks.get(key)?.status === 'dismissed') await this.store.clearMark(ctx.tenantId, profile.list.id, key);
    }
}

function categoryFromKey(key: string): ListSuggestionCategory {
    const head = key.split('.')[0];
    return head === 'dashboard' || head === 'field' || head === 'quality' || head === 'share' ? head : 'view';
}

function viewSummary(name: string, type: string, c: Record<string, unknown>): ListProfile['views'][number] {
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
    const filterIds: number[] = [];
    const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const n = node as { type?: unknown; field_id?: unknown; children?: unknown };
        if (n.type === 'condition' && typeof n.field_id === 'number') filterIds.push(n.field_id);
        if (Array.isArray(n.children)) for (const ch of n.children) walk(ch);
    };
    walk(c.filter_tree);
    return {
        name,
        type,
        group_by_field_id: num(c.group_by_field_id),
        date_field_id: num(c.date_field_id),
        start_field_id: num(c.gantt_start_field_id),
        end_field_id: num(c.gantt_end_field_id),
        person_field_id: num(c.workload_person_field_id),
        filter_field_ids: filterIds,
    };
}

function applyMark(base: Omit<ListSuggestion, 'status' | 'applied'>, mark: StoredMark | undefined): ListSuggestion {
    if (mark?.status === 'applied') return { ...base, status: 'applied', applied: { at: mark.at, message: mark.message ?? 'Aplicada.', links: mark.links ?? [] } };
    if (mark?.status === 'dismissed') return { ...base, status: 'dismissed', applied: null };
    return { ...base, status: 'new', applied: null };
}

export function publicRule(r: RuleSuggestion, mark: StoredMark | undefined): ListSuggestion {
    return applyMark(
        {
            key: r.key,
            source: 'rules',
            category: r.category,
            title: r.title,
            why: r.why,
            action: r.action.type === 'link' ? { type: 'link', label: r.action.label, href: r.action.href } : { type: 'apply', label: r.action.label },
            preview: r.preview,
        },
        mark,
    );
}

export function publicAi(s: StoredAiSuggestion, mark: StoredMark | undefined): ListSuggestion {
    return applyMark(
        {
            key: s.key,
            source: 'ai',
            category: s.category,
            title: s.title,
            why: s.why,
            action: { type: 'apply', label: s.category === 'dashboard' ? 'Crear el tablero' : s.category === 'automation' ? 'Crear la automatización' : s.category === 'field' ? 'Aplicar' : 'Crear la vista' },
            preview: s.preview,
        },
        mark,
    );
}

function idleAi(reason: string | null): ListSuggestionsAiState {
    return {
        available: false,
        reason,
        remaining: null,
        limit: null,
        state: 'idle',
        stage: null,
        error: null,
        analyzed_at: null,
        can_reanalyze: false,
        reanalyze_hint: null,
        purpose: null,
        ask_purpose: false,
    };
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'list_suggestion_not_found', message: 'Esta sugerencia ya no aplica: la lista cambió. Vuelve a abrir las sugerencias.', data: { status: 404 } });
}
