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
} from '@nestjs/common';
import {
    autoPortalLayout,
    brandingSchema,
    DATA_BLOCK_TYPES,
    layoutBlocks,
    migratePortalTemplateToV3,
    portalEditableFieldIds,
    readPortalLayoutV3,
    sanitizePortalLayout,
    tenantFormatSchema,
    isDataField,
    jsonbKeyForField,
    resolveTitleFieldId,
    validateFieldValue,
    type ActivityDto,
    type CommentDto,
    type Field,
    type FieldType,
    type IssueMagicLinkInput,
    type LayoutBlock,
    type LayoutFieldLite,
    type RecordLayoutV3,
    type MagicLinkResult,
    type PortalBoot,
    type PortalAccessCheck,
    type PortalAccessList,
    type PortalAccounts,
    type PortalEmailLinkResult,
    type PortalSwitchResult,
    type PortalCommentInput,
    type PortalLinkedList,
    type PortalRelatedList,
    type PortalUpdateMeInput,
} from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ActivityRepository } from '../activity/activity.repository';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { SessionService } from '../auth/session.service';
import { CommentsRepository } from '../comments/comments.repository';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { DomainsService } from '../domains/domains.service';
import { RecordLayoutDataService } from '../dashboards/record-layout-data.service';
import { fields, lists, memberships, portalLinks, records, relations, users, tenants } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { hiddenFieldsFor } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { portalAccessEmail, senderName, type PortalEmailBrand } from './portal-email';

const MAGIC_TTL_SECONDS = 60 * 60 * 24; // 24h
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

