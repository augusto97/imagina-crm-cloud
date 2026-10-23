import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
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
    submitFormSchema,
    updateFormSchema,
    type CaptchaAvailability,
    type CreateFormInput,
    type FormDataConsentAvailability,
    type FormDto,
    type FormUploadResult,
    type PublicFormMeta,
    type SubmitFormInput,
    type SubmitFormResult,
    type UpdateFormInput,
} from '@imagina-base/shared';
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
import { FORM_EMBED_JS, formFrameAncestors, formPageCsp, newNonce, renderFormNoticePage, renderFormPage } from './form-page';
import { FormsService, type ConfirmOutcome } from './forms.service';

/**
 * v0.1.275 (ADR-S39) — Formularios de una lista. Armarlos es de quien arma
 * la lista (`manage_lists`); verlos también de quien arma automatizaciones
 * (el disparador «Cuando se envía un formulario» los elige de esta lista).
 */
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

    @Get()
    @RequireCapability('manage_lists', 'manage_automations')
    async list(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: FormDto[] }> {
        return { data: await this.forms.list(req.tenant!.tenantId, list) };
    }

    /**
     * v0.1.289 — ¿Se puede pedir captcha en los formularios de esta empresa?
     * (llaves de la empresa o de la plataforma; sin llaves, el constructor
     * muestra la opción deshabilitada con el motivo).
     */
    @Get('captcha')
    @RequireCapability('manage_lists')
    captchaAvailability(@Req() req: FastifyRequest): Promise<CaptchaAvailability> {
        return this.captcha.availability(req.tenant!.tenantId, req.tenant!.role);
    }

    /**
     * ¿Los formularios de esta empresa piden la autorización de tratamiento de
     * datos (Ley 1581)? El texto vigente, para la vista previa del constructor.
     */
    @Get('data-consent')
    @RequireCapability('manage_lists')
    async dataConsentAvailability(@Req() req: FastifyRequest): Promise<FormDataConsentAvailability> {
        if (!this.dataConsent) return { active: false, consent: null, can_configure: req.tenant!.role === 'admin' };
        return this.dataConsent.availabilityForForms(req.tenant!.tenantId, req.tenant!.role);
    }

    @Get(':id')
    @RequireCapability('manage_lists', 'manage_automations')
    get(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<FormDto> {
        return this.forms.get(req.tenant!.tenantId, list, id);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_lists')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createFormSchema)) input: CreateFormInput,
    ): Promise<FormDto> {
        return this.forms.create(req.tenant!.tenantId, req.authUserId!, list, input);
    }

    @Patch(':id')
    @RequireCapability('manage_lists')
    async update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateFormSchema)) input: UpdateFormInput,
    ): Promise<FormDto> {
        const tenantId = req.tenant!.tenantId;
        const before =
            input.enabled !== undefined || input.regenerate_token || input.config !== undefined ? await this.forms.get(tenantId, list, id) : null;
        const doc = await this.forms.update(tenantId, list, id, input);
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
    @RequireCapability('manage_lists')
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
    constructor(private readonly forms: FormsService) {}

    @Get('preview')
    preview(@Res() reply: FastifyReply): void {
        const nonce = newNonce();
        reply
            .header('Content-Security-Policy', formPageCsp(nonce, "'self'"))
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', 'no-store')
            .type('text/html; charset=utf-8')
            .send(renderFormPage({ nonce, title: 'Vista previa', meta: null, token: 'preview' }));
    }

    /**
     * Script para insertar el formulario en un sitio: ajusta el alto del marco
     * a su contenido y, si el formulario redirige al enviar, lleva a toda la
     * página. Sólo escucha a los marcos `data-imagina-form` y sólo mensajes
     * que vienen de SU origen.
     */
    @Get('embed.js')
    embedScript(@Res() reply: FastifyReply): void {
        reply
            .header('Cache-Control', 'public, max-age=3600')
            .header('Cross-Origin-Resource-Policy', 'cross-origin')
            .header('X-Content-Type-Options', 'nosniff')
            .type('application/javascript; charset=utf-8')
            .send(FORM_EMBED_JS);
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

    @Get(':token')
    async page(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        const info = await this.forms.pageInfo(token);
        const nonce = newNonce();
        if (!info) {
            reply
                .status(404)
                .header('Content-Security-Policy', formPageCsp(nonce, '*'))
                .header('X-Robots-Tag', 'noindex')
                .type('text/html; charset=utf-8')
                .send(notAvailablePage());
            return;
        }
        reply
            // v0.1.289 — con captcha entran a la CSP SÓLO los dominios de ese proveedor.
            .header('Content-Security-Policy', formPageCsp(nonce, formFrameAncestors(info.allowed_domains), info.captcha?.provider ?? null))
            .header('X-Robots-Tag', 'noindex')
            // El sello anti-robots viaja en la página: nunca se cachea.
            .header('Cache-Control', 'no-store')
            .header('Referrer-Policy', 'strict-origin-when-cross-origin')
            .type('text/html; charset=utf-8')
            .send(renderFormPage({ nonce, title: info.title, meta: info.meta, token }));
    }
}

const NEUTRAL_BRAND = { company: '', accent: '#475467', logoUrl: null };

function notAvailablePage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Formulario no disponible</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}</style></head>
<body><div><h1>Este formulario no está disponible</h1><p>Puede que la dirección esté mal escrita o que ya no reciba respuestas.</p></div></body></html>`;
}
