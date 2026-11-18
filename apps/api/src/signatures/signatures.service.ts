import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    brandingSchema,
    formatBookingWhen,
    isSmsProvider,
    jsonbKeyForField,
    maskEmail,
    maskPhone,
    resolveTitleFieldId,
    signatureCodeText,
    signatureConsentText,
    signaturePhoneLooksValid,
    signatureVerifyNeedsPhone,
    signatureOnCompleteSchema,
    signedFilename,
    signersDue,
    SIGNATURE_MAX_PDF_BYTES,
    tenantFormatSchema,
    whatsappCodeTemplateCheck,
    type CreateSignatureRequestInput,
    type DeclineSignatureInput,
    type Field,
    type FieldType,
    type List,
    type PortalSignature,
    type PublicSignatureDto,
    type SignatureCodeChannel,
    type SignatureCodeSent,
    type SignatureEvent,
    type SignatureEventInfo,
    type SignatureOnComplete,
    type SignatureRequestDto,
    SIGNATURE_STATUS_LABELS,
    type SignatureRequestStatus,
    type SignatureVerify,
    type SignatureVerifyTemplate,
    type SignerDto,
    type SignerStatus,
    type SubmitSignatureInput,
    type VoidSignatureRequestInput,
} from '@imagina-base/shared';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { AutomationDispatcher, type AutomationChain } from '../automations/automation-dispatcher.service';
import { can } from '../authz/can';
import { publicSurfaceOff, tenantAccessInTx } from '../billing/tenant-access';
import { rateKeyForIp } from '../common/client-ip';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { attachments, connections, documentNumbers, documentTemplates, records, signatureRequests, signatureSigners, tenants, users, whatsappTemplates, type SignatureRequestRow, type SignatureSignerRow } from '../db/schema';
import { renderPlainPdfDefinition } from '../documents/document-render';
import { DocumentsService } from '../documents/documents.service';
import { DomainsService } from '../domains/domains.service';
import { FieldsService } from '../fields/fields.service';
import { fileIdsIn, FilesService, type StoredFileRef } from '../files/files.service';
import { listRowInScope } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { NotifyHub } from '../notifications/notify-hub';
import { senderName, type PortalEmailBrand } from '../portal/portal-email';
import { SmsService } from '../sms/sms.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService, type Actor } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { incrWithTtl } from '../redis/redis.util';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { buildSignedPdf, constanciaDefinition, pdfPageCount, sha256Hex, SignaturePdfError, stampText, type ConstanciaSigner } from './signature-pdf';
import { signatureCodeEmail, signatureEmail, type SignatureMailKind } from './signature-email';

/**
 * D6 (v0.1.446, ADR-S107) — Firma electrónica de documentos.
 *
 * Una SOLICITUD es un PDF de un registro (una plantilla de documento de la
 * lista, o un PDF de un campo Archivo) que firman una o varias personas por un
 * enlace PERSONAL. Reglas que no se negocian:
 *
 * - El PDF que se firma es una COPIA guardada al pedir la firma (su huella
 *   SHA-256 es lo que firma cada persona): borrar o cambiar el archivo del
 *   registro después no cambia lo firmado.
 * - El enlace de cada persona es `firmante-HMAC(empresa, solicitud, firmante,
 *   versión)`: no se puede adivinar, y ANULAR sube la versión (los enlaces
 *   viejos dejan de servir).
 * - Con «código por correo», firmar exige el código de 6 números que llega a
 *   SU correo (Redis, 10 min, 5 intentos, se consume al firmar).
 * - Cuando firman todos, en UNA transacción: se arma la constancia, se sella
 *   cada página del original, se guarda el PDF firmado y la solicitud queda
 *   «Firmado». Lo que pasa en el registro (guardar el PDF en un campo, cambiar
 *   un estado, poner la fecha) va después y no deshace la firma si falla.
 */

const SYSTEM_ACTOR: Actor = { userId: 0, role: 'admin' };
const CODE_TTL_S = 600;
const CODE_MAX_TRIES = 5;
const CODES_PER_SIGNER_HOUR = 5;
const PUBLIC_HITS_PER_IP = 240;
const PUBLIC_WINDOW_S = 600;
const MAX_REMINDERS = 3;
const MAX_ATTACH_BYTES = 8 * 1024 * 1024;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type PublicCtx = { signer: SignatureSignerRow; request: SignatureRequestRow };

interface Brand extends PortalEmailBrand {
    timeZone: string;
    timeFormat: 'h24' | 'h12';
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'signature_not_found', message: 'Esta solicitud de firma no existe o ya no está disponible.', data: { status: 404 } });
}

function linkGone(message: string, code = 'signature_closed'): GoneException {
    return new GoneException({ code, message, data: { status: 410 } });
}

function tooMany(message: string): HttpException {
    return new HttpException({ code: 'too_many_requests', message, data: { status: 429 } }, HttpStatus.TOO_MANY_REQUESTS);
}

