import { randomBytes } from 'node:crypto';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import {
    autoPortalLayout,
    brandingSchema,
    buttonPortalProblems,
    buttonDisabledState,
    FALLBACK_TIME_ZONE,
    readButtonConfig,
    type PressButtonResult,
    DATA_BLOCK_TYPES,
    layoutBlocks,
    migratePortalTemplateToV3,
    portalEditableFieldIds,
    readPortalConfig,
    readPortalLayoutV3,
    readPortalPaymentsConfig,
    readStoreListMarker,
    sanitizePortalLayout,
    tenantFormatSchema,
    isUserWritableType,
    checkRequiredIf,
    jsonbKeyForField,
    resolveTitleFieldId,
    validateFieldValue,
    type ActivityDto,
    type Field,
    type FieldType,
    type IssueMagicLinkInput,
    type LayoutBlock,
    type LayoutFieldLite,
    type RecordLayoutV3,
    type MagicLinkResult,
    type PortalBoot,
    type PortalPaymentLink,
    type PortalPaymentsBlockConfig,
    type PortalPaymentsBlockData,
    type PortalPayResult,
    type PortalAccessCheck,
    type PortalAccessList,
    type PortalAccounts,
    type PortalEmailLinkResult,
    type PortalSwitchResult,
    type PortalCommentInput,
    type CommentReactionEmoji,
    type PortalLinkedList,
    type PortalRelatedList,
    type PortalUpdateMeInput,
    type PortalCommentDto,
    type PortalCreatableList,
    type PortalConsentDto,
} from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ActivityRepository } from '../activity/activity.repository';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { SessionService } from '../auth/session.service';
import { CollectionsService } from '../collections/collections.service';
import { CommentsRepository } from '../comments/comments.repository';
import { DataConsentService } from '../data-consent/data-consent.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { DocumentsService } from '../documents/documents.service';
import { DomainsService } from '../domains/domains.service';
import { RecordLayoutDataService } from '../dashboards/record-layout-data.service';
import { documentTemplates, fields, lists, memberships, paymentLinks, portalCredentials, portalLinks, records, relations, users, tenants } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { NotifyHub } from '../notifications/notify-hub';
import { RecordChangeHub } from '../records/record-change-hub';
import { portalAccessEmail, portalReplyEmail, senderName, type PortalEmailBrand } from './portal-email';
import { RecordsService } from '../records/records.service';
import { ButtonsService } from '../buttons/buttons.service';
import { filterActivityDiff, portalConversation, portalRecordFieldIds } from './portal-visibility';

const MAGIC_TTL_SECONDS = 60 * 60 * 24; // 24h
/** Tipos que el cliente nunca completa al crear un registro desde el portal. */
const PORTAL_CREATE_EXCLUDED_TYPES = new Set<string>(['relation', 'user', 'file']);
/** v0.1.241 — el enlace que acuña "cambiar a otra empresa" se usa al instante. */
const SWITCH_TTL_SECONDS = 120;
const magicKey = (token: string) => `magic:${token}`;

interface MagicPayload {
    userId: number;
    tenantId: number;
    /** v0.1.241 — el acceso (registro) que abre el enlace. */
    linkId?: number;
    /**
     * v0.1.241 — el enlace llegó SÓLO al correo de la persona (la empresa no
     * pudo copiarlo): la sesión que abra puede ver sus cuentas de otras
     * empresas. Un enlace que se le devolvió a la empresa jamás lo lleva.
     */
    account?: boolean;
}

/** `ana@gmail.com` → `an***@gmail.com` (para decir a dónde salió un correo). */
function maskEmail(email: string): string {
    const [local = '', domain = ''] = email.split('@');
    return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

/**
 * Portal del cliente (CONTRACT.md §9). Un admin emite un magic link para un
 * record → se crea (si hace falta) un usuario `client` vinculado a ese record.
 * El token de un solo uso vive en Redis; al consumirlo se abre una sesión.
 */
/**
 * Quién llama a un endpoint del portal: el usuario de la sesión y la empresa
 * cuyo enlace canjeó (SEC-24). `tenantId` es `null` sólo en sesiones creadas
 * antes de v0.1.225.
 */
export interface PortalActor {
    userId: number;
    tenantId: number | null;
    /** v0.1.241 — acceso con el que se abrió la sesión (el que se muestra por defecto). */
    linkId?: number;
    /** v0.1.241 — acceso elegido en el portal (`X-Portal-Account`). */
    requestedLinkId?: number;
    /** v0.1.241 — la sesión ve las cuentas de todas sus empresas. */
    account?: boolean;
}

/** Lo que el portal de una lista muestra (ver `portalCtx`). */
interface PortalCtx {
    list: { id: number; slug: string; name: string; settings: Record<string, unknown> };
    fields: Field[];
    titleFieldId: number | null;
    layout: RecordLayoutV3;
    origin: 'saved' | 'legacy' | 'auto';
    editableIds: Set<number>;
    /** Campos del registro que le llegan al cliente. */
    visible: Set<number>;
    conversation: { comments: boolean; writable: boolean; activity: boolean };
}

/** «Ana María Pérez» → «Ana»; un email o vacío → ''. */
function firstName(name: string | null | undefined): string {
    const n = (name ?? '').trim();
    if (n === '' || n.includes('@')) return '';
    return n.split(/\s+/)[0] ?? '';
}

/** Un aviso de respuesta por registro y cliente cada 15 minutos (no un correo por mensaje). */
const REPLY_EMAIL_WINDOW_S = 15 * 60;

/** v0.1.289 — campos del registro que sirven como monto del botón «Pagar». */
const PAYABLE_AMOUNT_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'computed', 'rollup']);

@Injectable()
export class PortalService implements OnModuleInit {
    private readonly inFlight = new Set<Promise<void>>();
    private readonly logger = new Logger(PortalService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly sessions: SessionService,
        private readonly mail: MailService,
        private readonly fields: FieldsService,
        private readonly commentsRepo: CommentsRepository,
        private readonly activityRepo: ActivityRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly automations: AutomationDispatcher,
        private readonly files: FilesService,
        private readonly domains: DomainsService,
        private readonly layoutData: RecordLayoutDataService,
        @Optional() private readonly documents?: DocumentsService,
        // Un cambio o un comentario del cliente avisa como cualquier otro:
        // seguidores, campos con IA, tienda sincronizada (RecordChangeHub) y
        // la bandeja del equipo (NotifyHub).
        @Optional() private readonly changes?: RecordChangeHub,
        @Optional() private readonly notify?: NotifyHub,
        // El cliente crea registros (abre un ticket) por el MISMO camino que
        // la app: validación, límite del plan, actividad, automatizaciones.
        @Optional() private readonly records_?: RecordsService,
        // v0.1.289 — el bloque «Pagos»: links de pago del cliente y «Pagar».
        @Optional() private readonly collections?: CollectionsService,
        // Ley 1581 — sin aceptar la autorización de datos, el portal no se usa.
        @Optional() private readonly dataConsent?: DataConsentService,
        // Campo «Botón» — los botones que el diseño del portal muestra.
        @Optional() private readonly buttons?: ButtonsService,
    ) {}

    onModuleInit(): void {
        // Cuando el equipo le escribe al cliente (comentario visible para él),
        // le llega un correo — salvo que lo haya apagado.
        this.notify?.subscribe((e) => {
            if (e.type !== 'comment' || e.visibility !== 'client' || e.fromClient) return;
            return this.emailClientsAboutReply(e).then(
                () => undefined,
                (err: unknown) => this.logger.warn(`Aviso de respuesta al cliente: ${err instanceof Error ? err.message : String(err)}`),
            );
        });
    }

    /**
     * Correo a los clientes con acceso al registro cuando el equipo publica un
     * comentario visible para ellos. Respeta su preferencia (opt-out en el
     * portal), el portal apagado y un freno de un correo cada 15 minutos por
     * registro y cliente. Devuelve a cuántos les salió.
     */
    async emailClientsAboutReply(e: { tenantId: number; listId: number; recordId: number; actorId: number; body: string }): Promise<number> {
        if (await this.portalSwitchedOff(e.tenantId, e.listId)) return 0;
        if ((await this.liveRecordIds(e.tenantId, [e.recordId])).size === 0) return 0;
        const links = await this.db
            .select({ id: portalLinks.id, userId: portalLinks.userId, email: users.email, disabledAt: users.disabledAt })
            .from(portalLinks)
            .innerJoin(users, eq(users.id, portalLinks.userId))
            .where(and(eq(portalLinks.tenantId, e.tenantId), eq(portalLinks.recordId, e.recordId)))
            .limit(20);
        if (links.length === 0) return 0;
        const { author, recordTitle } = await this.tenantDb.withTenant(e.tenantId, async (tx) => {
            const [actor] = await tx.select({ name: users.name }).from(users).where(eq(users.id, e.actorId)).limit(1);
            const ctx = await this.portalCtx(tx, e.tenantId, e.listId);
            const [rec] = await tx.select({ data: records.data }).from(records).where(eq(records.id, e.recordId)).limit(1);
            const raw = ctx.titleFieldId !== null ? (rec?.data as Record<string, unknown> | undefined)?.[`f${ctx.titleFieldId}`] : null;
            return { author: firstName(actor?.name), recordTitle: typeof raw === 'string' ? raw : '' };
        });
        const base = await this.domains.baseUrlFor(e.tenantId, 'portal');
        const brand = await this.emailBrand(e.tenantId, base);
        let sent = 0;
        for (const l of links) {
            if (l.disabledAt !== null || l.userId === e.actorId) continue;
            const wants = await this.tenantDb.withTenant(e.tenantId, (tx) => this.notifyEmailPref(tx, e.tenantId, l.userId));
            if (!wants) continue;
            const key = `portalreply:${e.tenantId}:${e.recordId}:${l.userId}`;
            const fresh = await this.redis.set(key, '1', 'EX', REPLY_EMAIL_WINDOW_S, 'NX').catch(() => 'OK');
            if (fresh !== 'OK') continue;
            const message = portalReplyEmail(brand, `${base}/portal?cuenta=${l.id}`, {
                author: author || brand.name,
                snippet: e.body,
                recordTitle,
            });
            try {
                await this.mail.sendNow({
                    tenantId: e.tenantId,
                    to: l.email,
                    subject: message.subject,
                    text: message.text,
                    html: message.html,
                    ...(brand.name.trim() === '' ? {} : { fromName: senderName(brand.name), fromNameSoft: true }),
                });
                sent++;
            } catch (err) {
                this.logger.warn(`Aviso de respuesta a ${maskEmail(l.email)}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return sent;
    }

    /** PATCH /portal/me/preferences — el cliente decide si recibe correos de respuesta. */
    async setPreferences(actor: PortalActor, input: { notify_email: boolean }): Promise<{ notify_email: boolean }> {
        const link = await this.requireLink(actor);
        await this.tenantDb.withTenant(link.tenantId, (tx) =>
            tx
                .update(memberships)
                .set({ settings: sql`coalesce(${memberships.settings}, '{}'::jsonb) || jsonb_build_object('portal_notify', ${input.notify_email}::boolean)` })
                .where(and(eq(memberships.tenantId, link.tenantId), eq(memberships.userId, actor.userId))),
        );
        return { notify_email: input.notify_email };
    }

    /**
     * POST /portal/lists/:listId/records — el cliente crea un registro (abre un
     * ticket, hace un pedido) en una lista que la empresa habilitó para eso.
     * Sólo los campos permitidos; la relación hacia SU registro la pone el
     * servidor (nunca el cliente). Avisa a quien sigue su registro.
     */
    async createRecord(actor: PortalActor, listId: number, input: { fields: Record<string, unknown> }): Promise<{ id: number }> {
        const link = await this.requireLink(actor);
        const tenantId = link.tenantId;
        if (!this.records_) throw portalGone();
        const target = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.assertWritable(tx, tenantId);
            const ctx = await this.portalCtx(tx, tenantId, link.listId);
            const t = (await this.creatableTargets(tx, tenantId, ctx)).find((x) => x.listId === listId);
            if (!t) {
                throw new NotFoundException({
                    code: 'portal_list_not_creatable',
                    message: 'Aquí no se pueden crear registros',
                    data: { status: 404 },
                });
            }
            return t;
        });
        const allowed = new Map(target.fields.map((f) => [String(f.id), f]));
        const data: Record<string, unknown> = {};
        const errors: Record<string, string> = {};
        for (const [key, value] of Object.entries(input.fields)) {
            const field = allowed.get(key);
            if (!field) {
                throw new ForbiddenException({
                    code: 'portal_field_forbidden',
                    message: 'Ese dato no se puede completar desde el portal',
                    data: { status: 403 },
                });
            }
            const res = validateFieldValue({ type: field.type, config: field.config, is_required: field.is_required }, value);
            if (!res.ok) errors[key] = res.error;
            else if (res.value !== null && res.value !== undefined) data[jsonbKeyForField(field.id)] = res.value;
        }
        for (const f of target.fields) {
            if (f.is_required && (data[jsonbKeyForField(f.id)] === undefined || data[jsonbKeyForField(f.id)] === '')) {
                errors[String(f.id)] ??= 'Este dato es obligatorio.';
            }
        }
        if (Object.keys(errors).length > 0) {
            throw new BadRequestException({ code: 'validation_failed', message: 'Revisa los datos marcados.', data: { status: 400, errors } });
        }
        // El vínculo con el cliente lo pone el servidor.
        data[jsonbKeyForField(target.relationFieldId)] = [link.recordId];
        let created: { id: number; data: Record<string, unknown> };
        try {
            // Sin persona del equipo detrás (como un formulario público).
            created = await this.records_.create(tenantId, { userId: 0, role: 'admin' }, String(target.listId), { data });
        } catch (err) {
            if (err instanceof HttpException && err.getStatus() === 400) {
                throw new BadRequestException({
                    code: 'portal_create_failed',
                    message: 'No se pudo crear: la empresa pide datos que este formulario no tiene. Avísale a la empresa.',
                    data: { status: 400 },
                });
            }
            throw err;
        }
        const [me] = await this.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1);
        const titleField = target.fields.find((f) => f.type === 'text');
        const title = titleField ? String(created.data[jsonbKeyForField(titleField.id)] ?? '') : '';
        this.notify?.emit({
            type: 'portal_record_created',
            tenantId,
            listId: target.listId,
            recordId: created.id,
            actorId: actor.userId,
            clientName: (me?.name || me?.email || '').trim(),
            parentRecordId: link.recordId,
            title,
            listName: target.name,
        });
        return { id: created.id };
    }

    /**
     * Reemplaza los IDs de attachments de los campos `file` por URLs firmadas
     * de vida corta (1 h) — el rol client no tiene capabilities de records,
     * así el portal descarga sin sesión pero solo ESOS archivos (ADR-S16).
     */
    private signFileValues(
        tenantId: number,
        fields: Array<{ id: number; type: string }>,
        data: Record<string, unknown>,
        keyOf: (fieldId: number) => string,
    ): Record<string, unknown> {
        const fileFields = fields.filter((f) => f.type === 'file');
        if (fileFields.length === 0) return data;
        const out = { ...data };
        const signOne = (v: unknown): unknown =>
            typeof v === 'number' && v > 0 ? this.files.signedUrl(tenantId, v, 3600) : v;
        for (const f of fileFields) {
            const key = keyOf(f.id);
            const v = out[key];
            if (v === undefined || v === null) continue;
            out[key] = Array.isArray(v) ? v.map(signOne) : signOne(v);
        }
        return out;
    }

    async issue(
        tenantId: number,
        listIdOrSlug: string,
        input: IssueMagicLinkInput,
    ): Promise<MagicLinkResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);

        // SEC-24 (v0.1.225): una cuenta de la PLATAFORMA jamás es cliente de un
        // portal. Antes, cualquiera que se registrara pedía un enlace para el
        // email del superadmin (que no tiene membresías), lo canjeaba y quedaba
        // logueado como él.
        if (this.env.PLATFORM_SUPERADMINS.includes(input.email.toLowerCase())) {
            throw new ForbiddenException({
                code: 'portal_email_reserved',
                message: 'Ese email no puede usarse como cliente del portal',
                data: { status: 403 },
            });
        }

        const { userId, linkId, handOver } = await this.db.transaction(async (tx) => {
            await tx.execute(sql`set local role imagina_app`);
            await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`);

            // El record debe existir en la lista/tenant.
            const [record] = await tx
                .select({ id: records.id })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, list.id),
                        eq(records.id, input.record_id),
                        isNull(records.deletedAt),
                    ),
                )
                .limit(1);
            if (!record) {
                throw new NotFoundException({
                    code: 'record_not_found',
                    message: 'El record no existe en esta lista',
                    data: { status: 404 },
                });
            }

