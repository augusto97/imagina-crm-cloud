import { BadRequestException, Injectable } from '@nestjs/common';
import {
    isDataField,
    jsonbKeyForField,
    validateFieldValue,
    type Field,
    type ImportCsvCellWarning,
    type ImportCsvPreviewResult,
    type ImportCsvRunInput,
    type ImportCsvRunResult,
    type ImportCsvUnmappedColumn,
    type ImportResult,
    type ImportRowError,
    type ImportRowsInput,
    type SelectOption,
} from '@imagina-base/shared';
import { parseCsv } from './csv-parser';
import { cleanNumberString, detectFieldType } from './field-type-detector';
import { BillingService } from '../billing/billing.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RecordsRepository } from '../records/records.repository';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * Import de filas a una lista (CONTRACT §11). Valida cada valor con el
 * validador compartido; las filas inválidas se reportan y NO se insertan (el
 * resto sí). Respeta el límite de records del plan.
 */
@Injectable()
export class ImportService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly billing: BillingService,
        private readonly realtime: RealtimeService,
    ) {}

    async importRows(
        tenantId: number,
        actorId: number,
        listIdOrSlug: string,
        input: ImportRowsInput,
    ): Promise<ImportResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(list.id));
        const byId = new Map(fields.map((f) => [f.id, f]));

        // El mapeo debe apuntar a campos de datos de la lista.
        const columns: Array<{ column: string; field: Field; key: string }> = [];
        for (const [column, fieldId] of Object.entries(input.mapping)) {
            const field = byId.get(fieldId);
            if (!field || !isDataField(field.type)) {
                throw new BadRequestException({
                    code: 'invalid_mapping',
                    message: `El mapeo apunta a un campo inválido (${fieldId})`,
                    data: { status: 400 },
                });
            }
            columns.push({ column, field, key: jsonbKeyForField(field.id) });
        }

        const errors: ImportRowError[] = [];
        const valid: Record<string, unknown>[] = [];

        input.rows.forEach((row, index) => {
            const data: Record<string, unknown> = {};
            let rowOk = true;
            for (const { column, field, key } of columns) {
                const raw = row[column];
                if (raw === undefined || raw === '') continue;
                // validateFieldValue coacciona strings (number/checkbox/date);
                // multi_select necesita array (celda CSV "a,b").
                const value: unknown =
                    field.type === 'multi_select'
                        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
                        : raw;
                const result = validateFieldValue(
                    { type: field.type, config: field.config, is_required: field.is_required },
                    value,
                );
                if (!result.ok) {
                    errors.push({ row: index, field: field.slug, message: result.error });
                    rowOk = false;
                } else if (result.value !== null) {
                    data[key] = result.value;
                }
            }
            if (rowOk) valid.push(data);
        });

        // Límite de plan (SEC-09): el import COMPLETO no debe superar el tope.
        // Se valida el lote entero (count + valid.length), no solo "cabe uno".
        await this.billing.assertCanCreateRecords(tenantId, valid.length);

        if (valid.length > 0) {
            await this.tenantDb.withTenant(tenantId, (tx) =>
                this.recordsRepo.insert(tx, {
                    tenantId,
                    listId: list.id,
                    data: valid[0]!,
                    createdBy: actorId,
                }),
            );
            // Bulk del resto en una sola sentencia.
            if (valid.length > 1) {
                await this.tenantDb.withTenant(tenantId, async (tx) => {
                    const { records } = await import('../db/schema');
                    await tx.insert(records).values(
                        valid.slice(1).map((data) => ({
                            tenantId,
                            listId: list.id,
                            data,
                            createdBy: actorId,
                        })),
                    );
                });
            }
            this.realtime.records(tenantId, list.id);
        }

        return { imported: valid.length, skipped: input.rows.length - valid.length, errors };
    }

    // --- Import CSV en dos pasos (preview + run) ----------------------------
    // Paridad con `Imports/ImportService.php` del plugin: el ImportDialog del
    // fork sube el CSV crudo, el preview sugiere mapping/tipos y el run crea
    // campos on-the-fly, auto-expande opciones de selects e inserta en bulk.

    /** Cuántas filas devolvemos en el preview. */
    private static readonly PREVIEW_ROWS = 20;

    /** Hard cap de filas por run (además del límite de plan). */
    private static readonly MAX_ROWS_PER_RUN = 5000;

    /** Inspecciona el CSV sin escribir nada. */
    async preview(tenantId: number, listIdOrSlug: string, csv: string): Promise<ImportCsvPreviewResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const { headers, rows } = parseCsv(csv);
        if (headers.length === 0) {
            throw new BadRequestException({
                code: 'empty_csv',
                message: 'El CSV está vacío o no se pudo parsear.',
                data: { status: 400 },
            });
        }
        const listFields = await this.importableFields(tenantId, list.id);
        const sample = rows.slice(0, ImportService.PREVIEW_ROWS);

        const suggestedTypes: Record<string, string> = {};
        headers.forEach((_h, idx) => {
            suggestedTypes[String(idx)] = detectFieldType(sample.map((r) => r[idx] ?? ''));
        });

        return {
            headers,
            sample,
            total_rows: rows.length,
            suggested_mapping: suggestMapping(headers, listFields),
            suggested_types: suggestedTypes,
            fields: listFields.map((f) => ({
                id: f.id,
                slug: f.slug,
                label: f.label,
                type: f.type,
                is_required: f.is_required,
            })),
        };
    }

    /**
     * Ejecuta el import CSV. `mapping` es `csv_column_index → field_slug`;
     * `new_fields` crea campos sobre la marcha (columna sin campo destino).
     * Antes de iterar filas se auto-expanden las opciones de selects con los
     * valores del CSV que no existan (ClickUp/Airtable emiten etiquetas
     * humanas, no slugs — sin esto el validador rechazaría todas las filas).
     */
    async runCsv(
        tenantId: number,
        actorId: number,
        listIdOrSlug: string,
        input: ImportCsvRunInput,
    ): Promise<ImportCsvRunResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const parsed = parseCsv(input.csv);
        const headers = parsed.headers;
        let rows = parsed.rows;

        const mapping = new Map<number, string>();
        for (const [k, slug] of Object.entries(input.mapping)) {
            const idx = Number(k);
            if (Number.isInteger(idx) && idx >= 0 && slug !== '') mapping.set(idx, slug);
        }

        // 1. Crear los campos nuevos. Errores de creación → filas virtuales
        //    row=0; la columna queda fuera del mapping.
        const errors: ImportCsvRunResult['errors'] = [];
        const createdFields: ImportCsvRunResult['created_fields'] = [];
        for (const spec of input.new_fields) {
            try {
                const created = await this.fields.create(tenantId, String(list.id), {
                    label: spec.label,
                    type: spec.type,
                });
                mapping.set(spec.csv_column_index, created.slug);
                createdFields.push({ slug: created.slug, label: created.label, type: created.type });
            } catch (err) {
                errors.push({
                    row: 0,
                    message: `No se pudo crear el campo "${spec.label}": ${errMessage(err)}`,
                });
            }
        }

        let listFields = await this.importableFields(tenantId, list.id);

        // 2. Auto-expandir opciones de selects/multi_selects.
        const expandedOptions = await this.expandSelectOptions(tenantId, list.id, rows, mapping, listFields);
        if (Object.keys(expandedOptions).length > 0) {
            listFields = await this.importableFields(tenantId, list.id);
        }
        const bySlug = new Map(listFields.map((f) => [f.slug, f]));

        let truncated = false;
        if (rows.length > ImportService.MAX_ROWS_PER_RUN) {
            rows = rows.slice(0, ImportService.MAX_ROWS_PER_RUN);
            truncated = true;
        }

        // 3. Columnas con datos que quedaron SIN mapping — visibilidad de
        //    pérdida de datos (0.36.5 del plugin).
        const unmappedColumnsWithData: ImportCsvUnmappedColumn[] = [];
        headers.forEach((header, colIdx) => {
            if (mapping.has(colIdx)) return;
            let rowsWithData = 0;
            let sampleCell = '';
            for (const row of rows) {
                const cell = (row[colIdx] ?? '').trim();
                if (cell !== '') {
                    rowsWithData++;
                    if (sampleCell === '') sampleCell = cell.slice(0, 60);
                }
            }
            if (rowsWithData > 0) {
                unmappedColumnsWithData.push({
                    column_index: colIdx,
                    header,
                    rows_with_data: rowsWithData,
                    sample: sampleCell,
                });
            }
        });

        // 4. Coerción + validación por fila. Celdas vacías se omiten del
        //    payload (partial); raw no vacío que coerce a vacío → warning.
        const cellWarnings: ImportCsvCellWarning[] = [];
        const staged: Array<Record<string, unknown>> = [];
        let skipped = 0;

        rows.forEach((row, idx) => {
            const rowNumber = idx + 2; // +1 header, +1 human-friendly.
            const data: Record<string, unknown> = {};
            let rowOk = true;
            for (const [colIdx, slug] of mapping) {
                const field = bySlug.get(slug);
                if (!field) continue;
                const rawCell = row[colIdx] ?? '';
                const rawTrimmed = rawCell.trim();
                const coerced = coerceCellValue(rawCell, field);
                if (coerced === null || coerced === '' || (Array.isArray(coerced) && coerced.length === 0)) {
                    if (rawTrimmed !== '') {
                        cellWarnings.push({
                            row: rowNumber,
                            column_index: colIdx,
                            header: headers[colIdx] ?? '',
                            field_slug: slug,
                            field_label: field.label,
                            field_type: field.type,
                            raw: rawTrimmed.slice(0, 100),
                            reason: 'coerce_empty',
                        });
                    }
                    continue;
                }
                const result = validateFieldValue(
                    { type: field.type, config: field.config, is_required: field.is_required },
                    coerced,
                );
                if (!result.ok) {
                    errors.push({ row: rowNumber, message: `${field.label}: ${result.error}` });
                    rowOk = false;
                    break;
                }
                if (result.value !== null) data[jsonbKeyForField(field.id)] = result.value;
            }
            if (!rowOk || Object.keys(data).length === 0) {
                skipped++;
                return;
            }
            staged.push(data);
        });

        // 5. Límite de plan sobre el LOTE completo (SEC-09) + bulk insert.
        await this.billing.assertCanCreateRecords(tenantId, staged.length);

        const CHUNK = 500;
        for (let i = 0; i < staged.length; i += CHUNK) {
            const chunk = staged.slice(i, i + CHUNK);
            await this.tenantDb.withTenant(tenantId, async (tx) => {
                const { records } = await import('../db/schema');
                await tx.insert(records).values(
                    chunk.map((data) => ({ tenantId, listId: list.id, data, createdBy: actorId })),
                );
            });
        }
        if (staged.length > 0) this.realtime.records(tenantId, list.id);

        return {
            imported: staged.length,
            skipped,
            errors,
            truncated,
            created_fields: createdFields,
            expanded_options: expandedOptions,
            cell_warnings: cellWarnings,
            unmapped_columns_with_data: unmappedColumnsWithData,
        };
    }

    /** Campos importables: los que viven en `records.data` (sin relation/computed). */
    private async importableFields(tenantId: number, listId: number): Promise<Field[]> {
        const all = await this.fields.listByListId(tenantId, listId);
        return all.filter((f) => isDataField(f.type));
    }

    /**
     * Para cada columna mapeada a `select`/`multi_select`, añade al config del
     * campo cualquier etiqueta del CSV que no exista como opción (match
     * case-insensitive contra label Y value). Un solo write por campo.
     */
    private async expandSelectOptions(
        tenantId: number,
        listId: number,
        rows: string[][],
        mapping: Map<number, string>,
        listFields: Field[],
    ): Promise<Record<string, SelectOption[]>> {
        const bySlug = new Map(listFields.map((f) => [f.slug, f]));
        const result: Record<string, SelectOption[]> = {};

        for (const [csvIdx, slug] of mapping) {
            const field = bySlug.get(slug);
            if (!field || (field.type !== 'select' && field.type !== 'multi_select')) continue;

            const rawValues = new Set<string>();
            for (const row of rows) {
                const cell = (row[csvIdx] ?? '').trim();
                if (cell === '') continue;
                if (field.type === 'multi_select') {
                    for (const item of cell.split(/[,;]/)) {
                        const v = item.trim();
                        if (v !== '') rawValues.add(v);
                    }
                } else {
                    rawValues.add(cell);
                }
            }
            if (rawValues.size === 0) continue;

            const existing = readOptions(field);
            const known = new Set<string>();
            const usedSlugs: string[] = [];
            for (const opt of existing) {
                known.add(ciKey(opt.label));
                known.add(ciKey(opt.value));
                usedSlugs.push(opt.value);
            }

            const newOptions: SelectOption[] = [];
            for (const value of rawValues) {
                if (known.has(ciKey(value))) continue;
                const optSlug = makeOptionSlug(value, usedSlugs);
                newOptions.push({ value: optSlug, label: value.slice(0, 190) });
                usedSlugs.push(optSlug);
                known.add(ciKey(value));
                known.add(ciKey(optSlug));
            }
            if (newOptions.length === 0) continue;

            await this.fields.update(tenantId, String(listId), String(field.id), {
                config: { ...field.config, options: [...existing, ...newOptions] },
            });
            result[slug] = newOptions;
        }

        return result;
    }
}

