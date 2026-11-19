import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { mapLimit } from '../common/map-limit';
import {
    effectiveCapabilities,
    formatEmailFieldValue,
    renderDashboardEmail,
    reportFileName,
    resolveTimeZone,
    FALLBACK_TIME_ZONE,
    zonedToday,
    type Branding,
    type DashboardSubscription,
    type DashboardVisibility,
    type TenantFormat,
    type WidgetReport,
    type DashboardSubscriptionInput,
    type Capability,
    type Role,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { customRoles, dashboardSubscriptions, dashboards, memberships, reports as reportsTable, users } from '../db/schema';
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

/** v0.1.464 (J1) — Qué manda un envío: un tablero o un informe. */
export interface SubscriptionTarget {
    kind: 'dashboard' | 'report';
    id: number;
}

/** Lo que el envío necesita saber de lo que manda (visibilidad como los tableros). */
export interface SubscriptionSubject {
    id: number;
    name: string;
    visibility: DashboardVisibility;
    allowed_roles: string[];
    created_by: number;
}

/** El contenido de un informe listo para el correo: sus bloques como reportes y su PDF. */
export interface SubscriptionContent {
    reports: WidgetReport[];
    format: TenantFormat;
    branding: Branding;
    tenantName: string;
    /** El PDF adjunto (sólo se arma si se pide). */
    pdf: (opts: { subtitle: string; accent: string }) => Promise<Buffer>;
}

/**
 * v0.1.464 (J1) — Lo que aporta el módulo de informes a los envíos
 * programados. Se REGISTRA al arrancar (el módulo de informes importa éste):
 * así no hay dependencia circular entre los dos.
 */
export interface ReportSubscriptionSource {
    /** El informe como lo ve `viewer` (404 si no puede verlo). */
    get(tenantId: number, reportId: number, viewer: DashboardViewer): Promise<SubscriptionSubject>;
    /** El informe calculado con el acceso de `viewer`. */
    content(tenantId: number, reportId: number, viewer: DashboardViewer): Promise<SubscriptionContent>;
}

const targetOf = (row: Pick<Row, 'dashboardId' | 'reportId'>): SubscriptionTarget =>
    row.reportId !== null && row.reportId !== undefined ? { kind: 'report', id: row.reportId } : { kind: 'dashboard', id: row.dashboardId ?? 0 };

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
    private reportSource: ReportSubscriptionSource | null = null;

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

    /** v0.1.464 (J1) — El módulo de informes se registra al arrancar. */
    registerReportSource(source: ReportSubscriptionSource): void {
        this.reportSource = source;
    }

    // ─────────────────────────── CRUD ───────────────────────────

    list(tenantId: number, dashboardId: number, viewer: DashboardViewer): Promise<DashboardSubscription[]> {
        return this.listFor(tenantId, { kind: 'dashboard', id: dashboardId }, viewer);
    }

    create(tenantId: number, dashboardId: number, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<DashboardSubscription> {
        return this.createFor(tenantId, { kind: 'dashboard', id: dashboardId }, viewer, input);
    }

    update(tenantId: number, dashboardId: number, id: number, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<DashboardSubscription> {
        return this.updateFor(tenantId, { kind: 'dashboard', id: dashboardId }, id, viewer, input);
    }

    remove(tenantId: number, dashboardId: number, id: number, viewer: DashboardViewer): Promise<void> {
        return this.removeFor(tenantId, { kind: 'dashboard', id: dashboardId }, id, viewer);
    }

    runNow(tenantId: number, dashboardId: number, id: number, viewer: DashboardViewer): Promise<SubscriptionSendResult> {
        return this.runNowFor(tenantId, { kind: 'dashboard', id: dashboardId }, id, viewer);
    }

    sendTest(tenantId: number, dashboardId: number, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<SubscriptionSendResult> {
        return this.sendTestFor(tenantId, { kind: 'dashboard', id: dashboardId }, viewer, input);
    }

    async listFor(tenantId: number, target: SubscriptionTarget, viewer: DashboardViewer): Promise<DashboardSubscription[]> {
        await this.subject(tenantId, target, viewer);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(dashboardSubscriptions)
                .where(and(eq(dashboardSubscriptions.tenantId, tenantId), targetWhere(target)))
                .orderBy(dashboardSubscriptions.id),
        );
        // Los destinatarios de un envío ajeno no son de quien mira (salvo el admin).
        const visible = viewer.role === 'admin' ? rows : rows.filter((r) => r.ownerId === viewer.userId);
        return this.toDtos(tenantId, visible, viewer);
    }

    async createFor(tenantId: number, target: SubscriptionTarget, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<DashboardSubscription> {
        const subject = await this.subject(tenantId, target, viewer);
        await this.assertRecipients(tenantId, subject, input, target.kind);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(dashboardSubscriptions)
                .values({
                    tenantId,
                    dashboardId: target.kind === 'dashboard' ? target.id : null,
                    reportId: target.kind === 'report' ? target.id : null,
                    ownerId: viewer.userId,
                    ...columns(input),
                })
                .returning(),
        );
        await this.scheduler.sync(tenantId, row!);
        await this.audit.log({
            tenantId,
            userId: viewer.userId,
            action: `${target.kind}.subscription_create`,
            targetType: target.kind,
            targetId: target.id,
            targetLabel: subject.name,
            meta: { subscription_id: row!.id, members: input.recipient_user_ids.length, external_emails: input.recipient_emails },
        });
        return (await this.toDtos(tenantId, [row!], viewer))[0]!;
    }

    async updateFor(tenantId: number, target: SubscriptionTarget, id: number, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<DashboardSubscription> {
        const subject = await this.subject(tenantId, target, viewer);
        const current = await this.ownRow(tenantId, target, id, viewer);
        await this.assertRecipients(tenantId, subject, input, target.kind);
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
            action: `${target.kind}.subscription_update`,
            targetType: target.kind,
            targetId: target.id,
            targetLabel: subject.name,
            meta: { subscription_id: id, enabled: row!.enabled, external_emails: input.recipient_emails },
        });
        return (await this.toDtos(tenantId, [row!], viewer))[0]!;
    }

    async removeFor(tenantId: number, target: SubscriptionTarget, id: number, viewer: DashboardViewer): Promise<void> {
        const subject = await this.subject(tenantId, target, viewer);
        const current = await this.ownRow(tenantId, target, id, viewer);
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(dashboardSubscriptions).where(and(eq(dashboardSubscriptions.tenantId, tenantId), eq(dashboardSubscriptions.id, current.id))),
        );
        await this.scheduler.remove(id);
        this.incidents?.resolve(tenantId, incidentKey(id));
        await this.audit.log({ tenantId, userId: viewer.userId, action: `${target.kind}.subscription_delete`, targetType: target.kind, targetId: target.id, targetLabel: subject.name, meta: { subscription_id: id } });
    }

    /** Corre YA el envío guardado (sin esperar al horario). */
    async runNowFor(tenantId: number, target: SubscriptionTarget, id: number, viewer: DashboardViewer): Promise<SubscriptionSendResult> {
        await this.subject(tenantId, target, viewer);
        await this.ownRow(tenantId, target, id, viewer);
        return this.run(tenantId, id);
    }

    /**
     * «Enviarme una prueba ahora»: el correo tal como saldría (con lo que está
     * en el formulario, sin guardarlo) pero SÓLO a quien lo pide, con su acceso.
     */
    async sendTestFor(tenantId: number, target: SubscriptionTarget, viewer: DashboardViewer, input: DashboardSubscriptionInput): Promise<SubscriptionSendResult> {
        const subject = await this.subject(tenantId, target, viewer);
        const [me] = await this.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, viewer.userId)).limit(1);
        if (!me) throw new NotFoundException({ code: 'user_not_found', data: { status: 404 } });
        try {
            await this.deliver(tenantId, target, subject, viewer, me.name, me.email, input, [me.email], true);
            return { status: 'sent', sent_to: [me.email], error: null };
        } catch (err) {
            return { status: 'failed', sent_to: [], error: friendly(err) };
        }
    }

    /**
     * v0.1.464 (J1) — Se va a borrar lo que mandan estos envíos: sus horarios
     * salen de la cola y sus Problemas se cierran (las filas las borra la FK
     * en cascada).
     */
    async forgetTarget(tenantId: number, target: SubscriptionTarget): Promise<void> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ id: dashboardSubscriptions.id }).from(dashboardSubscriptions).where(and(eq(dashboardSubscriptions.tenantId, tenantId), targetWhere(target))),
        );
        for (const r of rows) {
            await this.scheduler.remove(r.id);
            this.incidents?.resolve(tenantId, incidentKey(r.id));
        }
    }

    /** Lo que se manda, como lo ve `viewer` (404 si no puede verlo). */
    private async subject(tenantId: number, target: SubscriptionTarget, viewer: DashboardViewer): Promise<SubscriptionSubject> {
        if (target.kind === 'dashboard') return this.dashboards.get(tenantId, target.id, viewer);
        if (!this.reportSource) throw new NotFoundException({ code: 'report_not_found', message: 'Ese informe no existe.', data: { status: 404 } });
        return this.reportSource.get(tenantId, target.id, viewer);
    }

    // ─────────────────────────── Envío ───────────────────────────

    /** El job programado (y «Enviar ahora»): calcula, arma y manda. */
    async run(tenantId: number, id: number): Promise<SubscriptionSendResult> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(dashboardSubscriptions).where(and(eq(dashboardSubscriptions.tenantId, tenantId), eq(dashboardSubscriptions.id, id))).limit(1);
            if (!r) return null;
            // Papelera: el tablero borrado no se ve (RLS) y su envío no sale.
            // No es una falla (no abre un problema): vuelve a salir al restaurarlo.
            // Un informe borrado se lleva sus envíos (FK en cascada).
            const target = targetOf(r);
            const [alive] = target.kind === 'report'
                ? await tx.select({ id: reportsTable.id }).from(reportsTable).where(eq(reportsTable.id, target.id)).limit(1)
                : await tx.select({ id: dashboards.id }).from(dashboards).where(eq(dashboards.id, target.id)).limit(1);
            return { sub: r, target, readOnly: await tenantIsReadOnly(tx, tenantId), trashed: !alive };
        });
        if (!row) {
            await this.scheduler.remove(id);
            return { status: 'skipped', sent_to: [], error: 'El envío ya no existe.' };
        }
        const sub = row.sub;
        const target = row.target;
        const noun = target.kind === 'report' ? 'informe' : 'tablero';
        if (row.trashed) return this.finish(tenantId, sub, { status: 'skipped', sent_to: [], error: target.kind === 'report' ? 'El informe ya no existe.' : 'El tablero está en la papelera.' });
        if (!sub.enabled) return this.finish(tenantId, sub, { status: 'skipped', sent_to: [], error: 'El envío está pausado.' });
        if (row.readOnly) {
            // ADR-S09: impaga o archivada = solo-lectura; lo programado no corre.
            return this.finish(tenantId, sub, { status: 'skipped', sent_to: [], error: 'La empresa está en solo-lectura: los envíos programados están detenidos.' });
        }
        const owner = await this.snapshots.viewerFor(tenantId, sub.ownerId);
        if (!owner) {
            return this.fail(tenantId, sub, 'Quien programó el envío ya no tiene acceso a la empresa. Otra persona tiene que programarlo de nuevo.');
        }
        let dash: SubscriptionSubject;
        try {
            dash = await this.subject(tenantId, target, owner);
        } catch {
            return this.fail(tenantId, sub, `Quien programó el envío ya no puede ver este ${noun}.`);
        }
        const recipients = await this.recipientEmails(tenantId, dash, sub);
        if (recipients.length === 0) return this.fail(tenantId, sub, `Ningún destinatario puede recibir el ${noun} (no hay correos externos y los miembros elegidos ya no lo pueden ver).`);
        const [ownerRow] = await this.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, sub.ownerId)).limit(1);
        try {
            await this.deliver(tenantId, target, dash, owner, ownerRow?.name ?? 'Alguien del equipo', ownerRow?.email ?? null, inputOf(sub), recipients, false);
        } catch (err) {
            return this.fail(tenantId, sub, friendly(err));
        }
        this.incidents?.resolve(tenantId, incidentKey(sub.id));
        return this.finish(tenantId, sub, { status: 'sent', sent_to: recipients, error: null });
    }

    /** Calcula el tablero o el informe con el acceso de `viewer`, arma el correo (y el PDF) y lo manda a cada destinatario. */
    private async deliver(
        tenantId: number,
        target: SubscriptionTarget,
        dash: SubscriptionSubject,
        viewer: DashboardViewer,
        senderName: string,
        senderEmail: string | null,
        input: DashboardSubscriptionInput,
        to: string[],
        test: boolean,
    ): Promise<void> {
        let content: SubscriptionContent;
        if (target.kind === 'report') {
            if (!this.reportSource) throw new NotFoundException({ code: 'report_not_found', message: 'Ese informe no existe.', data: { status: 404 } });
            content = await this.reportSource.content(tenantId, target.id, viewer);
        } else {
            const snap = await this.snapshots.snapshot(tenantId, target.id, viewer);
            const reports = this.snapshots.reports(snap);
            content = {
                reports,
                format: snap.format,
                branding: snap.branding,
                tenantName: snap.tenantName,
                pdf: ({ subtitle, accent }) => renderDashboardPdf({ title: dash.name, subtitle, reports, accent }),
            };
        }
        const zone = resolveTimeZone(this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE);
        const dateText = formatEmailFieldValue({ type: 'datetime' }, new Date().toISOString(), { ...content.format, timezone: zone });
        const company = content.branding.app_name ?? content.tenantName;
        const accent = content.branding.primary_color ?? '#0e7490';
        const base = (this.domains ? await this.domains.baseUrlFor(tenantId, 'app').catch(() => '') : '') || this.env.APP_BASE_URL;
        const subject = `${test ? '[Prueba] ' : ''}${input.subject.trim() || `Resumen de «${dash.name}»`}`;
        const path = target.kind === 'report' ? `/#/reports/${dash.id}` : `/#/dashboards/${dash.id}`;
        const { html, text } = renderDashboardEmail({
            dashboardName: dash.name,
            companyName: company,
            reports: content.reports,
            accent,
            dateText,
            message: input.message,
            subject,
            dashboardUrl: `${base.replace(/\/+$/, '')}${path}`,
            publicUrl: target.kind === 'dashboard' ? await this.publicDashboards.publicUrlFor(tenantId, dash.id) : null,
            senderName,
            withPdf: input.attach_pdf,
            kind: target.kind,
        });
        let attachments: MailAttachment[] | undefined;
        if (input.attach_pdf) {
            const pdf = await content.pdf({ subtitle: `${company} · ${dateText}`, accent });
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
        const target = targetOf(sub);
        this.incidents?.report({
            tenantId,
            key: incidentKey(sub.id),
            source: target.kind,
            sourceId: target.id,
            ownerId: sub.ownerId,
            title: target.kind === 'report' ? 'No se pudo enviar el informe programado' : 'No se pudo enviar el resumen programado de un tablero',
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
    private async recipientEmails(tenantId: number, dash: SubscriptionSubject, sub: Pick<Row, 'recipientUserIds' | 'recipientEmails'>): Promise<string[]> {
        const ids = [...new Set(sub.recipientUserIds ?? [])];
        const members = ids.length ? await this.membersByIds(tenantId, ids) : [];
        const emails = members.filter((m) => dashboardVisibleTo(dash, viewerOf(m))).map((m) => m.email.toLowerCase());
        for (const e of sub.recipientEmails ?? []) emails.push(e.toLowerCase());
        return [...new Set(emails)].slice(0, 25);
    }

    /** C2 — con las capacidades EFECTIVAS (rol propio): «Ver tableros» decide. */
    private async membersByIds(tenantId: number, ids: number[]): Promise<RecipientMember[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: users.id, email: users.email, name: users.name, role: memberships.role, customCaps: customRoles.capabilities })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .leftJoin(customRoles, and(eq(customRoles.id, memberships.customRoleId), eq(customRoles.tenantId, memberships.tenantId)))
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids), isNull(users.disabledAt))),
        );
        return rows.map((r) => ({
            id: r.id,
            email: r.email,
            name: r.name,
            role: r.role,
            capabilities: effectiveCapabilities(r.role as Role, (r.customCaps as string[] | null) ?? null),
        }));
    }

    /** Sólo miembros (no clientes del portal) que pueden ver el tablero o el informe. */
    private async assertRecipients(tenantId: number, dash: SubscriptionSubject, input: DashboardSubscriptionInput, kind: SubscriptionTarget['kind'] = 'dashboard'): Promise<void> {
        const noun = kind === 'report' ? 'este informe' : 'este tablero';
        const ids = [...new Set(input.recipient_user_ids)];
        if (ids.length === 0) return;
        const members = await this.membersByIds(tenantId, ids);
        const byId = new Map(members.map((m) => [m.id, m]));
        for (const id of ids) {
            const m = byId.get(id);
            if (!m || m.role === 'client' || m.role === 'guest') {
                throw new BadRequestException({ code: 'not_a_member', message: 'Uno de los destinatarios no es miembro de la empresa.', data: { status: 400 } });
            }
            // C2 — con un rol propio sin «Ver tableros», cambiar la visibilidad no alcanza.
            if (!m.capabilities.includes('view_dashboards')) {
                throw new BadRequestException({
                    code: 'recipient_cannot_see',
                    message: `${m.name} no puede ver ${kind === 'report' ? 'informes' : 'tableros'} con su rol: dale «Ver tableros» o quítalo de los destinatarios.`,
                    data: { status: 400 },
                });
            }
            if (!dashboardVisibleTo(dash, viewerOf(m))) {
                throw new BadRequestException({ code: 'recipient_cannot_see', message: `${m.name} no puede ver ${noun}: cambia su visibilidad o quítalo de los destinatarios.`, data: { status: 400 } });
            }
        }
    }

    private async ownRow(tenantId: number, target: SubscriptionTarget, id: number, viewer: DashboardViewer): Promise<Row> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(dashboardSubscriptions)
                .where(and(eq(dashboardSubscriptions.tenantId, tenantId), targetWhere(target), eq(dashboardSubscriptions.id, id)))
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
            dashboard_id: r.dashboardId ?? 0,
            report_id: r.reportId ?? null,
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
        // v0.1.393 — varios a la vez, y uno que falla no corta a los demás.
        await mapLimit(rows, 16, (r) => this.scheduler.sync(r.tenantId, r).catch(() => undefined));
        return rows.length;
    }

    /** Cambió la zona de la empresa: sus horarios sin zona propia se mueven con ella. */
    async resyncTenantSchedules(tenantId: number): Promise<void> {
        const rows = await this.db.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.tenantId, tenantId));
        for (const r of rows) await this.scheduler.sync(tenantId, r);
    }
}

function targetWhere(target: SubscriptionTarget) {
    return target.kind === 'report' ? eq(dashboardSubscriptions.reportId, target.id) : eq(dashboardSubscriptions.dashboardId, target.id);
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

/** Un destinatario miembro: su rol y sus capacidades efectivas. */
interface RecipientMember {
    id: number;
    email: string;
    name: string;
    role: string;
    capabilities: readonly Capability[];
}

function viewerOf(m: RecipientMember): DashboardViewer {
    return { userId: m.id, role: m.role, capabilities: m.capabilities };
}
