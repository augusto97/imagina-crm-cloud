import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    ServiceUnavailableException,
} from '@nestjs/common';
import {
    DOC_MAX_PDF_BYTES,
    FALLBACK_TIME_ZONE,
    applyWordModifiers,
    computeItemsRows,
    describeDocItemExpr,
    docAllBlocks,
    docDesignFileIds,
    docFreezes,
    formatDocNumber,
    isComputedItemColumn,
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
    type DocNumbering,
    type DocumentPreviewInput,
    type DocumentPreviewResult,
    type DocumentTemplate,
    type DocumentTemplateSummary,
    type EmailFieldLike,
    type Field,
    type DocItemsColumn,
    type GenerateDocumentInput,
    type GenerateDocumentResult,
    type IssuedDocument,
    type IssuedDocumentPdf,
    type RecordDto,
    type ReissueDocumentInput,
    type ReissueDocumentResult,
    type TenantFormat,
    type UpdateDocumentTemplateInput,
    type ViewDocumentResult,
} from '@imagina-base/shared';
import { Readable } from 'node:stream';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { AuditService } from '../audit/audit.service';
import { applyDateModifiers, labelForFieldValue } from '../automations/merge-tags';
import { BillingService } from '../billing/billing.service';
import { safeWebhookFetch } from '../common/safe-fetch';
import type { Tx } from '../db/client';
import { attachments, automations, documentNumbers, documentTemplates, fields as fieldsTable, memberships, records as recordsTable, tenants, users } from '../db/schema';
import type { DocumentTemplateRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { FilesService, type StoredFileRef } from '../files/files.service';
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
    /** v0.1.267 — El número del documento ("CC-0042"), si la plantilla numera. */
    number: string | null;
    /** Si el número se EMITIÓ en esta generación (no existía). */
    numberIssued: boolean;
    /**
     * Si el número se escribió además en un campo de texto del registro: la
     * clave (`f{id}`) y el valor. El motor de automatizaciones lo vuelca en su
     * copia del registro para que una acción posterior no lo pise.
     */
    numberField: { key: string; value: string } | null;
    /**
     * v0.1.290 — true = son los bytes del PDF CONGELADO al emitir el número
     * (no se volvió a armar). `pages`/`regions` no aplican.
     */
    frozen: boolean;
    /** v0.1.290 — La fila del número vigente (para «Documentos emitidos»). */
    issuedId: number | null;
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
    /**
     * v0.1.267 — La plantilla guardada (para la numeración). `assign`: emitir
     * el número si el registro todavía no tiene (generar de verdad); sin él,
     * sólo se MIRA el que tiene o el próximo (vista previa).
     */
    template?: { id: number; assign: boolean };
    /**
     * v0.1.290 — Entregar el PDF congelado si el número vigente lo tiene
     * (generar, ver, portal, enlace, automatización). La vista previa del
     * editor NUNCA (arma el diseño en edición).
     */
    useFrozen?: boolean;
    /**
     * v0.1.290 — Dónde anotar los bytes que se guardaron al congelar: si la
     * transacción de quien llama revierte, los descarta (`files.discardBytes`).
     */
    uploads?: StoredFileRef[];
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
        private readonly audit: AuditService,
        @Optional() private readonly billing?: BillingService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ── Plantillas (CRUD) ────────────────────────────────────────────────

    async list(tenantId: number, listIdOrSlug: string): Promise<DocumentTemplateSummary[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const { rows, frozen } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select()
                .from(documentTemplates)
                .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, list.id)))
                .orderBy(asc(documentTemplates.name), asc(documentTemplates.id));
            // v0.1.290 — cuántos PDF congelados tiene cada una (una sola consulta).
            const counts = rows.length
                ? await tx
                      .select({ id: documentNumbers.templateId, n: sql<number>`count(*)::int` })
                      .from(documentNumbers)
                      .where(
                          and(
                              eq(documentNumbers.tenantId, tenantId),
                              inArray(
                                  documentNumbers.templateId,
                                  rows.map((r) => r.id),
                              ),
                              sql`${documentNumbers.fileId} IS NOT NULL`,
                          ),
                      )
                      .groupBy(documentNumbers.templateId)
                : [];
            return { rows, frozen: new Map(counts.map((c) => [c.id, Number(c.n)])) };
        });
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
                portal_visible: r.portalVisible,
                next_number: r.nextNumber,
                next_label: d?.numbering.enabled ? formatDocNumber(nextOf(r.nextNumber, d.numbering), d.numbering) : null,
                freezes: d ? docFreezes(d.numbering) : false,
                frozen_count: frozen.get(r.id) ?? 0,
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
                    portalVisible: input.portal_visible ?? false,
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
        if (input.portal_visible !== undefined) patch.portalVisible = input.portal_visible;
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
            const buttons = await this.usedByButtonsInTx(tx, tenantId, list.id, id);
            if (used.length > 0 || buttons.length > 0) {
                const who = [
                    ...(used.length > 0 ? [`las automatizaciones ${used.join(', ')}`] : []),
                    ...(buttons.length > 0 ? [`los botones ${buttons.map((b) => `«${b}»`).join(', ')}`] : []),
                ];
                throw new ConflictException({
                    code: 'document_template_in_use',
                    message: `La usan ${who.join(' y ')}. Sácala de ahí antes de borrarla.`,
                    data: { status: 409, automations: used, buttons },
                });
            }
            // v0.1.290 — Los PDF congelados de sus documentos emitidos se van
            // con ella (si no, quedarían ocupando espacio sin forma de verlos).
            // Primero los números (la FK de `file_id` es RESTRICT), después los
            // archivos; los bytes, cuando la base ya confirmó.
            const frozen = await tx
                .select({ fileId: documentNumbers.fileId })
                .from(documentNumbers)
                .where(and(eq(documentNumbers.tenantId, tenantId), eq(documentNumbers.templateId, id), sql`${documentNumbers.fileId} IS NOT NULL`));
            const fileIds = frozen.map((f) => f.fileId!).filter((x) => x > 0);
            await tx.delete(documentNumbers).where(and(eq(documentNumbers.tenantId, tenantId), eq(documentNumbers.templateId, id)));
            const refs: StoredFileRef[] = fileIds.length
                ? (
                      await tx
                          .delete(attachments)
                          .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, fileIds)))
                          .returning({ storageKey: attachments.storageKey, storageConnectionId: attachments.storageConnectionId })
                  ).map((r) => ({ storageKey: r.storageKey, storageConnectionId: r.storageConnectionId }))
                : [];
            await tx.delete(documentTemplates).where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.id, id)));
            return { ...row, refs };
        });
        await this.files.discardBytes(tenantId, removed.refs);
        await this.audit.log({
            tenantId,
            userId,
            action: 'document_template.delete',
            targetType: 'document_template',
            targetId: removed.id,
            targetLabel: removed.name,
            meta: { list_id: list.id, frozen_deleted: removed.refs.length },
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

    /** Campo «Botón» — los botones de la lista cuyo «Generar un PDF» usa la plantilla. */
    private async usedByButtonsInTx(tx: Tx, tenantId: number, listId: number, templateId: number): Promise<string[]> {
        const rows = await tx
            .select({ label: fieldsTable.label, config: fieldsTable.config })
            .from(fieldsTable)
            .where(and(eq(fieldsTable.tenantId, tenantId), eq(fieldsTable.listId, listId), eq(fieldsTable.type, 'button'), sql`${fieldsTable.deletedAt} IS NULL`));
        return rows
            .filter((r) => {
                const actions = (r.config as { actions?: unknown } | null)?.actions;
                return Array.isArray(actions) && actions.some((a) => (a as { type?: string })?.type === 'generate_pdf' && Number((a as { document_template_id?: unknown }).document_template_id) === templateId);
            })
            .map((r) => r.label);
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
                // El editor manda la plantilla que edita: así la vista previa
                // muestra el número de verdad (sin consumirlo).
                template: input.template_id ? { id: input.template_id, assign: false } : undefined,
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
        const rendered = await this.withDocTx(tenantId, async (tx, uploads) => {
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
                template: { id: tpl.id, assign: true },
                useFrozen: true,
                uploads,
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
                    message: 'Elige un campo de tipo Archivo de esta lista para guardar el PDF.',
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
            number: rendered.number,
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
            /** v0.1.290 — Bytes guardados al congelar (para descartarlos si el tx revierte). */
            uploads?: StoredFileRef[];
            /**
             * v0.1.290 — false = una PRUEBA («Enviarme una prueba» de un correo):
             * no emite número ni congela (muestra el congelado si ya existe).
             */
            assign?: boolean;
        },
    ): Promise<RenderedDocument> {
        const tpl = await this.findAnyInTx(tx, opts.tenantId, opts.templateId);
        if (!tpl) throw new Error(`La plantilla de documento #${opts.templateId} ya no existe: revisa la acción.`);
        if (tpl.listId !== opts.listId) throw new Error(`La plantilla «${tpl.name}» es de otra lista.`);
        const design = parseDocDesign(tpl.design);
        if (!design) throw new Error(`El diseño de «${tpl.name}» no es válido: ábrelo en el editor y vuelve a guardarlo.`);
        return this.renderInTx(tx, {
            tenantId: opts.tenantId,
            actor: opts.actor,
            listId: opts.listId,
            recordId: opts.recordId,
            design,
            filename: opts.filename?.trim() || tpl.filename || tpl.name,
            mode: 'real',
            extra: opts.extra,
            template: { id: tpl.id, assign: opts.assign ?? true },
            useFrozen: true,
            uploads: opts.uploads,
        });
    }

    /**
     * v0.1.268 — enlace absoluto y firmado (30 días) que ARMA el PDF al
     * abrirlo, sin guardarlo en ningún lado: `{{pdf.link}}` cuando la acción
     * no lo guarda en un campo, y «Copiar enlace» de la ficha. Cada apertura
     * muestra los datos ACTUALES del registro (el número, una vez emitido,
     * no cambia).
     */
    liveLink(tenantId: number, templateId: number, recordId: number, ttlSeconds = LIVE_LINK_TTL): string {
        const now = Math.floor(Date.now() / 1000);
        // Redondeado a la hora: el mismo registro da el mismo enlace un rato.
        const exp = Math.ceil((now + ttlSeconds) / 3600) * 3600;
        const sig = this.files.signParts('doc', tenantId, templateId, recordId, exp);
        return `${this.files.baseUrl}/api/v1/public/documents/${templateId}/${recordId}?tenant=${tenantId}&exp=${exp}&sig=${sig}`;
    }

    /** El PDF de un enlace de `liveLink` (sin sesión). 404 opaco si no cuadra. */
    async renderLiveLink(templateId: number, recordId: number, tenantId: number, exp: number, sig: string): Promise<RenderedDocument> {
        const now = Math.floor(Date.now() / 1000);
        if (
            !Number.isInteger(tenantId) ||
            tenantId <= 0 ||
            !Number.isFinite(exp) ||
            exp < now ||
            !this.files.verifyParts(sig, 'doc', tenantId, templateId, recordId, exp)
        ) {
            throw templateNotFound(templateId);
        }
        const rendered = await this.withDocTx(tenantId, async (tx, uploads) => {
            const tpl = await this.findAnyInTx(tx, tenantId, templateId);
            if (!tpl) throw templateNotFound(templateId);
            const design = this.validDesign(tpl.design);
            return this.renderInTx(tx, {
                tenantId,
                // Como sistema: el enlace lo emitió alguien con acceso (una
                // automatización o la ficha) y la firma es la autorización.
                actor: PORTAL_RENDER_ACTOR,
                listId: tpl.listId,
                recordId,
                design,
                filename: tpl.filename || tpl.name,
                mode: 'real',
                template: { id: tpl.id, assign: true },
                useFrozen: true,
                uploads,
            });
        });
        if (rendered.recordId === null) throw templateNotFound(templateId);
        return rendered;
    }

    /** «Copiar enlace» de la ficha: quien lo pide tiene que poder ver el registro. */
    async linkForRecord(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number, templateId: number): Promise<{ url: string; expires_at: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const tpl = await this.findInTx(tx, tenantId, list.id, templateId);
            if (!tpl) throw templateNotFound(templateId);
        });
        // ACL: 404 si no lo alcanza (mismo camino que abrir la ficha).
        await this.records.get(tenantId, actor, String(list.id), recordId);
        const url = this.liveLink(tenantId, templateId, recordId);
        const exp = Number(new URL(url, 'http://x').searchParams.get('exp'));
        return { url, expires_at: new Date(exp * 1000).toISOString() };
    }

    // ── v0.1.290 — Ver, documentos emitidos y «Anular y emitir de nuevo» ──

    /**
     * «Ver» desde la ficha: el PDF con los datos de ahora (o el congelado, si
     * ya se emitió y congeló) SIN emitir número — revisar no gasta.
     */
    async viewForRecord(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number, templateId: number): Promise<ViewDocumentResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const tpl = await this.findInTx(tx, tenantId, list.id, templateId);
            if (!tpl) throw templateNotFound(templateId);
            return this.renderInTx(tx, {
                tenantId,
                actor,
                listId: list.id,
                recordId,
                design: this.validDesign(tpl.design),
                filename: tpl.filename || tpl.name,
                mode: 'real',
                template: { id: tpl.id, assign: false },
                useFrozen: true,
            });
        });
        return { filename: out.filename, pdf: out.buffer.toString('base64'), number: out.number, issued: out.issuedId !== null, frozen: out.frozen };
    }

    /** Los documentos emitidos (numerados) de un registro, vigentes y anulados. */
    async issuedForRecord(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<IssuedDocument[]> {
        // ACL: quien no ve el registro no ve sus documentos (404 opaco).
        await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        return this.tenantDb.withTenant(tenantId, (tx) => this.issuedInTx(tx, tenantId, recordId));
    }

    /** Lo mismo, dentro de un tx (el bundle de la ficha ya verificó el acceso). */
    async issuedInTx(tx: Tx, tenantId: number, recordId: number, onlyId?: number): Promise<IssuedDocument[]> {
        const frozenUser = alias(users, 'frozen_user');
        const voidUser = alias(users, 'void_user');
        const rows = await tx
            .select({
                n: documentNumbers,
                templateName: documentTemplates.name,
                frozenName: frozenUser.name,
                voidName: voidUser.name,
                bytes: attachments.sizeBytes,
            })
            .from(documentNumbers)
            .innerJoin(documentTemplates, eq(documentTemplates.id, documentNumbers.templateId))
            .leftJoin(frozenUser, eq(frozenUser.id, documentNumbers.frozenBy))
            .leftJoin(voidUser, eq(voidUser.id, documentNumbers.voidedBy))
            .leftJoin(attachments, eq(attachments.id, documentNumbers.fileId))
            .where(
                and(
                    eq(documentNumbers.tenantId, tenantId),
                    eq(documentNumbers.recordId, recordId),
                    ...(onlyId !== undefined ? [eq(documentNumbers.id, onlyId)] : []),
                ),
            )
            .orderBy(desc(documentNumbers.createdAt), desc(documentNumbers.id));
        return rows.map((r) => ({
            id: r.n.id,
            template_id: r.n.templateId,
            template_name: r.templateName,
            record_id: r.n.recordId,
            number: r.n.number,
            label: r.n.label,
            issued_at: r.n.createdAt.toISOString(),
            frozen: r.n.fileId !== null,
            frozen_at: r.n.frozenAt?.toISOString() ?? null,
            frozen_by: r.n.frozenBy,
            frozen_by_name: r.frozenName ?? null,
            bytes: r.bytes ?? null,
            status: r.n.voidedAt ? 'voided' : 'active',
            voided_at: r.n.voidedAt?.toISOString() ?? null,
            voided_by_name: r.voidName ?? null,
            void_reason: r.n.voidReason ?? null,
        }));
    }

    /**
     * Bajar un documento emitido: su PDF congelado (vigente o anulado), o —si
     * no se congeló y sigue vigente— el de ahora con su mismo número.
     */
    async issuedPdf(tenantId: number, actor: Actor, listIdOrSlug: string, numberId: number): Promise<IssuedDocumentPdf> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.issuedRow(tenantId, list.id, numberId);
        await this.records.get(tenantId, actor, String(list.id), row.recordId);
        const out = await this.withDocTx(tenantId, async (tx, uploads) => {
            if (row.fileId !== null) return this.readFrozenInTx(tx, tenantId, row.fileId).then((f) => ({ buffer: f.bytes, filename: f.filename }));
            if (row.voidedAt) {
                throw new ConflictException({
                    code: 'voided_document_without_copy',
                    message: `El documento ${row.label} se anuló y no tiene una copia guardada (no se congeló al emitirlo).`,
                    data: { status: 409 },
                });
            }
            const tpl = await this.findInTx(tx, tenantId, list.id, row.templateId);
            if (!tpl) throw templateNotFound(row.templateId);
            return this.renderInTx(tx, {
                tenantId,
                actor,
                listId: list.id,
                recordId: row.recordId,
                design: this.validDesign(tpl.design),
                filename: tpl.filename || tpl.name,
                mode: 'real',
                template: { id: tpl.id, assign: true },
                useFrozen: true,
                uploads,
            });
        });
        return { filename: out.filename, pdf: out.buffer.toString('base64') };
    }

    /**
     * «Anular y emitir de nuevo» (sólo admin): el número vigente queda ANULADO
     * —conserva su número, que no se reusa, y su PDF— y se emite el siguiente
     * con los datos actuales (congelado si la plantilla congela). Todo en una
     * transacción: si el nuevo no se puede emitir, el anterior sigue vigente.
     */
    async reissue(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        numberId: number,
        input: ReissueDocumentInput,
    ): Promise<ReissueDocumentResult> {
        if (actor.role !== 'admin') {
            throw new ForbiddenException({
                code: 'admin_only',
                message: 'Sólo un administrador puede anular un documento emitido.',
                data: { status: 403 },
            });
        }
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const first = await this.issuedRow(tenantId, list.id, numberId);
        await this.records.get(tenantId, actor, String(list.id), first.recordId);
        const out = await this.withDocTx(tenantId, async (tx, uploads) => {
            // El bloqueo de la plantilla ordena esta anulación con cualquier
            // emisión en curso del mismo documento.
            const [tpl] = await tx
                .select()
                .from(documentTemplates)
                .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, list.id), eq(documentTemplates.id, first.templateId)))
                .for('update');
            if (!tpl) throw templateNotFound(first.templateId);
            const design = this.validDesign(tpl.design);
            if (!design.numbering.enabled) {
                throw new BadRequestException({
                    code: 'numbering_disabled',
                    message: 'La plantilla ya no numera: enciende la numeración para emitir un número nuevo.',
                    data: { status: 400 },
                });
            }
            const voided = await tx
                .update(documentNumbers)
                .set({ voidedAt: new Date(), voidedBy: actor.userId > 0 ? actor.userId : null, voidReason: input.reason?.trim() || null })
                .where(and(eq(documentNumbers.tenantId, tenantId), eq(documentNumbers.id, numberId), isNull(documentNumbers.voidedAt)))
                .returning({ id: documentNumbers.id });
            if (voided.length === 0) {
                throw new ConflictException({ code: 'already_voided', message: `El documento ${first.label} ya estaba anulado.`, data: { status: 409 } });
            }
            const rendered = await this.renderInTx(tx, {
                tenantId,
                actor,
                listId: list.id,
                recordId: first.recordId,
                design,
                filename: tpl.filename || tpl.name,
                mode: 'real',
                template: { id: tpl.id, assign: true },
                useFrozen: true,
                uploads,
            });
            const [voidedDto] = await this.issuedInTx(tx, tenantId, first.recordId, numberId);
            const [issuedDto] = rendered.issuedId !== null ? await this.issuedInTx(tx, tenantId, first.recordId, rendered.issuedId) : [];
            if (!issuedDto) throw new ServiceUnavailableException({ code: 'reissue_failed', message: 'No se pudo emitir el número nuevo.', data: { status: 503 } });
            return { rendered, voided: voidedDto!, issued: issuedDto };
        });
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'document.reissue',
            targetType: 'record',
            targetId: first.recordId,
            targetLabel: `${out.voided.label} → ${out.issued.label}`,
            meta: { list_id: list.id, template_id: first.templateId, voided: out.voided.label, issued: out.issued.label, reason: input.reason ?? null },
        });
        return { voided: out.voided, issued: out.issued, filename: out.rendered.filename, pdf: out.rendered.buffer.toString('base64') };
    }

    /** Un número emitido de una plantilla de ESTA lista (404 si no). */
    private async issuedRow(tenantId: number, listId: number, numberId: number) {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: documentNumbers.id,
                    templateId: documentNumbers.templateId,
                    recordId: documentNumbers.recordId,
                    label: documentNumbers.label,
                    fileId: documentNumbers.fileId,
                    voidedAt: documentNumbers.voidedAt,
                })
                .from(documentNumbers)
                .innerJoin(documentTemplates, eq(documentTemplates.id, documentNumbers.templateId))
                .where(and(eq(documentNumbers.tenantId, tenantId), eq(documentNumbers.id, numberId), eq(documentTemplates.listId, listId)))
                .limit(1),
        );
        if (!row) {
            throw new NotFoundException({ code: 'issued_document_not_found', message: `Documento emitido #${numberId} no encontrado`, data: { status: 404 } });
        }
        return row;
    }

    /** v0.1.290 — Descarta bytes guardados al congelar en un tx que revirtió (motor). */
    async discardUploads(tenantId: number, refs: readonly StoredFileRef[]): Promise<void> {
        await this.files.discardBytes(tenantId, refs);
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
        // v0.1.268 (ADR-S36) — con almacenamiento propio no hay cupo del plan.
        if (this.billing && !(await this.files.uploadsExternally(tenantId))) {
            await this.billing.assertCanUpload(tenantId, buffer.length);
        }
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

        let record: RecordDto | null =
            !tagsMode && req.recordId !== null
                ? await this.records.get(tenantId, actor, String(list.id), req.recordId, tx).catch(() => null)
                : null;
        if (!tagsMode && req.recordId !== null && !record) {
            throw new NotFoundException({ code: 'record_not_found', message: 'Registro no encontrado', data: { status: 404 } });
        }

        // v0.1.267 — El número del documento: el que ya tiene el registro, o
        // se EMITE ahora (generar de verdad) o se mira el próximo (vista previa).
        const numbering = await this.documentNumber(tx, tenantId, design.numbering, req.template, record, fields, warnings);
        // Si el número se acaba de escribir en un campo, el documento lo
        // muestra ya (el registro se leyó antes de emitirlo).
        if (record && numbering.field) record = { ...record, data: { ...record.data, [numbering.field.key]: numbering.field.value } };
        if (!design.numbering.enabled && JSON.stringify(design).includes('documento.numero')) {
            warnings.push('El documento usa {{documento.numero}} pero la numeración está apagada: enciéndela en «Hoja y estilo».');
        }
        // v0.1.290 — Ya emitido y CONGELADO: se entrega ese PDF tal cual, aunque
        // el registro haya cambiado (es la copia fiel de lo que se emitió).
        if (req.useFrozen && record && numbering.fileId !== null) {
            return this.frozenDocument(tx, tenantId, record.id, numbering);
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
                    return formatMoney(n, m.prefix, m.decimals, format.number_format);
                },
                dateFormat: (ymd) => formatValue({ type: 'date' }, ymd, format, userName),
                docNumber: numbering.label,
                extra: req.extra,
            });
        const totals = computeDesignTotals(design, {
            itemsSum,
            fieldNumber: (slug) => parseLooseAmount(firstScalar(rawOf(slug))),
            resolve: (t) => (tagsMode ? t : resolve(t)),
        });
        totalsByRow = totals.byRowId;
        const totalsResolved = new Map<string, TotalsRowResolved[]>();
        // Todas las filas formateadas (también las ocultas): para los tests.
        const totalsContent: Record<string, string> = {};
        for (const b of design.blocks) {
            if (b.type !== 'totals') continue;
            const rows = totals.byBlock.get(b.id) ?? [];
            const drawn: TotalsRowResolved[] = [];
            for (const r of rows) {
                const value = tagsMode
                    ? totalsTagValue(b, r.id)
                    : r.text !== null
                      ? r.text
                      : r.num === null
                        ? '—'
                        : formatMoney(r.num, b.prefix, b.decimals, format.number_format);
                if (!(r.id in totalsContent)) totalsContent[r.id] = value;
                // v0.1.290 — Las filas ocultas (y las en cero con «ocultar si da
                // 0») no se dibujan; en el modo variables del editor se ven
                // todas menos las ocultas a propósito.
                const def = b.rows.find((x) => x.id === r.id);
                if (tagsMode ? def?.hidden === true : r.hidden) continue;
                drawn.push({ id: r.id, label: tagsMode ? r.label : resolve(r.label), emphasis: r.emphasis, value });
            }
            totalsResolved.set(b.id, drawn);
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
                message: `El PDF pesa ${(out.buffer.length / 1024 / 1024).toFixed(1)} MB: el máximo es ${DOC_MAX_PDF_BYTES / 1024 / 1024} MB. Achica las imágenes o la tabla de ítems.`,
                data: { status: 400 },
            });
        }
        for (const set of itemSets.values()) if (set.warning) warnings.push(set.warning);
        // v0.1.290 — Congelar: la primera vez que el documento sale de verdad
        // con su número (o el primero después de encender la opción). Va en
        // la MISMA transacción que emitió el número: si el PDF no se puede
        // guardar (cupo del plan, almacenamiento caído), falla todo y el
        // número queda libre.
        let frozen = false;
        if (req.template?.assign && record && numbering.rowId !== null && numbering.fileId === null && docFreezes(design.numbering)) {
            await this.freezeInTx(tx, req, numbering.rowId, filename, out.buffer);
            frozen = true;
        }
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
                totals: totalsContent,
            },
            number: numbering.label,
            numberIssued: numbering.issued,
            numberField: numbering.field,
            frozen,
            issuedId: numbering.rowId,
        };
    }

    /**
     * v0.1.290 — Guarda el PDF recién emitido como archivo (en el almacenamiento
     * que eligió la empresa: el servidor —cuenta para el plan— o el suyo) y lo
     * ata al número. Dentro del tx del que emite; los bytes se anotan en
     * `req.uploads` para descartarlos si ese tx revierte.
     */
    private async freezeInTx(tx: Tx, req: RenderRequest, numberId: number, filename: string, buffer: Buffer): Promise<void> {
        const { tenantId } = req;
        try {
            if (this.billing && !(await this.files.uploadsExternally(tenantId))) {
                await this.billing.assertCanUpload(tenantId, buffer.length);
            }
            const saved = await this.files.storeBufferInTx(tx, tenantId, req.actor.userId, filename, 'application/pdf', buffer);
            req.uploads?.push(saved.ref);
            await tx
                .update(documentNumbers)
                .set({ fileId: saved.id, frozenAt: new Date(), frozenBy: req.actor.userId > 0 ? req.actor.userId : null })
                .where(and(eq(documentNumbers.tenantId, tenantId), eq(documentNumbers.id, numberId)));
        } catch (err) {
            const message = `No se pudo emitir el documento: no se pudo guardar su PDF congelado (${errorText(err)}). El número no se usó.`;
            const status = err instanceof HttpException ? err.getStatus() : 503;
            if (status === 403) throw new ForbiddenException({ code: 'document_freeze_failed', message, data: { status } });
            throw new ServiceUnavailableException({ code: 'document_freeze_failed', message, data: { status: 503 } });
        }
    }

    /** v0.1.290 — El PDF congelado de un número emitido (sus bytes, tal cual). */
    private async frozenDocument(tx: Tx, tenantId: number, recordId: number, numbering: IssuedNumber): Promise<RenderedDocument> {
        const file = await this.readFrozenInTx(tx, tenantId, numbering.fileId!);
        return {
            buffer: file.bytes,
            filename: file.filename,
            pages: 0,
            pageWidth: 0,
            pageHeight: 0,
            regions: [],
            recordId,
            warnings: [],
            content: { items: {}, totals: {} },
            number: numbering.label,
            numberIssued: false,
            numberField: null,
            frozen: true,
            issuedId: numbering.rowId,
        };
    }

    /** Los bytes de un PDF congelado. Si no se pueden leer, FALLA (nunca se rearma en silencio). */
    private async readFrozenInTx(tx: Tx, tenantId: number, fileId: number): Promise<{ bytes: Buffer; filename: string }> {
        const [row] = await tx
            .select({ key: attachments.storageKey, conn: attachments.storageConnectionId, name: attachments.filename })
            .from(attachments)
            .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, fileId)))
            .limit(1);
        if (!row) {
            throw new ServiceUnavailableException({
                code: 'frozen_document_missing',
                message: 'El PDF congelado de este documento ya no está guardado. Anúlalo y emítelo de nuevo.',
                data: { status: 503 },
            });
        }
        let bytes: Buffer | null;
        try {
            bytes = await readAll(await this.files.readStream(tenantId, { storageKey: row.key, storageConnectionId: row.conn }), DOC_MAX_PDF_BYTES * 2);
        } catch (err) {
            throw new ServiceUnavailableException({
                code: 'frozen_document_unreadable',
                message: `No se pudo leer el PDF congelado: ${errorText(err)}`,
                data: { status: 503 },
            });
        }
        if (!bytes) {
            throw new ServiceUnavailableException({ code: 'frozen_document_unreadable', message: 'El PDF congelado es demasiado grande.', data: { status: 503 } });
        }
        return { bytes, filename: row.name };
    }

    /**
     * v0.1.290 — Corre `fn` en una transacción de la empresa y, si revierte,
     * descarta los bytes que se guardaron al congelar (un storage no es
     * transaccional: sin esto quedarían archivos sin dueño).
     */
    private async withDocTx<T>(tenantId: number, fn: (tx: Tx, uploads: StoredFileRef[]) => Promise<T>): Promise<T> {
        const uploads: StoredFileRef[] = [];
        try {
            return await this.tenantDb.withTenant(tenantId, (tx) => fn(tx, uploads));
        } catch (err) {
            await this.files.discardBytes(tenantId, uploads);
            throw err;
        }
    }

    /**
     * v0.1.267 — Numeración consecutiva. Un registro recibe UN número por
     * plantilla, la primera vez que su documento se genera de verdad, y lo
     * conserva: volver a bajarlo da el mismo. La plantilla se BLOQUEA (`FOR
     * UPDATE`) mientras se emite: dos generaciones a la vez esperan su turno y
     * no se repite ni se salta ningún número; si la transacción revierte (una
     * automatización que falla después), el número tampoco queda gastado.
     */
    private async documentNumber(
        tx: Tx,
        tenantId: number,
        numbering: DocNumbering,
        template: RenderRequest['template'],
        record: RecordDto | null,
        fields: Field[],
        warnings: string[],
    ): Promise<IssuedNumber> {
        const none = (label: string | null): IssuedNumber => ({ label, issued: false, field: null, rowId: null, fileId: null });
        if (!numbering.enabled) return none(null);
        // Sin plantilla guardada (un diseño nuevo en el editor): el primero.
        if (!template) return none(formatDocNumber(numbering.start, numbering));
        // v0.1.290 — El número VIGENTE (los anulados son historia).
        const existing = async (): Promise<IssuedNumber | null> => {
            if (!record) return null;
            const [row] = await tx
                .select({ id: documentNumbers.id, label: documentNumbers.label, fileId: documentNumbers.fileId })
                .from(documentNumbers)
                .where(and(eq(documentNumbers.templateId, template.id), eq(documentNumbers.recordId, record.id), isNull(documentNumbers.voidedAt)))
                .limit(1);
            return row ? { label: row.label, issued: false, field: null, rowId: row.id, fileId: row.fileId } : null;
        };
        const already = await existing();
        if (already !== null) return already;
        if (!record || !template.assign) {
            const [tpl] = await tx
                .select({ next: documentTemplates.nextNumber })
                .from(documentTemplates)
                .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.id, template.id)))
                .limit(1);
            return none(formatDocNumber(nextOf(tpl?.next ?? 1, numbering), numbering));
        }
        // Emitir: bloquear la plantilla y volver a mirar (otra generación pudo
        // emitirlo mientras esperábamos el bloqueo).
        const [locked] = await tx
            .select({ next: documentTemplates.nextNumber })
            .from(documentTemplates)
            .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.id, template.id)))
            .for('update');
        if (!locked) return none(null);
        const raced = await existing();
        if (raced !== null) return raced;
        const n = nextOf(locked.next, numbering);
        const label = formatDocNumber(n, numbering);
        const [ins] = await tx
            .insert(documentNumbers)
            .values({ tenantId, templateId: template.id, recordId: record.id, number: n, label })
            .returning({ id: documentNumbers.id });
        await tx
            .update(documentTemplates)
            .set({ nextNumber: n + 1 })
            .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.id, template.id)));
        // Además, en un campo de texto del registro (para verlo y filtrarlo en
        // la lista). En la MISMA transacción: el número queda guardado si y
        // sólo si se emitió.
        let field: { key: string; value: string } | null = null;
        if (numbering.save_field) {
            const f = fields.find((x) => x.slug === numbering.save_field);
            if (!f || (f.type !== 'text' && f.type !== 'long_text')) {
                warnings.push(`El número no se guardó en «${numbering.save_field}»: elige un campo de texto de esta lista.`);
            } else {
                await tx
                    .update(recordsTable)
                    .set({
                        data: sql`jsonb_set(coalesce(${recordsTable.data}, '{}'::jsonb), ${`{${jsonbKeyForField(f.id)}}`}::text[], to_jsonb(${label}::text))`,
                        updatedAt: new Date(),
                    })
                    .where(and(eq(recordsTable.tenantId, tenantId), eq(recordsTable.id, record.id)));
                field = { key: jsonbKeyForField(f.id), value: label };
            }
        }
        return { label, issued: true, field, rowId: ins!.id, fileId: null };
    }

    // ── Portal del cliente ───────────────────────────────────────────────

    /** v0.1.267 — Los documentos que el cliente puede bajar desde su portal. */
    async portalDocumentsInTx(tx: Tx, tenantId: number, listId: number): Promise<Array<{ id: number; name: string }>> {
        return tx
            .select({ id: documentTemplates.id, name: documentTemplates.name })
            .from(documentTemplates)
            .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, listId), eq(documentTemplates.portalVisible, true)))
            .orderBy(asc(documentTemplates.name), asc(documentTemplates.id));
    }

    /**
     * v0.1.267 — El PDF que baja el cliente desde su portal: SÓLO de su
     * registro y SÓLO de una plantilla que la empresa marcó como visible en el
     * portal. Se arma como sistema (igual que una automatización): lo que
     * muestra lo decidió la empresa al diseñarla y publicarla. Bajarlo emite
     * el número si todavía no tenía (es el documento de verdad).
     */
    async renderForPortal(tenantId: number, listId: number, recordId: number, templateId: number): Promise<RenderedDocument> {
        return this.withDocTx(tenantId, async (tx, uploads) => {
            const tpl = await this.findInTx(tx, tenantId, listId, templateId);
            if (!tpl || !tpl.portalVisible) throw templateNotFound(templateId);
            const design = this.validDesign(tpl.design);
            return this.renderInTx(tx, {
                tenantId,
                actor: PORTAL_RENDER_ACTOR,
                listId,
                recordId,
                design,
                filename: tpl.filename || tpl.name,
                mode: 'real',
                template: { id: tpl.id, assign: true },
                useFrozen: true,
                uploads,
            });
        });
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
        if (!b.source) return empty('Elige de qué registros vinculados salen las filas.');
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
                'La relación de esta tabla ya no existe: elige otra en el editor.',
                `La tabla «${b.title || 'de ítems'}» apunta a una relación que ya no existe.`,
            );
        }
        const itemFields = await this.fields.listByListIdWithinTx(tx, req.tenantId, b.source.list_id);
        const itemPlans = await this.fields.through.plans(tx, req.tenantId, b.source.list_id, itemFields);
        const display = displayFields(itemFields, itemPlans);
        const bySlug = new Map(itemFields.map((f) => [f.slug, f]));
        // v0.1.290 — Columnas de campo, CALCULADAS (sin campo detrás) y las
        // marcadoras de la galería ("[Precio unitario]": falta elegir el campo,
        // se ven tal cual). Las ocultas se calculan y suman pero no se dibujan.
        const cols = b.columns.filter((c) => isComputedItemColumn(c) || bySlug.has(c.slug) || isPlaceholderSlug(c.slug));
        const drawn = cols.filter((c) => !c.hidden);
        const labelOf = (slug: string): string => bySlug.get(slug)?.label ?? cols.find((c) => c.slug === slug)?.label ?? slug.replace(/^\[|\]$/g, '');
        const columns: ItemsTable['columns'] = drawn.map((c) => ({
            label: c.label.trim() || labelOf(c.slug),
            align: c.align,
            width: c.width,
        }));
        if (drawn.length === 0) {
            return { ...empty('Elige las columnas de la tabla.'), table: { columns: [], rows: [], notice: 'Elige las columnas de la tabla.' } };
        }
        if (tagsMode) {
            const row = drawn.map((c) =>
                isComputedItemColumn(c) ? `= ${describeDocItemExpr(c.expr, labelOf)}` : isPlaceholderSlug(c.slug) ? c.slug : `{{${c.slug}}}`,
            );
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
        // v0.1.290 — Las columnas calculadas de cada fila (el total de la
        // línea), con la MISMA función que prueba shared.
        const calc = computeItemsRows(
            cols,
            rawRows.map((data) => (slug: string) => {
                const f = bySlug.get(slug);
                return f ? parseLooseAmount(firstScalar(data[jsonbKeyForField(f.id)])) : null;
            }),
        );
        const rows = rawRows.map((data, i) =>
            drawn.map((c) => {
                if (isComputedItemColumn(c)) {
                    const v = calc.values[i]?.get(c.slug) ?? null;
                    return v === null ? '—' : formatComputedCell(v, c, fmt.number_format);
                }
                if (isPlaceholderSlug(c.slug)) return c.slug;
                const f = bySlug.get(c.slug)!;
                const raw = data[jsonbKeyForField(f.id)];
                const n = parseLooseAmount(firstScalar(raw));
                const numeric = isNumericField(display.get(f.id) ?? f);
                if (n !== null && numeric) sums.set(c.slug, (sums.get(c.slug) ?? 0) + n);
                // v0.1.290 — Un formato elegido en la columna pisa el del campo.
                if (c.format && n !== null && numeric) return formatComputedCell(n, c, fmt.number_format);
                return formatValue(display.get(f.id) ?? f, raw, fmt, (id) => names.get(id) ?? null);
            }),
        );
        // Las sumas de las calculadas (de los valores ya redondeados por línea).
        for (const [slug, total] of calc.sums) sums.set(slug, total);
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
                  .select({
                      id: attachments.id,
                      key: attachments.storageKey,
                      conn: attachments.storageConnectionId,
                      mime: attachments.mime,
                      name: attachments.filename,
                  })
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
                        if (img.kind === 'file') warnings.push('Una imagen del documento ya no existe o no tienes acceso a ella.');
                        continue;
                    }
                    const bytes = await readAll(
                        await this.files.readStream(tenantId, { storageKey: row.key, storageConnectionId: row.conn }),
                        MAX_IMAGE_BYTES,
                    );
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

