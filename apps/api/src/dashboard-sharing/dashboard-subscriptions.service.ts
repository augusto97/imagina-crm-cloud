import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    formatEmailFieldValue,
    renderDashboardEmail,
    reportFileName,
    resolveTimeZone,
    FALLBACK_TIME_ZONE,
    zonedToday,
    type Dashboard,
    type DashboardSubscription,
    type DashboardSubscriptionInput,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { dashboardSubscriptions, dashboards, memberships, users } from '../db/schema';
import { DashboardsService, dashboardVisibleTo, type DashboardViewer } from '../dashboards/dashboards.service';
import { DomainsService } from '../domains/domains.service';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { EmailQuotaExceededError } from '../mail/email-quota.service';
import { MailService } from '../mail/mail.service';
import type { MailAttachment } from '../mail/mail.types';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { renderDashboardPdf } from './dashboard-pdf';
import { DashboardSnapshotService } from './dashboard-snapshot.service';
import { DashboardSubscriptionScheduler } from './dashboard-subscription-scheduler';
import { PublicDashboardsService } from './public-dashboards.service';

type Row = typeof dashboardSubscriptions.$inferSelect;

/** Resultado de un envío (también el de «Enviarme una prueba»). */
export interface SubscriptionSendResult {
    status: 'sent' | 'failed' | 'skipped';
    sent_to: string[];
    error: string | null;
}

const incidentKey = (id: number) => `dashboard_subscription:${id}`;

/**
 * v0.1.292 (ADR-S50) — Envío programado de un tablero por correo.
 *
 * Los datos salen con el acceso del DUEÑO de la suscripción (como los vería
 * en la app). Los destinatarios miembros tienen que poder ver el tablero (si
 * dejan de poder, se los saltea); los externos son opcionales. Cada correo va
 * por separado (nadie ve los correos de los demás) y cuenta contra la cuota
 * del plan como cualquier otro (ADR-S18). Una empresa en solo-lectura no
 * envía (ADR-S09) y un envío que falla abre un Problema (ADR-S44).
 */
@Injectable()
export class DashboardSubscriptionsService {
    private readonly logger = new Logger(DashboardSubscriptionsService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly tenantDb: TenantDb,
        private readonly dashboards: DashboardsService,
        private readonly snapshots: DashboardSnapshotService,
        private readonly publicDashboards: PublicDashboardsService,
        private readonly mail: MailService,
        private readonly audit: AuditService,
        private readonly scheduler: DashboardSubscriptionScheduler,
        @Optional() private readonly domains?: DomainsService,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

    // ─────────────────────────── CRUD ───────────────────────────

    async list(tenantId: number, dashboardId: number, viewer: DashboardViewer): Promise<DashboardSubscription[]> {
        await this.dashboards.get(tenantId, dashboardId, viewer);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(dashboardSubscriptions)
                .where(and(eq(dashboardSubscriptions.tenantId, tenantId), eq(dashboardSubscriptions.dashboardId, dashboardId)))
                .orderBy(dashboardSubscriptions.id),
        );
        // Los destinatarios de un envío ajeno no son de quien mira (salvo el admin).
        const visible = viewer.role === 'admin' ? rows : rows.filter((r) => r.ownerId === viewer.userId);
        return this.toDtos(tenantId, visible, viewer);
    }

    async create(tenantId: number, dashboardId: number, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<DashboardSubscription> {
        const dash = await this.dashboards.get(tenantId, dashboardId, viewer);
        await this.assertRecipients(tenantId, dash, input);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(dashboardSubscriptions)
                .values({ tenantId, dashboardId, ownerId: viewer.userId, ...columns(input) })
                .returning(),
        );
        await this.scheduler.sync(tenantId, row!);
        await this.audit.log({
            tenantId,
            userId: viewer.userId,
            action: 'dashboard.subscription_create',
            targetType: 'dashboard',
            targetId: dashboardId,
            targetLabel: dash.name,
            meta: { subscription_id: row!.id, members: input.recipient_user_ids.length, external_emails: input.recipient_emails },
        });
        return (await this.toDtos(tenantId, [row!], viewer))[0]!;
    }

