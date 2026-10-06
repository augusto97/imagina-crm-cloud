import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import {
    IMPORT_MATCH_BY_ID,
    IMPORT_MATCH_TYPES,
    IMPORT_UPDATE_CHUNK,
    IMPORT_UPDATE_MAX_ROWS,
    readStoreListMarker,
    resolveTitleFieldId,
    roleHasCapability,
    sameBulkValue,
    validateFieldValue,
    type Field,
    type ImportUpdateChange,
    type ImportUpdateInput,
    type ImportUpdatePreview,
    type ImportUpdateResult,
    type List,
} from '@imagina-base/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { records } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BulkHistoryService, type BulkItemInput } from '../records/bulk-history.service';
import { RecordsService, type Actor } from '../records/records.service';
import { storeRuleError } from '../records/store-rule-check';
import { TenantDb } from '../tenancy/tenant-db.service';
import { parseCsv } from './csv-parser';
import { ImportService, coerceCellValue } from './import.service';

const SAMPLE_SIZE = 20;
const ERROR_LIST = 100;

interface RowPlan {
    /** Nº de fila humano (cabecera = 1). */
    row: number;
    key: string;
    recordId: number | null;
    title: string;
    patch: Record<string, unknown>;
    changes: ImportUpdateChange[];
    before: Record<string, unknown>;
    /** Datos completos para crear (sólo `upsert` sin registro). */
    create: Record<string, unknown> | null;
    error: string | null;
}

/**
 * Actualizar registros desde un CSV (v0.1.219): el archivo no crea filas,
 * las EMPAREJA con registros que ya existen por una columna clave —el ID de
 * la app o un campo como el SKU o el email— y cambia sólo las columnas
 * mapeadas. Es la edición masiva por archivo: «la lista de precios del
 * proveedor», «el stock que mandó el depósito».
 *
 * La vista previa y la aplicación calculan con la MISMA función (`plan`)
 * sobre el valor actual de cada registro; escribir pasa por
 * `RecordsService.update` (validación, permisos por fila, bitácora,
 * automatizaciones y, en una lista de la tienda, sus reglas y el envío a
 * WooCommerce) y cada cambio queda en el historial de ediciones masivas, así
 * que una actualización por archivo también se DESHACE (v0.1.218).
 */