@Injectable()
export class PortalService {
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
    ) {}

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
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), eq(records.id, input.record_id)))
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
    async requestAccess(email: string, host?: string): Promise<void> {
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
        const job = (async () => {
            const scoped = await this.domains.resolveHost(host);
            await this.deliverAccess(email, scoped.tenant?.id ?? null);
        })()
            .catch((err: unknown) =>
                this.logger.warn(`No se pudo reenviar el acceso al portal: ${err instanceof Error ? err.message : String(err)}`),
            )
            .finally(() => this.inFlight.delete(job));
        this.inFlight.add(job);
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
            .select({ id: portalLinks.id, tenantId: portalLinks.tenantId, listId: portalLinks.listId })
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
            // Un portal que la empresa apagó no reparte enlaces nuevos.
            if (await this.portalSwitchedOff(link.tenantId, link.listId)) continue;
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
        const linkRows = await this.db
            .select({ id: portalLinks.id })
            .from(portalLinks)
            .where(and(eq(portalLinks.userId, payload.userId), eq(portalLinks.tenantId, payload.tenantId)))
            .orderBy(portalLinks.id);
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
    async accounts(actor: PortalActor): Promise<PortalAccounts> {
        if (actor.tenantId === null) return { accounts: [], all_companies: false };
        const current = await this.requireLink(actor);
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
                    .where(inArray(records.id, links.map((l) => l.recordId)));
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
            .select({ id: portalLinks.id, tenantId: portalLinks.tenantId, listId: portalLinks.listId })
            .from(portalLinks)
            .where(and(eq(portalLinks.id, linkId), eq(portalLinks.userId, actor.userId)))
            .limit(1);
        if (!link) throw notFound();
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
     * v0.1.241 — "¿Sos cliente de otra empresa?": manda al correo de la persona
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
                    message: 'Ya te mandamos varios enlaces. Revisá tu correo o probá en unos minutos.',
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
    private async requireLink(actor: PortalActor) {
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
            if (await this.portalSwitchedOff(only.tenantId, only.listId)) throw disabled();
            return only;
        }
        const tenantId = actor.tenantId;
        const rows = await this.tenantDb.withUser(actor.userId, (tx) =>
            tx
                .select()
                .from(portalLinks)
                .where(and(eq(portalLinks.userId, actor.userId), eq(portalLinks.tenantId, tenantId)))
                .orderBy(portalLinks.id)
                .limit(100),
        );
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
     * PATCH /portal/me — el cliente edita su propio record. Whitelist
     * server-side: solo slugs declarados en bloques `editable_form` del
     * template configurado (el default no incluye ninguno → sin template
     * explícito nadie edita nada). Slug fuera de la lista → 403 explícito,
     * nunca silencioso.
     */
    async updateMe(actor: PortalActor, input: PortalUpdateMeInput): Promise<{ ok: true }> {
        const userId = actor.userId;
        const link = await this.requireLink(actor);
        const tenantId = link.tenantId;

        const { listId, changedAfter, changedBefore } = await this.tenantDb.withTenant(
            tenantId,
            async (tx) => {
                const [list] = await tx
                    .select({ id: lists.id, settings: lists.settings })
                    .from(lists)
                    .where(eq(lists.id, link.listId))
                    .limit(1);
                if (!list) throw portalGone();
                const listFields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
                const allowed = await this.editableSlugs(tx, tenantId, list.id, list.settings as Record<string, unknown>, listFields);
                if (allowed.size === 0) {
                    throw new ForbiddenException({
                        code: 'portal_not_editable',
                        message: 'Tu portal no permite edición de campos',
                        data: { status: 403 },
                    });
                }

                const bySlug = new Map(listFields.map((f) => [f.slug, f]));

                const patch: Record<string, unknown> = {};
                const errors: Record<string, string> = {};
                for (const [slug, value] of Object.entries(input.fields)) {
                    if (!allowed.has(slug)) {
                        throw new ForbiddenException({
                            code: 'portal_field_forbidden',
                            message: `No tienes permiso para editar el campo "${slug}"`,
                            data: { status: 403 },
                        });
                    }
                    const field = bySlug.get(slug);
                    if (!field || !isDataField(field.type)) {
                        errors[slug] = 'Campo inexistente o no editable';
                        continue;
                    }
                    const result = validateFieldValue(
                        { type: field.type, config: field.config, is_required: field.is_required },
                        value,
                    );
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

                const [current] = await tx
                    .select()
                    .from(records)
                    .where(and(eq(records.id, link.recordId), eq(records.listId, list.id)))
                    .limit(1);
                if (!current) throw portalGone();
                const merged = { ...current.data, ...patch };
                await tx
                    .update(records)
                    .set({ data: merged, updatedAt: new Date() })
                    .where(eq(records.id, current.id));
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId: list.id,
                    recordId: current.id,
                    userId,
                    action: 'record_updated',
                    diff: computeDiff(current.data, merged),
                });
                return { listId: list.id, changedBefore: current.data, changedAfter: merged };
            },
        );
        this.realtime.records(tenantId, listId);
        this.automations.dispatch({
            tenantId,
            listId,
            recordId: link.recordId,
            trigger: 'record_updated',
            after: changedAfter,
            before: changedBefore,
        });
        return { ok: true };
    }

    /** GET /portal/me/comments — comentarios del record del cliente. */
    async myComments(actor: PortalActor): Promise<CommentDto[]> {
        const link = await this.requireLink(actor);
        const rows = await this.tenantDb.withTenant(link.tenantId, (tx) =>
            this.commentsRepo.listByRecord(tx, link.tenantId, link.recordId),
        );
        return rows.map(toPortalComment);
    }

    /** POST /portal/me/comments — nota simple del cliente. */
    async createMyComment(actor: PortalActor, input: PortalCommentInput): Promise<CommentDto> {
        const userId = actor.userId;
        const link = await this.requireLink(actor);
        const row = await this.tenantDb.withTenant(link.tenantId, (tx) =>
            this.commentsRepo.insert(tx, {
                tenantId: link.tenantId,
                listId: link.listId,
                recordId: link.recordId,
                userId,
                body: input.content,
                kind: 'note',
                parentId: null,
                metadata: {},
            }),
        );
        this.realtime.records(link.tenantId, link.listId);
        return toPortalComment(row);
    }

    /** GET /portal/me/activity — timeline del record del cliente. */
    async myActivity(actor: PortalActor, limit: number): Promise<ActivityDto[]> {
        const link = await this.requireLink(actor);
        const cap = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
        const rows = await this.tenantDb.withTenant(link.tenantId, (tx) =>
            this.activityRepo.list(tx, link.tenantId, link.listId, {
                recordId: link.recordId,
                limit: cap,
            }),
        );
        return rows.map((row) => ({
            id: row.id,
            list_id: row.listId,
            record_id: row.recordId,
            user_id: row.userId,
            action: row.action as ActivityDto['action'],
            // El portal NO nombra a quién de la empresa tocó el registro
            // (v0.1.149): el nombre se agregó para el feed interno; exponerlo
            // al cliente sería ampliar lo que ve, y eso se decide aparte.
            user_name: null,
            diff: row.diff,
            created_at: row.createdAt.toISOString(),
        }));
    }

    /**
     * Scope SQL del portal para una lista (la pieza de seguridad central,
     * paridad con `PortalScopeService` del plugin). Fail-closed:
     *  1. lista del portal → solo el record del cliente;
     *  2. lista con un campo `user` (primero por posición) → filas cuyo
     *     campo apunta al usuario;
     *  3. lista con un campo `relation` (primero por posición) hacia la
     *     lista del portal → filas vinculadas al record del cliente;
     *  4. cualquier otro caso → `false` (nunca "ver todo").
     */
    private portalScope(
        listId: number,
        listFields: Field[],
        link: { tenantId: number; listId: number; recordId: number; userId: number },
    ): SQL {
        if (listId === link.listId) return sql`${records.id} = ${link.recordId}`;

        const userField = listFields
            .filter((f) => f.type === 'user')
            .sort((a, b) => a.position - b.position)[0];
        if (userField) {
            return sql`${records.data} ->> ${jsonbKeyForField(userField.id)} = ${String(link.userId)}`;
        }

        const relField = listFields
            .filter(
                (f) =>
                    f.type === 'relation'
                    && Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0) === link.listId,
            )
            .sort((a, b) => a.position - b.position)[0];
        if (relField) {
            return sql`${records.id} IN (
                SELECT ${relations.sourceRecordId} FROM ${relations}
                WHERE ${relations.tenantId} = ${link.tenantId}
                  AND ${relations.fieldId} = ${relField.id}
                  AND ${relations.targetRecordId} = ${link.recordId}
            )`;
        }
        return sql`false`;
    }

    /**
     * GET /portal/lists/:slug/records — records de OTRA lista visibles para
     * el cliente (scope del portal). Paginación por página (los sets del
     * portal son chicos; per_page ≤ 100). Campos por slug, sin los ocultos
     * para el rol `client`.
     */
    async listRecords(
        actor: PortalActor,
        listSlug: string,
        page: number,
        perPage: number,
    ): Promise<{
        data: Array<{ id: number; fields: Record<string, unknown>; relations: Record<string, unknown> }>;
        /** Campos VISIBLES para el cliente (para titular las columnas). */
        fields: Array<{ slug: string; label: string; type: string; config: Record<string, unknown> }>;
        meta: { page: number; per_page: number; total: number; total_pages: number };
    }> {
        const userId = actor.userId;
        const link = await this.requireLink(actor);
        const tenantId = link.tenantId;
        const p = Math.min(Math.max(Math.trunc(page) || 1, 1), 1000);
        const pp = Math.min(Math.max(Math.trunc(perPage) || 10, 1), 100);

        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const list = await this.lists.getWithinTx(tx, tenantId, listSlug);
            const listFields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const scope = this.portalScope(
                list.id,
                listFields,
                { tenantId, listId: link.listId, recordId: link.recordId, userId },
            );
            const where = and(
                eq(records.tenantId, tenantId),
                eq(records.listId, list.id),
                sql`${records.deletedAt} IS NULL`,
                scope,
            );
            const [{ n: total } = { n: 0 }] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(records)
                .where(where);
            const rows = await tx
                .select()
                .from(records)
                .where(where)
                .orderBy(records.id)
                .limit(pp)
                .offset((p - 1) * pp);

            const hidden = hiddenFieldsFor(list.settings, 'client');
            const visible = listFields.filter((f) => isDataField(f.type) && !hidden.has(f.slug));
            return {
                data: rows.map((r) => {
                    const raw = Object.fromEntries(
                        visible.map((f) => [f.slug, (r.data as Record<string, unknown>)[jsonbKeyForField(f.id)] ?? null]),
                    );
                    const bySlug = new Map(visible.map((f) => [f.id, f.slug]));
                    return {
                        id: r.id,
                        fields: this.signFileValues(
                            tenantId,
                            visible.map((f) => ({ id: f.id, type: f.type })),
                            raw,
                            (id) => bySlug.get(id) ?? `f${id}`,
                        ),
                        relations: {},
                    };
                }),
                fields: visible.map((f) => ({
                    slug: f.slug,
                    label: f.label,
                    type: f.type,
                    config: (f.config ?? {}) as Record<string, unknown>,
                })),
                meta: { page: p, per_page: pp, total, total_pages: Math.max(1, Math.ceil(total / pp)) },
            };
        });
    }

    /**
     * GET /portal/lists/:slug/aggregates?fields=1,2 — totales SIEMPRE bajo
     * el scope del portal. Keyed por slug: `{count, sum, avg, min, max}`.
     * Campos ocultos para el rol `client` se filtran (paridad fix S2).
     */
    async aggregates(
        actor: PortalActor,
        listSlug: string,
        rawFields: string,
    ): Promise<{ totals: Record<string, Record<string, number | null>> }> {
        const userId = actor.userId;
        const link = await this.requireLink(actor);
        const tenantId = link.tenantId;
        const fieldIds = rawFields
            .split(',')
            .map((v) => Number(v.trim()))
            .filter((n) => Number.isInteger(n) && n > 0)
            .slice(0, 10);
        if (fieldIds.length === 0) return { totals: {} };

        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const list = await this.lists.getWithinTx(tx, tenantId, listSlug);
            const listFields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const hidden = hiddenFieldsFor(list.settings, 'client');
            const targets = listFields.filter(
                (f) => fieldIds.includes(f.id) && isDataField(f.type) && !hidden.has(f.slug),
            );
            if (targets.length === 0) return { totals: {} };

            const scope = this.portalScope(
                list.id,
                listFields,
                { tenantId, listId: link.listId, recordId: link.recordId, userId },
            );
            const where = and(
                eq(records.tenantId, tenantId),
                eq(records.listId, list.id),
                sql`${records.deletedAt} IS NULL`,
                scope,
            );

            const totals: Record<string, Record<string, number | null>> = {};
            for (const field of targets) {
                const key = jsonbKeyForField(field.id);
                // Casteo numérico defensivo: valores no numéricos quedan
                // fuera de sum/avg/min/max (count cuenta TODAS las filas
                // del scope — "cuántos pedidos tengo").
                const num = sql`CASE WHEN ${records.data} ->> ${key} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${records.data} ->> ${key})::numeric END`;
                const [row] = await tx
                    .select({
                        count: sql<number>`count(*)::int`,
                        sum: sql<string | null>`sum(${num})`,
                        avg: sql<string | null>`avg(${num})`,
                        min: sql<string | null>`min(${num})`,
                        max: sql<string | null>`max(${num})`,
                    })
                    .from(records)
                    .where(where);
                totals[field.slug] = {
                    count: row?.count ?? 0,
                    sum: toNum(row?.sum),
                    avg: toNum(row?.avg),
                    min: toNum(row?.min),
                    max: toNum(row?.max),
                };
            }
            return { totals };
        });
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
        return {
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
        // jamás llega acá — `issue` lo impide — pero el borrado de membresía
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
                .where(inArray(records.id, links.map((l) => l.recordId)));
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
     * mismo criterio que `portalScope` — si acá no aparece, el cliente no
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
     * Las relacionadas que el admin HABILITÓ (`settings.portal.related_lists`),
     * intersectadas con las que de verdad tienen vínculo. Fail-closed: sin
     * elección explícita el cliente no ve ninguna otra lista — exponer todo lo
     * que "roza" su registro filtraría datos internos (comisiones, costos…).
     */
    private async enabledRelatedLists(
        tenantId: number,
        listId: number,
        listSettings: Record<string, unknown>,
    ): Promise<PortalRelatedList[]> {
        const raw = (listSettings.portal ?? {}) as { related_lists?: unknown };
        const chosen = Array.isArray(raw.related_lists)
            ? raw.related_lists.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
            : [];
        if (chosen.length === 0) return [];
        const options = await this.relatedOptions(tenantId, String(listId));
        return options.filter((o) => chosen.includes(o.list_id));
    }

    async me(actor: PortalActor): Promise<PortalBoot> {
        const link = await this.requireLink(actor);
        const boot = { ...(await this.bootWithinTenant(actor.userId, link)), account_id: link.id };
        if (!boot.layout) return boot;
        // v0.1.233 — los gráficos y tablas del diseño viajan en el MISMO
        // request (regla de oro nº 8), ya acotados al cliente.
        const blocks = layoutBlocks(boot.layout)
            .filter((b) => DATA_BLOCK_TYPES.includes(b.type))
            .slice(0, 40)
            .map((b) => ({ id: b.id, type: b.type as 'chart' | 'related', title: b.title, config: b.config }));
        const layoutData = blocks.length === 0
            ? { data: {}, lists: {}, fields: {}, block_lists: {} }
            : await this.layoutData.portal(
                  link.tenantId,
                  { listId: link.listId, recordId: link.recordId, userId: actor.userId },
                  blocks,
                  (fileId) => this.files.signedUrl(link.tenantId, fileId, 3600),
              );
        // Una lista que el diseño ya muestra no se repite al pie.
        const shown = new Set(
            Object.values(layoutData.data)
                .map((d) => (d && typeof d === 'object' ? (d as { list?: { id?: unknown } }).list?.id : undefined))
                .filter((id): id is number => typeof id === 'number'),
        );
        return {
            ...boot,
            layout_data: layoutData,
            related_lists: boot.related_lists.filter((r) => !shown.has(r.list_id)),
        };
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
     * convertido de la plantilla anterior o automático): de acá arranca el
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

    /** Slugs que el cliente puede editar, según el diseño vigente del portal. */
    private async editableSlugs(
        tx: Tx,
        tenantId: number,
        listId: number,
        settings: Record<string, unknown>,
        listFields: Field[],
    ): Promise<Set<string>> {
        const { layout, origin } = await this.resolveLayout(tx, tenantId, listId, settings, listFields.map(liteField));
        if (origin === 'legacy') return editableSlugsFromTemplate(settings.portal_template);
        if (origin !== 'saved' || !layout) return new Set();
        const ids = portalEditableFieldIds(layout, listFields.map(liteField));
        return new Set(listFields.filter((f) => ids.has(f.id)).map((f) => f.slug));
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
    ): Promise<PortalBoot> {
        return this.tenantDb.withTenant(link.tenantId, async (tx) => {
            const [list] = await tx
                .select({ id: lists.id, slug: lists.slug, name: lists.name, settings: lists.settings })
                .from(lists)
                .where(eq(lists.id, link.listId))
                .limit(1);
            const [record] = await tx
                .select()
                .from(records)
                .where(and(eq(records.id, link.recordId), eq(records.listId, link.listId)))
                .limit(1);
            if (!list || !record) {
                throw new NotFoundException({
                    code: 'portal_record_missing',
                    message: 'El record del portal ya no existe',
                    data: { status: 404 },
                });
            }
            const fieldRows = await tx
                .select()
                .from(fields)
                .where(eq(fields.listId, link.listId))
                .orderBy(fields.position);

            // El editor visual guarda `portal_template` como objeto `{ blocks: [...] }`
            // (shape del template-editor). Aceptamos también un array plano legacy.
            // v0.1.93 — los bloques `image` con archivo subido reciben la URL
            // FIRMADA (el rol client no puede usar la descarga con sesión).
            const template = this.signImageBlocks(
                link.tenantId,
                extractPortalBlocks(list.settings.portal_template),
            );
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
            const parsedBranding = brandingSchema.safeParse(
                (tenantRow?.settings as Record<string, unknown> | undefined)?.branding ?? {},
            );
            const b = parsedBranding.success ? parsedBranding.data : brandingSchema.parse({});
            const branding = {
                primary_color: b.primary_color,
                app_name: b.app_name,
                logo_url:
                    b.logo_file_id !== null
                        ? this.files.signedUrl(link.tenantId, b.logo_file_id, 3600)
                        : null,
            };
            // v0.1.104 — el portal muestra montos y fechas del record: usa el
            // mismo formato regional configurado por la empresa.
            const titleFieldId = resolveTitleFieldId(
                fieldRows.map((f) => ({ id: f.id, type: f.type as FieldType })),
                list.settings,
            );
            const parsedFormat = tenantFormatSchema.safeParse(
                (tenantRow?.settings as Record<string, unknown> | undefined)?.format ?? {},
            );
            const format = parsedFormat.success ? parsedFormat.data : tenantFormatSchema.parse({});

            const relatedLists = await this.enabledRelatedLists(
                link.tenantId,
                list.id,
                list.settings as Record<string, unknown>,
            );
            const fieldsLite: LayoutFieldLite[] = fieldRows.map((f) => ({
                id: f.id,
                slug: f.slug,
                label: f.label,
                type: f.type as FieldType,
                config: f.config as Record<string, unknown>,
                is_primary: f.id === titleFieldId,
            }));
            const resolved = await this.resolveLayout(tx, link.tenantId, list.id, list.settings as Record<string, unknown>, fieldsLite);
            const editableIds = resolved.origin === 'saved'
                ? [...portalEditableFieldIds(resolved.layout, fieldsLite)]
                : resolved.origin === 'legacy'
                  ? (() => {
                        const slugs = editableSlugsFromTemplate(list.settings.portal_template);
                        return fieldRows.filter((f) => slugs.has(f.slug)).map((f) => f.id);
                    })()
                  : [];

            return {
                branding,
                format,
                tenant_name: tenantRow?.name ?? '',
                related_lists: relatedLists,
                list_id: list.id,
                list_slug: list.slug,
                list_name: list.name,
                user_id: userId,
                record: {
                    id: record.id,
                    list_id: record.listId,
                    data: this.signFileValues(
                        link.tenantId,
                        fieldRows.map((f) => ({ id: f.id, type: f.type })),
                        record.data as Record<string, unknown>,
                        (id) => `f${id}`,
                    ),
                    parent_id: record.parentId ?? null,
                    subtask_count: 0,
                    has_description: (record.description ?? null) !== null,
                    created_by: record.createdBy,
                    created_at: record.createdAt.toISOString(),
                    updated_at: record.updatedAt.toISOString(),
                },
                fields: fieldRows.map((f) => ({
                    id: f.id,
                    list_id: f.listId,
                    slug: f.slug,
                    label: f.label,
                    type: f.type as PortalBoot['fields'][number]['type'],
                    config: f.config,
                    is_required: f.isRequired,
                    is_unique: f.isUnique,
                    is_indexed: f.isIndexed,
                    is_primary: f.id === titleFieldId,
                    position: f.position,
                    created_at: f.createdAt.toISOString(),
                    description: f.description ?? null,
                })),
                template,
                template_page: templatePage,
                layout: this.signLayoutImages(link.tenantId, resolved.layout),
                layout_origin: resolved.origin,
                layout_data: null,
                editable_field_ids: editableIds,
                account_id: null,
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

function portalGone(): NotFoundException {
    return new NotFoundException({
        code: 'portal_record_missing',
        message: 'El record del portal ya no existe',
        data: { status: 404 },
    });
}

function toNum(v: string | number | null | undefined): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** CommentRow → shape que consume el bloque del portal (content = body). */
function toPortalComment(row: {
    id: number;
    listId: number;
    recordId: number;
    userId: number;
    body: string;
    kind: string;
    parentId: number | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}): CommentDto & { content: string } {
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        user_id: row.userId,
        body: row.body,
        content: row.body,
        kind: row.kind as CommentDto['kind'],
        parent_id: row.parentId,
        metadata: row.metadata,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
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