    async update(tenantId: number, dashboardId: number, id: number, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<DashboardSubscription> {
        const dash = await this.dashboards.get(tenantId, dashboardId, viewer);
        const current = await this.ownRow(tenantId, dashboardId, id, viewer);
        await this.assertRecipients(tenantId, dash, input);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(dashboardSubscriptions)
                .set({ ...columns(input), updatedAt: new Date() })
                .where(and(eq(dashboardSubscriptions.tenantId, tenantId), eq(dashboardSubscriptions.id, current.id)))
                .returning(),
        );
        await this.scheduler.sync(tenantId, row!);
        if (!row!.enabled) this.incidents?.resolve(tenantId, incidentKey(id));
        await this.audit.log({
            tenantId,
            userId: viewer.userId,
            action: 'dashboard.subscription_update',
            targetType: 'dashboard',
            targetId: dashboardId,
            targetLabel: dash.name,
            meta: { subscription_id: id, enabled: row!.enabled, external_emails: input.recipient_emails },
        });
        return (await this.toDtos(tenantId, [row!], viewer))[0]!;
    }

    async remove(tenantId: number, dashboardId: number, id: number, viewer: DashboardViewer): Promise<void> {
        const dash = await this.dashboards.get(tenantId, dashboardId, viewer);
        const current = await this.ownRow(tenantId, dashboardId, id, viewer);
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(dashboardSubscriptions).where(and(eq(dashboardSubscriptions.tenantId, tenantId), eq(dashboardSubscriptions.id, current.id))),
        );
        await this.scheduler.remove(id);
        this.incidents?.resolve(tenantId, incidentKey(id));
        await this.audit.log({ tenantId, userId: viewer.userId, action: 'dashboard.subscription_delete', targetType: 'dashboard', targetId: dashboardId, targetLabel: dash.name, meta: { subscription_id: id } });
    }

    /** Corre YA el envío guardado (sin esperar al horario). */
    async runNow(tenantId: number, dashboardId: number, id: number, viewer: DashboardViewer): Promise<SubscriptionSendResult> {
        await this.dashboards.get(tenantId, dashboardId, viewer);
        await this.ownRow(tenantId, dashboardId, id, viewer);
        return this.run(tenantId, id);
    }

    /**
     * «Enviarme una prueba ahora»: el correo tal como saldría (con lo que está
     * en el formulario, sin guardarlo) pero SÓLO a quien lo pide, con su acceso.
     */
    async sendTest(tenantId: number, dashboardId: number, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<SubscriptionSendResult> {
        const dash = await this.dashboards.get(tenantId, dashboardId, viewer);
        const [me] = await this.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, viewer.userId)).limit(1);
        if (!me) throw new NotFoundException({ code: 'user_not_found', data: { status: 404 } });
        try {
            await this.deliver(tenantId, dash, viewer, me.name, me.email, input, [me.email], true);
            return { status: 'sent', sent_to: [me.email], error: null };
        } catch (err) {
            return { status: 'failed', sent_to: [], error: friendly(err) };
        }
    }

    // ─────────────────────────── Envío ───────────────────────────

    /** El job programado (y «Enviar ahora»): calcula, arma y manda. */
    async run(tenantId: number, id: number): Promise<SubscriptionSendResult> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(dashboardSubscriptions).where(and(eq(dashboardSubscriptions.tenantId, tenantId), eq(dashboardSubscriptions.id, id))).limit(1);
            if (!r) return null;
            // Papelera: el tablero borrado no se ve (RLS) y su envío no sale.
            // No es una falla (no abre un problema): vuelve a salir al restaurarlo.
            const [dash] = await tx.select({ id: dashboards.id }).from(dashboards).where(eq(dashboards.id, r.dashboardId)).limit(1);
            return { sub: r, readOnly: await tenantIsReadOnly(tx, tenantId), trashed: !dash };
        });
        if (!row) {
            await this.scheduler.remove(id);
            return { status: 'skipped', sent_to: [], error: 'El envío ya no existe.' };
        }
        const sub = row.sub;
        if (row.trashed) return this.finish(tenantId, sub, { status: 'skipped', sent_to: [], error: 'El tablero está en la papelera.' });
        if (!sub.enabled) return this.finish(tenantId, sub, { status: 'skipped', sent_to: [], error: 'El envío está pausado.' });
        if (row.readOnly) {
            // ADR-S09: impaga o archivada = solo-lectura; lo programado no corre.
            return this.finish(tenantId, sub, { status: 'skipped', sent_to: [], error: 'La empresa está en solo-lectura: los envíos programados están detenidos.' });
        }
        const owner = await this.snapshots.viewerFor(tenantId, sub.ownerId);
        if (!owner) {
            return this.fail(tenantId, sub, 'Quien programó el envío ya no tiene acceso a la empresa. Otra persona tiene que programarlo de nuevo.');
        }
        let dash: Dashboard;
        try {
            dash = await this.dashboards.get(tenantId, sub.dashboardId, owner);
        } catch {
            return this.fail(tenantId, sub, 'Quien programó el envío ya no puede ver este tablero.');
        }
        const recipients = await this.recipientEmails(tenantId, dash, sub);
        if (recipients.length === 0) return this.fail(tenantId, sub, 'Ningún destinatario puede recibir el tablero (no hay correos externos y los miembros elegidos ya no lo pueden ver).');
        const [ownerRow] = await this.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, sub.ownerId)).limit(1);
        try {
            await this.deliver(tenantId, dash, owner, ownerRow?.name ?? 'Alguien del equipo', ownerRow?.email ?? null, inputOf(sub), recipients, false);
        } catch (err) {
            return this.fail(tenantId, sub, friendly(err));
        }
        this.incidents?.resolve(tenantId, incidentKey(sub.id));
        return this.finish(tenantId, sub, { status: 'sent', sent_to: recipients, error: null });
    }

    /** Calcula el tablero con el acceso de `viewer`, arma el correo (y el PDF) y lo manda a cada destinatario. */
    private async deliver(
        tenantId: number,
        dash: Dashboard,
        viewer: DashboardViewer,
        senderName: string,
        senderEmail: string | null,
        input: DashboardSubscriptionInput,
        to: string[],
        test: boolean,
    ): Promise<void> {
        const snap = await this.snapshots.snapshot(tenantId, dash.id, viewer);
        const reports = this.snapshots.reports(snap);
        const zone = resolveTimeZone(this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE);
        const dateText = formatEmailFieldValue({ type: 'datetime' }, new Date().toISOString(), { ...snap.format, timezone: zone });
        const company = snap.branding.app_name ?? snap.tenantName;
        const accent = snap.branding.primary_color ?? '#0e7490';
        const base = (this.domains ? await this.domains.baseUrlFor(tenantId, 'app').catch(() => '') : '') || this.env.APP_BASE_URL;
        const subject = `${test ? '[Prueba] ' : ''}${input.subject.trim() || `Resumen de «${dash.name}»`}`;
        const { html, text } = renderDashboardEmail({
            dashboardName: dash.name,
            companyName: company,
            reports,
            accent,
            dateText,
            message: input.message,
            subject,
            dashboardUrl: `${base.replace(/\/+$/, '')}/#/dashboards/${dash.id}`,
            publicUrl: await this.publicDashboards.publicUrlFor(tenantId, dash.id),
            senderName,
            withPdf: input.attach_pdf,
        });
        let attachments: MailAttachment[] | undefined;
        if (input.attach_pdf) {
            const pdf = await renderDashboardPdf({ title: dash.name, subtitle: `${company} · ${dateText}`, reports, accent });
            attachments = [{ filename: `${reportFileName(dash.name, zonedToday(zone))}.pdf`, contentType: 'application/pdf', contentBase64: pdf.toString('base64') }];
        }
        // Uno por destinatario: nadie ve los correos de los demás.
        for (const email of to) {
            await this.mail.sendNow({
                tenantId,
                to: email,
                subject,
                html,
                text,
                fromName: company,
                fromNameSoft: true,
                ...(senderEmail ? { replyTo: senderEmail } : {}),
                ...(attachments ? { attachments } : {}),
            });
        }
    }

    private async fail(tenantId: number, sub: Row, message: string): Promise<SubscriptionSendResult> {
        this.incidents?.report({
            tenantId,
            key: incidentKey(sub.id),
            source: 'dashboard',
            sourceId: sub.dashboardId,
            ownerId: sub.ownerId,
            title: 'No se pudo enviar el resumen programado de un tablero',
            message,
        });
        return this.finish(tenantId, sub, { status: 'failed', sent_to: [], error: message });
    }

    private async finish(tenantId: number, sub: Row, result: SubscriptionSendResult): Promise<SubscriptionSendResult> {
        await this.tenantDb
            .withTenant(tenantId, (tx) =>
                tx
                    .update(dashboardSubscriptions)
                    .set({
                        lastStatus: result.status,
                        lastError: result.error,
                        ...(result.status === 'sent' ? { lastSentAt: new Date() } : {}),
                    })
                    .where(eq(dashboardSubscriptions.id, sub.id)),
            )
            .catch((err: unknown) => this.logger.warn(`No se pudo anotar el envío ${sub.id}: ${String(err)}`));
        return result;
    }

    /** Correos a los que sale: miembros que HOY pueden ver el tablero + externos. */
    private async recipientEmails(tenantId: number, dash: Dashboard, sub: Pick<Row, 'recipientUserIds' | 'recipientEmails'>): Promise<string[]> {
        const ids = [...new Set(sub.recipientUserIds ?? [])];
        const members = ids.length ? await this.membersByIds(tenantId, ids) : [];
        const emails = members.filter((m) => dashboardVisibleTo(dash, { userId: m.id, role: m.role })).map((m) => m.email.toLowerCase());
        for (const e of sub.recipientEmails ?? []) emails.push(e.toLowerCase());
        return [...new Set(emails)].slice(0, 25);
    }

    private async membersByIds(tenantId: number, ids: number[]): Promise<Array<{ id: number; email: string; name: string; role: string }>> {
        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: users.id, email: users.email, name: users.name, role: memberships.role })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids), isNull(users.disabledAt))),
        );
    }

    /** Sólo miembros (no clientes del portal) que pueden ver el tablero. */
    private async assertRecipients(tenantId: number, dash: Dashboard, input: DashboardSubscriptionInput): Promise<void> {
        const ids = [...new Set(input.recipient_user_ids)];
        if (ids.length === 0) return;
        const members = await this.membersByIds(tenantId, ids);
        const byId = new Map(members.map((m) => [m.id, m]));
        for (const id of ids) {
            const m = byId.get(id);
            if (!m || m.role === 'client') {
                throw new BadRequestException({ code: 'not_a_member', message: 'Uno de los destinatarios no es miembro de la empresa.', data: { status: 400 } });
            }
            if (!dashboardVisibleTo(dash, { userId: m.id, role: m.role })) {
                throw new BadRequestException({ code: 'recipient_cannot_see', message: `${m.name} no puede ver este tablero: cambia su visibilidad o quítalo de los destinatarios.`, data: { status: 400 } });
            }
        }
    }

    private async ownRow(tenantId: number, dashboardId: number, id: number, viewer: DashboardViewer): Promise<Row> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(dashboardSubscriptions)
                .where(and(eq(dashboardSubscriptions.tenantId, tenantId), eq(dashboardSubscriptions.dashboardId, dashboardId), eq(dashboardSubscriptions.id, id)))
                .limit(1),
        );
        if (!row) throw new NotFoundException({ code: 'subscription_not_found', message: 'Ese envío no existe.', data: { status: 404 } });
        if (viewer.role !== 'admin' && row.ownerId !== viewer.userId) {
            throw new ForbiddenException({ code: 'subscription_not_owner', message: 'Sólo quien lo programó o un admin pueden cambiar este envío.', data: { status: 403 } });
        }
        return row;
    }

    private async toDtos(tenantId: number, rows: Row[], viewer: DashboardViewer): Promise<DashboardSubscription[]> {
        if (rows.length === 0) return [];
        const owners = [...new Set(rows.map((r) => r.ownerId))];
        const names = await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, owners));
        const nameOf = new Map(names.map((n) => [n.id, n.name]));
        const tenantTz = this.timeZones ? await this.timeZones.get(tenantId) : null;
        return rows.map((r) => ({
            id: r.id,
            dashboard_id: r.dashboardId,
            owner: { id: r.ownerId, name: nameOf.get(r.ownerId) ?? `Usuario ${r.ownerId}` },
            ...inputOf(r),
            effective_time_zone: r.timeZone ?? tenantTz ?? FALLBACK_TIME_ZONE,
            last_sent_at: r.lastSentAt ? r.lastSentAt.toISOString() : null,
            last_status: (r.lastStatus as DashboardSubscription['last_status']) ?? null,
            last_error: r.lastError,
            created_at: r.createdAt.toISOString(),
            can_edit: viewer.role === 'admin' || r.ownerId === viewer.userId,
        }));
    }

    // ─────────────────────────── Horarios ───────────────────────────

    /** Re-registra los horarios de TODAS las suscripciones activas (al arrancar). */
    async resyncSchedules(): Promise<number> {
        // Conexión base (sin RLS): sólo ids y horario, para registrar los jobs.
        const rows = await this.db.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.enabled, true));
        for (const r of rows) await this.scheduler.sync(r.tenantId, r);
        return rows.length;
    }

    /** Cambió la zona de la empresa: sus horarios sin zona propia se mueven con ella. */
    async resyncTenantSchedules(tenantId: number): Promise<void> {
        const rows = await this.db.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.tenantId, tenantId));
        for (const r of rows) await this.scheduler.sync(tenantId, r);
    }
}