/** v0.1.290 — El número de un documento: el vigente, el emitido ahora o el próximo. */
interface IssuedNumber {
    label: string | null;
    /** Se emitió en esta generación (no existía). */
    issued: boolean;
    field: { key: string; value: string } | null;
    /** La fila del número VIGENTE (null = no hay: vista previa o sin numeración). */
    rowId: number | null;
    /** Su PDF congelado (null = todavía no se congeló). */
    fileId: number | null;
}

function errorText(err: unknown): string {
    if (err instanceof HttpException) {
        const res = err.getResponse();
        const msg = typeof res === 'object' && res !== null ? (res as { message?: unknown }).message : res;
        if (typeof msg === 'string' && msg !== '') return msg;
    }
    return err instanceof Error ? err.message : String(err);
}

/** Un monto con el prefijo y el signo ADELANTE: "-$ 30.000" (no "$ -30.000"). */
export function formatMoney(n: number, prefix: string, decimals: number, numberFormat: TenantFormat['number_format']): string {
    const text = groupNumber(Math.abs(n), decimals, numberFormat);
    return n < 0 ? `-${prefix}${text}` : `${prefix}${text}`;
}

/** El valor de una columna calculada con su formato (moneda, número o %). */
function formatComputedCell(n: number, c: DocItemsColumn, numberFormat: TenantFormat['number_format']): string {
    const decimals = c.decimals ?? 2;
    if (c.format === 'percent') return `${groupNumber(n, decimals, numberFormat)} %`;
    if (c.format === 'number') return groupNumber(n, decimals, numberFormat);
    return formatMoney(n, c.prefix ?? '$ ', decimals, numberFormat);
}

