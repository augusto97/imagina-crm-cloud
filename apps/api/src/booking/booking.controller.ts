import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    bookAppointmentSchema,
    bookingPreviewSlotsSchema,
    bookingSlotsQuerySchema,
    cancelAppointmentSchema,
    createBookingPageSchema,
    rescheduleAppointmentSchema,
    updateBookingPageSchema,
    type BookAppointmentInput,
    type BookAppointmentResult,
    type BookingPageDto,
    type BookingPreviewSlotsInput,
    type BookingSlotsQuery,
    type CancelAppointmentInput,
    type CreateBookingPageInput,
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
import { formFrameAncestors, formPageCsp, newNonce } from '../forms/form-page';
import { TenantGuard } from '../tenancy/tenant.guard';
import { appointmentNotFoundPage, bookingNotAvailablePage, renderBookingPage } from './booking-page';
import { BookingPublicService } from './booking-public.service';
import { BookingService, type BookingEditorOptions } from './booking.service';

/**
 * D5 — Páginas de agenda de una lista (Ajustes de la lista → Agenda).
 * Armarlas es de quien arma la lista (`manage_lists`); verlas también de quien
 * arma automatizaciones (el disparador «Cuando se agenda…» las elige).
 */
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
        const doc = await this.booking.create(req.tenant!.tenantId, req.authUserId!, list, input);
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
        const doc = await this.booking.update(tenantId, list, id, input);
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
    constructor(private readonly svc: BookingPublicService) {}

    @Get('preview')
    preview(@Res() reply: FastifyReply): void {
        const nonce = newNonce();
        reply
            .header('Content-Security-Policy', formPageCsp(nonce, "'self'"))
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', 'no-store')
            .type('text/html; charset=utf-8')
            .send(renderBookingPage({ nonce, title: 'Vista previa', boot: { mode: 'preview', token: 'preview', meta: null, manage: null } }));
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
                }),
            );
    }

    @Get(':token')
    async page(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        const info = await this.svc.pageInfo(token);
        const nonce = newNonce();
        if (!info) {
            reply
                .status(404)
                .header('Content-Security-Policy', formPageCsp(nonce, '*'))
                .header('X-Robots-Tag', 'noindex')
                .type('text/html; charset=utf-8')
                .send(bookingNotAvailablePage());
            return;
        }
        reply
            .header('Content-Security-Policy', formPageCsp(nonce, formFrameAncestors(info.allowed_domains), info.meta.captcha?.provider ?? null))
            .header('X-Robots-Tag', 'noindex')
            // El sello anti-robots viaja en la página: nunca se cachea.
            .header('Cache-Control', 'no-store')
            .header('Referrer-Policy', 'strict-origin-when-cross-origin')
            .type('text/html; charset=utf-8')
            .send(renderBookingPage({ nonce, title: info.title, boot: { mode: 'book', token, meta: info.meta, manage: null } }));
    }
}