            // Usuario client (por email) — passwordless (hash aleatorio).
            const [existingUser] = await tx
                .select({ id: users.id, disabledAt: users.disabledAt })
                .from(users)
                .where(sql`lower(${users.email}) = ${input.email}`)
                .limit(1);
            if (existingUser?.disabledAt) {
                throw new ForbiddenException({
                    code: 'portal_user_disabled',
                    message: 'Esa cuenta está desactivada',
                    data: { status: 403 },
                });
            }
            let uid = existingUser?.id;
            if (uid === undefined) {
                const hash = await argon2.hash(randomBytes(32).toString('hex'));
                const [created] = await tx
                    .insert(users)
                    .values({ email: input.email, passwordHash: hash, name: input.email })
                    .returning({ id: users.id });
                uid = created!.id;
            }

            // set app.user_id para las policies self de memberships/portal_links.
            await tx.execute(sql`select set_config('app.user_id', ${String(uid)}, true)`);

            // ¿Es del EQUIPO de esta empresa? El portal es para sus clientes: a
            // su gente se le comparte la lista, no se le da un portal (y la
            // membresía de equipo no puede convivir con una de cliente).
            //
            // v0.1.241 — ser del equipo de OTRA empresa ya no impide nada: la
            // sesión que abre el enlace es sólo del portal (SEC-24: limitada a
            // `/portal/*`, a esta empresa y con su propia cookie), así que no
            // da acceso a la cuenta de trabajo de esa persona. Antes se
            // rechazaba (SEC-01, cuando una sesión del portal valía como una
            // sesión de la cuenta entera).
            const rolesAnywhere = await tx
                .select({ tenantId: memberships.tenantId, role: memberships.role })
                .from(memberships)
                .where(eq(memberships.userId, uid));
            const here = rolesAnywhere.find((m) => m.tenantId === tenantId);
            if (here && here.role !== 'client') {
                throw new ConflictException({
                    code: 'portal_email_is_staff',
                    message: 'Esa persona es del equipo de esta empresa; el portal es para clientes',
                    data: { status: 409 },
                });
            }
            const staffElsewhere = rolesAnywhere.some((m) => m.role !== 'client');

