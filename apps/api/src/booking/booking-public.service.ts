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
    BOOKING_INACTIVE_STATUSES,
    bookableWindow,
    bookingLocationPublic,
    bookingLocationText,
    bookingMergeValue,
    bookingPriceLabel,
    bookingTheme,
    brandingSchema,
    buildPublicFormItems,
    buildPublicThemeCss,
    formatBookingWhen,
    formItemVisible,
    isBookingQuestionType,
    isDisposableEmail,
    isEmptyAnswer,
    isValidTimeZone,
    jsonbKeyForField,
    pickServiceDuration,
    publicThemePreloadFont,
    publicThemeView,
    resolveTimeZone,
    serviceApprovalMode,
    serviceDurations,
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
    type DecideBookingInput,
    type RecordBookingDto,
    type RequestBookingCodeInput,
    type VerifyBookingCodeInput,
    type PublicAppointmentSummary,
    type PublicBookingMeta,
    type PublicBookingSlots,
    type PublicManageMeta,
    type PublicTheme,
    type RescheduleAppointmentInput,
    type TenantFormat,
} from '@imagina-base/shared';
import { accessOf } from '../billing/tenant-access';
import { and, asc, desc, eq, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { can } from '../authz/can';
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
import { NO_PUBLIC_CACHE, type PublicCacheLike } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { NotifyHub } from '../notifications/notify-hub';
import { senderName, type PortalEmailBrand } from '../portal/portal-email';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordChangeHub, type RecordChange } from '../records/record-change-hub';
import { RecordsService, type Actor } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BookingAvailabilityService, type PageContext } from './booking-availability.service';
import { BookingCalendarService, type CalendarProvider } from './booking-calendar';
import { appointmentRecordData, readBookingConfig, staffKey, statusFromValue, statusValueFor } from './booking-config';
import { bookingBodyClasses } from './booking-page';
import { bookingClientEmail, bookingCodeEmail, bookingMailHasIcs, type BookingMailKind } from './booking-email';
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
/**
 * v0.1.353 — Frenos por CORREO (compartidos entre nodos): reservas por hora y
 * por día de un mismo correo en una página, y códigos de confirmación.
 */
const BOOK_EMAIL_LIMITS = [
    { window: 3600, max: 5 },
    { window: 86_400, max: 12 },
] as const;
const CODE_EMAIL_LIMITS = [
    { window: 600, max: 3 },
    { window: 86_400, max: 8 },
] as const;
const CODE_LIMITS = [
    { scope: 'ip', window: 3600, max: 12 },
    { scope: 'page', window: 3600, max: 300 },
] as const;
/** El código de 6 dígitos: cuánto vale, cuántos intentos y cuánto dura la prueba que devuelve. */
const CODE_TTL_S = 600;
const CODE_ATTEMPTS = 5;
const PROOF_TTL_MS = 45 * 60 * 1000;
/** Las citas por confirmar que vencen en una vuelta del barrido. */
const EXPIRE_BATCH = 100;
const SLOTS_LIMITS = [
    { scope: 'ip', window: 60, max: 90 },
    // v0.1.352 — cuenta sólo los CÁLCULOS (lo que sale de la caché no pesa).
    { scope: 'page', window: 60, max: 1200 },
] as const;
/** v0.1.352 (ADR-S95) — Cuánto vale lo guardado de una agenda. */
const PAGE_CACHE_TTL_MS = 30_000;
const MISSING_CACHE_TTL_MS = 15_000;
const SLOTS_CACHE_TTL_MS = 30_000;
export const bookingCacheKey = (token: string): string => `booking:${token}`;
export const slotsNamespace = (tenantId: number): string => `slots:${tenantId}`;

/** Lo que se guarda de una agenda: la página resuelta y lo que ve el visitante. */
/** v0.1.354 — El diseño de la página (ADR-S94): CSS del tema, clases del `<body>` y la fuente a precargar. */
export interface BookingLook {
    css: string;
    classes: string[];
    preload: string | null;
}
export interface CachedBookingPage {
    p: ResolvedPage;
    info: { page_id: number; title: string; allowed_domains: string[]; meta: PublicBookingMeta; look: BookingLook };
}
/** Las imágenes del diseño viajan firmadas (la página no tiene sesión); un día alcanza de sobra para una visita. */
const BOOKING_IMAGE_TTL = 24 * 3600;
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

/** v0.1.350 — La videollamada que puede generar el calendario de quien atiende para lo que pide el servicio. */
function videoFor(video: 'auto' | 'meet' | 'teams', provider: CalendarProvider): 'meet' | 'teams' | null {
    if (video === 'auto') return provider === 'google_calendar' ? 'meet' : 'teams';
    if (video === 'meet') return provider === 'google_calendar' ? 'meet' : null;
    return provider === 'outlook' ? 'teams' : null;
}

/** Cuánto espera la reserva a que el calendario genere la videollamada (para mostrarla en la confirmación). */
const MEETING_WAIT_MS = 6000;

interface MeetingInfo {
    url: string;
    provider: 'meet' | 'teams' | 'link';
}

const DISPOSABLE_MESSAGE = 'Usa un correo personal o de trabajo: los correos temporales no se aceptan.';
const sha = (v: string): string => createHash('sha256').update(v).digest('hex');

/** v0.1.353 — Quien mira la ficha (para aprobar o rechazar): el actor del registro, con su ACL. */
export type BookingDecider = Actor;

function notPending(): ConflictException {
    return new ConflictException({ code: 'booking_not_pending', message: 'Esta cita ya no está por confirmar: alguien la decidió antes.', data: { status: 409 } });
}

function clientDuplicate(): ConflictException {
    return new ConflictException({
        code: 'booking_duplicate',
        message: 'Ya tienes una cita en ese horario con este correo. Si quieres cambiarla, usa el enlace del correo de confirmación.',
        data: { status: 409 },
    });
}

function clientLimit(max: number): ConflictException {
    return new ConflictException({
        code: 'booking_client_limit',
        message:
            max === 1
                ? 'Ya tienes una cita agendada con este correo. Para otro horario, cámbiala desde el enlace del correo de confirmación.'
                : `Ya tienes ${max} citas agendadas con este correo, el máximo que se permite. Para otro horario, cambia una desde el enlace del correo de confirmación.`,
        data: { status: 409 },
    });
}

