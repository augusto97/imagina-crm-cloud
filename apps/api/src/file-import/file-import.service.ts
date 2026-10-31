import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    FILE_IMPORT_MAX_ROWS,
    buildDraftPlan,
    foldImportValue as fold,
    jsonbKeyForField,
    makeFileImportCellReader,
    profileSheet,
    resolveFileImportPlan,
    validateFieldValue,
    type Field,
    type FileImportAnalysis,
    type FileImportAnalyzeInput,
    type FileImportApplyInput,
    type FileImportApplyResult,
    type FileImportCellWarning,
    type FileImportPlan,
    type FileImportSheetProfile,
    type ResolvedImportField,
    type ResolvedImportList,
    type ResolvedImportPlan,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import type { AiToolContext } from '../ai/tools/registry';
import type { ListSpec } from '../ai/tools/structure-tools';
import { StructureTools } from '../ai/tools/structure-tools';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { records, relations } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { parseCsv } from '../import/csv-parser';
import { ListGroupsService } from '../lists/list-groups.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { readTenantFormat } from '../tenancy/tenant-format';
import { BlueprintService } from '../templates/blueprint.service';
import { FileImportAiService } from './file-import-ai.service';
import { analysisKey, defaultsForTimeZone, type StoredAnalysis } from './file-import-store';

/** Cuánto vive un análisis para revisar y crear. */
const ANALYSIS_TTL_SECONDS = 2 * 60 * 60;
const INSERT_CHUNK = 500;
const MAX_CELL_WARNINGS = 200;

interface ParsedSheet {
    headers: string[];
    rows: string[][];
}

interface StagedRecord {
    /** Fila del archivo (1 = encabezado), para los avisos. */
    row: number;
    data: Record<string, unknown>;
    title: string;
    /** Vínculos por resolver: slug del campo relation → texto de la celda. */
    links: Array<{ slug: string; raw: string }>;
    id?: number;
}

/**
 * v0.1.339 (ADR-S88) — «Crear desde un archivo»: análisis (reglas, gratis) y
 * creación (listas + registros + vínculos) a partir de un plan revisado.
 *
 * Crear pasa por el MISMO constructor de listas del asistente
 * (`buildCreateListBlueprint`) y el MISMO motor de las plantillas
 * (`BlueprintService.materialize`): no hay otro camino para crear listas,
 * campos ni opciones. Los valores se leen con el lector compartido
 * (`makeFileImportCellReader`) y se validan con `validateFieldValue` contra el
 * campo YA creado: lo que no entra se informa por celda y no tumba la fila.
 */
