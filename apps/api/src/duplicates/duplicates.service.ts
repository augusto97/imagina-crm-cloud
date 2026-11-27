import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    DUPLICATE_KEY_SEPARATOR,
    DUP_FOLD_FROM,
    DUP_FOLD_TO,
    MERGE_MAX_RECORDS,
    duplicateRuleKey,
    duplicateRuleLabel,
    isDuplicateRuleFieldType,
    mergeListFeatures,
    readDuplicateSettings,
    readListFeatures,
    resolveTitleFieldId,
    type DuplicateGroup,
    type DuplicateGroupsPage,
    type DuplicateMatch,
    type DuplicateRecordSummary,
    type DuplicateSettings,
    type DuplicateSettingsInput,
    type Field,
    type List,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { Tx } from '../db/client';
import { lists, recordDuplicateDismissals, records } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService, type Actor, type ReadScope } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/** Grupos que se leen por regla (una lista con muchísimos duplicados muestra los primeros). */
const GROUP_SCAN_LIMIT = 2000;
/** Ids que se guardan por grupo (más que eso ya no es un duplicado: es un dato repetido a propósito). */
const GROUP_IDS_CAP = 50;
/** Hasta este tamaño se respeta «no son duplicados» par por par. */
const PAIRWISE_MAX = 12;
const PAGE_MAX = 50;
const CHECK_LIMIT = 5;

type KeyField = Pick<Field, 'id' | 'type'>;

/**
 * La clave comparable de un campo, en SQL — la MISMA que `duplicateKey` (JS)
 * en packages/shared. Ojo: dentro de un template de JS las barras se cocinan
 * (`\.` → `.`): las expresiones usan clases de caracteres en vez de escapes.
 */
export function duplicateKeyExpr(field: KeyField): SQL {
    const col = sql`(${records.data} ->> ${`f${field.id}`})`;
    switch (field.type) {
        case 'email':
        case 'select':
            return sql`lower(btrim(${col}))`;
        case 'phone': {
            const digits = sql`regexp_replace(${col}, '[^0-9]', '', 'g')`;
            return sql`(CASE WHEN length(${digits}) >= 7 THEN right(${digits}, 10) ELSE '' END)`;
        }
        case 'number':
            return sql`(CASE WHEN btrim(${col}) ~ '^-?[0-9]+([.][0-9]+)?$' THEN ((btrim(${col}))::numeric)::float8::text ELSE '' END)`;
        case 'url':
            return sql`rtrim(regexp_replace(regexp_replace(lower(btrim(${col})), '^https?://', ''), '^www[.]', ''), '/')`;
        case 'date':
            return sql`left(btrim(${col}), 10)`;
        default:
            return sql`btrim(regexp_replace(translate(lower(${col}), ${DUP_FOLD_FROM}, ${DUP_FOLD_TO}), '[^a-z0-9]+', ' ', 'g'))`;
    }
}

/** La clave de una regla (NULL si falta algún campo), igual que `duplicateRuleKey`. */
export function duplicateRuleExpr(rule: readonly number[], byId: ReadonlyMap<number, KeyField>): SQL | null {
    const parts = rule.map((id) => byId.get(id)).filter((f): f is KeyField => !!f).map((f) => sql`coalesce(${duplicateKeyExpr(f)}, '')`);
    if (parts.length !== rule.length || parts.length === 0) return null;
    const allFilled = sql.join(parts.map((p) => sql`${p} <> ''`), sql` AND `);
    const joined = sql.join(parts, sql` || ${DUPLICATE_KEY_SEPARATOR} || `);
    return sql`(CASE WHEN ${allFilled} THEN ${joined} END)`;
}

/** Union-find chico para juntar los grupos de distintas reglas en uno. */
class Groups {
    private parent = new Map<number, number>();
    find(a: number): number {
        let p = this.parent.get(a) ?? a;
        if (p !== a) {
            p = this.find(p);
            this.parent.set(a, p);
        }
        return p;
    }
    union(a: number, b: number): void {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb) this.parent.set(Math.max(ra, rb), Math.min(ra, rb));
    }
    touched(): number[] {
        return [...this.parent.keys()];
    }
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