/** Lo que dura una cita guardada (minutos). */
function appointmentMinutes(appt: Pick<BookingAppointmentRow, 'startAt' | 'endAt'>): number {
    return Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60_000);
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
        // v0.1.352 (ADR-S95) — la página y los horarios se arman una vez y valen unos segundos.
        @Optional() cache?: PublicCacheService,
    ) {
        this.pcache = cache ?? NO_PUBLIC_CACHE;
    }

    private readonly pcache: PublicCacheLike;

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
        // v0.1.352 — un cambio en una lista con agenda puede ocupar o liberar a
        // alguien: los horarios guardados de esa empresa dejan de valer.
        this.changes?.subscribe(async (c) => {
            if (await this.hasPages(c.tenantId, c.listId)) this.forgetSlots(c.tenantId);
        });
    }

    // ───────────────────── Caché de lo público (v0.1.352) ─────────────────────

    /**
     * La página resuelta y lo que ve el visitante, guardados medio minuto: una
     * agenda con miles de visitas consulta la base una vez cada 30 s, no una
     * por visita. Lo que no existe se recuerda menos tiempo. Lanza
     * `PublicBusyError` si la fila de armados está llena.
     */
    cachedPage(token: string): Promise<CachedBookingPage | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return Promise.resolve(null);
        return this.pcache.get(bookingCacheKey(token), PAGE_CACHE_TTL_MS, async () => {
            let p: ResolvedPage;
            try {
                p = await this.resolve(token);
            } catch {
                return null;
            }
            // El sello ya no viaja en la página: el visitante lo pide al empezar.
            const meta = { ...(await this.buildMeta(p)), stamp: '' };
            return { p, info: { page_id: p.pageId, title: meta.title, allowed_domains: p.config.settings.allowed_domains, meta, look: this.themeLook(p) } };
        }, MISSING_CACHE_TTL_MS);
    }

    /** Lo que cambió de la página (o se reservó): la guardada deja de valer en todos los servidores. */
    forgetPage(token: string | null | undefined, tenantId?: number): void {
        if (token) this.pcache.invalidate(bookingCacheKey(token));
        if (tenantId !== undefined) this.forgetSlots(tenantId);
    }

    /**
     * Los horarios guardados de una empresa dejan de valer (se reservó, se
     * canceló, el equipo movió una cita). Es por EMPRESA porque lo ocupado de
     * una persona cuenta en todas sus agendas.
     */
    forgetSlots(tenantId: number): void {
        this.pcache.bump(slotsNamespace(tenantId));
    }

    /** v0.1.352 — El sello anti-robots, a pedido (la página ya no lo trae). */
    async stamp(token: string): Promise<{ stamp: string }> {
        const cached = await this.cachedPage(token);
        if (!cached) throw notFound();
        return { stamp: this.newStamp(cached.p.pageId) };
    }

    private newStamp(pageId: number): string {
        const ts = Date.now();
        return `${ts}.${this.files.signParts('bookstamp', pageId, ts)}`;
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
        // v0.1.354 — el color elegido en el diseño manda (también en los correos).
        const themed = p.config.settings.theme ? bookingTheme(p.config.settings).colors.accent : null;
        return { company: b.app_name || p.tenantName, accent: themed ?? p.config.settings.accent_color ?? b.primary_color ?? '#0e7490', logoFileId: b.logo_file_id };
    }

    /**
     * v0.1.354 (ADR-S94) — El diseño de la página: el tema de la agenda (o el
     * de siempre), con el acento de la agenda / la marca y sus imágenes
     * firmadas. El CSS propio sale ya limpio de `buildPublicThemeCss`.
     */
    themeLook(p: ResolvedPage): BookingLook {
        const theme: PublicTheme = bookingTheme(p.config.settings);
        const sign = (id: number | null): string | null => (id === null ? null : this.files.signedUrl(p.tenantId, id, BOOKING_IMAGE_TTL));
        const css = buildPublicThemeCss(theme, {
            accent: this.brand(p).accent,
            images: {
                cover: sign(theme.cover.file_id),
                split: sign(theme.split.file_id),
                background: theme.background.kind === 'image' ? sign(theme.background.file_id) : null,
            },
        });
        return { css, classes: bookingBodyClasses(publicThemeView(theme), p.config.settings.display), preload: publicThemePreloadFont(theme) };
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

    async pageInfo(token: string): Promise<{ page_id: number; title: string; allowed_domains: string[]; meta: PublicBookingMeta } | null> {
        return (await this.cachedPage(token))?.info ?? null;
    }

    /** Los datos de la página en JSON: lo fijo de la caché y un sello recién firmado. */
    async meta(token: string): Promise<PublicBookingMeta> {
        const cached = await this.cachedPage(token);
        if (!cached) throw notFound();
        return { ...cached.info.meta, stamp: this.newStamp(cached.p.pageId) };
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
                .map((x) => ({
                    id: x.id,
                    name: x.name,
                    duration_min: x.duration_min,
                    durations: serviceDurations(x),
                    description: x.description,
                    price_label: bookingPriceLabel(x.price, p.format.number_format),
                    seats: x.seats,
                    show_seats_left: x.show_seats_left,
                    location: bookingLocationPublic(x.location, s.location),
                })),
            staff: staff.map((x) => ({
                id: x.id,
                name: names.get(x.id) ?? staffLabel(x),
                kind: x.kind,
                services: x.services,
                title: x.title,
                bio: x.bio,
                // La foto viaja firmada (la página no tiene sesión); 1 h alcanza para la visita.
                photo_url: x.photo_file_id !== null ? this.files.signedUrl(p.tenantId, x.photo_file_id, 3600) : null,
            })),
            choose_staff: s.choose_staff === 'visitor' && staff.length > 1,
            ask_phone: s.ask_phone,
            questions: buildPublicFormItems({ items: p.config.questions, settings: {} as never }, fieldsForQuestions),
            max_days_ahead: p.config.rules.max_days_ahead,
            min_notice_min: p.config.rules.min_notice_min,
            ...(() => {
                const w = bookableWindow(p.config.rules, p.timeZone, new Date());
                return { first_day: w.first, last_day: w.last };
            })(),
            closed: this.closedReason(p),
            success_message: s.success_message,
            stamp: this.newStamp(p.pageId),
            captcha: keys ? { provider: keys.provider, site_key: keys.siteKey } : null,
            data_consent: consent ? DataConsentService.toPublic(consent) : null,
            verify_email: s.verify_email,
            pending_message: s.pending_message,
            theme: publicThemeView(bookingTheme(s)),
            display: s.display,
        };
    }

    /**
     * v0.1.352 (ADR-S95) — Los horarios libres, guardados unos segundos por
     * servicio, persona, rango y duración: mil visitas mirando la misma semana
     * calculan una vez. Al reservar, cancelar o cambiar una cita se borran (y la
     * reserva vuelve a comprobar el horario dentro de su candado, así que uno
     * recién tomado nunca se reserva dos veces). El tope por página cuenta
     * sólo los cálculos de verdad; el de cada visitante, todos sus pedidos.
     */
    async slots(token: string, ip: string, q: BookingSlotsQuery): Promise<PublicBookingSlots> {
        const cached = await this.cachedPage(token);
        if (!cached) throw notFound();
        const p = cached.p;
        await this.enforce(SLOTS_LIMITS.filter((l) => l.scope === 'ip'), p.pageId, ip, 'horarios');
        if (this.closedReason(p)) return { slots: [], first_day: q.from, last_day: q.to };
        const staff = this.staffSelection(p, q.staff);
        const ns = slotsNamespace(p.tenantId);
        const key = `${ns}:v${this.pcache.version(ns)}:${p.pageId}:${q.service}:${staff}:${q.from}:${q.to}:${q.duration ?? ''}`;
        return this.pcache.get(key, SLOTS_CACHE_TTL_MS, async () => {
            await this.enforce(SLOTS_LIMITS.filter((l) => l.scope === 'page'), p.pageId, ip, 'horarios');
            return this.availability.slots(p, q.service, staff, q.from, q.to, q.duration !== undefined ? { durationMin: q.duration } : {});
        });
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
        if (input.duration_min !== undefined && !serviceDurations(service).includes(input.duration_min)) {
            throw badRequest('booking_invalid', 'Esa duración ya no está disponible. Elige otra.');
        }
        const durationMin = pickServiceDuration(service, input.duration_min);
        const end = new Date(start.getTime() + durationMin * 60_000);

        // Datos del cliente y preguntas extra (lo decide el servidor).
        const errors: Record<string, string> = {};
        const email = validateFieldValue({ type: 'email', config: {}, is_required: true }, input.email);
        if (!email.ok) errors.email = 'Revisa el correo.';
        else if (p.config.settings.block_disposable_email && isDisposableEmail(String(email.value))) errors.email = DISPOSABLE_MESSAGE;
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
        // v0.1.353 — el correo confirmado con el código (si la página lo pide) y el freno por correo.
        if (p.config.settings.verify_email && !this.verifyEmailProof(p.pageId, clientEmail, input.email_proof)) {
            throw badRequest('booking_email_unverified', 'Confirma tu correo con el código que te enviamos.');
        }
        await this.enforceEmail(BOOK_EMAIL_LIMITS, p.pageId, clientEmail, 'reservas');
        const clientName = input.name.trim().slice(0, 200);
        const clientTz = input.time_zone && isValidTimeZone(input.time_zone) ? input.time_zone : null;

        // Quién atiende: el elegido o, con «el primero disponible», el que lleva
        // más tiempo sin recibir una cita de esta página (reparto por turno).
        const sel = this.staffSelection(p, input.staff_id);
        let candidates = this.availability.candidates(p.config, service.id, sel);
        if (candidates.length === 0) throw badRequest('booking_invalid', 'No hay quién atienda ese servicio. Elige otro.');
        if (sel === 'any') candidates = await this.roundRobin(p, candidates);

        // v0.1.349 — Citas futuras que puede tener a la vez un mismo correo (se
        // vuelve a contar dentro del candado del cliente: dos reservas a la vez
        // con el mismo correo no se cuelan).
        if (p.config.rules.max_active_per_client !== null && (await this.activeForClient(p, clientEmail)) >= p.config.rules.max_active_per_client) {
            throw clientLimit(p.config.rules.max_active_per_client);
        }

        // v0.1.353 — ¿queda por confirmar? (siempre, o sólo la primera vez de cada correo).
        const approvalMode = serviceApprovalMode(p.config.approval, service);
        const pending = approvalMode === 'all' || (approvalMode === 'new_clients' && !(await this.knownClient(p, clientEmail)));
        const status: BookingStatus = pending ? 'pending' : 'confirmed';
        const pendingUntil = pending ? new Date(Math.min(Date.now() + p.config.approval.hours * 3_600_000, start.getTime())) : null;

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
                // v0.1.350 — un enlace fijo (del servicio o de la persona) se sabe ya;
                // el de Meet o Teams lo genera el evento del calendario después.
                // v0.1.353 — una por confirmar todavía no tiene videollamada (llega al aprobarla).
                const meeting = pending ? null : await this.immediateMeeting(p, service, staff);
                const out = await this.tryBook(p, staff, service, start, end, {
                    status,
                    pendingUntil,
                    meeting,
                    data: {
                        ...answers,
                        ...this.meetingData(p, meeting),
                        ...appointmentRecordData({
                            config: p.config,
                            fieldsById: new Map(p.fields.map((f) => [f.id, f])),
                            service,
                            staff,
                            staffName: names.get(staff.id) ?? staffLabel(staff),
                            start,
                            end,
                            status,
                            client: { name: clientName, email: clientEmail, phone },
                        }),
                    },
                    clientName,
                    clientEmail,
                    clientTz,
                    durationMin,
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
            // Lo que el visitante vio estaba viejo: que los próximos horarios se calculen de nuevo.
            this.forgetSlots(p.tenantId);
            throw new ConflictException({ code: 'booking_slot_taken', message: SLOT_MESSAGES[lastReason] ?? SLOT_MESSAGES.taken, data: { status: 409 } });
        }
        if (evidence && this.dataConsent) {
            await this.dataConsent.linkRecord(p.tenantId, evidence.id, created.record.id).catch(() => undefined);
        }

        // Después del commit: tiempo real, automatizaciones, avisos, correo y calendario.
        const { appt, record, staff } = created;
        this.forgetSlots(p.tenantId);
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
        if (pending) {
            // Por confirmar: aviso a quien aprueba, el disparador «se pidió» y el
            // correo «recibimos tu solicitud». Sin evento en el calendario ni recordatorios.
            const info = this.eventInfo(p, appt, 'requested', 'client', base, names, null);
            this.notifyApprovers(p, appt, info, 'requested');
            this.dispatchEvent(p, appt, info, record.data);
            if (p.config.notifications.confirm_email) {
                void this.sendClientMail(p, appt, 'requested', { base, names, withdrawRef: evidence?.withdrawRef ?? null });
            }
            return { ok: true, appointment: this.summary(p, appt, base, names) };
        }
        const info = this.eventInfo(p, appt, 'booked', 'client', base, names, null);
        this.notifyStaff(p, appt, staff, 'booked', info);
        // v0.1.350 — el disparador sale cuando el calendario ya creó el evento
        // (con la videollamada, si el servicio la pide): así `{{cita.enlace_reunion}}`
        // ya trae el enlace. La confirmación espera unos segundos a ese enlace.
        const run = this.afterChange(p, appt, staff, 'booked', { base, names, withdrawRef: evidence?.withdrawRef ?? null, dispatch: { data: record.data, by: 'client', previous: null } });
        let shown = appt;
        if (service.location.kind === 'video' && appt.meetingUrl === null) {
            const ready = await Promise.race([run.calendar, new Promise<null>((ok) => setTimeout(() => ok(null), MEETING_WAIT_MS))]);
            if (ready) shown = ready;
        }
        return { ok: true, appointment: this.summary(p, shown, base, names) };
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
        x: {
            data: Record<string, unknown>;
            clientName: string;
            clientEmail: string;
            clientTz: string | null;
            durationMin: number;
            meeting: MeetingInfo | null;
            status: BookingStatus;
            pendingUntil: Date | null;
        },
    ): Promise<{ appt: BookingAppointmentRow; record: { id: number; data: Record<string, unknown> } } | { reason: string }> {
        const ymd = zonedDayAndMinute(start, p.timeZone).ymd;
        // Lo del calendario externo y los festivos se leen ANTES del candado (no se espera a la red con él tomado).
        const outside = await this.availability.outside(p, staff, ymd, ymd);
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
                const reason = await this.availability.checkInTx(tx, p, staff, service, start, outside, { durationMin: x.durationMin });
                if (reason) return { reason };
                // Candado del correo (dentro del de la persona: siempre en ese orden, sin abrazos mortales).
                await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`booking-client:${p.tenantId}:${p.pageId}:${x.clientEmail.toLowerCase()}`}, 0))`);
                // El mismo correo no reserva dos veces la MISMA sesión (en un grupal se llevaría dos cupos).
                if (await this.clientInSession(tx, p, x.clientEmail, staff.id, service.id, start)) throw clientDuplicate();
                const cap = p.config.rules.max_active_per_client;
                if (cap !== null && (await this.activeForClient(p, x.clientEmail, tx)) >= cap) throw clientLimit(cap);
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
                        status: x.status,
                        pendingUntil: x.pendingUntil,
                        clientName: x.clientName,
                        clientEmail: x.clientEmail,
                        clientTz: x.clientTz,
                        remindersSent: this.passedReminders(p.config, start),
                        meetingUrl: x.meeting?.url ?? null,
                        meetingProvider: x.meeting?.provider ?? null,
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

    /**
     * «El primero disponible» (o «se asigna solo»): el orden en que se prueba a
     * cada persona. v0.1.349 — según la página:
     *  - `rotate`: primero quien lleva más tiempo sin recibir una cita de esta página;
     *  - `balance`: primero quien tiene menos citas en los próximos 30 días;
     *  - `priority`: primero la prioridad más alta; entre iguales, por turno.
     */
    private async roundRobin(p: ResolvedPage, staff: BookingStaff[]): Promise<BookingStaff[]> {
        const horizon = new Date(Date.now() + 30 * 86_400_000);
        const rows = await this.tenantDb.withTenant(p.tenantId, (tx) =>
            tx
                .select({
                    staffId: bookingAppointments.staffId,
                    last: sql<string>`max(${bookingAppointments.createdAt})`,
                    upcoming: sql<number>`count(*) filter (where ${bookingAppointments.status} not in ('cancelled', 'declined') and ${bookingAppointments.startAt} > now() and ${bookingAppointments.startAt} < ${horizon})`,
                })
                .from(bookingAppointments)
                .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.pageId, p.pageId)))
                .groupBy(bookingAppointments.staffId),
        );
        const last = new Map(rows.map((r) => [r.staffId, new Date(r.last).getTime()]));
        const upcoming = new Map(rows.map((r) => [r.staffId, Number(r.upcoming)]));
        const order = new Map(staff.map((s, i) => [s.id, i]));
        const mode = p.config.rules.assign_mode;
        return [...staff].sort(
            (a, b) =>
                (mode === 'priority' ? b.priority - a.priority : 0) ||
                (mode === 'balance' ? (upcoming.get(a.id) ?? 0) - (upcoming.get(b.id) ?? 0) : 0) ||
                (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0) ||
                (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
        );
    }

    /**
     * ¿Ese correo ya tiene un lugar en esa sesión (mismo servicio, misma persona
     * o recurso y misma hora)? Sólo la sesión exacta: agendar a dos familiares a
     * la misma hora con distintos asesores es legítimo.
     */
    private async clientInSession(tx: Tx, p: ResolvedPage, email: string, staffId: string, serviceId: string, start: Date): Promise<boolean> {
        const rows = await tx
            .select({ id: bookingAppointments.id })
            .from(bookingAppointments)
            .where(
                and(
                    eq(bookingAppointments.tenantId, p.tenantId),
                    eq(bookingAppointments.pageId, p.pageId),
                    eq(bookingAppointments.staffId, staffId),
                    eq(bookingAppointments.serviceId, serviceId),
                    eq(bookingAppointments.startAt, start),
                    sql`lower(${bookingAppointments.clientEmail}) = ${email.toLowerCase()}`,
                    notInArray(bookingAppointments.status, [...BOOKING_INACTIVE_STATUSES]),
                ),
            )
            .limit(1);
        return rows.length > 0;
    }

    /** Citas futuras (no canceladas) de un correo en esta página. */
    private async activeForClient(p: ResolvedPage, email: string, tx?: Tx): Promise<number> {
        const q = (t: Tx) =>
            t
                .select({ n: sql<number>`count(*)` })
                .from(bookingAppointments)
                .where(
                    and(
                        eq(bookingAppointments.tenantId, p.tenantId),
                        eq(bookingAppointments.pageId, p.pageId),
                        sql`lower(${bookingAppointments.clientEmail}) = ${email.toLowerCase()}`,
                        notInArray(bookingAppointments.status, [...BOOKING_INACTIVE_STATUSES]),
                        sql`${bookingAppointments.endAt} > now()`,
                    ),
                );
        const rows = tx ? await q(tx) : await this.tenantDb.withTenant(p.tenantId, q);
        return Number(rows[0]?.n ?? 0);
    }

    /**
     * v0.1.353 — ¿Ese correo ya tuvo una cita confirmada en esta página? (para
     * «sólo la primera cita de cada cliente»). Cuenta las confirmadas o
     * reprogramadas, y las canceladas que se habían confirmado (una por
     * confirmar que se canceló conserva su plazo).
     */
    private async knownClient(p: ResolvedPage, email: string): Promise<boolean> {
        const rows = await this.tenantDb.withTenant(p.tenantId, (tx) =>
            tx
                .select({ id: bookingAppointments.id })
                .from(bookingAppointments)
                .where(
                    and(
                        eq(bookingAppointments.tenantId, p.tenantId),
                        eq(bookingAppointments.pageId, p.pageId),
                        sql`lower(${bookingAppointments.clientEmail}) = ${email.toLowerCase()}`,
                        sql`(${bookingAppointments.status} in ('confirmed', 'rescheduled') or (${bookingAppointments.status} = 'cancelled' and ${bookingAppointments.pendingUntil} is null))`,
                    ),
                )
                .limit(1),
        );
        return rows.length > 0;
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

    /** v0.1.353 — Ventanas fijas por CORREO (con su huella, no la dirección). Redis caído → no frena. */
    private async enforceEmail(limits: ReadonlyArray<{ window: number; max: number }>, pageId: number, email: string, what: string): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        const who = sha(email.trim().toLowerCase()).slice(0, 32);
        for (const { window, max } of limits) {
            const key = `bookrl:${what}:email:${window}:${Math.floor(now / window)}:${pageId}:${who}`;
            let count: number;
            try {
                const res = await this.redis.multi().incr(key).expire(key, window).exec();
                count = Number(res?.[0]?.[1] ?? 0);
            } catch {
                return;
            }
            if (count > max) {
                throw new HttpException(
                    {
                        code: 'rate_limited',
                        message: what === 'codigos' ? 'Ya te enviamos varios códigos a este correo. Espera unos minutos y vuelve a intentar.' : 'Este correo ya pidió varias citas seguidas. Espera un rato y vuelve a intentar.',
                        data: { status: 429 },
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        }
    }

    // ───────────────────── Confirmar el correo con un código (v0.1.353) ─────────────────────

    private codeKey(pageId: number, email: string): string {
        return `bookcode:${pageId}:${sha(email.trim().toLowerCase())}`;
    }

    /**
     * Manda el código de 6 dígitos al correo. Sólo si la página lo pide; con el
     * sello anti-robots, el freno por IP, por página y por correo. Un correo
     * temporal se rechaza aquí mismo (antes de gastar un correo).
     */
    async requestCode(token: string, ip: string, input: RequestBookingCodeInput): Promise<{ ok: true; minutes: number }> {
        const cached = await this.cachedPage(token);
        if (!cached) throw notFound();
        const p = cached.p;
        const closed = this.closedReason(p);
        if (closed) throw new ForbiddenException({ code: 'booking_closed', message: closed, data: { status: 403 } });
        if (!p.config.settings.verify_email) throw badRequest('booking_code_off', 'Esta agenda no pide confirmar el correo.');
        this.checkStamp(p.pageId, input.stamp);
        const email = input.email.trim();
        if (p.config.settings.block_disposable_email && isDisposableEmail(email)) throw badRequest('booking_invalid', DISPOSABLE_MESSAGE, { errors: { email: DISPOSABLE_MESSAGE } });
        await this.enforce(CODE_LIMITS, p.pageId, ip, 'codigos');
        await this.enforceEmail(CODE_EMAIL_LIMITS, p.pageId, email, 'codigos');
        if (!this.mail) throw unavailable('No pudimos enviarte el código en este momento. Prueba de nuevo más tarde.');
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        try {
            await this.redis.set(this.codeKey(p.pageId, email), JSON.stringify({ h: sha(`${p.pageId}:${code}`), n: 0 }), 'EX', CODE_TTL_S);
        } catch {
            throw unavailable('No pudimos enviarte el código en este momento. Prueba de nuevo más tarde.');
        }
        const base = await this.base(p.tenantId);
        const brand = await this.emailBrand(p, base);
        const message = bookingCodeEmail(brand, { code, minutes: Math.round(CODE_TTL_S / 60), pageTitle: p.config.settings.title || p.row.name });
        try {
            await this.mail.sendNow({
                tenantId: p.tenantId,
                to: email,
                subject: message.subject,
                text: message.text,
                html: message.html,
                ...(brand.name.trim() === '' ? {} : { fromName: senderName(brand.name), fromNameSoft: true }),
            });
        } catch (err) {
            this.logger.warn(`Agenda ${p.pageId}: el código de confirmación no salió: ${String(err)}`);
            await this.redis.del(this.codeKey(p.pageId, email)).catch(() => undefined);
            throw unavailable('No pudimos enviarte el código en este momento. Prueba de nuevo más tarde.');
        }
        return { ok: true, minutes: Math.round(CODE_TTL_S / 60) };
    }

    /**
     * Comprueba el código: 5 intentos por código (después hay que pedir otro).
     * Bien → una prueba firmada (página + correo + vencimiento) que la reserva
     * vuelve a comprobar; el código se consume.
     */
    async verifyCode(token: string, ip: string, input: VerifyBookingCodeInput): Promise<{ ok: true; proof: string }> {
        const cached = await this.cachedPage(token);
        if (!cached) throw notFound();
        const p = cached.p;
        await this.enforce(CODE_LIMITS.filter((l) => l.scope === 'ip'), p.pageId, ip, 'verificar');
        const key = this.codeKey(p.pageId, input.email);
        let raw: string | null;
        try {
            raw = await this.redis.get(key);
        } catch {
            throw unavailable('No pudimos comprobar el código en este momento. Prueba de nuevo en un momento.');
        }
        const saved = raw ? (JSON.parse(raw) as { h?: string; n?: number }) : null;
        if (!saved?.h) throw badRequest('booking_code_expired', 'El código venció o no existe. Pide uno nuevo.');
        const tries = Number(saved.n ?? 0) + 1;
        const given = Buffer.from(sha(`${p.pageId}:${input.code.trim()}`));
        const expected = Buffer.from(saved.h);
        const ok = given.length === expected.length && timingSafeEqual(given, expected);
        if (!ok) {
            if (tries >= CODE_ATTEMPTS) {
                await this.redis.del(key).catch(() => undefined);
                throw badRequest('booking_code_locked', 'Escribiste mal el código varias veces. Pide uno nuevo.');
            }
            const ttl = await this.redis.ttl(key).catch(() => CODE_TTL_S);
            await this.redis.set(key, JSON.stringify({ h: saved.h, n: tries }), 'EX', Math.max(1, ttl > 0 ? ttl : CODE_TTL_S)).catch(() => undefined);
            throw badRequest('booking_code_wrong', `El código no coincide. Te quedan ${CODE_ATTEMPTS - tries} intento${CODE_ATTEMPTS - tries === 1 ? '' : 's'}.`);
        }
        await this.redis.del(key).catch(() => undefined);
        const exp = Date.now() + PROOF_TTL_MS;
        return { ok: true, proof: `${exp}.${this.files.signParts('bookproof', p.pageId, input.email.trim().toLowerCase(), exp)}` };
    }

    /** La prueba de `verifyCode`: de esta página, de este correo y no vencida. */
    private verifyEmailProof(pageId: number, email: string, proof: string | undefined): boolean {
        const m = /^(\d{10,16})\.([A-Za-z0-9_-]{10,128})$/.exec(proof ?? '');
        if (!m) return false;
        const exp = Number(m[1]);
        if (!Number.isFinite(exp) || exp < Date.now()) return false;
        return this.files.verifyParts(m[2]!, 'bookproof', pageId, email.trim().toLowerCase(), exp);
    }

    // ─────────────────────────── La cita del cliente ───────────────────────────

    /**
     * Firma del enlace de una cita (la cita no se adivina por su número).
     * v0.1.353 — lleva la VERSIÓN de la cita: `<id>.<firma>` la primera vez (así
     * los correos de antes siguen sirviendo) y `<id>.<versión>.<firma>` después
     * de un cambio. Un enlace de una versión anterior muestra la cita pero ya no
     * deja cambiarla (el correo viejo reenviado no reprograma ni cancela).
     */
    manageRef(tenantId: number, apptId: number, version = 0): string {
        return version > 0
            ? `${apptId}.${version}.${this.files.signParts('bookmanage', tenantId, apptId, version)}`
            : `${apptId}.${this.files.signParts('bookmanage', tenantId, apptId)}`;
    }

    manageUrl(base: string, tenantId: number, apptId: number, version = 0): string {
        return `${base}/api/v1/public/b/manage/${this.manageRef(tenantId, apptId, version)}`;
    }

    /** El enlace al día de una cita. */
    private apptUrl(base: string, p: ResolvedPage, appt: BookingAppointmentRow): string {
        return this.manageUrl(base, p.tenantId, appt.id, appt.manageVersion);
    }

    /** Enlace → cita + página. Uno alterado o de una cita que no existe da el mismo 404. */
    private async resolveAppointment(ref: string): Promise<{ p: ResolvedPage; appt: BookingAppointmentRow; stale: boolean }> {
        const m = /^(\d{1,15})\.(?:(\d{1,6})\.)?([A-Za-z0-9_-]{10,128})$/.exec(ref ?? '');
        if (!m) throw apptNotFound();
        const id = Number(m[1]);
        const version = m[2] === undefined ? 0 : Number(m[2]);
        const [appt] = await this.db.select().from(bookingAppointments).where(eq(bookingAppointments.id, id)).limit(1);
        if (!appt || version > appt.manageVersion) throw apptNotFound();
        const signed = version > 0 ? this.files.verifyParts(m[3]!, 'bookmanage', appt.tenantId, appt.id, version) : this.files.verifyParts(m[3]!, 'bookmanage', appt.tenantId, appt.id);
        if (!signed) throw apptNotFound();
        // El registro en la papelera: la cita no existe para el cliente.
        const [rec] = await this.db
            .select({ id: records.id })
            .from(records)
            .where(and(eq(records.id, appt.recordId), isNull(records.deletedAt)))
            .limit(1);
        const p = rec ? await this.resolveById(appt.pageId) : null;
        if (!p) throw apptNotFound();
        return { p, appt, stale: version < appt.manageVersion };
    }

    /** ¿Se puede reprogramar o cancelar? (no cancelada, no pasada, con el aviso mínimo). */
    private lockedReason(p: ResolvedPage, appt: BookingAppointmentRow, now = new Date(), stale = false): string | null {
        if (appt.status === 'cancelled') return 'Esta cita está cancelada.';
        if (appt.status === 'declined') return 'Esta solicitud de cita no fue confirmada.';
        if (stale) return 'Este enlace es de un correo anterior. Para hacer cambios, usa el del último correo que te enviamos.';
        if (appt.startAt.getTime() <= now.getTime()) return 'Esta cita ya pasó.';
        if (p.readOnly) return 'Por ahora no se pueden hacer cambios en línea. Comunícate con la empresa.';
        const notice = p.config.rules.min_notice_min * 60_000;
        if (appt.startAt.getTime() - now.getTime() < notice) {
            const hours = Math.round(p.config.rules.min_notice_min / 60);
            return `Los cambios se hacen con al menos ${hours >= 1 ? `${hours} hora${hours === 1 ? '' : 's'}` : `${p.config.rules.min_notice_min} minutos`} de anticipación. Comunícate con la empresa.`;
        }
        return null;
    }

    summary(p: ResolvedPage, appt: BookingAppointmentRow, base: string, names: Map<string, string>, stale = false): PublicAppointmentSummary {
        const svc = p.config.services.find((s) => s.id === appt.serviceId);
        const locked = this.lockedReason(p, appt, new Date(), stale);
        const url = this.apptUrl(base, p, appt);
        return {
            service: svc?.name ?? 'Cita',
            staff: names.get(appt.staffId) ?? '',
            start: appt.startAt.toISOString(),
            end: appt.endAt.toISOString(),
            status: appt.status as BookingStatus,
            location: this.locationText(p, appt),
            location_kind: svc?.location.kind ?? 'page',
            // El enlace lo ve sólo quien tiene el enlace firmado de su cita (y no una cancelada ni una por confirmar).
            meeting_url: appt.status === 'confirmed' || appt.status === 'rescheduled' ? appt.meetingUrl : null,
            client_name: appt.clientName ?? '',
            time_zone: p.timeZone,
            manage_url: url,
            ics_url: `${base}/api/v1/public/booking/manage/${this.manageRef(p.tenantId, appt.id, appt.manageVersion)}/ics`,
            can_reschedule: locked === null && p.config.rules.allow_reschedule,
            can_cancel: locked === null && p.config.rules.allow_cancel,
            locked_reason: locked,
        };
    }

    async manageMeta(ref: string): Promise<PublicManageMeta> {
        const { p, appt, stale } = await this.resolveAppointment(ref);
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        const booking = await this.buildMeta(p);
        return { appointment: this.summary(p, appt, base, names, stale), booking, service_id: appt.serviceId, staff_id: appt.staffId };
    }

    /** La página HTML de gestión: null si el enlace no sirve (mismo 404 para todo). */
    async managePage(ref: string): Promise<{ meta: PublicManageMeta; allowed_domains: string[]; look: BookingLook } | null> {
        try {
            const { p } = await this.resolveAppointment(ref);
            return { meta: await this.manageMeta(ref), allowed_domains: p.config.settings.allowed_domains, look: this.themeLook(p) };
        } catch {
            return null;
        }
    }

    /** Horarios para reprogramar: los mismos de la página, sin contar la propia cita. */
    async manageSlots(ref: string, ip: string, q: BookingSlotsQuery): Promise<PublicBookingSlots> {
        const { p, appt, stale } = await this.resolveAppointment(ref);
        await this.enforce(SLOTS_LIMITS, p.pageId, ip, 'horarios');
        if (this.lockedReason(p, appt, new Date(), stale) || !p.config.rules.allow_reschedule) return { slots: [], first_day: q.from, last_day: q.to };
        return this.availability.slots(p, appt.serviceId, this.staffSelection(p, q.staff), q.from, q.to, { excludeRecordId: appt.recordId, durationMin: appointmentMinutes(appt) });
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
        const url = this.apptUrl(base, p, appt);
        return buildIcs({
            uid: `cita-${appt.id}-${p.tenantId}@imagina-base`,
            start: appt.startAt,
            end: appt.endAt,
            summary: `${svc?.name ?? 'Cita'}${b.company ? ` — ${b.company}` : ''}`,
            description: [
                staff ? `Con: ${staff}` : '',
                appt.meetingUrl ? `Videollamada: ${appt.meetingUrl}` : '',
                p.config.notifications.email_note,
                `Para cambiar o cancelar: ${url}`,
            ]
                .filter(Boolean)
                .join('\n\n'),
            // Con videollamada el lugar ES el enlace (los calendarios lo vuelven clicable).
            location: appt.meetingUrl ?? this.locationText(p, appt),
            sequence: Math.max(0, Math.floor((appt.updatedAt.getTime() - Date.UTC(2026, 0, 1)) / 1000)),
            cancelled: appt.status === 'cancelled' || appt.status === 'declined',
            url,
        });
    }

    async cancel(ref: string, ip: string, input: CancelAppointmentInput): Promise<PublicAppointmentSummary> {
        const { p, appt, stale } = await this.resolveAppointment(ref);
        await this.enforce(MANAGE_LIMITS, p.pageId, ip, 'cambios');
        const locked = this.lockedReason(p, appt, new Date(), stale);
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
                .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id), notInArray(bookingAppointments.status, [...BOOKING_INACTIVE_STATUSES])))
                .returning(),
        );
        // Dos pedidos a la vez (o el equipo la canceló un segundo antes): sólo uno cancela.
        if (!row) throw new ForbiddenException({ code: 'booking_locked', message: 'Esta cita ya no se puede cancelar.', data: { status: 403 } });
        this.forgetSlots(p.tenantId);
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
        const { p, appt, stale } = await this.resolveAppointment(ref);
        await this.enforce(MANAGE_LIMITS, p.pageId, ip, 'cambios');
        const locked = this.lockedReason(p, appt, new Date(), stale);
        if (locked || !p.config.rules.allow_reschedule) {
            throw new ForbiddenException({ code: 'booking_locked', message: locked ?? 'Esta agenda no permite reprogramar en línea. Comunícate con la empresa.', data: { status: 403 } });
        }
        const service = this.availability.service(p.config, appt.serviceId);
        const start = new Date(input.start);
        if (Number.isNaN(start.getTime())) throw badRequest('booking_invalid', 'Elige un horario.');
        // Se conserva la duración que eligió al reservar (si el servicio todavía la ofrece).
        const durationMin = pickServiceDuration(service, appointmentMinutes(appt));
        const end = new Date(start.getTime() + durationMin * 60_000);
        const sel = this.staffSelection(p, input.staff_id ?? appt.staffId);
        let candidates = this.availability.candidates(p.config, service.id, sel);
        if (sel === 'any') candidates = await this.roundRobin(p, candidates);
        // Quien atendía primero (si sigue libre, no se cambia de persona sin necesidad).
        candidates.sort((a, b) => Number(b.id === appt.staffId) - Number(a.id === appt.staffId));
        if (candidates.length === 0) throw badRequest('booking_invalid', 'No hay quién atienda ese servicio en este momento.');
        const names = await this.staffNames(p.config);
        const fieldsById = new Map(p.fields.map((f) => [f.id, f]));
        // v0.1.353 — una por confirmar sigue por confirmar en el horario nuevo.
        const wasPending = appt.status === 'pending';
        const nextStatus: BookingStatus = wasPending ? 'pending' : 'rescheduled';

        let done: { row: BookingAppointmentRow; staff: BookingStaff } | null = null;
        let lastReason = 'taken';
        for (const staff of candidates) {
            const ymd = zonedDayAndMinute(start, p.timeZone).ymd;
            const outside = await this.availability.outside(p, staff, ymd, ymd);
            const newMeeting = staff.id !== appt.staffId && !wasPending ? await this.immediateMeeting(p, service, staff) : null;
            const out = await this.withStaffLock(p.tenantId, staffKey(p.pageId, staff), async (tx) => {
                const reason = await this.availability.checkInTx(tx, p, staff, service, start, outside, { excludeRecordId: appt.recordId, durationMin });
                if (reason) return { reason };
                // El registro se actualiza por RecordsService (validación, actividad,
                // automatizaciones) mientras ESTA transacción tiene el candado.
                // v0.1.350 — con otra persona, la videollamada es otra (la de su calendario, o su enlace fijo).
                const meetingPatch = staff.id !== appt.staffId ? { meetingUrl: newMeeting?.url ?? null, meetingProvider: newMeeting?.provider ?? null } : {};
                await this.records.update(
                    p.tenantId,
                    SYSTEM_ACTOR,
                    String(p.listId),
                    appt.recordId,
                    {
                        data: {
                            ...appointmentRecordData({ config: p.config, fieldsById, service, staff, staffName: names.get(staff.id) ?? staffLabel(staff), start, end, status: nextStatus }),
                            ...(staff.id !== appt.staffId ? this.meetingData(p, newMeeting, true) : {}),
                        },
                    },
                    { origin: 'booking' },
                );
                const [row] = await tx
                    .update(bookingAppointments)
                    .set({
                        ...meetingPatch,
                        startAt: start,
                        endAt: end,
                        staffId: staff.id,
                        staffUserId: staff.kind === 'user' ? staff.staff_user_id : null,
                        status: nextStatus,
                        remindersSent: this.passedReminders(p.config, start),
                        // El enlace con el que se hizo el cambio deja de servir para otro (v0.1.353).
                        manageVersion: sql`${bookingAppointments.manageVersion} + 1`,
                        ...(wasPending ? { pendingUntil: new Date(Math.min(Date.now() + p.config.approval.hours * 3_600_000, start.getTime())) } : {}),
                        updatedAt: new Date(),
                        ...(input.time_zone && isValidTimeZone(input.time_zone) ? { clientTz: input.time_zone } : {}),
                    })
                    .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id), eq(bookingAppointments.manageVersion, appt.manageVersion)))
                    .returning();
                // Otro cambio entró un segundo antes con el mismo enlace: éste ya no vale.
                if (!row) throw new ForbiddenException({ code: 'booking_locked', message: 'La cita cambió mientras elegías. Recarga la página.', data: { status: 403 } });
                return { row };
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
        this.forgetSlots(p.tenantId);
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
        by: 'client' | 'team' | 'calendar',
        base: string,
        names: Map<string, string>,
        previous: { start: Date; end: Date } | null,
    ): BookingEventInfo {
        const url = this.apptUrl(base, p, appt);
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
            location: this.locationText(p, appt),
            meeting_url: appt.meetingUrl ?? '',
        };
    }

    /** v0.1.350 — Dónde es la cita, en una línea (sin el enlace: ése va aparte). */
    private locationText(p: ResolvedPage, appt: BookingAppointmentRow): string {
        const svc = p.config.services.find((s) => s.id === appt.serviceId);
        return svc ? bookingLocationText(svc.location, p.config.settings.location, { url: appt.meetingUrl, provider: appt.meetingProvider }) : p.config.settings.location;
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
     * Lo que no puede tumbar la respuesta al cliente: el evento en el
     * calendario de quien atiende (crearlo —con la videollamada—, moverlo o
     * borrarlo), el disparador de automatizaciones (con `dispatch`: sale
     * DESPUÉS del calendario, así `{{cita.enlace_reunion}}` ya trae el enlace)
     * y el correo con el .ics. Lo que falla queda en Problemas.
     *
     * Devuelve dos promesas que nunca fallan: `calendar` (la cita como quedó
     * después del calendario) y `done` (todo terminado).
     */
    private afterChange(
        p: ResolvedPage,
        appt: BookingAppointmentRow,
        staff: BookingStaff | null,
        event: BookingEvent,
        x: {
            base: string;
            names: Map<string, string>;
            withdrawRef?: string | null;
            previous?: BookingAppointmentRow;
            byTeam?: boolean;
            /** v0.1.350 — el cambio llegó DESDE el calendario: no se le escribe de vuelta. */
            fromCalendar?: boolean;
            dispatch?: { data: Record<string, unknown> | null; by: 'client' | 'team' | 'calendar'; previous: { start: Date; end: Date } | null };
        },
    ): { calendar: Promise<BookingAppointmentRow | null>; done: Promise<void> } {
        // v0.1.353 — una por confirmar todavía no va al calendario (llega al aprobarla).
        const skipCalendar = x.fromCalendar || appt.status === 'pending';
        const calendar = (skipCalendar ? Promise.resolve(appt) : this.syncCalendar(p, appt, staff, event, x.previous)).catch((err: unknown) => {
            this.logger.warn(`Agenda ${p.pageId}: calendario de la cita ${appt.id}: ${String(err)}`);
            return null;
        });
        const done = (async () => {
            const row = (await calendar) ?? appt;
            if (x.dispatch) {
                const info = this.eventInfo(p, row, event, x.dispatch.by, x.base, x.names, x.dispatch.previous);
                // Si el calendario agregó el enlace al registro, el disparador lee el registro de nuevo.
                this.dispatchEvent(p, row, info, row.meetingUrl !== appt.meetingUrl ? null : x.dispatch.data);
            }
            const send = event === 'booked' ? p.config.notifications.confirm_email : !x.byTeam || p.config.notifications.notify_client_on_team_change;
            if (send) {
                // Una por confirmar que cambió de horario: el correo vuelve a ser «recibimos tu solicitud».
                const kind: BookingMailKind = row.status === 'pending' && event === 'rescheduled' ? 'requested' : (event as BookingMailKind);
                await this.sendClientMail(p, row, kind, {
                    base: x.base,
                    names: x.names,
                    withdrawRef: x.withdrawRef ?? null,
                    previousStart: x.previous?.startAt ?? null,
                    byTeam: x.byTeam === true,
                });
            }
        })().catch((err: unknown) => this.logger.warn(`Agenda ${p.pageId}: lo que sigue a la cita ${appt.id}: ${String(err)}`));
        return { calendar, done };
    }

    /**
     * v0.1.350 — La videollamada que se sabe ANTES de crear el evento: el
     * enlace fijo del servicio, o el de la persona cuando su calendario no
     * puede generar la que pide el servicio. null = no hay, o la genera el
     * evento del calendario (Meet o Teams).
     */
    private async immediateMeeting(p: ResolvedPage, svc: BookingServiceItem | undefined, staff: BookingStaff): Promise<MeetingInfo | null> {
        const loc = svc?.location;
        if (!loc) return null;
        if (loc.kind === 'link') return loc.url !== '' ? { url: loc.url, provider: 'link' } : null;
        if (loc.kind !== 'video') return null;
        if (staff.kind === 'user' && staff.create_events) {
            const ref = await this.calendar.resolveStaff(p.tenantId, staff).catch(() => null);
            if (ref && videoFor(loc.video, ref.provider)) return null;
        }
        return staff.meeting_url !== '' ? { url: staff.meeting_url, provider: 'link' } : null;
    }

    /** El enlace de la videollamada en el campo elegido de la lista (si la página tiene uno). */
    private meetingData(p: ResolvedPage, meeting: MeetingInfo | null, clearIfNone = false): Record<string, unknown> {
        const id = p.config.mapping.meeting_url_field_id;
        if (id === null || (!meeting && !clearIfNone)) return {};
        return { [jsonbKeyForField(id)]: meeting?.url ?? null };
    }

    private async writeMeetingField(p: ResolvedPage, appt: BookingAppointmentRow, url: string | null): Promise<void> {
        const data = this.meetingData(p, url ? { url, provider: 'link' } : null, true);
        if (Object.keys(data).length === 0) return;
        await this.records.update(p.tenantId, SYSTEM_ACTOR, String(p.listId), appt.recordId, { data }, { origin: 'booking' }).catch((err: unknown) => {
            this.logger.warn(`Agenda ${p.pageId}: no se pudo guardar el enlace de la videollamada en el registro ${appt.recordId}: ${String(err)}`);
        });
    }

    /**
     * El evento en el calendario de quien atiende: crearlo (con la
     * videollamada que pide el servicio), moverlo o borrarlo. Devuelve la cita
     * como quedó (con el evento y el enlace guardados).
     */
    private async syncCalendar(p: ResolvedPage, appt: BookingAppointmentRow, staff: BookingStaff | null, event: BookingEvent, previous?: BookingAppointmentRow): Promise<BookingAppointmentRow> {
        const ext = appt.externalEvent ?? previous?.externalEvent ?? null;
        const key = `booking-event:${p.pageId}:${appt.staffId}`;
        let row = appt;
        const save = async (patch: Partial<typeof bookingAppointments.$inferInsert>): Promise<void> => {
            const [r] = await this.tenantDb.withTenant(p.tenantId, (tx) =>
                tx
                    .update(bookingAppointments)
                    .set(patch)
                    .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id)))
                    .returning(),
            );
            if (r) row = r;
        };
        const ref = staff && staff.kind === 'user' ? await this.calendar.resolveStaff(p.tenantId, staff) : null;
        const sameOwner = ext !== null && ref !== null && ref.connectionId === ext.connection_id;
        const svc = p.config.services.find((s) => s.id === appt.serviceId);
        try {
            if (event === 'cancelled') {
                if (ext) {
                    await this.calendar.deleteEvent(p.tenantId, ext);
                    await save({ externalEvent: null });
                }
                return row;
            }
            if (event === 'rescheduled' && ext && sameOwner) {
                await this.calendar.moveEvent(p.tenantId, ext, appt.startAt, appt.endAt);
                // Lo que la app escribió: la sincronización de vuelta no lo toma por un cambio de quien atiende.
                await save({ externalEvent: { ...ext, start: appt.startAt.toISOString(), end: appt.endAt.toISOString() } });
                return row;
            }
            let lostMeeting = false;
            if (ext && !sameOwner) {
                // Cambió quien atiende (o su calendario): el evento —y su videollamada— sale del anterior.
                await this.calendar.deleteEvent(p.tenantId, ext).catch(() => undefined);
                lostMeeting = row.meetingProvider === 'meet' || row.meetingProvider === 'teams';
                await save({ externalEvent: null, ...(lostMeeting ? { meetingUrl: null, meetingProvider: null } : {}) });
            }
            if (!staff || !ref || !staff.create_events) {
                if (lostMeeting && staff) {
                    const fallback = await this.immediateMeeting(p, svc, staff);
                    if (fallback) await save({ meetingUrl: fallback.url, meetingProvider: fallback.provider });
                    await this.writeMeetingField(p, row, fallback?.url ?? null);
                }
                return row;
            }
            const loc = svc?.location;
            const want = loc?.kind === 'video' ? videoFor(loc.video, ref.provider) : null;
            const fixedLink = row.meetingProvider === 'link' ? row.meetingUrl : null;
            const where = loc ? bookingLocationText(loc, p.config.settings.location, { url: fixedLink, provider: fixedLink ? 'link' : null }) : p.config.settings.location;
            const created = await this.calendar.createEvent(p.tenantId, ref, {
                title: `${svc?.name ?? 'Cita'} — ${appt.clientName ?? 'Cliente'}`,
                start: appt.startAt,
                end: appt.endAt,
                timeZone: p.timeZone,
                description: [
                    `Cita agendada en «${p.row.name}».`,
                    appt.clientName ? `Cliente: ${appt.clientName}` : '',
                    appt.clientEmail ? `Correo: ${appt.clientEmail}` : '',
                    fixedLink ? `Videollamada: ${fixedLink}` : '',
                ]
                    .filter(Boolean)
                    .join('\n'),
                location: fixedLink ?? where,
                meeting: want,
            });
            let meeting: MeetingInfo | null = created.meeting;
            if (!meeting && loc?.kind === 'video' && staff.meeting_url !== '') meeting = { url: staff.meeting_url, provider: 'link' };
            if (!meeting && loc?.kind === 'link' && loc.url !== '') meeting = { url: loc.url, provider: 'link' };
            const before = row.meetingUrl;
            await save({ externalEvent: created.event, meetingUrl: meeting?.url ?? null, meetingProvider: meeting?.provider ?? null });
            if ((meeting?.url ?? null) !== before) await this.writeMeetingField(p, row, meeting?.url ?? null);
            const meetKey = `booking-meeting:${p.pageId}:${appt.staffId}`;
            if (created.meetingError && !meeting) {
                this.incidents?.report({
                    tenantId: p.tenantId,
                    key: meetKey,
                    source: 'booking',
                    sourceId: p.pageId,
                    listId: p.listId,
                    ownerId: p.createdBy,
                    title: `La agenda «${p.row.name}» no pudo crear una videollamada`,
                    message: `${created.meetingError} La cita quedó agendada sin enlace. Ponle a esa persona un enlace de videollamada fijo (Quién atiende) para que siempre tenga uno.`,
                });
            } else if (want) {
                this.incidents?.resolve(p.tenantId, meetKey);
            }
            this.incidents?.resolve(p.tenantId, key);
            return row;
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

    /**
     * v0.1.350 — Quien atiende movió o borró el evento de la cita en SU
     * calendario: la cita se mueve o se cancela por el mismo camino que cuando
     * el equipo la cambia desde la app (registro, disparador y aviso al
     * cliente), sin volver a escribir en el calendario. Lo usa la
     * sincronización de vuelta.
     */
    async applyCalendarChange(appt: BookingAppointmentRow, change: { kind: 'gone' } | { kind: 'moved'; start: Date; end: Date }): Promise<'moved' | 'cancelled' | 'ignored'> {
        const ext = appt.externalEvent;
        if (!ext || appt.status === 'cancelled') return 'ignored';
        const p = await this.resolveById(appt.pageId);
        if (!p || p.readOnly) return 'ignored';
        this.forgetSlots(p.tenantId);
        const m = p.config.mapping;
        const sync = p.config.calendar_sync;
        const setAppt = async (patch: Partial<typeof bookingAppointments.$inferInsert>): Promise<BookingAppointmentRow | null> => {
            const [r] = await this.tenantDb.withTenant(p.tenantId, (tx) =>
                tx
                    .update(bookingAppointments)
                    .set({ ...patch, updatedAt: new Date() })
                    .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id), ne(bookingAppointments.status, 'cancelled')))
                    .returning(),
            );
            return r ?? null;
        };
        if (change.kind === 'gone') {
            // Sin evento ya no hay nada que mover ni borrar del otro lado.
            if (!sync.cancel) {
                await setAppt({ externalEvent: null });
                return 'ignored';
            }
            const data: Record<string, unknown> = {};
            if (m.status_field_id !== null && m.status_cancelled !== null) data[jsonbKeyForField(m.status_field_id)] = m.status_cancelled;
            if (Object.keys(data).length > 0) {
                const ok = await this.records
                    .update(p.tenantId, SYSTEM_ACTOR, String(p.listId), appt.recordId, { data }, { origin: 'booking' })
                    .then(() => true)
                    .catch((err: unknown) => {
                        this.logger.warn(`Agenda ${p.pageId}: no se pudo cancelar la cita ${appt.id} desde el calendario: ${String(err)}`);
                        return false;
                    });
                if (!ok) return 'ignored';
            }
            const row = await setAppt({ status: 'cancelled', cancelledAt: new Date(), externalEvent: null });
            if (!row) return 'ignored';
            const base = await this.base(p.tenantId);
            const names = await this.staffNames(p.config);
            const staff = p.config.staff.find((s) => s.id === row.staffId) ?? null;
            await this.afterChange(p, row, staff, 'cancelled', { base, names, byTeam: true, fromCalendar: true, dispatch: { data: null, by: 'calendar', previous: null } }).done;
            return 'cancelled';
        }
        const start = change.start;
        const end = change.end;
        const moved = { ...ext, start: start.toISOString(), end: end.toISOString() };
        if (!sync.move || (start.getTime() === appt.startAt.getTime() && end.getTime() === appt.endAt.getTime())) {
            // La app ya lo tenía así (lo movió ella), o la agenda no sigue los cambios del calendario.
            await setAppt({ externalEvent: moved });
            return 'ignored';
        }
        const staff = p.config.staff.find((s) => s.id === appt.staffId) ?? null;
        const data: Record<string, unknown> = {};
        if (m.start_field_id !== null) data[jsonbKeyForField(m.start_field_id)] = start.toISOString();
        if (m.end_field_id !== null) data[jsonbKeyForField(m.end_field_id)] = end.toISOString();
        if (m.duration_field_id !== null) data[jsonbKeyForField(m.duration_field_id)] = Math.round((end.getTime() - start.getTime()) / 60_000);
        if (m.status_field_id !== null && m.status_rescheduled !== null) data[jsonbKeyForField(m.status_field_id)] = m.status_rescheduled;
        if (Object.keys(data).length > 0) {
            const ok = await this.records
                .update(p.tenantId, SYSTEM_ACTOR, String(p.listId), appt.recordId, { data }, { origin: 'booking' })
                .then(() => true)
                .catch((err: unknown) => {
                    this.logger.warn(`Agenda ${p.pageId}: no se pudo mover la cita ${appt.id} desde el calendario: ${String(err)}`);
                    return false;
                });
            if (!ok) return 'ignored';
        }
        const row = await setAppt({ startAt: start, endAt: end, status: 'rescheduled', remindersSent: this.passedReminders(p.config, start), externalEvent: moved });
        if (!row) return 'ignored';
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        await this.afterChange(p, row, staff, 'rescheduled', {
            base,
            names,
            previous: appt,
            byTeam: true,
            fromCalendar: true,
            dispatch: { data: null, by: 'calendar', previous: { start: appt.startAt, end: appt.endAt } },
        }).done;
        return 'moved';
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
        x: { base: string; names: Map<string, string>; withdrawRef?: string | null; previousStart?: Date | null; byTeam?: boolean; reminderLead?: string; reason?: string | null },
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
            location: summary.location,
            meetingUrl: summary.meeting_url,
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
            reason: x.reason ?? appt.declineReason,
            pendingUntil: appt.pendingUntil ? appt.pendingUntil.toISOString() : null,
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
                // Una solicitud o un rechazo no van al calendario del cliente.
                ...(bookingMailHasIcs(kind)
                    ? { attachments: [{ filename: kind === 'cancelled' ? 'cita-cancelada.ics' : 'cita.ics', contentType: 'text/calendar; charset=utf-8; method=' + (kind === 'cancelled' ? 'CANCEL' : 'PUBLISH'), contentBase64: Buffer.from(ics, 'utf8').toString('base64') }] }
                    : {}),
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

    // ─────────────────────────── Aprobación (v0.1.353) ───────────────────────────

    /** Quién aprueba: las personas elegidas y, si la página lo dice, quien atiende. Sin nadie, quien armó la agenda. */
    approverIds(p: ResolvedPage, appt: Pick<BookingAppointmentRow, 'staffUserId'>): number[] {
        const a = p.config.approval;
        const ids = new Set<number>(a.approver_user_ids);
        if (a.staff_approves && appt.staffUserId !== null) ids.add(appt.staffUserId);
        if (ids.size === 0 && p.createdBy !== null) ids.add(p.createdBy);
        return [...ids];
    }

    /** ¿Puede decidir? Quien administra la lista, quien aprueba en esta agenda o quien atiende (si se permite). */
    canDecide(actor: BookingDecider, p: ResolvedPage, appt: Pick<BookingAppointmentRow, 'staffUserId'>): boolean {
        if (actor.role === 'client' || actor.role === 'guest') return false;
        if (can(actor, 'manage_lists')) return true;
        return this.approverIds(p, appt).includes(actor.userId);
    }

    /** Aviso a quien aprueba: una cita nueva por confirmar, o que venció el plazo. */
    private notifyApprovers(p: ResolvedPage, appt: BookingAppointmentRow, info: BookingEventInfo, why: 'requested' | 'expired'): void {
        if (!this.notify) return;
        const ids = this.approverIds(p, appt);
        if (ids.length === 0) return;
        const when = formatBookingWhen(appt.startAt.toISOString(), p.timeZone, p.format.time_format, { year: false });
        const client = (appt.clientName ?? '').trim() || 'Un cliente';
        this.notify.emit({
            type: 'booking',
            tenantId: p.tenantId,
            listId: p.listId,
            recordId: appt.recordId,
            userIds: ids,
            kind: 'assigned',
            title: why === 'requested' ? `Cita por confirmar: ${client} · ${info.service}, ${when}` : `Venció el plazo de la cita de ${client} (${when})`,
            body:
                why === 'requested'
                    ? `En «${p.row.name}». Ábrela para aprobarla o rechazarla.`
                    : `En «${p.row.name}». Nadie la decidió a tiempo: se ${p.config.approval.on_timeout === 'approve' ? 'confirmó' : 'rechazó'} sola.`,
        });
    }

    /** La cita de un registro, para el panel de la ficha (null = el registro no es una cita). */
    async recordBooking(tenantId: number, actor: BookingDecider, listIdOrSlug: string, recordId: number): Promise<RecordBookingDto | null> {
        // Ver el registro (404 si no): el mismo ACL que la ficha.
        await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const appt = await this.latestForRecord(tenantId, recordId);
        if (!appt) return null;
        const p = await this.resolveById(appt.pageId);
        if (!p) return null;
        return this.recordDto(p, appt, actor);
    }

    private async latestForRecord(tenantId: number, recordId: number): Promise<BookingAppointmentRow | null> {
        const [appt] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(bookingAppointments)
                .where(and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.recordId, recordId)))
                .orderBy(desc(bookingAppointments.id))
                .limit(1),
        );
        return appt ?? null;
    }

    private async recordDto(p: ResolvedPage, appt: BookingAppointmentRow, actor: BookingDecider): Promise<RecordBookingDto> {
        const names = await this.staffNames(p.config);
        let decidedBy: string | null = null;
        if (appt.decidedBy !== null) {
            const [u] = await this.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, appt.decidedBy)).limit(1);
            decidedBy = u ? u.name.trim() || u.email : null;
        }
        return {
            appointment_id: appt.id,
            page_id: p.pageId,
            page_name: p.config.settings.title || p.row.name,
            status: appt.status as BookingStatus,
            service: p.config.services.find((s) => s.id === appt.serviceId)?.name ?? 'Cita',
            staff: names.get(appt.staffId) ?? '',
            start: appt.startAt.toISOString(),
            end: appt.endAt.toISOString(),
            client_name: appt.clientName ?? '',
            client_email: appt.clientEmail ?? '',
            pending_until: appt.status === 'pending' && appt.pendingUntil ? appt.pendingUntil.toISOString() : null,
            on_timeout: appt.status === 'pending' ? p.config.approval.on_timeout : null,
            can_decide: appt.status === 'pending' && !p.readOnly && this.canDecide(actor, p, appt),
            decided_by_name: decidedBy,
            decided_at: appt.decidedAt ? appt.decidedAt.toISOString() : null,
            decline_reason: appt.declineReason,
        };
    }

    /** Aprobar o rechazar desde la ficha. Siempre un POST con sesión y el ACL del registro. */
    async decide(tenantId: number, actor: BookingDecider, listIdOrSlug: string, recordId: number, input: DecideBookingInput): Promise<RecordBookingDto> {
        await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const appt = await this.latestForRecord(tenantId, recordId);
        if (!appt) throw apptNotFound();
        const p = await this.resolveById(appt.pageId);
        if (!p) throw apptNotFound();
        if (appt.status !== 'pending') throw notPending();
        if (!this.canDecide(actor, p, appt)) {
            throw new ForbiddenException({ code: 'booking_not_approver', message: 'No eres de quienes aprueban las citas de esta agenda.', data: { status: 403 } });
        }
        if (p.readOnly) throw new ForbiddenException({ code: 'read_only', message: 'La cuenta está en solo lectura: no se pueden aprobar citas.', data: { status: 403 } });
        const row =
            input.decision === 'approve'
                ? await this.approvePending(p, appt, { by: actor.userId })
                : await this.declinePending(p, appt, { by: actor.userId, reason: input.reason?.trim() || null });
        if (!row) throw notPending();
        return this.recordDto(p, row, actor);
    }

    /**
     * Aprueba una cita por confirmar: queda confirmada, va al calendario de
     * quien atiende (con la videollamada), le llega la confirmación al cliente
     * y sale el disparador «Se agendó». El UPDATE condicional (sólo si sigue
     * por confirmar) hace que dos aprobaciones a la vez cuenten una vez.
     * `recordDone`: el equipo ya puso el estado en el registro (no se vuelve a escribir).
     */
    async approvePending(
        p: ResolvedPage,
        appt: BookingAppointmentRow,
        x: { by: number | null; recordDone?: boolean; times?: { start: Date; end: Date }; expired?: boolean },
    ): Promise<BookingAppointmentRow | null> {
        const staff = p.config.staff.find((s) => s.id === appt.staffId) ?? null;
        const service = p.config.services.find((s) => s.id === appt.serviceId);
        const meeting = staff ? await this.immediateMeeting(p, service, staff) : null;
        const start = x.times?.start ?? appt.startAt;
        const [row] = await this.tenantDb.withTenant(p.tenantId, (tx) =>
            tx
                .update(bookingAppointments)
                .set({
                    status: 'confirmed',
                    pendingUntil: null,
                    decidedBy: x.by && x.by > 0 ? x.by : null,
                    decidedAt: new Date(),
                    remindersSent: this.passedReminders(p.config, start),
                    meetingUrl: meeting?.url ?? null,
                    meetingProvider: meeting?.provider ?? null,
                    ...(x.times ? { startAt: x.times.start, endAt: x.times.end } : {}),
                    updatedAt: new Date(),
                })
                .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id), eq(bookingAppointments.status, 'pending')))
                .returning(),
        );
        if (!row) return null;
        const data: Record<string, unknown> = { ...this.meetingData(p, meeting) };
        const status = statusValueFor(p.config.mapping, 'confirmed');
        if (!x.recordDone && status !== null && p.config.mapping.status_field_id !== null) data[jsonbKeyForField(p.config.mapping.status_field_id)] = status;
        if (Object.keys(data).length > 0) {
            await this.records.update(p.tenantId, SYSTEM_ACTOR, String(p.listId), appt.recordId, { data }, { origin: 'booking' }).catch((err: unknown) => {
                this.logger.warn(`Agenda ${p.pageId}: no se pudo marcar como confirmada la cita ${appt.id} en el registro: ${String(err)}`);
            });
        }
        this.forgetSlots(p.tenantId);
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        const info = this.eventInfo(p, row, 'booked', 'team', base, names, null);
        // A quien atiende, si no fue quien la aprobó.
        if (staff && !(staff.kind === 'user' && staff.staff_user_id === x.by)) this.notifyStaff(p, row, staff, 'booked', info);
        if (x.expired) this.notifyApprovers(p, row, info, 'expired');
        void this.afterChange(p, row, staff, 'booked', { base, names, dispatch: { data: null, by: x.by ? 'team' : 'client', previous: null } });
        return row;
    }

    /**
     * Rechaza una cita por confirmar (el equipo, o venció el plazo): el lugar
     * queda libre, le llega al cliente el motivo (si lo hay) y sale el
     * disparador «Se rechazó».
     */
    async declinePending(
        p: ResolvedPage,
        appt: BookingAppointmentRow,
        x: { by: number | null; reason: string | null; recordDone?: boolean; expired?: boolean },
    ): Promise<BookingAppointmentRow | null> {
        const [row] = await this.tenantDb.withTenant(p.tenantId, (tx) =>
            tx
                .update(bookingAppointments)
                .set({
                    status: 'declined',
                    decidedBy: x.by && x.by > 0 ? x.by : null,
                    decidedAt: new Date(),
                    declineReason: x.reason ? x.reason.slice(0, 500) : null,
                    updatedAt: new Date(),
                })
                .where(and(eq(bookingAppointments.tenantId, p.tenantId), eq(bookingAppointments.id, appt.id), eq(bookingAppointments.status, 'pending')))
                .returning(),
        );
        if (!row) return null;
        const status = statusValueFor(p.config.mapping, 'declined');
        if (!x.recordDone && status !== null && p.config.mapping.status_field_id !== null) {
            await this.records
                .update(p.tenantId, SYSTEM_ACTOR, String(p.listId), appt.recordId, { data: { [jsonbKeyForField(p.config.mapping.status_field_id)]: status } }, { origin: 'booking' })
                .catch((err: unknown) => this.logger.warn(`Agenda ${p.pageId}: no se pudo marcar como rechazada la cita ${appt.id}: ${String(err)}`));
        }
        this.forgetSlots(p.tenantId);
        const base = await this.base(p.tenantId);
        const names = await this.staffNames(p.config);
        const info = this.eventInfo(p, row, 'declined', x.by ? 'team' : 'client', base, names, null);
        this.dispatchEvent(p, row, info, null);
        if (x.expired) this.notifyApprovers(p, row, info, 'expired');
        // El cliente se entera siempre: si no, se presentaría a una cita que no existe.
        void this.sendClientMail(p, row, 'declined', { base, names, byTeam: true, reason: x.reason });
        return row;
    }

    /**
     * Las citas por confirmar cuyo plazo venció: se rechazan (o se confirman,
     * si la agenda lo dice). Una por una, con el mismo UPDATE condicional que
     * decidir: aunque dos nodos barran a la vez, cada una se decide una vez.
     */
    async expirePending(now = new Date()): Promise<number> {
        const rows = await this.db
            .select()
            .from(bookingAppointments)
            .where(and(eq(bookingAppointments.status, 'pending'), lte(bookingAppointments.pendingUntil, now)))
            .orderBy(asc(bookingAppointments.pendingUntil))
            .limit(EXPIRE_BATCH);
        let done = 0;
        for (const appt of rows) {
            try {
                const p = await this.resolveById(appt.pageId);
                // En solo lectura no se decide nada (vuelve a intentarse cuando la cuenta vuelva).
                if (!p || p.readOnly) continue;
                const row =
                    p.config.approval.on_timeout === 'approve' && appt.startAt.getTime() > now.getTime()
                        ? await this.approvePending(p, appt, { by: null, expired: true })
                        : await this.declinePending(p, appt, { by: null, reason: null, expired: true });
                if (row) done++;
            } catch (err) {
                this.logger.warn(`Agenda: no se pudo vencer la cita por confirmar ${appt.id}: ${String(err)}`);
            }
        }
        return done;
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
        // v0.1.353 — el estado del registro dicho como estado de la cita (null = otro valor, o vacío).
        const said = statusFromValue(m, after);
        const nowInactive = said === 'cancelled' || said === 'declined';
        const wasInactive = (BOOKING_INACTIVE_STATUSES as readonly string[]).includes(appt.status);
        const startRaw = m.start_field_id !== null ? after[jsonbKeyForField(m.start_field_id)] : null;
        const start = typeof startRaw === 'string' ? new Date(startRaw) : null;
        const moved = start !== null && !Number.isNaN(start.getTime()) && start.getTime() !== appt.startAt.getTime();
        const newTimes = (): { start: Date; end: Date } => {
            const endRaw = m.end_field_id !== null ? after[jsonbKeyForField(m.end_field_id)] : null;
            const durRaw = m.duration_field_id !== null ? Number(after[jsonbKeyForField(m.duration_field_id)]) : NaN;
            const end =
                typeof endRaw === 'string' && Date.parse(endRaw) > start!.getTime()
                    ? new Date(endRaw)
                    : new Date(start!.getTime() + (Number.isFinite(durRaw) && durRaw > 0 ? durRaw : (appt.endAt.getTime() - appt.startAt.getTime()) / 60_000) * 60_000);
            return { start: start!, end };
        };
        // Una por confirmar: el equipo la aprueba o la rechaza poniéndole el estado en la ficha.
        if (appt.status === 'pending' && !p.readOnly) {
            if (said === 'confirmed' || said === 'rescheduled') {
                await this.approvePending(p, appt, { by: c.actorId ?? null, recordDone: true, ...(moved ? { times: newTimes() } : {}) });
                return;
            }
            if (said === 'declined') {
                await this.declinePending(p, appt, { by: c.actorId ?? null, reason: null, recordDone: true });
                return;
            }
        }
        let event: BookingEvent | null = null;
        const patch: Partial<typeof bookingAppointments.$inferInsert> = { updatedAt: new Date() };
        if (nowInactive && !wasInactive) {
            event = 'cancelled';
            patch.status = 'cancelled';
            patch.cancelledAt = new Date();
        } else if (wasInactive && (said === 'confirmed' || said === 'rescheduled')) {
            // La reactivaron: vuelve a contar (sin aviso: lo decide el equipo).
            patch.status = 'confirmed';
            patch.cancelledAt = null;
        }
        // Una cancelada o rechazada que nadie reactivó no se mueve (ni revive por moverla).
        if (moved && !nowInactive && !(wasInactive && patch.status === undefined)) {
            const t = newTimes();
            patch.startAt = t.start;
            patch.endAt = t.end;
            patch.remindersSent = this.passedReminders(p.config, t.start);
            // Una por confirmar sigue por confirmar (sin calendario hasta aprobarla).
            if (patch.status === undefined) patch.status = appt.status === 'pending' ? 'pending' : 'rescheduled';
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
        await this.afterChange(p, row, staff, event, { base, names, previous: appt, byTeam: true }).done;
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
