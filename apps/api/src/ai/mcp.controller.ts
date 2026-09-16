import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV, type Env } from '../config/env';
import { McpService } from './mcp.service';
import { PersonalTokensService } from './tokens.service';
import type { AiToolContext } from './tools/registry';

function readVersion(): string {
    for (const candidate of [join(process.cwd(), '..', '..', 'VERSION'), join(process.cwd(), 'VERSION')]) {
        try {
            return readFileSync(candidate, 'utf8').trim();
        } catch {
            // siguiente
        }
    }
    return 'dev';
}

/**
 * Endpoint MCP (Streamable HTTP, sin estado): `POST /api/v1/mcp` con
 * `Authorization: Bearer ib_pat_…`. Cada request valida el token (usuario +
 * workspace + rol EN VIVO + scope), arma el servidor con las herramientas de
 * ese rol y scope y delega en el transporte del SDK sobre la respuesta cruda
 * de Fastify. GET (stream de servidor) y DELETE (cerrar sesión) no aplican
 * en modo sin estado → 405.
 */
@Controller('mcp')
export class McpController {
    private readonly version = readVersion();

    constructor(
        private readonly tokens: PersonalTokensService,
        private readonly mcp: McpService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    @All()
    async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
        reply.hijack();
        const raw = reply.raw;
        if (req.method !== 'POST') {
            raw.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
            raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: este servidor MCP es sin estado (sólo POST)' }, id: null }));
            return;
        }
        const header = req.headers.authorization;
        const secret = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
        const resolved = secret ? await this.tokens.resolve(secret) : null;
        if (!resolved) {
            raw.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="imagina-base", error="invalid_token"' });
            raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Token de acceso inválido, vencido o revocado' }, id: null }));
            return;
        }
        const ctx: AiToolContext = { tenantId: resolved.tenantId, userId: resolved.userId, role: resolved.role };
        const server = this.mcp.buildServer(ctx, resolved.scope, this.version);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        raw.on('close', () => {
            void transport.close();
            void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req.raw, raw, req.body);
    }
}