@Injectable()
export class FileImportService {
    private readonly logger = new Logger(FileImportService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly groups: ListGroupsService,
        private readonly fields: FieldsService,
        private readonly blueprints: BlueprintService,
        private readonly structure: StructureTools,
        private readonly billing: BillingService,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
        private readonly ai: FileImportAiService,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    // ── Analizar ──────────────────────────────────────────────────────────

    async analyze(ctx: AiToolContext, input: FileImportAnalyzeInput): Promise<FileImportAnalysis> {
        const format = await readTenantFormat(this.tenantDb, ctx.tenantId);
        const defaults = defaultsForTimeZone(format.timezone ?? null);
        const parsed = input.sheets.map(parseSheet);
        if (parsed.every((p) => p.rows.length === 0)) {
            throw new BadRequestException({
                code: 'file_import_empty',
                message: 'El archivo no tiene filas con datos debajo de los encabezados.',
                data: { status: 400 },
            });
        }
        const profiles = parsed.map((p, i) => {
            const profile = profileSheet(i, input.sheets[i]!.name || `Hoja ${i + 1}`, p.headers, p.rows, {
                typeHints: input.sheets[i]!.type_hints,
                numberFormat: format.number_format,
                dateFormat: format.date_format,
                maxRows: FILE_IMPORT_MAX_ROWS,
            });
            profile.preview = dataRows(p, profile).slice(0, 5).map((r) => profile.headers.map((_, c) => String(r[c] ?? '').slice(0, 120)));
            return profile;
        });
        const plan = buildDraftPlan(
            profiles.map((profile, i) => ({ profile, rows: dataRows(parsed[i]!, profile) })),
            { fileName: input.file_name, currency: defaults.currency, country: defaults.country },
        );

        const id = randomBytes(12).toString('base64url');
        const stored: StoredAnalysis = {
            id,
            file_name: input.file_name,
            source: input.source,
            hashes: input.sheets.map((s) => sha256(s.csv)),
            sheets: profiles,
            plan,
            defaults,
            applied: null,
        };
        await this.redis.set(analysisKey(ctx.tenantId, ctx.userId, id), JSON.stringify(stored), 'EX', ANALYSIS_TTL_SECONDS);

        const remaining = await this.billing.recordsRemaining(ctx.tenantId);
        return {
            id,
            file_name: input.file_name,
            source: input.source,
            sheets: profiles,
            plan,
            ai: await this.ai.availability(ctx),
            limit: { remaining, planned: resolveFileImportPlan(plan, profiles).records },
            defaults,
        };
    }

    // ── Crear ─────────────────────────────────────────────────────────────

    async apply(ctx: AiToolContext, input: FileImportApplyInput): Promise<FileImportApplyResult> {
        const key = analysisKey(ctx.tenantId, ctx.userId, input.analysis_id);
        const stored = await readStored(this.redis, key);
        if (!stored) {
            throw new NotFoundException({ code: 'file_import_expired', message: 'El análisis venció: vuelve a subir el archivo.', data: { status: 404 } });
        }
        if (stored.applied) {
            throw new ConflictException({ code: 'file_import_already_applied', message: 'Este archivo ya se importó.', data: { status: 409 } });
        }
        const lockKey = `${key}:lock`;
        if ((await this.redis.set(lockKey, '1', 'EX', 600, 'NX')) !== 'OK') {
            throw new ConflictException({ code: 'file_import_applying', message: 'Ya se están creando las listas de este archivo.', data: { status: 409 } });
        }
        try {
            const hashes = input.sheets.map((s) => sha256(s.csv));
            if (hashes.length !== stored.hashes.length || hashes.some((h, i) => h !== stored.hashes[i])) {
                throw new ConflictException({
                    code: 'file_import_changed',
                    message: 'El archivo no es el mismo que se analizó: vuelve a subirlo.',
                    data: { status: 409 },
                });
            }
            const resolved = resolveFileImportPlan(input.plan, stored.sheets);
            if (resolved.errors.length > 0) {
                throw new BadRequestException({
                    code: 'file_import_invalid_plan',
                    message: resolved.errors.slice(0, 3).join(' '),
                    data: { status: 400, errors: { plan: resolved.errors.join('\n') } },
                });
            }
            const format = await readTenantFormat(this.tenantDb, ctx.tenantId);
            const parsed = input.sheets.map(parseSheet);
            const rowsBySheet = new Map(stored.sheets.map((p, i) => [p.index, dataRows(parsed[i]!, p)]));
            const staged = this.stage(resolved, rowsBySheet, format.timezone ?? undefined);

            // El límite del plan, ANTES de crear nada.
            let total = [...staged.byList.values()].reduce((n, l) => n + l.length, 0);
            const remaining = await this.billing.recordsRemaining(ctx.tenantId);
            let leftOut = 0;
            if (remaining !== null && total > remaining) {
                if (input.max_records === undefined) {
                    throw new ForbiddenException({
                        code: 'plan_limit_reached',
                        message: `El archivo trae ${total} registros y a tu plan le quedan ${remaining}. Puedes importar sólo los primeros ${remaining} o pasar a un plan mayor.`,
                        data: { status: 403, errors: { plan: 'límite de registros' } },
                    });
                }
                leftOut = this.cap(resolved, staged.byList, Math.min(input.max_records, remaining));
                total -= leftOut;
            }
            await this.billing.assertCanCreateRecords(ctx.tenantId, total);

            const result = await this.create(ctx, input.plan, resolved, staged.byList, stored, input.group_id);
            const final: FileImportApplyResult = {
                ...result,
                skipped_duplicates: staged.duplicates,
                left_out: leftOut,
                cell_warnings: [...staged.cellWarnings, ...result.cell_warnings].slice(0, MAX_CELL_WARNINGS),
                cell_warnings_total: staged.cellWarningsTotal + result.cell_warnings_total,
                warnings: [...resolved.notes, ...result.warnings],
            };
            stored.applied = { at: Date.now(), lists: final.lists.map((l) => l.id) };
            await this.redis.set(key, JSON.stringify(stored), 'EX', ANALYSIS_TTL_SECONDS);
            void this.audit.log({
                tenantId: ctx.tenantId,
                userId: ctx.userId,
                action: 'file_import.apply',
                targetType: 'workspace',
                targetId: ctx.tenantId,
                targetLabel: final.lists.map((l) => l.name).join(', '),
                meta: {
                    file_name: stored.file_name,
                    source: stored.source,
                    lists: final.lists.map((l) => l.id),
                    records: final.imported,
                    linked: final.linked,
                    ai_used: input.plan.ai_used,
                    left_out: leftOut,
                },
            });
            return final;
        } finally {
            await this.redis.del(lockKey).catch(() => undefined);
        }
    }

    /** Las filas de cada lista, leídas con el plan (todavía sin validar contra el campo creado). */
    private stage(
        resolved: ResolvedImportPlan,
        rowsBySheet: ReadonlyMap<number, string[][]>,
        timeZone: string | undefined,
    ): { byList: Map<string, StagedRecord[]>; duplicates: number; cellWarnings: FileImportCellWarning[]; cellWarningsTotal: number } {
        const byList = new Map<string, StagedRecord[]>();
        let duplicates = 0;
        const cellWarnings: FileImportCellWarning[] = [];
        let cellWarningsTotal = 0;
        const warn = (w: FileImportCellWarning): void => {
            cellWarningsTotal++;
            if (cellWarnings.length < MAX_CELL_WARNINGS) cellWarnings.push(w);
        };

        for (const list of resolved.lists) {
            const rows = rowsBySheet.get(list.source.sheet) ?? [];
            const readers = list.fields.map((f) => (f.type === 'relation' ? null : makeFileImportCellReader(f, { timeZone })));
            const out: StagedRecord[] = [];
            const uniques = new Map<string, Set<string>>(list.fields.filter((f) => f.is_unique).map((f) => [f.slug, new Set<string>()]));

            if (list.source.kind === 'sheet') {
                const seen = new Set<string>();
                rows.forEach((row, i) => {
                    if (list.skip_duplicates) {
                        const sig = row.map((c) => c.trim()).join('\u0001');
                        if (seen.has(sig)) {
                            duplicates++;
                            return;
                        }
                        seen.add(sig);
                    }
                    const rec = this.readRow(list, row, i + 2, readers, uniques, warn);
                    if (rec) out.push(rec);
                });
            } else {
                // Una lista separada: un registro por valor distinto de la columna clave,
                // con el primer valor que aparezca de cada columna que se mudó.
                const keyCol = list.source.key_column;
                const groups = new Map<string, { row: number; cells: string[] }>();
                rows.forEach((row, i) => {
                    const k = fold(String(row[keyCol] ?? ''));
                    if (k === '') return;
                    const g = groups.get(k);
                    if (!g) {
                        groups.set(k, { row: i + 2, cells: [...row] });
                        return;
                    }
                    for (const f of list.fields) {
                        if ((g.cells[f.column] ?? '').trim() === '' && (row[f.column] ?? '').trim() !== '') g.cells[f.column] = row[f.column]!;
                    }
                });
                for (const g of groups.values()) {
                    const rec = this.readRow(list, g.cells, g.row, readers, uniques, warn);
                    if (rec) out.push(rec);
                }
            }
            byList.set(list.key, out);
        }
        return { byList, duplicates, cellWarnings, cellWarningsTotal };
    }

    private readRow(
        list: ResolvedImportList,
        row: readonly string[],
        rowNumber: number,
        readers: ReadonlyArray<((raw: string) => unknown) | null>,
        uniques: Map<string, Set<string>>,
        warn: (w: FileImportCellWarning) => void,
    ): StagedRecord | null {
        const data: Record<string, unknown> = {};
        const links: StagedRecord['links'] = [];
        let any = false;
        let title = '';
        list.fields.forEach((f, idx) => {
            const raw = String(row[f.column] ?? '').trim();
            if (raw === '') return;
            any = true;
            if (f.slug === list.title_slug) title = raw;
            if (f.type === 'relation') {
                links.push({ slug: f.slug, raw });
                return;
            }
            const value = readers[idx]!(raw);
            if (value === null) return;
            const seen = uniques.get(f.slug);
            if (seen) {
                const k = fold(raw);
                if (seen.has(k)) {
                    warn({ list: list.name, row: rowNumber, field: f.label, message: `«${raw.slice(0, 60)}» ya está en otro registro (el campo no admite repetidos): la celda quedó vacía.` });
                    return;
                }
                seen.add(k);
            }
            data[f.slug] = value;
        });
        return any ? { row: rowNumber, data, title, links } : null;
    }

    /** Deja sólo `max` registros: primero las listas separadas (son pocas), después las hojas en orden. */
    private cap(resolved: ResolvedImportPlan, byList: Map<string, StagedRecord[]>, max: number): number {
        let room = max;
        let dropped = 0;
        const order = [...resolved.lists.filter((l) => l.source.kind === 'entity'), ...resolved.lists.filter((l) => l.source.kind === 'sheet')];
        for (const l of order) {
            const recs = byList.get(l.key) ?? [];
            const keep = Math.max(0, Math.min(recs.length, room));
            dropped += recs.length - keep;
            byList.set(l.key, recs.slice(0, keep));
            room -= keep;
        }
        return dropped;
    }

    private async create(
        ctx: AiToolContext,
        plan: FileImportPlan,
        resolved: ResolvedImportPlan,
        byList: Map<string, StagedRecord[]>,
        stored: StoredAnalysis,
        groupId: number | undefined,
    ): Promise<Omit<FileImportApplyResult, 'skipped_duplicates' | 'left_out'>> {
        // Nombres que no choquen con listas que ya existen.
        const existing = new Set((await this.lists.list(ctx.tenantId)).map((l) => fold(l.name)));
        const names = new Map<string, string>();
        for (const l of resolved.lists) {
            let name = l.name;
            let n = 2;
            while (existing.has(fold(name))) name = `${l.name.slice(0, 74)} ${n++}`;
            existing.add(fold(name));
            names.set(l.key, name);
        }
        const specs: ListSpec[] = resolved.lists.map((l) => ({
            key: l.key,
            name: names.get(l.key)!,
            icon: l.icon,
            color: l.color,
            title_field: l.title_slug,
            fields: l.fields.map(toFieldSpec) as ListSpec['fields'],
        }));
        const blueprint = await this.structure.buildCreateListBlueprint(ctx, specs);

        // Desde una carpeta: todo nace ahí (las carpetas son de un solo nivel).
        const target = groupId !== undefined && (await this.groups.list(ctx.tenantId)).some((g) => g.id === groupId) ? groupId : null;
        const folder =
            target === null && resolved.lists.length > 1
                ? await this.groups.create(ctx.tenantId, { name: (plan.folder_name?.trim() || resolved.folder_name || stored.file_name).slice(0, 190), color: resolved.lists[0]?.color ?? null })
                : null;
        let materialized: Awaited<ReturnType<BlueprintService['materialize']>>;
        try {
            materialized = await this.blueprints.materialize(ctx.tenantId, ctx.userId, blueprint, { groupId: target ?? folder?.id ?? null, includeRecords: false });
        } catch (err) {
            if (folder) await this.groups.remove(ctx.tenantId, folder.id).catch(() => undefined);
            throw err;
        }

        const listIdByKey = new Map<string, number>();
        resolved.lists.forEach((l, i) => listIdByKey.set(l.key, materialized.lists[i]!.id));
        const fieldsByKey = new Map<string, Map<string, Field>>();
        for (const l of resolved.lists) {
            const created = await this.fields.listByListId(ctx.tenantId, listIdByKey.get(l.key)!);
            fieldsByKey.set(l.key, new Map(created.map((f) => [f.slug, f])));
        }

        const cellWarnings: FileImportCellWarning[] = [];
        let cellWarningsTotal = 0;
        let imported = 0;
        const titleIndex = new Map<string, Map<string, number>>();

        // 1. Los registros de cada lista, validados contra el campo creado.
        for (const l of resolved.lists) {
            const listId = listIdByKey.get(l.key)!;
            const fieldMap = fieldsByKey.get(l.key)!;
            const recs = byList.get(l.key) ?? [];
            const rowsToInsert = recs.map((r) => {
                const data: Record<string, unknown> = {};
                for (const [slug, value] of Object.entries(r.data)) {
                    const field = fieldMap.get(slug);
                    if (!field) continue;
                    const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, value);
                    if (!res.ok) {
                        cellWarningsTotal++;
                        if (cellWarnings.length < MAX_CELL_WARNINGS) cellWarnings.push({ list: l.name, row: r.row, field: field.label, message: res.error });
                        continue;
                    }
                    if (res.value !== null) data[jsonbKeyForField(field.id)] = res.value;
                }
                return data;
            });
            for (let i = 0; i < recs.length; i += INSERT_CHUNK) {
                const chunk = rowsToInsert.slice(i, i + INSERT_CHUNK);
                const inserted = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                    tx
                        .insert(records)
                        .values(chunk.map((data) => ({ tenantId: ctx.tenantId, listId, data, createdBy: ctx.userId })))
                        .returning({ id: records.id }),
                );
                // El RETURNING de un INSERT … VALUES respeta el orden de las filas.
                inserted.forEach((row, j) => {
                    const r = recs[i + j];
                    if (r) r.id = row.id;
                });
            }
            imported += recs.length;
            const index = new Map<string, number>();
            for (const r of recs) {
                const k = fold(r.title);
                if (k !== '' && r.id !== undefined && !index.has(k)) index.set(k, r.id);
            }
            titleIndex.set(l.key, index);
        }

