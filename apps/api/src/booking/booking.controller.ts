import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    connectMyAgendaCalendarSchema,
    updateMyAgendaCalendarSchema,
    type AgendaCalendarItem,
    type ConnectMyAgendaCalendarInput,
    type MyAgendaCalendarDto,
    type UpdateMyAgendaCalendarInput,
    bookAppointmentSchema,
    bookingPreviewSlotsSchema,
    bookingSlotsQuerySchema,
    cancelAppointmentSchema,
    createBookingPageSchema,
    decideBookingSchema,
    requestBookingCodeSchema,
    verifyBookingCodeSchema,
    type DecideBookingInput,
    type RecordBookingDto,
    type RequestBookingCodeInput,
    type VerifyBookingCodeInput,
    rescheduleAppointmentSchema,
    updateBookingPageSchema,
    type BookAppointmentInput,
    type BookAppointmentResult,
    type BookingPageDto,
    type BookingPreviewSlotsInput,
    type BookingSlotsQuery,
    type CancelAppointmentInput,
    type CreateBookingPageInput,
    type HolidayItem,
    type PublicAppointmentSummary,
    type PublicBookingMeta,
    type PublicBookingSlots,
    type PublicManageMeta,
    type RescheduleAppointmentInput,
    type UpdateBookingPageInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { cacheablePageCsp, formFrameAncestors, formPageCsp, newNonce } from '../forms/form-page';
import { PublicBusyError } from '../public-cache/public-cache';
import { PUBLIC_PAGE_CACHE_CONTROL, busyPage, precompress, sendPrecompressed, type Precompressed } from '../public-cache/public-send';
import { TenantGuard } from '../tenancy/tenant.guard';
import { appointmentNotFoundPage, bookingClassicLook, bookingClientHash, bookingNotAvailablePage, renderBookingPage } from './booking-page';
import { BookingPublicService, type CachedBookingPage } from './booking-public.service';
import { BookingService, type BookingEditorOptions } from './booking.service';
import { BookingMyCalendarService } from './booking-my-calendar.service';
import { ForbiddenException } from '@nestjs/common';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { aclOf } from '../tenancy/acl-of';
import type { Actor } from '../records/records.service';

/**
 * D5 — Páginas de agenda de una lista (Ajustes de la lista → Agenda).
 * Armarlas es de quien arma la lista (`manage_lists`); verlas también de quien
 * arma automatizaciones (el disparador «Cuando se agenda…» las elige).
 */
@PlanModule('booking')
@Controller('lists/:list/booking-pages')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class BookingController {
    constructor(
        private readonly booking: BookingService,
        private readonly publicSvc: BookingPublicService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @RequireCapability('manage_lists', 'manage_automations')
    async list(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: BookingPageDto[] }> {
        return { data: await this.booking.list(req.tenant!.tenantId, list) };
    }

    /** Quién puede atender, los calendarios conectados y la zona de la empresa. */
    @Get('options')
    @RequireCapability('manage_lists')
    options(@Req() req: FastifyRequest, @Param('list') list: string): Promise<BookingEditorOptions> {
        return this.booking.editorOptions(req.tenant!.tenantId, list);
    }

    /**
     * v0.1.350 — Los calendarios de una conexión de la EMPRESA (para elegir en
     * cuáles mira lo ocupado una persona). Una privada de otra persona no se
     * lista: sus calendarios son suyos.
     */
    @Get('calendars/:connectionId')
    @RequireCapability('manage_lists')
    calendars(@Req() req: FastifyRequest, @Param('connectionId', ParseIntPipe) connectionId: number): Promise<{ data: AgendaCalendarItem[] }> {
        return this.booking.connectionCalendars(req.tenant!.tenantId, connectionId).then((data) => ({ data }));
    }

    /** v0.1.349 — Los festivos de un país y un año (para marcar los que sí se atienden). */
    @Get('holidays')
    @RequireCapability('manage_lists')
    holidays(@Query('country') country: string | undefined, @Query('year') year: string | undefined): Promise<{ country: string; items: HolidayItem[]; available: boolean }> {
        const y = Number(year);
        return this.booking.holidayList(String(country ?? ''), Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getUTCFullYear());
    }

    @Get(':id')
    @RequireCapability('manage_lists', 'manage_automations')
    get(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<BookingPageDto> {
        return this.booking.get(req.tenant!.tenantId, list, id);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_lists')
    async create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createBookingPageSchema)) input: CreateBookingPageInput,
    ): Promise<BookingPageDto> {
        const doc = await this.booking.create(req.tenant!.tenantId, req.authUserId!, list, input, { isAdmin: req.tenant!.role === 'admin' });
        this.publicSvc.forgetLists(req.tenant!.tenantId);
        return doc;
    }

    @Patch(':id')
    @RequireCapability('manage_lists')
    async update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateBookingPageSchema)) input: UpdateBookingPageInput,
    ): Promise<BookingPageDto> {
        const tenantId = req.tenant!.tenantId;
        const before = input.enabled !== undefined || input.regenerate_token ? await this.booking.get(tenantId, list, id) : null;
        const doc = await this.booking.update(tenantId, list, id, input, { isAdmin: req.tenant!.role === 'admin' });
        // Publicar deja que cualquiera con el enlace agende en la lista: queda en
        // la bitácora (igual que los formularios y la lista pública).
        if (before && (before.enabled !== doc.enabled || input.regenerate_token)) {
            await this.audit.log({
                tenantId,
                userId: req.authUserId ?? null,
                action: input.regenerate_token ? 'booking.regenerate_link' : doc.enabled ? 'booking.publish' : 'booking.unpublish',
                targetType: 'booking_page',
                targetLabel: doc.name,
                meta: { list, booking_page_id: doc.id },
            });
        }
        return doc;
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_lists')
    async remove(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<void> {
        const { name } = await this.booking.remove(req.tenant!.tenantId, list, id);
        this.publicSvc.forgetLists(req.tenant!.tenantId);
        await this.audit.log({
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId ?? null,
            action: 'booking.delete',
            targetType: 'booking_page',
            targetLabel: name,
            meta: { list, booking_page_id: id },
        });
    }

    /** Vista previa del constructor: horarios con la configuración EN EDICIÓN. */
    @Post(':id/preview-slots')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    previewSlots(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(bookingPreviewSlotsSchema)) input: BookingPreviewSlotsInput,
    ): Promise<PublicBookingSlots> {
        return this.booking.previewSlots(req.tenant!.tenantId, list, id, input);
    }
}

