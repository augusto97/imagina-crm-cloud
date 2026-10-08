import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    DOC_MAX_PDF_BYTES,
    FALLBACK_TIME_ZONE,
    applyWordModifiers,
    docAllBlocks,
    docDesignFileIds,
    formatEmailFieldValue,
    groupNumber,
    jsonbKeyForField,
    listRecordsQuerySchema,
    longSpanishDate,
    parseDocDesign,
    parseLooseAmount,
    tenantFormatSchema,
    zonedToday,
    type CreateDocumentTemplateInput,
    type DocBlock,
    type DocDesign,
    type DocImage,
    type DocumentPreviewInput,
    type DocumentPreviewResult,
    type DocumentTemplate,
    type DocumentTemplateSummary,
    type EmailFieldLike,
    type Field,
    type GenerateDocumentInput,
    type GenerateDocumentResult,
    type RecordDto,
    type TenantFormat,
    type UpdateDocumentTemplateInput,
} from '@imagina-base/shared';
import { Readable } from 'node:stream';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { AuditService } from '../audit/audit.service';
import { applyDateModifiers, labelForFieldValue } from '../automations/merge-tags';
import { BillingService } from '../billing/billing.service';
import { safeWebhookFetch } from '../common/safe-fetch';
import type { Tx } from '../db/client';
import { attachments, automations, documentTemplates, memberships, tenants, users } from '../db/schema';
import type { DocumentTemplateRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage';
import { FilesService } from '../files/files.service';
import { ListsService } from '../lists/lists.service';
import type { ThroughPlan } from '../records/through-fields';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { docImageKey, renderDocument, type ItemsTable, type TotalsRowResolved } from './document-render';
import { computeDesignTotals } from './document-totals';

/** Tope por plantillas de una lista (son diseños, no datos). */
const MAX_TEMPLATES_PER_LIST = 50;
/** Una imagen de un documento (logo, firma escaneada). */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export interface RenderedDocument {
    buffer: Buffer;
    filename: string;
    pages: number;
    pageWidth: number;
    pageHeight: number;
    regions: DocumentPreviewResult['regions'];
    recordId: number | null;
    warnings: string[];
    /**
     * Lo que se dibujó, ya formateado: filas de cada tabla de ítems y el
     * valor de cada fila de totales. No viaja al cliente; sirve para los
     * tests (el texto del PDF va en glifos de la fuente embebida).
     */
    content: { items: Record<string, string[][]>; totals: Record<string, string> };
}

export interface RenderRequest {
    tenantId: number;
    actor: Actor;
    listId: number;
    recordId: number | null;
    design: DocDesign;
    filename: string;
    mode: 'real' | 'tags';
    /** Variables extra (`{{pago.link}}` dentro de una automatización). */
    extra?: (token: string) => unknown;
}

/**
 * v0.1.266 (ADR-S35) — Documentos PDF: plantillas por lista + el armado de
 * los datos (registro, ítems vinculados, totales, imágenes) + el render.
 *
 * TODO el armado corre en UNA transacción, que puede ser la de una corrida
 * de automatización (`renderInTx`): así un PDF generado después de un
 * «Actualizar campo» en el mismo run ve el valor nuevo, todavía sin commit.
 * Las lecturas van con el ACL de quien genera: una persona no ve en el PDF
 * campos que le están ocultos (el motor de automatizaciones corre como
 * sistema, igual que el resto de sus acciones).
 */
@Injectable()
export class DocumentsService {
    private readonly logger = new Logger(DocumentsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly files: FilesService,
        @Inject(FILE_STORAGE) private readonly storage: FileStorage,
        private readonly audit: AuditService,
        @Optional() private readonly billing?: BillingService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ── Plantillas (CRUD) ────────────────────────────────────────────────

    async list(tenantId: number, listIdOrSlug: string): Promise<DocumentTemplateSummary[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(documentTemplates)
                .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, list.id)))
                .orderBy(asc(documentTemplates.name), asc(documentTemplates.id)),
        );
        return rows.map((r) => {
            const d = parseDocDesign(r.design);
            return {
                id: r.id,
                list_id: r.listId,
                name: r.name,
                filename: r.filename,
                updated_at: r.updatedAt.toISOString(),
                page_size: d?.theme.page_size ?? 'letter',
                blocks: d?.blocks.length ?? 0,
            };
        });
    }

    async get(tenantId: number, listIdOrSlug: string, id: number): Promise<DocumentTemplate> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.findInTx(tx, tenantId, list.id, id));
        if (!row) throw templateNotFound(id);
        return toDto(row);
    }

    async create(tenantId: number, userId: number, listIdOrSlug: string, input: CreateDocumentTemplateInput): Promise<DocumentTemplate> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const design = this.validDesign(input.design);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const existing = await tx
                .select({ id: documentTemplates.id })
                .from(documentTemplates)
                .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, list.id)));
            if (existing.length >= MAX_TEMPLATES_PER_LIST) {
                throw new BadRequestException({
                    code: 'too_many_templates',
                    message: `Una lista puede tener hasta ${MAX_TEMPLATES_PER_LIST} plantillas de documentos.`,
                    data: { status: 400 },
                });
            }
            const [ins] = await tx
                .insert(documentTemplates)
                .values({
                    tenantId,
                    listId: list.id,
                    name: input.name.trim(),
                    filename: (input.filename ?? '').trim(),
                    design: design as never,
                    createdBy: userId || null,
                })
                .returning();
            return ins!;
        });
        await this.audit.log({
            tenantId,
            userId,
            action: 'document_template.create',
            targetType: 'document_template',
            targetId: row.id,
            targetLabel: row.name,
            meta: { list_id: list.id },
        });
        return toDto(row);
    }

    async update(
        tenantId: number,
        userId: number,
        listIdOrSlug: string,
        id: number,
        input: UpdateDocumentTemplateInput,
    ): Promise<DocumentTemplate> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const patch: Partial<typeof documentTemplates.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.filename !== undefined) patch.filename = input.filename.trim();
        if (input.design !== undefined) patch.design = this.validDesign(input.design) as never;
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [upd] = await tx
                .update(documentTemplates)
                .set(patch)
                .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, list.id), eq(documentTemplates.id, id)))
                .returning();
            return upd ?? null;
        });
        if (!row) throw templateNotFound(id);
        await this.audit.log({
            tenantId,
            userId,
            action: 'document_template.update',
            targetType: 'document_template',
            targetId: row.id,
            targetLabel: row.name,
            meta: { list_id: list.id },
        });
        return toDto(row);
    }

    /**
     * Borrar una plantilla que usa una automatización se RECHAZA con la lista
     * de automatizaciones: si no, la acción quedaría apuntando a la nada y el
     * error aparecería recién cuando corra (mismo criterio que las conexiones).
     */
    async remove(tenantId: number, userId: number, listIdOrSlug: string, id: number): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const removed = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.findInTx(tx, tenantId, list.id, id);
            if (!row) throw templateNotFound(id);
            const used = await this.usedByInTx(tx, tenantId, id);
            if (used.length > 0) {
                throw new ConflictException({
                    code: 'document_template_in_use',
                    message: `La usan estas automatizaciones: ${used.join(', ')}. Sacala de ellas antes de borrarla.`,
                    data: { status: 409, automations: used },
                });
            }
            await tx.delete(documentTemplates).where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.id, id)));
            return row;
        });
        await this.audit.log({
            tenantId,
            userId,
            action: 'document_template.delete',
            targetType: 'document_template',
            targetId: removed.id,
            targetLabel: removed.name,
            meta: { list_id: list.id },
        });
    }

    /** Nombres de las automatizaciones que usan la plantilla (generar o adjuntar). */
    private async usedByInTx(tx: Tx, tenantId: number, templateId: number): Promise<string[]> {
        const rows = await tx
            .select({ name: automations.name, actions: automations.actions })
            .from(automations)
            .where(eq(automations.tenantId, tenantId));
        const uses = (actions: unknown): boolean => {
            if (!Array.isArray(actions)) return false;
            return actions.some((a) => {
                const act = a as { type?: string; config?: Record<string, unknown> };
                const cfg = act?.config ?? {};
                if (act?.type === 'generate_pdf' && Number(cfg.document_template_id) === templateId) return true;
                if (act?.type === 'send_email' && Array.isArray(cfg.pdf_templates) && cfg.pdf_templates.map(Number).includes(templateId)) return true;
                if (act?.type === 'if_else') return uses(cfg.then_actions) || uses(cfg.else_actions);
                return false;
            });
        };
        return rows.filter((r) => uses(r.actions)).map((r) => r.name);
    }

    private validDesign(raw: unknown): DocDesign {
        const design = parseDocDesign(raw);
        if (!design) {
            throw new BadRequestException({
                code: 'invalid_document_design',
                message: 'El diseño del documento no es válido.',
                data: { status: 400 },
            });
        }
        return design;
    }

    private async findInTx(tx: Tx, tenantId: number, listId: number, id: number): Promise<DocumentTemplateRow | null> {
        const [row] = await tx
            .select()
            .from(documentTemplates)
            .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, listId), eq(documentTemplates.id, id)))
            .limit(1);
        return row ?? null;
    }

    /** Plantilla por id en CUALQUIER lista de la empresa (la usa el motor). */
    async findAnyInTx(tx: Tx, tenantId: number, id: number): Promise<DocumentTemplateRow | null> {
        const [row] = await tx
            .select()
            .from(documentTemplates)
            .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.id, id)))
            .limit(1);
        return row ?? null;
    }

    // ── Vista previa y generación ────────────────────────────────────────

    async preview(tenantId: number, actor: Actor, listIdOrSlug: string, input: DocumentPreviewInput): Promise<DocumentPreviewResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const design = this.validDesign(input.design);
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            let recordId: number | null = input.record_id ?? null;
            if (recordId === null && input.mode !== 'tags') {
                const page = await this.records.list(
                    tenantId,
                    actor,
                    String(list.id),
                    listRecordsQuerySchema.parse({ limit: 1, sort_dir: 'desc' }),
                    { tx },
                );
                recordId = page.data[0]?.id ?? null;
            }
            return this.renderInTx(tx, {
                tenantId,
                actor,
                listId: list.id,
                recordId,
                design,
                filename: '',
                mode: input.mode ?? 'real',
            });
        });
        return {
            pdf: out.buffer.toString('base64'),
            bytes: out.buffer.length,
            pages: out.pages,
            page_width: out.pageWidth,
            page_height: out.pageHeight,
            regions: out.regions,
            record_id: out.recordId,
            warnings: out.warnings,
        };
    }

    /**
     * El PDF de un registro con una plantilla guardada (botón de la ficha).
     * Con `save_field`, además queda guardado en ese campo Archivo del
     * registro (cuenta contra el almacenamiento del plan).
     */
    async generateForRecord(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        templateId: number,
        input: GenerateDocumentInput,
    ): Promise<GenerateDocumentResult & { pdf: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rendered = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const tpl = await this.findInTx(tx, tenantId, list.id, templateId);
            if (!tpl) throw templateNotFound(templateId);
            const design = this.validDesign(tpl.design);
            return this.renderInTx(tx, {
                tenantId,
                actor,
                listId: list.id,
                recordId,
                design,
                filename: tpl.filename || tpl.name,
                mode: 'real',
            });
        });
        if (rendered.recordId === null) throw new NotFoundException({ code: 'record_not_found', message: 'Registro no encontrado', data: { status: 404 } });

        let fileId: number | null = null;
        let url: string | null = null;
        if (input.save_field) {
            const fields = await this.fields.listByListId(tenantId, list.id);
            const field = fields.find((f) => f.slug === input.save_field);
            if (!field || field.type !== 'file') {
                throw new BadRequestException({
                    code: 'invalid_save_field',
                    message: 'Elegí un campo de tipo Archivo de esta lista para guardar el PDF.',
                    data: { status: 400 },
                });
            }
            const saved = await this.storePdf(tenantId, actor.userId, rendered.filename, rendered.buffer);
            const current = await this.records.get(tenantId, actor, String(list.id), recordId);
            const prev = current.data[jsonbKeyForField(field.id)];
            const ids = input.save_mode === 'replace' ? [saved.id] : [...fileIdsOf(prev), saved.id];
            try {
                await this.records.update(tenantId, actor, String(list.id), recordId, {
                    data: { [jsonbKeyForField(field.id)]: ids },
                } as never);
            } catch (err) {
                await this.files.remove(tenantId, saved.id).catch(() => undefined);
                throw err;
            }
            fileId = saved.id;
            url = saved.url;
        }
        return {
            filename: rendered.filename,
            bytes: rendered.buffer.length,
            file_id: fileId,
            url,
            pdf: rendered.buffer.toString('base64'),
        };
    }

    /**
     * El PDF de una plantilla GUARDADA para un registro, dentro de la
     * transacción del motor de automatizaciones (ve lo que escribieron las
     * acciones anteriores del mismo run). La plantilla tiene que ser de la
     * lista de la automatización.
     */
    async renderTemplateInTx(
        tx: Tx,
        opts: {
            tenantId: number;
            listId: number;
            recordId: number;
            templateId: number;
            actor: Actor;
            filename?: string;
            extra?: (token: string) => unknown;
        },
    ): Promise<RenderedDocument> {
        const tpl = await this.findAnyInTx(tx, opts.tenantId, opts.templateId);
        if (!tpl) throw new Error(`La plantilla de documento #${opts.templateId} ya no existe: revisá la acción.`);
        if (tpl.listId !== opts.listId) throw new Error(`La plantilla «${tpl.name}» es de otra lista.`);
        const design = parseDocDesign(tpl.design);
        if (!design) throw new Error(`El diseño de «${tpl.name}» no es válido: abrilo en el editor y volvé a guardarlo.`);
        return this.renderInTx(tx, {
            tenantId: opts.tenantId,
            actor: opts.actor,
            listId: opts.listId,
            recordId: opts.recordId,
            design,
            filename: opts.filename?.trim() || tpl.filename || tpl.name,
            mode: 'real',
            extra: opts.extra,
        });
    }

    /** Enlace absoluto y firmado (30 días) a un PDF guardado: `{{pdf.link}}`. */
    fileLink(tenantId: number, fileId: number): string {
        return this.files.absoluteSignedUrl(tenantId, fileId, 30 * 24 * 3600);
    }

    /**
     * Guarda los bytes de un PDF como archivo de la empresa, con la cuota de
     * almacenamiento del plan (si no entra, no se guarda nada).
     */
    async storePdf(tenantId: number, userId: number, filename: string, buffer: Buffer): Promise<{ id: number; url: string }> {
        if (this.billing) await this.billing.assertCanUpload(tenantId, buffer.length);
        const dto = await this.files.upload(tenantId, userId, filename, 'application/pdf', Readable.from(buffer));
        return { id: dto.id, url: dto.url };
    }

    /**
     * Arma y dibuja un documento DENTRO de una transacción abierta. Lo usan la
     * vista previa, el botón de la ficha y la acción de automatización.
     */
    async renderInTx(tx: Tx, req: RenderRequest): Promise<RenderedDocument> {
        const warnings: string[] = [];
        const { tenantId, actor, design } = req;
        const tagsMode = req.mode === 'tags';
        const list = await this.lists.getWithinTx(tx, tenantId, String(req.listId));
        const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
        const plans = await this.fields.through.plans(tx, tenantId, list.id, fields);
        const tenant = await this.tenantInfo(tx, tenantId);
        const format: FormatOpts = { ...tenant.format, timezone: await this.zone(tenantId, tx) };

        const record: RecordDto | null =
            !tagsMode && req.recordId !== null
                ? await this.records.get(tenantId, actor, String(list.id), req.recordId, tx).catch(() => null)
                : null;
        if (!tagsMode && req.recordId !== null && !record) {
            throw new NotFoundException({ code: 'record_not_found', message: 'Registro no encontrado', data: { status: 404 } });
        }

        // Ítems (tablas de registros vinculados).
        const itemSets = new Map<string, LoadedItems>();
        for (const b of design.blocks) {
            if (b.type !== 'items') continue;
            itemSets.set(b.id, await this.loadItems(tx, req, list.id, b, record, tagsMode));
        }

        const bySlug = new Map(fields.map((f) => [f.slug, f]));
        const display = displayFields(fields, plans);
        const userIds = new Set<number>();
        if (record) collectUserIds(fields, record.data, userIds);
        for (const set of itemSets.values()) for (const r of set.raw) collectUserIds(set.fields, r, userIds);
        const userNames = await this.userNames(tx, tenantId, [...userIds]);
        const userName = (id: number): string | null => userNames.get(id) ?? null;

        const rawOf = (slug: string): unknown => {
            const f = bySlug.get(slug);
            return f && record ? record.data[jsonbKeyForField(f.id)] : undefined;
        };
        const formatField = (slug: string, raw: unknown): string => {
            const f = bySlug.get(slug);
            if (!f) return raw === null || raw === undefined ? '' : String(raw);
            return formatValue(display.get(f.id) ?? f, raw, format, userName);
        };

        // Totales primero: el texto puede citarlos ("Son: {{totales.total|pesos}}").
        const itemsTables = new Map<string, ItemsTable>();
        for (const [id, set] of itemSets) {
            itemsTables.set(id, set.table);
        }
        const itemsSum = (blockId: string, slug: string): number | null => itemSets.get(blockId)?.sums.get(slug) ?? null;
        let totalsByRow = new Map<string, number | null>();
        // Las fórmulas de totales usan el prefijo/decimales de su bloque.
        const moneyOf = new Map<string, { prefix: string; decimals: number }>();
        for (const b of design.blocks) if (b.type === 'totals') for (const r of b.rows) moneyOf.set(r.id, { prefix: b.prefix, decimals: b.decimals });
        const resolve = (template: string): string =>
            resolveDocTemplate(template, {
                recordId: record?.id ?? null,
                today: zonedToday(format.timezone || FALLBACK_TIME_ZONE),
                tenantName: tenant.name,
                raw: rawOf,
                format: formatField,
                hasField: (s) => bySlug.has(s),
                field: (s) => {
                    const f = bySlug.get(s);
                    return f ? display.get(f.id) ?? f : undefined;
                },
                totals: (id) => totalsByRow.get(id),
                money: (n, id) => {
                    const m = (id && moneyOf.get(id)) || { prefix: '$ ', decimals: 0 };
                    return `${m.prefix}${groupNumber(n, m.decimals, format.number_format)}`;
                },
                dateFormat: (ymd) => formatValue({ type: 'date' }, ymd, format, userName),
                extra: req.extra,
            });
        const totals = computeDesignTotals(design, {
            itemsSum,
            fieldNumber: (slug) => parseLooseAmount(firstScalar(rawOf(slug))),
            resolve: (t) => (tagsMode ? t : resolve(t)),
        });
        totalsByRow = totals.byRowId;
        const totalsResolved = new Map<string, TotalsRowResolved[]>();
        for (const b of design.blocks) {
            if (b.type !== 'totals') continue;
            const rows = totals.byBlock.get(b.id) ?? [];
            totalsResolved.set(
                b.id,
                rows.map((r) => ({
                    id: r.id,
                    label: r.label,
                    emphasis: r.emphasis,
                    value: tagsMode
                        ? totalsTagValue(b, r.id)
                        : r.text !== null
                          ? r.text
                          : r.num === null
                            ? '—'
                            : `${b.prefix}${groupNumber(r.num, b.decimals, format.number_format)}`,
                })),
            );
        }
        const images = await this.loadImages(tx, tenantId, actor, design, tenant.logoFileId, warnings);

        const filename = sanitizeFilename(tagsMode ? req.filename : resolve(req.filename));
        const out = await renderDocument({
            design,
            resolve: resolve,
            tagsMode,
            fieldLabel: (slug) => bySlug.get(slug)?.label ?? slug,
            fieldValue: (slug) => formatField(slug, rawOf(slug)),
            items: itemsTables,
            totals: totalsResolved,
            images,
            title: filename.replace(/\.pdf$/i, ''),
            author: tenant.appName || tenant.name,
        });
        if (out.buffer.length > DOC_MAX_PDF_BYTES) {
            throw new BadRequestException({
                code: 'document_too_large',
                message: `El PDF pesa ${(out.buffer.length / 1024 / 1024).toFixed(1)} MB: el máximo es ${DOC_MAX_PDF_BYTES / 1024 / 1024} MB. Achicá las imágenes o la tabla de ítems.`,
                data: { status: 400 },
            });
        }
        for (const set of itemSets.values()) if (set.warning) warnings.push(set.warning);
        return {
            buffer: out.buffer,
            filename,
            pages: out.pages,
            pageWidth: out.pageWidth,
            pageHeight: out.pageHeight,
            regions: out.regions,
            recordId: record?.id ?? null,
            warnings,
            content: {
                items: Object.fromEntries([...itemsTables].map(([id, t]) => [id, t.rows])),
                totals: Object.fromEntries([...totalsResolved.values()].flat().map((r) => [r.id, r.value])),
            },
        };
    }

    // ── Datos ─────────────────────────────────────────────────────────────

    private async loadItems(
        tx: Tx,
        req: RenderRequest,
        listId: number,
        b: Extract<DocBlock, { type: 'items' }>,
        record: RecordDto | null,
        tagsMode: boolean,
    ): Promise<LoadedItems> {
        const empty = (notice?: string, warning?: string): LoadedItems => ({
            table: { columns: [], rows: [], notice },
            sums: new Map(),
            raw: [],
            fields: [],
            warning,
        });
        if (!b.source) return empty('Elegí de qué registros vinculados salen las filas.');
        const rel = await this.fields.findAnyByIdWithinTx(tx, req.tenantId, b.source.relation_field_id);
        const target = Number((rel?.config as { target_list_id?: unknown } | undefined)?.target_list_id ?? 0);
        const valid =
            rel &&
            rel.type === 'relation' &&
            (b.source.direction === 'forward'
                ? rel.list_id === listId && target === b.source.list_id
                : rel.list_id === b.source.list_id && target === listId);
        if (!valid) {
            return empty(
                'La relación de esta tabla ya no existe: elegí otra en el editor.',
                `La tabla «${b.title || 'de ítems'}» apunta a una relación que ya no existe.`,
            );
        }
        const itemFields = await this.fields.listByListIdWithinTx(tx, req.tenantId, b.source.list_id);
        const itemPlans = await this.fields.through.plans(tx, req.tenantId, b.source.list_id, itemFields);
        const display = displayFields(itemFields, itemPlans);
        const bySlug = new Map(itemFields.map((f) => [f.slug, f]));
        const cols = b.columns.filter((c) => bySlug.has(c.slug));
        const columns: ItemsTable['columns'] = cols.map((c) => ({
            label: c.label.trim() || bySlug.get(c.slug)!.label,
            align: c.align,
            width: c.width,
        }));
        if (cols.length === 0) {
            return { ...empty('Elegí las columnas de la tabla.'), table: { columns: [], rows: [], notice: 'Elegí las columnas de la tabla.' } };
        }
        if (tagsMode) {
            const row = cols.map((c) => `{{${c.slug}}}`);
            return { table: { columns, rows: [row, row] }, sums: new Map(), raw: [], fields: itemFields };
        }
        if (!record) return { table: { columns, rows: [] }, sums: new Map(), raw: [], fields: itemFields };

        const sortField = b.sort ? bySlug.get(b.sort.slug) : undefined;
        const rawRows: Array<Record<string, unknown>> = [];
        let cursor: number | undefined;
        while (rawRows.length < b.limit) {
            const page = await this.records.list(
                req.tenantId,
                req.actor,
                String(b.source.list_id),
                listRecordsQuerySchema.parse({
                    limit: Math.min(200, b.limit - rawRows.length),
                    ...(sortField ? { sort: `field_${sortField.id}:${b.sort!.dir}` } : {}),
                    ...(cursor !== undefined ? { cursor } : {}),
                }),
                {
                    tx,
                    related: { fieldId: b.source.relation_field_id, recordId: record.id, direction: b.source.direction },
                },
            );
            rawRows.push(...page.data.map((r) => r.data));
            if (!page.meta.next_cursor) break;
            cursor = Number(page.meta.next_cursor);
        }
        const userIds = new Set<number>();
        for (const r of rawRows) collectUserIds(itemFields, r, userIds);
        const names = await this.userNames(tx, req.tenantId, [...userIds]);
        const fmt: FormatOpts = { ...(await this.tenantInfo(tx, req.tenantId)).format, timezone: await this.zone(req.tenantId, tx) };
        const sums = new Map<string, number>();
        const rows = rawRows.map((data) =>
            cols.map((c) => {
                const f = bySlug.get(c.slug)!;
                const raw = data[jsonbKeyForField(f.id)];
                const n = parseLooseAmount(firstScalar(raw));
                if (n !== null && isNumericField(display.get(f.id) ?? f)) sums.set(c.slug, (sums.get(c.slug) ?? 0) + n);
                return formatValue(display.get(f.id) ?? f, raw, fmt, (id) => names.get(id) ?? null);
            }),
        );
        // Sumas también para columnas que la tabla no muestra (un total por una
        // columna oculta sigue sumando).
        for (const f of itemFields) {
            if (sums.has(f.slug) || !isNumericField(display.get(f.id) ?? f)) continue;
            let total = 0;
            let any = false;
            for (const r of rawRows) {
                const n = parseLooseAmount(firstScalar(r[jsonbKeyForField(f.id)]));
                if (n !== null) {
                    total += n;
                    any = true;
                }
            }
            if (any) sums.set(f.slug, total);
        }
        return { table: { columns, rows }, sums, raw: rawRows, fields: itemFields };
    }

    private async loadImages(
        tx: Tx,
        tenantId: number,
        actor: Actor,
        design: DocDesign,
        brandLogo: number | null,
        warnings: string[],
    ): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        const wanted: DocImage[] = [];
        for (const b of docAllBlocks(design)) {
            if (b.type === 'header') wanted.push(b.logo);
            if (b.type === 'image') wanted.push(b.src);
            if (b.type === 'signature') wanted.push(b.image);
        }
        // Archivos: sólo los que quien genera puede ver (ACL del módulo de archivos).
        const fileIds = docDesignFileIds(design);
        if (brandLogo && wanted.some((w) => w.kind === 'brand')) fileIds.push(brandLogo);
        const readable = new Set(
            fileIds.length ? (await this.files.resolve(tenantId, fileIds, actor)).map((a) => a.id) : [],
        );
        // El logo de la marca lo eligió la empresa: vale para cualquiera.
        if (brandLogo) readable.add(brandLogo);
        const rows = readable.size
            ? await tx
                  .select({ id: attachments.id, key: attachments.storageKey, mime: attachments.mime, name: attachments.filename })
                  .from(attachments)
                  .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, [...readable])))
            : [];
        const byId = new Map(rows.map((r) => [r.id, r]));
        const fromBytes = (key: string, bytes: Buffer, label: string): void => {
            const kind = imageKind(bytes);
            if (!kind) {
                warnings.push(`La imagen «${label}» no es PNG ni JPG: en un PDF sólo sirven esos dos formatos.`);
                return;
            }
            out.set(key, `data:image/${kind};base64,${bytes.toString('base64')}`);
        };
        for (const img of wanted) {
            const key = docImageKey(img);
            if (!key || out.has(key)) continue;
            try {
                if (img.kind === 'brand' || img.kind === 'file') {
                    const id = img.kind === 'brand' ? brandLogo : img.file_id;
                    const row = id ? byId.get(id) : undefined;
                    if (!row) {
                        if (img.kind === 'file') warnings.push('Una imagen del documento ya no existe o no tenés acceso a ella.');
                        continue;
                    }
                    const bytes = await readAll(this.storage.read(row.key), MAX_IMAGE_BYTES);
                    if (!bytes) {
                        warnings.push(`La imagen «${row.name}» pesa más de 3 MB.`);
                        continue;
                    }
                    fromBytes(key, bytes, row.name);
                } else if (img.kind === 'url') {
                    const res = await safeWebhookFetch(img.url.trim(), {
                        method: 'GET',
                        headers: { accept: 'image/png,image/jpeg;q=0.9' },
                        captureBody: true,
                        binary: true,
                        maxCaptureBytes: MAX_IMAGE_BYTES,
                        timeoutMs: 8000,
                    });
                    if (res.status !== 200 || !res.bytes || res.truncated) {
                        warnings.push(`No se pudo descargar la imagen ${img.url.trim()} (${res.truncated ? 'pesa más de 3 MB' : `respuesta ${res.status}`}).`);
                        continue;
                    }
                    fromBytes(key, res.bytes, img.url.trim());
                }
            } catch (err) {
                warnings.push(`No se pudo cargar una imagen: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return out;
    }

    private async tenantInfo(
        tx: Tx,
        tenantId: number,
    ): Promise<{ name: string; appName: string | null; format: TenantFormat; logoFileId: number | null }> {
        const [row] = await tx.select({ name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const settings = (row?.settings ?? {}) as Record<string, unknown>;
        const parsed = tenantFormatSchema.safeParse(settings.format ?? {});
        const branding = (settings.branding ?? {}) as Record<string, unknown>;
        const logo = Number(branding.logo_file_id);
        return {
            name: row?.name ?? '',
            appName: typeof branding.app_name === 'string' && branding.app_name.trim() ? branding.app_name.trim() : null,
            format: parsed.success ? parsed.data : tenantFormatSchema.parse({}),
            logoFileId: Number.isInteger(logo) && logo > 0 ? logo : null,
        };
    }

    private async zone(tenantId: number, tx: Tx): Promise<string> {
        return this.timeZones ? this.timeZones.orUtc(tenantId, tx) : FALLBACK_TIME_ZONE;
    }

    private async userNames(tx: Tx, tenantId: number, ids: number[]): Promise<Map<number, string>> {
        if (ids.length === 0) return new Map();
        const rows = await tx
            .select({ id: users.id, name: users.name })
            .from(users)
            .innerJoin(memberships, eq(memberships.userId, users.id))
            .where(and(eq(memberships.tenantId, tenantId), inArray(users.id, ids)));
        return new Map(rows.map((r) => [r.id, r.name]));
    }
}

// ── Helpers puros ───────────────────────────────────────────────────────

interface LoadedItems {
    table: ItemsTable;
    sums: Map<string, number>;
    raw: Array<Record<string, unknown>>;
    fields: Field[];
    warning?: string;
}

type FormatOpts = Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'> & { timezone?: string | null };

function templateNotFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'document_template_not_found', message: `Plantilla #${id} no encontrada`, data: { status: 404 } });
}

function toDto(row: DocumentTemplateRow): DocumentTemplate {
    return {
        id: row.id,
        list_id: row.listId,
        name: row.name,
        filename: row.filename,
        design: (parseDocDesign(row.design) ?? { version: 1, theme: {}, footer: {}, blocks: [] }) as DocumentTemplate['design'],
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

/**
 * Cómo se MUESTRA un campo: un lookup/rollup toma la forma del campo del
 * otro lado (una suma de montos es un monto, una cuenta es un número).
 */
function displayFields(fields: Field[], plans: ThroughPlan[]): Map<number, EmailFieldLike> {
    const out = new Map<number, EmailFieldLike>();
    for (const p of plans) {
        if (p.operation === 'count') out.set(p.field.id, { type: 'number', config: { precision: 0 } });
        else if (p.targetField) out.set(p.field.id, { type: p.targetField.type, config: p.targetField.config });
    }
    for (const f of fields) {
        if (f.type === 'computed' && !out.has(f.id)) {
            const op = (f.config as { operation?: unknown }).operation;
            out.set(f.id, op === 'concat' ? { type: 'text' } : { type: 'number', config: f.config });
        }
    }
    return out;
}

const NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'rating', 'duration']);
function isNumericField(f: EmailFieldLike): boolean {
    return NUMERIC_TYPES.has(f.type);
}

function formatValue(
    f: EmailFieldLike,
    raw: unknown,
    format: FormatOpts,
    userName: (id: number) => string | null,
): string {
    if (Array.isArray(raw) && f.type !== 'multi_select') {
        return raw.map((v) => formatEmailFieldValue(f, v, format, userName)).filter(Boolean).join(', ');
    }
    return formatEmailFieldValue(f, raw, format, userName);
}

function firstScalar(v: unknown): unknown {
    return Array.isArray(v) ? (v.length === 1 ? v[0] : null) : v;
}

function collectUserIds(fields: Field[], data: Record<string, unknown>, into: Set<number>): void {
    for (const f of fields) {
        if (f.type !== 'user') continue;
        const v = data[jsonbKeyForField(f.id)];
        const id = Number(v);
        if (Number.isInteger(id) && id > 0) into.add(id);
    }
}

function fileIdsOf(v: unknown): number[] {
    const arr = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
    return arr.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

function totalsTagValue(b: Extract<DocBlock, { type: 'totals' }>, rowId: string): string {
    const row = b.rows.find((r) => r.id === rowId);
    if (!row) return '—';
    const s = row.source;
    if (s.kind === 'field') return `{{${s.slug}}}`;
    if (s.kind === 'items_sum') return `Σ ${s.slug}`;
    if (s.kind === 'percent') return `${s.pct} %`;
    if (s.kind === 'text') return s.value;
    return 'Σ';
}

function imageKind(bytes: Buffer): 'png' | 'jpeg' | null {
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    return null;
}

async function readAll(stream: Readable, max: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += b.length;
        if (size > max) {
            stream.destroy();
            return null;
        }
        chunks.push(b);
    }
    return Buffer.concat(chunks);
}

/** Nombre de archivo seguro, terminado en `.pdf`. */
export function sanitizeFilename(raw: string): string {
    // eslint-disable-next-line no-control-regex -- quitar caracteres de control ES el punto
    const clean = raw.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    const base = clean.replace(/\.pdf$/i, '').replace(/[.\s]+$/, '').trim();
    return `${base || 'documento'}.pdf`;
}

// ── Variables del documento ─────────────────────────────────────────────

const DOC_TAG_RE = /\{\{\s*([a-zA-Z0-9_.]+)((?:\|(?:[+-]\d+[dmy]|label|value|letras|pesos|mayusculas|larga))*)\s*\}\}/g;

export interface DocTagContext {
    recordId: number | null;
    today: string;
    tenantName: string;
    raw: (slug: string) => unknown;
    format: (slug: string, raw: unknown) => string;
    hasField: (slug: string) => boolean;
    field: (slug: string) => EmailFieldLike | undefined;
    totals: (rowId: string) => number | null | undefined;
    money: (n: number, rowId?: string) => string;
    dateFormat: (ymd: string) => string;
    extra?: (token: string) => unknown;
}

/**
 * Las variables de un DOCUMENTO salen LEGIBLES por defecto (a diferencia de
 * un webhook, donde importa el valor crudo): un monto con sus separadores,
 * una fecha en el formato de la empresa, la etiqueta de la opción. `|value`
 * fuerza el valor crudo; `|letras`/`|pesos`/`|larga`/`|mayusculas` y los
 * corrimientos de fecha (`|+1m`) funcionan igual que en los correos.
 */
export function resolveDocTemplate(template: string, ctx: DocTagContext): string {
    if (!template) return '';
    return template.replace(DOC_TAG_RE, (_m, token: string, modsRaw: string) => {
        const mods = modsRaw ? modsRaw.split('|').filter(Boolean) : [];
        const wantsRaw = mods.includes('value');
        const words = mods.includes('letras') || mods.includes('pesos');
        const dateMods = mods.filter((m) => /^[+-]\d+[dmy]$/.test(m));
        let raw: unknown;
        let readable: (() => string) | null = null;

        if (token === 'record.id') raw = ctx.recordId ?? '';
        else if (token === 'date.today') {
            raw = ctx.today;
            readable = () => ctx.dateFormat(String(raw));
        } else if (token === 'date.now') raw = new Date().toISOString().slice(0, 16).replace('T', ' ');
        else if (token === 'empresa.nombre') raw = ctx.tenantName;
        else if (token.startsWith('totales.')) {
            const id = token.slice('totales.'.length);
            const n = ctx.totals(id);
            raw = n ?? '';
            readable = () => (typeof n === 'number' ? ctx.money(n, id) : '');
        } else if (ctx.hasField(token)) {
            raw = ctx.raw(token);
            const f = ctx.field(token);
            if (mods.includes('label') && f) raw = labelForFieldValue({ type: f.type, config: f.config ?? {} }, raw);
            readable = () => ctx.format(token, raw);
        } else if (ctx.extra) {
            raw = ctx.extra(token);
        } else raw = '';

        if (raw === null || raw === undefined) return '';
        let out: string;
        if (dateMods.length > 0) {
            const shifted = applyDateModifiers(String(raw), `|${dateMods.join('|')}`);
            raw = shifted;
            out = wantsRaw || mods.includes('larga') ? shifted : /^\d{4}-\d{2}-\d{2}/.test(shifted) ? ctx.dateFormat(shifted) : shifted;
        } else if (words || wantsRaw || mods.includes('larga')) {
            out = Array.isArray(raw) ? raw.map(String).join(', ') : String(raw);
        } else {
            out = readable ? readable() : Array.isArray(raw) ? raw.map(String).join(', ') : String(raw);
        }
        if (mods.includes('larga')) out = longSpanishDate(out);
        const wordMods = mods.filter((m) => m === 'letras' || m === 'pesos' || m === 'mayusculas');
        if (wordMods.length) out = applyWordModifiers(out, typeof raw === 'number' ? raw : out, wordMods);
        return out;
    });
}
