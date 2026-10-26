import { createHash, randomBytes } from 'node:crypto';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    addDaysYmd,
    brandingSchema,
    DATA_CONSENT_VARIABLES,
    DATA_CONSENT_WITHDRAW_VIA_LABELS,
    dataConsentMissing,
    dataConsentRecommended,
    DEFAULT_DATA_CONSENT_LABEL,
    DEFAULT_DATA_CONSENT_PURPOSES,
    DEFAULT_DATA_CONSENT_TEMPLATE,
    formatEmailFieldValue,
    readDataConsentConfig,
    renderDataConsent,
    resolveTimeZone,
    tenantFormatSchema,
    zonedInstant,
    type DataConsentConfig,
    type DataConsentRecordDto,
    type DataConsentRecordsPage,
    type DataConsentSource,
    type DataConsentState,
    type DataConsentVersionDto,
    type DataConsentWithdrawVia,
    type FormDataConsentAvailability,
    type ListDataConsentsQuery,
    type PortalConsentDto,
    type PortalConsentStatus,
    type PublicDataConsent,
    type RecordDataConsentDto,
    type Role,
    type UpdateDataConsentInput,
} from '@imagina-base/shared';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import {
    dataConsents,
    dataConsentVersions,
    formPendingSubmissions,
    forms,
    lists,
    memberships,
    portalLinks,
    tenants,
    users,
    type DataConsentRow,
} from '../db/schema';
import { neutralizeFormula } from '../export/export.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * Autorización de tratamiento de datos personales (Ley 1581 de 2012).
 *
 * Una empresa arma su texto (plantilla con variables) en Ajustes → Datos
 * personales. Guardar un cambio del texto YA ARMADO crea una versión nueva;
 * sus formularios y su portal piden aceptar la versión vigente, y cada
 * aceptación queda como evidencia (`data_consents`): quién, versión y hash,
 * cuándo, IP y navegador. El titular la retira desde un enlace firmado que le
 * llega por correo o desde el menú del portal; la empresa se entera por la
 * campana. Retirarla NO borra datos solo: eso lo decide la empresa.
 */

/** La versión vigente, tal como se le pide aceptar a alguien. */
export interface ActiveConsent {
    version: number;
    text: string;
    label: string;
    policy_url: string | null;
    text_hash: string;
    ask_in_portal: boolean;
}

export interface FormConsentInput {
    version: number;
    textHash: string;
    formId: number;
    formName: string;
    listId: number;
    recordId: number | null;
    email: string | null;
    name: string | null;
    acceptedAt: Date;
    ip: string | null;
    userAgent: string | null;
    /**
     * Referencia del enlace de retiro ya mandada por correo (respuesta que se
     * confirmó desde el correo). `undefined` = se crea una si hay correo.
     */
    withdrawRef?: string | null;
}

/** Lo que muestra la página del enlace para retirar la autorización. */
export interface WithdrawLanding {
    kind: 'consent' | 'pending';
    brand: { company: string; accent: string; logoUrl: string | null };
    company: string;
    acceptedAt: string;
    sourceLabel: string;
    version: number;
    text: string | null;
    withdrawnAt: string | null;
    contactEmail: string | null;
}

export interface WithdrawOutcome {
    status: 'withdrawn' | 'already' | 'discarded' | 'invalid';
    landing: WithdrawLanding | null;
}

/** Huella de lo aceptado: casilla + texto + enlace a la política. */
export function consentTextHash(v: { label: string; text: string; policy_url: string | null }): string {
    return createHash('sha256').update(`${v.label}\n\n${v.text}\n\n${v.policy_url ?? ''}`).digest('hex');
}

/** La última autorización del portal de una persona (lo que hace falta para decidir). */
interface LastPortalConsent {
    id: number;
    version: number;
    acceptedAt: string;
    withdrawnAt: string | null;
}

/** Referencia aleatoria del enlace de retiro (lo que se guarda en la base). */
export function newWithdrawRef(): string {
    return randomBytes(16).toString('base64url');
}

const PORTAL_LABEL = 'Portal del cliente';
const SIGN_SCOPE = 'consentwithdraw';
const EXPORT_CAP = 20_000;

const badRequest = (code: string, message: string, extra: Record<string, unknown> = {}) =>
    new BadRequestException({ code, message, data: { status: 400, ...extra } });