function bad(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

function iso(d: Date | null | undefined): string | null {
    return d ? d.toISOString() : null;
}

function verifyCodeGen(): string {
    let out = '';
    for (let i = 0; i < 10; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return `${out.slice(0, 5)}-${out.slice(5)}`;
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

/**
 * Lo que recibe `create`: el input validado por Zod, con lo de v0.1.448
 * (celular por persona, conexión y plantilla del código) opcional para los
 * llamadores internos que arman el objeto a mano.
 */
export type CreateSignatureArgs = Omit<CreateSignatureRequestInput, 'signers' | 'verify_connection_id' | 'verify_template'> & {
    signers: Array<Omit<CreateSignatureRequestInput['signers'][number], 'phone'> & { phone?: string }>;
    verify_connection_id?: number | null;
    verify_template?: SignatureVerifyTemplate | null;
};

@Injectable()
export class SignaturesService {
    private readonly logger = new Logger(SignaturesService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly files: FilesService,
        private readonly documents: DocumentsService,
        private readonly activity: ActivityService,
        private readonly audit: AuditService,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        @Optional() private readonly mail?: MailService,
        @Optional() private readonly notify?: NotifyHub,
        @Optional() private readonly domains?: DomainsService,
        @Optional() private readonly realtime?: RealtimeService,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() private readonly dispatcher?: AutomationDispatcher,
        @Optional() private readonly sms?: SmsService,
        @Optional() private readonly whatsapp?: WhatsappService,
    ) {}

    // ─────────────────────────── Enlaces ───────────────────────────

    private token(r: Pick<SignatureRequestRow, 'tenantId' | 'id' | 'linkVersion'>, signerId: number): string {
        return `${signerId}-${this.files.signParts('sign', r.tenantId, r.id, signerId, r.linkVersion).slice(0, 40)}`;
    }

    private async base(tenantId: number): Promise<string> {
        if (this.domains) {
            try {
                return (await this.domains.baseUrlFor(tenantId, 'app')).replace(/\/+$/, '');
            } catch {
                /* al de la plataforma */
            }
        }
        return this.env.APP_BASE_URL.replace(/\/+$/, '');
    }

    private signUrl(base: string, r: Pick<SignatureRequestRow, 'tenantId' | 'id' | 'linkVersion'>, signerId: number): string {
        return `${base}/firmar/${this.token(r, signerId)}`;
    }

    private verifyUrl(base: string, code: string): string {
        return `${base}/api/v1/public/sign/verify/${encodeURIComponent(code)}`;
    }

    /** El enlace público → firmante y solicitud. Todo lo que no cuadra da el mismo 404. */
    private async resolveToken(token: string): Promise<PublicCtx> {
        const m = /^(\d{1,15})-([0-9a-f]{40})$/.exec(String(token ?? ''));
        if (!m) throw notFound();
        const signerId = Number(m[1]);
        const [row] = await this.db
            .select({ signer: signatureSigners, request: signatureRequests })
            .from(signatureSigners)
            .innerJoin(signatureRequests, eq(signatureRequests.id, signatureSigners.requestId))
            .where(eq(signatureSigners.id, signerId))
            .limit(1);
        if (!row) throw notFound();
        const expected = this.token(row.request, signerId).split('-')[1]!;
        const a = Buffer.from(m[2]!, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (a.length !== b.length || !timingSafeEqual(a, b)) throw notFound();
        return { signer: row.signer, request: row.request };
    }

    private async limitIp(ip: string | undefined, kind: string, max = PUBLIC_HITS_PER_IP): Promise<void> {
        try {
            const n = await incrWithTtl(this.redis, `sign:${kind}:${rateKeyForIp(ip)}`, PUBLIC_WINDOW_S);
            if (n > max) throw tooMany('Demasiados pedidos. Vuelve a intentarlo en unos minutos.');
        } catch (err) {
            if (err instanceof HttpException) throw err;
            // Sin Redis el freno no tapa la firma.
        }
    }

    // ─────────────────────────── Marca y formato ───────────────────────────

    private async brand(tenantId: number): Promise<Brand & { company: string; logoFileId: number | null }> {
        const [row] = await this.db.select({ name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const settings = (row?.settings ?? {}) as Record<string, unknown>;
        const b = brandingSchema.safeParse(settings.branding ?? {});
        const branding = b.success ? b.data : brandingSchema.parse({});
        const f = tenantFormatSchema.safeParse(settings.format ?? {});
        const format = f.success ? f.data : tenantFormatSchema.parse({});
        const company = (branding.app_name ?? row?.name ?? '').trim();
        const tz = (await this.timeZones?.orUtc(tenantId).catch(() => 'UTC')) ?? 'UTC';
        return {
            name: company,
            company,
            color: branding.primary_color,
            logoFileId: branding.logo_file_id ?? null,
            logoUrl: branding.logo_file_id ? this.files.absoluteSignedUrl(tenantId, branding.logo_file_id, 30 * 24 * 3600) : null,
            timeZone: tz,
            timeFormat: format.time_format === 'h12' ? 'h12' : 'h24',
        };
    }

    private when(b: Pick<Brand, 'timeZone' | 'timeFormat'>, isoStr: string): string {
        return formatBookingWhen(isoStr, b.timeZone, b.timeFormat, { weekday: false });
    }

    // ─────────────────────────── Personas del equipo ───────────────────────────

    private async userNames(tx: Tx, ids: number[]): Promise<Map<number, string>> {
        const wanted = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
        if (wanted.length === 0) return new Map();
        const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, wanted));
        return new Map(rows.map((r) => [r.id, (r.name ?? '').trim() || r.email]));
    }

    // ─────────────────────────── Ficha: lo que se puede mandar a firmar ───────────────────────────

    private async assertCanRequest(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<{ list: List; fields: Field[]; data: Record<string, unknown> }> {
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const canEdit = (can(actor, 'edit_records') || can(actor, 'edit_own_records')) && this.records.canReach(list, actor, 'edit', { data: record.data, createdBy: record.created_by });
        if (!canEdit) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Para pedir firmas tienes que poder editar este registro.', data: { status: 403 } });
        }
        const fields = await this.fields.listByListId(tenantId, list.id);
        return { list, fields, data: record.data };
    }

    /** Las plantillas de documento de la lista y los PDF de los campos Archivo del registro. */
    async sources(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<{ templates: Array<{ id: number; name: string }>; files: Array<{ id: number; filename: string; field: string; size: number }> }> {
        const { list, fields, data } = await this.assertCanRequest(tenantId, actor, listIdOrSlug, recordId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const templates = await tx
                .select({ id: documentTemplates.id, name: documentTemplates.name })
                .from(documentTemplates)
                .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, list.id)))
                .orderBy(asc(documentTemplates.name));
            const byFile = new Map<number, string>();
            for (const f of fields) {
                if (f.type !== 'file') continue;
                for (const id of fileIdsIn(data[jsonbKeyForField(f.id)])) if (!byFile.has(id)) byFile.set(id, f.label);
            }
            const ids = [...byFile.keys()];
            const rows = ids.length
                ? await tx
                      .select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime, size: attachments.sizeBytes })
                      .from(attachments)
                      .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, ids)))
                : [];
            const pdfs = rows
                .filter((r) => r.mime === 'application/pdf' || /\.pdf$/i.test(r.filename))
                .map((r) => ({ id: r.id, filename: r.filename, field: byFile.get(r.id) ?? '', size: Number(r.size ?? 0) }));
            return { templates, files: pdfs };
        });
    }

    // ─────────────────────────── Ficha: listar ───────────────────────────

    async listForRecord(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<SignatureRequestDto[]> {
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const canEdit = (can(actor, 'edit_records') || can(actor, 'edit_own_records')) && this.records.canReach(list, actor, 'edit', { data: record.data, createdBy: record.created_by });
        const base = await this.base(tenantId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const reqs = await tx
                .select()
                .from(signatureRequests)
                .where(and(eq(signatureRequests.tenantId, tenantId), eq(signatureRequests.recordId, recordId), eq(signatureRequests.listId, list.id)))
                .orderBy(desc(signatureRequests.id))
                .limit(50);
            return this.toDtos(tx, reqs, base, canEdit);
        });
    }

    /**
     * v0.1.447 — Las firmas de los registros de una lista que la persona
     * puede ver (asistente y MCP): sin enlaces personales (son la credencial
     * de quien firma) y sin las huellas de las personas.
     */
    async listForList(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        opts: { statuses?: readonly SignatureRequestStatus[]; recordId?: number; limit?: number } = {},
    ): Promise<{ matched: number; byStatus: Partial<Record<SignatureRequestStatus, number>>; rows: Array<SignatureRequestDto & { record_title: string }> }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const titleId = resolveTitleFieldId(fields.map((f) => ({ id: f.id, type: f.type as FieldType })), list.settings);
        const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
        const base = await this.base(tenantId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const conds = [eq(signatureRequests.tenantId, tenantId), eq(signatureRequests.listId, list.id), isNull(records.deletedAt)];
            if (opts.recordId !== undefined) conds.push(eq(signatureRequests.recordId, opts.recordId));
            const rows = await tx
                .select({ r: signatureRequests, data: records.data, createdBy: records.createdBy })
                .from(signatureRequests)
                .innerJoin(records, eq(records.id, signatureRequests.recordId))
                .where(and(...conds))
                .orderBy(desc(signatureRequests.id))
                .limit(1000);
            const now = Date.now();
            const statusOf = (r: SignatureRequestRow): SignatureRequestStatus =>
                (r.status === 'pending' && r.expiresAt.getTime() <= now ? 'expired' : r.status) as SignatureRequestStatus;
            const visible = rows.filter(
                (x) =>
                    listRowInScope(list.settings, actor, 'view', { id: x.r.recordId, createdBy: x.createdBy, data: (x.data ?? {}) as Record<string, unknown> }) &&
                    (!opts.statuses?.length || opts.statuses.includes(statusOf(x.r))),
            );
            const byStatus: Partial<Record<SignatureRequestStatus, number>> = {};
            for (const x of visible) byStatus[statusOf(x.r)] = (byStatus[statusOf(x.r)] ?? 0) + 1;
            const page = visible.slice(0, limit);
            const dtos = await this.toDtos(tx, page.map((x) => ({ ...x.r, status: statusOf(x.r) })), base, false);
            return {
                matched: visible.length,
                byStatus,
                rows: dtos.map((d, i) => {
                    const v = titleId ? ((page[i]!.data ?? {}) as Record<string, unknown>)[jsonbKeyForField(titleId)] : null;
                    return { ...d, record_title: typeof v === 'string' && v.trim() !== '' ? v : `Registro #${d.record_id}` };
                }),
            };
        });
    }

    /**
     * v0.1.447 — Las firmas que ve el cliente en su portal: las de SU registro
     * en las que es una de las personas que firman (por su correo, sin
     * mayúsculas). Las anuladas no se muestran. Su enlace personal sólo
     * mientras le toque firmar.
     */
    async portalSignaturesInTx(tx: Tx, tenantId: number, recordId: number, email: string): Promise<PortalSignature[]> {
        const mail = email.trim().toLowerCase();
        if (mail === '') return [];
        const mine = await tx
            .select({ signer: signatureSigners, request: signatureRequests })
            .from(signatureSigners)
            .innerJoin(signatureRequests, eq(signatureRequests.id, signatureSigners.requestId))
            .where(
                and(
                    eq(signatureRequests.tenantId, tenantId),
                    eq(signatureRequests.recordId, recordId),
                    sql`${signatureRequests.status} <> 'voided'`,
                    sql`lower(${signatureSigners.email}) = ${mail}`,
                ),
            )
            .orderBy(desc(signatureRequests.id))
            .limit(30);
        if (mine.length === 0) return [];
        const ids = [...new Set(mine.map((m) => m.request.id))];
        const all = await tx.select().from(signatureSigners).where(inArray(signatureSigners.requestId, ids));
        const base = await this.base(tenantId);
        const now = Date.now();
        const seen = new Set<number>();
        const out: PortalSignature[] = [];
        for (const { signer, request: r } of mine) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            const status = (r.status === 'pending' && r.expiresAt.getTime() <= now ? 'expired' : r.status) as SignatureRequestStatus;
            const siblings = all.filter((x) => x.requestId === r.id).map((x) => ({ ...x, status: x.status as SignerStatus }));
            const due = status === 'pending' ? new Set(signersDue(r.orderMode as 'parallel' | 'sequential', siblings).map((x) => x.id)) : new Set<number>();
            out.push({
                id: r.id,
                title: r.title,
                status,
                document_number: r.documentLabel ?? null,
                my_status: signer.status as SignerStatus,
                sign_url: due.has(signer.id) ? this.signUrl(base, r, signer.id) : null,
                signed_available: status === 'completed' && r.signedFileId !== null,
                created_at: r.createdAt.toISOString(),
                expires_at: r.expiresAt.toISOString(),
            });
        }
        return out;
    }

    /** v0.1.447 — El PDF firmado para el cliente del portal (de su registro y si firma ahí). */
    async portalSignedPdf(tenantId: number, recordId: number, email: string, requestId: number): Promise<{ buffer: Buffer; filename: string }> {
        const notFound = () => new NotFoundException({ code: 'not_found', message: 'Documento no encontrado', data: { status: 404 } });
        if (!Number.isInteger(requestId) || requestId <= 0) throw notFound();
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const list = await this.portalSignaturesInTx(tx, tenantId, recordId, email);
            const hit = list.find((x) => x.id === requestId);
            if (!hit || !hit.signed_available) throw notFound();
            const [r] = await tx.select().from(signatureRequests).where(and(eq(signatureRequests.tenantId, tenantId), eq(signatureRequests.id, requestId))).limit(1);
            if (!r?.signedFileId) throw notFound();
            return { buffer: await this.readFile(tenantId, r.signedFileId, tx), filename: signedFilename(r.title) };
        });
    }

    private async toDtos(tx: Tx, reqs: SignatureRequestRow[], base: string, withLinks: boolean): Promise<SignatureRequestDto[]> {
        if (reqs.length === 0) return [];
        const signers = await tx
            .select()
            .from(signatureSigners)
            .where(inArray(signatureSigners.requestId, reqs.map((r) => r.id)))
            .orderBy(asc(signatureSigners.position));
        const names = await this.userNames(tx, reqs.map((r) => r.createdBy ?? 0));
        const connIds = [...new Set(reqs.map((r) => r.verifyConnectionId).filter((n): n is number => n !== null))];
        const connNames = connIds.length
            ? new Map((await tx.select({ id: connections.id, name: connections.name }).from(connections).where(inArray(connections.id, connIds))).map((c) => [c.id, c.name]))
            : new Map<number, string>();
        const numbers = reqs.map((r) => r.documentNumberId).filter((n): n is number => n !== null);
        const labels = numbers.length
            ? new Map((await tx.select({ id: documentNumbers.id, label: documentNumbers.label }).from(documentNumbers).where(inArray(documentNumbers.id, numbers))).map((r) => [r.id, r.label]))
            : new Map<number, string>();
        return reqs.map((r) => {
            const mine = signers.filter((s) => s.requestId === r.id);
            const due = r.status === 'pending' ? new Set(signersDue(r.orderMode as 'parallel' | 'sequential', mine.map((s) => ({ ...s, status: s.status as SignerStatus }))).map((s) => s.id)) : new Set<number>();
            const sd: SignerDto[] = mine.map((s) => ({
                id: s.id,
                position: s.position,
                name: s.name,
                email: s.email,
                role: s.role,
                phone: s.phone,
                status: s.status as SignerStatus,
                sent_at: iso(s.sentAt),
                viewed_at: iso(s.viewedAt),
                signed_at: iso(s.signedAt),
                declined_at: iso(s.declinedAt),
                decline_reason: s.declineReason,
                reminders_sent: s.remindersSent,
                signed_name: s.signedName,
                link: withLinks && due.has(s.id) ? this.signUrl(base, r, s.id) : null,
            }));
            const onComplete = signatureOnCompleteSchema.safeParse(r.onComplete ?? {});
            return {
                id: r.id,
                list_id: r.listId,
                record_id: r.recordId,
                title: r.title,
                status: r.status as SignatureRequestStatus,
                order: r.orderMode as 'parallel' | 'sequential',
                verify: r.verify as SignatureVerify,
                verify_connection_id: r.verifyConnectionId,
                verify_connection_name: r.verifyConnectionId !== null ? (connNames.get(r.verifyConnectionId) ?? null) : null,
                message: r.message,
                source: r.source as 'template' | 'file',
                template_id: r.templateId,
                document_number: (r.documentNumberId !== null ? labels.get(r.documentNumberId) : null) ?? r.documentLabel ?? null,
                original_sha256: r.originalSha256,
                signed_sha256: r.signedSha256,
                pages: r.pages,
                expires_at: r.expiresAt.toISOString(),
                created_at: r.createdAt.toISOString(),
                created_by: r.createdBy,
                created_by_name: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
                completed_at: iso(r.completedAt),
                voided_at: iso(r.voidedAt),
                void_reason: r.voidReason,
                code: r.code,
                on_complete: onComplete.success ? onComplete.data : signatureOnCompleteSchema.parse({}),
                signers: sd,
            };
        });
    }

    // ─────────────────────────── Ficha: pedir firma ───────────────────────────

    private checkOnComplete(fields: Field[], oc: SignatureOnComplete): void {
        const byId = new Map(fields.map((f) => [f.id, f]));
        if (oc.save_field_id !== null && byId.get(oc.save_field_id)?.type !== 'file') {
            throw bad('invalid_on_complete', 'El campo donde se guarda el PDF firmado tiene que ser un campo Archivo de esta lista.');
        }
        if (oc.status_field_id !== null) {
            const f = byId.get(oc.status_field_id);
            if (!f || f.type !== 'select') throw bad('invalid_on_complete', 'El campo de estado tiene que ser un campo de selección de esta lista.');
            const options = ((f.config as { options?: Array<{ value: string }> } | undefined)?.options ?? []).map((o) => o.value);
            if (!options.includes(oc.status_value ?? '')) throw bad('invalid_on_complete', 'Esa opción ya no existe en el campo de estado.');
        }
        if (oc.date_field_id !== null) {
            const t = byId.get(oc.date_field_id)?.type;
            if (t !== 'date' && t !== 'datetime') throw bad('invalid_on_complete', 'El campo de la fecha de firma tiene que ser de fecha.');
        }
    }

    async create(tenantId: number, actor: Actor, listIdOrSlug: string, input: CreateSignatureArgs, opts: { chain?: AutomationChain } = {}): Promise<SignatureRequestDto> {
        const { list, fields, data } = await this.assertCanRequest(tenantId, actor, listIdOrSlug, input.record_id);
        this.checkOnComplete(fields, input.on_complete);
        const uploads: StoredFileRef[] = [];
        let created: SignatureRequestRow;
        try {
            created = await this.tenantDb.withTenant(tenantId, async (tx) => {
                if ((await tenantAccessInTx(tx, tenantId)).state !== 'full') {
                    throw new ForbiddenException({ code: 'workspace_read_only', message: 'La empresa está en solo lectura: no se pueden pedir firmas.', data: { status: 403 } });
                }
                // 0. v0.1.448 — Por dónde sale el código (SMS o WhatsApp).
                const codeVia = await this.checkCodeChannelInTx(tx, tenantId, input);
                // 1. El PDF a firmar.
                let pdf: Buffer;
                let filename: string;
                let templateId: number | null = null;
                let numberId: number | null = null;
                let numberLabel: string | null = null;
                if (input.source.kind === 'template') {
                    const rendered = await this.documents.renderTemplateInTx(tx, {
                        tenantId,
                        listId: list.id,
                        recordId: input.record_id,
                        templateId: input.source.template_id,
                        actor,
                        uploads,
                    });
                    if (rendered.recordId === null) throw new NotFoundException({ code: 'record_not_found', message: 'Registro no encontrado', data: { status: 404 } });
                    pdf = rendered.buffer;
                    filename = rendered.filename;
                    templateId = input.source.template_id;
                    numberId = rendered.issuedId;
                    numberLabel = rendered.number;
                } else {
                    const fileId = input.source.file_id;
                    const inRecord = fields.some((f) => f.type === 'file' && fileIdsIn(data[jsonbKeyForField(f.id)]).includes(fileId));
                    if (!inRecord) throw bad('signature_file_not_in_record', 'Elige un PDF que esté en un campo Archivo de este registro.');
                    const [att] = await tx
                        .select({ key: attachments.storageKey, conn: attachments.storageConnectionId, name: attachments.filename, size: attachments.sizeBytes })
                        .from(attachments)
                        .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, fileId)))
                        .limit(1);
                    if (!att) throw bad('signature_file_not_in_record', 'Ese archivo ya no existe.');
                    if (Number(att.size ?? 0) > SIGNATURE_MAX_PDF_BYTES) throw bad('signature_pdf_too_large', 'El PDF es demasiado grande para firmar (máximo 20 MB).');
                    const bytes = await readAll(await this.files.readStream(tenantId, { storageKey: att.key, storageConnectionId: att.conn }), SIGNATURE_MAX_PDF_BYTES);
                    if (!bytes) throw bad('signature_pdf_too_large', 'El PDF es demasiado grande para firmar (máximo 20 MB).');
                    pdf = bytes;
                    filename = att.name;
                }
                if (pdf.length > SIGNATURE_MAX_PDF_BYTES) throw bad('signature_pdf_too_large', 'El PDF es demasiado grande para firmar (máximo 20 MB).');
                let pages: number;
                try {
                    pages = await pdfPageCount(pdf);
                } catch (err) {
                    if (err instanceof SignaturePdfError) throw bad('signature_pdf_invalid', err.message);
                    throw err;
                }
                // 2. La copia del original (lo que se firma).
                const copy = await this.files.storeBufferInTx(tx, tenantId, actor.userId, filename, 'application/pdf', pdf);
                uploads.push(copy.ref);
                // 3. La solicitud y sus firmantes.
                const title = (input.title || filename.replace(/\.pdf$/i, '')).trim().slice(0, 160) || 'Documento';
                const expiresAt = new Date(Date.now() + input.expires_days * 86_400_000);
                let row: SignatureRequestRow | undefined;
                for (let attempt = 0; attempt < 5 && !row; attempt++) {
                    const inserted = await tx
                        .insert(signatureRequests)
                        .values({
                            tenantId,
                            listId: list.id,
                            recordId: input.record_id,
                            title,
                            status: 'pending',
                            orderMode: input.order,
                            verify: input.verify,
                            verifyConnectionId: codeVia.connectionId,
                            verifyOptions: codeVia.template ? { template: codeVia.template } : {},
                            message: input.message,
                            source: input.source.kind,
                            templateId,
                            documentNumberId: numberId,
                            documentLabel: numberLabel,
                            originalFileId: copy.id,
                            originalSha256: sha256Hex(pdf),
                            pages,
                            code: verifyCodeGen(),
                            onComplete: input.on_complete,
                            remindDays: input.remind_days,
                            expiresAt,
                            createdBy: actor.userId > 0 ? actor.userId : null,
                        })
                        .onConflictDoNothing({ target: signatureRequests.code })
                        .returning();
                    row = inserted[0];
                }
                if (!row) throw new Error('No se pudo generar el código de la solicitud.');
                await tx.insert(signatureSigners).values(
                    input.signers.map((s, i) => ({
                        tenantId,
                        requestId: row!.id,
                        position: i + 1,
                        name: s.name,
                        email: s.email.toLowerCase(),
                        role: s.role ?? '',
                        phone: signatureVerifyNeedsPhone(input.verify) ? (s.phone ?? '').trim() : '',
                        status: 'waiting',
                    })),
                );
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId: list.id,
                    recordId: input.record_id,
                    userId: actor.userId > 0 ? actor.userId : null,
                    action: 'signature',
                    diff: { signature: { event: 'requested', request_id: row.id, title, total: input.signers.length } },
                });
                return row;
            });
        } catch (err) {
            await this.files.discardBytes(tenantId, uploads);
            throw err;
        }
        // 4. Avisos a quienes les toca firmar (después del commit).
        await this.dispatchDue(created.id, tenantId, { send: input.send_email });
        await this.audit.log({
            tenantId,
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'signature.request',
            targetType: 'record',
            targetId: input.record_id,
            targetLabel: created.title,
            meta: { request_id: created.id, signers: input.signers.length, source: input.source.kind },
        });
        this.realtime?.records(tenantId, list.id);
        await this.emitEvent(created, 'requested', { chain: opts.chain });
        const base = await this.base(tenantId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [fresh] = await tx.select().from(signatureRequests).where(eq(signatureRequests.id, created.id)).limit(1);
            return (await this.toDtos(tx, [fresh!], base, true))[0]!;
        });
    }

    // ─────────────────────────── Automatizaciones (v0.1.447) ───────────────────────────

    /** Lo que ven las automatizaciones como `{{firma.x}}`. */
    private async eventInfoInTx(
        tx: Tx,
        r: SignatureRequestRow,
        evento: SignatureEvent,
        extra: { who?: Pick<SignatureSignerRow, 'name' | 'email' | 'role' | 'signedName'> | null; reason?: string | null } = {},
    ): Promise<SignatureEventInfo> {
        const signers = await tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, r.id)).orderBy(asc(signatureSigners.position));
        const base = await this.base(r.tenantId);
        const status = this.effectiveStatus(r);
        const next = status === 'pending' ? (signersDue(r.orderMode as 'parallel' | 'sequential', signers.map((x) => ({ ...x, status: x.status as SignerStatus })))[0] ?? null) : null;
        const who = extra.who ?? null;
        return {
            request_id: r.id,
            evento,
            titulo: r.title,
            estado: SIGNATURE_STATUS_LABELS[status],
            estado_clave: status,
            numero: r.documentLabel ?? null,
            firmante: who ? (who.signedName ?? who.name) : null,
            firmante_email: who ? who.email : null,
            firmante_rol: who ? who.role || null : null,
            firmaron: signers.filter((x) => x.status === 'signed').length,
            total: signers.length,
            motivo: extra.reason ?? (evento === 'voided' ? r.voidReason : null) ?? null,
            codigo: r.code,
            verificar: this.verifyUrl(base, r.code),
            siguiente: next ? next.name : null,
            siguiente_email: next ? next.email : null,
            enlace: next ? this.signUrl(base, r, next.id) : null,
            pdf: status === 'completed' && r.signedFileId ? this.files.absoluteSignedUrl(r.tenantId, r.signedFileId, 30 * 24 * 3600) : null,
            template_id: r.templateId ?? null,
        };
    }

    /**
     * Avisa a las automatizaciones de la lista (y a los webhooks de eventos)
     * que pasó algo con la firma. Nunca rompe lo que hizo la persona.
     */
    private async emitEvent(
        r: Pick<SignatureRequestRow, 'id' | 'tenantId' | 'listId' | 'recordId'>,
        evento: SignatureEvent,
        extra: { who?: Pick<SignatureSignerRow, 'name' | 'email' | 'role' | 'signedName'> | null; reason?: string | null; chain?: AutomationChain } = {},
    ): Promise<void> {
        if (!this.dispatcher) return;
        try {
            const out = await this.tenantDb.withTenant(r.tenantId, async (tx) => {
                const [fresh] = await tx.select().from(signatureRequests).where(eq(signatureRequests.id, r.id)).limit(1);
                if (!fresh) return null;
                const [rec] = await tx
                    .select({ data: records.data })
                    .from(records)
                    .where(and(eq(records.tenantId, r.tenantId), eq(records.id, fresh.recordId), isNull(records.deletedAt)))
                    .limit(1);
                if (!rec) return null;
                return { info: await this.eventInfoInTx(tx, fresh, evento, extra), data: (rec.data ?? {}) as Record<string, unknown> };
            });
            if (!out) return;
            this.dispatcher.dispatch({
                tenantId: r.tenantId,
                listId: r.listId,
                recordId: r.recordId,
                trigger: 'signature_event',
                after: out.data,
                signature: out.info,
                ...(extra.chain ? { chain: extra.chain } : {}),
            });
        } catch (err) {
            this.logger.warn(`Firma ${r.id}: no se pudo avisar a las automatizaciones (${evento}): ${String(err)}`);
        }
    }

    /** Lo que deja la acción «Pedir firma» de una automatización como `{{firma.x}}`. */
    async infoFor(tenantId: number, requestId: number, evento: SignatureEvent): Promise<SignatureEventInfo | null> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(signatureRequests).where(and(eq(signatureRequests.tenantId, tenantId), eq(signatureRequests.id, requestId))).limit(1);
            return r ? this.eventInfoInTx(tx, r, evento) : null;
        });
    }

    /** «Probar» con el disparador de firmas: la última solicitud del registro, como llegaría. */
    async sampleEvent(tenantId: number, recordId: number, evento: SignatureEvent): Promise<SignatureEventInfo | null> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx
                .select()
                .from(signatureRequests)
                .where(and(eq(signatureRequests.tenantId, tenantId), eq(signatureRequests.recordId, recordId)))
                .orderBy(desc(signatureRequests.id))
                .limit(1);
            if (!r) return null;
            const signers = await tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, r.id)).orderBy(asc(signatureSigners.position));
            const who = evento === 'declined' ? signers.find((x) => x.status === 'declined') : evento === 'signed' ? [...signers].reverse().find((x) => x.status === 'signed') : null;
            return this.eventInfoInTx(tx, r, evento, { who: who ?? null, reason: who?.declineReason ?? null });
        });
    }

    /**
     * Marca como «Enviado» a quienes les toca firmar y les manda el correo con
     * su enlace (si `send`). En orden, sólo al siguiente.
     */
    private async dispatchDue(requestId: number, tenantId: number, opts: { send: boolean }): Promise<void> {
        const due = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(signatureRequests).where(eq(signatureRequests.id, requestId)).for('update').limit(1);
            if (!r || r.status !== 'pending') return null;
            const signers = await tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, requestId)).orderBy(asc(signatureSigners.position));
            const now = signersDue(r.orderMode as 'parallel' | 'sequential', signers.map((s) => ({ ...s, status: s.status as SignerStatus }))).filter((s) => s.status === 'waiting');
            if (now.length === 0) return null;
            await tx
                .update(signatureSigners)
                .set({ status: 'sent', sentAt: new Date() })
                .where(and(inArray(signatureSigners.id, now.map((s) => s.id)), eq(signatureSigners.status, 'waiting')));
            const requester = r.createdBy ? (await this.userNames(tx, [r.createdBy])).get(r.createdBy) ?? null : null;
            return { request: r, signers: now, requester };
        });
        if (!due || !opts.send) return;
        await this.sendToSigners(due.request, due.signers, 'request', { requester: due.requester });
    }

    private async sendToSigners(
        r: SignatureRequestRow,
        signers: SignatureSignerRow[],
        kind: SignatureMailKind,
        x: { requester?: string | null; reason?: string | null; declinedBy?: string | null; attachment?: { filename: string; bytes: Buffer } | null } = {},
    ): Promise<number> {
        if (!this.mail || signers.length === 0) return 0;
        const base = await this.base(r.tenantId);
        const b = await this.brand(r.tenantId);
        let sent = 0;
        for (const s of signers) {
            const url = this.signUrl(base, r, s.id);
            const msg = signatureEmail(b, {
                kind,
                signerName: s.name,
                title: r.title,
                message: r.message,
                requestedBy: x.requester ?? null,
                url,
                expiresText: `el ${formatBookingWhen(r.expiresAt.toISOString(), b.timeZone, b.timeFormat, { weekday: false })}`,
                reason: x.reason ?? null,
                declinedBy: x.declinedBy ?? null,
                attached: !!x.attachment,
            });
            try {
                await this.mail.sendNow({
                    tenantId: r.tenantId,
                    to: s.email,
                    subject: msg.subject,
                    text: msg.text,
                    html: msg.html,
                    ...(x.attachment ? { attachments: [{ filename: x.attachment.filename, contentType: 'application/pdf', contentBase64: x.attachment.bytes.toString('base64') }] } : {}),
                    ...(b.name.trim() === '' ? {} : { fromName: senderName(b.name), fromNameSoft: true }),
                });
                sent += 1;
            } catch (err) {
                this.logger.warn(`Firma ${r.id}: el correo (${kind}) a la persona ${s.id} no salió: ${String(err)}`);
            }
        }
        return sent;
    }

    // ─────────────────────────── Ficha: reenviar, anular, descargar ───────────────────────────

    private async loadForStaff(tenantId: number, actor: Actor, listIdOrSlug: string, requestId: number, needEdit: boolean): Promise<{ list: List; request: SignatureRequestRow }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const [r] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(signatureRequests)
                .where(and(eq(signatureRequests.tenantId, tenantId), eq(signatureRequests.id, requestId), eq(signatureRequests.listId, list.id)))
                .limit(1),
        );
        if (!r) throw notFound();
        // Ver el registro (404 si no lo alcanza) con el ACL de la ficha.
        const record = await this.records.get(tenantId, actor, String(list.id), r.recordId);
        if (needEdit) {
            const ok = (can(actor, 'edit_records') || can(actor, 'edit_own_records')) && this.records.canReach(list, actor, 'edit', { data: record.data, createdBy: record.created_by });
            if (!ok) throw new ForbiddenException({ code: 'forbidden', message: 'Para esto tienes que poder editar el registro.', data: { status: 403 } });
        }
        return { list, request: r };
    }

    async resend(tenantId: number, actor: Actor, listIdOrSlug: string, requestId: number, signerId: number): Promise<{ sent: boolean }> {
        const { request } = await this.loadForStaff(tenantId, actor, listIdOrSlug, requestId, true);
        if (request.status !== 'pending') throw new ConflictException({ code: 'signature_closed', message: 'Esta solicitud ya no está esperando firmas.', data: { status: 409 } });
        const [s] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select().from(signatureSigners).where(and(eq(signatureSigners.requestId, request.id), eq(signatureSigners.id, signerId))).limit(1));
        if (!s) throw notFound();
        if (s.status !== 'sent' && s.status !== 'viewed') {
            throw new ConflictException({ code: 'signature_not_due', message: s.status === 'waiting' ? 'Todavía no le toca firmar a esta persona.' : 'Esta persona ya respondió.', data: { status: 409 } });
        }
        try {
            const n = await incrWithTtl(this.redis, `sign:resend:${signerId}`, 3600);
            if (n > 5) throw tooMany('Ya le reenviaste el enlace varias veces en la última hora.');
        } catch (err) {
            if (err instanceof HttpException) throw err;
        }
        const requester = actor.userId > 0 ? (await this.tenantDb.withTenant(tenantId, (tx) => this.userNames(tx, [actor.userId]))).get(actor.userId) ?? null : null;
        const sent = (await this.sendToSigners(request, [s], 'request', { requester })) > 0;
        return { sent };
    }

    async void(tenantId: number, actor: Actor, listIdOrSlug: string, requestId: number, input: VoidSignatureRequestInput): Promise<SignatureRequestDto> {
        const { list, request } = await this.loadForStaff(tenantId, actor, listIdOrSlug, requestId, true);
        const notified = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(signatureRequests).where(eq(signatureRequests.id, request.id)).for('update').limit(1);
            if (!r || r.status !== 'pending') throw new ConflictException({ code: 'signature_closed', message: 'Esta solicitud ya no está esperando firmas.', data: { status: 409 } });
            await tx
                .update(signatureRequests)
                .set({ status: 'voided', voidedAt: new Date(), voidedBy: actor.userId > 0 ? actor.userId : null, voidReason: input.reason || null, linkVersion: r.linkVersion + 1, updatedAt: new Date() })
                .where(eq(signatureRequests.id, r.id));
            await this.activity.logInTx(tx, {
                tenantId,
                listId: r.listId,
                recordId: r.recordId,
                userId: actor.userId > 0 ? actor.userId : null,
                action: 'signature',
                diff: { signature: { event: 'voided', request_id: r.id, title: r.title, ...(input.reason ? { reason: input.reason } : {}) } },
            });
            return tx.select().from(signatureSigners).where(and(eq(signatureSigners.requestId, r.id), inArray(signatureSigners.status, ['sent', 'viewed', 'signed'])));
        });
        await this.sendToSigners({ ...request, status: 'voided' }, notified, 'voided', { reason: input.reason || null });
        await this.audit.log({
            tenantId,
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'signature.void',
            targetType: 'record',
            targetId: request.recordId,
            targetLabel: request.title,
            meta: { request_id: request.id },
        });
        this.realtime?.records(tenantId, list.id);
        await this.emitEvent(request, 'voided', { reason: input.reason || null });
        const base = await this.base(tenantId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [fresh] = await tx.select().from(signatureRequests).where(eq(signatureRequests.id, request.id)).limit(1);
            return (await this.toDtos(tx, [fresh!], base, true))[0]!;
        });
    }

    async download(tenantId: number, actor: Actor, listIdOrSlug: string, requestId: number, which: 'original' | 'signed'): Promise<{ buffer: Buffer; filename: string }> {
        const { request } = await this.loadForStaff(tenantId, actor, listIdOrSlug, requestId, false);
        const fileId = which === 'signed' ? request.signedFileId : request.originalFileId;
        if (!fileId) throw new NotFoundException({ code: 'signature_not_signed', message: 'Este documento todavía no está firmado por todos.', data: { status: 404 } });
        const bytes = await this.readFile(tenantId, fileId);
        return { buffer: bytes, filename: which === 'signed' ? signedFilename(request.title) : `${request.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120) || 'Documento'}.pdf` };
    }

    private async readFile(tenantId: number, fileId: number, tx?: Tx): Promise<Buffer> {
        const run = async (t: Tx): Promise<Buffer> => {
            const [att] = await t
                .select({ key: attachments.storageKey, conn: attachments.storageConnectionId })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, fileId)))
                .limit(1);
            if (!att) throw new NotFoundException({ code: 'signature_file_missing', message: 'El PDF de esta solicitud ya no está guardado.', data: { status: 404 } });
            const bytes = await readAll(await this.files.readStream(tenantId, { storageKey: att.key, storageConnectionId: att.conn }), SIGNATURE_MAX_PDF_BYTES * 2);
            if (!bytes) throw new NotFoundException({ code: 'signature_file_missing', message: 'El PDF es demasiado grande.', data: { status: 404 } });
            return bytes;
        };
        return tx ? run(tx) : this.tenantDb.withTenant(tenantId, run);
    }

    // ─────────────────────────── Página pública ───────────────────────────

    /** ¿La empresa puede servir esta página? (pausada o sin «Documentos PDF»: como un enlace vencido). */
    private async surfaceOff(tenantId: number): Promise<boolean> {
        return publicSurfaceOff(this.db, tenantId, 'documents');
    }

    async publicView(token: string, meta: { ip?: string; userAgent?: string }): Promise<PublicSignatureDto> {
        await this.limitIp(meta.ip, 'view');
        const ctx = await this.resolveToken(token);
        if (await this.surfaceOff(ctx.request.tenantId)) throw notFound();
        const { signer, request } = ctx;
        // Marca «Lo abrió» la primera vez (sólo si le toca).
        if (request.status === 'pending' && signer.status === 'sent') {
            await this.tenantDb.withTenant(request.tenantId, async (tx) => {
                const upd = await tx
                    .update(signatureSigners)
                    .set({ status: 'viewed', viewedAt: new Date() })
                    .where(and(eq(signatureSigners.id, signer.id), eq(signatureSigners.status, 'sent')))
                    .returning({ id: signatureSigners.id });
                if (upd.length > 0) {
                    await this.activity.logInTx(tx, {
                        tenantId: request.tenantId,
                        listId: request.listId,
                        recordId: request.recordId,
                        userId: null,
                        action: 'signature',
                        diff: { signature: { event: 'viewed', request_id: request.id, title: request.title, name: signer.name } },
                    });
                }
            });
            signer.status = 'viewed';
            this.realtime?.records(request.tenantId, request.listId);
        }
        const others = await this.tenantDb.withTenant(request.tenantId, (tx) =>
            tx.select({ id: signatureSigners.id, name: signatureSigners.name, role: signatureSigners.role, status: signatureSigners.status, position: signatureSigners.position }).from(signatureSigners).where(eq(signatureSigners.requestId, request.id)).orderBy(asc(signatureSigners.position)),
        );
        const base = await this.base(request.tenantId);
        const b = await this.brand(request.tenantId);
        const status = this.effectiveStatus(request);
        return {
            title: request.title,
            company: b.company,
            brand: {
                name: b.company,
                color: b.color,
                // Relativa y sin atar a sesión: la página vive en el mismo origen.
                logo_url: b.logoFileId ? this.files.signedUrl(request.tenantId, b.logoFileId, 24 * 3600, { bind: null }) : null,
            },
            status,
            message: request.message,
            expires_at: request.expiresAt.toISOString(),
            pages: request.pages,
            verify: request.verify as SignatureVerify,
            signer: {
                name: signer.name,
                email_masked: maskEmail(signer.email),
                phone_masked: signatureVerifyNeedsPhone(request.verify) ? maskPhone(signer.phone) : null,
                status: signer.status as SignerStatus,
                role: signer.role,
            },
            others: others.filter((o) => o.id !== signer.id).map((o) => ({ name: o.name, role: o.role, status: o.status as SignerStatus })),
            consent_text: signatureConsentText(b.company),
            signed_available: request.status === 'completed' && request.signedFileId !== null,
            verify_url: this.verifyUrl(base, request.code),
        };
    }

    /** Una solicitud pendiente cuyo plazo pasó se ve como vencida aunque el barrido todavía no corrió. */
    private effectiveStatus(r: SignatureRequestRow): SignatureRequestStatus {
        if (r.status === 'pending' && r.expiresAt.getTime() < Date.now()) return 'expired';
        return r.status as SignatureRequestStatus;
    }

    async publicDocument(token: string, meta: { ip?: string }): Promise<{ buffer: Buffer; filename: string }> {
        await this.limitIp(meta.ip, 'doc', 120);
        const { signer, request } = await this.resolveToken(token);
        if (await this.surfaceOff(request.tenantId)) throw notFound();
        if (request.status === 'completed' && request.signedFileId) {
            return { buffer: await this.readFile(request.tenantId, request.signedFileId), filename: signedFilename(request.title) };
        }
        // Mientras espera firmas, sólo lo ve quien todavía puede firmar o ya firmó.
        if (request.status !== 'pending' || signer.status === 'declined') throw linkGone('Esta solicitud de firma ya no está disponible.');
        return { buffer: await this.readFile(request.tenantId, request.originalFileId), filename: `${request.title.slice(0, 120) || 'Documento'}.pdf` };
    }

    private codeKey(signerId: number): string {
        return `sign:code:${signerId}`;
    }

    private assertSignable(ctx: PublicCtx): void {
        const { signer, request } = ctx;
        if (request.status === 'voided') throw linkGone('Esta solicitud de firma fue anulada.', 'signature_voided');
        if (request.status === 'completed') throw linkGone('Este documento ya está firmado por todos.', 'signature_completed');
        if (request.status === 'declined') throw linkGone('Esta solicitud de firma se cerró: alguien decidió no firmar.', 'signature_declined');
        if (request.status === 'expired' || request.expiresAt.getTime() < Date.now()) throw linkGone('Esta solicitud de firma venció.', 'signature_expired');
        if (signer.status === 'signed') throw linkGone('Ya firmaste este documento.', 'signature_already_signed');
        if (signer.status === 'declined') throw linkGone('Ya decidiste no firmar este documento.', 'signature_already_declined');
        if (signer.status === 'waiting') {
            throw new ConflictException({ code: 'signature_not_due', message: 'Todavía no te toca firmar: te avisaremos por correo cuando sea tu turno.', data: { status: 409 } });
        }
    }

    async requestCode(token: string, meta: { ip?: string }): Promise<SignatureCodeSent> {
        await this.limitIp(meta.ip, 'code', 30);
        const ctx = await this.resolveToken(token);
        if (await this.surfaceOff(ctx.request.tenantId)) throw notFound();
        this.assertSignable(ctx);
        if ((await this.tenantAccessFull(ctx.request.tenantId)) === false) throw linkGone('La empresa no puede recibir firmas en este momento.', 'signature_unavailable');
        const verify = ctx.request.verify as SignatureVerify;
        const channel: SignatureCodeSent['channel'] = verify === 'sms' || verify === 'whatsapp' ? verify : 'email';
        const minutes = CODE_TTL_S / 60;
        try {
            const n = await incrWithTtl(this.redis, `sign:codes:${ctx.signer.id}`, 3600);
            if (n > CODES_PER_SIGNER_HOUR) {
                throw tooMany(
                    channel === 'email'
                        ? 'Ya pediste varios códigos. Espera un rato o revisa tu correo (también la carpeta de spam).'
                        : 'Ya pediste varios códigos. Espera un rato y revisa los mensajes de tu celular.',
                );
            }
        } catch (err) {
            if (err instanceof HttpException) throw err;
        }
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        await this.redis.set(this.codeKey(ctx.signer.id), JSON.stringify({ h: createHash('sha256').update(code).digest('hex'), t: 0 }), 'EX', CODE_TTL_S);
        const dropCode = () => this.redis.del(this.codeKey(ctx.signer.id)).catch(() => undefined);
        const b = await this.brand(ctx.request.tenantId);

        // v0.1.448 — Por SMS o WhatsApp: con la conexión de la empresa que eligió quien pidió la firma.
        if (channel !== 'email') {
            const phone = ctx.signer.phone.trim();
            const dest = maskPhone(phone);
            const connId = ctx.request.verifyConnectionId;
            const unavailable = (why: string): never => {
                throw new HttpException({ code: 'signature_code_channel', message: why, data: { status: 503 } }, HttpStatus.SERVICE_UNAVAILABLE);
            };
            if (phone === '' || connId === null) {
                await dropCode();
                unavailable(`No podemos mandarte el código por ${channel === 'sms' ? 'SMS' : 'WhatsApp'}: falta ${phone === '' ? 'tu celular' : 'la conexión'} en esta solicitud. Avísale a quien te pidió la firma.`);
            }
            const text = signatureCodeText(code, b.company, minutes);
            let error: string | null = null;
            if (channel === 'sms') {
                if (!this.sms) {
                    error = 'El envío de SMS no está disponible en este servidor.';
                } else {
                    const res = await this.sms.sendNow(ctx.request.tenantId, {
                        connectionId: connId!,
                        to: phone,
                        message: text,
                        stripAccents: true,
                        respectHours: false,
                        source: 'signature',
                        // Sin registro: el código no deja rastro en la ficha (no es parte de la conversación).
                        target: { listId: null, recordId: null, userId: null },
                    });
                    if (!res.ok) error = res.error ?? 'No se pudo enviar el SMS.';
                }
            } else if (!this.whatsapp) {
                error = 'El envío por WhatsApp no está disponible en este servidor.';
            } else {
                const tpl = (ctx.request.verifyOptions as { template?: { name?: unknown; language?: unknown } } | null)?.template;
                const res = await this.whatsapp.sendSignatureCode(ctx.request.tenantId, {
                    connectionId: connId!,
                    to: phone,
                    code,
                    text,
                    template: tpl && typeof tpl.name === 'string' && typeof tpl.language === 'string' ? { name: tpl.name, language: tpl.language } : null,
                });
                if (!res.ok) error = res.error;
            }
            if (error !== null) {
                this.logger.warn(`Firma ${ctx.request.id}: el código por ${channel} para la persona ${ctx.signer.id} no salió: ${error}`);
                await dropCode();
                // El motivo exacto (clave, saldo, plantilla) va al registro del servidor y a quien pidió la firma, no a quien firma.
                unavailable(`No pudimos enviar el código por ${channel === 'sms' ? 'SMS' : 'WhatsApp'} a ${dest}. Vuelve a intentarlo en unos minutos o avísale a quien te pidió la firma.`);
            }
            return { sent: true, channel, destination: dest, email_masked: dest, minutes };
        }

        let sent = false;
        if (this.mail) {
            const msg = signatureCodeEmail(b, { code, minutes, title: ctx.request.title });
            try {
                await this.mail.sendNow({
                    tenantId: ctx.request.tenantId,
                    to: ctx.signer.email,
                    subject: msg.subject,
                    text: msg.text,
                    html: msg.html,
                    ...(b.name.trim() === '' ? {} : { fromName: senderName(b.name), fromNameSoft: true }),
                });
                sent = true;
            } catch (err) {
                this.logger.warn(`Firma ${ctx.request.id}: el código para la persona ${ctx.signer.id} no salió: ${String(err)}`);
                await dropCode();
                throw new HttpException({ code: 'mail_failed', message: 'No pudimos enviar el código a tu correo. Vuelve a intentarlo en unos minutos.', data: { status: 503 } }, HttpStatus.SERVICE_UNAVAILABLE);
            }
        }
        const masked = maskEmail(ctx.signer.email);
        return { sent, channel: 'email', destination: masked, email_masked: masked, minutes };
    }

    /**
     * v0.1.448 — Las conexiones del EQUIPO que pueden mandar el código de una
     * firma: SMS (cualquier proveedor) y WhatsApp (Whats, o Meta con una
     * plantilla aprobada). Las privadas no: el código sale en nombre de la
     * empresa y la solicitud dura semanas (la persona que conectó puede irse).
     */
    async codeChannels(tenantId: number): Promise<SignatureCodeChannel[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: connections.id, name: connections.name, provider: connections.provider, config: connections.config })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.visibility, 'workspace')))
                .orderBy(asc(connections.name)),
        );
        const out: SignatureCodeChannel[] = [];
        for (const r of rows) {
            if ((r.config as { purpose?: unknown } | null)?.purpose === 'agenda') continue;
            if (isSmsProvider(r.provider)) {
                out.push({ id: r.id, name: r.name, channel: 'sms', provider: r.provider, needs_template: false, templates: [] });
            } else if (r.provider === 'whatsapp_web') {
                out.push({ id: r.id, name: r.name, channel: 'whatsapp', provider: r.provider, needs_template: false, templates: [] });
            } else if (r.provider === 'whatsapp_cloud') {
                const templates = this.whatsapp ? await this.whatsapp.templatesOf(tenantId, r.id, true) : [];
                out.push({
                    id: r.id,
                    name: r.name,
                    channel: 'whatsapp',
                    provider: r.provider,
                    needs_template: true,
                    templates: templates
                        .map((t) => {
                            const check = whatsappCodeTemplateCheck(t.components, t.parameter_format);
                            return { name: t.name, language: t.language, category: t.category, preview: check.preview, usable: check.usable, reason: check.reason };
                        })
                        // Las de «Autenticación» primero: son las que Meta pensó para códigos.
                        .sort((a, b) => Number(b.category === 'AUTHENTICATION') - Number(a.category === 'AUTHENTICATION')),
                });
            }
        }
        return out;
    }

    /** Valida la conexión (y la plantilla) del código al pedir la firma. */
    private async checkCodeChannelInTx(
        tx: Tx,
        tenantId: number,
        input: Pick<CreateSignatureArgs, 'verify' | 'verify_connection_id' | 'verify_template' | 'signers'>,
    ): Promise<{ connectionId: number | null; template: { name: string; language: string } | null }> {
        if (!signatureVerifyNeedsPhone(input.verify)) return { connectionId: null, template: null };
        const label = input.verify === 'sms' ? 'SMS' : 'WhatsApp';
        const connId = input.verify_connection_id ?? null;
        if (connId === null) throw bad('signature_code_connection', `Elige la conexión de ${label} por la que sale el código.`);
        const noPhone = input.signers.find((x) => !signaturePhoneLooksValid(x.phone ?? ''));
        if (noPhone) throw bad('signature_code_phone', `Falta el celular de ${noPhone.name} (o no parece válido): ahí le llega el código por ${label}.`);
        const [conn] = await tx
            .select({ id: connections.id, provider: connections.provider, visibility: connections.visibility, config: connections.config })
            .from(connections)
            .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connId)))
            .limit(1);
        const ok =
            conn &&
            conn.visibility === 'workspace' &&
            (conn.config as { purpose?: unknown } | null)?.purpose !== 'agenda' &&
            (input.verify === 'sms' ? isSmsProvider(conn.provider) : conn.provider === 'whatsapp_web' || conn.provider === 'whatsapp_cloud');
        if (!ok) {
            throw bad('signature_code_connection', `Esa conexión no puede mandar el código por ${label}: elige una conexión de ${label} del equipo (en Ajustes → Integraciones).`);
        }
        if (conn.provider !== 'whatsapp_cloud') return { connectionId: conn.id, template: null };
        const tpl = input.verify_template ?? null;
        if (!tpl) throw bad('signature_code_template', 'Con la API oficial de WhatsApp el código sale en una plantilla aprobada: elige cuál.');
        const [hit] = await tx
            .select({ name: whatsappTemplates.name, language: whatsappTemplates.language, components: whatsappTemplates.components, parameterFormat: whatsappTemplates.parameterFormat })
            .from(whatsappTemplates)
            .where(
                and(
                    eq(whatsappTemplates.tenantId, tenantId),
                    eq(whatsappTemplates.connectionId, conn.id),
                    eq(whatsappTemplates.name, tpl.name),
                    eq(whatsappTemplates.language, tpl.language),
                    eq(whatsappTemplates.status, 'APPROVED'),
                ),
            )
            .limit(1);
        if (!hit) throw bad('signature_code_template', `La plantilla «${tpl.name}» (${tpl.language}) no está aprobada en esa conexión: actualiza las plantillas o elige otra.`);
        const check = whatsappCodeTemplateCheck(hit.components, hit.parameterFormat);
        if (!check.usable) throw bad('signature_code_template', `La plantilla «${tpl.name}» no sirve para el código: ${check.reason}`);
        return { connectionId: conn.id, template: { name: hit.name, language: hit.language } };
    }

    private async tenantAccessFull(tenantId: number): Promise<boolean> {
        return this.tenantDb.withTenant(tenantId, async (tx) => (await tenantAccessInTx(tx, tenantId)).state === 'full');
    }

    /** Revisa el código (cuenta el intento) sin consumirlo. */
    private async checkCode(signerId: number, code: string | undefined): Promise<void> {
        const raw = await this.redis.get(this.codeKey(signerId));
        if (!raw) throw bad('signature_code_expired', 'Pide un código nuevo: el anterior venció o no pediste ninguno.');
        const saved = JSON.parse(raw) as { h: string; t: number };
        if (saved.t >= CODE_MAX_TRIES) {
            await this.redis.del(this.codeKey(signerId)).catch(() => undefined);
            throw bad('signature_code_expired', 'Te equivocaste varias veces. Pide un código nuevo.');
        }
        const ok = typeof code === 'string' && /^\d{6}$/.test(code) && createHash('sha256').update(code).digest('hex') === saved.h;
        if (!ok) {
            const ttl = await this.redis.ttl(this.codeKey(signerId)).catch(() => CODE_TTL_S);
            await this.redis.set(this.codeKey(signerId), JSON.stringify({ h: saved.h, t: saved.t + 1 }), 'EX', Math.max(1, ttl > 0 ? ttl : CODE_TTL_S));
            const left = CODE_MAX_TRIES - saved.t - 1;
            throw bad('signature_code_invalid', left > 0 ? `El código no coincide. Te quedan ${left} ${left === 1 ? 'intento' : 'intentos'}.` : 'El código no coincide. Pide un código nuevo.');
        }
    }

    async sign(token: string, input: SubmitSignatureInput, meta: { ip?: string; userAgent?: string }): Promise<{ status: SignatureRequestStatus; signed_available: boolean }> {
        await this.limitIp(meta.ip, 'sign', 60);
        const ctx = await this.resolveToken(token);
        if (await this.surfaceOff(ctx.request.tenantId)) throw notFound();
        this.assertSignable(ctx);
        if ((await this.tenantAccessFull(ctx.request.tenantId)) === false) throw linkGone('La empresa no puede recibir firmas en este momento.', 'signature_unavailable');
        if (ctx.request.verify !== 'none') await this.checkCode(ctx.signer.id, input.code);
        // La imagen: se normaliza a un PNG chico (sharp); sin sharp, se acepta tal cual si es PNG.
        const png = await normalizeSignaturePng(input.image);

        const tenantId = ctx.request.tenantId;
        const base = await this.base(tenantId);
        const b = await this.brand(tenantId);
        const consent = signatureConsentText(b.company);
        const uploads: StoredFileRef[] = [];
        let outcome: { completed: boolean; request: SignatureRequestRow; signedBytes: Buffer | null };
        try {
            outcome = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const [r] = await tx.select().from(signatureRequests).where(eq(signatureRequests.id, ctx.request.id)).for('update').limit(1);
                if (!r) throw notFound();
                const [s] = await tx.select().from(signatureSigners).where(eq(signatureSigners.id, ctx.signer.id)).limit(1);
                if (!s) throw notFound();
                this.assertSignable({ request: r, signer: s });
                const all = await tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, r.id)).orderBy(asc(signatureSigners.position));
                const due = new Set(signersDue(r.orderMode as 'parallel' | 'sequential', all.map((x) => ({ ...x, status: x.status as SignerStatus }))).map((x) => x.id));
                if (!due.has(s.id)) throw new ConflictException({ code: 'signature_not_due', message: 'Todavía no te toca firmar.', data: { status: 409 } });
                const now = new Date();
                await tx
                    .update(signatureSigners)
                    .set({
                        status: 'signed',
                        signedAt: now,
                        signedName: input.name.trim().slice(0, 120),
                        signatureKind: input.kind,
                        signaturePng: png,
                        ip: (meta.ip ?? '').slice(0, 64) || null,
                        userAgent: (meta.userAgent ?? '').slice(0, 400) || null,
                        verifiedBy: r.verify,
                        consentText: consent,
                    })
                    .where(eq(signatureSigners.id, s.id));
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId: r.listId,
                    recordId: r.recordId,
                    userId: null,
                    action: 'signature',
                    diff: { signature: { event: 'signed', request_id: r.id, title: r.title, name: input.name.trim().slice(0, 120), signed: all.filter((x) => x.status === 'signed').length + 1, total: all.length } },
                });
                const remaining = all.filter((x) => x.id !== s.id && x.status !== 'signed');
                if (remaining.length > 0) return { completed: false, request: r, signedBytes: null };

                // ── Firmaron todos: constancia + PDF firmado, en este mismo tx.
                const signed = await tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, r.id)).orderBy(asc(signatureSigners.position));
                const requester = r.createdBy ? (await this.userNames(tx, [r.createdBy])).get(r.createdBy) ?? null : null;
                const numberLabel = r.documentNumberId
                    ? ((await tx.select({ label: documentNumbers.label }).from(documentNumbers).where(eq(documentNumbers.id, r.documentNumberId)).limit(1))[0]?.label ?? r.documentLabel)
                    : r.documentLabel;
                const constanciaSigners: ConstanciaSigner[] = signed.map((x) => ({
                    name: x.signedName ?? x.name,
                    email: x.email,
                    role: x.role,
                    signedAt: (x.signedAt ?? now).toISOString(),
                    ip: x.ip ?? '',
                    userAgent: x.userAgent ?? '',
                    verifiedBy: x.verifiedBy === 'email' || x.verifiedBy === 'sms' || x.verifiedBy === 'whatsapp' ? x.verifiedBy : 'none',
                    phone: x.phone,
                    kind: x.signatureKind === 'typed' ? 'typed' : 'drawn',
                    signaturePng: x.signaturePng ?? '',
                }));
                const original = await this.readFile(tenantId, r.originalFileId, tx);
                if (sha256Hex(original) !== r.originalSha256) {
                    throw new ConflictException({ code: 'signature_original_changed', message: 'El documento original no coincide con su huella: no se puede completar la firma.', data: { status: 409 } });
                }
                const verifyUrl = this.verifyUrl(base, r.code);
                const constancia = await renderPlainPdfDefinition(
                    constanciaDefinition({
                        title: r.title,
                        company: b.company,
                        code: r.code,
                        documentNumber: numberLabel ?? null,
                        originalSha256: r.originalSha256,
                        pages: r.pages,
                        createdAt: r.createdAt.toISOString(),
                        completedAt: now.toISOString(),
                        requestedBy: requester,
                        verifyUrl,
                        consentText: consent,
                        signers: constanciaSigners,
                        formatWhen: (v) => this.when(b, v),
                    }),
                );
                let host = verifyUrl;
                try {
                    host = new URL(base).host;
                } catch {
                    /* el enlace completo */
                }
                const signedBytes = await buildSignedPdf(original, constancia, { stamp: stampText(r.code, host, signed.length), title: r.title });
                const stored = await this.files.storeBufferInTx(tx, tenantId, r.createdBy ?? 0, signedFilename(r.title), 'application/pdf', signedBytes);
                uploads.push(stored.ref);
                await tx
                    .update(signatureRequests)
                    .set({ status: 'completed', completedAt: now, signedFileId: stored.id, signedSha256: sha256Hex(signedBytes), updatedAt: now })
                    .where(eq(signatureRequests.id, r.id));
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId: r.listId,
                    recordId: r.recordId,
                    userId: null,
                    action: 'signature',
                    diff: { signature: { event: 'completed', request_id: r.id, title: r.title, total: signed.length } },
                });
                return { completed: true, request: { ...r, status: 'completed', completedAt: now, signedFileId: stored.id }, signedBytes };
            });
        } catch (err) {
            await this.files.discardBytes(tenantId, uploads);
            throw err;
        }
        await this.redis.del(this.codeKey(ctx.signer.id)).catch(() => undefined);
        this.realtime?.records(tenantId, outcome.request.listId);

        if (!outcome.completed) {
            // En orden: ahora le toca al siguiente.
            await this.dispatchDue(outcome.request.id, tenantId, { send: true });
            this.notifyRequester(outcome.request, `${input.name.trim()} firmó «${outcome.request.title}»`, 'Faltan otras firmas.');
            await this.emitEvent(outcome.request, 'signed', { who: { ...ctx.signer, signedName: input.name.trim().slice(0, 120) } });
            return { status: 'pending', signed_available: false };
        }
        await this.afterCompleted(outcome.request, outcome.signedBytes!);
        // «Firmaron todos» lleva a quien firmó último ({{firma.firmante}}).
        const who = { ...ctx.signer, signedName: input.name.trim().slice(0, 120) };
        await this.emitEvent(outcome.request, 'signed', { who });
        await this.emitEvent(outcome.request, 'completed', { who });
        return { status: 'completed', signed_available: true };
    }

    /** Lo que pasa en el registro y los correos cuando firman todos. Nada de esto deshace la firma. */
    private async afterCompleted(r: SignatureRequestRow, signedBytes: Buffer): Promise<void> {
        const oc = signatureOnCompleteSchema.safeParse(r.onComplete ?? {});
        const warnings: string[] = [];
        if (oc.success) {
            const o = oc.data;
            const data: Record<string, unknown> = {};
            try {
                const fields = await this.fields.listByListId(r.tenantId, r.listId);
                const byId = new Map(fields.map((f) => [f.id, f]));
                const current = await this.tenantDb.withTenant(r.tenantId, async (tx) => {
                    const [row] = await tx
                        .select({ data: records.data })
                        .from(records)
                        .where(and(eq(records.tenantId, r.tenantId), eq(records.id, r.recordId), isNull(records.deletedAt)))
                        .limit(1);
                    return (row?.data as Record<string, unknown> | undefined) ?? null;
                });
                if (current) {
                    if (o.save_field_id !== null && byId.get(o.save_field_id)?.type === 'file' && r.signedFileId) {
                        const key = jsonbKeyForField(o.save_field_id);
                        data[key] = [...fileIdsIn(current[key]), r.signedFileId];
                    }
                    if (o.status_field_id !== null && o.status_value && byId.get(o.status_field_id)?.type === 'select') {
                        data[jsonbKeyForField(o.status_field_id)] = o.status_value;
                    }
                    if (o.date_field_id !== null) {
                        const t = byId.get(o.date_field_id)?.type;
                        const at = r.completedAt ?? new Date();
                        if (t === 'datetime') data[jsonbKeyForField(o.date_field_id)] = at.toISOString();
                        else if (t === 'date') {
                            const tz = (await this.timeZones?.orUtc(r.tenantId).catch(() => 'UTC')) ?? 'UTC';
                            data[jsonbKeyForField(o.date_field_id)] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
                        }
                    }
                }
                if (Object.keys(data).length > 0) {
                    await this.records.update(r.tenantId, SYSTEM_ACTOR, String(r.listId), r.recordId, { data } as never, { serverDecided: true });
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                warnings.push(msg);
                this.logger.warn(`Firma ${r.id}: no se pudo actualizar el registro al completar: ${msg}`);
            }
        }
        if (warnings.length > 0) {
            await this.tenantDb
                .withTenant(r.tenantId, (tx) =>
                    this.activity.logInTx(tx, {
                        tenantId: r.tenantId,
                        listId: r.listId,
                        recordId: r.recordId,
                        userId: null,
                        action: 'signature',
                        diff: { signature: { event: 'completed', request_id: r.id, title: r.title, warning: warnings[0]!.slice(0, 300) } },
                    }),
                )
                .catch(() => undefined);
        }
        // Correo a cada persona con el PDF firmado (si no pesa demasiado; si no, el enlace).
        const signers = await this.tenantDb.withTenant(r.tenantId, (tx) => tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, r.id)));
        await this.sendToSigners(r, signers, 'completed', {
            attachment: signedBytes.length <= MAX_ATTACH_BYTES ? { filename: signedFilename(r.title), bytes: signedBytes } : null,
        });
        this.notifyRequester(r, `Firmaron todos: «${r.title}»`, 'El documento firmado quedó en la ficha del registro.');
        this.realtime?.records(r.tenantId, r.listId);
    }

    private notifyRequester(r: SignatureRequestRow, title: string, body: string): void {
        if (!this.notify || !r.createdBy) return;
        this.notify.emit({ type: 'signature', tenantId: r.tenantId, listId: r.listId, recordId: r.recordId, userIds: [r.createdBy], title: title.slice(0, 200), body });
    }

    async decline(token: string, input: DeclineSignatureInput, meta: { ip?: string }): Promise<{ status: SignatureRequestStatus }> {
        await this.limitIp(meta.ip, 'sign', 60);
        const ctx = await this.resolveToken(token);
        if (await this.surfaceOff(ctx.request.tenantId)) throw notFound();
        this.assertSignable(ctx);
        const tenantId = ctx.request.tenantId;
        const others = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(signatureRequests).where(eq(signatureRequests.id, ctx.request.id)).for('update').limit(1);
            if (!r) throw notFound();
            const [s] = await tx.select().from(signatureSigners).where(eq(signatureSigners.id, ctx.signer.id)).limit(1);
            if (!s) throw notFound();
            this.assertSignable({ request: r, signer: s });
            const now = new Date();
            await tx.update(signatureSigners).set({ status: 'declined', declinedAt: now, declineReason: input.reason }).where(eq(signatureSigners.id, s.id));
            await tx.update(signatureRequests).set({ status: 'declined', updatedAt: now }).where(eq(signatureRequests.id, r.id));
            await this.activity.logInTx(tx, {
                tenantId,
                listId: r.listId,
                recordId: r.recordId,
                userId: null,
                action: 'signature',
                diff: { signature: { event: 'declined', request_id: r.id, title: r.title, name: s.name, reason: input.reason.slice(0, 300) } },
            });
            return tx.select().from(signatureSigners).where(and(eq(signatureSigners.requestId, r.id), inArray(signatureSigners.status, ['sent', 'viewed', 'signed'])));
        });
        await this.sendToSigners({ ...ctx.request, status: 'declined' }, others, 'declined', { declinedBy: ctx.signer.name, reason: null });
        this.notifyRequester(ctx.request, `${ctx.signer.name} no firmó «${ctx.request.title}»`, `Motivo: ${input.reason.slice(0, 200)}`);
        this.realtime?.records(tenantId, ctx.request.listId);
        await this.emitEvent(ctx.request, 'declined', { who: ctx.signer, reason: input.reason.slice(0, 1000) });
        return { status: 'declined' };
    }

    // ─────────────────────────── Verificación pública ───────────────────────────

    async verifyInfo(code: string, meta: { ip?: string }): Promise<{
        found: boolean;
        title?: string;
        company?: string;
        status?: SignatureRequestStatus;
        original_sha256?: string;
        signed_sha256?: string | null;
        completed_at?: string | null;
        signers?: Array<{ name: string; role: string; signed_at: string | null; status: SignerStatus }>;
        formatWhen?: (iso: string) => string;
    }> {
        await this.limitIp(meta.ip, 'verify', 120);
        const clean = String(code ?? '').toUpperCase().trim();
        if (!/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(clean)) return { found: false };
        const [r] = await this.db.select().from(signatureRequests).where(eq(signatureRequests.code, clean)).limit(1);
        if (!r || (await this.surfaceOff(r.tenantId))) return { found: false };
        const signers = await this.tenantDb.withTenant(r.tenantId, (tx) => tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, r.id)).orderBy(asc(signatureSigners.position)));
        const b = await this.brand(r.tenantId);
        return {
            found: true,
            title: r.title,
            company: b.company,
            status: this.effectiveStatus(r),
            original_sha256: r.originalSha256,
            signed_sha256: r.signedSha256,
            completed_at: iso(r.completedAt),
            signers: signers.map((s) => ({ name: s.signedName ?? s.name, role: s.role, signed_at: iso(s.signedAt), status: s.status as SignerStatus })),
            formatWhen: (v) => this.when(b, v),
        };
    }

    /**
     * v0.1.447 — Verificar subiendo el PDF: la página calcula la huella en el
     * navegador (el archivo nunca viaja) y pregunta por ella. Saber la huella
     * exige tener el documento, así que contestar de qué firma es no revela
     * nada nuevo. Primero el PDF firmado; si no, un original (la última que
     * se firmó, si hay varias con el mismo documento).
     */
    async lookupByHash(sha256: string, meta: { ip?: string }): Promise<{
        found: boolean;
        which?: 'signed' | 'original';
        code?: string;
        title?: string;
        company?: string;
        status?: SignatureRequestStatus;
    }> {
        await this.limitIp(meta.ip, 'verify-hash', 60);
        const hash = String(sha256 ?? '').toLowerCase().trim();
        if (!/^[0-9a-f]{64}$/.test(hash)) return { found: false };
        const pick = async (which: 'signed' | 'original'): Promise<SignatureRequestRow | null> => {
            const col = which === 'signed' ? signatureRequests.signedSha256 : signatureRequests.originalSha256;
            const rows = await this.db
                .select()
                .from(signatureRequests)
                .where(eq(col, hash))
                .orderBy(sql`CASE WHEN ${signatureRequests.status} = 'completed' THEN 0 ELSE 1 END`, desc(signatureRequests.id))
                .limit(5);
            for (const r of rows) if (!(await this.surfaceOff(r.tenantId))) return r;
            return null;
        };
        const signed = await pick('signed');
        const r = signed ?? (await pick('original'));
        if (!r) return { found: false };
        const b = await this.brand(r.tenantId);
        return { found: true, which: signed ? 'signed' : 'original', code: r.code, title: r.title, company: b.company, status: this.effectiveStatus(r) };
    }

    // ─────────────────────────── Barrido: vencer y recordar ───────────────────────────

    async tick(now = new Date()): Promise<{ expired: number; reminded: number }> {
        let expired = 0;
        let reminded = 0;
        // Vencidas (por la conexión base: cruza empresas; cada cambio va en su tx con scope).
        const overdue = await this.db
            .select({ id: signatureRequests.id, tenantId: signatureRequests.tenantId })
            .from(signatureRequests)
            .where(and(eq(signatureRequests.status, 'pending'), lt(signatureRequests.expiresAt, now)))
            .orderBy(asc(signatureRequests.expiresAt))
            .limit(200);
        for (const o of overdue) {
            try {
                const done = await this.tenantDb.withTenant(o.tenantId, async (tx) => {
                    const [r] = await tx.select().from(signatureRequests).where(eq(signatureRequests.id, o.id)).for('update').limit(1);
                    if (!r || r.status !== 'pending' || r.expiresAt.getTime() >= now.getTime()) return null;
                    await tx.update(signatureRequests).set({ status: 'expired', updatedAt: now }).where(eq(signatureRequests.id, r.id));
                    await this.activity.logInTx(tx, { tenantId: r.tenantId, listId: r.listId, recordId: r.recordId, userId: null, action: 'signature', diff: { signature: { event: 'expired', request_id: r.id, title: r.title } } });
                    return r;
                });
                if (done) {
                    expired += 1;
                    this.notifyRequester(done, `Venció la firma de «${done.title}»`, 'No firmaron todos a tiempo. Puedes volver a pedirla.');
                    this.realtime?.records(done.tenantId, done.listId);
                    await this.emitEvent(done, 'expired');
                }
            } catch (err) {
                this.logger.warn(`Firma ${o.id}: no se pudo vencer: ${String(err)}`);
            }
        }
        // Recordatorios: a quien recibió el enlace y no respondió, cada `remind_days` días (máximo 3).
        const due = await this.db
            .select({ signer: signatureSigners, request: signatureRequests })
            .from(signatureSigners)
            .innerJoin(signatureRequests, eq(signatureRequests.id, signatureSigners.requestId))
            .where(
                and(
                    inArray(signatureSigners.status, ['sent', 'viewed']),
                    eq(signatureRequests.status, 'pending'),
                    sql`${signatureRequests.remindDays} > 0`,
                    sql`${signatureSigners.remindersSent} < ${MAX_REMINDERS}`,
                    sql`${signatureRequests.expiresAt} > ${now}`,
                    sql`COALESCE(${signatureSigners.lastRemindedAt}, ${signatureSigners.sentAt}) < ${now}::timestamptz - make_interval(days => ${signatureRequests.remindDays})`,
                ),
            )
            .limit(200);
        for (const d of due) {
            try {
                if (await this.surfaceOff(d.request.tenantId)) continue;
                const claimed = await this.tenantDb.withTenant(d.request.tenantId, (tx) =>
                    tx
                        .update(signatureSigners)
                        .set({ remindersSent: sql`${signatureSigners.remindersSent} + 1`, lastRemindedAt: now })
                        .where(and(eq(signatureSigners.id, d.signer.id), eq(signatureSigners.remindersSent, d.signer.remindersSent)))
                        .returning({ id: signatureSigners.id }),
                );
                if (claimed.length === 0) continue;
                const requester = d.request.createdBy ? (await this.tenantDb.withTenant(d.request.tenantId, (tx) => this.userNames(tx, [d.request.createdBy!]))).get(d.request.createdBy) ?? null : null;
                reminded += await this.sendToSigners(d.request, [d.signer], 'reminder', { requester });
            } catch (err) {
                this.logger.warn(`Firma ${d.request.id}: recordatorio a ${d.signer.id} falló: ${String(err)}`);
            }
        }
        return { expired, reminded };
    }
}

