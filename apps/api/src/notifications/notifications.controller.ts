import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    createReminderSchema,
    listNotificationsQuerySchema,
    markNotificationsSchema,
    updateNotificationPrefsSchema,
    updateReminderSchema,
    type CreateReminderInput,
    type FollowStateDto,
    type MarkNotificationsInput,
    type MyWorkDto,
    type NotificationPrefs,
    type NotificationsPage,
    type ReminderDto,
    type Role,
    type UpdateNotificationPrefsInput,
    type UpdateReminderInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { NotificationsService } from './notifications.service';

function actor(req: FastifyRequest): { tenantId: number; userId: number; role: Role } {
    return { tenantId: req.tenant!.tenantId, userId: req.authUserId!, role: req.tenant!.role as Role };
}

const followSchema = z.object({ following: z.boolean() });

/**
 * v0.1.276 (ADR-S40) — Bandeja de avisos, «Mi trabajo», preferencias,
 * seguir registros y recordatorios. Todo es de la persona autenticada en la
 * empresa activa. Leer/marcar/ajustar se permite en solo-lectura (ADR-S09):
 * no toca datos de la empresa.
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard)
export class NotificationsController {
    constructor(private readonly svc: NotificationsService) {}

    @Get('me/notifications')
    async list(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(listNotificationsQuerySchema)) q: z.infer<typeof listNotificationsQuerySchema>,
    ): Promise<{ data: NotificationsPage }> {
        const a = actor(req);
        return { data: await this.svc.list(a.tenantId, a.userId, q) };
    }

    @Post('me/notifications/read')
    @HttpCode(200)
    @AllowReadOnly()
    async read(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(markNotificationsSchema)) body: MarkNotificationsInput): Promise<{ data: { unread: number } }> {
        const a = actor(req);
        return { data: await this.svc.markRead(a.tenantId, a.userId, body) };
    }

    @Get('me/notification-prefs')
    async prefs(@Req() req: FastifyRequest): Promise<{ data: NotificationPrefs }> {
        const a = actor(req);
        return { data: await this.svc.getPrefs(a.tenantId, a.userId) };
    }

    @Patch('me/notification-prefs')
    @AllowReadOnly()
    async setPrefs(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateNotificationPrefsSchema)) body: UpdateNotificationPrefsInput,
    ): Promise<{ data: NotificationPrefs }> {
        const a = actor(req);
        return { data: await this.svc.setPrefs(a.tenantId, a.userId, body) };
    }

    @Get('me/work')
    async work(@Req() req: FastifyRequest): Promise<{ data: MyWorkDto }> {
        const a = actor(req);
        return { data: await this.svc.myWork(a.tenantId, a) };
    }

    @Get('lists/:list/records/:recordId/follow')
    async followState(@Req() req: FastifyRequest, @Param('recordId', ParseIntPipe) recordId: number): Promise<{ data: FollowStateDto }> {
        const a = actor(req);
        return { data: await this.svc.followState(a.tenantId, a.userId, recordId) };
    }

    @Post('lists/:list/records/:recordId/follow')
    @HttpCode(200)
    @AllowReadOnly()
    async setFollow(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(followSchema)) body: z.infer<typeof followSchema>,
    ): Promise<{ data: FollowStateDto }> {
        const a = actor(req);
        return { data: await this.svc.setFollowing(a.tenantId, a, list, recordId, body.following) };
    }

    @Get('me/reminders')
    async reminders(@Req() req: FastifyRequest, @Query('record_id') recordId?: string): Promise<{ data: ReminderDto[] }> {
        const a = actor(req);
        const rid = recordId !== undefined && /^\d+$/.test(recordId) ? Number(recordId) : undefined;
        return { data: await this.svc.listReminders(a.tenantId, a, { recordId: rid }) };
    }

    @Post('me/reminders')
    @AllowReadOnly()
    async createReminder(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(createReminderSchema)) body: CreateReminderInput): Promise<{ data: ReminderDto }> {
        const a = actor(req);
        return { data: await this.svc.createReminder(a.tenantId, a, body) };
    }

    @Patch('me/reminders/:id')
    @AllowReadOnly()
    async updateReminder(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateReminderSchema)) body: UpdateReminderInput,
    ): Promise<{ data: ReminderDto }> {
        const a = actor(req);
        return { data: await this.svc.updateReminder(a.tenantId, a, id, body) };
    }

    @Delete('me/reminders/:id')
    @HttpCode(204)
    @AllowReadOnly()
    async removeReminder(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        const a = actor(req);
        await this.svc.removeReminder(a.tenantId, a.userId, id);
    }
}