/** Una columna marcadora de la galería ("[Precio unitario]"): falta elegir su campo. */
function isPlaceholderSlug(slug: string): boolean {
    return /^\[.+\]$/.test(slug);
}

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

/** El próximo número: nunca por debajo del inicio elegido. */
function nextOf(next: number, numbering: Pick<DocNumbering, 'start'>): number {
    return Math.max(next, numbering.start);
}

/**
 * Quien "genera" el PDF que baja el cliente del portal: el sistema, como en
 * una automatización (userId 0 → los archivos y vínculos se leen sin el ACL
 * de una persona del equipo).
 */
const PORTAL_RENDER_ACTOR: Actor = { userId: 0, role: 'admin' };
/** Vida del enlace que arma el PDF al abrirlo (v0.1.268). */
const LIVE_LINK_TTL = 30 * 24 * 3600;

function toDto(row: DocumentTemplateRow): DocumentTemplate {
    return {
        id: row.id,
        list_id: row.listId,
        name: row.name,
        filename: row.filename,
        design: (parseDocDesign(row.design) ?? { version: 1, theme: {}, footer: {}, numbering: {}, blocks: [] }) as DocumentTemplate['design'],
        portal_visible: row.portalVisible,
        next_number: row.nextNumber,
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
    /** v0.1.267 — `{{documento.numero}}` ("CC-0042"); null si no numera. */
    docNumber?: string | null;
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
        else if (token === 'documento.numero') raw = ctx.docNumber ?? '';
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