function userAgent(req: FastifyRequest): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
}

/**
 * Endpoints PÚBLICOS de la agenda: sin sesión ni empresa. El token de la
 * página (o la referencia firmada de una cita) es la credencial; uno
 * desconocido, alterado o sin publicar es el mismo 404.
 */
@Controller('public/booking')
export class PublicBookingController {
    constructor(private readonly svc: BookingPublicService) {}

    // La gestión de una cita va ANTES que `:token`: es un segmento fijo.
    @Get('manage/:ref')
    manageMeta(@Param('ref') ref: string): Promise<PublicManageMeta> {
        return this.svc.manageMeta(ref);
    }

    @Get('manage/:ref/slots')
    manageSlots(
        @Req() req: FastifyRequest,
        @Param('ref') ref: string,
        @Query(new ZodValidationPipe(bookingSlotsQuerySchema)) q: BookingSlotsQuery,
    ): Promise<PublicBookingSlots> {
        return this.svc.manageSlots(ref, req.ip, q);
    }

    @Post('manage/:ref/cancel')
    @HttpCode(200)
    cancel(
        @Req() req: FastifyRequest,
        @Param('ref') ref: string,
        @Body(new ZodValidationPipe(cancelAppointmentSchema)) input: CancelAppointmentInput,
    ): Promise<PublicAppointmentSummary> {
        return this.svc.cancel(ref, req.ip, input);
    }

    @Post('manage/:ref/reschedule')
    @HttpCode(200)
    reschedule(
        @Req() req: FastifyRequest,
        @Param('ref') ref: string,
        @Body(new ZodValidationPipe(rescheduleAppointmentSchema)) input: RescheduleAppointmentInput,
    ): Promise<PublicAppointmentSummary> {
        return this.svc.reschedule(ref, req.ip, input);
    }

    /** «Agregar a mi calendario»: el .ics de la cita, siempre al día. */
    @Get('manage/:ref/ics')
    async ics(@Param('ref') ref: string, @Res() reply: FastifyReply): Promise<void> {
        const { filename, body } = await this.svc.ics(ref);
        reply
            .header('Cache-Control', 'no-store')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .header('X-Content-Type-Options', 'nosniff')
            .header('Referrer-Policy', 'no-referrer')
            .type('text/calendar; charset=utf-8')
            .send(body);
    }

    @Get(':token')
    meta(@Param('token') token: string): Promise<PublicBookingMeta> {
        return this.svc.meta(token);
    }

    /** v0.1.352 — El sello anti-robots, a pedido (la página ya no lo trae). Nunca se guarda en caché. */
    @Get(':token/stamp')
    async stamp(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        try {
            reply.header('Cache-Control', 'no-store').send(await this.svc.stamp(token));
        } catch (err) {
            if (err instanceof PublicBusyError) {
                reply.status(503).header('Retry-After', '3').header('Cache-Control', 'no-store').send({ code: 'public_busy', message: 'Hay muchas visitas en este momento. Prueba de nuevo en unos segundos.' });
                return;
            }
            throw err;
        }
    }