        // 2. Los vínculos: el texto de la celda se busca entre los títulos de la otra lista.
        let linked = 0;
        let unmatched = 0;
        const unmatchedExamples = new Map<string, Set<string>>();
        for (const l of resolved.lists) {
            const fieldMap = fieldsByKey.get(l.key)!;
            const rels = l.fields.filter((f) => f.type === 'relation');
            if (rels.length === 0) continue;
            const pending: Array<{ fieldId: number; source: number; target: number }> = [];
            for (const f of rels) {
                const field = fieldMap.get(f.slug);
                const index = titleIndex.get(f.relation_to ?? '');
                if (!field || !index) continue;
                for (const r of byList.get(l.key) ?? []) {
                    const link = r.links.find((x) => x.slug === f.slug);
                    if (!link || r.id === undefined) continue;
                    const target = index.get(fold(link.raw));
                    if (target === undefined) {
                        unmatched++;
                        const ex = unmatchedExamples.get(f.label) ?? new Set<string>();
                        if (ex.size < 5) ex.add(link.raw.slice(0, 60));
                        unmatchedExamples.set(f.label, ex);
                        continue;
                    }
                    pending.push({ fieldId: field.id, source: r.id, target });
                }
            }
            for (let i = 0; i < pending.length; i += 1000) {
                const chunk = pending.slice(i, i + 1000);
                await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                    tx
                        .insert(relations)
                        .values(chunk.map((p) => ({ tenantId: ctx.tenantId, fieldId: p.fieldId, sourceRecordId: p.source, targetRecordId: p.target, position: 0 })))
                        .onConflictDoNothing(),
                );
            }
            linked += pending.length;
        }

        for (const id of listIdByKey.values()) this.realtime.records(ctx.tenantId, id);

        const warnings = [...materialized.warnings];
        for (const [label, ex] of unmatchedExamples) {
            warnings.push(`Algunos valores de «${label}» no encontraron su registro en la otra lista (por ejemplo: ${[...ex].map((e) => `«${e}»`).join(', ')}): esas celdas quedaron sin vincular.`);
        }
        if (materialized.warnings.length > 0) this.logger.warn(`Crear desde un archivo con avisos (empresa ${ctx.tenantId}): ${materialized.warnings.join(' | ').slice(0, 500)}`);

        return {
            lists: resolved.lists.map((l, i) => ({
                id: materialized.lists[i]!.id,
                slug: materialized.lists[i]!.slug,
                name: materialized.lists[i]!.name,
                key: l.key,
                records: byList.get(l.key)?.length ?? 0,
            })),
            group_id: target ?? folder?.id ?? null,
            imported,
            linked,
            unmatched_links: unmatched,
            warnings,
            cell_warnings: cellWarnings,
            cell_warnings_total: cellWarningsTotal,
        };
    }
}