/**
 * La firma como PNG chico y sin metadatos (`sharp`). La imagen viene del
 * navegador: se re-codifica siempre (nada de lo que mandó queda tal cual) y se
 * acota a 900×300. Sin `sharp` (instalación rara), un PNG válido se acepta.
 */
async function normalizeSignaturePng(dataUrl: string): Promise<string> {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
        throw bad('signature_image_invalid', 'La firma no es una imagen válida. Vuelve a firmar.');
    }
    try {
        const sharp = (await import('sharp')).default;
        const meta = await sharp(buf, { limitInputPixels: 4_000_000 }).metadata();
        if (!meta.width || !meta.height) throw new Error('sin tamaño');
        const out = await sharp(buf, { limitInputPixels: 4_000_000 })
            .resize({ width: 900, height: 300, fit: 'inside', withoutEnlargement: true })
            .png({ compressionLevel: 9 })
            .toBuffer();
        // Una firma vacía (todo transparente o blanco) no vale.
        const stats = await sharp(out).stats();
        const alpha = stats.channels[3];
        const inked = alpha ? alpha.max > 0 && alpha.mean > 0.2 : stats.channels.some((c) => c.min < 200);
        if (!inked) throw bad('signature_image_empty', 'La firma está vacía. Dibújala o escribe tu nombre.');
        return out.toString('base64');
    } catch (err) {
        if (err instanceof HttpException) throw err;
        if (/sin tamaño|Input buffer|unsupported/i.test(String(err))) throw bad('signature_image_invalid', 'La firma no es una imagen válida. Vuelve a firmar.');
        return buf.toString('base64');
    }
}

/** Para los tests: el token de un firmante tal como lo arma el servicio. */
export function signatureTokenFor(service: SignaturesService, r: Pick<SignatureRequestRow, 'tenantId' | 'id' | 'linkVersion'>, signerId: number): string {
    return (service as unknown as { token: (r: Pick<SignatureRequestRow, 'tenantId' | 'id' | 'linkVersion'>, s: number) => string }).token(r, signerId);
}

