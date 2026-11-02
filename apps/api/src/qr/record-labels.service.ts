import { BadRequestException, Injectable } from '@nestjs/common';
import {
    LABEL_MAX,
    LABEL_PRESETS,
    MAX_RECORDS_LIMIT,
    SCAN_SEARCH_FIELD_TYPES,
    fitLabelText,
    formatEmailFieldValue,
    labelInnerLayout,
    labelSlots,
    pickScanField,
    resolveTitleFieldId,
    type BulkEditTarget,
    type Field,
    type LabelPresetKey,
    type ListRecordsQuery,
    type RecordDto,
    type RecordLabelsInput,
    type TenantFormat,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { memberships, users } from '../db/schema';
import { renderPdfDefinition } from '../documents/document-render';
import { sanitizeFilename } from '../documents/documents.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { readTenantFormat } from '../tenancy/tenant-format';
import { recordLinkPrefix } from './qr-runtime';

/** Lo que se imprime en una etiqueta (ya resuelto y legible). */
export interface LabelItem {
    /** Lo que guarda el QR (un enlace o un código). */
    qr: string;
    title: string;
    lines: string[];
    /** El código escrito debajo ('' = no se muestra). */
    code: string;
}

type Node = Record<string, unknown>;

/** Tipos que se pueden poner como dato en una etiqueta (lo que se lee en una línea). */
const PRINTABLE = new Set([
    'text',
    'long_text',
    'email',
    'url',
    'phone',
    'number',
    'currency',
    'percent',
    'rating',
    'duration',
    'date',
    'datetime',
    'select',
    'multi_select',
    'checkbox',
    'user',
    'autonumber',
    'computed',
    'formula',
    'lookup',
    'rollup',
    'created_at',
    'updated_at',
    'created_by',
    'updated_by',
]);

/**
 * v0.1.344 — El PDF de etiquetas con QR: cada etiqueta en su lugar exacto de
 * la hoja (las medidas de `LABEL_PRESETS`, en puntos), el QR vectorial que
 * dibuja pdfmake (nítido a cualquier tamaño de impresión) y el texto recortado
 * para que nunca se salga de la etiqueta adhesiva. Puro: lo prueban los tests
 * sin base ni servidor.
 */
export function buildLabelsDefinition(presetKey: LabelPresetKey, items: LabelItem[], skip = 0): Node {
    const p = LABEL_PRESETS[presetKey];
    const slots = labelSlots(presetKey);
    const perPage = slots.length;
    const lay = labelInnerLayout(p.labelW, p.labelH);
    const offset = p.kind === 'sheet' ? Math.min(Math.max(0, skip), perPage - 1) : 0;
    const content: Node[] = [];
    items.forEach((item, i) => {
        const pos = i + offset;
        const slotIndex = pos % perPage;
        if (pos > 0 && slotIndex === 0) content.push({ text: '', pageBreak: 'before' });
        const slot = slots[slotIndex]!;
        const qrX = lay.direction === 'row' ? slot.x + lay.pad : slot.x + (slot.w - lay.qr) / 2;
        const qrY = lay.direction === 'row' ? slot.y + (slot.h - lay.qr) / 2 : slot.y + lay.pad;
        if (item.qr) {
            content.push({ qr: item.qr.slice(0, 1000), fit: lay.qr, eccLevel: 'M', foreground: '#111111', absolutePosition: { x: qrX, y: qrY } });
        }
        const text = textBlock(item, lay);
        if (text.length > 0) {
            const tx = slot.x + lay.text.x;
            const ty = slot.y + lay.text.y;
            content.push({
                columns: [{ width: lay.text.w, stack: text }],
                absolutePosition: { x: tx, y: ty },
            });
        }
    });
    if (content.length === 0) content.push({ text: '' });
    return {
        pageSize: { width: p.pageW, height: p.pageH },
        pageMargins: [0, 0, 0, 0],
        info: { title: 'Etiquetas', creator: 'Etiquetas QR' },
        defaultStyle: { font: 'Roboto', fontSize: lay.lineSize, color: '#111111', lineHeight: 1.1 },
        content,
    };
}

/** Las líneas de texto de una etiqueta, sin pasarse del alto disponible. */
function textBlock(item: LabelItem, lay: ReturnType<typeof labelInnerLayout>): Node[] {
    const centered = lay.direction === 'column';
    const align = centered ? 'center' : 'left';
    const out: Array<{ node: Node; height: number }> = [];
    if (item.title) {
        out.push({
            node: { text: fitLabelText(item.title, lay.text.w, lay.titleSize, 2), fontSize: lay.titleSize, bold: true, alignment: align },
            // Dos renglones como mucho.
            height: lay.titleSize * 1.25 * Math.min(2, Math.ceil(item.title.length / Math.max(4, Math.floor(lay.text.w / (lay.titleSize * 0.52))))),
        });
    }
    for (const line of item.lines) {
        if (!line) continue;
        out.push({
            node: { text: fitLabelText(line, lay.text.w, lay.lineSize, 1), fontSize: lay.lineSize, color: '#333333', alignment: align, margin: [0, 1, 0, 0] },
            height: lay.lineSize * 1.25 + 1,
        });
    }
    if (item.code) {
        out.push({
            node: { text: fitLabelText(item.code, lay.text.w, lay.codeSize, 1), fontSize: lay.codeSize, color: '#555555', alignment: align, margin: [0, 2, 0, 0] },
            height: lay.codeSize * 1.25 + 2,
        });
    }
    // Lo que no entra se cae desde abajo (los datos antes que el título).
    let total = out.reduce((s, x) => s + x.height, 0);
    while (out.length > 1 && total > lay.text.h) {
        const dropAt = item.code && out.length > 1 ? out.length - 2 : out.length - 1;
        const [removed] = out.splice(Math.max(0, dropAt), 1);
        total -= removed?.height ?? 0;
    }
    return out.map((x) => x.node);
}

@Injectable()
export class RecordLabelsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly records: RecordsService,
        private readonly fields: FieldsService,
        private readonly lists: ListsService,
    ) {}

    /** El PDF de etiquetas de los registros pedidos (con el ACL de quien pide). */
    async pdf(tenantId: number, actor: Actor, listIdOrSlug: string, input: RecordLabelsInput): Promise<{ filename: string; buffer: Buffer; count: number }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const settings = (list.settings ?? {}) as Record<string, unknown>;
        const fields = await this.fields.listByListId(tenantId, list.id);
        const rows = await this.collect(tenantId, actor, list.slug, input.target);
        if (rows.length === 0) {
            throw new BadRequestException({
                code: 'labels_empty',
                message: 'No hay registros para imprimir: revisa la selección o los filtros de la vista.',
                data: { status: 400 },
            });
        }
        const format = await readTenantFormat(this.tenantDb, tenantId);
        const byId = new Map(fields.map((f) => [f.id, f]));
        const lineFields = input.field_ids.map((id) => byId.get(id)).filter((f): f is Field => !!f && PRINTABLE.has(f.type));
        const names = lineFields.some((f) => f.type === 'user' || f.type === 'created_by' || f.type === 'updated_by')
            ? await this.memberNames(tenantId)
            : new Map<number, string>();
        const titleId = resolveTitleFieldId(fields, settings);
        const chosen = input.code_field_id !== null ? byId.get(input.code_field_id) : undefined;
        const codeField = chosen && (SCAN_SEARCH_FIELD_TYPES as readonly string[]).includes(chosen.type) ? chosen : pickScanField(fields, settings);
        const prefix = await recordLinkPrefix(tenantId, list.slug);

        const items: LabelItem[] = rows.map((r) => {
            const data = (r.data ?? {}) as Record<string, unknown>;
            const raw = (id: number | null | undefined): string => {
                if (!id) return '';
                const v = data[`f${id}`];
                return v === null || v === undefined ? '' : Array.isArray(v) ? v.map(String).join(', ') : String(v).trim();
            };
            const link = prefix ? `${prefix}${r.id}` : '';
            const code = raw(codeField?.id);
            const qr = input.content === 'field' ? code || link : link;
            const title = input.show_title ? raw(titleId) || `Registro #${r.id}` : '';
            const lines = lineFields.map((f) => readable(f, data[`f${f.id}`], format, names)).filter((s) => s !== '');
            const codeText = !input.show_code ? '' : code || (input.content === 'link' ? `#${r.id}` : '');
            return { qr, title, lines, code: codeText };
        });
        const def = buildLabelsDefinition(input.preset, items, input.skip);
        const buffer = await renderPdfDefinition(def);
        return { filename: sanitizeFilename(`Etiquetas - ${list.name}`), buffer, count: items.length };
    }

    /** Los registros pedidos, en el orden de la selección (o el de la vista), con el ACL de quien pide. */
    private async collect(tenantId: number, actor: Actor, listSlug: string, target: BulkEditTarget): Promise<RecordDto[]> {
        if ('ids' in target) {
            const ids = [...new Set(target.ids)];
            if (ids.length > LABEL_MAX) throw tooMany(ids.length);
            const found = new Map<number, RecordDto>();
            for (let i = 0; i < ids.length; i += MAX_RECORDS_LIMIT) {
                const chunk = ids.slice(i, i + MAX_RECORDS_LIMIT);
                const page = await this.records.list(tenantId, actor, listSlug, {
                    ids: chunk.join(','),
                    limit: MAX_RECORDS_LIMIT,
                    include_subtasks: true,
                    sort_dir: 'asc',
                } as ListRecordsQuery);
                for (const r of page.data) found.set(r.id, r);
            }
            return ids.map((id) => found.get(id)).filter((r): r is RecordDto => !!r);
        }
        const out: RecordDto[] = [];
        for (let page = 1; out.length <= LABEL_MAX; page++) {
            const res = await this.records.list(tenantId, actor, listSlug, {
                filter_tree: target.filter_tree,
                search: target.search,
                include_subtasks: target.include_subtasks,
                limit: MAX_RECORDS_LIMIT,
                page,
                sort_dir: 'asc',
            } as ListRecordsQuery);
            if (page === 1 && (res.meta.total ?? 0) > LABEL_MAX) throw tooMany(res.meta.total ?? 0);
            out.push(...res.data);
            if (res.data.length < MAX_RECORDS_LIMIT) break;
        }
        return out.slice(0, LABEL_MAX);
    }

    private async memberNames(tenantId: number): Promise<Map<number, string>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: users.id, name: users.name, email: users.email })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(eq(memberships.tenantId, tenantId)),
        );
        return new Map(rows.map((u) => [u.id, u.name && u.name.trim() !== '' ? u.name : u.email]));
    }
}

function tooMany(total: number): BadRequestException {
    return new BadRequestException({
        code: 'labels_too_many',
        message: `Son ${total} registros y un PDF de etiquetas lleva hasta ${LABEL_MAX}. Acota con filtros e imprime en partes.`,
        data: { status: 400, total, cap: LABEL_MAX },
    });
}

/** El valor como se lee en la ficha (monto con separadores, fecha de la empresa, etiqueta de la opción). */
function readable(field: Field, value: unknown, format: TenantFormat, names: Map<number, string>): string {
    if (value === null || value === undefined || value === '') return '';
    return formatEmailFieldValue({ type: field.type, config: (field.config ?? {}) as Record<string, unknown> }, value, format, (id) => names.get(id) ?? null).trim();
}