            await tx
                .insert(memberships)
                .values({ userId: uid, tenantId, role: 'client' })
                .onConflictDoNothing();
            // v0.1.241 — un acceso por REGISTRO. Antes el vínculo era único por
            // (persona, empresa) y dar acceso a otro registro REEMPLAZABA el
            // anterior en silencio: el cliente dejaba de ver su primera ficha.
            const [created] = await tx
                .insert(portalLinks)
                .values({ tenantId, userId: uid, listId: list.id, recordId: input.record_id })
                .onConflictDoNothing()
                .returning({ id: portalLinks.id });
            const [link] = created
                ? [created]
                : await tx
                      .select({ id: portalLinks.id })
                      .from(portalLinks)
                      .where(and(eq(portalLinks.userId, uid), eq(portalLinks.recordId, input.record_id)))
                      .limit(1);
            // SEC-24: el enlace se le puede DEVOLVER a quien lo pide (para
            // compartirlo a mano) sólo si la cuenta es de esta empresa: la creó
            // esta misma llamada o ya era su cliente. Una cuenta que existía por
            // su cuenta (cliente de otra empresa, un usuario sin workspace…) no
            // es de quien pide el enlace: a ella le llega por CORREO y nada más.
            // v0.1.241 — tampoco se devuelve el de alguien que trabaja en otra
            // empresa: su cuenta no es de esta.
            return {
                userId: uid,
                linkId: link!.id,
                handOver: existingUser === undefined || (here !== undefined && !staffElsewhere),
            };
        });

        // Email transaccional con el acceso. Con dominio propio (ADR-S17) el
        // link sale por el dominio del tenant. v0.1.150 — se envía EN EL ACTO
        // y el resultado VUELVE: antes un fallo del SMTP se tragaba y la UI
        // decía "enviado" igual.
        // v0.1.241 — un enlace que llega SÓLO al correo prueba que quien lo abre
        // es la dueña del email: esa sesión puede ver sus cuentas de otras
        // empresas. El que se le devuelve a la empresa queda en esta empresa.
        const result = await this.sendMagicLink(tenantId, userId, input.email, {
            linkId,
            account: !handOver,
        });
        return handOver ? result : { ...result, token: null, path: null, url: null };
    }

    /**
     * El propio cliente pide un enlace nuevo (v0.1.154). Sólo re-emite para
     * quien YA tiene acceso: nunca crea vínculos. La respuesta es SIEMPRE la
     * misma —exista o no el email— para que no sirva de directorio de "quién
     * es cliente de quién"; el resultado real llega por correo o no llega.
     *
     * Un mismo email puede tener portal en más de una empresa (el vínculo es
     * por usuario+tenant): se manda un enlace por cada una, con el nombre de
     * la empresa en el asunto.
     */
    async requestAccess(email: string, host?: string, empresa?: string): Promise<void> {
        // Freno de abuso por email (compartido entre nodos): 3 pedidos cada
        // 15 min. El rate limit por IP de `main.ts` es la otra mitad.
        const rlKey = `portalreq:${email}`;
        const attempts = await this.redis.incr(rlKey);
        if (attempts === 1) await this.redis.expire(rlKey, 900);
        if (attempts > 3) {
            this.logger.warn(`Pedidos de acceso al portal frenados para ${email}`);
            return;
        }
        // SEC-35 (v0.1.239): la búsqueda y el envío corren DESPUÉS de responder.
        // Antes la respuesta esperaba al SMTP sólo cuando el email era cliente
        // de alguien: medir cuánto tardaba alcanzaba para saber quién es
        // cliente de quién (el texto de la respuesta ya era siempre igual).
        // v0.1.245 — pedido desde el dominio de UNA empresa (su portal
        // white-label): sólo esa empresa reparte enlaces. Un cliente que entra
        // por el portal de Acme no tiene por qué recibir correos de otras
        // empresas (ni enterarse de cuáles usan la misma herramienta).
        // v0.1.289 — lo mismo desde el enlace de entrada de una empresa
        // (`?empresa=` en el dominio de la plataforma): sólo esa empresa.
        const job = (async () => {
            const scoped = await this.domains.resolveHost(host);
            const tenantId = scoped.tenant?.id ?? (empresa ? await this.tenantIdBySlug(empresa) : null);
            await this.deliverAccess(email, tenantId);
        })()
            .catch((err: unknown) =>
                this.logger.warn(`No se pudo reenviar el acceso al portal: ${err instanceof Error ? err.message : String(err)}`),
            )
            .finally(() => this.inFlight.delete(job));
        this.inFlight.add(job);
    }

    /** v0.1.289 — empresa (no archivada) por su slug; -1 si no existe (no reparte nada). */
    private async tenantIdBySlug(slug: string): Promise<number> {
        const [t] = await this.db
            .select({ id: tenants.id, archivedAt: tenants.archivedAt })
            .from(tenants)
            .where(eq(tenants.slug, slug.toLowerCase()))
            .limit(1);
        return t && t.archivedAt === null ? t.id : -1;
    }

    /** Espera los envíos de acceso que quedaron corriendo (tests y apagado ordenado). */
    async whenIdle(): Promise<void> {
        await Promise.all([...this.inFlight]);
    }

    private async deliverAccess(email: string, onlyTenantId: number | null = null): Promise<void> {
        const [user] = await this.db
            .select({ id: users.id, disabledAt: users.disabledAt })
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`)
            .limit(1);
        if (!user || user.disabledAt !== null) return;
        if (this.env.PLATFORM_SUPERADMINS.includes(email)) return;

        const links = await this.db
            .select({ id: portalLinks.id, tenantId: portalLinks.tenantId, listId: portalLinks.listId, recordId: portalLinks.recordId })
            .from(portalLinks)
            .where(
                onlyTenantId === null
                    ? eq(portalLinks.userId, user.id)
                    : and(eq(portalLinks.userId, user.id), eq(portalLinks.tenantId, onlyTenantId)),
            )
            .orderBy(portalLinks.tenantId, portalLinks.id)
            .limit(200);
        if (links.length === 0) return;

        // v0.1.241 — UN correo por empresa (antes, uno por vínculo: con varios
        // accesos en la misma empresa llegaban varios correos iguales). El
        // enlace llega sólo a la persona → abre una sesión que ve todas sus
        // cuentas. Tope de 5 empresas por pedido.
        const seen = new Set<number>();
        for (const link of links) {
            if (seen.has(link.tenantId) || seen.size >= 5) continue;
            // Un portal que la empresa apagó no reparte enlaces nuevos; un
            // registro borrado tampoco (su acceso quedó sin nada que mostrar).
            if (await this.portalSwitchedOff(link.tenantId, link.listId)) continue;
            if ((await this.liveRecordIds(link.tenantId, [link.recordId])).size === 0) continue;
            seen.add(link.tenantId);
            await this.sendMagicLink(link.tenantId, user.id, email, {
                linkId: link.id,
                account: true,
            });
        }
    }

    /**
     * Acuña el token de un solo uso (24 h) y lo manda por correo. Devuelve el
     * resultado del envío para que el admin sepa si SALIÓ (v0.1.150) — el
     * enlace se devuelve igual para poder compartirlo a mano.
     */
    private async mintToken(payload: MagicPayload, ttl: number = MAGIC_TTL_SECONDS): Promise<string> {
        const token = randomBytes(24).toString('base64url');
        await this.redis.set(magicKey(token), JSON.stringify(payload), 'EX', ttl);
        return token;
    }

    private async sendMagicLink(
        tenantId: number,
        userId: number,
        email: string,
        opts: { linkId?: number; account?: boolean; baseUrl?: string; allAccounts?: boolean } = {},
    ): Promise<MagicLinkResult> {
        const token = await this.mintToken({
            userId,
            tenantId,
            ...(opts.linkId !== undefined ? { linkId: opts.linkId } : {}),
            ...(opts.account === true ? { account: true } : {}),
        });
        const path = `/portal/acceso?token=${token}`;
        // v0.1.245 — el enlace sale por el dominio del PORTAL de la empresa (o
        // el del equipo, o el de la plataforma) y el correo lleva SU marca.
        const base = opts.baseUrl ?? (await this.domains.baseUrlFor(tenantId, 'portal'));
        const url = `${base}${path}`;
        const brand = await this.emailBrand(tenantId, base);
        const message = portalAccessEmail(brand, url, { allAccounts: opts.allAccounts });
        let emailSent = true;
        let emailError: string | null = null;
        try {
            await this.mail.sendNow({
                tenantId,
                to: email,
                subject: message.subject,
                text: message.text,
                html: message.html,
                // El nombre visible del remitente es el de la empresa (con el
                // SMTP compartido la DIRECCIÓN sigue siendo la de la plataforma).
                ...(opts.allAccounts || brand.name.trim() === '' ? {} : { fromName: senderName(brand.name), fromNameSoft: true }),
            });
        } catch (err) {
            emailSent = false;
            emailError = err instanceof Error ? err.message : String(err);
            this.logger.error(`Magic link: el correo a ${email} no salió: ${emailError}`);
        }
        return { token, path, url, email_sent: emailSent, email_error: emailError };
    }

    /**
     * v0.1.245 — la marca de la empresa para el correo: el nombre de app que
     * eligió (o el de la empresa), su color y su logo como URL ABSOLUTA firmada
     * (el cliente de correo no tiene sesión; 30 días para que un correo viejo
     * no quede con la imagen rota en seguida).
     */
    private async emailBrand(tenantId: number, baseUrl: string): Promise<PortalEmailBrand> {
        const [row] = await this.db
            .select({ name: tenants.name, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const parsed = brandingSchema.safeParse((row?.settings as Record<string, unknown> | undefined)?.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        return {
            name: b.app_name ?? row?.name ?? '',
            color: b.primary_color,
            logoUrl:
                b.logo_file_id !== null
                    ? `${baseUrl}${this.files.signedUrl(tenantId, b.logo_file_id, 30 * 24 * 3600)}`
                    : null,
        };
    }

    /**
     * Consume el token (un solo uso) y abre una sesión del portal. `host` es el
     * host por el que se abrió: en el dominio PROPIO de una empresa la sesión
     * nunca ve las cuentas de otras empresas (ese dominio lo controla ella).
     */
    async consume(
        token: string,
        meta: { userAgent?: string; ip?: string; host?: string } = {},
    ): Promise<{ sessionToken: string }> {
        // SEC-15: consumo atómico. `GETDEL` lee y borra en una sola operación,
        // así dos requests concurrentes con el mismo token no pueden abrir dos
        // sesiones de un enlace "de un solo uso" (get+del tenía una carrera).
        const raw = await this.redis.getdel(magicKey(token));
        if (!raw) {
            throw new NotFoundException({
                code: 'invalid_magic_link',
                message: 'El enlace es inválido o expiró',
                data: { status: 404 },
            });
        }
        const payload = JSON.parse(raw) as MagicPayload;
        // SEC-24: el enlace vale mientras la cuenta esté activa y el acceso siga
        // en pie (quitarlo entre el envío y el click lo invalida).
        const [user] = await this.db
            .select({ email: users.email, disabledAt: users.disabledAt })
            .from(users)
            .where(eq(users.id, payload.userId))
            .limit(1);
        const allLinks = await this.db
            .select({ id: portalLinks.id, recordId: portalLinks.recordId })
            .from(portalLinks)
            .where(and(eq(portalLinks.userId, payload.userId), eq(portalLinks.tenantId, payload.tenantId)))
            .orderBy(portalLinks.id);
        // Un acceso a un registro BORRADO no abre nada.
        const live = await this.liveRecordIds(payload.tenantId, allLinks.map((l) => l.recordId));
        const linkRows = allLinks.filter((l) => live.has(l.recordId));
        // v0.1.241 — el acceso puntual del enlace, si sigue en pie; si lo
        // quitaron pero quedan otros en la empresa, el enlace igual abre (el
        // portal muestra el primero).
        const linkId = linkRows.find((l) => l.id === payload.linkId)?.id ?? linkRows[0]?.id;
        if (
            !user ||
            user.disabledAt !== null ||
            linkId === undefined ||
            this.env.PLATFORM_SUPERADMINS.includes(user.email.toLowerCase())
        ) {
            throw new NotFoundException({
                code: 'invalid_magic_link',
                message: 'El enlace es inválido o expiró',
                data: { status: 404 },
            });
        }
        const account = payload.account === true && !(await this.domains.isCustomDomainHost(meta.host));
        const sessionToken = await this.sessions.create(payload.userId, {
            userAgent: meta.userAgent,
            ip: meta.ip,
            portalTenantId: payload.tenantId,
            portalLinkId: linkId,
            portalAccount: account,
        });
        // v0.1.153 — queda registrado que el cliente ENTRÓ. El admin necesita
        // saber si el enlace se usó o si el correo se perdió en el camino.
        await this.touchAccess(linkId);
        return { sessionToken };
    }

    private async touchAccess(linkId: number): Promise<void> {
        await this.db
            .update(portalLinks)
            .set({ lastAccessAt: new Date() })
            .where(eq(portalLinks.id, linkId))
            .catch((err: unknown) => {
                this.logger.warn(`No se pudo registrar el acceso al portal: ${String(err)}`);
            });
    }

    /**
     * v0.1.241 — las CUENTAS de la persona: cada registro al que tiene acceso.
     * Una sesión común ve sólo las de su empresa; la que abrió un enlace de su
     * correo (`account`) ve también las de otras empresas. Nunca revela nada
     * que la persona no tenga.
     */
    async accounts(actor: PortalActor, currentLink?: { id: number }): Promise<PortalAccounts> {
        if (actor.tenantId === null) return { accounts: [], all_companies: false };
        const current = currentLink ?? (await this.requireLink(actor));
        const all = actor.account === true;
        const rows = await this.db
            .select({ id: portalLinks.id, tenantId: portalLinks.tenantId, listId: portalLinks.listId, recordId: portalLinks.recordId })
            .from(portalLinks)
            .where(
                all
                    ? eq(portalLinks.userId, actor.userId)
                    : and(eq(portalLinks.userId, actor.userId), eq(portalLinks.tenantId, actor.tenantId)),
            )
            .orderBy(portalLinks.tenantId, portalLinks.id)
            .limit(100);

        const byTenant = new Map<number, typeof rows>();
        for (const r of rows) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);

        const out: PortalAccounts['accounts'] = [];
        for (const [tid, links] of byTenant) {
            const resolved = await this.tenantDb.withTenant(tid, async (tx) => {
                const [tenantRow] = await tx
                    .select({ name: tenants.name, archivedAt: tenants.archivedAt })
                    .from(tenants)
                    .where(eq(tenants.id, tid))
                    .limit(1);
                const listIds = [...new Set(links.map((l) => l.listId))];
                const listRows = await tx
                    .select({ id: lists.id, name: lists.name, settings: lists.settings })
                    .from(lists)
                    .where(inArray(lists.id, listIds));
                const fieldRows = await tx
                    .select({ id: fields.id, listId: fields.listId, type: fields.type })
                    .from(fields)
                    .where(inArray(fields.listId, listIds))
                    .orderBy(fields.position);
                const recordRows = await tx
                    .select({ id: records.id, data: records.data })
                    .from(records)
                    .where(and(inArray(records.id, links.map((l) => l.recordId)), isNull(records.deletedAt)));
                return { tenantRow, listRows, fieldRows, recordRows };
            });
            const tenantName = resolved.tenantRow?.name ?? '';
            for (const link of links) {
                const list = resolved.listRows.find((l) => l.id === link.listId);
                const record = resolved.recordRows.find((r) => r.id === link.recordId);
                if (!list || !record) continue;
                const titleId = resolveTitleFieldId(
                    resolved.fieldRows
                        .filter((f) => f.listId === list.id)
                        .map((f) => ({ id: f.id, type: f.type as FieldType })),
                    list.settings,
                );
                const rawTitle = titleId !== null ? (record.data as Record<string, unknown>)[`f${titleId}`] : null;
                const portalCfg = (list.settings as Record<string, unknown> | null)?.portal;
                const switchedOff =
                    portalCfg !== null && typeof portalCfg === 'object' && (portalCfg as { enabled?: unknown }).enabled === false;
                out.push({
                    id: link.id,
                    tenant_id: tid,
                    tenant_name: tenantName,
                    list_name: list.name,
                    record_id: record.id,
                    record_title:
                        typeof rawTitle === 'string' && rawTitle.trim() !== ''
                            ? rawTitle.trim().slice(0, 120)
                            : typeof rawTitle === 'number'
                              ? String(rawTitle)
                              : `${list.name} #${record.id}`,
                    current: link.id === current.id,
                    same_company: tid === actor.tenantId,
                    available: !switchedOff && resolved.tenantRow?.archivedAt == null,
                });
            }
        }
        return { accounts: out, all_companies: all };
    }

    /**
     * v0.1.241 — abrir una cuenta de OTRA empresa. La sesión es de una empresa
     * (todo lo que el portal lee se acota a ella), así que cambiar de empresa es
     * abrir otra: el servidor acuña un enlace de un solo uso (2 min) y el portal
     * navega a él. Sólo para sesiones que ven todas las cuentas. Una cuenta de
     * la misma empresa no necesita esto (`path: null`): se elige y listo.
     */
    async switchAccount(actor: PortalActor, linkId: number): Promise<PortalSwitchResult> {
        const notFound = () =>
            new NotFoundException({ code: 'portal_account_not_found', message: 'Esa cuenta no está disponible', data: { status: 404 } });
        if (actor.tenantId === null) throw notFound();
        const [link] = await this.db
            .select({ id: portalLinks.id, tenantId: portalLinks.tenantId, listId: portalLinks.listId, recordId: portalLinks.recordId })
            .from(portalLinks)
            .where(and(eq(portalLinks.id, linkId), eq(portalLinks.userId, actor.userId)))
            .limit(1);
        if (!link) throw notFound();
        if ((await this.liveRecordIds(link.tenantId, [link.recordId])).size === 0) throw notFound();
        if (link.tenantId === actor.tenantId) return { path: null };
        if (actor.account !== true || (await this.portalSwitchedOff(link.tenantId, link.listId))) throw notFound();
        const token = await this.mintToken(
            { userId: actor.userId, tenantId: link.tenantId, linkId: link.id, account: true },
            SWITCH_TTL_SECONDS,
        );
        // Ruta RELATIVA: se queda en el host actual (el de la plataforma — una
        // sesión que ve todas las empresas sólo existe ahí).
        return { path: `/portal/acceso?token=${token}&cuenta=${link.id}` };
    }

    /**
     * v0.1.241 — "¿Eres cliente de otra empresa?": manda al correo de la persona
     * un enlace que abre una sesión con TODAS sus cuentas, en el dominio de la
     * plataforma. Pedirlo con la sesión no alcanza: la sesión pudo abrirla un
     * enlace que la empresa copió, y las cuentas de otras empresas son sólo de
     * quien lee ese correo. Freno de 3 cada 15 minutos.
     */
    async emailAllAccounts(actor: PortalActor): Promise<PortalEmailLinkResult> {
        const link = await this.requireLink(actor);
        const [user] = await this.db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, actor.userId))
            .limit(1);
        if (!user) throw new NotFoundException({ code: 'portal_not_linked', message: 'Sesión inválida', data: { status: 404 } });
        const rlKey = `portalacct:${actor.userId}`;
        const attempts = await this.redis.incr(rlKey);
        if (attempts === 1) await this.redis.expire(rlKey, 900);
        if (attempts > 3) {
            throw new HttpException(
                {
                    code: 'portal_email_rate_limited',
                    message: 'Ya te mandamos varios enlaces. Revisa tu correo o prueba en unos minutos.',
                    data: { status: 429 },
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        const res = await this.sendMagicLink(link.tenantId, actor.userId, user.email, {
            linkId: link.id,
            account: true,
            baseUrl: this.env.APP_BASE_URL,
            allAccounts: true,
        });
        return { email_sent: res.email_sent, email_hint: maskEmail(user.email) };
    }

    // --- Endpoints del portal autenticado (paridad con el plugin) ----------
    // Todos resuelven el cliente desde `portal_links` (fail-closed: sin
    // vínculo → 404). JAMÁS se aceptan list_id/record_id del cliente para
    // el propio record — defensa contra spoofing (regla del plugin).

    /**
     * Vínculo portal del usuario o 404.
     *
     * SEC-24 (v0.1.225): el vínculo se busca en la empresa de la SESIÓN (la que
     * emitió el enlace). Antes era `WHERE user_id = ? LIMIT 1` sin empresa: un
     * cliente con portal en dos empresas quedaba atado a una cualquiera, y la
     * empresa que emitía el enlace podía terminar viendo el portal de la otra.
     * Una sesión vieja (anterior a este fix, sin empresa) sólo sirve si el
     * usuario tiene UN vínculo: con dos es ambiguo y tiene que volver a entrar.
     */
    /**
     * Campo «Botón» — el cliente presiona un botón de SU registro. Sólo si el
     * botón está en el diseño del portal y todas sus acciones se permiten ahí
     * (`buttonPortalProblems`): abrir enlaces (con las variables que el
     * cliente ya ve), cambiar campos que el portal deja editar (por el mismo
     * PATCH del portal, con su whitelist), PDF publicados en el portal y, sólo
     * con la regla explícita del botón, correr una automatización.
     */
    async pressButton(actor: PortalActor, fieldId: number): Promise<PressButtonResult> {
        if (!this.buttons) throw new NotFoundException({ code: 'not_found', message: 'Botón no encontrado', data: { status: 404 } });
        const link = await this.requireLink(actor);
        const tenantId = link.tenantId;
        const { ctx, templateIds } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.assertWritable(tx, tenantId);
            const ctx = await this.portalCtx(tx, tenantId, link.listId);
            const tpl = await tx
                .select({ id: documentTemplates.id })
                .from(documentTemplates)
                .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.listId, link.listId), eq(documentTemplates.portalVisible, true)));
            return { ctx, templateIds: new Set(tpl.map((t) => t.id)) };
        });
        const field = ctx.fields.find((f) => f.id === fieldId && f.type === 'button');
        if (!field || !ctx.visible.has(fieldId)) {
            throw new NotFoundException({ code: 'portal_button_not_found', message: 'Ese botón no está en tu portal.', data: { status: 404 } });
        }
        const problems = buttonPortalProblems(readButtonConfig(field.config), { editableFieldIds: ctx.editableIds, portalTemplateIds: templateIds });
        if (problems.length > 0) {
            throw new ForbiddenException({ code: 'portal_button_forbidden', message: `${problems[0]}.`, data: { status: 403 } });
        }
        const bySlugId = new Map(ctx.fields.map((f) => [jsonbKeyForField(f.id), f.slug]));
        return this.buttons.press(tenantId, { userId: actor.userId, role: 'client' }, String(ctx.list.id), link.recordId, fieldId, {
            portal: true,
            readAs: { userId: actor.userId, role: 'admin' },
            visibleFieldIds: ctx.visible,
            writeFields: async (patch) => {
                const fieldsBySlug: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(patch)) {
                    const slug = bySlugId.get(key);
                    if (slug) fieldsBySlug[slug] = value;
                }
                await this.updateMe(actor, { fields: fieldsBySlug } as PortalUpdateMeInput);
            },
            portalPdf: async (templateId) => {
                if (!this.documents || !templateIds.has(templateId)) {
                    throw new ForbiddenException({ code: 'portal_button_forbidden', message: 'El PDF usa una plantilla que no está publicada en el portal.', data: { status: 403 } });
                }
                const doc = await this.documents.renderForPortal(tenantId, link.listId, link.recordId, templateId);
                return { filename: doc.filename, pdf: doc.buffer.toString('base64'), number: null };
            },
        });
    }

    /**
     * v0.1.267 (ADR-S35 fase 2) — PDF de una plantilla publicada en el portal,
     * SIEMPRE del registro del cliente (el del acceso elegido). El id de la
     * plantilla es lo único que llega del cliente; si no es de su lista o no
     * está publicada, 404.
     */
    async myDocument(actor: PortalActor, templateId: number): Promise<{ buffer: Buffer; filename: string }> {
        const link = await this.requireLink(actor);
        if (!this.documents || !Number.isInteger(templateId) || templateId <= 0) {
            throw new NotFoundException({ code: 'not_found', message: 'Documento no encontrado', data: { status: 404 } });
        }
        const doc = await this.documents.renderForPortal(link.tenantId, link.listId, link.recordId, templateId);
        return { buffer: doc.buffer, filename: doc.filename };
    }

    /**
     * El acceso de la sesión, y que el cliente haya aceptado la autorización
     * de tratamiento de datos vigente si la empresa la pide en el portal
     * (Ley 1581). Sin aceptarla: `403 consent_required` en TODO lo del portal
     * salvo ver/aceptar/retirar la autorización y salir.
     */
    private async requireLink(actor: PortalActor) {
        const link = await this.resolveLink(actor);
        await this.dataConsent?.assertPortalConsent(link.tenantId, actor.userId);
        return link;
    }

    private async resolveLink(actor: PortalActor) {
        const notLinked = () =>
            new NotFoundException({
                code: 'portal_not_linked',
                message: 'Este usuario no tiene un portal vinculado',
                data: { status: 404 },
            });
        const disabled = () =>
            new NotFoundException({
                code: 'portal_disabled',
                message: 'El portal de esta empresa no está disponible',
                data: { status: 404 },
            });
        if (actor.tenantId === null) {
            // Sesión vieja (anterior a SEC-24, sin empresa): sólo con UN vínculo.
            const rows = await this.tenantDb.withUser(actor.userId, (tx) =>
                tx.select().from(portalLinks).where(eq(portalLinks.userId, actor.userId)).limit(2),
            );
            const only = rows.length === 1 ? rows[0]! : null;
            if (!only) throw notLinked();
            if ((await this.liveRecordIds(only.tenantId, [only.recordId])).size === 0) throw notLinked();
            if (await this.portalSwitchedOff(only.tenantId, only.listId)) throw disabled();
            return only;
        }
        const tenantId = actor.tenantId;
        const allRows = await this.tenantDb.withUser(actor.userId, (tx) =>
            tx
                .select()
                .from(portalLinks)
                .where(and(eq(portalLinks.userId, actor.userId), eq(portalLinks.tenantId, tenantId)))
                .orderBy(portalLinks.id)
                .limit(100),
        );
        // Un acceso cuyo registro se BORRÓ deja de existir para el cliente
        // (antes el portal seguía mostrando —y dejando editar— un registro que
        // la empresa ya había eliminado).
        const live = await this.liveRecordIds(tenantId, allRows.map((r) => r.recordId));
        const rows = allRows.filter((r) => live.has(r.recordId));
        if (rows.length === 0) throw notLinked();
        // v0.1.241 — la persona eligió una cuenta: tiene que ser SUYA y de la
        // empresa de la sesión (una de otra empresa se abre con su enlace).
        if (actor.requestedLinkId !== undefined) {
            const chosen = rows.find((r) => r.id === actor.requestedLinkId);
            if (!chosen) {
                throw new NotFoundException({
                    code: 'portal_account_not_found',
                    message: 'Esa cuenta no está disponible',
                    data: { status: 404 },
                });
            }
            // SEC-35 (v0.1.239): si la empresa APAGÓ el portal de esa lista, el
            // cliente con una sesión abierta deja de verla al instante.
            if (await this.portalSwitchedOff(chosen.tenantId, chosen.listId)) throw disabled();
            return chosen;
        }
        // Sin elección: la del enlace con el que entró, y si ya no está (o su
        // portal se apagó), la primera disponible.
        const ordered = [...rows.filter((r) => r.id === actor.linkId), ...rows.filter((r) => r.id !== actor.linkId)];
        for (const link of ordered) {
            if (!(await this.portalSwitchedOff(link.tenantId, link.listId))) return link;
        }
        throw disabled();
    }

    // ─────────── Autorización de tratamiento de datos (Ley 1581) ───────────

    /** El estado de la autorización del cliente (lo pide la pantalla de aceptarla). */
    async consentStatus(actor: PortalActor): Promise<PortalConsentDto> {
        const link = await this.resolveLink(actor);
        return this.dataConsent
            ? this.dataConsent.portalDto(link.tenantId, actor.userId)
            : {
                  status: 'not_required',
                  consent: null,
                  company: '',
                  branding: { primary_color: null, app_name: null, logo_url: null },
                  accepted_at: null,
                  accepted_version: null,
                  withdrawn_at: null,
              };
    }

    /** El cliente acepta la versión vigente (queda la evidencia con su IP y navegador). */
    async acceptConsent(actor: PortalActor, version: number, meta: { ip: string | null; userAgent: string | null }): Promise<PortalConsentDto> {
        const link = await this.resolveLink(actor);
        if (!this.dataConsent) return this.consentStatus(actor);
        return this.dataConsent.portalAccept(link.tenantId, actor.userId, { listId: link.listId, recordId: link.recordId }, version, meta);
    }

    /** El cliente retira su autorización: el portal se bloquea hasta que la acepte de nuevo. */
    async withdrawConsent(actor: PortalActor, meta: { ip: string | null; userAgent: string | null }): Promise<PortalConsentDto> {
        const link = await this.resolveLink(actor);
        if (!this.dataConsent) return this.consentStatus(actor);
        return this.dataConsent.portalWithdraw(link.tenantId, actor.userId, meta);
    }

    /**
     * v0.1.289 — El acceso con el que abre una sesión NUEVA del portal de esta
     * empresa (entrar con contraseña): el primero que sigue en pie, de un
     * registro no borrado y de una lista con el portal encendido. null = la
     * persona ya no tiene nada que ver en este portal.
     */
    async openableLink(userId: number, tenantId: number): Promise<number | null> {
        const rows = await this.db
            .select({ id: portalLinks.id, listId: portalLinks.listId, recordId: portalLinks.recordId })
            .from(portalLinks)
            .where(and(eq(portalLinks.userId, userId), eq(portalLinks.tenantId, tenantId)))
            .orderBy(portalLinks.id)
            .limit(100);
        const live = await this.liveRecordIds(tenantId, rows.map((r) => r.recordId));
        for (const r of rows) {
            if (!live.has(r.recordId)) continue;
            if (await this.portalSwitchedOff(tenantId, r.listId)) continue;
            return r.id;
        }
        return null;
    }

    /**
     * v0.1.289 — El enlace de ENTRADA al portal de la empresa: por su dominio
     * del portal si responde (ADR-S28) y con `?empresa=` para que en el dominio
     * de la plataforma la pantalla de entrar sepa de qué empresa es (su marca y
     * la opción de contraseña).
     */
    async entryUrl(tenantId: number): Promise<string> {
        const [t] = await this.db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const base = await this.domains.baseUrlFor(tenantId, 'portal');
        return `${base}/portal?empresa=${encodeURIComponent(t?.slug ?? '')}`;
    }

    /** v0.1.289 — registra que el cliente entró (también al entrar con contraseña). */
    async markAccess(linkId: number): Promise<void> {
        await this.touchAccess(linkId);
    }

    /** Los registros (de esa empresa) que existen y NO están borrados. */
    private async liveRecordIds(tenantId: number, ids: readonly number[]): Promise<Set<number>> {
        const unique = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
        if (unique.length === 0) return new Set();
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), inArray(records.id, unique), isNull(records.deletedAt))),
        );
        return new Set(rows.map((r) => r.id));
    }

    /** El portal de la lista fue DESACTIVADO explícitamente (`portal.enabled: false`). */
    private async portalSwitchedOff(tenantId: number, listId: number): Promise<boolean> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)).limit(1),
        );
        if (!row) return true;
        const portal = (row.settings as Record<string, unknown> | null)?.portal;
        return portal !== null && typeof portal === 'object' && (portal as { enabled?: unknown }).enabled === false;
    }

    /**
     * Lo que el portal de una lista muestra, resuelto UNA vez: los campos, el
     * diseño vigente (guardado, convertido o automático), qué campos del
     * registro llegan al cliente (`visible`), cuáles puede editar y si hay
     * conversación. Todo lo que sale del portal se acota con esto.
     */
    private async portalCtx(tx: Tx, tenantId: number, listId: number): Promise<PortalCtx> {
        const [list] = await tx
            .select({ id: lists.id, slug: lists.slug, name: lists.name, settings: lists.settings })
            .from(lists)
            .where(eq(lists.id, listId))
            .limit(1);
        if (!list) throw portalGone();
        const settings = (list.settings ?? {}) as Record<string, unknown>;
        const listFields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
        const titleFieldId = resolveTitleFieldId(listFields.map((f) => ({ id: f.id, type: f.type })), settings);
        const fieldsLite: LayoutFieldLite[] = listFields.map((f) => ({ ...liteField(f), is_primary: f.id === titleFieldId }));
        const resolved = await this.resolveLayout(tx, tenantId, list.id, settings, fieldsLite);
        const editableIds = new Set<number>(
            resolved.origin === 'saved'
                ? portalEditableFieldIds(resolved.layout, fieldsLite)
                : resolved.origin === 'legacy'
                  ? (() => {
                        const slugs = editableSlugsFromTemplate(settings.portal_template);
                        return listFields.filter((f) => slugs.has(f.slug)).map((f) => f.id);
                    })()
                  : [],
        );
        const visible = portalRecordFieldIds(resolved.layout, listFields, { titleFieldId, editableIds });
        return {
            list: { id: list.id, slug: list.slug, name: list.name, settings },
            fields: listFields.map((f) => ({ ...f, is_primary: f.id === titleFieldId })),
            titleFieldId,
            layout: resolved.layout,
            origin: resolved.origin,
            editableIds,
            visible,
            conversation: portalConversation(resolved.layout),
        };
    }

    /** ADR-S09: una empresa en solo-lectura (impaga, archivada) no recibe escrituras del portal. */
    private async assertWritable(tx: Tx, tenantId: number): Promise<void> {
        if (await tenantIsReadOnly(tx, tenantId)) {
            throw new ForbiddenException({
                code: 'workspace_read_only',
                message: 'Este portal está en modo de sólo lectura en este momento.',
                data: { status: 403 },
            });
        }
    }

    /**
     * PATCH /portal/me — el cliente edita su propio record. Whitelist
     * server-side: sólo los campos de los bloques marcados editables en el
     * diseño vigente (la plantilla anterior: sus `editable_form`). Sin bloques
     * editables nadie edita; un slug fuera de la lista → 403 explícito.
     *
     * La escritura es ATÓMICA (`data || patch` sobre la fila bloqueada): dos
     * guardados seguidos —o el cliente y alguien del equipo a la vez— no se
     * pisan campos que no tocaron.
     */
    async updateMe(actor: PortalActor, input: PortalUpdateMeInput): Promise<{ ok: true }> {
        const userId = actor.userId;
        const link = await this.requireLink(actor);
        const tenantId = link.tenantId;

        const { listId, changedAfter, changedBefore } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.assertWritable(tx, tenantId);
            const ctx = await this.portalCtx(tx, tenantId, link.listId);
            if (ctx.editableIds.size === 0) {
                throw new ForbiddenException({
                    code: 'portal_not_editable',
                    message: 'Tu portal no permite edición de campos',
                    data: { status: 403 },
                });
            }
            const bySlug = new Map(ctx.fields.map((f) => [f.slug, f]));
            const patch: Record<string, unknown> = {};
            const errors: Record<string, string> = {};
            for (const [slug, value] of Object.entries(input.fields)) {
                const field = bySlug.get(slug);
                if (!field || !ctx.editableIds.has(field.id)) {
                    throw new ForbiddenException({
                        code: 'portal_field_forbidden',
                        message: `No tienes permiso para editar el campo "${slug}"`,
                        data: { status: 403 },
                    });
                }
                if (!isUserWritableType(field.type)) {
                    errors[slug] = 'Campo inexistente o no editable';
                    continue;
                }
                const result = validateFieldValue({ type: field.type, config: field.config, is_required: field.is_required }, value);
                if (!result.ok) errors[slug] = result.error;
                else patch[jsonbKeyForField(field.id)] = result.value;
            }
            if (Object.keys(errors).length > 0) {
                throw new BadRequestException({
                    code: 'validation_failed',
                    message: 'Datos inválidos',
                    data: { status: 400, errors },
                });
            }

            // La fila bloqueada: el `before` del diff y de las automatizaciones
            // es el de verdad, y nadie la cambia entre la lectura y la escritura.
            const [current] = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(eq(records.id, link.recordId), eq(records.listId, ctx.list.id), isNull(records.deletedAt)))
                .limit(1)
                .for('update');
            if (!current) throw portalGone();
            // v0.1.300 — "obligatorio si…" sobre el registro como queda (sólo las
            // reglas que tocan lo que el cliente cambió).
            const failedIf = checkRequiredIf(ctx.fields, { ...(current.data as Record<string, unknown>), ...patch }, { touched: new Set(Object.keys(patch)) });
            if (failedIf.length > 0) {
                throw new BadRequestException({
                    code: 'validation_failed',
                    message: 'Datos inválidos',
                    data: { status: 400, errors: Object.fromEntries(failedIf.map((e) => [e.field.slug ?? `f${e.field.id}`, e.message])) },
                });
            }
            const [updated] = await tx
                .update(records)
                .set({ data: sql`${records.data} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date(), updatedBy: userId })
                .where(eq(records.id, current.id))
                .returning({ data: records.data });
            const after = (updated?.data ?? { ...current.data, ...patch }) as Record<string, unknown>;
            await this.activity.logInTx(tx, {
                tenantId,
                listId: ctx.list.id,
                recordId: current.id,
                userId,
                action: 'record_updated',
                diff: computeDiff(current.data, after),
            });
            return { listId: ctx.list.id, changedBefore: current.data as Record<string, unknown>, changedAfter: after };
        });
        this.realtime.records(tenantId, listId);
        this.automations.dispatch({
            tenantId,
            listId,
            recordId: link.recordId,
            trigger: 'record_updated',
            after: changedAfter,
            before: changedBefore,
        });
        // Seguidores del registro, campos con IA, la tienda sincronizada…: un
        // cambio del cliente es un cambio como cualquier otro.
        this.changes?.emit({
            tenantId,
            listId,
            recordId: link.recordId,
            before: changedBefore,
            after: changedAfter,
            actorId: userId,
            viaPortal: true,
        });
        return { ok: true };
    }

    /**
     * Comentarios del registro tal como los ve el cliente: SÓLO los marcados
     * «visible para el cliente» (y los que escribió él) — lo que el equipo
     * habla entre sí jamás sale. Sin conversación en el diseño, nada.
     */
    private async clientComments(
        tx: Tx,
        tenantId: number,
        recordId: number,
        viewerId: number,
        companyName: string,
        limit = 200,
    ): Promise<PortalCommentDto[]> {
        const rows = await this.commentsRepo.listClientVisible(tx, tenantId, recordId, limit);
        if (rows.length === 0) return [];
        const authorIds = [...new Set(rows.map((r) => r.userId))];
        const authors = await tx
            .select({ id: users.id, name: users.name, role: memberships.role })
            .from(users)
            .leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.tenantId, tenantId)))
            .where(inArray(users.id, authorIds));
        const byId = new Map(authors.map((a) => [a.id, a]));
        // v0.1.291 — reacciones: cuántas y si una es de quien mira (nunca
        // quiénes del equipo: el portal no identifica a los empleados).
        const reactions = await this.commentsRepo.reactionsFor(
            tx,
            tenantId,
            rows.filter((r) => r.deletedAt === null).map((r) => r.id),
        );
        return rows.map((r) => {
            const a = byId.get(r.userId);
            const fromTeam = a?.role !== undefined && a.role !== null && a.role !== 'client';
            const mine = r.userId === viewerId;
            const deleted = r.deletedAt !== null;
            return {
                id: r.id,
                body: deleted ? '' : r.body,
                content: deleted ? '' : r.body,
                created_at: r.createdAt.toISOString(),
                mine,
                from_team: fromTeam,
                author_name: mine ? 'Tú' : fromTeam ? firstName(a?.name) || companyName || 'El equipo' : firstName(a?.name) || 'Cliente',
                parent_id: r.parentId,
                reactions: deleted
                    ? []
                    : (reactions.get(r.id) ?? []).map((x) => ({ emoji: x.emoji, count: x.count, mine: x.user_ids.includes(viewerId) })),
                deleted,
            };
        });
    }

    /**
     * v0.1.291 — El cliente reacciona a un comentario que VE en su portal
     * (toggle). Mismas reglas que comentar: el diseño tiene que tener la
     * conversación abierta y la empresa no estar en solo-lectura.
     */
    async toggleMyReaction(
        actor: PortalActor,
        commentId: number,
        emoji: CommentReactionEmoji,
    ): Promise<{ reactions: Array<{ emoji: string; count: number; mine: boolean }> }> {
        const link = await this.requireLink(actor);
        const reactions = await this.tenantDb.withTenant(link.tenantId, async (tx) => {
            await this.assertWritable(tx, link.tenantId);
            const ctx = await this.portalCtx(tx, link.tenantId, link.listId);
            if (!ctx.conversation.writable) {
                throw new ForbiddenException({
                    code: 'portal_comments_disabled',
                    message: 'Este portal no recibe comentarios',
                    data: { status: 403 },
                });
            }
            const target = await this.clientVisibleComment(tx, link.tenantId, link.recordId, commentId);
            await this.commentsRepo.toggleReaction(tx, link.tenantId, target.id, actor.userId, emoji);
            const list = (await this.commentsRepo.reactionsFor(tx, link.tenantId, [target.id])).get(target.id) ?? [];
            return list.map((x) => ({ emoji: x.emoji, count: x.count, mine: x.user_ids.includes(actor.userId) }));
        });
        this.realtime.records(link.tenantId, link.listId);
        return { reactions };
    }

    /**
     * Un comentario del registro del cliente que ÉL puede ver (visible para el
     * cliente, vivo, y si es una respuesta, con su raíz también visible). Si
     * no, 404 opaco: el cliente no distingue «no existe» de «es interno».
     */
    private async clientVisibleComment(
        tx: Tx,
        tenantId: number,
        recordId: number,
        commentId: number,
        opts: { forReply?: boolean } = {},
    ) {
        const notFound = (): NotFoundException =>
            new NotFoundException({ code: 'comment_not_found', message: 'Comentario no encontrado', data: { status: 404 } });
        // Para RESPONDER vale también un hilo cuyo raíz se borró pero sigue
        // vivo («Comentario eliminado» con respuestas); para reaccionar, no.
        const live = async (id: number) => {
            const row = await this.commentsRepo.findAnyById(tx, tenantId, id);
            if (!row) return null;
            if (row.deletedAt === null) return row;
            if (!opts.forReply) return null;
            const threadAlive = row.parentId === null
                ? await this.commentsRepo.hasLiveReplies(tx, tenantId, row.id)
                : true; // una respuesta borrada: se continúa su hilo (se valida el raíz abajo)
            return threadAlive ? row : null;
        };
        const row = await live(commentId);
        if (!row || row.recordId !== recordId || row.visibility !== 'client') throw notFound();
        if (row.parentId !== null) {
            const root = await live(row.parentId);
            if (!root || root.visibility !== 'client') throw notFound();
            if (root.deletedAt !== null && !(await this.commentsRepo.hasLiveReplies(tx, tenantId, root.id))) throw notFound();
        }
        return row;
    }

    /** GET /portal/me/comments — la conversación del registro del cliente. */
    async myComments(actor: PortalActor): Promise<PortalCommentDto[]> {
        const link = await this.requireLink(actor);
        return this.tenantDb.withTenant(link.tenantId, async (tx) => {
            const ctx = await this.portalCtx(tx, link.tenantId, link.listId);
            if (!ctx.conversation.comments) return [];
            return this.clientComments(tx, link.tenantId, link.recordId, actor.userId, await this.companyName(tx, link.tenantId));
        });
    }

    /**
     * POST /portal/me/comments — el cliente escribe en la conversación. Sólo
     * si el diseño tiene un bloque de comentarios que no sea de sólo lectura y
     * la empresa no está en solo-lectura. Avisa a quienes siguen el registro.
     */
    async createMyComment(actor: PortalActor, input: PortalCommentInput): Promise<PortalCommentDto> {
        const userId = actor.userId;
        const link = await this.requireLink(actor);
        const { row, clientName } = await this.tenantDb.withTenant(link.tenantId, async (tx) => {
            await this.assertWritable(tx, link.tenantId);
            const ctx = await this.portalCtx(tx, link.tenantId, link.listId);
            if (!ctx.conversation.writable) {
                throw new ForbiddenException({
                    code: 'portal_comments_disabled',
                    message: 'Este portal no recibe comentarios',
                    data: { status: 403 },
                });
            }
            // v0.1.291 — responder a un comentario que el cliente ve: cuelga
            // del raíz del hilo (un solo nivel).
            let parentId: number | null = null;
            if (input.parent_id !== undefined) {
                const parent = await this.clientVisibleComment(tx, link.tenantId, link.recordId, input.parent_id, { forReply: true });
                parentId = parent.parentId ?? parent.id;
            }
            const inserted = await this.commentsRepo.insert(tx, {
                tenantId: link.tenantId,
                listId: link.listId,
                recordId: link.recordId,
                userId,
                body: input.content,
                kind: 'note',
                parentId,
                metadata: {},
                visibility: 'client',
            });
            const [me] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
            return { row: inserted, clientName: (me?.name || me?.email || '').trim() };
        });
        this.realtime.records(link.tenantId, link.listId);
        this.notify?.emit({
            type: 'comment',
            tenantId: link.tenantId,
            listId: link.listId,
            recordId: link.recordId,
            actorId: userId,
            body: row.body,
            mentioned: [],
            commentId: row.id,
            visibility: 'client',
            fromClient: true,
            clientName,
            ...(row.parentId !== null ? { parentId: row.parentId } : {}),
        });
        return {
            id: row.id,
            body: row.body,
            content: row.body,
            created_at: row.createdAt.toISOString(),
            mine: true,
            from_team: false,
            author_name: 'Tú',
            parent_id: row.parentId,
            reactions: [],
            deleted: false,
        };
    }

    /**
     * GET /portal/me/activity — el historial del registro del cliente, SÓLO
     * si el diseño lo muestra y sólo con los campos que el cliente ve: un
     * cambio en una columna interna ni siquiera aparece. Quién lo hizo no se
     * nombra (el cliente ve «Tú» o la empresa).
     */
    async myActivity(actor: PortalActor, limit: number): Promise<ActivityDto[]> {
        const link = await this.requireLink(actor);
        const cap = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
        return this.tenantDb.withTenant(link.tenantId, async (tx) => {
            const ctx = await this.portalCtx(tx, link.tenantId, link.listId);
            if (!ctx.conversation.activity) return [];
            // Se piden de más: las entradas de campos internos se descartan.
            const rows = await this.activityRepo.list(tx, link.tenantId, link.listId, { recordId: link.recordId, limit: Math.min(cap * 3, 600) });
            const out: ActivityDto[] = [];
            for (const row of rows) {
                // A8 — las dependencias son del trabajo del equipo (nombran
                // registros internos): el cliente no las ve.
                if (row.action === 'dependency_added' || row.action === 'dependency_removed') continue;
                // D3 — el registro de WhatsApp (qué plantilla se mandó, cuándo
                // escribió) es del equipo: el cliente ya tiene la conversación.
                if (row.action === 'whatsapp') continue;
                let diff = filterActivityDiff(row.diff, ctx.visible);
                if (row.action === 'record_updated' && Object.keys(diff).length === 0) continue;
                // Campo «Botón»: sólo los botones que el cliente ve, y sólo su nombre.
                if (row.action === 'button_pressed') {
                    const b = (row.diff as { button?: { field_id?: unknown; label?: unknown } } | null)?.button;
                    if (!b || !ctx.visible.has(Number(b.field_id))) continue;
                    diff = { button: { field_id: Number(b.field_id), label: String(b.label ?? '') } };
                }
                out.push({
                    id: row.id,
                    list_id: row.listId,
                    record_id: row.recordId,
                    // El cliente sólo se reconoce a sí mismo; del equipo no se
                    // expone ni el id ni el nombre (v0.1.149).
                    user_id: row.userId === actor.userId ? row.userId : null,
                    action: row.action as ActivityDto['action'],
                    user_name: null,
                    diff,
                    created_at: row.createdAt.toISOString(),
                });
                if (out.length >= cap) break;
            }
            return out;
        });
    }

    /**
     * Listas donde el cliente puede CREAR registros desde su portal (opt-in del
     * admin en `settings.portal.creatable_lists`). Sólo las que tienen una
     * relación hacia la lista del portal —así el registro nuevo queda
     * vinculado a SU registro— y sólo los campos elegidos que una persona puede
     * escribir (nunca personas del equipo, relaciones ni archivos).
     */
    private async creatableLists(tx: Tx, tenantId: number, ctx: PortalCtx): Promise<PortalCreatableList[]> {
        const resolved = await this.creatableTargets(tx, tenantId, ctx);
        return resolved.map((t) => ({ list_id: t.listId, name: t.name, label: t.label, fields: t.fields }));
    }

    private async creatableTargets(
        tx: Tx,
        tenantId: number,
        ctx: PortalCtx,
    ): Promise<Array<{ listId: number; name: string; label: string; relationFieldId: number; fields: Field[] }>> {
        const cfg = readPortalConfig(ctx.list.settings).portal.creatable_lists ?? [];
        const ids = [...new Set(cfg.map((c) => c.list_id))].filter((id) => id !== ctx.list.id);
        if (ids.length === 0) return [];
        const others = await tx
            .select({ id: lists.id, name: lists.name, settings: lists.settings })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), inArray(lists.id, ids)));
        const out: Array<{ listId: number; name: string; label: string; relationFieldId: number; fields: Field[] }> = [];
        for (const entry of cfg) {
            const other = others.find((o) => o.id === entry.list_id);
            if (!other || readStoreListMarker(other.settings as Record<string, unknown>)) continue;
            const own = (await this.fields.listByListIdWithinTx(tx, tenantId, other.id)).sort((a, b) => a.position - b.position);
            const rel = own.find(
                (f) => f.type === 'relation' && Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0) === ctx.list.id,
            );
            if (!rel) continue;
            const allowed = own.filter(
                (f) => entry.field_ids.includes(f.id) && isUserWritableType(f.type) && !PORTAL_CREATE_EXCLUDED_TYPES.has(f.type),
            );
            if (allowed.length === 0) continue;
            out.push({
                listId: other.id,
                name: other.name,
                label: entry.label.trim() || `Nuevo en ${other.name}`,
                relationFieldId: rel.id,
                fields: allowed,
            });
        }
        return out;
    }

    /** ¿El cliente quiere un correo cuando el equipo le responde? (opt-out, por empresa). */
    private async notifyEmailPref(tx: Tx, tenantId: number, userId: number): Promise<boolean> {
        const [m] = await tx
            .select({ settings: memberships.settings })
            .from(memberships)
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
            .limit(1);
        return (m?.settings as { portal_notify?: unknown } | undefined)?.portal_notify !== false;
    }

    /** v0.1.289 — ¿la empresa permite contraseña en el portal y este cliente ya creó la suya? */
    private async passwordStatus(
        tx: Tx,
        tenantId: number,
        userId: number,
        tenantSettings: Record<string, unknown>,
    ): Promise<{ enabled: boolean; has_password: boolean }> {
        const enabled = portalPasswordEnabled(tenantSettings);
        if (!enabled) return { enabled: false, has_password: false };
        const [cred] = await tx
            .select({ userId: portalCredentials.userId })
            .from(portalCredentials)
            .where(and(eq(portalCredentials.tenantId, tenantId), eq(portalCredentials.userId, userId)))
            .limit(1);
        return { enabled: true, has_password: cred !== undefined };
    }

    /** El nombre con el que la empresa se presenta al cliente (su app o su razón social). */
    private async companyName(tx: Tx, tenantId: number): Promise<string> {
        const [t] = await tx.select({ name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const parsed = brandingSchema.safeParse((t?.settings as Record<string, unknown> | undefined)?.branding ?? {});
        return (parsed.success ? parsed.data.app_name : null) ?? t?.name ?? '';
    }

    /** Boot del portal para el client autenticado: su record + fields + template. */
    /**
     * Quién tiene acceso al portal de un record (v0.1.153). El vínculo siempre
     * se guardó; lo que faltaba era MOSTRARLO: sin esto el admin re-tipeaba el
     * email en cada envío sin saber si el cliente ya tenía acceso.
     */
    async accessFor(tenantId: number, listIdOrSlug: string, recordId: number): Promise<PortalAccessList> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.db
            .select({
                userId: portalLinks.userId,
                createdAt: portalLinks.createdAt,
                lastAccessAt: portalLinks.lastAccessAt,
                email: users.email,
                name: users.name,
            })
            .from(portalLinks)
            .innerJoin(users, eq(users.id, portalLinks.userId))
            .where(
                and(
                    eq(portalLinks.tenantId, tenantId),
                    eq(portalLinks.listId, list.id),
                    eq(portalLinks.recordId, recordId),
                ),
            )
            .orderBy(portalLinks.createdAt);
        const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return {
            entry_url: await this.entryUrl(tenantId),
            password_enabled: portalPasswordEnabled((t?.settings ?? {}) as Record<string, unknown>),
            users: rows.map((r) => ({
                user_id: r.userId,
                email: r.email,
                name: r.name,
                created_at: r.createdAt.toISOString(),
                last_access_at: r.lastAccessAt ? r.lastAccessAt.toISOString() : null,
            })),
        };
    }

    /**
     * Quita el acceso de un cliente: borra el vínculo, su membresía `client` y
     * REVOCA sus sesiones al instante (si no, seguiría dentro hasta que expire
     * la cookie — mismo criterio que desactivar un usuario, v0.1.116).
     */
    async revokeAccess(tenantId: number, listIdOrSlug: string, userId: number, recordId?: number): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        // v0.1.241 — una persona puede tener acceso a VARIOS registros: se quita
        // el de ese registro (o, sin registro, todos los de esta lista).
        const doomed = await this.db
            .select({ id: portalLinks.id })
            .from(portalLinks)
            .where(
                and(
                    eq(portalLinks.tenantId, tenantId),
                    eq(portalLinks.listId, list.id),
                    eq(portalLinks.userId, userId),
                    ...(recordId !== undefined ? [eq(portalLinks.recordId, recordId)] : []),
                ),
            );
        if (doomed.length === 0) {
            throw new NotFoundException({
                code: 'portal_access_not_found',
                message: 'Ese cliente no tiene acceso al portal de esta lista',
                data: { status: 404 },
            });
        }
        await this.db.delete(portalLinks).where(inArray(portalLinks.id, doomed.map((d) => d.id)));
        // ¿Le queda algún otro acceso en esta empresa? Entonces sigue siendo su
        // cliente y su sesión sigue viva (el portal le muestra los que quedan).
        const [left] = await this.db
            .select({ id: portalLinks.id })
            .from(portalLinks)
            .where(and(eq(portalLinks.tenantId, tenantId), eq(portalLinks.userId, userId)))
            .limit(1);
        if (left) return;
        // Guard rail: sólo se revoca a usuarios `client` (una cuenta de equipo
        // jamás llega aquí — `issue` lo impide — pero el borrado de membresía
        // no puede depender de eso).
        await this.db
            .delete(memberships)
            .where(
                and(
                    eq(memberships.tenantId, tenantId),
                    eq(memberships.userId, userId),
                    eq(memberships.role, 'client'),
                ),
            );
        // v0.1.289 — sin acceso no hay contraseña del portal que valga: se borra
        // (si vuelve a ser cliente, crea una nueva desde su menú).
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(portalCredentials).where(and(eq(portalCredentials.tenantId, tenantId), eq(portalCredentials.userId, userId))),
        );
        // Sólo las sesiones del portal de ESTA empresa: la misma persona puede
        // ser cliente de otra y ahí sigue adentro.
        await this.sessions.destroyPortalSessions(userId, tenantId);
    }

    /**
     * v0.1.241 — ANTES de dar acceso: qué pasa con ese email EN ESTA EMPRESA.
     * Sólo mira esta empresa (no revela si es cliente de otras).
     */
    async checkAccess(tenantId: number, listIdOrSlug: string, rawEmail: string, recordId: number): Promise<PortalAccessCheck> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const email = rawEmail.trim().toLowerCase();
        const [user] = await this.db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`)
            .limit(1);
        if (!user) return { status: 'new', records: [] };
        const [member] = await this.db
            .select({ role: memberships.role })
            .from(memberships)
            .where(and(eq(memberships.userId, user.id), eq(memberships.tenantId, tenantId)))
            .limit(1);
        if (member && member.role !== 'client') return { status: 'staff', records: [] };
        const links = await this.db
            .select({ listId: portalLinks.listId, recordId: portalLinks.recordId })
            .from(portalLinks)
            .where(and(eq(portalLinks.userId, user.id), eq(portalLinks.tenantId, tenantId)))
            .orderBy(portalLinks.id)
            .limit(50);
        if (links.some((l) => l.listId === list.id && l.recordId === recordId)) return { status: 'this_record', records: [] };
        if (links.length === 0) return { status: 'new', records: [] };
        const records_ = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const listIds = [...new Set(links.map((l) => l.listId))];
            const listRows = await tx.select({ id: lists.id, name: lists.name, settings: lists.settings }).from(lists).where(inArray(lists.id, listIds));
            const fieldRows = await tx
                .select({ id: fields.id, listId: fields.listId, type: fields.type })
                .from(fields)
                .where(inArray(fields.listId, listIds))
                .orderBy(fields.position);
            const recordRows = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(inArray(records.id, links.map((l) => l.recordId)), isNull(records.deletedAt)));
            return links.flatMap((l) => {
                const lst = listRows.find((x) => x.id === l.listId);
                const rec = recordRows.find((x) => x.id === l.recordId);
                if (!lst || !rec) return [];
                const titleId = resolveTitleFieldId(
                    fieldRows.filter((f) => f.listId === lst.id).map((f) => ({ id: f.id, type: f.type as FieldType })),
                    lst.settings,
                );
                const raw = titleId !== null ? (rec.data as Record<string, unknown>)[`f${titleId}`] : null;
                return [{
                    list_name: lst.name,
                    record_id: rec.id,
                    record_title: typeof raw === 'string' && raw.trim() !== '' ? raw.trim().slice(0, 120) : `${lst.name} #${rec.id}`,
                }];
            });
        });
        return { status: records_.length > 0 ? 'other_records' : 'new', records: records_ };
    }

    /**
     * Listas que PODRÍAN mostrarse en el portal del cliente: las que tienen un
     * campo `relation` apuntando a la lista del portal (sus facturas, sus
     * tickets…) o un campo `user` (lo suyo, por usuario). Es exactamente el
     * mismo criterio que `portalScope` — si aquí no aparece, el cliente no
     * podría ver nada de esa lista aunque se la habilitaran.
     */
    async relatedOptions(tenantId: number, listIdOrSlug: string): Promise<PortalRelatedList[]> {
        const portalList = await this.lists.get(tenantId, listIdOrSlug);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const otherLists = await tx
                .select({ id: lists.id, slug: lists.slug, name: lists.name, settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), sql`${lists.id} <> ${portalList.id}`))
                .orderBy(lists.position, lists.id);
            if (otherLists.length === 0) return [];
            const ids = otherLists.map((l) => l.id);
            const fieldRows = await tx
                .select()
                .from(fields)
                .where(sql`${fields.listId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
                .orderBy(fields.position);

            const out: PortalRelatedList[] = [];
            for (const l of otherLists) {
                const own = fieldRows.filter((f) => f.listId === l.id);
                const rel = own.find(
                    (f) =>
                        f.type === 'relation'
                        && Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0) === portalList.id,
                );
                const settings = (l.settings ?? {}) as { icon?: unknown; color?: unknown };
                const base = {
                    list_id: l.id,
                    slug: l.slug,
                    name: l.name,
                    icon: typeof settings.icon === 'string' ? settings.icon : null,
                    color: typeof settings.color === 'string' ? settings.color : null,
                };
                if (rel) {
                    out.push({ ...base, via: 'relation', via_field_label: rel.label });
                    continue;
                }
                const userField = own.find((f) => f.type === 'user');
                if (userField) out.push({ ...base, via: 'user', via_field_label: userField.label });
            }
            return out;
        });
    }

    /**
     * GET /portal/me — todo lo que el portal necesita para dibujarse en UN
     * request (regla de oro nº 8): el registro (sólo los campos que el diseño
     * muestra), el diseño, los datos de sus gráficos y tablas ya acotados al
     * cliente, sus cuentas y la primera página de la conversación. Antes el
     * portal pedía /me y después /accounts y /me/comments en cascada.
     */
    async me(actor: PortalActor): Promise<PortalBoot> {
        const link = await this.resolveLink(actor);
        // Ley 1581 — sin la autorización vigente aceptada, el portal no arranca.
        const consent = (await this.dataConsent?.assertPortalConsent(link.tenantId, actor.userId)) ?? null;
        const { boot: rawBoot, ctx } = await this.bootWithinTenant(actor.userId, link);
        const boot: PortalBoot = { ...rawBoot, data_consent: consent };
        const [accounts, comments] = await Promise.all([
            this.accounts(actor, link),
            ctx.conversation.comments
                ? this.tenantDb.withTenant(link.tenantId, async (tx) =>
                      this.clientComments(tx, link.tenantId, link.recordId, actor.userId, await this.companyName(tx, link.tenantId)),
                  )
                : Promise.resolve(null),
        ]);
        const payments = await this.paymentsFor(link, ctx, actor.userId).catch((err: unknown) => {
            this.logger.warn(`Pagos del portal: ${err instanceof Error ? err.message : String(err)}`);
            return {};
        });
        const base: PortalBoot = { ...boot, account_id: link.id, accounts, comments, payments };
        // v0.1.233 — los gráficos y tablas del diseño viajan en el MISMO
        // request (regla de oro nº 8), ya acotados al cliente.
        const blocks = layoutBlocks(ctx.layout)
            .filter((b) => DATA_BLOCK_TYPES.includes(b.type))
            .slice(0, 40)
            .map((b) => ({ id: b.id, type: b.type as 'chart' | 'related', title: b.title, config: b.config }));
        if (blocks.length === 0) return { ...base, layout_data: { data: {}, lists: {}, fields: {}, block_lists: {} } };
        const layoutData = await this.layoutData.portal(
            link.tenantId,
            { listId: link.listId, recordId: link.recordId, userId: actor.userId },
            blocks,
            (fileId) => this.files.signedUrl(link.tenantId, fileId, 3600),
        );
        return { ...base, layout_data: layoutData };
    }

    // ─────────────── Pagos desde el portal (v0.1.289) ───────────────

    /**
     * Los datos de los bloques «Pagos» del diseño: los links de pago de SUS
     * registros (el de su acceso y, si el bloque lo pide, los de listas
     * vinculadas a él por el mismo scope del portal) y si se le ofrece pagar.
     * Sin ninguna conexión de cobro del equipo el bloque no se ofrece (no
     * viaja nada y el portal no lo dibuja).
     */
    private async paymentsFor(
        link: { tenantId: number; listId: number; recordId: number },
        ctx: PortalCtx,
        userId: number,
    ): Promise<Record<string, PortalPaymentsBlockData>> {
        const blocks = layoutBlocks(ctx.layout).filter((b) => b.type === 'payments').slice(0, 6);
        if (blocks.length === 0 || !this.collections) return {};
        const conns = await this.collections.teamConnections(link.tenantId);
        if (conns.length === 0) return {};
        const out: Record<string, PortalPaymentsBlockData> = {};
        const linksCache = new Map<string, Promise<PortalPaymentLink[]>>();
        for (const b of blocks) {
            const cfg = readPortalPaymentsConfig(b.config);
            let links: PortalPaymentLink[] = [];
            if (cfg.show_links) {
                const key = [...cfg.linked_list_ids].sort((x, y) => x - y).join(',');
                let hit = linksCache.get(key);
                if (!hit) {
                    hit = this.clientPaymentLinks(link, ctx, cfg.linked_list_ids, userId);
                    linksCache.set(key, hit);
                }
                links = await hit;
            }
            const offer = await this.payOffer(link, ctx, cfg, conns);
            out[b.id] = {
                links,
                pay: offer
                    ? { label: offer.label, amount: offer.amount, currency: offer.currency, concept: offer.concept, provider: offer.provider }
                    : null,
            };
        }
        return out;
    }

    /**
     * Los links de pago que el cliente puede ver: los de su registro y los de
     * los registros de `linkedListIds` que son SUYOS (relación hacia su
     * registro o campo persona = él; sin vínculo, nada — fail-closed). Lo
     * anulado por la empresa no se muestra.
     */
    private async clientPaymentLinks(
        link: { tenantId: number; listId: number; recordId: number },
        ctx: PortalCtx,
        linkedListIds: readonly number[],
        userId: number,
    ): Promise<PortalPaymentLink[]> {
        return this.tenantDb.withTenant(link.tenantId, async (tx) => {
            const scopes = [and(eq(paymentLinks.listId, link.listId), eq(paymentLinks.recordId, link.recordId))];
            const titleFieldOf = new Map<number, number | null>([[link.listId, ctx.titleFieldId]]);
            for (const listId of [...new Set(linkedListIds)].slice(0, 4)) {
                if (listId === link.listId) continue;
                const ids = await this.clientRecordIdsIn(tx, link.tenantId, link.listId, link.recordId, listId, userId, ctx.fields);
                if (ids.length === 0) continue;
                scopes.push(and(eq(paymentLinks.listId, listId), inArray(paymentLinks.recordId, ids)));
                const [l] = await tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)).limit(1);
                const lf = await this.fields.listByListIdWithinTx(tx, link.tenantId, listId);
                titleFieldOf.set(
                    listId,
                    resolveTitleFieldId(lf.map((f) => ({ id: f.id, type: f.type })), (l?.settings ?? {}) as Record<string, unknown>),
                );
            }
            const rows = await tx
                .select()
                .from(paymentLinks)
                .where(and(eq(paymentLinks.tenantId, link.tenantId), ne(paymentLinks.status, 'cancelled'), or(...scopes)))
                .orderBy(desc(paymentLinks.createdAt))
                .limit(50);
            if (rows.length === 0) return [];
            const recs = await tx
                .select({ id: records.id, listId: records.listId, data: records.data })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, link.tenantId),
                        inArray(records.id, [...new Set(rows.map((r) => r.recordId))]),
                        isNull(records.deletedAt),
                    ),
                );
            const titleOf = new Map<number, string>();
            for (const r of recs) {
                const tf = titleFieldOf.get(r.listId) ?? null;
                const v = tf !== null ? (r.data as Record<string, unknown>)[jsonbKeyForField(tf)] : null;
                titleOf.set(r.id, typeof v === 'string' || typeof v === 'number' ? String(v) : `#${r.id}`);
            }
            const now = Date.now();
            return rows
                .filter((r) => titleOf.has(r.recordId))
                .map((r): PortalPaymentLink => {
                    const live = r.status === 'pending' && (r.expiresAt === null || r.expiresAt.getTime() > now);
                    return {
                        id: r.id,
                        title: r.title,
                        amount: Number(r.amount),
                        currency: r.currency,
                        status: (r.status === 'pending' && !live ? 'expired' : r.status) as PortalPaymentLink['status'],
                        url: live ? r.url : null,
                        created_at: r.createdAt.toISOString(),
                        expires_at: r.expiresAt?.toISOString() ?? null,
                        paid_at: r.paidAt?.toISOString() ?? null,
                        paid_amount: r.paidAmount === null ? null : Number(r.paidAmount),
                        method: r.method,
                        payment_id: r.paymentId,
                        record_title: titleOf.get(r.recordId) ?? '',
                    };
                });
        });
    }

    /**
     * Los registros de OTRA lista que son del cliente: la relación de esa
     * lista que apunta a la del portal (vinculados a SU registro), la
     * relación de la lista del portal hacia esa (los que SU registro vincula)
     * o, si no hay ninguna, su campo persona igual a él. El mismo criterio que
     * los gráficos y tablas del portal. Sin vínculo → ninguno.
     */
    private async clientRecordIdsIn(
        tx: Tx,
        tenantId: number,
        portalListId: number,
        clientRecordId: number,
        listId: number,
        userId: number,
        portalFields: readonly Field[],
    ): Promise<number[]> {
        const forward = portalFields.find(
            (f) => f.type === 'relation' && Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0) === listId,
        );
        const other = [...(await this.fields.listByListIdWithinTx(tx, tenantId, listId))].sort((a, b) => a.position - b.position);
        const rel = other.find(
            (f) => f.type === 'relation' && Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0) === portalListId,
        );
        if (rel) {
            const rows = await tx
                .select({ id: relations.sourceRecordId })
                .from(relations)
                .innerJoin(records, eq(records.id, relations.sourceRecordId))
                .where(
                    and(
                        eq(relations.tenantId, tenantId),
                        eq(relations.fieldId, rel.id),
                        eq(relations.targetRecordId, clientRecordId),
                        eq(records.listId, listId),
                        isNull(records.deletedAt),
                    ),
                )
                .limit(500);
            return rows.map((r) => r.id);
        }
        if (forward) {
            const rows = await tx
                .select({ id: relations.targetRecordId })
                .from(relations)
                .innerJoin(records, eq(records.id, relations.targetRecordId))
                .where(
                    and(
                        eq(relations.tenantId, tenantId),
                        eq(relations.fieldId, forward.id),
                        eq(relations.sourceRecordId, clientRecordId),
                        eq(records.listId, listId),
                        isNull(records.deletedAt),
                    ),
                )
                .limit(500);
            return rows.map((r) => r.id);
        }
        const userField = other.find((f) => f.type === 'user');
        if (!userField || userId <= 0) return [];
        const rows = await tx
            .select({ id: records.id })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    isNull(records.deletedAt),
                    sql`(${records.data} ->> ${jsonbKeyForField(userField.id)}) = ${String(userId)}`,
                ),
            )
            .limit(500);
        return rows.map((r) => r.id);
    }

    /**
     * ¿Se le ofrece pagar? Sólo con el botón encendido, una conexión del equipo
     * y un monto mayor a cero leído del registro (número, moneda, calculado o
     * resumen). El monto y la moneda los decide el servidor.
     */
    private async payOffer(
        link: { tenantId: number; listId: number; recordId: number },
        ctx: PortalCtx,
        cfg: PortalPaymentsBlockConfig,
        conns: ReadonlyArray<{ id: number; provider: 'mercadopago' | 'wompi' }>,
    ): Promise<{
        label: string;
        amount: number;
        currency: string;
        concept: string;
        provider: 'mercadopago' | 'wompi';
        connectionId: number;
    } | null> {
        const pb = cfg.pay_button;
        if (!pb.enabled || pb.connection_id === null || pb.amount_field_id === null) return null;
        const conn = conns.find((c) => c.id === pb.connection_id);
        const field = ctx.fields.find((f) => f.id === pb.amount_field_id);
        if (!conn || !field || !PAYABLE_AMOUNT_TYPES.has(field.type)) return null;
        const data = await this.recordValues(link);
        if (!data) return null;
        const raw = data[jsonbKeyForField(field.id)];
        const amount = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
        if (!Number.isFinite(amount) || amount <= 0) return null;
        const fieldCurrency = (field.config as { currency?: unknown }).currency;
        const currency =
            conn.provider === 'wompi'
                ? 'COP'
                : typeof fieldCurrency === 'string' && /^[A-Za-z]{3}$/.test(fieldCurrency)
                  ? fieldCurrency.toUpperCase()
                  : 'COP';
        const titleRaw = ctx.titleFieldId !== null ? data[jsonbKeyForField(ctx.titleFieldId)] : null;
        const title = typeof titleRaw === 'string' || typeof titleRaw === 'number' ? String(titleRaw).trim() : '';
        return {
            label: pb.label.trim() || 'Pagar ahora',
            amount: Math.round(amount * 100) / 100,
            currency,
            concept: (pb.concept.trim() || title || 'Pago').slice(0, 200),
            provider: conn.provider,
            connectionId: conn.id,
        };
    }

    /** Los valores del registro del cliente CON calculados y resúmenes. */
    private async recordValues(link: { tenantId: number; listId: number; recordId: number }): Promise<Record<string, unknown> | null> {
        if (this.records_) {
            const rec = await this.records_
                .get(link.tenantId, { userId: 0, role: 'admin' }, String(link.listId), link.recordId)
                .catch(() => null);
            return rec ? (rec.data as Record<string, unknown>) : null;
        }
        const [row] = await this.tenantDb.withTenant(link.tenantId, (tx) =>
            tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.id, link.recordId), eq(records.listId, link.listId), isNull(records.deletedAt)))
                .limit(1),
        );
        return row ? (row.data as Record<string, unknown>) : null;
    }

    /**
     * El cliente toca «Pagar» en un bloque «Pagos» de su portal: se crea (o se
     * reusa) un link de pago por el monto del registro y se le devuelve la URL
     * del checkout. Nada de lo que manda el navegador decide el monto: sólo
     * el id del bloque, que tiene que existir en el diseño vigente.
     */
    async payFromPortal(actor: PortalActor, blockId: string): Promise<PortalPayResult> {
        const link = await this.requireLink(actor);
        const unavailable = (): NotFoundException =>
            new NotFoundException({ code: 'portal_block_not_found', message: 'Ese pago no está disponible', data: { status: 404 } });
        if (!this.collections) throw unavailable();
        const ctx = await this.tenantDb.withTenant(link.tenantId, async (tx) => {
            // ADR-S09: una empresa en solo-lectura no genera cobros nuevos.
            await this.assertWritable(tx, link.tenantId);
            return this.portalCtx(tx, link.tenantId, link.listId);
        });
        const block = layoutBlocks(ctx.layout).find((b) => b.id === blockId && b.type === 'payments');
        if (!block) throw unavailable();
        const offer = await this.payOffer(
            link,
            ctx,
            readPortalPaymentsConfig(block.config),
            await this.collections.teamConnections(link.tenantId),
        );
        if (!offer) {
            throw new BadRequestException({
                code: 'portal_nothing_to_pay',
                message: 'No hay nada para pagar en este momento.',
                data: { status: 400 },
            });
        }
        // Freno por cliente: cada «Pagar» sin link vigente llama al proveedor.
        const rl = `portalpay:${link.tenantId}:${actor.userId}`;
        const n = await this.redis.incr(rl);
        if (n === 1) await this.redis.expire(rl, 600);
        if (n > 10) {
            throw new HttpException(
                { code: 'too_many_attempts', message: 'Demasiados intentos de pago seguidos. Prueba en unos minutos.', data: { status: 429 } },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1);
        return this.collections.payForPortal(link.tenantId, {
            connectionId: offer.connectionId,
            listId: link.listId,
            recordId: link.recordId,
            title: offer.concept,
            amount: offer.amount,
            currency: offer.currency,
            payerEmail: u?.email ?? null,
        });
    }

    /**
     * v0.1.233 — vista previa del editor del portal (`manage_lists`): calcula
     * los bloques que manda el editor (todavía sin guardar) para un registro
     * de muestra, con EXACTAMENTE el alcance que tendría su cliente.
     */
    async previewLayoutData(
        tenantId: number,
        listIdOrSlug: string,
        recordId: number,
        blocks: Array<{ id: string; type: 'chart' | 'related'; title?: string; config: Record<string, unknown> }>,
    ) {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const [rec] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id })
                .from(records)
                .where(and(eq(records.id, recordId), eq(records.listId, list.id), sql`${records.deletedAt} IS NULL`))
                .limit(1),
        );
        if (!rec) throw portalGone();
        // El cliente de ese registro (si ya tiene acceso): su campo persona
        // acota las listas vinculadas por usuario. Sin cliente, esas quedan vacías.
        const [owner] = await this.db
            .select({ userId: portalLinks.userId })
            .from(portalLinks)
            .where(and(eq(portalLinks.tenantId, tenantId), eq(portalLinks.listId, list.id), eq(portalLinks.recordId, recordId)))
            .limit(1);
        return this.layoutData.portal(
            tenantId,
            { listId: list.id, recordId, userId: owner?.userId ?? 0 },
            blocks,
            (fileId) => this.files.signedUrl(tenantId, fileId, 3600),
        );
    }

    /**
     * v0.1.233 — el diseño del portal tal como lo vería el cliente (guardado,
     * convertido de la plantilla anterior o automático): de aquí arranca el
     * editor, así lo que se diseña y lo que se ve salen de la misma función.
     */
    async layoutFor(tenantId: number, listIdOrSlug: string): Promise<{ layout: RecordLayoutV3; origin: 'saved' | 'legacy' | 'auto' }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const listFields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const titleId = resolveTitleFieldId(listFields.map((f) => ({ id: f.id, type: f.type })), list.settings as Record<string, unknown>);
            return this.resolveLayout(
                tx,
                tenantId,
                list.id,
                list.settings as Record<string, unknown>,
                listFields.map((f) => ({ ...liteField(f), is_primary: f.id === titleId })),
            );
        });
    }

    /**
     * El diseño del portal: el v3 guardado (`portal_layout_v3`, manda), la
     * plantilla anterior convertida, o el automático.
     */
    private async resolveLayout(
        tx: Tx,
        tenantId: number,
        listId: number,
        settings: Record<string, unknown>,
        fieldsLite: LayoutFieldLite[],
    ): Promise<{ layout: RecordLayoutV3; origin: 'saved' | 'legacy' | 'auto' }> {
        const saved = readPortalLayoutV3(settings);
        if (saved) return { layout: sanitizePortalLayout(saved), origin: 'saved' };
        if (settings.portal_template !== undefined && settings.portal_template !== null) {
            const slugs = [...listSlugsIn(settings.portal_template)];
            const others = slugs.length === 0
                ? []
                : await tx
                      .select({ id: lists.id, slug: lists.slug })
                      .from(lists)
                      .where(and(eq(lists.tenantId, tenantId), inArray(lists.slug, slugs)));
            const otherFields = others.length === 0
                ? []
                : await tx.select().from(fields).where(inArray(fields.listId, others.map((o) => o.id)));
            const migrated = migratePortalTemplateToV3(settings.portal_template, {
                listId,
                fields: fieldsLite,
                otherLists: others.map((o) => ({
                    id: o.id,
                    slug: o.slug,
                    fields: otherFields
                        .filter((f) => f.listId === o.id)
                        .map((f) => ({ id: f.id, slug: f.slug, label: f.label, type: f.type as FieldType, config: f.config as Record<string, unknown> })),
                })),
            });
            if (migrated) return { layout: migrated, origin: 'legacy' };
        }
        return { layout: autoPortalLayout(fieldsLite, await this.autoLinked(tx, tenantId, listId, settings)), origin: 'auto' };
    }

    /**
     * v0.1.237 — Las listas vinculadas que entran al portal AUTOMÁTICO: sólo
     * las que el admin habilitó para el cliente (`settings.portal.related_lists`,
     * fail-closed como el resto del portal), resueltas a su fuente — la
     * relación que apunta a esta lista o, si no hay, la lista entera (el
     * servidor la acota por el campo persona al calcular).
     */
    private async autoLinked(tx: Tx, tenantId: number, listId: number, settings: Record<string, unknown>): Promise<PortalLinkedList[]> {
        const raw = (settings.portal ?? {}) as { related_lists?: unknown };
        const chosen = Array.isArray(raw.related_lists)
            ? raw.related_lists.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0 && n !== listId).slice(0, 4)
            : [];
        if (chosen.length === 0) return [];
        const others = await tx
            .select({ id: lists.id, name: lists.name, settings: lists.settings })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), inArray(lists.id, chosen)));
        if (others.length === 0) return [];
        const otherFields = await tx
            .select()
            .from(fields)
            .where(inArray(fields.listId, others.map((o) => o.id)))
            .orderBy(fields.position);
        const out: PortalLinkedList[] = [];
        for (const id of chosen) {
            const o = others.find((x) => x.id === id);
            if (!o) continue;
            const own = otherFields.filter((f) => f.listId === o.id);
            const lite: LayoutFieldLite[] = own.map((f) => ({ id: f.id, slug: f.slug, label: f.label, type: f.type as FieldType, config: f.config as Record<string, unknown> }));
            const titleId = resolveTitleFieldId(own.map((f) => ({ id: f.id, type: f.type as FieldType })), (o.settings ?? {}) as Record<string, unknown>);
            for (const f of lite) f.is_primary = f.id === titleId;
            const rel = own.find((f) => f.type === 'relation' && Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0) === listId);
            if (rel) {
                out.push({ key: `rel:${rel.id}:reverse`, list_id: o.id, name: o.name, source: { kind: 'related', field_id: rel.id, direction: 'reverse' }, fields: lite });
            } else if (own.some((f) => f.type === 'user')) {
                out.push({ key: `list:${o.id}`, list_id: o.id, name: o.name, source: { kind: 'list', list_id: o.id }, fields: lite });
            }
        }
        return out;
    }

    private async bootWithinTenant(
        userId: number,
        link: { tenantId: number; listId: number; recordId: number },
    ): Promise<{ boot: PortalBoot; ctx: PortalCtx }> {
        return this.tenantDb.withTenant(link.tenantId, async (tx) => {
            const ctx = await this.portalCtx(tx, link.tenantId, link.listId);
            const [record] = await tx
                .select()
                .from(records)
                .where(and(eq(records.id, link.recordId), eq(records.listId, link.listId), isNull(records.deletedAt)))
                .limit(1);
            if (!record) throw portalGone();
            const list = ctx.list;

            // El editor visual guarda `portal_template` como objeto `{ blocks: [...] }`
            // (shape del template-editor). Aceptamos también un array plano legacy.
            // v0.1.93 — los bloques `image` con archivo subido reciben la URL
            // FIRMADA (el rol client no puede usar la descarga con sesión).
            const template = this.signImageBlocks(link.tenantId, extractPortalBlocks(list.settings.portal_template));
            // v0.1.94 — ajustes de PÁGINA del portal (fondo/ancho/tipografía).
            // Se pasan crudos; el SPA los valida tolerante (readPageSettings).
            const templatePage = extractPortalPage(list.settings.portal_template);

            // White-label del workspace: el cliente ve el portal con la marca
            // de la empresa. El logo va por URL FIRMADA (el rol client no
            // tiene la descarga con sesión, mismo criterio que los campos file).
            const [tenantRow] = await tx
                .select({ settings: tenants.settings, name: tenants.name })
                .from(tenants)
                .where(eq(tenants.id, link.tenantId))
                .limit(1);
            const parsedBranding = brandingSchema.safeParse((tenantRow?.settings as Record<string, unknown> | undefined)?.branding ?? {});
            const b = parsedBranding.success ? parsedBranding.data : brandingSchema.parse({});
            const branding = {
                primary_color: b.primary_color,
                app_name: b.app_name,
                logo_url: b.logo_file_id !== null ? this.files.signedUrl(link.tenantId, b.logo_file_id, 3600) : null,
            };
            // v0.1.104 — el portal muestra montos y fechas del record: usa el
            // mismo formato regional configurado por la empresa.
            const parsedFormat = tenantFormatSchema.safeParse((tenantRow?.settings as Record<string, unknown> | undefined)?.format ?? {});
            const format = parsedFormat.success ? parsedFormat.data : tenantFormatSchema.parse({});

            // Sólo los campos que el DISEÑO muestra (más el título y los
            // editables): una columna interna que el portal no dibuja no sale
            // del servidor, ni su valor ni su definición.
            const rawData = record.data as Record<string, unknown>;
            const documents = this.documents ? await this.documents.portalDocumentsInTx(tx, link.tenantId, list.id) : [];
            // Campo «Botón» — su estado se calcula aquí, con el registro completo;
            // al cliente sólo le llega la parte de presentación de la config.
            const buttons = portalButtonStates(ctx, rawData, new Set(documents.map((d) => d.id)), format.timezone ?? FALLBACK_TIME_ZONE);
            const shownFields = ctx.fields
                .filter((f) => ctx.visible.has(f.id))
                .map((f) => (f.type === 'button' ? { ...f, config: portalButtonConfig(f.config) } : f));
            const data: Record<string, unknown> = {};
            for (const f of shownFields) {
                const key = jsonbKeyForField(f.id);
                if (key in rawData) data[key] = rawData[key];
            }

            return {
                ctx,
                boot: {
                    branding,
                    format,
                    tenant_name: tenantRow?.name ?? '',
                    // Las listas vinculadas se ven donde el diseño las pone (con
                    // las columnas que ahí se eligieron), nunca "todas las
                    // columnas" al pie del portal.
                    related_lists: [],
                    documents,
                    list_id: list.id,
                    list_slug: list.slug,
                    list_name: list.name,
                    user_id: userId,
                    record: {
                        id: record.id,
                        list_id: record.listId,
                        data: this.signFileValues(link.tenantId, shownFields, data, (id) => `f${id}`),
                        parent_id: record.parentId ?? null,
                        subtask_count: 0,
                        has_description: false,
                        created_by: record.createdBy,
                        created_at: record.createdAt.toISOString(),
                        updated_at: record.updatedAt.toISOString(),
                    },
                    fields: shownFields,
                    template,
                    template_page: templatePage,
                    layout: this.signLayoutImages(link.tenantId, ctx.layout),
                    layout_origin: ctx.origin,
                    layout_data: null,
                    editable_field_ids: [...ctx.editableIds],
                    account_id: null,
                    accounts: null,
                    comments: null,
                    creatable_lists: await this.creatableLists(tx, link.tenantId, ctx),
                    notify_email: await this.notifyEmailPref(tx, link.tenantId, userId),
                    // v0.1.289 — «Crear / cambiar contraseña» en su menú.
                    password: await this.passwordStatus(tx, link.tenantId, userId, (tenantRow?.settings ?? {}) as Record<string, unknown>),
                    payments: {},
                    data_consent: null,
                    buttons,
                },
            };
        });
    }

    /**
     * Imágenes y galerías del diseño v3 con archivo subido → URL FIRMADA (el
     * rol client no tiene la descarga con sesión). Copia: no muta settings.
     */
    private signLayoutImages(tenantId: number, layout: RecordLayoutV3): RecordLayoutV3 {
        const sign = (id: unknown): string | undefined =>
            typeof id === 'number' && id > 0 ? this.files.signedUrl(tenantId, id, 86_400) : undefined;
        const signBlock = (b: LayoutBlock): LayoutBlock => {
            if (b.type === 'image') {
                const url = sign(b.config.file_id ?? b.config.image_file_id);
                return url ? { ...b, config: { ...b.config, url } } : b;
            }
            if (b.type === 'gallery' && Array.isArray(b.config.images)) {
                return {
                    ...b,
                    config: {
                        ...b.config,
                        images: (b.config.images as Array<Record<string, unknown>>).map((img) => {
                            const url = img && typeof img === 'object' ? sign(img.image_file_id) : undefined;
                            return url ? { ...img, url } : img;
                        }),
                    },
                };
            }
            return b;
        };
        return {
            ...layout,
            pages: layout.pages.map((p) => ({
                ...p,
                sections: p.sections.map((sec) => ({ ...sec, blocks: sec.blocks.map((col) => col.map(signBlock)) })),
            })),
        };
    }

    /**
     * v0.1.93 — Recorre el template (incluyendo las columnas de
     * `nested_section`, 1 nivel) y a cada bloque `image` con
     * `image_file_id` le inyecta `config.url` como URL FIRMADA (TTL 24h).
     * El rol client no tiene la descarga con sesión de miembro — mismo
     * criterio que los campos file y el logo del branding. Devuelve
     * COPIAS: jamás muta los settings de la lista.
     */
    private signImageBlocks(
        tenantId: number,
        blocks: Array<Record<string, unknown>>,
    ): Array<Record<string, unknown>> {
        const signBlock = (raw: Record<string, unknown>): Record<string, unknown> => {
            if (!raw || typeof raw !== 'object') return raw;
            const config =
                raw.config && typeof raw.config === 'object'
                    ? (raw.config as Record<string, unknown>)
                    : undefined;
            if (raw.type === 'image' && config) {
                const fileId = config.image_file_id;
                if (typeof fileId === 'number' && fileId > 0) {
                    return {
                        ...raw,
                        config: {
                            ...config,
                            url: this.files.signedUrl(tenantId, fileId, 86_400),
                        },
                    };
                }
                return raw;
            }
            // v0.1.94 — la galería firma cada imagen subida de su lista.
            if (raw.type === 'gallery' && config && Array.isArray(config.images)) {
                return {
                    ...raw,
                    config: {
                        ...config,
                        images: (config.images as Array<Record<string, unknown>>).map((img) => {
                            if (!img || typeof img !== 'object') return img;
                            const id = img.image_file_id;
                            if (typeof id === 'number' && id > 0) {
                                return { ...img, url: this.files.signedUrl(tenantId, id, 86_400) };
                            }
                            return img;
                        }),
                    },
                };
            }
            if (raw.type === 'nested_section' && config && Array.isArray(config.columns)) {
                return {
                    ...raw,
                    config: {
                        ...config,
                        columns: (config.columns as Array<Record<string, unknown>>).map((col) => {
                            if (!col || typeof col !== 'object' || !Array.isArray(col.blocks)) {
                                return col;
                            }
                            return {
                                ...col,
                                blocks: (col.blocks as Array<Record<string, unknown>>).map(signBlock),
                            };
                        }),
                    },
                };
            }
            return raw;
        };
        return blocks.map(signBlock);
    }
}

