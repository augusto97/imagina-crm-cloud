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
    createCommentSchema,
    updateCommentSchema,
    type CommentDto,
    type CreateCommentInput,
    type UpdateCommentInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import type { Actor } from '../records/records.service';
import { CommentsService } from './comments.service';

/** Comentarios por record (CONTRACT.md §1). Ver requiere ver el record. */
@Controller('lists/:list/records/:recordId/comments')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class CommentsController {
    constructor(private readonly comments: CommentsService) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    list(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
    ): Promise<{ data: CommentDto[] }> {
        return this.comments
            .list(req.tenant!.tenantId, actor(req), list, recordId)
            .then((data) => ({ data }));
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('create_records', 'edit_records', 'edit_own_records')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(createCommentSchema)) input: CreateCommentInput,
    ): Promise<CommentDto> {
        return this.comments.create(req.tenant!.tenantId, actor(req), list, recordId, input);
    }

    @Patch(':id')
    @RequireCapability('create_records', 'edit_records', 'edit_own_records')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateCommentSchema)) patch: UpdateCommentInput,
    ): Promise<CommentDto> {
        return this.comments.update(req.tenant!.tenantId, actor(req), list, recordId, id, patch);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('create_records', 'edit_records', 'edit_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.comments.remove(req.tenant!.tenantId, actor(req), list, recordId, id);
    }
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