// --- Helpers puros del import CSV -------------------------------------------

function errMessage(err: unknown): string {
    if (err instanceof BadRequestException) {
        const res = err.getResponse();
        if (typeof res === 'object' && res !== null && 'message' in res) return String(res.message);
    }
    return err instanceof Error ? err.message : 'Error.';
}

function readOptions(field: Field): SelectOption[] {
    const raw = (field.config as { options?: unknown }).options;
    if (!Array.isArray(raw)) return [];
    const out: SelectOption[] = [];
    for (const opt of raw) {
        if (opt && typeof opt === 'object') {
            const value = String((opt as { value?: unknown }).value ?? '');
            if (value === '') continue;
            const label = String((opt as { label?: unknown }).label ?? value);
            out.push({ value, label });
        } else if (typeof opt === 'string' && opt !== '') {
            out.push({ value: opt, label: opt });
        }
    }
    return out;
}

/**
 * Convierte el string del CSV al shape que espera `validateFieldValue` para
 * cada tipo. Best-effort: si no parsea, se devuelve el crudo y el validador
 * reporta el error con mensaje por campo.
 */
function coerceCellValue(raw: string, field: Field): unknown {
    const trimmed = raw.trim();
    if (trimmed === '') return field.type === 'multi_select' ? [] : null;

    switch (field.type) {
        case 'select':
            return resolveSelectValue(trimmed, field);
        case 'multi_select':
            return trimmed
                .split(/[,;]/)
                .map((v) => resolveSelectValue(v.trim(), field))
                .filter((v) => v !== '');
        case 'checkbox':
            return ['1', 'true', 'yes', 'sí', 'si', 'x', 'on'].includes(trimmed.toLowerCase());
        case 'number':
        case 'currency': {
            const clean = cleanNumberString(trimmed);
            return clean !== '' && !Number.isNaN(Number(clean)) ? Number(clean) : trimmed;
        }
        case 'user':
        case 'file':
            return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
        case 'date':
        case 'datetime':
            return normalizeDateString(trimmed, field.type);
        default:
            return trimmed;
    }
}