    /** v0.1.353 — Manda el código de 6 dígitos al correo (si la página lo pide). */
    @Post(':token/code')
    @HttpCode(200)
    requestCode(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(requestBookingCodeSchema)) input: RequestBookingCodeInput,
    ): Promise<{ ok: true; minutes: number }> {
        return this.svc.requestCode(token, req.ip, input);
    }

    /** v0.1.353 — Comprueba el código: devuelve la prueba que pide la reserva. */
    @Post(':token/verify-code')
    @HttpCode(200)
    verifyCode(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(verifyBookingCodeSchema)) input: VerifyBookingCodeInput,
    ): Promise<{ ok: true; proof: string }> {
        return this.svc.verifyCode(token, req.ip, input);
    }

    @Get(':token/slots')
    slots(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Query(new ZodValidationPipe(bookingSlotsQuerySchema)) q: BookingSlotsQuery,
    ): Promise<PublicBookingSlots> {
        return this.svc.slots(token, req.ip, q);
    }

    @Post(':token/book')
    @HttpCode(200)
    book(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(bookAppointmentSchema)) input: BookAppointmentInput,
    ): Promise<BookAppointmentResult> {
        return this.svc.book(token, req.ip, input, { userAgent: userAgent(req) });
    }
}

/**
 * Las páginas HTML: la agenda (`/api/v1/public/b/:token`), la gestión de una
 * cita (`/api/v1/public/b/manage/:ref`) y la vista previa del constructor
 * (`/api/v1/public/b/preview`, que sólo se inserta en la propia app y recibe
 * la configuración por postMessage).
 */
@Controller('public/b')
export class PublicBookingPageController {
    /** La página armada por cada agenda en caché (se va con ella). */
    private readonly renderedPages = new WeakMap<CachedBookingPage, { body: Precompressed; csp: string }>();

    constructor(private readonly svc: BookingPublicService) {}

    @Get('preview')
    preview(@Res() reply: FastifyReply): void {
        const nonce = newNonce();
        const classic = bookingClassicLook();
        reply
            .header('Content-Security-Policy', formPageCsp(nonce, "'self'"))
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', 'no-store')
            .type('text/html; charset=utf-8')
            // La vista previa arranca con el diseño de siempre; el editor manda
            // el CSS del tema que se está diseñando por postMessage.
            .send(
                renderBookingPage({
                    nonce,
                    title: 'Vista previa',
                    boot: { mode: 'preview', token: 'preview', meta: null, manage: null },
                    themeCss: classic.css,
                    bodyClasses: classic.classes,
                }),
            );
    }

    @Get('manage/:ref')
    async manage(@Param('ref') ref: string, @Query('accion') accion: string | undefined, @Res() reply: FastifyReply): Promise<void> {
        const info = await this.svc.managePage(ref);
        const nonce = newNonce();
        if (!info) {
            reply
                .status(404)
                .header('Content-Security-Policy', formPageCsp(nonce, "'none'"))
                .header('X-Robots-Tag', 'noindex')
                .header('Referrer-Policy', 'no-referrer')
                .type('text/html; charset=utf-8')
                .send(appointmentNotFoundPage());
            return;
        }
        reply
            .header('Content-Security-Policy', formPageCsp(nonce, formFrameAncestors(info.allowed_domains)))
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', 'no-store')
            // La referencia firmada va en la ruta: que no se filtre a otros sitios.
            .header('Referrer-Policy', 'no-referrer')
            .type('text/html; charset=utf-8')
            .send(
                renderBookingPage({
                    nonce,
                    title: info.meta.booking.title,
                    boot: { mode: 'manage', token: ref, meta: null, manage: info.meta, action: accion === 'cancelar' ? 'cancel' : null },
                    themeCss: info.look.css,
                    bodyClasses: info.look.classes,
                    preloadFont: info.look.preload,
                }),
            );
    }