@Injectable()
export class ImportUpdateService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly importer: ImportService,
        private readonly history: BulkHistoryService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly billing?: BillingService,
    ) {}

    async preview(tenantId: number, actor: Actor, listIdOrSlug: string, input: ImportUpdateInput): Promise<ImportUpdatePreview> {
        const ctx = await this.context(tenantId, listIdOrSlug, input);
        const plans = await this.plan(tenantId, actor, ctx, input, 0, ctx.rows.length);
        const out: ImportUpdatePreview = {
            total_rows: ctx.rows.length,
            matched: 0,
            changed: 0,
            unchanged: 0,
            unmatched: 0,
            to_create: 0,
            error_count: 0,
            errors: [],
            unmatched_sample: [],
            sample: [],
            truncated: ctx.truncated,
        };
        for (const p of plans) {
            if (p.error) {
                out.error_count++;
                if (out.errors.length < ERROR_LIST) out.errors.push({ row: p.row, message: p.error });
                continue;
            }
            if (p.recordId === null) {
                out.unmatched++;
                if (p.create) out.to_create++;
                else if (out.unmatched_sample.length < SAMPLE_SIZE) out.unmatched_sample.push({ row: p.row, key: p.key });
                continue;
            }
            out.matched++;
            if (p.changes.length === 0) {
                out.unchanged++;
                continue;
            }
            out.changed++;
            if (out.sample.length < SAMPLE_SIZE) out.sample.push({ row: p.row, title: p.title, changes: p.changes });
        }
        return out;
    }

    async apply(tenantId: number, actor: Actor, listIdOrSlug: string, input: ImportUpdateInput): Promise<ImportUpdateResult> {
        const ctx = await this.context(tenantId, listIdOrSlug, input);
        const from = Math.min(input.row_offset, ctx.rows.length);
        const to = Math.min(ctx.rows.length, from + (input.row_limit ?? IMPORT_UPDATE_CHUNK));
        // Opciones de select que el archivo trae y la lista no tiene: se agregan
        // (igual que el import); en una lista de la tienda no — las opciones son
        // de WooCommerce y un valor desconocido se informa por fila. Agregar
        // opciones es cambiar el esquema: sólo con `manage_fields` (igual que el
        // import y el «Crear» del selector); sin ese permiso el valor
        // desconocido queda como error de la fila.
        if (!ctx.store && from === 0 && roleHasCapability(actor.role, 'manage_fields')) {
            const expanded = await this.importer.expandSelectOptions(tenantId, ctx.list.id, ctx.rows, ctx.mapping, ctx.fields);
            if (Object.keys(expanded).length > 0) ctx.fields = await this.importer.importableFields(tenantId, ctx.list.id);
        }
        const plans = await this.plan(tenantId, actor, ctx, input, from, to);
        const result: ImportUpdateResult = { updated: 0, created: 0, unchanged: 0, unmatched: 0, failed: [], edit_id: input.edit_id ?? null };
        const labels = ctx.fields
            .filter((f) => [...ctx.mapping.values()].includes(f.slug))
            .map((f) => f.label)
            .slice(0, 6)
            .join(', ');
        result.edit_id = await this.history.openEdit(
            tenantId,
            actor.userId,
            ctx.list.id,
            'records',
            input.edit_id,
            `Actualización desde archivo: ${labels}`.slice(0, 500),
            [{ op: 'csv_update', match: input.match.by, columns: [...ctx.mapping.values()] }],
        );
        const items: BulkItemInput[] = [];
        let touched = false;
        // Límite del plan UNA vez por tramo (no un conteo por fila creada).
        const toCreate = plans.filter((p) => !p.error && p.recordId === null && p.create).length;
        let planChecked = false;
        if (toCreate > 0 && this.billing) {
            try {
                await this.billing.assertCanCreateRecords(tenantId, toCreate);
                planChecked = true;
            } catch {
                // No entra el tramo entero: se sigue fila por fila para crear
                // hasta el tope y reportar el resto con el motivo.
            }
        }
        for (const p of plans) {
            if (p.error) {
                result.failed.push({ row: p.row, message: p.error });
                continue;
            }
            if (p.recordId === null) {
                if (!p.create) {
                    result.unmatched++;
                    continue;
                }
                try {
                    await this.records.create(tenantId, actor, String(ctx.list.id), { data: p.create }, { planChecked });
                    result.created++;
                    touched = true;
                } catch (err) {
                    result.failed.push({ row: p.row, message: explain(err) });
                }
                continue;
            }
            if (Object.keys(p.patch).length === 0) {
                result.unchanged++;
                continue;
            }
            try {
                const saved = await this.records.update(tenantId, actor, String(ctx.list.id), p.recordId, { data: p.patch }, { silent: true });
                const after: Record<string, unknown> = {};
                for (const key of Object.keys(p.patch)) after[key] = (saved.data as Record<string, unknown>)[key] ?? null;
                items.push({ recordId: p.recordId, title: p.title, before: p.before, after });
                result.updated++;
                touched = true;
            } catch (err) {
                result.failed.push({ row: p.row, message: explain(err) });
            }
        }
        await this.history.addItems(tenantId, result.edit_id, items);
        if (touched) this.realtime.records(tenantId, ctx.list.id);
        return result;
    }

    // ── Detalles ────────────────────────────────────────────────────────────

    private async context(tenantId: number, listIdOrSlug: string, input: ImportUpdateInput) {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const store = readStoreListMarker(list.settings);
        if (store && input.mode === 'upsert') {
            throw new BadRequestException({
                code: 'store_managed',
                message: 'En una lista de la tienda sólo se actualiza: los productos nuevos se crean en WooCommerce.',
                data: { status: 403 },
            });
        }
        const parsed = parseCsv(input.csv);
        if (parsed.headers.length === 0) {
            throw new BadRequestException({ code: 'empty_csv', message: 'El CSV está vacío o no se pudo leer.', data: { status: 400 } });
        }
        const truncated = parsed.rows.length > IMPORT_UPDATE_MAX_ROWS;
        const rows = parsed.rows.slice(0, IMPORT_UPDATE_MAX_ROWS);
        const fields = await this.importer.importableFields(tenantId, list.id);
        const bySlug = new Map(fields.map((f) => [f.slug, f]));

        const matchCol = input.match.column_index;
        if (matchCol >= parsed.headers.length) throw bad('La columna para emparejar no está en el archivo.');
        let keyField: Field | null = null;
        if (input.match.by !== IMPORT_MATCH_BY_ID) {
            keyField = bySlug.get(input.match.by) ?? null;
            if (!keyField || !(IMPORT_MATCH_TYPES as readonly string[]).includes(keyField.type)) {
                throw bad('Para emparejar elegí el ID o una columna de texto, email, teléfono, enlace o número.');
            }
        }
        const mapping = new Map<number, string>();
        for (const [k, slug] of Object.entries(input.mapping)) {
            const idx = Number(k);
            if (!Number.isInteger(idx) || idx < 0 || idx === matchCol) continue;
            if (!bySlug.has(slug)) throw bad(`La columna «${slug}» no existe o no se puede actualizar desde un archivo.`);
            mapping.set(idx, slug);
        }
        if (mapping.size === 0 && input.mode === 'update') throw bad('Elegí al menos una columna para actualizar.');
        return { list, store, rows, truncated, fields, bySlug, mapping, keyField, matchCol };
    }

    /**
     * Qué pasa con cada fila del tramo [from, to): a qué registro va, qué
     * cambia (sólo lo que difiere del valor actual) o por qué no se puede.
     * Las claves repetidas se detectan en TODO el archivo, no sólo en el tramo.
     */
    private async plan(
        tenantId: number,
        actor: Actor,
        ctx: Awaited<ReturnType<ImportUpdateService['context']>>,
        input: ImportUpdateInput,
        from: number,
        to: number,
    ): Promise<RowPlan[]> {
        const keyOf = (row: string[]): string => normalizeKey(ctx.keyField, row[ctx.matchCol] ?? '');
        const firstRowOf = new Map<string, number>();
        ctx.rows.forEach((r, i) => {
            const k = keyOf(r);
            if (k !== '' && !firstRowOf.has(k)) firstRowOf.set(k, i);
        });
        const slice = ctx.rows.slice(from, to);
        const keys = [...new Set(slice.map(keyOf).filter((k) => k !== ''))];
        const found = await this.lookup(tenantId, actor, ctx.list, ctx.keyField, keys);
        const titleId = resolveTitleFieldId(ctx.fields, ctx.list.settings);
        const byId = new Map(ctx.fields.map((f) => [f.id, f]));
        const labelOf = (id: number) => byId.get(id)?.label ?? `#${id}`;

        const members = [...ctx.mapping.values()].some((slug) => ctx.bySlug.get(slug)?.type === 'user')
            ? await this.importer.memberLookup(tenantId)
            : undefined;
        return slice.map((row, i): RowPlan => {
            const index = from + i;
            const rowNumber = index + 2;
            const key = keyOf(row);
            const base: RowPlan = { row: rowNumber, key: (row[ctx.matchCol] ?? '').trim(), recordId: null, title: '', patch: {}, changes: [], before: {}, create: null, error: null };
            if (key === '') return { ...base, error: 'La columna para emparejar está vacía.' };
            if (firstRowOf.get(key) !== index) {
                return { ...base, error: `El mismo valor ya aparece en la fila ${(firstRowOf.get(key) ?? 0) + 2}: cada registro se actualiza una sola vez.` };
            }
            const matches = found.get(key) ?? [];
            if (matches.length > 1) {
                return { ...base, error: `Hay ${matches.length} registros con ese valor: no se sabe cuál actualizar.` };
            }
            // Los valores del archivo, ya convertidos y validados por tipo.
            const values: Record<string, unknown> = {};
            for (const [colIdx, slug] of ctx.mapping) {
                const field = ctx.bySlug.get(slug)!;
                const raw = row[colIdx] ?? '';
                if (raw.trim() === '') {
                    if (input.clear_empty) values[`f${field.id}`] = null;
                    continue;
                }
                const coerced = coerceCellValue(raw, field, members);
                const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, coerced);
                if (!res.ok) return { ...base, error: `${field.label}: ${res.error}` };
                values[`f${field.id}`] = res.value;
            }
            const rec = matches[0];
            if (!rec) {
                if (input.mode !== 'upsert') return base;
                // Crear: con la clave en su campo (si es un campo) para que la
                // próxima vez empareje.
                const data = { ...values };
                if (ctx.keyField) data[`f${ctx.keyField.id}`] = (row[ctx.matchCol] ?? '').trim();
                return { ...base, create: data };
            }
            const patch: Record<string, unknown> = {};
            const before: Record<string, unknown> = {};
            const changes: ImportUpdateChange[] = [];
            for (const [k, v] of Object.entries(values)) {
                const field = byId.get(Number(k.slice(1)))!;
                const cur = rec.data[k] ?? null;
                if (sameBulkValue(cur, v, field.type === 'multi_select')) continue;
                patch[k] = v;
                before[k] = cur;
                changes.push({ label: field.label, before: display(field, cur), after: display(field, v) });
            }
            const title = titleId ? String(rec.data[`f${titleId}`] ?? '').trim() : '';
            const plan: RowPlan = { ...base, recordId: rec.id, title: title !== '' ? title.slice(0, 120) : `Registro #${rec.id}`, patch, before, changes };
            if (ctx.store && changes.length > 0) {
                const err = storeRuleError(ctx.store, labelOf, rec.data, patch);
                if (err) return { ...plan, patch: {}, changes: [], error: err };
            }
            return plan;
        });
    }

    /**
     * Los registros de la lista cuya clave coincide, dentro del alcance de
     * EDICIÓN de la persona (lo que no puede editar no empareja). Por id se va
     * directo; por campo, primero se buscan los candidatos por la expresión
     * normalizada y después se cargan con el mismo filtro de permisos.
     */
    private async lookup(
        tenantId: number,
        actor: Actor,
        list: List,
        keyField: Field | null,
        keys: string[],
    ): Promise<Map<string, Array<{ id: number; data: Record<string, unknown> }>>> {
        const out = new Map<string, Array<{ id: number; data: Record<string, unknown> }>>();
        if (keys.length === 0) return out;
        let ids: number[];
        if (!keyField) {
            ids = keys.map(Number).filter((n) => Number.isInteger(n) && n > 0);
        } else {
            const expr = keyExpr(keyField);
            ids = [];
            for (let i = 0; i < keys.length; i += 1000) {
                const chunk = keys.slice(i, i + 1000);
                const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .select({ id: records.id })
                        .from(records)
                        .where(
                            and(
                                eq(records.tenantId, tenantId),
                                eq(records.listId, list.id),
                                isNull(records.deletedAt),
                                sql`${expr} IN (${sql.join(chunk.map((k) => sql`${k}`), sql`, `)})`,
                            ),
                        ),
                );
                ids.push(...rows.map((r) => r.id));
            }
        }
        if (ids.length === 0) return out;
        const loaded = await this.records.bulkRows(tenantId, actor, String(list.id), { ids: [...new Set(ids)] }, IMPORT_UPDATE_MAX_ROWS * 2);
        for (const row of loaded.rows) {
            const k = keyField ? normalizeKey(keyField, stringify(row.data[`f${keyField.id}`])) : String(row.id);
            if (k === '') continue;
            out.set(k, [...(out.get(k) ?? []), { id: row.id, data: row.data }]);
        }
        return out;
    }
}