function columns(input: DashboardSubscriptionInput) {
    return {
        enabled: input.enabled,
        frequency: input.frequency,
        weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b),
        monthDay: input.month_day,
        hour: input.hour,
        minute: input.minute,
        timeZone: input.time_zone,
        recipientUserIds: [...new Set(input.recipient_user_ids)],
        recipientEmails: [...new Set(input.recipient_emails.map((e) => e.toLowerCase()))],
        subject: input.subject,
        message: input.message,
        attachPdf: input.attach_pdf,
    };
}

function inputOf(r: Row): DashboardSubscriptionInput {
    return {
        enabled: r.enabled,
        frequency: r.frequency as DashboardSubscriptionInput['frequency'],
        weekdays: r.weekdays ?? [],
        month_day: r.monthDay,
        hour: r.hour,
        minute: r.minute,
        time_zone: r.timeZone,
        recipient_user_ids: r.recipientUserIds ?? [],
        recipient_emails: r.recipientEmails ?? [],
        subject: r.subject,
        message: r.message,
        attach_pdf: r.attachPdf,
    };
}

/** El motivo de un envío fallido, legible. */
function friendly(err: unknown): string {
    if (err instanceof EmailQuotaExceededError) return `${errorText(err)} Configura el correo de tu empresa en Ajustes → Correo para no depender de la cuota.`;
    return errorText(err);
}
