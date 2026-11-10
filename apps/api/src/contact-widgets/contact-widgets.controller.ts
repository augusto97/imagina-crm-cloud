import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    createContactWidgetSchema,
    updateContactWidgetSchema,
    type ContactWidgetDto,
    type ContactWidgetOptions,
    type CreateContactWidgetInput,
    type UpdateContactWidgetInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { useWebBuild } from '../common/web-build';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { inlineScriptHash, newNonce } from '../forms/form-page';
import { PublicBusyError } from '../public-cache/public-cache';
import { PUBLIC_PAGE_CACHE_CONTROL, precompress, sendPrecompressed, type Precompressed } from '../public-cache/public-send';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ContactWidgetsService, type WidgetPageInfo } from './contact-widgets.service';
import { loadWidgetClient, renderWidgetPage, widgetMissingPage, widgetPageCsp } from './widget-page';

/**
 * v0.1.394 (ADR-S99) — Widgets de contacto de la empresa. Los arma quien
 * arma formularios (`manage_forms`): un widget es otra forma de publicar un
 * formulario en el sitio.
 */
@PlanModule('forms')
@Controller('contact-widgets')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ContactWidgetsController {
    constructor(
        private readonly widgets: ContactWidgetsService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @RequireCapability('manage_forms')
    async list(@Req() req: FastifyRequest): Promise<{ data: ContactWidgetDto[] }> {
        return { data: await this.widgets.list(req.tenant!.tenantId) };
    }

    /** Los formularios y agendas que puede abrir un botón (un pedido, regla de oro nº 8). */
    @Get('options')
    @RequireCapability('manage_forms')
    options(@Req() req: FastifyRequest): Promise<ContactWidgetOptions> {
        return this.widgets.options(req.tenant!.tenantId);
    }

    @Get(':id')
    @RequireCapability('manage_forms')
    get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<ContactWidgetDto> {
        return this.widgets.get(req.tenant!.tenantId, id);
    }

    @Post()
    @RequireCapability('manage_forms')
    async create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createContactWidgetSchema)) input: CreateContactWidgetInput,
    ): Promise<ContactWidgetDto> {
        const tenantId = req.tenant!.tenantId;
        const doc = await this.widgets.create(tenantId, req.authUserId!, input);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'widget.create', targetType: 'widget', targetLabel: doc.name, meta: { widget_id: doc.id } });
        return doc;
    }

    @Patch(':id')
    @RequireCapability('manage_forms')
    async update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateContactWidgetSchema)) input: UpdateContactWidgetInput,
    ): Promise<ContactWidgetDto> {
        const tenantId = req.tenant!.tenantId;
        const { dto, before } = await this.widgets.update(tenantId, id, input);
        if (before.enabled !== dto.enabled) {
            await this.audit.log({
                tenantId,
                userId: req.authUserId ?? null,
                action: dto.enabled ? 'widget.publish' : 'widget.unpublish',
                targetType: 'widget',
                targetLabel: dto.name,
                meta: { widget_id: dto.id },
            });
        }
        return dto;
    }

    /** Otra dirección: el código pegado antes deja de mostrar el widget. */
    @Post(':id/regenerate')
    @RequireCapability('manage_forms')
    async regenerate(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<ContactWidgetDto> {
        const tenantId = req.tenant!.tenantId;
        const dto = await this.widgets.regenerate(tenantId, id);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'widget.regenerate_link', targetType: 'widget', targetLabel: dto.name, meta: { widget_id: dto.id } });
        return dto;
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_forms')
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        const tenantId = req.tenant!.tenantId;
        const row = await this.widgets.remove(tenantId, id);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'widget.delete', targetType: 'widget', targetLabel: row.name, meta: { widget_id: id } });
    }
}

/**
 * Lo PÚBLICO del widget: sin sesión ni empresa. El token opaco es la
 * credencial; uno desconocido o sin publicar responde lo mismo (nada se ve).
 */
@Controller('public/w')
export class PublicWidgetController {
    /** La página armada por cada `WidgetPageInfo` de la caché (se va con él). */
    private readonly rendered = new WeakMap<WidgetPageInfo, { body: Precompressed; csp: string }>();
    private hashFor: string | null = null;
    private hash = '';