/** La clave en una forma comparable: sin espacios ni mayúsculas; el teléfono, sólo dígitos. */
export function normalizeKey(field: Field | null, raw: string): string {
    const s = raw.trim();
    if (s === '') return '';
    if (!field) return /^\d+$/.test(s) ? String(Number(s)) : '';
    if (field.type === 'phone') return s.replace(/\D/g, '');
    if (field.type === 'number') {
        const n = Number(s.replace(',', '.'));
        return Number.isFinite(n) ? String(n) : s.toLowerCase();
    }
    return s.toLocaleLowerCase('es');
}

/** La misma normalización, en SQL (sobre la columna JSONB del campo). */
export function keyExpr(field: Field) {
    const col = sql`(${records.data} ->> ${`f${field.id}`})`;
    if (field.type === 'phone') return sql`regexp_replace(${col}, '[^0-9]', '', 'g')`;
    if (field.type === 'number') return sql`(CASE WHEN ${col} ~ '^-?[0-9.]+$' THEN ((${col})::numeric)::float8::text ELSE lower(${col}) END)`;
    return sql`lower(btrim(${col}))`;
}

function stringify(v: unknown): string {
    if (v === null || v === undefined) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function display(field: Field, v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (field.type === 'select' || field.type === 'multi_select') {
        const opts = Array.isArray((field.config as { options?: unknown }).options)
            ? (field.config as { options: Array<{ value?: unknown; label?: unknown }> }).options
            : [];
        const label = (x: unknown) => String(opts.find((o) => o.value === x)?.label ?? x);
        return Array.isArray(v) ? (v.length === 0 ? '—' : v.map(label).join(', ')) : label(v);
    }
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (Array.isArray(v)) return v.map(String).join(', ');
    return String(v);
}

function bad(message: string): BadRequestException {
    return new BadRequestException({ code: 'import_update_invalid', message, data: { status: 400 } });
}

function explain(err: unknown): string {
    if (err && typeof err === 'object' && 'getResponse' in err && typeof (err as { getResponse: unknown }).getResponse === 'function') {
        const body = (err as { getResponse: () => unknown }).getResponse();
        if (body && typeof body === 'object') {
            const b = body as { message?: unknown; data?: { errors?: Record<string, unknown> } };
            const detail = b.data?.errors ? Object.values(b.data.errors).map(String).join(' · ') : '';
            if (typeof b.message === 'string') return detail ? `${b.message}: ${detail}` : b.message;
        }
    }
    return err instanceof Error ? err.message : 'Error';
}