    /**
     * v0.1.352 (ADR-S95) — La página de reservar: armada y comprimida UNA vez,
     * vale medio minuto para todas las visitas (no lleva nada personal ni el
     * sello anti-robots, que se pide al empezar). El navegador o una CDN la
     * pueden guardar; la siguiente visita del mismo navegador recibe un 304.
     */
    @Get(':token')
    async page(@Req() req: FastifyRequest, @Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        let cached: CachedBookingPage | null;
        try {
            cached = await this.svc.cachedPage(token);
        } catch (err) {
            if (err instanceof PublicBusyError) {
                reply
                    .status(503)
                    .header('Retry-After', '3')
                    .header('Cache-Control', 'no-store')
                    .header('X-Robots-Tag', 'noindex')
                    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *")
                    .type('text/html; charset=utf-8')
                    .send(busyPage());
                return;
            }
            throw err;
        }
        if (!cached) {
            reply
                .status(404)
                .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *")
                .header('X-Robots-Tag', 'noindex')
                .header('Cache-Control', 'public, max-age=30')
                .type('text/html; charset=utf-8')
                .send(bookingNotAvailablePage());
            return;
        }
        const page = this.rendered(cached, token);
        reply
            .header('Content-Security-Policy', page.csp)
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
            .header('Referrer-Policy', 'strict-origin-when-cross-origin');
        sendPrecompressed(req, reply, page.body, 'text/html; charset=utf-8');
    }

    private rendered(cached: CachedBookingPage, token: string): { body: Precompressed; csp: string } {
        const hit = this.renderedPages.get(cached);
        if (hit) return hit;
        const { info } = cached;
        const page = {
            body: precompress(
                renderBookingPage({
                    title: info.title,
                    boot: { mode: 'book', token, meta: info.meta, manage: null },
                    themeCss: info.look.css,
                    bodyClasses: info.look.classes,
                    preloadFont: info.look.preload,
                }),
            ),
            csp: cacheablePageCsp(bookingClientHash(), formFrameAncestors(info.allowed_domains), info.meta.captcha?.provider ?? null),
        };
        this.renderedPages.set(cached, page);
        return page;
    }
}

/**
 * v0.1.350 — «Mi calendario» (Ajustes → Cuenta): cada persona del equipo
 * conecta su propio Google Calendar u Outlook para sus citas y elige sus
 * calendarios. Mientras se ve la app como otra persona no se conecta nada (se
 * vincularía la cuenta de Google de quien mira).
 */
/**
 * v0.1.353 — La cita de un registro (el panel de la ficha) y aprobar o
 * rechazar una por confirmar. Ver: el ACL del registro. Decidir: además, ser
 * de quienes aprueban en esa agenda (lo exige el service).
 */
@PlanModule('booking')
@Controller('lists/:list/records/:id/booking')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordBookingController {
    constructor(
        private readonly publicSvc: BookingPublicService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    async get(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<{ data: RecordBookingDto | null }> {
        return { data: await this.publicSvc.recordBooking(req.tenant!.tenantId, decider(req), list, id) };
    }

    @Post('decide')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    async decide(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(decideBookingSchema)) input: DecideBookingInput,
    ): Promise<{ data: RecordBookingDto }> {
        const out = await this.publicSvc.decide(req.tenant!.tenantId, decider(req), list, id, input);
        await this.audit.log({
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId ?? null,
            action: input.decision === 'approve' ? 'booking.approve' : 'booking.decline',
            targetType: 'record',
            targetId: id,
            targetLabel: `${out.service} · ${out.client_name || out.client_email}`.slice(0, 190),
            meta: { list, appointment_id: out.appointment_id, booking_page_id: out.page_id },
        });
        return { data: out };
    }
}

function decider(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

@PlanModule('booking')
@Controller('me/agenda-calendar')
@UseGuards(SessionGuard, TenantGuard)
export class MyAgendaCalendarController {
    constructor(private readonly mine: BookingMyCalendarService) {}

    private noImpersonation(req: FastifyRequest): void {
        if (req.impersonatedBy !== undefined) {
            throw new ForbiddenException({ code: 'impersonating', message: 'Mientras ves la app como otra persona no se puede conectar ni cambiar su calendario.', data: { status: 403 } });
        }
    }

    @Get()
    get(@Req() req: FastifyRequest): Promise<MyAgendaCalendarDto> {
        return this.mine.get(req.tenant!.tenantId, req.authUserId!);
    }

    @Post('connect')
    @HttpCode(200)
    connect(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(connectMyAgendaCalendarSchema)) input: ConnectMyAgendaCalendarInput): Promise<{ authorize_url: string }> {
        this.noImpersonation(req);
        return this.mine.connect(req.tenant!.tenantId, req.authUserId!, req.tenant!.role, input);
    }

    @Patch()
    update(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(updateMyAgendaCalendarSchema)) input: UpdateMyAgendaCalendarInput): Promise<MyAgendaCalendarDto> {
        this.noImpersonation(req);
        return this.mine.update(req.tenant!.tenantId, req.authUserId!, input);
    }

    @Delete()
    disconnect(@Req() req: FastifyRequest): Promise<MyAgendaCalendarDto> {
        this.noImpersonation(req);
        return this.mine.disconnect(req.tenant!.tenantId, req.authUserId!, req.tenant!.role);
    }
}
