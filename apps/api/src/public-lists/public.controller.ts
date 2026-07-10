import { Body, Controller, Get, Param, Patch, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    publicRecordsQuerySchema,
    updatePublicListSchema,
    type PublicListAdmin,
    type PublicListMeta,
    type PublicRecordsPage,
    type PublicRecordsQuery,
    type UpdatePublicListInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { frameAncestors, renderPublicListPage } from './public-page';
import { PublicListsService } from './public-lists.service';

/**
 * Endpoints PÚBLICOS (sin auth ni tenant) de listas publicadas. El acceso se
 * gobierna por el token opaco: quien lo tiene ve la lista de solo-lectura con
 * los campos que el admin marcó como visibles. No expone ids/slug internos.
 *
 * La página HTML (`GET l/:token`) está pensada para embeberse por `<iframe>`;
 * su cabecera CSP `frame-ancestors` restringe QUÉ dominios pueden embeberla
 * (config `allowed_domains` de la lista).
 */
@Controller('public/lists')
export class PublicController {
    constructor(private readonly publicLists: PublicListsService) {}

    @Get(':token/meta')
    meta(@Param('token') token: string): Promise<PublicListMeta> {
        return this.publicLists.getMeta(token);
    }

    @Get(':token/records')
    records(
        @Param('token') token: string,
        @Query(new ZodValidationPipe(publicRecordsQuerySchema)) query: PublicRecordsQuery,
    ): Promise<PublicRecordsPage> {
        return this.publicLists.getRecords(token, query);
    }
}

/**
 * Sirve la página HTML embebible. Va en su propio controller (path `public/l`)
 * para no colisionar con `public/lists/*` y para dejar la URL de embed corta:
 * `/api/v1/public/l/:token`.
 */
@Controller('public/l')
export class PublicPageController {
    constructor(private readonly publicLists: PublicListsService) {}

    @Get(':token')
    async page(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        const { name, allowed_domains } = await this.publicLists.pageBootstrap(token);
        reply
            .header('Content-Security-Policy', frameAncestors(allowed_domains))
            .header('X-Robots-Tag', 'noindex')
            .type('text/html; charset=utf-8')
            .send(renderPublicListPage(token, name));
    }
}

/**
 * Config ADMIN de la publicación de una lista. Solo admin (`manage_lists`).
 * Vive acá (no en ListsController) para evitar dependencia circular: el
 * PublicListsService ya depende de ListsService.
 */
@Controller('lists')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class PublicAdminController {
    constructor(private readonly publicLists: PublicListsService) {}

    @Get(':idOrSlug/public')
    @RequireCapability('manage_lists')
    get(@Req() req: FastifyRequest, @Param('idOrSlug') idOrSlug: string): Promise<PublicListAdmin> {
        return this.publicLists.getAdmin(req.tenant!.tenantId, idOrSlug);
    }

    @Patch(':idOrSlug/public')
    @RequireCapability('manage_lists')
    update(
        @Req() req: FastifyRequest,
        @Param('idOrSlug') idOrSlug: string,
        @Body(new ZodValidationPipe(updatePublicListSchema)) input: UpdatePublicListInput,
    ): Promise<PublicListAdmin> {
        return this.publicLists.updateAdmin(req.tenant!.tenantId, idOrSlug, input);
    }
}