/**
 * Normaliza el `portal_template` guardado en `list.settings` al array plano de
 * bloques que consume el portal. El editor visual persiste `{ blocks: [...] }`;
 * también aceptamos un array plano (formato legacy) y devolvemos `[]` si no hay.
 */
function extractPortalBlocks(raw: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(raw)) {
        return raw as Array<Record<string, unknown>>;
    }
    if (raw && typeof raw === 'object' && Array.isArray((raw as { blocks?: unknown }).blocks)) {
        return (raw as { blocks: Array<Record<string, unknown>> }).blocks;
    }
    return [];
}

/** v0.1.94 — extrae `portal_template.page` (objeto opaco) si existe. */
function extractPortalPage(raw: unknown): Record<string, unknown> | null {
    if (
        raw &&
        typeof raw === 'object' &&
        !Array.isArray(raw) &&
        typeof (raw as { page?: unknown }).page === 'object' &&
        (raw as { page?: unknown }).page !== null
    ) {
        return (raw as { page: Record<string, unknown> }).page;
    }
    return null;
}

/** v0.1.289 — `tenants.settings.portal_auth.password_enabled` (tolerante). */
export function portalPasswordEnabled(tenantSettings: Record<string, unknown> | null | undefined): boolean {
    const raw = (tenantSettings ?? {}).portal_auth;
    return raw !== null && typeof raw === 'object' && (raw as { password_enabled?: unknown }).password_enabled === true;
}