    constructor(
        private readonly widgets: ContactWidgetsService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** La vista previa del editor: arranca vacía y el diseño llega por postMessage. */
    @Get('preview')
    preview(@Res() reply: FastifyReply): void {
        const client = this.client();
        if (client === undefined) return void this.missing(reply, 503);
        const nonce = newNonce();
        reply
            .header('Content-Security-Policy', widgetPageCsp(`'nonce-${nonce}'`, ["'self'"], { dev: client === null }).replace(/frame-ancestors [^;]+/, "frame-ancestors 'self'"))
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', 'no-store')
            .type('text/html; charset=utf-8')
            .send(renderWidgetPage({ nonce, title: 'Vista previa', meta: null, client }));
    }

    /**
     * WhatsApp: redirige a `wa.me` con el número del botón y el mensaje
     * armado (`?u=` la página del sitio, `?t=` su título). El número no viaja a
     * la página: sólo lo conoce el servidor.
     */
    @Get(':token/go/:button')
    async go(
        @Param('token') token: string,
        @Param('button') button: string,
        @Query('u') u: string | undefined,
        @Query('t') t: string | undefined,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        let url: string | null;
        try {
            url = await this.widgets.whatsappUrl(token, button, { url: cleanPageUrl(u), title: typeof t === 'string' ? t.slice(0, 200) : null });
        } catch (err) {
            if (err instanceof PublicBusyError) url = null;
            else throw err;
        }
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Robots-Tag', 'noindex');
        if (!url) {
            reply.status(404).type('text/html; charset=utf-8').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").send(goneHtml());
            return;
        }
        reply.redirect(url, 302);
    }

    @Get(':token')
    async page(@Req() req: FastifyRequest, @Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        let info: WidgetPageInfo | null;
        try {
            info = await this.widgets.cachedPageInfo(token);
        } catch (err) {
            if (err instanceof PublicBusyError) return void this.missing(reply, 503);
            throw err;
        }
        if (!info) return void this.missing(reply, 404);
        const client = this.client();
        if (client === undefined) return void this.missing(reply, 503);
        const page = this.page_(info, client);
        reply
            .header('Content-Security-Policy', page.csp)
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
            .header('Referrer-Policy', 'strict-origin-when-cross-origin');
        sendPrecompressed(req, reply, page.body, 'text/html; charset=utf-8');
    }

    private page_(info: WidgetPageInfo, client: string | null): { body: Precompressed; csp: string } {
        const hit = this.rendered.get(info);
        if (hit) return hit;
        const html = renderWidgetPage({ title: info.title, meta: info.meta, client });
        const out = { body: precompress(html), csp: widgetPageCsp(client === null ? '' : `'${this.clientHash(client)}'`, info.allowedDomains, { dev: client === null }) };
        this.rendered.set(info, out);
        return out;
    }

    /** El compilado (null = desarrollo, módulo de vite; undefined = producción sin el build). */
    private client(): string | null | undefined {
        if (!useWebBuild(this.env)) return null;
        return loadWidgetClient(this.env.WEB_DIST_DIR) ?? undefined;
    }

    private clientHash(client: string): string {
        if (this.hashFor !== client) {
            this.hashFor = client;
            this.hash = inlineScriptHash(client);
        }
        return this.hash;
    }

    /**
     * Lo que no existe o no está publicado: una página VACÍA (transparente),
     * nunca un cartel en el sitio de la empresa. Se guarda un rato, igual que
     * un formulario inexistente.
     */
    private missing(reply: FastifyReply, status: 404 | 503): void {
        reply
            .status(status)
            .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *")
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', status === 404 ? 'public, max-age=30' : 'no-store')
            .type('text/html; charset=utf-8')
            .send(widgetMissingPage());
    }
}

/** Sólo una dirección http(s) (la página del sitio), sin el ancla. */
function cleanPageUrl(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try {
        const u = new URL(raw.slice(0, 1000));
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        u.hash = '';
        return u.href;
    } catch {
        return null;
    }
}

function goneHtml(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>No disponible</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}</style></head>
<body><div><h1>Este botón ya no está disponible</h1><p>Vuelve a la página anterior y prueba otra forma de contacto.</p></div></body></html>`;
}
