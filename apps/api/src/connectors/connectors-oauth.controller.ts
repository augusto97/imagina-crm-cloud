import { CanActivate, Controller, ExecutionContext, Get, Inject, Injectable, Query, Req, Res, UseGuards } from '@nestjs/common';
import { MS_ADMIN_CONSENT_STATE_PREFIX } from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from './connectors.service';
import { MsAdminConsentService, type AdminConsentOutcome } from './ms-admin-consent.service';

/**
 * v0.1.363 — La vuelta de una APROBACIÓN DEL ADMINISTRADOR de Microsoft
 * (`state` con el prefijo `ac_`) llega en el navegador del administrador de
 * TI, que no tiene por qué tener cuenta en la app: pasa sin sesión. No trae
 * código ni tokens (sólo `admin_consent=True`), así que no hay nada que
 * robar. Cualquier otra vuelta exige la sesión de quien inició la conexión.
 */
@Injectable()
export class OAuthCallbackGuard implements CanActivate {
    private readonly session: SessionGuard;

    constructor(sessions: SessionService) {
        this.session = new SessionGuard(sessions);
    }

    canActivate(context: ExecutionContext): Promise<boolean> | boolean {
        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const state = (req.query as Record<string, unknown> | undefined)?.state;
        if (typeof state === 'string' && state.startsWith(MS_ADMIN_CONSENT_STATE_PREFIX)) return true;
        return this.session.canActivate(context);
    }
}

/**
 * Vuelta del proveedor OAuth (v0.1.199, ADR-S22 fase 3).
 *
 * Va en un controller APARTE del de conectores por dos motivos:
 *  - El navegador vuelve por un redirect del proveedor: manda la cookie de
 *    sesión pero NO el header `X-Tenant-Id`, así que no puede pasar por el
 *    `TenantGuard`. La empresa sale del `state` que emitimos nosotros.
 *  - Es la ÚNICA URI de redirección registrada en el proveedor, así que su
 *    ruta tiene que ser fija y previsible.
 *
 * La respuesta es un redirect al panel: quien está mirando es una persona en
 * su navegador, no un cliente de API.
 */
@Controller('connections/oauth')
@UseGuards(OAuthCallbackGuard)
export class ConnectorsOAuthController {
    constructor(
        private readonly connectors: ConnectorsService,
        private readonly adminConsent: MsAdminConsentService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    @Get('callback')
    async callback(
        @Req() req: FastifyRequest,
        @Res() reply: FastifyReply,
        @Query('code') code?: string,
        @Query('state') state?: string,
        @Query('error') error?: string,
        @Query('error_description') errorDescription?: string,
        @Query('admin_consent') adminConsent?: string,
    ): Promise<void> {
        // v0.1.363 — aprobación del administrador de Microsoft: una página
        // para quien aprobó (no un redirect al panel: no tiene sesión aquí).
        if (state?.startsWith(MS_ADMIN_CONSENT_STATE_PREFIX)) {
            const out = await this.adminConsent.complete({ state, adminConsent, error, errorDescription });
            reply
                .status(out.tone === 'ok' ? 200 : 400)
                .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
                .header('Cache-Control', 'no-store')
                .header('X-Robots-Tag', 'noindex')
                .type('text/html; charset=utf-8')
                .send(renderAdminConsentPage(out));
            return;
        }

        const panel = `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/cloud/index.html#/settings?s=conectores`;

        // El proveedor puede volver con un error en vez de un código (la
        // persona canceló, o la app no tiene permiso): se muestra tal cual, con
        // la app (v0.1.363) para ofrecer la salida que corresponde —p. ej. el
        // enlace para el administrador de Microsoft 365—.
        if (error) {
            const detail = errorDescription ? `${error}: ${errorDescription}` : error;
            const which = await this.connectors.abandonOAuth(req.authUserId!, state ?? '');
            const base = which.purpose === 'agenda' ? panel.replace('s=conectores', 's=calendario') : panel;
            const app = which.integration ? `&app=${encodeURIComponent(which.integration)}` : '';
            await reply.redirect(`${base}&oauth=error${app}&msg=${encodeURIComponent(detail)}`, 302);
            return;
        }

        const result = await this.connectors.completeOAuth(
            req.authUserId!,
            code ?? '',
            state ?? '',
        );
        const suffix = result.ok
            ? '&oauth=ok'
            : `&oauth=error&msg=${encodeURIComponent(result.error ?? 'Error desconocido')}`;
        // v0.1.350 — «Mi calendario» vuelve a su propia sección de Ajustes.
        const back = result.purpose === 'agenda' ? panel.replace('s=conectores', 's=calendario') : panel;
        await reply.redirect(back + suffix, 302);
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** La página que ve el administrador al volver de Microsoft (sin scripts, todo escapado). */
export function renderAdminConsentPage(out: AdminConsentOutcome): string {
    const ok = out.tone === 'ok';
    const icon = ok
        ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
        : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5"/><path d="M12 16.5h.01"/><circle cx="12" cy="12" r="9"/></svg>';
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(out.title)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330}
.card{max-width:460px;width:100%;background:#fff;border:1px solid #e3e6ea;border-radius:14px;padding:28px 24px;box-shadow:0 10px 30px -18px rgba(15,23,42,.35);text-align:center}
.ic{width:52px;height:52px;margin:0 auto 14px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:#fff;background:${ok ? '#16a34a' : '#c0262d'}}
h1{font-size:20px;line-height:1.3;margin:0 0 8px}
p{margin:0;color:#4b5565}
@media (prefers-color-scheme:dark){body{background:#121212;color:#ececec}.card{background:#1b1b1b;border-color:#2b2b2b}p{color:#a8a8a8}}
</style>
</head>
<body>
<main class="card" role="main">
<div class="ic">${icon}</div>
<h1>${escapeHtml(out.title)}</h1>
<p>${escapeHtml(out.message)}</p>
</main>
</body>
</html>`;
}
