import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Inject,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Optional,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    createFormSchema,
    formStatEventsSchema,
    saveFormDraftSchema,
    submitFormSchema,
    updateFormSchema,
    type CaptchaAvailability,
    type CreateFormInput,
    type FormDataConsentAvailability,
    type FormDto,
    type FormStatEventsInput,
    type FormStatsDto,
    type FormUploadResult,
    type PublicFormDraft,
    type SaveFormDraftInput,
    type SaveFormDraftResult,
    type PublicFormMeta,
    type SubmitFormInput,
    type SubmitFormResult,
    type UpdateFormInput,
    DEFAULT_PUBLIC_THEME,
    buildPublicThemeCss,
    publicThemeView,
} from '@imagina-base/shared';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ListsService } from '../lists/lists.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DataConsentService } from '../data-consent/data-consent.service';
import { CaptchaService } from './captcha.service';
import {
    FORM_EMBED_JS,
    formFrameAncestors,
    formMissingBuildPage,
    formPageCsp,
    cacheablePageCsp,
    inlineScriptHash,
    loadFormClient,
    newNonce,
    renderFormNoticePage,
    renderFormPage,
} from './form-page';
import { FormsService, type ConfirmOutcome, type FormPageInfo } from './forms.service';
import { PublicBusyError } from '../public-cache/public-cache';
import { PUBLIC_PAGE_CACHE_CONTROL, busyPage, precompress, sendPrecompressed, type Precompressed } from '../public-cache/public-send';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { aclOf } from '../tenancy/acl-of';

/**
 * v0.1.275 (ADR-S39) — Formularios de una lista. Armarlos es de quien arma
 * la lista (`manage_lists`); verlos también de quien arma automatizaciones
 * (el disparador «Cuando se envía un formulario» los elige de esta lista).
 */