function sha256(s: string): string {
    return createHash('sha256').update(s).digest('hex');
}

function parseSheet(sheet: { csv: string }): ParsedSheet {
    const p = parseCsv(sheet.csv);
    return { headers: p.headers.map((h) => String(h ?? '')), rows: p.rows.map((r) => r.map((c) => String(c ?? ''))) };
}

/** Las filas de datos tal como las perfiló `profileSheet` (sin las vacías, con el mismo tope). */
function dataRows(p: ParsedSheet, profile: FileImportSheetProfile): string[][] {
    return p.rows.filter((r) => r.some((c) => c.trim() !== '')).slice(0, profile.rows);
}

async function readStored(redis: Redis, key: string): Promise<StoredAnalysis | null> {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as StoredAnalysis;
    } catch {
        return null;
    }
}

/** El campo del plan → el `fieldSpec` del constructor de listas del asistente. */
function toFieldSpec(f: ResolvedImportField): Record<string, unknown> {
    const spec: Record<string, unknown> = { label: f.label, slug: f.slug, type: f.type };
    if (f.options) spec.options = f.options.map((o) => ({ label: o.label, value: o.value, color: o.color }));
    if (f.currency) spec.currency = f.currency;
    if (f.precision !== undefined) spec.precision = f.precision;
    if (f.default_country) spec.default_country = f.default_country;
    if (f.max !== undefined) spec.max = f.max;
    if (f.relation_to) spec.relation_to = f.relation_to;
    if (f.is_unique) spec.is_unique = true;
    if (f.format) spec.validation = { format: f.format };
    return spec;
}