function portalGone(): NotFoundException {
    return new NotFoundException({
        code: 'portal_record_missing',
        message: 'El record del portal ya no existe',
        data: { status: 404 },
    });
}


/**
 * Recorre el template (con anidamiento arbitrario — nested_section) y junta
 * los slugs editables declarados en bloques `editable_form`.
 */
function editableSlugsFromTemplate(raw: unknown): Set<string> {
    const out = new Set<string>();
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (obj.type === 'editable_form') {
            const cfg = (obj.config as Record<string, unknown> | undefined) ?? obj;
            const slugs = cfg.editable_field_slugs;
            if (Array.isArray(slugs)) {
                for (const s of slugs) if (typeof s === 'string' && s !== '') out.add(s);
            }
        }
        for (const v of Object.values(obj)) {
            if (v && typeof v === 'object') walk(v);
        }
    };
    walk(raw);
    return out;
}

/** Slugs de listas que nombra la plantilla anterior (para convertirla). */
function listSlugsIn(raw: unknown): Set<string> {
    const out = new Set<string>();
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            if (k === 'list_slug' && typeof v === 'string' && v !== '') out.add(v);
            else if (v && typeof v === 'object') walk(v);
        }
    };
    walk(raw);
    return out;
}

function liteField(f: Field): LayoutFieldLite {
    return { id: f.id, slug: f.slug, label: f.label, type: f.type, config: f.config as Record<string, unknown>, is_primary: f.is_primary };
}