/**
 * Resuelve el valor crudo del CSV (típicamente la etiqueta humana) al `value`
 * de la opción — case-insensitive contra label y value. Sin match devuelve el
 * crudo (el validador lo rechaza; `expandSelectOptions` corre antes y cubre
 * los valores presentes).
 */
function resolveSelectValue(raw: string, field: Field): string {
    if (raw === '') return '';
    const needle = ciKey(raw);
    for (const opt of readOptions(field)) {
        if (ciKey(opt.label) === needle || ciKey(opt.value) === needle) return opt.value;
    }
    return raw;
}

/** Lower-case Unicode-aware ("AL DÍA" ↔ "al día"). */
function ciKey(s: string): string {
    return s.toLocaleLowerCase('es');
}

/**
 * Normaliza fechas a `YYYY-MM-DD` (date) / `YYYY-MM-DD HH:MM:SS` (datetime):
 *  1. ISO → truncado a fecha si el destino es `date` (ClickUp emite
 *     "2024-07-23T00:00:00.000+00:00" para fechas sin hora).
 *  2. `DD/MM/YYYY` o `MM/DD/YYYY`: si el primer grupo > 12 es DD/MM; si el
 *     segundo > 12, MM/DD; ambiguo → DD/MM (locale ES).
 *  3. Fallback `Date.parse` (cubre formatos humanos tipo "May 21st 2026").
 * Sin parse posible → crudo (el validador reporta "Fecha inválida").
 */
