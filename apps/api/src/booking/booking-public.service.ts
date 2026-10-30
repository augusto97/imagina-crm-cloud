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
    Optional,
    type OnModuleInit,
} from '@nestjs/common';
import {
    bookingMergeValue,
    bookingPriceLabel,
    brandingSchema,
    buildPublicFormItems,
    formatBookingWhen,
    formItemVisible,
    isBookingQuestionType,
    isEmptyAnswer,
    isValidTimeZone,
    jsonbKeyForField,
    resolveTimeZone,
    staffLabel,
    tenantFormatSchema,
    timeZoneLabel,
    validateFieldValue,
    zonedDayAndMinute,
    type BookAppointmentInput,
    type BookAppointmentResult,
    type BookingConfig,
    type BookingEvent,
    type BookingEventInfo,
    type BookingServiceItem,
    type BookingSlotsQuery,
    type BookingStaff,
    type BookingStatus,
    type CancelAppointmentInput,
    type PublicAppointmentSummary,
    type PublicBookingMeta,
    type PublicBookingSlots,
    type PublicManageMeta,
    type RescheduleAppointmentInput,
    type TenantFormat,
} from '@imagina-base/shared';
import { accessOf } from '../billing/tenant-access';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { ENV, type Env } from '../config/env';
import { DataConsentService } from '../data-consent/data-consent.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { bookingAppointments, bookingPages, lists, records, tenants, users, type BookingAppointmentRow, type BookingPageRow } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { CaptchaService } from '../forms/captcha.service';
import { IncidentHub } from '../incidents/incident-hub';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { ModuleRef } from '@nestjs/core';
import { NotifyHub } from '../notifications/notify-hub';
import { senderName, type PortalEmailBrand } from '../portal/portal-email';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordChangeHub, type RecordChange } from '../records/record-change-hub';
import { RecordsService } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BookingAvailabilityService, type PageContext } from './booking-availability.service';
import { BookingCalendarService } from './booking-calendar';
import { appointmentRecordData, isCancelledValue, readBookingConfig, staffKey } from './booking-config';
import { bookingClientEmail, type BookingMailKind } from './booking-email';
import { buildIcs } from './booking-ics';
import type { BookingSimulator } from './booking-simulator';
import { planModuleOff } from '../billing/plan-module-gate';

/** El sistema crea y mueve el registro: no hay persona del equipo detrás de la reserva. */
const SYSTEM_ACTOR = { userId: 0, role: 'admin' as const };

/** Menos de esto entre cargar la página y reservar es un robot (elegir un horario lleva más). */
const MIN_FILL_MS = 2500;
const STAMP_TTL_MS = 24 * 3600 * 1000;

/** Frenos del endpoint público (por IP y por página, compartidos entre nodos). */
const BOOK_LIMITS = [
    { scope: 'ip', window: 60, max: 6 },
    { scope: 'ip', window: 3600, max: 30 },
    { scope: 'page', window: 60, max: 60 },
    { scope: 'page', window: 3600, max: 1000 },
] as const;
const SLOTS_LIMITS = [
    { scope: 'ip', window: 60, max: 90 },
    { scope: 'page', window: 60, max: 1200 },
] as const;
const MANAGE_LIMITS = [
    { scope: 'ip', window: 600, max: 20 },
    { scope: 'page', window: 3600, max: 500 },
] as const;
/** Correos a una misma dirección por hora (una agenda no es un cañón de correos). */
const CLIENT_MAIL_LIMIT = { window: 3600, max: 6 };

/** El candado de una persona o recurso: cuántas veces se reintenta tomarlo. */
const LOCK_TRIES = 60;

const notFound = () => new NotFoundException({ code: 'not_found', message: 'Esta agenda no existe', data: { status: 404 } });
const apptNotFound = () => new NotFoundException({ code: 'not_found', message: 'Esta cita no existe o el enlace no es válido', data: { status: 404 } });

function badRequest(code: string, message: string, extra: Record<string, unknown> = {}): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400, ...extra } });
}

function unavailable(message = 'No pudimos agendar tu cita en este momento. Prueba de nuevo más tarde.'): HttpException {
    return new HttpException({ code: 'booking_unavailable', message, data: { status: 503 } }, HttpStatus.SERVICE_UNAVAILABLE);
}

/** Lo que no se puede reservar, en palabras del visitante. */
const SLOT_MESSAGES: Record<string, string> = {
    taken: 'Alguien acaba de reservar ese horario. Elige otro.',
    too_soon: 'Ese horario ya no se puede reservar: falta poco para que empiece. Elige otro.',
    out_of_range: 'Ese día ya no está disponible. Elige otro.',
};

/** Una página resuelta por su token, con la empresa. */
export interface ResolvedPage extends PageContext {
    row: BookingPageRow;
    readOnly: boolean;
    tenantSettings: Record<string, unknown>;
    tenantName: string;
    format: TenantFormat;
}