function titleFor(fields: Field[], list: Pick<List, 'settings'>, id: number, data: Record<string, unknown>): string {
    const tid = resolveTitleFieldId(fields, list.settings);
    const v = tid ? data[`f${tid}`] : null;
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    return s !== '' ? s.slice(0, 160) : `Registro #${id}`;
}

/** Un valor de una regla, como se lee (la etiqueta de la opción, no su valor interno). */
function shownValue(field: Field, value: unknown): string {
    if (value === null || value === undefined) return '';
    if (field.type === 'select') {
        const opts = ((field.config ?? {}) as { options?: Array<{ value: string; label: string }> }).options ?? [];
        return opts.find((o) => o.value === value)?.label ?? String(value);
    }
    return String(value).slice(0, 160);
}

/**
 * A14 (v0.1.445, ADR-S106) — Duplicados de una lista: las reglas, el aviso al
 * crear (y en la ficha), los grupos del panel y «no son duplicados». Todo con
 * el acceso de quien pregunta: sólo ve duplicados entre registros que puede
 * ver, y una regla con un campo que no ve no se aplica (sería un oráculo).
 */
@Injectable()
export class DuplicatesService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly records: RecordsService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeService,
    ) {}

    async settings(tenantId: number, actor: Actor, listIdOrSlug: string): Promise<DuplicateSettings> {
        return this.records.readScoped(tenantId, actor, listIdOrSlug, async (_tx, scope) => readDuplicateSettings(scope.list.settings, scope.fields));
    }

    async updateSettings(tenantId: number, actor: Actor, listIdOrSlug: string, input: DuplicateSettingsInput): Promise<DuplicateSettings> {
        const out = await this.records.readScoped(tenantId, actor, listIdOrSlug, async (tx, scope) => {
            const byId = new Map(scope.fields.map((f) => [f.id, f]));
            const current = scope.list.settings?.duplicates;
            const next: Record<string, unknown> = current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
            // v0.1.475 — encender o apagar es la función «Duplicados» de la lista
            // (`settings.features.duplicates`), la misma de «Funciones de la lista».
            delete next.enabled;
            const features = input.enabled !== undefined
                ? mergeListFeatures(scope.list.settings, { duplicates: input.enabled })
                : readListFeatures(scope.list.settings);
            if (input.warn_on_create !== undefined) next.warn_on_create = input.warn_on_create;
            if (input.rules === null) delete next.rules;
            else if (input.rules !== undefined) {
                next.rules = input.rules.map((r) => {
                    const ids = [...new Set(r.fields)];
                    for (const id of ids) {
                        const f = byId.get(id);
                        if (!f) throw invalid('duplicate_rule_field', 'Un campo de la regla no es de esta lista.');
                        if (!isDuplicateRuleFieldType(f.type)) {
                            throw invalid('duplicate_rule_type', `«${f.label}» no sirve para reconocer duplicados: elige un texto, correo, teléfono, enlace, número, selección o fecha.`);
                        }
                    }
                    return { fields: ids };
                });
            }
            await tx
                .update(lists)
                .set({
                    settings: sql`jsonb_set(jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), '{duplicates}', ${JSON.stringify(next)}::jsonb), '{features}', ${JSON.stringify(features)}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, scope.list.id)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId: actor.userId,
                action: 'list.duplicates',
                targetType: 'list',
                targetId: scope.list.id,
                targetLabel: scope.list.name,
                meta: { duplicates: next, enabled: features.duplicates },
            });
            return readDuplicateSettings({ ...(scope.list.settings ?? {}), duplicates: next, features }, scope.fields);
        });
        this.realtime.lists(tenantId);
        return out;
    }

    /** Los grupos de posibles duplicados de la lista (panel «Duplicados»). */
    async groups(tenantId: number, actor: Actor, listIdOrSlug: string, opts: { offset?: number; limit?: number } = {}): Promise<DuplicateGroupsPage> {
        return this.records.readScoped(tenantId, actor, listIdOrSlug, async (tx, scope) => {
            const settings = readDuplicateSettings(scope.list.settings, scope.fields);
            const byId = new Map(scope.fields.map((f) => [f.id, f]));
            const usable = settings.rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.every((id) => !scope.hiddenIds.has(id)));
            const scopeW = scope.where({});
            const dismissed = await this.dismissedPairs(tx, tenantId, scope.list.id);
            const uf = new Groups();
            const ruleHits: Array<{ ids: number[]; ruleIndex: number }> = [];
            let truncated = false;
            for (const { rule, index } of usable) {
                const expr = duplicateRuleExpr(rule, byId);
                if (!expr) continue;
                const res = await tx.execute(sql`
                    SELECT (array_agg(s.id ORDER BY s.id))[1:${sql.raw(String(GROUP_IDS_CAP))}] AS ids
                    FROM (
                        SELECT ${expr} AS k, ${records.id} AS id FROM ${records}
                        WHERE ${records.tenantId} = ${tenantId} AND ${records.listId} = ${scope.list.id}
                          AND ${records.deletedAt} IS NULL AND ${records.parentId} IS NULL
                          ${scopeW ? sql`AND ${scopeW}` : sql``}
                    ) s
                    WHERE s.k IS NOT NULL
                    GROUP BY s.k HAVING count(*) > 1
                    ORDER BY count(*) DESC, min(s.id)
                    LIMIT ${GROUP_SCAN_LIMIT + 1}`);
                const rows = res.rows as Array<{ ids: Array<number | string> }>;
                if (rows.length > GROUP_SCAN_LIMIT) truncated = true;
                for (const row of rows.slice(0, GROUP_SCAN_LIMIT)) {
                    const ids = row.ids.map(Number);
                    ruleHits.push({ ids, ruleIndex: index });
                    if (ids.length <= PAIRWISE_MAX) {
                        for (let i = 0; i < ids.length; i++)
                            for (let j = i + 1; j < ids.length; j++) if (!dismissed.has(pairKey(ids[i]!, ids[j]!))) uf.union(ids[i]!, ids[j]!);
                    } else {
                        for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!);
                    }
                }
            }
            // Grupos finales (lo conectado por cualquier regla) y en qué coincidieron.
            const members = new Map<number, Set<number>>();
            for (const id of uf.touched()) {
                const root = uf.find(id);
                if (!members.has(root)) members.set(root, new Set([root]));
                members.get(root)!.add(id);
            }
            const matched = new Map<number, Set<number>>();
            for (const hit of ruleHits) {
                const root = uf.find(hit.ids[0]!);
                if (!members.has(root)) continue;
                if (!matched.has(root)) matched.set(root, new Set());
                matched.get(root)!.add(hit.ruleIndex);
            }
            const all = [...members.entries()]
                .map(([root, set]) => ({ root, ids: [...set].sort((a, b) => a - b) }))
                .filter((g) => g.ids.length > 1)
                .sort((a, b) => b.ids.length - a.ids.length || a.ids[0]! - b.ids[0]!);
            const offset = Math.max(0, opts.offset ?? 0);
            const limit = Math.min(PAGE_MAX, Math.max(1, opts.limit ?? 20));
            const page = all.slice(offset, offset + limit);
            const shownIds = page.flatMap((g) => g.ids.slice(0, MERGE_MAX_RECORDS));
            const summaries = await this.summaries(tx, tenantId, scope.list, scope.fields, shownIds, settings.rules.filter((_, i) => usable.some((u) => u.index === i)));
            const groups: DuplicateGroup[] = page.map((g) => ({
                ids: g.ids,
                matched: [...(matched.get(g.root) ?? [])].sort((a, b) => a - b).map((i) => duplicateRuleLabel(settings.rules[i]!, scope.fields)),
                records: g.ids.slice(0, MERGE_MAX_RECORDS).map((id) => summaries.get(id)).filter((s): s is DuplicateRecordSummary => !!s),
            }));
            return { groups, total: all.length, truncated, settings, hidden_rules: settings.rules.length - usable.length };
        });
    }

    /**
     * Lo que se está escribiendo (alta) o lo que tiene un registro (ficha) ¿ya
     * existe? Devuelve los primeros que coinciden, con en qué.
     */
    async check(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        values: Record<string, unknown>,
        opts: { excludeId?: number; purpose: 'create' | 'record' },
    ): Promise<DuplicateMatch[]> {
        return this.records.readScoped(tenantId, actor, listIdOrSlug, async (tx, scope) => {
            const settings = readDuplicateSettings(scope.list.settings, scope.fields);
            if (!settings.enabled || (opts.purpose === 'create' && !settings.warn_on_create)) return [];
            return this.matchesFor(tx, tenantId, scope, settings, this.byFieldKey(scope.fields, values), opts.excludeId);
        });
    }

    /** Los posibles duplicados de un registro (banner de la ficha). */
    async forRecord(tenantId: number, actor: Actor, listIdOrSlug: string, id: number): Promise<DuplicateMatch[]> {
        return this.records.readScoped(tenantId, actor, listIdOrSlug, async (tx, scope) => {
            const settings = readDuplicateSettings(scope.list.settings, scope.fields);
            if (!settings.enabled) return [];
            const scopeW = scope.where({});
            const [row] = await tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, scope.list.id), eq(records.id, id), isNull(records.deletedAt), ...(scopeW ? [scopeW] : [])))
                .limit(1);
            if (!row) throw new NotFoundException({ code: 'record_not_found', message: 'El registro no existe.', data: { status: 404 } });
            return this.matchesFor(tx, tenantId, scope, settings, (row.data ?? {}) as Record<string, unknown>, id);
        });
    }

    /** «No son duplicados»: cada par del grupo deja de aparecer junto. */
    async dismiss(tenantId: number, actor: Actor, listIdOrSlug: string, ids: number[]): Promise<{ pairs: number }> {
        const unique = [...new Set(ids)];
        if (unique.length < 2) throw invalid('duplicate_dismiss_ids', 'Elige al menos dos registros.');
        return this.records.readScoped(tenantId, actor, listIdOrSlug, async (tx, scope) => {
            const scopeW = scope.where({});
            const found = await tx
                .select({ id: records.id })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, scope.list.id), inArray(records.id, unique), isNull(records.deletedAt), ...(scopeW ? [scopeW] : [])));
            if (found.length !== unique.length) throw new NotFoundException({ code: 'record_not_found', message: 'Alguno de esos registros ya no existe.', data: { status: 404 } });
            const values: Array<typeof recordDuplicateDismissals.$inferInsert> = [];
            for (let i = 0; i < unique.length; i++)
                for (let j = i + 1; j < unique.length; j++) {
                    const a = Math.min(unique[i]!, unique[j]!);
                    const b = Math.max(unique[i]!, unique[j]!);
                    values.push({ tenantId, listId: scope.list.id, recordLow: a, recordHigh: b, createdBy: actor.userId });
                }
            const res = await tx.insert(recordDuplicateDismissals).values(values).onConflictDoNothing().returning({ id: recordDuplicateDismissals.id });
            return { pairs: res.length };
        });
    }

    // ── Detalles ────────────────────────────────────────────────────────────

    private byFieldKey(fields: Field[], values: Record<string, unknown>): Record<string, unknown> {
        const bySlug = new Map(fields.map((f) => [f.slug, f.id]));
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(values)) {
            if (/^f\d+$/.test(k)) out[k] = v;
            else if (bySlug.has(k)) out[`f${bySlug.get(k)}`] = v;
        }
        return out;
    }

    private async matchesFor(
        tx: Tx,
        tenantId: number,
        scope: ReadScope,
        settings: DuplicateSettings,
        data: Record<string, unknown>,
        excludeId: number | undefined,
    ): Promise<DuplicateMatch[]> {
        const byId = new Map(scope.fields.map((f) => [f.id, f]));
        const wanted: Array<{ rule: number[]; key: string; expr: SQL }> = [];
        for (const rule of settings.rules) {
            if (rule.some((id) => scope.hiddenIds.has(id))) continue;
            const key = duplicateRuleKey(rule, byId, data);
            const expr = duplicateRuleExpr(rule, byId);
            if (key !== '' && expr) wanted.push({ rule, key, expr });
        }
        if (wanted.length === 0) return [];
        const scopeW = scope.where({});
        const rows = await tx
            .select({ id: records.id, data: records.data })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, scope.list.id),
                    isNull(records.deletedAt),
                    isNull(records.parentId),
                    ...(excludeId ? [sql`${records.id} <> ${excludeId}`] : []),
                    ...(scopeW ? [scopeW] : []),
                    or(...wanted.map((w) => sql`${w.expr} = ${w.key}`)),
                ),
            )
            .orderBy(records.id)
            .limit(20);
        const dismissed = excludeId ? await this.dismissedWith(tx, tenantId, excludeId) : new Set<number>();
        const out: DuplicateMatch[] = [];
        for (const r of rows) {
            if (dismissed.has(r.id)) continue;
            const d = (r.data ?? {}) as Record<string, unknown>;
            const matched = wanted.filter((w) => duplicateRuleKey(w.rule, byId, d) === w.key).map((w) => duplicateRuleLabel(w.rule, scope.fields));
            if (matched.length === 0) continue;
            out.push({ id: r.id, title: titleFor(scope.fields, scope.list, r.id, d), matched });
            if (out.length >= CHECK_LIMIT) break;
        }
        return out;
    }

    private async summaries(tx: Tx, tenantId: number, list: List, fields: Field[], ids: number[], rules: number[][]): Promise<Map<number, DuplicateRecordSummary>> {
        const out = new Map<number, DuplicateRecordSummary>();
        if (ids.length === 0) return out;
        const shownFields = [...new Set(rules.flat())].map((id) => fields.find((f) => f.id === id)).filter((f): f is Field => !!f);
        const rows = await tx
            .select({ id: records.id, data: records.data, updatedAt: records.updatedAt })
            .from(records)
            .where(and(eq(records.tenantId, tenantId), inArray(records.id, ids)));
        for (const r of rows) {
            const d = (r.data ?? {}) as Record<string, unknown>;
            out.set(r.id, {
                id: r.id,
                title: titleFor(fields, list, r.id, d),
                values: shownFields.map((f) => ({ label: f.label, value: shownValue(f, d[`f${f.id}`]) })).filter((v) => v.value !== ''),
                updated_at: new Date(r.updatedAt).toISOString(),
            });
        }
        return out;
    }

    private async dismissedPairs(tx: Tx, tenantId: number, listId: number): Promise<Set<string>> {
        const rows = await tx
            .select({ a: recordDuplicateDismissals.recordLow, b: recordDuplicateDismissals.recordHigh })
            .from(recordDuplicateDismissals)
            .where(and(eq(recordDuplicateDismissals.tenantId, tenantId), eq(recordDuplicateDismissals.listId, listId)));
        return new Set(rows.map((r) => pairKey(r.a, r.b)));
    }

    private async dismissedWith(tx: Tx, tenantId: number, id: number): Promise<Set<number>> {
        const rows = await tx
            .select({ a: recordDuplicateDismissals.recordLow, b: recordDuplicateDismissals.recordHigh })
            .from(recordDuplicateDismissals)
            .where(and(eq(recordDuplicateDismissals.tenantId, tenantId), or(eq(recordDuplicateDismissals.recordLow, id), eq(recordDuplicateDismissals.recordHigh, id))));
        return new Set(rows.map((r) => (r.a === id ? r.b : r.a)));
    }
}

function invalid(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}