/** Campo «Botón» — lo que el portal necesita para dibujar un botón (sin acciones ni condiciones). */
function portalButtonConfig(config: Record<string, unknown>): Record<string, unknown> {
    const c = readButtonConfig(config);
    return {
        ...(c.label ? { label: c.label } : {}),
        ...(c.color ? { color: c.color } : {}),
        ...(c.icon ? { icon: c.icon } : {}),
        ...(c.confirm ? { confirm: c.confirm } : {}),
        actions: c.actions.map((a) => ({ type: a.type })),
    };
}

/** El estado de los botones del diseño del portal para ESTE registro. */
function portalButtonStates(
    ctx: { fields: Field[]; visible: Set<number>; editableIds: Set<number> },
    data: Record<string, unknown>,
    portalTemplateIds: Set<number>,
    timeZone: string,
): Record<string, { disabled: boolean; reason: string | null; blocked: string | null }> {
    const byId = new Map(ctx.fields.map((f) => [f.id, f]));
    const out: Record<string, { disabled: boolean; reason: string | null; blocked: string | null }> = {};
    for (const f of ctx.fields) {
        if (f.type !== 'button' || !ctx.visible.has(f.id)) continue;
        const cfg = readButtonConfig(f.config);
        const state = buttonDisabledState(cfg, (id) => {
            const ff = byId.get(id);
            return ff ? { type: ff.type, value: data[jsonbKeyForField(id)] } : undefined;
        }, { timeZone });
        const problems = buttonPortalProblems(cfg, { editableFieldIds: ctx.editableIds, portalTemplateIds });
        out[String(f.id)] = { disabled: state.disabled, reason: state.reason, blocked: problems[0] ?? null };
    }
    return out;
}