function escapeLike(v: string): string {
    return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Una celda CSV (RFC 4180): fórmulas neutralizadas y comillas cuando hace falta. */
function csvCell(raw: string): string {
    const cell = neutralizeFormula(raw);
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

@Injectable()
export class DataConsentService {
    private readonly logger = new Logger(DataConsentService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly files: FilesService,
        private readonly audit: AuditService,
        @Optional() private readonly notifications?: NotificationsService,
    ) {}

    // ─────────────────────────── Configuración ───────────────────────────

    private async tenantRow(tenantId: number): Promise<{ name: string; settings: Record<string, unknown> }> {
        const [row] = await this.db
            .select({ name: tenants.name, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        if (!row) throw new NotFoundException({ code: 'not_found', message: 'Empresa no encontrada', data: { status: 404 } });
        return { name: row.name, settings: (row.settings as Record<string, unknown> | null) ?? {} };
    }

    async state(tenantId: number): Promise<DataConsentState> {
        const t = await this.tenantRow(tenantId);
        const config = readDataConsentConfig(t.settings.data_consent);
        const ctx = { tenantName: t.name };
        const { versions, stats, formsAsking } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const vs = await tx
                .select({
                    version: dataConsentVersions.version,
                    text: dataConsentVersions.text,
                    label: dataConsentVersions.checkboxLabel,
                    policyUrl: dataConsentVersions.policyUrl,
                    textHash: dataConsentVersions.textHash,
                    createdAt: dataConsentVersions.createdAt,
                    createdByName: users.name,
                    consents: sql<number>`(select count(*)::int from ${dataConsents} c where c.tenant_id = ${dataConsentVersions.tenantId} and c.version = ${dataConsentVersions.version})`,
                })
                .from(dataConsentVersions)
                .leftJoin(users, eq(users.id, dataConsentVersions.createdBy))
                .where(eq(dataConsentVersions.tenantId, tenantId))
                .orderBy(desc(dataConsentVersions.version))
                .limit(100);
            const [st] = await tx
                .select({
                    accepted: sql<number>`count(*)::int`,
                    withdrawn: sql<number>`count(${dataConsents.withdrawnAt})::int`,
                })
                .from(dataConsents)
                .where(eq(dataConsents.tenantId, tenantId));
            const [fa] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(forms)
                .where(
                    and(
                        eq(forms.tenantId, tenantId),
                        eq(forms.enabled, true),
                        sql`coalesce((${forms.config}->'settings'->>'data_consent')::boolean, true)`,
                    ),
                );
            return { versions: vs, stats: st, formsAsking: Number(fa?.n ?? 0) };
        });
        const currentRow = config.current_version !== null ? versions.find((v) => v.version === config.current_version) : undefined;
        const toDto = (v: (typeof versions)[number]): DataConsentVersionDto => ({
            version: v.version,
            text: v.text,
            checkbox_label: v.label,
            policy_url: v.policyUrl,
            text_hash: v.textHash,
            created_at: v.createdAt.toISOString(),
            created_by_name: v.createdByName ?? null,
            consents: Number(v.consents ?? 0),
        });
        return {
            config,
            defaults: {
                template: DEFAULT_DATA_CONSENT_TEMPLATE,
                checkbox_label: DEFAULT_DATA_CONSENT_LABEL,
                purposes: [...DEFAULT_DATA_CONSENT_PURPOSES],
            },
            variables: DATA_CONSENT_VARIABLES,
            preview: renderDataConsent(config, ctx),
            missing: dataConsentMissing(config, ctx),
            recommended: dataConsentRecommended(config),
            active: config.enabled && currentRow !== undefined,
            current: currentRow ? toDto(currentRow) : null,
            versions: versions.map((v) => {
                const { text: _text, checkbox_label: _label, ...rest } = toDto(v);
                return rest;
            }),
            stats: { accepted: Number(stats?.accepted ?? 0), withdrawn: Number(stats?.withdrawn ?? 0), forms_asking: formsAsking },
        };
    }

    /**
     * Guarda la configuración. Si el texto YA ARMADO (casilla + texto + enlace)
     * cambió respecto de la versión vigente, crea la versión siguiente: lo que
     * cada persona aceptó queda atado a SU versión. Activarla exige lo que
     * pide la ley (responsable, correo, teléfono, finalidades).
     */
    async update(tenantId: number, userId: number | null, input: UpdateDataConsentInput): Promise<{ state: DataConsentState; newVersion: number | null }> {
        const newVersion = await this.db.transaction(async (tx) => {
            // Una a la vez por empresa: dos guardados simultáneos no crean la misma versión.
            const [t] = await tx
                .select({ name: tenants.name, settings: tenants.settings })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .for('update')
                .limit(1);
            if (!t) throw new NotFoundException({ code: 'not_found', message: 'Empresa no encontrada', data: { status: 404 } });
            const current = readDataConsentConfig((t.settings as Record<string, unknown> | null)?.data_consent);
            const next = mergeConfig(current, input);
            const ctx = { tenantName: t.name };
            const missing = dataConsentMissing(next, ctx);
            if (next.enabled && missing.length > 0) {
                throw badRequest('data_consent_incomplete', `Para activar la autorización falta: ${missing.join(', ')}.`, { missing });
            }
            let created: number | null = null;
            if (missing.length === 0) {
                const rendered = renderDataConsent(next, ctx);
                const hash = consentTextHash(rendered);
                const [cur] =
                    next.current_version !== null
                        ? await tx
                              .select({ hash: dataConsentVersions.textHash })
                              .from(dataConsentVersions)
                              .where(and(eq(dataConsentVersions.tenantId, tenantId), eq(dataConsentVersions.version, next.current_version)))
                              .limit(1)
                        : [];
                if (!cur || cur.hash !== hash) {
                    const [mx] = await tx
                        .select({ n: sql<number>`coalesce(max(${dataConsentVersions.version}), 0)::int` })
                        .from(dataConsentVersions)
                        .where(eq(dataConsentVersions.tenantId, tenantId));
                    created = Number(mx?.n ?? 0) + 1;
                    await tx.insert(dataConsentVersions).values({
                        tenantId,
                        version: created,
                        text: rendered.text,
                        checkboxLabel: rendered.label,
                        policyUrl: rendered.policy_url,
                        textHash: hash,
                        createdBy: userId && userId > 0 ? userId : null,
                    });
                    next.current_version = created;
                }
            }
            await tx
                .update(tenants)
                .set({
                    settings: sql`coalesce(${tenants.settings}, '{}'::jsonb) || jsonb_build_object('data_consent', ${JSON.stringify(next)}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(eq(tenants.id, tenantId));
            return created;
        });
        return { state: await this.state(tenantId), newVersion };
    }

    async version(tenantId: number, version: number): Promise<DataConsentVersionDto> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ v: dataConsentVersions, createdByName: users.name })
                .from(dataConsentVersions)
                .leftJoin(users, eq(users.id, dataConsentVersions.createdBy))
                .where(and(eq(dataConsentVersions.tenantId, tenantId), eq(dataConsentVersions.version, version)))
                .limit(1),
        );
        if (!row) throw new NotFoundException({ code: 'not_found', message: 'Esa versión no existe', data: { status: 404 } });
        return {
            version: row.v.version,
            text: row.v.text,
            checkbox_label: row.v.checkboxLabel,
            policy_url: row.v.policyUrl,
            text_hash: row.v.textHash,
            created_at: row.v.createdAt.toISOString(),
            created_by_name: row.createdByName ?? null,
        };
    }

    // ─────────────────────────── Lo que se pide ───────────────────────────

    /**
     * La versión vigente si la empresa pide la autorización; null = no la
     * pide (apagada o sin texto). `settings` evita releer la empresa cuando
     * el llamador ya la tiene.
     */
    async active(tenantId: number, settings?: Record<string, unknown>): Promise<ActiveConsent | null> {
        const s = settings ?? (await this.tenantRow(tenantId)).settings;
        const cfg = readDataConsentConfig(s.data_consent);
        if (!cfg.enabled || cfg.current_version === null) return null;
        const [row] = await this.db
            .select()
            .from(dataConsentVersions)
            .where(and(eq(dataConsentVersions.tenantId, tenantId), eq(dataConsentVersions.version, cfg.current_version)))
            .limit(1);
        if (!row) return null;
        return {
            version: row.version,
            text: row.text,
            label: row.checkboxLabel,
            policy_url: row.policyUrl,
            text_hash: row.textHash,
            ask_in_portal: cfg.ask_in_portal,
        };
    }

    static toPublic(a: ActiveConsent): PublicDataConsent {
        return { version: a.version, label: a.label, text: a.text, policy_url: a.policy_url };
    }

    /**
     * La versión que la persona VIO (la página se cargó antes de un cambio del
     * texto): se registra ésa si es una versión real de la empresa; si no, la
     * vigente.
     */
    async acceptedVersion(tenantId: number, requested: number | undefined, current: ActiveConsent): Promise<{ version: number; textHash: string }> {
        if (requested === undefined || requested === current.version) return { version: current.version, textHash: current.text_hash };
        const [row] = await this.db
            .select({ version: dataConsentVersions.version, hash: dataConsentVersions.textHash })
            .from(dataConsentVersions)
            .where(and(eq(dataConsentVersions.tenantId, tenantId), eq(dataConsentVersions.version, requested)))
            .limit(1);
        return row ? { version: row.version, textHash: row.hash } : { version: current.version, textHash: current.text_hash };
    }

    /** Para el constructor de formularios: ¿se pide? ¿con qué texto? */
    async availabilityForForms(tenantId: number, role: Role): Promise<FormDataConsentAvailability> {
        const a = await this.active(tenantId);
        return { active: a !== null, consent: a ? DataConsentService.toPublic(a) : null, can_configure: role === 'admin' };
    }

    // ─────────────────────────── Formularios ───────────────────────────

    /** Registra la autorización dada en un formulario (evidencia). */
    async recordForm(tenantId: number, input: FormConsentInput): Promise<{ id: number; withdrawRef: string | null }> {
        const ref = input.withdrawRef !== undefined ? input.withdrawRef : input.email ? newWithdrawRef() : null;
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(dataConsents)
                .values({
                    tenantId,
                    version: input.version,
                    textHash: input.textHash,
                    source: 'form',
                    sourceLabel: `Formulario «${input.formName}»`.slice(0, 300),
                    formId: input.formId,
                    listId: input.listId,
                    recordId: input.recordId,
                    subjectEmail: input.email?.slice(0, 320) ?? null,
                    subjectName: input.name?.slice(0, 300) ?? null,
                    acceptedAt: input.acceptedAt,
                    ip: input.ip?.slice(0, 64) ?? null,
                    userAgent: input.userAgent?.slice(0, 400) ?? null,
                    withdrawRef: ref,
                })
                .returning({ id: dataConsents.id }),
        );
        return { id: row!.id, withdrawRef: ref };
    }

    /**
     * D5 — La autorización dada al reservar en una página de agenda. Mismo
     * contrato que la de un formulario (se guarda ANTES que el registro y se
     * descarta si la cita no se crea); el origen es «Agenda «X»».
     */
    async recordBooking(
        tenantId: number,
        input: Omit<FormConsentInput, 'formId' | 'formName'> & { pageName: string },
    ): Promise<{ id: number; withdrawRef: string | null }> {
        const ref = input.withdrawRef !== undefined ? input.withdrawRef : input.email ? newWithdrawRef() : null;
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(dataConsents)
                .values({
                    tenantId,
                    version: input.version,
                    textHash: input.textHash,
                    source: 'booking',
                    sourceLabel: `Agenda «${input.pageName}»`.slice(0, 300),
                    formId: null,
                    listId: input.listId,
                    recordId: input.recordId,
                    subjectEmail: input.email?.slice(0, 320) ?? null,
                    subjectName: input.name?.slice(0, 300) ?? null,
                    acceptedAt: input.acceptedAt,
                    ip: input.ip?.slice(0, 64) ?? null,
                    userAgent: input.userAgent?.slice(0, 400) ?? null,
                    withdrawRef: ref,
                })
                .returning({ id: dataConsents.id }),
        );
        return { id: row!.id, withdrawRef: ref };
    }

    /** Ata la autorización al registro que creó la respuesta. */
    async linkRecord(tenantId: number, consentId: number, recordId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.update(dataConsents).set({ recordId }).where(and(eq(dataConsents.tenantId, tenantId), eq(dataConsents.id, consentId))),
        );
    }

    /** La respuesta no se pudo guardar: la autorización no existió. */
    async discard(tenantId: number, consentId: number): Promise<void> {
        await this.tenantDb
            .withTenant(tenantId, (tx) => tx.delete(dataConsents).where(and(eq(dataConsents.tenantId, tenantId), eq(dataConsents.id, consentId))))
            .catch(() => undefined);
    }

    /** El enlace (absoluto) para retirar la autorización: `<empresa>.<ref>.<firma>`. */
    withdrawUrl(base: string, tenantId: number, ref: string): string {
        const sig = this.files.signParts(SIGN_SCOPE, tenantId, ref);
        return `${base.replace(/\/+$/, '')}/api/v1/public/consent/withdraw/${tenantId}.${ref}.${sig}`;
    }

    private parseToken(token: string): { tenantId: number; ref: string } | null {
        const m = /^(\d{1,15})\.([A-Za-z0-9_-]{16,40})\.([0-9a-f]{64})$/.exec(token);
        if (!m) return null;
        const tenantId = Number(m[1]);
        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return null;
        return this.files.verifyParts(m[3]!, SIGN_SCOPE, tenantId, m[2]!) ? { tenantId, ref: m[2]! } : null;
    }

    // ─────────────────────────── Portal ───────────────────────────

    /**
     * El estado de la autorización del cliente en el portal de la empresa, en
     * UNA consulta (corre en cada pedido del portal).
     */
    async portalCheck(tenantId: number, userId: number): Promise<{ status: PortalConsentStatus; version: number | null; last: LastPortalConsent | null }> {
        const [row] = await this.db
            .select({
                settings: tenants.settings,
                last: sql<LastPortalConsent | null>`(
                    select row_to_json(c) from (
                        select id, version, accepted_at as "acceptedAt", withdrawn_at as "withdrawnAt"
                        from ${dataConsents}
                        where tenant_id = ${tenantId} and user_id = ${userId} and source = 'portal'
                        order by id desc limit 1
                    ) c)`,
            })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const cfg = readDataConsentConfig((row?.settings as Record<string, unknown> | null)?.data_consent);
        const last = row?.last ?? null;
        if (!cfg.enabled || cfg.current_version === null || !cfg.ask_in_portal) return { status: 'not_required', version: null, last };
        if (!last) return { status: 'required', version: cfg.current_version, last };
        if (last.withdrawnAt) return { status: 'withdrawn', version: cfg.current_version, last };
        if (last.version !== cfg.current_version) return { status: 'outdated', version: cfg.current_version, last };
        return { status: 'accepted', version: cfg.current_version, last };
    }

    /**
     * Para usar el portal hace falta haber aceptado la versión vigente. Sin
     * eso: 403 `consent_required` (el portal muestra el texto para aceptarlo,
     * o salir). Devuelve lo que el menú del portal necesita.
     */
    async assertPortalConsent(tenantId: number, userId: number): Promise<{ version: number; accepted_at: string } | null> {
        const c = await this.portalCheck(tenantId, userId);
        if (c.status === 'not_required') return null;
        if (c.status !== 'accepted' || !c.last) {
            throw new ForbiddenException({
                code: 'consent_required',
                message: 'Para seguir usando el portal, lee y acepta la autorización para el tratamiento de tus datos personales.',
                data: { status: 403, consent_status: c.status },
            });
        }
        return { version: c.last.version, accepted_at: new Date(c.last.acceptedAt).toISOString() };
    }

    async portalDto(tenantId: number, userId: number): Promise<PortalConsentDto> {
        const [c, t] = await Promise.all([this.portalCheck(tenantId, userId), this.tenantRow(tenantId)]);
        const active = c.status === 'not_required' ? null : await this.active(tenantId, t.settings);
        const parsed = brandingSchema.safeParse(t.settings.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        const iso = (v: string | null): string | null => (v ? new Date(v).toISOString() : null);
        return {
            status: active ? c.status : 'not_required',
            consent: active ? DataConsentService.toPublic(active) : null,
            company: b.app_name || t.name,
            branding: {
                primary_color: b.primary_color,
                app_name: b.app_name,
                logo_url: b.logo_file_id !== null ? this.files.signedUrl(tenantId, b.logo_file_id, 3600) : null,
            },
            accepted_at: c.last ? iso(c.last.acceptedAt) : null,
            accepted_version: c.last?.version ?? null,
            withdrawn_at: c.last ? iso(c.last.withdrawnAt) : null,
        };
    }

    /** El cliente acepta la versión vigente desde su portal. */
    async portalAccept(
        tenantId: number,
        userId: number,
        link: { listId: number; recordId: number },
        version: number,
        meta: { ip: string | null; userAgent: string | null },
    ): Promise<PortalConsentDto> {
        const active = await this.active(tenantId);
        if (!active || !active.ask_in_portal) return this.portalDto(tenantId, userId);
        if (version !== active.version) {
            throw new ConflictException({
                code: 'consent_outdated',
                message: 'La empresa actualizó el texto de la autorización mientras lo leías. Léelo de nuevo antes de aceptarlo.',
                data: { status: 409 },
            });
        }
        const c = await this.portalCheck(tenantId, userId);
        if (c.status !== 'accepted') {
            const [u] = await this.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.insert(dataConsents).values({
                    tenantId,
                    version: active.version,
                    textHash: active.text_hash,
                    source: 'portal',
                    sourceLabel: PORTAL_LABEL,
                    listId: link.listId,
                    recordId: link.recordId,
                    userId,
                    subjectEmail: u?.email ?? null,
                    subjectName: u?.name && !u.name.includes('@') ? u.name.slice(0, 300) : null,
                    acceptedAt: new Date(),
                    ip: meta.ip?.slice(0, 64) ?? null,
                    userAgent: meta.userAgent?.slice(0, 400) ?? null,
                }),
            );
        }
        return this.portalDto(tenantId, userId);
    }

    /**
     * El cliente RETIRA su autorización desde el portal: es el titular
     * (sesión del portal), así que se retiran todas las que dio a esta
     * empresa — las del portal y las de formularios con su correo. Los datos
     * no se borran: la empresa se entera y decide.
     */
    async portalWithdraw(tenantId: number, userId: number, meta: { ip: string | null; userAgent: string | null }): Promise<PortalConsentDto> {
        const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        const email = (u?.email ?? '').toLowerCase();
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(dataConsents)
                .set({
                    withdrawnAt: new Date(),
                    withdrawnVia: 'portal',
                    withdrawnIp: meta.ip?.slice(0, 64) ?? null,
                    withdrawnUserAgent: meta.userAgent?.slice(0, 400) ?? null,
                })
                .where(
                    and(
                        eq(dataConsents.tenantId, tenantId),
                        isNull(dataConsents.withdrawnAt),
                        email !== ''
                            ? or(eq(dataConsents.userId, userId), sql`lower(${dataConsents.subjectEmail}) = ${email}`)
                            : eq(dataConsents.userId, userId),
                    ),
                )
                .returning(),
        );
        if (rows.length > 0) await this.notifyWithdrawal(tenantId, rows, 'portal');
        return this.portalDto(tenantId, userId);
    }

    // ─────────────────────────── Enlace de retiro ───────────────────────────

    private async landingBrand(tenantId: number): Promise<{ brand: WithdrawLanding['brand']; company: string; contactEmail: string | null; fmt: FmtCtx }> {
        const t = await this.tenantRow(tenantId);
        const parsed = brandingSchema.safeParse(t.settings.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        const cfg = readDataConsentConfig(t.settings.data_consent);
        const company = cfg.responsible.name || b.app_name || t.name;
        return {
            brand: {
                company: b.app_name || t.name,
                accent: b.primary_color ?? '#0e7490',
                logoUrl: b.logo_file_id !== null ? this.files.signedUrl(tenantId, b.logo_file_id, 3600) : null,
            },
            company,
            contactEmail: cfg.responsible.email || null,
            fmt: fmtOf(t.settings),
        };
    }

    /** Lo que muestra la página del enlace, SIN retirar nada (un GET no cambia nada). */
    async peekWithdraw(token: string): Promise<WithdrawLanding | null> {
        const parsed = this.parseToken(token);
        if (!parsed) return null;
        const found = await this.findByRef(parsed.tenantId, parsed.ref);
        if (!found) return null;
        return this.landing(parsed.tenantId, found);
    }

    /**
     * Retira la autorización del enlace (POST desde la página: los escáneres
     * de correo abren los enlaces con GET). Una respuesta que todavía espera
     * la confirmación del correo se DESCARTA: sin autorización no se guarda.
     */
    async withdrawByToken(
        token: string,
        meta: { ip: string | null; userAgent: string | null },
        discardPending: (tenantId: number, pendingId: number) => Promise<void>,
    ): Promise<WithdrawOutcome> {
        const parsed = this.parseToken(token);
        if (!parsed) return { status: 'invalid', landing: null };
        const found = await this.findByRef(parsed.tenantId, parsed.ref);
        if (!found) return { status: 'invalid', landing: null };
        if (found.kind === 'pending') {
            const landing = await this.landing(parsed.tenantId, found);
            await discardPending(parsed.tenantId, found.pending.id);
            return { status: 'discarded', landing };
        }
        if (found.row.withdrawnAt) return { status: 'already', landing: await this.landing(parsed.tenantId, found) };
        const rows = await this.tenantDb.withTenant(parsed.tenantId, (tx) =>
            tx
                .update(dataConsents)
                .set({
                    withdrawnAt: new Date(),
                    withdrawnVia: 'link',
                    withdrawnIp: meta.ip?.slice(0, 64) ?? null,
                    withdrawnUserAgent: meta.userAgent?.slice(0, 400) ?? null,
                })
                .where(and(eq(dataConsents.tenantId, parsed.tenantId), eq(dataConsents.id, found.row.id), isNull(dataConsents.withdrawnAt)))
                .returning(),
        );
        const fresh = await this.findByRef(parsed.tenantId, parsed.ref);
        const landing = fresh ? await this.landing(parsed.tenantId, fresh) : null;
        if (rows.length === 0) return { status: 'already', landing };
        await this.notifyWithdrawal(parsed.tenantId, rows, 'link');
        return { status: 'withdrawn', landing };
    }

    private async findByRef(
        tenantId: number,
        ref: string,
    ): Promise<{ kind: 'consent'; row: DataConsentRow } | { kind: 'pending'; pending: { id: number; formName: string; consent: { version: number; accepted_at: string } } } | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(dataConsents)
                .where(and(eq(dataConsents.tenantId, tenantId), eq(dataConsents.withdrawRef, ref)))
                .limit(1),
        );
        if (row) return { kind: 'consent', row };
        const [p] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: formPendingSubmissions.id, consent: formPendingSubmissions.consent, formName: forms.name, formTitle: sql<string>`${forms.config}->'settings'->>'title'` })
                .from(formPendingSubmissions)
                .innerJoin(forms, eq(forms.id, formPendingSubmissions.formId))
                .where(
                    and(
                        eq(formPendingSubmissions.tenantId, tenantId),
                        sql`${formPendingSubmissions.consent}->>'withdraw_ref' = ${ref}`,
                        sql`${formPendingSubmissions.expiresAt} > now()`,
                    ),
                )
                .limit(1),
        );
        if (!p || !p.consent) return null;
        return { kind: 'pending', pending: { id: p.id, formName: p.formTitle || p.formName, consent: p.consent } };
    }

    private async landing(
        tenantId: number,
        found: NonNullable<Awaited<ReturnType<DataConsentService['findByRef']>>>,
    ): Promise<WithdrawLanding> {
        const b = await this.landingBrand(tenantId);
        const version = found.kind === 'consent' ? found.row.version : found.pending.consent.version;
        const [v] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ text: dataConsentVersions.text })
                .from(dataConsentVersions)
                .where(and(eq(dataConsentVersions.tenantId, tenantId), eq(dataConsentVersions.version, version)))
                .limit(1),
        );
        const accepted = found.kind === 'consent' ? found.row.acceptedAt.toISOString() : found.pending.consent.accepted_at;
        return {
            kind: found.kind,
            brand: b.brand,
            company: b.company,
            acceptedAt: formatInstant(accepted, b.fmt),
            sourceLabel: found.kind === 'consent' ? found.row.sourceLabel : `Formulario «${found.pending.formName}»`,
            version,
            text: v?.text ?? null,
            withdrawnAt: found.kind === 'consent' && found.row.withdrawnAt ? formatInstant(found.row.withdrawnAt.toISOString(), b.fmt) : null,
            contactEmail: b.contactEmail,
        };
    }

    // ─────────────────────────── Aviso a los admins ───────────────────────────

    private async notifyWithdrawal(tenantId: number, rows: DataConsentRow[], via: DataConsentWithdrawVia): Promise<void> {
        if (!this.notifications || rows.length === 0) return;
        try {
            const admins = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ userId: memberships.userId })
                    .from(memberships)
                    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin'))),
            );
            const ids = admins.map((a) => a.userId);
            if (ids.length === 0) return;
            // Un aviso por registro afectado (con tope): lleva directo a la ficha.
            const seen = new Set<string>();
            for (const r of rows.slice(0, 10)) {
                const key = `${r.listId ?? 0}:${r.recordId ?? 0}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const who = r.subjectName || r.subjectEmail || 'Un titular';
                await this.notifications.deliver(tenantId, 'consent', ids, {
                    listId: r.recordId !== null ? r.listId : null,
                    recordId: r.recordId,
                    actorId: null,
                    title: `${who} retiró su autorización para el tratamiento de datos personales`,
                    body: `${r.sourceLabel} · ${DATA_CONSENT_WITHDRAW_VIA_LABELS[via]}. No se borró ningún dato: decide qué hacer con su información y responde por los canales que publicaste.`,
                });
            }
        } catch (err) {
            this.logger.warn(`Aviso de retiro de autorización: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // ─────────────────────────── Admin ───────────────────────────

    private where(tenantId: number, q: ListDataConsentsQuery, tz: string): SQL {
        const conds: SQL[] = [eq(dataConsents.tenantId, tenantId)];
        if (q.status === 'active') conds.push(isNull(dataConsents.withdrawnAt));
        if (q.status === 'withdrawn') conds.push(isNotNull(dataConsents.withdrawnAt));
        if (q.source !== 'all') conds.push(eq(dataConsents.source, q.source));
        if (q.from) conds.push(gte(dataConsents.acceptedAt, zonedInstant(q.from, tz)));
        if (q.to) conds.push(lt(dataConsents.acceptedAt, zonedInstant(addDaysYmd(q.to, 1), tz)));
        if (q.q && q.q.trim() !== '') {
            const like = `%${escapeLike(q.q.trim().toLowerCase())}%`;
            conds.push(sql`(lower(coalesce(${dataConsents.subjectName}, '')) like ${like} or lower(coalesce(${dataConsents.subjectEmail}, '')) like ${like})`);
        }
        return and(...conds)!;
    }

    private async rows(tenantId: number, where: SQL, limit: number) {
        const withdrawer = sql<string | null>`(select u.name from ${users} u where u.id = ${dataConsents.withdrawnBy})`;
        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ c: dataConsents, listName: lists.name, listSlug: lists.slug, withdrawnByName: withdrawer })
                .from(dataConsents)
                .leftJoin(lists, eq(lists.id, dataConsents.listId))
                .where(where)
                .orderBy(desc(dataConsents.id))
                .limit(limit),
        );
    }

    private toRecordDto(r: Awaited<ReturnType<DataConsentService['rows']>>[number]): DataConsentRecordDto {
        const c = r.c;
        return {
            id: c.id,
            version: c.version,
            source: c.source as DataConsentSource,
            source_label: c.sourceLabel,
            form_id: c.formId,
            list_id: c.listId,
            list_name: r.listName ?? null,
            list_slug: r.listSlug ?? null,
            record_id: c.recordId,
            subject_name: c.subjectName,
            subject_email: c.subjectEmail,
            accepted_at: c.acceptedAt.toISOString(),
            ip: c.ip,
            user_agent: c.userAgent,
            withdrawn_at: c.withdrawnAt ? c.withdrawnAt.toISOString() : null,
            withdrawn_via: (c.withdrawnVia as DataConsentWithdrawVia | null) ?? null,
            withdrawn_note: c.withdrawnNote,
            withdrawn_by_name: r.withdrawnByName ?? null,
        };
    }

    async list(tenantId: number, q: ListDataConsentsQuery): Promise<DataConsentRecordsPage> {
        const t = await this.tenantRow(tenantId);
        const tz = fmtOf(t.settings).timezone;
        let where = this.where(tenantId, q, tz);
        if (q.before) where = and(where, lt(dataConsents.id, q.before))!;
        const found = await this.rows(tenantId, where, q.limit + 1);
        const items = found.slice(0, q.limit).map((r) => this.toRecordDto(r));
        return { items, next_cursor: found.length > q.limit ? (items[items.length - 1]?.id ?? null) : null };
    }

    /**
     * La evidencia en CSV (lleva correos e IP: sólo admin, y queda en la
     * bitácora quién la bajó). Fechas en la zona de la empresa, celdas con
     * fórmulas neutralizadas.
     */
    async exportCsv(tenantId: number, q: ListDataConsentsQuery): Promise<{ filename: string; csv: string; count: number }> {
        const t = await this.tenantRow(tenantId);
        const fmt = fmtOf(t.settings);
        const found = await this.rows(tenantId, this.where(tenantId, q, fmt.timezone), EXPORT_CAP);
        const at = (d: Date | null): string => (d ? formatInstant(d.toISOString(), fmt) : '');
        const header = [
            `Aceptada (${fmt.timezone})`,
            'Titular',
            'Correo',
            'Origen',
            'Desde',
            'Lista',
            'ID del registro',
            'Versión del texto',
            'Huella del texto (SHA-256)',
            'IP',
            'Navegador',
            'Estado',
            'Retirada',
            'Retirada por',
            'Nota del retiro',
        ];
        const lines = [
            header,
            ...found.map(({ c, listName, withdrawnByName }) => [
                at(c.acceptedAt),
                c.subjectName ?? '',
                c.subjectEmail ?? '',
                c.source === 'portal' ? 'Portal' : c.source === 'booking' ? 'Agenda' : 'Formulario',
                c.sourceLabel,
                listName ?? '',
                c.recordId !== null ? String(c.recordId) : '',
                String(c.version),
                c.textHash,
                c.ip ?? '',
                c.userAgent ?? '',
                c.withdrawnAt ? 'Retirada' : 'Vigente',
                at(c.withdrawnAt),
                c.withdrawnVia
                    ? `${DATA_CONSENT_WITHDRAW_VIA_LABELS[c.withdrawnVia as DataConsentWithdrawVia] ?? c.withdrawnVia}${withdrawnByName ? ` (${withdrawnByName})` : ''}`
                    : '',
                c.withdrawnNote ?? '',
            ]),
        ];
        const csv = '﻿' + lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
        const date = new Date().toISOString().slice(0, 10);
        return { filename: `autorizaciones-datos-${date}.csv`, csv, count: found.length };
    }

    /** El admin registra un retiro que le llegó por otro canal (correo, teléfono, en persona). */
    async adminWithdraw(tenantId: number, adminId: number, consentId: number, note: string): Promise<DataConsentRecordDto> {
        const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(dataConsents)
                .set({ withdrawnAt: new Date(), withdrawnVia: 'admin', withdrawnBy: adminId, withdrawnNote: note.slice(0, 500) || null })
                .where(and(eq(dataConsents.tenantId, tenantId), eq(dataConsents.id, consentId), isNull(dataConsents.withdrawnAt)))
                .returning({ id: dataConsents.id }),
        );
        const [row] = await this.rows(tenantId, and(eq(dataConsents.tenantId, tenantId), eq(dataConsents.id, consentId))!, 1);
        if (!row) throw new NotFoundException({ code: 'not_found', message: 'Esa autorización no existe', data: { status: 404 } });
        if (updated.length === 0) {
            throw new ConflictException({ code: 'already_withdrawn', message: 'Esa autorización ya estaba retirada.', data: { status: 409 } });
        }
        return this.toRecordDto(row);
    }

    /**
     * Lo que la ficha muestra: las autorizaciones dadas al crear el registro
     * (formulario) y las de los clientes del portal de ese registro. Sin IP ni
     * navegador. El llamador ya comprobó que la persona ve el registro.
     */
    async forRecord(tenantId: number, recordId: number, tx?: Tx): Promise<RecordDataConsentDto[]> {
        const run = (q: Tx) =>
            q
                .select({
                    id: dataConsents.id,
                    version: dataConsents.version,
                    source: dataConsents.source,
                    sourceLabel: dataConsents.sourceLabel,
                    subjectName: dataConsents.subjectName,
                    subjectEmail: dataConsents.subjectEmail,
                    acceptedAt: dataConsents.acceptedAt,
                    withdrawnAt: dataConsents.withdrawnAt,
                    withdrawnVia: dataConsents.withdrawnVia,
                })
                .from(dataConsents)
                .where(
                    and(
                        eq(dataConsents.tenantId, tenantId),
                        or(
                            eq(dataConsents.recordId, recordId),
                            and(
                                eq(dataConsents.source, 'portal'),
                                inArray(
                                    dataConsents.userId,
                                    q
                                        .select({ u: portalLinks.userId })
                                        .from(portalLinks)
                                        .where(and(eq(portalLinks.tenantId, tenantId), eq(portalLinks.recordId, recordId))),
                                ),
                            ),
                        ),
                    ),
                )
                .orderBy(desc(dataConsents.id))
                .limit(20);
        const found = tx ? await run(tx) : await this.tenantDb.withTenant(tenantId, run);
        return found.map((r) => ({
            id: r.id,
            version: r.version,
            source: r.source as DataConsentSource,
            source_label: r.sourceLabel,
            subject_name: r.subjectName,
            subject_email: r.subjectEmail,
            accepted_at: r.acceptedAt.toISOString(),
            withdrawn_at: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
            withdrawn_via: (r.withdrawnVia as DataConsentWithdrawVia | null) ?? null,
        }));
    }
}

// ─────────────────────────── Auxiliares ───────────────────────────

/** Mezcla un cambio parcial sobre lo guardado (las finalidades vacías se caen). */
export function mergeConfig(cur: DataConsentConfig, input: UpdateDataConsentInput): DataConsentConfig {
    const next: DataConsentConfig = { ...cur, responsible: { ...cur.responsible } };
    if (input.enabled !== undefined) next.enabled = input.enabled;
    if (input.responsible !== undefined) next.responsible = { ...input.responsible };
    if (input.purposes !== undefined) next.purposes = input.purposes.map((p) => p.trim()).filter((p) => p !== '');
    if (input.policy_url !== undefined) next.policy_url = input.policy_url;
    if (input.ask_in_portal !== undefined) next.ask_in_portal = input.ask_in_portal;
    // Guardar el texto sugerido tal cual vuelve a «sugerido» (recibe sus mejoras).
    if (input.template !== undefined) {
        const t = input.template;
        next.template = t === null || t.trim() === DEFAULT_DATA_CONSENT_TEMPLATE.trim() ? null : t;
    }
    if (input.checkbox_label !== undefined) {
        const l = input.checkbox_label;
        next.checkbox_label = l === null || l.trim() === DEFAULT_DATA_CONSENT_LABEL.trim() ? null : l;
    }
    return next;
}

interface FmtCtx {
    number_format: 'comma_dot' | 'dot_comma' | 'space_comma';
    date_format: 'ymd' | 'dmy' | 'mdy';
    time_format: 'h24' | 'h12';
    timezone: string;
}

function fmtOf(settings: Record<string, unknown>): FmtCtx {
    const parsed = tenantFormatSchema.safeParse(settings.format ?? {});
    const f = parsed.success ? parsed.data : tenantFormatSchema.parse({});
    return {
        number_format: f.number_format,
        date_format: f.date_format,
        time_format: f.time_format,
        timezone: resolveTimeZone((settings.format as { timezone?: unknown } | undefined)?.timezone),
    };
}

/** Un instante como lo lee la persona: fecha y hora en el formato y la zona de la empresa. */
function formatInstant(iso: string, fmt: FmtCtx): string {
    return formatEmailFieldValue({ type: 'datetime' }, iso, fmt);
}