export function normalizeDateString(v: string, type: 'date' | 'datetime'): string {
    const iso = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return type === 'date' ? iso[1]! : v;

    const slashed = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(.*)$/);
    if (slashed) {
        const a = Number(slashed[1]);
        const b = Number(slashed[2]);
        let year = Number(slashed[3]);
        if (year < 100) year += 2000;
        const tail = (slashed[4] ?? '').trim();
        let day = a;
        let month = b;
        if (b > 12 && a <= 12) {
            day = b;
            month = a;
        }
        const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return type === 'datetime' && tail !== '' ? `${isoDate} ${tail}` : isoDate;
    }

    const cleaned = v.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
    const ts = Date.parse(cleaned);
    if (!Number.isNaN(ts)) {
        const d = new Date(ts);
        const pad = (n: number): string => String(n).padStart(2, '0');
        const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        return type === 'datetime'
            ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
            : date;
    }
    return v;
}

/**
 * Sugiere `csv_column_index → field_slug` con match difuso (port de
 * `similar_text`, score 0-100, threshold ≥60). Cada slug se usa una sola vez.
 */
function suggestMapping(headers: string[], listFields: Field[]): Record<string, string> {
    const suggestions: Record<string, string> = {};
    const usedSlugs = new Set<string>();
    headers.forEach((header, idx) => {
        let bestSlug: string | null = null;
        let bestScore = 0;
        const normHeader = normalizeKey(header);
        for (const f of listFields) {
            if (usedSlugs.has(f.slug)) continue;
            for (const cand of [normalizeKey(f.slug), normalizeKey(f.label)]) {
                const score = similarityPct(normHeader, cand);
                if (score > bestScore) {
                    bestScore = score;
                    bestSlug = f.slug;
                }
            }
        }
        if (bestSlug !== null && bestScore >= 60) {
            suggestions[String(idx)] = bestSlug;
            usedSlugs.add(bestSlug);
        }
    });
    return suggestions;
}