/** El candado se tomó y la función corrió (o el candado está ocupado). */
const LOCK_BUSY = Symbol('busy');

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class BookingPublicService implements OnModuleInit, BookingSimulator {
    private readonly logger = new Logger(BookingPublicService.name);
    /** Listas con páginas de agenda, por empresa (para ignorar el resto de los cambios). */
    private readonly listsWithPages = new Map<number, { at: number; ids: Set<number> }>();

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly files: FilesService,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly dispatcher: AutomationDispatcher,
        @Inject(ENV) private readonly env: Env,
        private readonly availability: BookingAvailabilityService,
        private readonly calendar: BookingCalendarService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly changes?: RecordChangeHub,
        @Optional() private readonly notify?: NotifyHub,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() private readonly domains?: DomainsService,
        @Optional() private readonly captcha?: CaptchaService,
        @Optional() private readonly mail?: MailService,
        @Optional() private readonly dataConsent?: DataConsentService,
        @Optional() private readonly moduleRef?: ModuleRef,
    ) {}

    /**
     * SMS (ADR-S82) — se resuelve al usarlo (su módulo depende de registros y
     * campos, igual que la agenda). Sin él, los recordatorios salen sólo por correo.
     */
    private smsSvc: SmsService | null | undefined;
    private sms(): SmsService | null {
        if (this.smsSvc === undefined) {
            try {
                this.smsSvc = this.moduleRef?.get(SmsService, { strict: false }) ?? null;
            } catch {
                this.smsSvc = null;
            }
        }
        return this.smsSvc;
    }

    /** Para los specs que arman el servicio a mano. */
    setSms(svc: SmsService | null): void {
        this.smsSvc = svc;
    }

    onModuleInit(): void {
        // Cambios del EQUIPO sobre una cita (la ficha, la tabla, el calendario):
        // la cita se mantiene al día (recordatorios, calendario, aviso al cliente).
        this.changes?.subscribe((c) => this.onRecordChange(c));
    }

    // ─────────────────────────── Resolver ───────────────────────────

    /**
     * Token → página, por la conexión base (todavía no se conoce la empresa).
     * Un token mal formado, desconocido, una página sin publicar, una lista en
     * la papelera o una empresa archivada dan el MISMO 404.
     */
    async resolve(token: string, opts: { allowDisabled?: boolean } = {}): Promise<ResolvedPage> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound();
        const [hit] = await this.db
            .select({ page: bookingPages, tenant: tenants })
            .from(bookingPages)
            .innerJoin(tenants, eq(tenants.id, bookingPages.tenantId))
            .innerJoin(lists, and(eq(lists.id, bookingPages.listId), isNull(lists.deletedAt)))
            .where(eq(bookingPages.token, token))
            .limit(1);
        if (!hit || (!hit.page.enabled && !opts.allowDisabled) || hit.tenant.archivedAt !== null) throw notFound();
        // v0.1.338 (ADR-S87) — plan sin «Agenda de citas»: el mismo 404 opaco.
        if (await planModuleOff(this.db, hit.tenant.id, 'booking')) throw notFound();
        return this.toResolved(hit.page, hit.tenant);
    }

    private async resolveById(pageId: number): Promise<ResolvedPage | null> {
        const [hit] = await this.db
            .select({ page: bookingPages, tenant: tenants })
            .from(bookingPages)
            .innerJoin(tenants, eq(tenants.id, bookingPages.tenantId))
            .innerJoin(lists, and(eq(lists.id, bookingPages.listId), isNull(lists.deletedAt)))
            .where(eq(bookingPages.id, pageId))
            .limit(1);
        if (!hit || hit.tenant.archivedAt !== null) return null;
        if (await planModuleOff(this.db, hit.tenant.id, 'booking')) return null;
        return this.toResolved(hit.page, hit.tenant);
    }

    private async toResolved(page: BookingPageRow, tenant: typeof tenants.$inferSelect): Promise<ResolvedPage> {
        const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
        const format = tenantFormatSchema.safeParse(settings.format ?? {});
        const fmt = format.success ? format.data : tenantFormatSchema.parse({});
        return {
            row: page,
            tenantId: page.tenantId,
            pageId: page.id,
            pageName: page.name,
            listId: page.listId,
            config: readBookingConfig(page.config),
            timeZone: resolveTimeZone(fmt.timezone),
            fields: await this.fields.listByListId(page.tenantId, page.listId),
            createdBy: page.createdBy,
            // v0.1.338 — pausada también cuenta (no tiene acceso completo).
            readOnly: accessOf(tenant).state !== 'full',
            tenantSettings: settings,
            tenantName: tenant.name,
            format: fmt,
        };
    }

    /** null = recibe reservas; si no, el motivo que ve el visitante. */
    private closedReason(p: ResolvedPage): string | null {
        if (p.readOnly || !p.row.enabled) return p.config.settings.closed_message;
        return null;
    }

    private brand(p: ResolvedPage): { company: string; accent: string; logoFileId: number | null } {
        const parsed = brandingSchema.safeParse(p.tenantSettings.branding ?? {});
        const b = parsed.success ? parsed.data : brandingSchema.parse({});
        return { company: b.app_name || p.tenantName, accent: p.config.settings.accent_color ?? b.primary_color ?? '#0e7490', logoFileId: b.logo_file_id };
    }

    private async base(tenantId: number): Promise<string> {
        if (this.domains) {
            try {
                return await this.domains.baseUrlFor(tenantId, 'app');
            } catch {
                /* al de la plataforma */
            }
        }
        return this.env.APP_BASE_URL.replace(/\/+$/, '');
    }

    // ─────────────────────────── Página pública ───────────────────────────

    async pageInfo(token: string): Promise<{ title: string; allowed_domains: string[]; meta: PublicBookingMeta } | null> {
        let p: ResolvedPage;
        try {
            p = await this.resolve(token);
        } catch {
            return null;
        }
        const meta = await this.buildMeta(p);
        return { title: meta.title, allowed_domains: p.config.settings.allowed_domains, meta };
    }

    async meta(token: string): Promise<PublicBookingMeta> {
        return this.buildMeta(await this.resolve(token));
    }

    /** Nombre visible de cada persona o recurso (la persona: su nombre en la app). */
    async staffNames(config: BookingConfig): Promise<Map<string, string>> {
        const ids = config.staff.filter((s) => s.kind === 'user' && s.staff_user_id !== null).map((s) => s.staff_user_id!);
        const names = new Map<number, string>();
        if (ids.length > 0) {
            const rows = await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
            for (const r of rows) names.set(r.id, r.name);
        }
        return new Map(
            config.staff.map((s) => [
                s.id,
                s.name.trim() || (s.kind === 'user' && s.staff_user_id !== null ? names.get(s.staff_user_id) ?? staffLabel(s) : staffLabel(s)),
            ]),
        );
    }

    private async buildMeta(p: ResolvedPage): Promise<PublicBookingMeta> {
        const s = p.config.settings;
        const b = this.brand(p);
        const ts = Date.now();
        const names = await this.staffNames(p.config);
        const keys = s.captcha && this.captcha ? await this.captcha.resolve(p.tenantId, p.tenantSettings) : null;
        const consent = this.dataConsent && s.data_consent ? await this.dataConsent.active(p.tenantId, p.tenantSettings) : null;
        const staff = p.config.staff.filter((x) => x.active && (x.kind === 'resource' || x.staff_user_id !== null));
        const fieldsForQuestions = p.fields.filter((f) => isBookingQuestionType(f.type));
        return {
            title: s.title || p.row.name,
            description: s.description,
            location: s.location,
            accent_color: b.accent,
            logo_url: s.show_logo && b.logoFileId !== null ? this.files.signedUrl(p.tenantId, b.logoFileId, 3600) : null,
            company: b.company,
            time_zone: p.timeZone,
            time_zone_label: timeZoneLabel(p.timeZone),
            number_format: p.format.number_format,
            services: p.config.services
                .filter((x) => x.active && staff.some((st) => st.services.length === 0 || st.services.includes(x.id)))
                .map((x) => ({ id: x.id, name: x.name, duration_min: x.duration_min, description: x.description, price_label: bookingPriceLabel(x.price, p.format.number_format) })),
            staff: staff.map((x) => ({ id: x.id, name: names.get(x.id) ?? staffLabel(x), kind: x.kind, services: x.services })),
            choose_staff: s.choose_staff === 'visitor' && staff.length > 1,
            ask_phone: s.ask_phone,
            questions: buildPublicFormItems({ items: p.config.questions, settings: {} as never }, fieldsForQuestions),
            max_days_ahead: p.config.rules.max_days_ahead,
            min_notice_min: p.config.rules.min_notice_min,
            closed: this.closedReason(p),
            success_message: s.success_message,
            stamp: `${ts}.${this.files.signParts('bookstamp', p.pageId, ts)}`,
            captcha: keys ? { provider: keys.provider, site_key: keys.siteKey } : null,
            data_consent: consent ? DataConsentService.toPublic(consent) : null,
        };
    }

    async slots(token: string, ip: string, q: BookingSlotsQuery): Promise<PublicBookingSlots> {
        const p = await this.resolve(token);
        await this.enforce(SLOTS_LIMITS, p.pageId, ip, 'horarios');
        if (this.closedReason(p)) return { slots: [], first_day: q.from, last_day: q.to };
        return this.availability.slots(p, q.service, this.staffSelection(p, q.staff), q.from, q.to);
    }

    /** «Que lo asigne solo»: el visitante no elige aunque mande un id. */
    private staffSelection(p: ResolvedPage, requested: string): string {
        return p.config.settings.choose_staff === 'auto' ? 'any' : requested;
    }

    // ─────────────────────────── Reservar ───────────────────────────

    async book(token: string, ip: string, input: BookAppointmentInput, meta: { userAgent?: string | null } = {}): Promise<BookAppointmentResult> {
        const p = await this.resolve(token);
        const closed = this.closedReason(p);
        if (closed) throw new ForbiddenException({ code: 'booking_closed', message: closed, data: { status: 403 } });

        // Robots: la trampa se "acepta" sin guardar nada; el sello tiene que ser
        // de esta página y de hace más de unos segundos.
        if (input.hp && input.hp.trim() !== '') return { ok: true, appointment: null };
        this.checkStamp(p.pageId, input.stamp);
        await this.enforce(BOOK_LIMITS, p.pageId, ip, 'reservas');

        const service = this.availability.service(p.config, input.service_id);
        const start = new Date(input.start);
        if (Number.isNaN(start.getTime())) throw badRequest('booking_invalid', 'Elige un horario.');
        const end = new Date(start.getTime() + service.duration_min * 60_000);

        // Datos del cliente y preguntas extra (lo decide el servidor).
        const errors: Record<string, string> = {};
        const email = validateFieldValue({ type: 'email', config: {}, is_required: true }, input.email);
        if (!email.ok) errors.email = 'Revisa el correo.';
        let phone: string | null = null;
        const phoneField = p.config.mapping.phone_field_id !== null ? p.fields.find((f) => f.id === p.config.mapping.phone_field_id) : undefined;
        if (p.config.settings.ask_phone !== 'hidden') {
            const raw = (input.phone ?? '').trim();
            if (raw === '' && p.config.settings.ask_phone === 'required') errors.phone = 'Escribe tu teléfono.';
            else if (raw !== '') {
                const res = validateFieldValue({ type: phoneField?.type === 'phone' ? 'phone' : 'text', config: phoneField?.config ?? {}, is_required: false }, raw);
                if (!res.ok) errors.phone = res.error;
                else phone = String(res.value);
            }
        }
        const answers = this.collectQuestions(p, input.values, errors);
        const consent = this.dataConsent && p.config.settings.data_consent ? await this.dataConsent.active(p.tenantId, p.tenantSettings) : null;
        if (consent && input.consent !== true) errors.__consent = 'Para agendar, acepta la autorización para el tratamiento de tus datos personales.';
        if (Object.keys(errors).length > 0) throw badRequest('booking_invalid', 'Revisa los datos marcados.', { errors });

        await this.checkCaptcha(p, input.captcha, ip);

        const clientEmail = String(email.ok ? email.value : input.email).trim();
        const clientName = input.name.trim().slice(0, 200);
        const clientTz = input.time_zone && isValidTimeZone(input.time_zone) ? input.time_zone : null;

        // Quién atiende: el elegido o, con «el primero disponible», el que lleva
        // más tiempo sin recibir una cita de esta página (reparto por turno).
        const sel = this.staffSelection(p, input.staff_id);
        let candidates = this.availability.candidates(p.config, service.id, sel);
        if (candidates.length === 0) throw badRequest('booking_invalid', 'No hay quién atienda ese servicio. Elige otro.');
        if (sel === 'any') candidates = await this.roundRobin(p, candidates);

        // Ley 1581: la prueba de la autorización se guarda ANTES que la cita.
        let evidence: { id: number; withdrawRef: string | null } | null = null;
        if (consent && this.dataConsent) {
            const accepted = await this.dataConsent.acceptedVersion(p.tenantId, input.consent_version, consent);
            evidence = await this.dataConsent
                .recordBooking(p.tenantId, {
                    version: accepted.version,
                    textHash: accepted.textHash,
                    pageName: p.config.settings.title || p.row.name,
                    listId: p.listId,
                    recordId: null,
                    email: clientEmail,
                    name: clientName,
                    acceptedAt: new Date(),
                    ip: ip || null,
                    userAgent: meta.userAgent ?? null,
                })
                .catch((err: unknown) => {
                    this.logger.warn(`Agenda ${p.pageId}: no se pudo guardar la autorización de datos: ${String(err)}`);
                    throw unavailable();
                });
        }

        const names = await this.staffNames(p.config);
        let created: { appt: BookingAppointmentRow; record: { id: number; data: Record<string, unknown> }; staff: BookingStaff } | null = null;
        let lastReason = 'taken';
        try {
            for (const staff of candidates) {
                const out = await this.tryBook(p, staff, service, start, end, {
                    data: {
                        ...answers,
                        ...appointmentRecordData({
                            config: p.config,
                            fieldsById: new Map(p.fields.map((f) => [f.id, f])),
                            service,
                            staff,
                            staffName: names.get(staff.id) ?? staffLabel(staff),
                            start,
                            end,
                            status: 'confirmed',
                            client: { name: clientName, email: clientEmail, phone },
                        }),
                    },
                    clientName,
                    clientEmail,
                    clientTz,
                });
                if ('reason' in out) {
                    lastReason = out.reason;
                    continue;
                }
                created = { ...out, staff };
                break;
            }
        } catch (err) {
            if (evidence && this.dataConsent) await this.dataConsent.discard(p.tenantId, evidence.id);
            throw err;
        }
        if (!created) {
            if (evidence && this.dataConsent) await this.dataConsent.discard(p.tenantId, evidence.id);
            throw new ConflictException({ code: 'booking_slot_taken', message: SLOT_MESSAGES[lastReason] ?? SLOT_MESSAGES.taken, data: { status: 409 } });
        }
        if (evidence && this.dataConsent) {
            await this.dataConsent.linkRecord(p.tenantId, evidence.id, created.record.id).catch(() => undefined);
        }

        // Después del commit: tiempo real, automatizaciones, avisos, correo y calendario.
        const { appt, record, staff } = created;
        this.realtime.records(p.tenantId, p.listId);
        this.dispatcher.dispatch({ tenantId: p.tenantId, listId: p.listId, recordId: record.id, trigger: 'record_created', after: record.data });
        const list = await this.lists.get(p.tenantId, String(p.listId)).catch(() => null);
        this.changes?.emit({
            tenantId: p.tenantId,
            listId: p.listId,
            recordId: record.id,
            before: {},
            after: record.data,
            kind: 'created',
            actorId: 0,
            origin: 'booking',
            ...(list ? { list, fields: p.fields } : {}),
        });
        const base = await this.base(p.tenantId);
        const info = this.eventInfo(p, appt, 'booked', 'client', base, names, null);
        this.dispatchEvent(p, appt, info, record.data);
        this.notifyStaff(p, appt, staff, 'booked', info);
        void this.afterChange(p, appt, staff, 'booked', { base, names, withdrawRef: evidence?.withdrawRef ?? null });
        return { ok: true, appointment: this.summary(p, appt, base, names) };
    }

    /**
     * Toma el candado de la persona o recurso y, adentro de la MISMA
     * transacción, vuelve a mirar si el horario sigue libre (otra reserva pudo
     * entrar un segundo antes) y crea el registro. Dos reservas del mismo
     * horario: sólo una gana.
     */
    private async tryBook(
        p: ResolvedPage,
        staff: BookingStaff,
        service: BookingServiceItem,
        start: Date,
        end: Date,
        x: { data: Record<string, unknown>; clientName: string; clientEmail: string; clientTz: string | null },
    ): Promise<{ appt: BookingAppointmentRow; record: { id: number; data: Record<string, unknown> } } | { reason: string }> {
        const ymd = zonedDayAndMinute(start, p.timeZone).ymd;
        // Lo del calendario externo se lee ANTES del candado (no se espera a la red con él tomado).
        const external = await this.availability.externalBusy(p, staff, ymd, ymd);
        const list = await this.lists.get(p.tenantId, String(p.listId));
        let prep;
        try {
            prep = await this.records.prepareCreate(p.tenantId, SYSTEM_ACTOR, list, p.fields, { data: x.data }, { lenientRequired: true });
        } catch (err) {
            this.reportLost(p, err);
            throw unavailable();
        }
        const planRoom = await this.records.planRoomChecker(p.tenantId, 1);
        try {
            return await this.withStaffLock(p.tenantId, staffKey(p.pageId, staff), async (tx) => {
                const reason = await this.availability.checkInTx(tx, p, staff, service, start, external);
                if (reason) return { reason };
                if (planRoom) await planRoom(tx);
                const inserted = await this.records.insertPreparedInTx(tx, p.tenantId, SYSTEM_ACTOR, prep);
                const [appt] = await tx
                    .insert(bookingAppointments)
                    .values({
                        tenantId: p.tenantId,
                        pageId: p.pageId,
                        listId: p.listId,
                        recordId: inserted.id,
                        staffId: staff.id,
                        staffUserId: staff.kind === 'user' ? staff.staff_user_id : null,
                        serviceId: service.id,
                        startAt: start,
                        endAt: end,
                        status: 'confirmed',
                        clientName: x.clientName,
                        clientEmail: x.clientEmail,
                        clientTz: x.clientTz,
                        remindersSent: this.passedReminders(p.config, start),
                    })
                    .returning();
                await tx
                    .update(bookingPages)
                    .set({ bookingsCount: sql`${bookingPages.bookingsCount} + 1`, lastBookedAt: new Date() })
                    .where(eq(bookingPages.id, p.pageId));
                return { appt: appt!, record: { id: inserted.id, data: inserted.data as Record<string, unknown> } };
            });
        } catch (err) {
            if (err instanceof HttpException && err.getStatus() < 500 && err.getStatus() !== 403) throw err;
            this.reportLost(p, err);
            throw unavailable();
        }
    }

    /** Una reserva que no se pudo guardar es de la empresa (el plan lleno, un campo nuevo): Problemas. */
    private reportLost(p: ResolvedPage, err: unknown): void {
        const reason = err instanceof HttpException ? String((err.getResponse() as { message?: unknown }).message ?? err.message) : err instanceof Error ? err.message : String(err);
        this.logger.warn(`Agenda ${p.pageId}: no se pudo guardar una reserva: ${reason}`);
        this.incidents?.report({
            tenantId: p.tenantId,
            key: `booking:${p.pageId}`,
            source: 'booking',
            sourceId: p.pageId,
            listId: p.listId,
            ownerId: p.createdBy,
            title: `La agenda «${p.row.name}» está perdiendo reservas`,
            message: `Alguien intentó agendar y no se pudo guardar: ${reason} A esa persona le dijimos que pruebe más tarde.`,
        });
    }

    /**
     * Candado por persona o recurso, cross-nodo, DENTRO de la transacción
     * (`pg_try_advisory_xact_lock`): si está tomado, se suelta la transacción y
     * se reintenta en un momento — nadie retiene una conexión del pool
     * esperando.
     */
    async withStaffLock<T>(tenantId: number, key: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
        for (let i = 0; i < LOCK_TRIES; i++) {
            const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const res = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`booking:${tenantId}:${key}`}, 0)) as ok`);
                const ok = (res as unknown as { rows: Array<{ ok: boolean }> }).rows[0]?.ok === true;
                if (!ok) return LOCK_BUSY;
                return { value: await fn(tx) };
            });
            if (out !== LOCK_BUSY) return out.value;
            await sleep(60 + Math.floor(Math.random() * 90));
        }
        throw unavailable('Hay muchas reservas en este momento. Prueba de nuevo en unos segundos.');
    }

    /** «El primero disponible»: primero quien lleva más tiempo sin recibir una cita de esta página. */
    private async roundRobin(p: ResolvedPage, staff: BookingStaff[]): Promise<BookingStaff[]> {
        const rows = await this.tenantDb.withTenant(p.tenantId, (tx) =>
            tx
                .select({ staffId: bookingAppointments.staffId, last: sql<string>`max(${bookingAppointments.createdAt})` })
                .from(bookingAppointments)
                .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.pageId, p.pageId)))
                .groupBy(bookingAppointments.staffId),
        );
        const last = new Map(rows.map((r) => [r.staffId, new Date(r.last).getTime()]));
        const order = new Map(staff.map((s, i) => [s.id, i]));
        return [...staff].sort((a, b) => (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }

    /** Recordatorios cuyo momento ya pasó al reservar (no se mandan tarde). */
    private passedReminders(config: BookingConfig, start: Date, now = new Date()): string[] {
        return config.notifications.reminders.filter((r) => start.getTime() - r.minutes_before * 60_000 <= now.getTime()).map((r) => r.id);
    }

    /** Preguntas extra: sólo las de la página, a la vista con esas respuestas, validadas con el campo. */
    private collectQuestions(p: ResolvedPage, values: Record<string, unknown>, errors: Record<string, string>): Record<string, unknown> {
        const items = p.config.questions;
        const byId = new Map(p.fields.map((f) => [f.id, f]));
        const data: Record<string, unknown> = {};
        for (const item of items) {
            if (item.type !== 'field') continue;
            const field = byId.get(item.field_id);
            if (!field || !isBookingQuestionType(field.type)) continue;
            if (!item.hidden && !formItemVisible(item, items, values)) continue;
            if (item.hidden) continue;
            const raw = values[String(field.id)];
            const required = item.required || field.is_required;
            if (required && isEmptyAnswer(raw)) {
                errors[item.id] = 'Esta pregunta es obligatoria.';
                continue;
            }
            if (isEmptyAnswer(raw) && field.type !== 'checkbox') continue;
            const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, raw);
            if (!res.ok) {
                errors[item.id] = res.error;
                continue;
            }
            data[jsonbKeyForField(field.id)] = res.value;
        }
        return data;
    }

    private async checkCaptcha(p: ResolvedPage, token: string | undefined, ip: string): Promise<void> {
        if (!p.config.settings.captcha || !this.captcha) return;
        const keys = await this.captcha.resolve(p.tenantId, p.tenantSettings);
        const key = `booking-captcha:${p.pageId}`;
        if (!keys) {
            this.incidents?.report({
                tenantId: p.tenantId,
                key,
                source: 'booking',
                sourceId: p.pageId,
                listId: p.listId,
                ownerId: p.createdBy,
                title: `La agenda «${p.row.name}» pide verificación anti-robots pero no hay llaves`,
                message: 'Las reservas siguen llegando sin la verificación. Carga las llaves en Ajustes → Portal y formularios, o apaga la opción en la página de agenda.',
            });
            return;
        }
        this.incidents?.resolve(p.tenantId, key);
        const verdict = await this.captcha.verify(keys, token, ip);
        if (verdict.ok) return;
        if (verdict.reason === 'unavailable') throw unavailable('No pudimos comprobar la verificación en este momento. Prueba de nuevo en un rato.');
        throw badRequest('captcha_failed', verdict.reason === 'reused' ? 'La verificación ya se usó. Complétala de nuevo.' : 'Completa la verificación para agendar.');
    }

    private checkStamp(pageId: number, stamp: string): void {
        const [tsRaw, sig] = (stamp ?? '').split('.');
        const ts = Number(tsRaw);
        if (!sig || !Number.isFinite(ts) || !this.files.verifyParts(sig, 'bookstamp', pageId, ts) || Date.now() - ts > STAMP_TTL_MS) {
            throw badRequest('booking_stale', 'La página venció: recárgala y vuelve a elegir el horario.');
        }
        if (Date.now() - ts < MIN_FILL_MS) throw badRequest('booking_too_fast', 'Espera un momento y vuelve a intentar.');
    }

    /** Ventanas fijas en Redis, por IP y por página. Redis caído → no frena. */
    private async enforce(
        limits: ReadonlyArray<{ scope: 'ip' | 'page'; window: number; max: number }>,
        pageId: number,
        ip: string,
        what: string,
    ): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        for (const { scope, window, max } of limits) {
            const who = scope === 'ip' ? `ip:${ip}:${pageId}` : `page:${pageId}`;
            const key = `bookrl:${what}:${window}:${Math.floor(now / window)}:${who}`;
            let count: number;
            try {
                const res = await this.redis.multi().incr(key).expire(key, window).exec();
                count = Number(res?.[0]?.[1] ?? 0);
            } catch {
                return;
            }
            if (count > max) {
                throw new HttpException(
                    { code: 'rate_limited', message: 'Recibimos demasiados pedidos seguidos. Espera un momento y vuelve a intentar.', data: { status: 429 } },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        }
    }

    // ─────────────────────────── La cita del cliente ───────────────────────────

    /** Firma del enlace de una cita: `<id>.<firma>` (la cita no se adivina por su número). */
    manageRef(tenantId: number, apptId: number): string {
        return `${apptId}.${this.files.signParts('bookmanage', tenantId, apptId)}`;
    }

    manageUrl(base: string, tenantId: number, apptId: number): string {
        return `${base}/api/v1/public/b/manage/${this.manageRef(tenantId, apptId)}`;
    }

    /** Enlace → cita + página. Uno alterado o de una cita que no existe da el mismo 404. */
    private async resolveAppointment(ref: string): Promise<{ p: ResolvedPage; appt: BookingAppointmentRow }> {
        const m = /^(\d{1,15})\.([A-Za-z0-9_-]{10,128})$/.exec(ref ?? '');
        if (!m) throw apptNotFound();
        const id = Number(m[1]);
        const [appt] = await this.db.select().from(bookingAppointments).where(eq(bookingAppointments.id, id)).limit(1);
        if (!appt || !this.files.verifyParts(m[2]!, 'bookmanage', appt.tenantId, appt.id)) throw apptNotFound();
        // El registro en la papelera: la cita no existe para el cliente.
        const [rec] = await this.db
            .select({ id: records.id })
            .from(records)
            .where(and(eq(records.id, appt.recordId), isNull(records.deletedAt)))
            .limit(1);
        const p = rec ? await this.resolveById(appt.pageId) : null;
        if (!p) throw apptNotFound();
        return { p, appt };
    }

    /** ¿Se puede reprogramar o cancelar? (no cancelada, no pasada, con el aviso mínimo). */
    private lockedReason(p: ResolvedPage, appt: BookingAppointmentRow, now = new Date()): string | null {
        if (appt.status === 'cancelled') return 'Esta cita está cancelada.';
        if (appt.startAt.getTime() <= now.getTime()) return 'Esta cita ya pasó.';
        if (p.readOnly) return 'Por ahora no se pueden hacer cambios en línea. Comunícate con la empresa.';
        const notice = p.config.rules.min_notice_min * 60_000;
        if (appt.startAt.getTime() - now.getTime() < notice) {
            const hours = Math.round(p.config.rules.min_notice_min / 60);
            return `Los cambios se hacen con al menos ${hours >= 1 ? `${hours} hora${hours === 1 ? '' : 's'}` : `${p.config.rules.min_notice_min} minutos`} de anticipación. Comunícate con la empresa.`;
        }
        return null;
    }

    summary(p: ResolvedPage, appt: BookingAppointmentRow, base: string, names: Map<string, string>): PublicAppointmentSummary {
        const svc = p.config.services.find((s) => s.id === appt.serviceId);
        const locked = this.lockedReason(p, appt);
        const url = this.manageUrl(base, p.tenantId, appt.id);
        return {
            service: svc?.name ?? 'Cita',
            staff: names.get(appt.staffId) ?? '',
            start: appt.startAt.toISOString(),
            end: appt.endAt.toISOString(),
            status: appt.status as BookingStatus,
            location: p.config.settings.location,
            client_name: appt.clientName ?? '',
            time_zone: p.timeZone,
            manage_url: url,
            ics_url: `${base}/api/v1/public/booking/manage/${this.manageRef(p.tenantId, appt.id)}/ics`,
            can_reschedule: locked === null && p.config.rules.allow_reschedule,
            can_cancel: locked === null && p.config.rules.allow_cancel,
            locked_reason: locked,
        };
    }

    async manageMeta(ref: string): Promise<PublicManageMeta> {
        const { p, appt } = await this.resolveAppointment(ref);
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        const booking = await this.buildMeta(p);
        return { appointment: this.summary(p, appt, base, names), booking, service_id: appt.serviceId, staff_id: appt.staffId };
    }

    /** La página HTML de gestión: null si el enlace no sirve (mismo 404 para todo). */
    async managePage(ref: string): Promise<{ meta: PublicManageMeta; allowed_domains: string[] } | null> {
        try {
            const { p } = await this.resolveAppointment(ref);
            return { meta: await this.manageMeta(ref), allowed_domains: p.config.settings.allowed_domains };
        } catch {
            return null;
        }
    }

    /** Horarios para reprogramar: los mismos de la página, sin contar la propia cita. */
    async manageSlots(ref: string, ip: string, q: BookingSlotsQuery): Promise<PublicBookingSlots> {
        const { p, appt } = await this.resolveAppointment(ref);
        await this.enforce(SLOTS_LIMITS, p.pageId, ip, 'horarios');
        if (this.lockedReason(p, appt) || !p.config.rules.allow_reschedule) return { slots: [], first_day: q.from, last_day: q.to };
        return this.availability.slots(p, appt.serviceId, this.staffSelection(p, q.staff), q.from, q.to, { excludeRecordId: appt.recordId });
    }

    async ics(ref: string): Promise<{ filename: string; body: string }> {
        const { p, appt } = await this.resolveAppointment(ref);
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        return { filename: 'cita.ics', body: this.icsFor(p, appt, base, names) };
    }

    private icsFor(p: ResolvedPage, appt: BookingAppointmentRow, base: string, names: Map<string, string>): string {
        const svc = p.config.services.find((s) => s.id === appt.serviceId);
        const b = this.brand(p);
        const staff = names.get(appt.staffId) ?? '';
        const url = this.manageUrl(base, p.tenantId, appt.id);
        return buildIcs({
            uid: `cita-${appt.id}-${p.tenantId}@imagina-base`,
            start: appt.startAt,
            end: appt.endAt,
            summary: `${svc?.name ?? 'Cita'}${b.company ? ` — ${b.company}` : ''}`,
            description: [staff ? `Con: ${staff}` : '', p.config.notifications.email_note, `Para cambiar o cancelar: ${url}`].filter(Boolean).join('\n\n'),
            location: p.config.settings.location,
            sequence: Math.max(0, Math.floor((appt.updatedAt.getTime() - Date.UTC(2026, 0, 1)) / 1000)),
            cancelled: appt.status === 'cancelled',
            url,
        });
    }

    async cancel(ref: string, ip: string, input: CancelAppointmentInput): Promise<PublicAppointmentSummary> {
        const { p, appt } = await this.resolveAppointment(ref);
        await this.enforce(MANAGE_LIMITS, p.pageId, ip, 'cambios');
        const locked = this.lockedReason(p, appt);
        if (locked || !p.config.rules.allow_cancel) {
            throw new ForbiddenException({ code: 'booking_locked', message: locked ?? 'Esta agenda no permite cancelar en línea. Comunícate con la empresa.', data: { status: 403 } });
        }
        const data: Record<string, unknown> = {};
        const cancelled = p.config.mapping.status_cancelled;
        if (p.config.mapping.status_field_id !== null && cancelled !== null) data[jsonbKeyForField(p.config.mapping.status_field_id)] = cancelled;
        if (Object.keys(data).length > 0) {
            await this.records.update(p.tenantId, SYSTEM_ACTOR, String(p.listId), appt.recordId, { data }, { origin: 'booking' }).catch((err: unknown) => {
                this.reportLost(p, err);
                throw unavailable('No pudimos cancelar tu cita en este momento. Prueba de nuevo más tarde.');
            });
        }
        const [row] = await this.tenantDb.withTenant(p.tenantId, (tx) =>
            tx
                .update(bookingAppointments)
                .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
                .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id)))
                .returning(),
        );
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        const staff = p.config.staff.find((s) => s.id === appt.staffId);
        const info = this.eventInfo(p, row!, 'cancelled', 'client', base, names, null);
        this.dispatchEvent(p, row!, info, null);
        if (staff) this.notifyStaff(p, row!, staff, 'cancelled', info, input.reason);
        void this.afterChange(p, row!, staff ?? null, 'cancelled', { base, names });
        return this.summary(p, row!, base, names);
    }

    async reschedule(ref: string, ip: string, input: RescheduleAppointmentInput): Promise<PublicAppointmentSummary> {
        const { p, appt } = await this.resolveAppointment(ref);
        await this.enforce(MANAGE_LIMITS, p.pageId, ip, 'cambios');
        const locked = this.lockedReason(p, appt);
        if (locked || !p.config.rules.allow_reschedule) {
            throw new ForbiddenException({ code: 'booking_locked', message: locked ?? 'Esta agenda no permite reprogramar en línea. Comunícate con la empresa.', data: { status: 403 } });
        }
        const service = this.availability.service(p.config, appt.serviceId);
        const start = new Date(input.start);
        if (Number.isNaN(start.getTime())) throw badRequest('booking_invalid', 'Elige un horario.');
        const end = new Date(start.getTime() + service.duration_min * 60_000);
        const sel = this.staffSelection(p, input.staff_id ?? appt.staffId);
        let candidates = this.availability.candidates(p.config, service.id, sel);
        if (sel === 'any') candidates = await this.roundRobin(p, candidates);
        // Quien atendía primero (si sigue libre, no se cambia de persona sin necesidad).
        candidates.sort((a, b) => Number(b.id === appt.staffId) - Number(a.id === appt.staffId));
        if (candidates.length === 0) throw badRequest('booking_invalid', 'No hay quién atienda ese servicio en este momento.');
        const names = await this.staffNames(p.config);
        const fieldsById = new Map(p.fields.map((f) => [f.id, f]));

        let done: { row: BookingAppointmentRow; staff: BookingStaff } | null = null;
        let lastReason = 'taken';
        for (const staff of candidates) {
            const ymd = zonedDayAndMinute(start, p.timeZone).ymd;
            const external = await this.availability.externalBusy(p, staff, ymd, ymd);
            const out = await this.withStaffLock(p.tenantId, staffKey(p.pageId, staff), async (tx) => {
                const reason = await this.availability.checkInTx(tx, p, staff, service, start, external, { excludeRecordId: appt.recordId });
                if (reason) return { reason };
                // El registro se actualiza por RecordsService (validación, actividad,
                // automatizaciones) mientras ESTA transacción tiene el candado.
                await this.records.update(
                    p.tenantId,
                    SYSTEM_ACTOR,
                    String(p.listId),
                    appt.recordId,
                    { data: appointmentRecordData({ config: p.config, fieldsById, service, staff, staffName: names.get(staff.id) ?? staffLabel(staff), start, end, status: 'rescheduled' }) },
                    { origin: 'booking' },
                );
                const [row] = await tx
                    .update(bookingAppointments)
                    .set({
                        startAt: start,
                        endAt: end,
                        staffId: staff.id,
                        staffUserId: staff.kind === 'user' ? staff.staff_user_id : null,
                        status: 'rescheduled',
                        remindersSent: this.passedReminders(p.config, start),
                        updatedAt: new Date(),
                        ...(input.time_zone && isValidTimeZone(input.time_zone) ? { clientTz: input.time_zone } : {}),
                    })
                    .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id)))
                    .returning();
                return { row: row! };
            }).catch((err: unknown) => {
                if (err instanceof HttpException && err.getStatus() < 500) throw err;
                this.reportLost(p, err);
                throw unavailable('No pudimos cambiar tu cita en este momento. Prueba de nuevo más tarde.');
            });
            if ('reason' in out) {
                lastReason = out.reason ?? lastReason;
                continue;
            }
            done = { row: out.row, staff };
            break;
        }
        if (!done) throw new ConflictException({ code: 'booking_slot_taken', message: SLOT_MESSAGES[lastReason] ?? SLOT_MESSAGES.taken, data: { status: 409 } });
        const base = await this.base(p.tenantId);
        const info = this.eventInfo(p, done.row, 'rescheduled', 'client', base, names, { start: appt.startAt, end: appt.endAt });
        this.dispatchEvent(p, done.row, info, null);
        this.notifyStaff(p, done.row, done.staff, 'rescheduled', info);
        if (appt.staffId !== done.staff.id) {
            // Cambió quien atiende: a quien la tenía, que se le canceló.
            const prev = p.config.staff.find((s) => s.id === appt.staffId);
            if (prev) this.notifyStaff(p, { ...done.row, startAt: appt.startAt }, prev, 'cancelled', info);
        }
        void this.afterChange(p, done.row, done.staff, 'rescheduled', { base, names, previous: appt });
        return this.summary(p, done.row, base, names);
    }

    // ─────────────────────────── Lo que sigue a un cambio ───────────────────────────

    eventInfo(
        p: ResolvedPage,
        appt: BookingAppointmentRow,
        event: BookingEvent,
        by: 'client' | 'team',
        base: string,
        names: Map<string, string>,
        previous: { start: Date; end: Date } | null,
    ): BookingEventInfo {
        const url = this.manageUrl(base, p.tenantId, appt.id);
        return {
            page_id: p.pageId,
            page_name: p.row.name,
            event,
            by,
            service: p.config.services.find((s) => s.id === appt.serviceId)?.name ?? 'Cita',
            staff: names.get(appt.staffId) ?? '',
            start: appt.startAt.toISOString(),
            end: appt.endAt.toISOString(),
            previous_start: previous ? previous.start.toISOString() : null,
            previous_end: previous ? previous.end.toISOString() : null,
            client_name: appt.clientName ?? '',
            client_email: appt.clientEmail ?? '',
            manage_url: url,
            cancel_url: `${url}?accion=cancelar`,
            time_zone: p.timeZone,
        };
    }

    /** El disparador «Cuando se agenda, reprograma o cancela una cita». */
    private dispatchEvent(p: ResolvedPage, appt: BookingAppointmentRow, info: BookingEventInfo, data: Record<string, unknown> | null): void {
        void (async () => {
            const after =
                data ??
                ((
                    await this.tenantDb.withTenant(p.tenantId, (tx) =>
                        tx.select({ data: records.data }).from(records).where(and(eq(records.tenantId, p.tenantId), eq(records.id, appt.recordId))).limit(1),
                    )
                )[0]?.data as Record<string, unknown> | undefined) ??
                {};
            this.dispatcher.dispatch({ tenantId: p.tenantId, listId: p.listId, recordId: appt.recordId, trigger: 'booking_event', after, booking: info });
        })().catch((err: unknown) => this.logger.warn(`Agenda ${p.pageId}: el disparador no se pudo encolar: ${String(err)}`));
    }

    /** Aviso a quien atiende (campana + correo según sus preferencias). */
    private notifyStaff(p: ResolvedPage, appt: BookingAppointmentRow, staff: BookingStaff, event: BookingEvent, info: BookingEventInfo, reason?: string): void {
        if (!this.notify || staff.kind !== 'user' || staff.staff_user_id === null) return;
        const when = formatBookingWhen(appt.startAt.toISOString(), p.timeZone, p.format.time_format, { year: false });
        const client = (appt.clientName ?? '').trim() || 'Un cliente';
        const title =
            event === 'booked'
                ? `Nueva cita: ${client} · ${info.service}, ${when}`
                : event === 'rescheduled'
                  ? `${client} reprogramó su cita: ahora ${when}`
                  : `${client} canceló su cita del ${when}`;
        const body = [
            `En «${p.row.name}»`,
            info.previous_start && event === 'rescheduled'
                ? `Antes: ${formatBookingWhen(info.previous_start, p.timeZone, p.format.time_format, { year: false })}`
                : '',
            reason ? `Motivo: ${reason.slice(0, 300)}` : '',
        ]
            .filter(Boolean)
            .join(' · ');
        this.notify.emit({
            type: 'booking',
            tenantId: p.tenantId,
            listId: p.listId,
            recordId: appt.recordId,
            userIds: [staff.staff_user_id],
            kind: event === 'booked' ? 'assigned' : 'update',
            title,
            body,
        });
    }

    /**
     * Lo que no puede tumbar la respuesta al cliente: el correo con el .ics y
     * el evento en el calendario de quien atiende (crearlo, moverlo o
     * borrarlo). Lo que falla queda en Problemas.
     */
    private async afterChange(
        p: ResolvedPage,
        appt: BookingAppointmentRow,
        staff: BookingStaff | null,
        event: BookingEvent,
        x: { base: string; names: Map<string, string>; withdrawRef?: string | null; previous?: BookingAppointmentRow; byTeam?: boolean },
    ): Promise<void> {
        try {
            await this.syncCalendar(p, appt, staff, event, x.previous);
        } catch (err) {
            this.logger.warn(`Agenda ${p.pageId}: calendario de la cita ${appt.id}: ${String(err)}`);
        }
        const send = event === 'booked' ? p.config.notifications.confirm_email : !x.byTeam || p.config.notifications.notify_client_on_team_change;
        if (send) {
            await this.sendClientMail(p, appt, event, {
                base: x.base,
                names: x.names,
                withdrawRef: x.withdrawRef ?? null,
                previousStart: x.previous?.startAt ?? null,
                byTeam: x.byTeam === true,
            });
        }
    }

    private async syncCalendar(p: ResolvedPage, appt: BookingAppointmentRow, staff: BookingStaff | null, event: BookingEvent, previous?: BookingAppointmentRow): Promise<void> {
        const ext = appt.externalEvent ?? previous?.externalEvent ?? null;
        const key = `booking-event:${p.pageId}:${appt.staffId}`;
        const save = async (value: BookingAppointmentRow['externalEvent']): Promise<void> => {
            await this.tenantDb.withTenant(p.tenantId, (tx) =>
                tx.update(bookingAppointments).set({ externalEvent: value }).where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id))),
            );
        };
        const sameOwner = ext !== null && staff?.connection_id === ext.connection_id;
        try {
            if (event === 'cancelled') {
                if (ext) {
                    await this.calendar.deleteEvent(p.tenantId, ext);
                    await save(null);
                }
                return;
            }
            if (event === 'rescheduled' && ext && sameOwner) {
                await this.calendar.moveEvent(p.tenantId, ext, appt.startAt, appt.endAt);
                return;
            }
            if (ext && !sameOwner) {
                // Cambió quien atiende: el evento sale del calendario anterior.
                await this.calendar.deleteEvent(p.tenantId, ext).catch(() => undefined);
                await save(null);
            }
            if (!staff || staff.kind !== 'user' || staff.connection_id === null || !staff.create_events) return;
            const svc = p.config.services.find((s) => s.id === appt.serviceId);
            const created = await this.calendar.createEvent(p.tenantId, staff.connection_id, {
                title: `${svc?.name ?? 'Cita'} — ${appt.clientName ?? 'Cliente'}`,
                start: appt.startAt,
                end: appt.endAt,
                timeZone: p.timeZone,
                description: [
                    `Cita agendada en «${p.row.name}».`,
                    appt.clientName ? `Cliente: ${appt.clientName}` : '',
                    appt.clientEmail ? `Correo: ${appt.clientEmail}` : '',
                    p.config.settings.location ? `Dónde: ${p.config.settings.location}` : '',
                ]
                    .filter(Boolean)
                    .join('\n'),
            });
            await save(created);
            this.incidents?.resolve(p.tenantId, key);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            this.incidents?.report({
                tenantId: p.tenantId,
                key,
                source: 'booking',
                sourceId: p.pageId,
                listId: p.listId,
                ownerId: p.createdBy,
                title: `La agenda «${p.row.name}» no pudo actualizar un calendario`,
                message: `${reason} La cita quedó guardada en la lista; sólo falta el evento en el calendario de quien atiende.`,
            });
            throw err;
        }
    }

    private async emailBrand(p: ResolvedPage, base: string): Promise<PortalEmailBrand> {
        const b = this.brand(p);
        return {
            name: b.company,
            color: b.accent,
            logoUrl: b.logoFileId !== null ? `${base}${this.files.signedUrl(p.tenantId, b.logoFileId, 30 * 24 * 3600)}` : null,
        };
    }

    /** El correo al cliente (con el .ics de la cita adjunto). Devuelve si salió. */
    async sendClientMail(
        p: ResolvedPage,
        appt: BookingAppointmentRow,
        kind: BookingMailKind,
        x: { base: string; names: Map<string, string>; withdrawRef?: string | null; previousStart?: Date | null; byTeam?: boolean; reminderLead?: string },
    ): Promise<boolean> {
        if (!this.mail || !appt.clientEmail) return false;
        if (!(await this.allowClientMail(appt.clientEmail))) return false;
        const brand = await this.emailBrand(p, x.base);
        const summary = this.summary(p, appt, x.base, x.names);
        const message = bookingClientEmail(brand, {
            kind,
            clientName: appt.clientName ?? '',
            service: summary.service,
            staff: summary.staff,
            start: summary.start,
            end: summary.end,
            previousStart: x.previousStart ? x.previousStart.toISOString() : null,
            location: p.config.settings.location,
            companyTz: p.timeZone,
            clientTz: appt.clientTz,
            timeFormat: p.format.time_format,
            manageUrl: summary.manage_url,
            cancelUrl: `${summary.manage_url}?accion=cancelar`,
            bookUrl: p.row.enabled ? `${x.base}/api/v1/public/b/${p.row.token}` : null,
            canReschedule: summary.can_reschedule,
            canCancel: summary.can_cancel,
            note: p.config.notifications.email_note,
            ...(x.reminderLead ? { reminderLead: x.reminderLead } : {}),
            withdrawUrl: x.withdrawRef && this.dataConsent ? this.dataConsent.withdrawUrl(x.base, p.tenantId, x.withdrawRef) : null,
            byTeam: x.byTeam === true,
        });
        const ics = this.icsFor(p, appt, x.base, x.names);
        const key = `booking-mail:${p.pageId}`;
        try {
            await this.mail.sendNow({
                tenantId: p.tenantId,
                to: appt.clientEmail,
                subject: message.subject,
                text: message.text,
                html: message.html,
                attachments: [{ filename: kind === 'cancelled' ? 'cita-cancelada.ics' : 'cita.ics', contentType: 'text/calendar; charset=utf-8; method=' + (kind === 'cancelled' ? 'CANCEL' : 'PUBLISH'), contentBase64: Buffer.from(ics, 'utf8').toString('base64') }],
                ...(brand.name.trim() === '' ? {} : { fromName: senderName(brand.name), fromNameSoft: true }),
            });
            this.incidents?.resolve(p.tenantId, key);
            return true;
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Agenda ${p.pageId}: el correo de la cita ${appt.id} no salió: ${reason}`);
            this.incidents?.report({
                tenantId: p.tenantId,
                key,
                source: 'booking',
                sourceId: p.pageId,
                listId: p.listId,
                ownerId: p.createdBy,
                title: `La agenda «${p.row.name}» no puede mandar correos`,
                message: `No le pudimos mandar al cliente el correo de su cita: ${reason} Revisa el correo de la empresa en Ajustes → Correo.`,
            });
            return false;
        }
    }

    private async allowClientMail(email: string): Promise<boolean> {
        const now = Math.floor(Date.now() / 1000);
        const key = `bookmail:${CLIENT_MAIL_LIMIT.window}:${Math.floor(now / CLIENT_MAIL_LIMIT.window)}:${email.toLowerCase()}`;
        try {
            const res = await this.redis.multi().incr(key).expire(key, CLIENT_MAIL_LIMIT.window).exec();
            return Number(res?.[0]?.[1] ?? 0) <= CLIENT_MAIL_LIMIT.max;
        } catch {
            return true;
        }
    }

    // ─────────────────────────── Recordatorios ───────────────────────────

    /** Manda UN recordatorio (ya reclamado por quien llama). */
    async sendReminder(appt: BookingAppointmentRow, minutesBefore: number): Promise<boolean> {
        const p = await this.resolveById(appt.pageId);
        if (!p || p.readOnly) return false;
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        const hours = Math.round(minutesBefore / 60);
        const lead =
            minutesBefore >= 20 * 60 && minutesBefore <= 28 * 60
                ? 'de mañana'
                : minutesBefore < 120
                  ? `que empieza en ${minutesBefore} minutos`
                  : minutesBefore < 24 * 60
                    ? `que empieza en ${hours} horas`
                    : `del ${formatBookingWhen(appt.startAt.toISOString(), appt.clientTz ?? p.timeZone, p.format.time_format, { year: false })}`;
        return this.sendClientMail(p, appt, 'reminder', { base, names, reminderLead: lead });
    }

    /** ¿La página manda los recordatorios también por SMS? */
    smsRemindersOn(config: BookingConfig): boolean {
        const s = config.notifications.sms_reminders;
        return s.enabled && s.connection_id !== null && config.mapping.phone_field_id !== null;
    }

    /**
     * SMS (ADR-S82) — el recordatorio por SMS: al teléfono del registro de la
     * cita, con el texto de la página (`{{cita.*}}` en la zona del cliente). Es
     * un aviso de servicio, no comercial: sale a su hora (no espera la franja
     * de la Ley 2300). Si no sale, la agenda abre un Problema con el motivo.
     */
    async sendSmsReminder(appt: BookingAppointmentRow): Promise<boolean> {
        const p = await this.resolveById(appt.pageId);
        if (!p || p.readOnly || !this.smsRemindersOn(p.config)) return false;
        const cfg = p.config.notifications.sms_reminders;
        const sms = this.sms();
        if (!sms) return false;
        const phoneId = p.config.mapping.phone_field_id!;
        const [rec] = await this.tenantDb.withTenant(p.tenantId, (tx) =>
            tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, p.tenantId), eq(records.id, appt.recordId), isNull(records.deletedAt)))
                .limit(1),
        );
        const phone = rec ? (rec.data as Record<string, unknown>)[jsonbKeyForField(phoneId)] : null;
        if (typeof phone !== 'string' || phone.trim() === '') return false;
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        const info = { ...this.eventInfo(p, appt, 'booked', 'client', base, names, null), time_zone: appt.clientTz ?? p.timeZone };
        const text = cfg.text.replace(/\{\{\s*cita\.([a-z_]+)\s*\}\}/g, (_m, key: string) => bookingMergeValue(info, key, p.format.time_format));
        const res = await sms.sendNow(p.tenantId, {
            connectionId: cfg.connection_id!,
            to: phone,
            message: text,
            stripAccents: cfg.strip_accents,
            respectHours: false,
            source: 'booking',
            target: { listId: p.listId, recordId: appt.recordId, userId: null },
        });
        const key = `booking:${p.pageId}:sms`;
        if (res.ok) {
            this.incidents?.resolve(p.tenantId, key);
            return true;
        }
        this.incidents?.report({
            tenantId: p.tenantId,
            key,
            source: 'booking',
            sourceId: p.pageId,
            listId: p.listId,
            ownerId: p.createdBy,
            title: `La agenda «${p.row.name}» no pudo mandar un recordatorio por SMS`,
            message: `El recordatorio de una cita no salió: ${res.error ?? 'el proveedor no lo aceptó.'} Revisa la conexión de SMS en Integraciones o el teléfono del cliente.`,
        });
        return false;
    }

    // ─────────────────────────── Cambios del equipo ───────────────────────────

    private async hasPages(tenantId: number, listId: number): Promise<boolean> {
        const hit = this.listsWithPages.get(tenantId);
        if (hit && Date.now() - hit.at < 60_000) return hit.ids.has(listId);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.selectDistinct({ listId: bookingPages.listId }).from(bookingPages).where(eq(bookingPages.tenantId, tenantId)),
        );
        const ids = new Set(rows.map((r) => r.listId));
        this.listsWithPages.set(tenantId, { at: Date.now(), ids });
        if (this.listsWithPages.size > 5000) this.listsWithPages.clear();
        return ids.has(listId);
    }

    /** Las páginas de una lista cambiaron (crear o borrar): el caché se renueva. */
    forgetLists(tenantId: number): void {
        this.listsWithPages.delete(tenantId);
    }

    /**
     * El equipo movió o canceló una cita desde la app (es un registro común):
     * la cita se mantiene al día — recordatorios, evento del calendario, aviso
     * al cliente si la página lo pide y el disparador de automatizaciones.
     */
    async onRecordChange(c: RecordChange): Promise<void> {
        if (c.origin === 'booking' || c.kind === 'created') return;
        if (!(await this.hasPages(c.tenantId, c.listId))) return;
        const [appt] = await this.tenantDb.withTenant(c.tenantId, (tx) =>
            tx
                .select()
                .from(bookingAppointments)
                .where(and(eq(bookingAppointments.tenantId, c.tenantId), eq(bookingAppointments.recordId, c.recordId)))
                .limit(1),
        );
        if (!appt) return;
        const p = await this.resolveById(appt.pageId);
        if (!p) return;
        const m = p.config.mapping;
        const after = c.after;
        const nowCancelled = isCancelledValue(m, after);
        const startRaw = m.start_field_id !== null ? after[jsonbKeyForField(m.start_field_id)] : null;
        const start = typeof startRaw === 'string' ? new Date(startRaw) : null;
        let event: BookingEvent | null = null;
        const patch: Partial<typeof bookingAppointments.$inferInsert> = { updatedAt: new Date() };
        if (nowCancelled && appt.status !== 'cancelled') {
            event = 'cancelled';
            patch.status = 'cancelled';
            patch.cancelledAt = new Date();
        } else if (!nowCancelled && appt.status === 'cancelled') {
            // La reactivaron: vuelve a contar (sin aviso: lo decide el equipo).
            patch.status = 'confirmed';
            patch.cancelledAt = null;
        }
        if (start && !Number.isNaN(start.getTime()) && start.getTime() !== appt.startAt.getTime() && !nowCancelled) {
            const endRaw = m.end_field_id !== null ? after[jsonbKeyForField(m.end_field_id)] : null;
            const durRaw = m.duration_field_id !== null ? Number(after[jsonbKeyForField(m.duration_field_id)]) : NaN;
            const end =
                typeof endRaw === 'string' && Date.parse(endRaw) > start.getTime()
                    ? new Date(endRaw)
                    : new Date(start.getTime() + (Number.isFinite(durRaw) && durRaw > 0 ? durRaw : (appt.endAt.getTime() - appt.startAt.getTime()) / 60_000) * 60_000);
            patch.startAt = start;
            patch.endAt = end;
            patch.remindersSent = this.passedReminders(p.config, start);
            if (patch.status === undefined) patch.status = 'rescheduled';
            event = event ?? 'rescheduled';
        }
        // Cambió quien atiende (otra persona del equipo en el campo Persona).
        if (m.person_field_id !== null) {
            const who = Number(after[jsonbKeyForField(m.person_field_id)]);
            const staff = p.config.staff.find((s) => s.kind === 'user' && s.staff_user_id === who);
            if (staff && staff.id !== appt.staffId) {
                patch.staffId = staff.id;
                patch.staffUserId = who;
            }
        }
        if (Object.keys(patch).length === 1) return;
        const [row] = await this.tenantDb.withTenant(c.tenantId, (tx) =>
            tx.update(bookingAppointments).set(patch).where(and(eq(bookingAppointments.tenantId, c.tenantId), eq(bookingAppointments.id, appt.id))).returning(),
        );
        if (!row || !event) return;
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        const info = this.eventInfo(p, row, event, 'team', base, names, event === 'rescheduled' ? { start: appt.startAt, end: appt.endAt } : null);
        this.dispatcher.dispatch({ tenantId: p.tenantId, listId: p.listId, recordId: row.recordId, trigger: 'booking_event', after, booking: info });
        const staff = p.config.staff.find((s) => s.id === row.staffId) ?? null;
        await this.afterChange(p, row, staff, event, { base, names, previous: appt, byTeam: true });
    }

    // ─────────────────────────── «Probar» ───────────────────────────

    async simulatedEvent(tenantId: number, recordId: number, event: BookingEvent): Promise<BookingEventInfo | null> {
        const [appt] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(bookingAppointments)
                .where(and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.recordId, recordId)))
                .orderBy(desc(bookingAppointments.id))
                .limit(1),
        );
        if (!appt) return null;
        const p = await this.resolveById(appt.pageId);
        if (!p) return null;
        const base = await this.base(tenantId);
        const names = await this.staffNames(p.config);
        return this.eventInfo(p, appt, event, 'client', base, names, event === 'rescheduled' ? { start: new Date(appt.startAt.getTime() - 86_400_000), end: new Date(appt.endAt.getTime() - 86_400_000) } : null);
    }
}
