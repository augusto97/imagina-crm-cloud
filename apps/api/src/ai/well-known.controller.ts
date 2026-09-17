import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { OauthService } from './oauth.service';
import { requestOrigin } from './oauth.util';

/**
 * Metadata de descubrimiento OAuth (v0.1.184). Vive en la RAÍZ del host
 * (`/.well-known/…`, RFC 8414 / RFC 9728), fuera del prefijo `/api/v1`: es lo
 * que un cliente MCP busca al recibir el 401 del MCP. En producción el proxy
 * tiene que mandar `/.well-known/oauth-*` al API (ver deploy/Caddyfile y
 * deploy/nginx.conf); la ruta path-aware del recurso
 * (`/.well-known/oauth-protected-resource/api/v1/mcp`) es la que anuncia el
 * `WWW-Authenticate`, y la de raíz existe para los clientes que sólo prueban
 * ésa.
 */
@Controller('.well-known')
export class WellKnownController {
    constructor(private readonly oauth: OauthService) {}

    @Get(['oauth-authorization-server', 'oauth-authorization-server/api/v1/mcp', 'openid-configuration'])
    authorizationServer(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
        void reply.header('Cache-Control', 'public, max-age=300').send(this.oauth.authorizationServerMetadata(requestOrigin(req)));
    }

    @Get(['oauth-protected-resource', 'oauth-protected-resource/api/v1/mcp'])
    protectedResource(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
        void reply.header('Cache-Control', 'public, max-age=300').send(this.oauth.protectedResourceMetadata(requestOrigin(req)));
    }
}