/** lowercase + sin diacríticos + no-alfanumérico → `_` (como el plugin). */
function normalizeKey(s: string): string {
    const flat = s
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
    return flat.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Port de PHP `similar_text` (% = chars comunes × 200 / suma de largos). */
function similarityPct(a: string, b: string): number {
    if (a.length + b.length === 0) return 0;
    return (similarChars(a, b) * 200) / (a.length + b.length);
}

function similarChars(a: string, b: string): number {
    if (a.length === 0 || b.length === 0) return 0;
    let max = 0;
    let posA = 0;
    let posB = 0;
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
            let k = 0;
            while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
            if (k > max) {
                max = k;
                posA = i;
                posB = j;
            }
        }
    }
    if (max === 0) return 0;
    return (
        max
        + similarChars(a.slice(0, posA), b.slice(0, posB))
        + similarChars(a.slice(posA + max), b.slice(posB + max))
    );
}

/** Slugify para `option.value`, único contra los ya usados (`vencido_2`, …). */
function makeOptionSlug(label: string, usedSlugs: string[]): string {
    let base = normalizeKey(label);
    if (base === '') base = 'option';
    if (!usedSlugs.includes(base)) return base;
    let i = 2;
    while (usedSlugs.includes(`${base}_${i}`)) i++;
    return `${base}_${i}`;
}
