import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createListGroupSchema,
    updateListGroupSchema,
    type CreateListGroupInput,
    type ListGroup,
    type UpdateListGroupInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ListGroupsService } from './list-groups.service';

/**
 * Carpetas del menú de listas (v0.1.130). Leer las carpetas es parte de
 * dibujar el menú, así que alcanza con sesión; crearlas o moverlas exige
 * `manage_lists`, igual que las listas.
 */
@Controller('list-groups')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ListGroupsController {
    constructor(private readonly groups: ListGroupsService) {}

    @Get()
    all(@Req() req: FastifyRequest): Promise<{ data: ListGroup[] }> {
        return this.groups.list(tenantId(req)).then((data) => ({ data }));
    }

    @Post()
    @RequireCapability('manage_lists')
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createListGroupSchema)) input: CreateListGroupInput,
    ): Promise<{ data: ListGroup }> {
        return this.groups.create(tenantId(req), input).then((data) => ({ data }));
    }

    @Patch(':id')
    @RequireCapability('manage_lists')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateListGroupSchema)) input: UpdateListGroupInput,
    ): Promise<{ data: ListGroup }> {
        return this.groups.update(tenantId(req), id, input).then((data) => ({ data }));
    }

    @Delete(':id')
    @RequireCapability('manage_lists')
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.groups.remove(tenantId(req), id);
    }
}

function tenantId(req: FastifyRequest): number {
    // TenantGuard garantiza que req.tenant existe antes de llegar acá.
    return req.tenant!.tenantId;
}
