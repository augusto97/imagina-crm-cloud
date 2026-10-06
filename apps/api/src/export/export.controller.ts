import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { filterTreeSchema, roleHasCapability, type FilterGroup } from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import type { Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ExportService } from './export.service';

/**
 * Export de una lista. GET → sigue disponible en solo-lectura por impago
 * (ADR-S09). Requiere export_records. Dos formatos:
 *  - default: bundle JSON de intercambio (CONTRACT §11, STANDALONE §16).
 *  - `?format=csv`: CSV con selección de campos/delimiter/filtro — lo que
 *    usa el diálogo "Exportar" del admin. Respeta el ACL por rol.
 *
 * SEC-10: ambos formatos se STREAMEAN (keyset) → sin OOM en listas grandes.
 */
@Controller('lists/:list/export')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ExportController {
    constructor(private readonly exportService: ExportService) {}

    @Get()
    @RequireCapability('export_records')
    async export(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Res() reply: FastifyReply,
        @Query('format') format?: string,
        @Query('fields') fields?: string,
        @Query('delimiter') delimiter?: string,
        @Query('with_bom') withBom?: string,
        @Query('filter_tree') rawFilterTree?: string,
    ): Promise<void> {
        if (format === 'csv') {
            const actor: Actor = { userId: req.authUserId!, role: req.tenant!.role };
            const fieldIds = (fields ?? '')
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isInteger(n) && n > 0);

            await this.exportService.streamCsvExport(
                req.tenant!.tenantId,
                actor,
                list,
                {
                    fieldIds,
                    delimiter: delimiter === ';' ? ';' : ',',
                    withBom: withBom === '1' || withBom === 'true',
                    filterTree: parseFilterTree(rawFilterTree),
                },
                (filename) =>
                    reply.raw.writeHead(200, {
                        'content-type': 'text/csv; charset=utf-8',
                        'content-disposition': `attachment; filename="${filename}"`,
                    }),
                (chunk) => writeWithBackpressure(reply.raw, chunk),
            );
            reply.raw.end();
            return;
        }

        // SEC-25 (v0.1.226): el bundle JSON es la copia ESTRUCTURAL de la lista
        // (todos los registros con todos sus campos + settings: permisos,
        // plantilla del portal, publicación). No pasa por el ACL por lista, así
        // que es para quien administra listas; el resto exporta en CSV, que sí
        // respeta su scope y sus campos ocultos.
        if (!roleHasCapability(req.tenant!.role, 'manage_lists')) {
            throw new ForbiddenException({
                code: 'export_json_requires_manage_lists',
                message: 'El export completo (JSON) es para quien administra listas; exportá en CSV',
                data: { status: 403 },
            });
        }
        reply.raw.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': 'attachment; filename="export.json"',
        });
        // `new Date()` acá es válido (código de app, no workflow script).
        await this.exportService.streamExport(
            req.tenant!.tenantId,
            list,
            new Date().toISOString(),
            (chunk) => writeWithBackpressure(reply.raw, chunk),
        );
        reply.raw.end();
    }
}

/**
 * v0.1.252 — respeta la contrapresión del socket: si `write` devuelve false
 * (el buffer del cliente está lleno) se espera a `drain`. Sin esto, con un
 * cliente lento el archivo ENTERO quedaba acumulado en la memoria del proceso.
 */
function writeWithBackpressure(raw: NodeJS.WritableStream & { destroyed?: boolean }, chunk: string): Promise<void> | void {
    if (raw.write(chunk)) return;
    if (raw.destroyed) return;
    return new Promise<void>((resolve) => {
        const done = (): void => {
            raw.off('drain', done);
            raw.off('close', done);
            resolve();
        };
        raw.once('drain', done);
        raw.once('close', done);
    });
}

/** Parsea y valida el `filter_tree` JSON del query param (whitelist Zod). */
function parseFilterTree(raw: string | undefined): FilterGroup | undefined {
    if (raw === undefined || raw.trim() === '') return undefined;
    let candidate: unknown;
    try {
        candidate = JSON.parse(raw);
    } catch {
        throw invalidFilter();
    }
    const parsed = filterTreeSchema.safeParse(candidate);
    if (!parsed.success) throw invalidFilter();
    return parsed.data;
}

function invalidFilter(): BadRequestException {
    return new BadRequestException({
        code: 'invalid_filter',
        message: 'El parámetro filter_tree debe ser un árbol de filtros JSON válido',
        data: { status: 400 },
    });
}