@PlanModule('forms')
@Controller('lists/:list/forms')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class FormsController {
    constructor(
        private readonly forms: FormsService,
        private readonly lists: ListsService,
        private readonly audit: AuditService,
        private readonly captcha: CaptchaService,
        @Optional() private readonly dataConsent?: DataConsentService,
    ) {}

    /**
     * v0.1.360 — Los formularios publicados que aceptan enlaces para
     * actualizar un registro (la ficha los ofrece). Lo ve quien puede editar
     * registros: es quien va a mandar el enlace.
     */
    @Get('edit-links')
    @RequireCapability('edit_records', 'edit_own_records')
    async editLinkForms(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: Array<{ id: number; name: string; title: string; days: number }> }> {
        return { data: await this.forms.editLinkForms(req.tenant!.tenantId, list) };
    }

    /** v0.1.360 — El enlace para que alguien actualice ESTE registro con el formulario. */
    @Post(':id/edit-link')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    async editLink(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(z.object({ record_id: z.number().int().positive() }))) body: { record_id: number },
    ): Promise<{ url: string; expires_at: string }> {
        return this.forms.createEditLink(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) }, list, id, body.record_id);
    }

    @Get()
    @RequireCapability('manage_forms', 'manage_automations')
    async list(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: FormDto[] }> {
        return { data: await this.forms.list(req.tenant!.tenantId, list) };
    }

    /**
     * v0.1.289 — ¿Se puede pedir captcha en los formularios de esta empresa?
     * (llaves de la empresa o de la plataforma; sin llaves, el constructor
     * muestra la opción deshabilitada con el motivo).
     */
    @Get('captcha')
    @RequireCapability('manage_forms')
    captchaAvailability(@Req() req: FastifyRequest): Promise<CaptchaAvailability> {
        return this.captcha.availability(req.tenant!.tenantId, req.tenant!.role);
    }

    /**
     * ¿Los formularios de esta empresa piden la autorización de tratamiento de
     * datos (Ley 1581)? El texto vigente, para la vista previa del constructor.
     */
    @Get('data-consent')
    @RequireCapability('manage_forms')
    async dataConsentAvailability(@Req() req: FastifyRequest): Promise<FormDataConsentAvailability> {
        if (!this.dataConsent) return { active: false, consent: null, can_configure: req.tenant!.role === 'admin' };
        return this.dataConsent.availabilityForForms(req.tenant!.tenantId, req.tenant!.role);
    }

    /**
     * v0.1.358 — Estadísticas de un formulario: visitas, empezados, enviados,
     * hasta dónde llegan, dónde lo dejan, de dónde vienen y el dispositivo.
     */
    @Get(':id/stats')
    @RequireCapability('manage_forms')
    stats(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Query('days') days?: string,
    ): Promise<FormStatsDto> {
        const n = Number(days);
        const range = n === 7 || n === 90 ? n : 30;
        return this.forms.statsFor(req.tenant!.tenantId, list, id, range);
    }

    @Get(':id')
    @RequireCapability('manage_forms', 'manage_automations')
    get(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<FormDto> {
        return this.forms.get(req.tenant!.tenantId, list, id);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_forms')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createFormSchema)) input: CreateFormInput,
    ): Promise<FormDto> {
        return this.forms.create(req.tenant!.tenantId, req.authUserId!, list, input, { isAdmin: req.tenant!.role === 'admin' });
    }

    @Patch(':id')
    @RequireCapability('manage_forms')
    async update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateFormSchema)) input: UpdateFormInput,
    ): Promise<FormDto> {
        const tenantId = req.tenant!.tenantId;
        const before =
            input.enabled !== undefined || input.regenerate_token || input.config !== undefined ? await this.forms.get(tenantId, list, id) : null;
        const doc = await this.forms.update(tenantId, list, id, input, { isAdmin: req.tenant!.role === 'admin' });
        // v0.1.289 — prender o apagar la verificación anti-robots queda en la bitácora.
        if (before && before.config.settings.captcha !== doc.config.settings.captcha) {
            await this.audit.log({
                tenantId,
                userId: req.authUserId ?? null,
                action: doc.config.settings.captcha ? 'form.captcha_on' : 'form.captcha_off',
                targetType: 'form',
                targetLabel: doc.name,
                meta: { list, form_id: doc.id },
            });
        }
        // Publicar deja que cualquiera con el enlace escriba en la lista: es de
        // lo que importa poder auditar después (igual que la lista pública).
        if (before && (before.enabled !== doc.enabled || input.regenerate_token)) {
            await this.audit.log({
                tenantId,
                userId: req.authUserId ?? null,
                action: input.regenerate_token ? 'form.regenerate_link' : doc.enabled ? 'form.publish' : 'form.unpublish',
                targetType: 'form',
                targetLabel: doc.name,
                meta: { list, form_id: doc.id },
            });
        }
        return doc;
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_forms')
    async remove(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<void> {
        const { name } = await this.forms.remove(req.tenant!.tenantId, list, id);
        await this.audit.log({
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId ?? null,
            action: 'form.delete',
            targetType: 'form',
            targetLabel: name,
            meta: { list, form_id: id },
        });
    }
}

/**
 * Endpoints PÚBLICOS del formulario: sin sesión ni empresa. El token opaco
 * es la credencial; uno desconocido o sin publicar es un 404 opaco.
 */
@Controller('public/forms')
export class PublicFormsController {
    constructor(private readonly forms: FormsService) {}

    @Get(':token')
    meta(@Param('token') token: string): Promise<PublicFormMeta> {
        return this.forms.meta(token);
    }

    /**
     * v0.1.352 (ADR-S95) — El sello anti-robots: la página lo pide cuando el
     * visitante empieza a completarla. Nunca se guarda en caché (cada uno tiene
     * la hora en que se pidió).
     */
    @Get(':token/stamp')
    async stamp(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        try {
            const out = await this.forms.stamp(token);
            reply.header('Cache-Control', 'no-store').send(out);
        } catch (err) {
            if (err instanceof PublicBusyError) {
                reply.status(503).header('Retry-After', '3').header('Cache-Control', 'no-store').send({ code: 'public_busy', message: 'Hay muchas visitas en este momento. Prueba de nuevo en unos segundos.' });
                return;
            }
            throw err;
        }
    }

    /**
     * v0.1.358 — Lo que la página cuenta (lo vieron, empezaron, llegaron a un
     * paso, lo dejaron). Siempre 204: a quien prueba no se le dice nada, y un
     * evento que no se pudo contar no le cuesta nada a nadie.
     */
    @Post(':token/events')
    @HttpCode(204)
    async events(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(formStatEventsSchema)) input: FormStatEventsInput,
    ): Promise<void> {
        await this.forms.recordEvents(token, req.ip, input);
    }

    /** v0.1.358 — «Guardar y seguir después»: guarda el avance y manda el enlace al correo. */
    @Post(':token/drafts')
    @HttpCode(200)
    saveDraft(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(saveFormDraftSchema)) input: SaveFormDraftInput,
    ): Promise<SaveFormDraftResult> {
        return this.forms.saveDraft(token, req.ip, input);
    }

    /**
     * v0.1.360 — Lo que un registro tiene hoy en las preguntas del formulario,
     * para el enlace «actualizar mis datos» (nunca en caché: son datos de alguien).
     */
    @Get(':token/edit/:code')
    async loadEdit(@Param('token') token: string, @Param('code') code: string, @Res() reply: FastifyReply): Promise<void> {
        const out = await this.forms.loadEdit(token, code);
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').send(out);
    }

    /** v0.1.358 — El avance de un enlace «seguir después» (nunca en caché: son respuestas de alguien). */
    @Get(':token/drafts/:code')
    async loadDraft(@Param('token') token: string, @Param('code') code: string, @Res() reply: FastifyReply): Promise<void> {
        const out: PublicFormDraft = await this.forms.loadDraft(token, code);
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').send(out);
    }

    @Post(':token/submit')
    @HttpCode(200)
    submit(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(submitFormSchema)) input: SubmitFormInput,
    ): Promise<SubmitFormResult> {
        // El navegador queda en la evidencia de la autorización de datos (Ley 1581).
        const ua = req.headers['user-agent'];
        return this.forms.submit(token, req.ip, input, { userAgent: typeof ua === 'string' ? ua : null });
    }

    /**
     * Sube un archivo a una pregunta (`?field=<id del campo>`). Exige el sello
     * de la página en `X-Form-Stamp`: sin haber cargado el formulario no se
     * sube nada.
     */
    @Post(':token/files')
    @HttpCode(201)
    async upload(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Query('field') field?: string,
    ): Promise<FormUploadResult> {
        const rawStamp = req.headers['x-form-stamp'];
        const stamp = String(Array.isArray(rawStamp) ? rawStamp[0] : (rawStamp ?? ''));
        const part = await req.file();
        if (!part) {
            throw new BadRequestException({ code: 'missing_file', message: 'Falta el archivo', data: { status: 400 } });
        }
        return this.forms.upload(
            token,
            req.ip,
            { stamp, field: String(field ?? '') },
            { filename: part.filename, mimetype: part.mimetype, file: part.file },
        );
    }
}

/**
 * La página HTML del formulario (`/api/v1/public/f/:token`) y la vista previa
 * del constructor (`/api/v1/public/f/preview`, que sólo se puede insertar en
 * la propia app y recibe el diseño por postMessage — no lee nada).
 */
@Controller('public/f')
export class PublicFormPageController {
    /** La página armada por cada `FormPageInfo` de la caché (se va con él). */
    private readonly renderedPages = new WeakMap<FormPageInfo, RenderedPage>();
    private hashFor: string | null = null;
    private hash = '';

    constructor(
        private readonly forms: FormsService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    @Get('preview')
    preview(@Res() reply: FastifyReply): void {
        const nonce = newNonce();
        const client = this.formClient();
        if (client === undefined) {
            reply.status(503).header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(formMissingBuildPage());
            return;
        }
        // La vista previa arranca con el diseño clásico; el editor manda el
        // CSS del tema que se está diseñando por postMessage.
        const look = classicLook();
        reply
            .header('Content-Security-Policy', formPageCsp(nonce, "'self'", null, { dev: client === null }))
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', 'no-store')
            .type('text/html; charset=utf-8')
            .send(renderFormPage({ nonce, title: 'Vista previa', meta: null, token: 'preview', themeCss: look.css, bodyClasses: look.classes, preloadFont: null, client }));
    }

    /**
     * v0.1.351 — El script del formulario: el compilado (en producción o con
     * `WEB_DIST_DIR`) para servir en línea; `null` = desarrollo (el módulo de
     * vite); `undefined` = producción SIN el build (instalación rota).
     */
    private formClient(): string | null | undefined {
        const useBuild = this.env.NODE_ENV === 'production' || this.env.WEB_DIST_DIR.trim() !== '';
        if (!useBuild) return null;
        return loadFormClient(this.env.WEB_DIST_DIR) ?? undefined;
    }

    /**
     * v0.1.352 — El script que pegan los sitios. Lo pide CADA visita de cada
     * página donde está insertado, así que va comprimido de antemano, con ETag
     * (el navegador revalida con un 304 sin bajarlo de nuevo) y con una hora de
     * caché más un día de `stale-while-revalidate`.
     */
    @Get('embed.js')
    embedScript(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
        reply
            .header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
            .header('Cross-Origin-Resource-Policy', 'cross-origin')
            .header('X-Content-Type-Options', 'nosniff');
        sendPrecompressed(req, reply, embedScriptBody(), 'application/javascript; charset=utf-8');
    }

    /**
     * v0.1.289 — El enlace del correo de confirmación (doble opt-in). NO
     * confirma: los escáneres de correo abren los enlaces con GET para
     * revisarlos y confirmarían solos. Devuelve una página que se envía sola
     * por POST (con un botón si no hay JavaScript).
     */
    @Get('confirm/:token')
    async confirmLanding(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        const nonce = newNonce();
        const peek = await this.forms.peekConfirmation(token);
        const html = peek.ok
            ? renderFormNoticePage({
                  nonce,
                  brand: peek.brand ?? NEUTRAL_BRAND,
                  title: 'Confirmando tu respuesta…',
                  message: 'Un momento: estamos guardando tu respuesta.',
                  tone: 'info',
                  confirmAction: `/api/v1/public/f/confirm/${encodeURIComponent(token)}`,
              })
            : renderFormNoticePage({
                  nonce,
                  brand: NEUTRAL_BRAND,
                  title: 'Este enlace ya no sirve',
                  message: 'Ya se usó o venció (vale 48 horas). Si ya lo abriste antes, tu respuesta quedó registrada; si no, vuelve a completar el formulario.',
                  tone: 'error',
              });
        this.sendNotice(reply, nonce, html, peek.ok ? 200 : 404);
    }

    @Post('confirm/:token')
    async confirm(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        const nonce = newNonce();
        const out: ConfirmOutcome = await this.forms.confirm(token);
        const html = renderFormNoticePage({
            nonce,
            brand: out.brand ?? NEUTRAL_BRAND,
            title: out.title,
            message: out.message,
            tone: out.status === 'confirmed' ? 'ok' : out.status === 'closed' ? 'info' : 'error',
            continueUrl: out.continueUrl,
        });
        this.sendNotice(reply, nonce, html, out.status === 'confirmed' ? 200 : out.status === 'invalid' ? 404 : out.status === 'closed' ? 410 : 503);
    }

    private sendNotice(reply: FastifyReply, nonce: string, html: string, status: number): void {
        reply
            .status(status)
            .header('Content-Security-Policy', formPageCsp(nonce, "'none'"))
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', 'no-store')
            // El token va en la ruta: que no se filtre a la página de destino.
            .header('Referrer-Policy', 'no-referrer')
            .type('text/html; charset=utf-8')
            .send(html);
    }

    /**
     * v0.1.352 (ADR-S95) — La página del formulario. Se arma UNA vez (y se
     * comprime una vez) y vale medio minuto para todas las visitas: no lleva
     * nada personal ni el sello anti-robots (lo pide el visitante al empezar a
     * completarla), así que el navegador o una CDN la pueden guardar, y la
     * siguiente visita del mismo navegador recibe un 304 de pocos bytes.
     */
    @Get(':token')
    async page(@Req() req: FastifyRequest, @Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        let info: FormPageInfo | null;
        try {
            info = await this.forms.cachedPageInfo(token);
        } catch (err) {
            if (err instanceof PublicBusyError) return sendBusy(reply);
            throw err;
        }
        if (!info) {
            // Lo que no existe también se guarda un rato: una dirección inventada
            // que piden mil veces no llega mil veces al servidor.
            reply
                .status(404)
                .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *")
                .header('X-Robots-Tag', 'noindex')
                .header('Cache-Control', 'public, max-age=30')
                .type('text/html; charset=utf-8')
                .send(notAvailablePage());
            return;
        }
        const client = this.formClient();
        if (client === undefined) {
            reply.status(503).header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(formMissingBuildPage());
            return;
        }
        const page = this.rendered(info, token, client);
        reply
            .header('Content-Security-Policy', page.csp)
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
            .header('Referrer-Policy', 'strict-origin-when-cross-origin');
        sendPrecompressed(req, reply, page.body, 'text/html; charset=utf-8');
    }

    /** La página lista y comprimida para un `FormPageInfo` (que vale mientras está en la caché). */
    private rendered(info: FormPageInfo, token: string, client: string | null): RenderedPage {
        const hit = this.renderedPages.get(info);
        if (hit) return hit;
        const html = renderFormPage({
            title: info.title,
            meta: info.meta,
            token,
            themeCss: info.theme_css,
            bodyClasses: info.body_classes,
            preloadFont: info.preload_font,
            client,
        });
        const page: RenderedPage = {
            body: precompress(html),
            // v0.1.289 — con captcha entran a la CSP SÓLO los dominios de ese proveedor.
            csp: cacheablePageCsp(
                client === null ? null : this.clientHash(client),
                formFrameAncestors(info.allowed_domains),
                info.captcha?.provider ?? null,
                { dev: client === null },
            ),
        };
        this.renderedPages.set(info, page);
        return page;
    }

    private clientHash(client: string): string {
        if (this.hashFor !== client) {
            this.hashFor = client;
            this.hash = inlineScriptHash(client);
        }
        return this.hash;
    }
}

/** La página de un formulario ya armada, comprimida y con su CSP. */
let embedBody: Precompressed | null = null;
/** `embed.js` comprimido una sola vez por proceso. */
function embedScriptBody(): Precompressed {
    return (embedBody ??= precompress(FORM_EMBED_JS, { quality: 11 }));
}

interface RenderedPage {
    body: Precompressed;
    csp: string;
}

function sendBusy(reply: FastifyReply): void {
    reply
        .status(503)
        .header('Retry-After', '3')
        .header('Cache-Control', 'no-store')
        .header('X-Robots-Tag', 'noindex')
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *")
        .type('text/html; charset=utf-8')
        .send(busyPage());
}

const NEUTRAL_BRAND = { company: '', accent: '#475467', logoUrl: null };

/** El diseño clásico (para la vista previa antes de que llegue el del editor). */
function classicLook(): { css: string; classes: string[] } {
    return {
        css: buildPublicThemeCss(DEFAULT_PUBLIC_THEME, { accent: '#0e7490' }),
        classes: publicThemeView(DEFAULT_PUBLIC_THEME).classes,
    };
}

function notAvailablePage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Formulario no disponible</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}</style></head>
<body><div><h1>Este formulario no está disponible</h1><p>Puede que la dirección esté mal escrita o que ya no reciba respuestas.</p></div></body></html>`;
}
