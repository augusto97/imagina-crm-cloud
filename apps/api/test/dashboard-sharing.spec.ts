import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type CreateFieldInput, type Field, type WidgetSpec } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { DashboardSnapshotService, referencedFieldIds } from '../src/dashboard-sharing/dashboard-snapshot.service';
import { DashboardSubscriptionScheduler } from '../src/dashboard-sharing/dashboard-subscription-scheduler';
import { DashboardSubscriptionsService } from '../src/dashboard-sharing/dashboard-subscriptions.service';
import {
    loadBuiltPublicPage,
    publicDashboardCsp,
    resetPublicPageCache,
} from '../src/dashboard-sharing/public-dashboard-page';
import { PublicDashboardsService } from '../src/dashboard-sharing/public-dashboards.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { auditLog, dashboardSubscriptions, memberships, plans, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { FilesService } from '../src/files/files.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { BrandingService } from '../src/workspaces/branding.service';
import { startPostgres, type TestPg } from './helpers/containers';

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

/** SMTP mínimo de verdad que guarda el mensaje COMPLETO (lo que llega por el cable). */
function startFakeSmtp(): Promise<{ server: Server; port: number; received: string[] }> {
    const received: string[] = [];
    const server = createServer((socket) => {
        let data = false;
        let buf = '';
        let pending = '';
        socket.write('220 fake ESMTP\r\n');
        socket.on('data', (chunk) => {
            pending += chunk.toString('utf8');
            let idx: number;
            while ((idx = pending.indexOf('\r\n')) >= 0) {
                const line = pending.slice(0, idx);
                pending = pending.slice(idx + 2);
                if (data) {
                    if (line === '.') {
                        data = false;
                        received.push(buf);
                        buf = '';
                        socket.write('250 OK\r\n');
                    } else buf += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
                    continue;
                }
                const cmd = line.slice(0, 4).toUpperCase();
                if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
                else if (cmd === 'AUTH') socket.write('235 ok\r\n');
                else if (cmd === 'DATA') {
                    data = true;
                    socket.write('354 go\r\n');
                } else if (cmd === 'QUIT') socket.write('221 bye\r\n');
                else socket.write('250 OK\r\n');
            }
        });
        socket.on('error', () => undefined);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, received }));
    });
}

/** Las partes de un MIME, decodificadas (quoted-printable / base64). */
function mimeParts(raw: string): Array<{ type: string; body: string; filename: string | null }> {
    const out: Array<{ type: string; body: string; filename: string | null }> = [];
    const re = /Content-Type: ([^;\r\n]+)[^\r\n]*(?:\r\n[ \t][^\r\n]*)*\r\n((?:[^\r\n]+\r\n)*?)\r\n([\s\S]*?)(?=\r\n--)/g;
    for (const m of raw.matchAll(re)) {
        const type = m[1]!.trim().toLowerCase();
        if (type.startsWith('multipart/')) continue;
        const headers = m[2] ?? '';
        const body = m[3] ?? '';
        const cte = /Content-Transfer-Encoding: ([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase();
        const filename = /filename="?([^"\r\n;]+)/i.exec(`${m[0]}`)?.[1] ?? null;
        let decoded = body;
        if (cte === 'base64') decoded = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString(type.includes('pdf') ? 'latin1' : 'utf8');
        else if (cte === 'quoted-printable') {
            const bytes = body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
            decoded = Buffer.from(bytes, 'latin1').toString('utf8');
        }
        out.push({ type, body: decoded, filename });
    }
    return out;
}

const rt = new RealtimeService();

/**
 * v0.1.292 (ADR-S50) — Compartir un tablero hacia afuera: el enlace público
 * (sin sesión, con el ACL de quien publicó) y el envío programado por correo
 * (con el ACL del dueño, a un SMTP de prueba de verdad).
 */
describe('Tableros hacia afuera — enlace público y envío programado (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let dashboards: DashboardsService;
    let snapshots: DashboardSnapshotService;
    let publicDash: PublicDashboardsService;
    let subs: DashboardSubscriptionsService;
    let branding: BrandingService;
    let smtp: TenantSmtpService;
    let capture: CapturingMailTransport;
    let plansService: PlansService;
    let fake: { server: Server; port: number; received: string[] };
    const upserts: Array<{ id: string; repeat: Record<string, unknown> }> = [];
    const removed: string[] = [];
    const incidentReports: IncidentReport[] = [];
    let tenantId: number;
    let otherTenantId: number;
    let dashId: number;
    let f: Record<string, Field>;
    const u: Record<'admin' | 'manager' | 'viewer' | 'agent', number> = { admin: 0, manager: 0, viewer: 0, agent: 0 };
    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', SMTP_ALLOW_PRIVATE_HOSTS: 'true', FILES_SIGNING_SECRET: 'firma-de-test' });
    const asManager = () => ({ userId: u.manager, role: 'manager' });

    beforeAll(async () => {
        pg = await startPostgres();
        fake = await startFakeSmtp();
        tenantDb = new TenantDb(pg.db);
        const tzs = new TenantTimeZones(tenantDb);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const aggregate = new AggregateService(tenantDb, listsService, fieldsService);
        dashboards = new DashboardsService(tenantDb, aggregate, recordsService, fieldsService);
        const files = new FilesService(tenantDb, {} as never, env);
        branding = new BrandingService(tenantDb, files, tzs);
        const audit = new AuditService(tenantDb);
        snapshots = new DashboardSnapshotService(tenantDb, dashboards, fieldsService, aggregate);
        const domains = { baseUrlFor: () => Promise.resolve('https://app.afuera.test') } as never;
        publicDash = new PublicDashboardsService(pg.db, dashboards, snapshots, files, audit, domains, tzs);
        smtp = new TenantSmtpService(pg.db, env);
        capture = new CapturingMailTransport();
        plansService = new PlansService(pg.db);
        const mail = new MailService(env, capture, undefined, smtp, new EmailQuotaService(pg.db, plansService));
        const incidents = new IncidentHub();
        incidents.subscribe({ report: (r) => void incidentReports.push(r), resolve: () => undefined, resolvePrefix: () => undefined });
        const scheduler = new DashboardSubscriptionScheduler(tzs);
        scheduler.setQueue({
            upsertJobScheduler: (id: string, repeat: Record<string, unknown>) => (upserts.push({ id, repeat }), Promise.resolve()),
            removeJobScheduler: (id: string) => (removed.push(id), Promise.resolve(true)),
        } as never);
        subs = new DashboardSubscriptionsService(pg.db, env, tenantDb, dashboards, snapshots, publicDash, mail, audit, scheduler, domains, tzs, incidents);
        tzs.onChange((t) => subs.resyncTenantSchedules(t));

        const [t] = await pg.db.insert(tenants).values({ slug: 'afuera', name: 'Afuera SA', plan: 'trial', status: 'trialing' }).returning();
        tenantId = t!.id;
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra', plan: 'trial', status: 'trialing' }).returning();
        otherTenantId = t2!.id;
        for (const role of ['admin', 'manager', 'viewer', 'agent'] as const) {
            const [usr] = await pg.db.insert(users).values({ email: `${role}@afuera.test`, name: `Persona ${role}`, passwordHash: 'x' }).returning();
            u[role] = usr!.id;
            await pg.db.insert(memberships).values({ userId: usr!.id, tenantId, role });
        }

        await listsService.create(tenantId, { name: 'Ventas', slug: 'ventas' });
        const defs: CreateFieldInput[] = [
            { label: 'Cliente', type: 'text', slug: 'cliente' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'pendiente', label: 'Pendiente', color: 'amber' }, { value: 'hecho', label: 'Hecho', color: 'green' }] },
            },
            { label: 'Monto', type: 'currency', slug: 'monto', config: { currency: 'COP', precision: 0 } },
            { label: 'Costo interno', type: 'currency', slug: 'costo', config: { currency: 'COP', precision: 0 } },
            { label: 'Responsable', type: 'user', slug: 'responsable' },
            { label: 'Fecha', type: 'date', slug: 'fecha' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'ventas', d);
        const listId = f.cliente!.list_id;
        const today = new Date().toISOString().slice(0, 10);
        const seed = [
            { cliente: 'Acme', estado: 'pendiente', monto: 1500000, costo: 999111, responsable: u.viewer, fecha: today },
            { cliente: 'Beta', estado: 'hecho', monto: 250000, costo: 777222, responsable: u.agent, fecha: '2020-01-10' },
            { cliente: 'Gama', estado: 'hecho', monto: 100000, costo: 555333, responsable: u.viewer, fecha: '2020-02-10' },
        ];
        for (const r of seed) {
            const data: Record<string, unknown> = {};
            for (const [s, v] of Object.entries(r)) data[`f${f[s]!.id}`] = v;
            await withTenant(pg.db, tenantId, (tx) => tx.insert(records).values({ tenantId, listId, createdBy: u.admin, data }));
        }
        // El costo es INTERNO: el rol manager no lo ve.
        await listsService.updatePermissions(tenantId, 'ventas', {
            permissions: { manager: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['costo'] } },
        });
        const L = listId;
        const widgets: WidgetSpec[] = [
            { id: 'k1', type: 'kpi', list_id: L, title: 'Ventas', config: { metric: 'sum', metric_field_id: f.monto!.id }, layout: { x: 0, y: 0, w: 3, h: 2 } },
            { id: 'k2', type: 'kpi', list_id: L, title: 'Costo', config: { metric: 'sum', metric_field_id: f.costo!.id }, layout: { x: 3, y: 0, w: 3, h: 2 } },
            { id: 'b1', type: 'chart_bar', list_id: L, title: 'Por estado', config: { metric: 'count', group_by_field_id: f.estado!.id }, layout: { x: 0, y: 2, w: 6, h: 4 } },
            { id: 'u1', type: 'chart_pie', list_id: L, title: 'Por responsable', config: { metric: 'count', group_by_field_id: f.responsable!.id }, layout: { x: 6, y: 2, w: 6, h: 4 } },
            {
                id: 'kf',
                type: 'kpi',
                list_id: L,
                title: 'Hoy',
                config: { metric: 'count', date_field_id: f.fecha!.id },
                layout: { x: 6, y: 0, w: 3, h: 2 },
            },
            {
                id: 't1',
                type: 'table',
                list_id: L,
                title: 'Últimas',
                config: { limit: 5, visible_field_ids: [f.cliente!.id, f.costo!.id, f.monto!.id] },
                layout: { x: 0, y: 6, w: 12, h: 4 },
            },
        ];
        dashId = (await dashboards.create(tenantId, u.manager, { name: 'Tablero Ventas', widgets } as never)).id;
    });

    afterAll(async () => {
        fake?.server.close();
        await pg?.stop();
    });

    it('sólo quien puede cambiar el tablero lo publica; queda en la bitácora', async () => {
        await expect(publicDash.update(tenantId, dashId, { userId: u.viewer, role: 'viewer' }, { enabled: true })).rejects.toThrow();
        const admin = await publicDash.update(tenantId, dashId, asManager(), { enabled: true, allowed_domains: ['Ejemplo.com', '*.cliente.co'] });
        expect(admin.enabled).toBe(true);
        expect(admin.path).toMatch(/^\/api\/v1\/public\/d\/[A-Za-z0-9_-]{32}$/);
        expect(admin.allowed_domains).toEqual(['ejemplo.com', '*.cliente.co']);
        expect(admin.has_tables).toBe(true);
        expect(admin.published_by?.id).toBe(u.manager);
        const logged = await pg.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'dashboard.public_enable')));
        expect(logged).toHaveLength(1);
    });

    it('sin sesión: los datos con el ACL de quien publicó — un campo oculto para esa persona nunca viaja', async () => {
        const admin = await publicDash.getAdmin(tenantId, dashId, asManager());
        const token = admin.path!.split('/').pop()!;
        const b = await publicDash.bundle(token, undefined);
        expect(b.name).toBe('Tablero Ventas');
        expect(b.data.k1).toMatchObject({ value: 1850000 });
        // El KPI sobre el campo oculto no calcula (y no hay ningún valor suyo en el paquete).
        expect((b.data.k2 as { __error?: string }).__error).toBeTruthy();
        const json = JSON.stringify(b);
        for (const secret of ['999111', '777222', '555333', 'Costo interno']) expect(json).not.toContain(secret);
        // La tabla: sin la columna oculta.
        const table = b.data.t1 as { columns: Array<{ slug: string }>; rows: Array<{ fields: Record<string, unknown> }> };
        expect(table.columns.map((c) => c.slug)).toEqual(['cliente', 'monto']);
        expect(table.rows).toHaveLength(3);
        // Sólo las definiciones de los campos que USAN los widgets (y visibles).
        const listFields = b.fields[String(f.cliente!.list_id)]!.map((x) => (x as { slug: string }).slug).sort();
        expect(listFields).toEqual(['cliente', 'estado', 'fecha', 'monto', 'responsable']);
        const estado = b.fields[String(f.cliente!.list_id)]!.find((x) => (x as { slug: string }).slug === 'estado') as { config: { options: unknown[] } };
        expect(estado.config.options).toHaveLength(2);
        // Nombres de las personas por las que agrupa un gráfico.
        expect(b.users[String(u.viewer)]).toBe('Persona viewer');
        expect(b.users[String(u.agent)]).toBe('Persona agent');
        expect(b.allow_period).toBe(false);
        expect(b.branding.app_name).toBe('Afuera SA');
    });

    it('el período sólo cambia si quien publicó lo permitió', async () => {
        const admin = await publicDash.getAdmin(tenantId, dashId, asManager());
        const token = admin.path!.split('/').pop()!;
        expect((await publicDash.bundle(token, 'today')).data.kf).toMatchObject({ value: 3 });
        await publicDash.update(tenantId, dashId, asManager(), { allow_period: true });
        const withPeriod = await publicDash.bundle(token, 'today');
        expect(withPeriod.period).toBe('today');
        expect(withPeriod.data.kf).toMatchObject({ value: 1 });
    });

    it('404 opaco: vencido, despublicado, regenerado, empresa archivada o quien publicó perdió el acceso', async () => {
        let admin = await publicDash.getAdmin(tenantId, dashId, asManager());
        const first = admin.path!.split('/').pop()!;
        await expect(publicDash.bundle('no-existe-este-token-xx', undefined)).rejects.toMatchObject({ status: 404 });

        // Vencido (ayer) → 404; sin vencimiento vuelve.
        await publicDash.update(tenantId, dashId, asManager(), { expires_at: '2020-01-01' });
        await expect(publicDash.bundle(first, undefined)).rejects.toMatchObject({ status: 404 });
        await expect(publicDash.pageConfig(first)).rejects.toMatchObject({ status: 404 });
        await publicDash.update(tenantId, dashId, asManager(), { expires_at: null });
        await expect(publicDash.bundle(first, undefined)).resolves.toBeTruthy();

        // Regenerar: la dirección vieja muere al instante.
        admin = await publicDash.regenerate(tenantId, dashId, asManager());
        const second = admin.path!.split('/').pop()!;
        expect(second).not.toBe(first);
        await expect(publicDash.bundle(first, undefined)).rejects.toMatchObject({ status: 404 });
        await expect(publicDash.bundle(second, undefined)).resolves.toBeTruthy();

        // Quien publicó pasa a ser sólo cliente del portal → el enlace no muestra nada.
        await pg.db.update(memberships).set({ role: 'client' }).where(and(eq(memberships.userId, u.manager), eq(memberships.tenantId, tenantId)));
        await expect(publicDash.bundle(second, undefined)).rejects.toMatchObject({ status: 404 });
        await pg.db.update(memberships).set({ role: 'manager' }).where(and(eq(memberships.userId, u.manager), eq(memberships.tenantId, tenantId)));
        await expect(publicDash.bundle(second, undefined)).resolves.toBeTruthy();

        // Empresa archivada.
        await pg.db.update(tenants).set({ archivedAt: new Date() }).where(eq(tenants.id, tenantId));
        await expect(publicDash.bundle(second, undefined)).rejects.toMatchObject({ status: 404 });
        await pg.db.update(tenants).set({ archivedAt: null }).where(eq(tenants.id, tenantId));

        // Despublicado: el token desaparece.
        await publicDash.update(tenantId, dashId, asManager(), { enabled: false });
        await expect(publicDash.bundle(second, undefined)).rejects.toMatchObject({ status: 404 });
        expect((await publicDash.getAdmin(tenantId, dashId, asManager())).enabled).toBe(false);
        // Vuelve a publicarse para lo que sigue (otra dirección).
        await publicDash.update(tenantId, dashId, asManager(), { enabled: true });
    });

    it('la página: el HTML del build con `frame-ancestors` de los dominios elegidos', () => {
        expect(publicDashboardCsp(['ejemplo.com', '*.cliente.co'])).toContain("frame-ancestors 'self' ejemplo.com *.cliente.co");
        expect(publicDashboardCsp([])).toContain('frame-ancestors *');
        expect(publicDashboardCsp([])).toContain("script-src 'self';");
        const dir = mkdtempSync(path.join(tmpdir(), 'web-dist-'));
        mkdirSync(path.join(dir, 'cloud-public'));
        writeFileSync(path.join(dir, 'cloud-public', 'index.html'), '<!doctype html><title>Tablero</title>');
        resetPublicPageCache();
        expect(loadBuiltPublicPage(dir)).toContain('<title>Tablero</title>');
        resetPublicPageCache();
        expect(referencedFieldIds({ metric_field_id: 3, visible_field_ids: [4, 5], filter_tree: { children: [{ field_id: 6 }] }, list_id: 9 })).toEqual(new Set([3, 4, 5, 6]));
    });

    it('envío programado: horario en la zona de la empresa, que se mueve con ella', async () => {
        await branding.setFormat(tenantId, { timezone: 'America/Bogota' });
        const sub = await subs.create(tenantId, dashId, asManager(), {
            enabled: true,
            frequency: 'weekly',
            weekdays: [1, 4],
            month_day: 1,
            hour: 8,
            minute: 0,
            time_zone: null,
            recipient_user_ids: [u.viewer],
            recipient_emails: ['jefe@externo.test'],
            subject: '',
            message: 'Buenos días, equipo.',
            attach_pdf: true,
        });
        expect(sub.effective_time_zone).toBe('America/Bogota');
        const reg = upserts.filter((x) => x.id === `dashsub:${sub.id}`).pop();
        expect(reg?.repeat).toEqual({ pattern: '0 8 * * 1,4', tz: 'America/Bogota' });
        await branding.setFormat(tenantId, { timezone: 'Europe/Madrid' });
        await new Promise((r) => setTimeout(r, 50));
        expect(upserts.filter((x) => x.id === `dashsub:${sub.id}`).pop()?.repeat).toEqual({ pattern: '0 8 * * 1,4', tz: 'Europe/Madrid' });
        // Un miembro que no puede ver el tablero no se puede elegir.
        await dashboards.update(tenantId, dashId, asManager(), { visibility: 'roles', allowed_roles: ['viewer'] });
        await expect(
            subs.create(tenantId, dashId, asManager(), { ...baseInput(), recipient_user_ids: [u.agent] }),
        ).rejects.toMatchObject({ status: 400 });
        await dashboards.update(tenantId, dashId, asManager(), { visibility: 'workspace', allowed_roles: [] });
    });

    it('«Enviarme una prueba»: sólo a quien la pide, marcada como prueba y sin guardar nada', async () => {
        capture.sent.length = 0;
        const res = await subs.sendTest(tenantId, dashId, asManager(), { ...baseInput(), recipient_emails: ['nadie@externo.test'] });
        expect(res).toEqual({ status: 'sent', sent_to: ['manager@afuera.test'], error: null });
        expect(capture.sent).toHaveLength(1);
        expect(capture.sent[0]!.to).toBe('manager@afuera.test');
        expect(capture.sent[0]!.subject).toBe('[Prueba] Resumen de «Tablero Ventas»');
        expect(capture.sent[0]!.attachments).toBeUndefined();
    });

    it('cuota del plan agotada: el envío falla con el motivo y abre un Problema', async () => {
        await pg.db.update(plans).set({ maxEmailsMonth: 1 }).where(eq(plans.slug, 'trial'));
        // El servicio de planes cachea los límites 30 s.
        (plansService as unknown as { invalidate(): void }).invalidate();
        try {
            const [sub] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.tenantId, tenantId)));
            incidentReports.length = 0;
            const res = await subs.run(tenantId, sub!.id);
            expect(res.status).toBe('failed');
            expect(res.error).toMatch(/cuota|límite|correos/i);
            expect(incidentReports.some((r) => r.key === `dashboard_subscription:${sub!.id}` && r.source === 'dashboard')).toBe(true);
            const row = (await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.id, sub!.id))))[0]!;
            expect(row.lastStatus).toBe('failed');
        } finally {
            await pg.db.update(plans).set({ maxEmailsMonth: 100 }).where(eq(plans.slug, 'trial'));
            (plansService as unknown as { invalidate(): void }).invalidate();
        }
    });

    it('sale por el SMTP de la empresa: un correo por destinatario, con los KPIs, las barras, el PDF y sin el campo oculto', async () => {
        await smtp.update(tenantId, { host: '127.0.0.1', port: fake.port, secure: false, user: 'u', pass: 'p', from: 'reportes@afuera.test' });
        const [sub] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.tenantId, tenantId)));
        fake.received.length = 0;
        const result = await subs.run(tenantId, sub!.id);
        expect(result).toMatchObject({ status: 'sent', error: null });
        expect(result.sent_to.sort()).toEqual(['jefe@externo.test', 'viewer@afuera.test']);
        expect(fake.received).toHaveLength(2);
        const raw = fake.received[0]!;
        const parts = mimeParts(raw);
        const html = parts.find((p) => p.type === 'text/html')!.body;
        const text = parts.find((p) => p.type === 'text/plain')!.body;
        expect(html).toContain('Tablero Ventas');
        expect(html).toContain('Buenos días, equipo.');
        expect(html).toContain('$1,850,000');
        expect(html).toContain('Pendiente');
        expect(html).toContain('Persona viewer');
        expect(html).toContain('Ver el tablero');
        expect(html).toContain('https://app.afuera.test/#/dashboards/');
        expect(html).toContain('https://app.afuera.test/api/v1/public/d/');
        expect(text).toContain('Ventas');
        for (const secret of ['999111', '777222', '555333', 'Costo interno']) expect(raw).not.toContain(secret);
        const pdf = parts.find((p) => p.type === 'application/pdf');
        expect(pdf?.filename).toMatch(/^tablero-ventas-\d{4}-\d{2}-\d{2}\.pdf$/);
        expect(pdf!.body.startsWith('%PDF')).toBe(true);
        // Los textos de los gráficos (SVG) van con la tipografía embebida, en
        // normal y en negrita — no con la fuente que haya quedado activa.
        const baseFonts = [...pdf!.body.matchAll(/\/BaseFont \/(?:[A-Z]{6}\+)?([A-Za-z-]+)/g)].map((m) => m[1]);
        expect(baseFonts.some((f) => /^Inter/.test(f ?? '') && !/Bold/.test(f ?? ''))).toBe(true);
        expect(baseFonts.some((f) => /^Inter.*Bold/.test(f ?? ''))).toBe(true);
        const row =(await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.id, sub!.id))))[0]!;
        expect(row.lastStatus).toBe('sent');
        expect(row.lastSentAt).not.toBeNull();
        await smtp.clear(tenantId);
    });

    it('una empresa en solo-lectura (impaga) no envía; un envío ajeno no lo cambia un viewer', async () => {
        const [sub] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.tenantId, tenantId)));
        await pg.db.update(tenants).set({ status: 'canceled' }).where(eq(tenants.id, tenantId));
        capture.sent.length = 0;
        try {
            const res = await subs.run(tenantId, sub!.id);
            expect(res.status).toBe('skipped');
            expect(capture.sent).toHaveLength(0);
        } finally {
            await pg.db.update(tenants).set({ status: 'trialing' }).where(eq(tenants.id, tenantId));
        }
        await expect(subs.remove(tenantId, dashId, sub!.id, { userId: u.viewer, role: 'viewer' })).rejects.toMatchObject({ status: 403 });
        // El viewer no ve los envíos ajenos (sus destinatarios no son suyos).
        expect(await subs.list(tenantId, dashId, { userId: u.viewer, role: 'viewer' })).toEqual([]);
        await subs.remove(tenantId, dashId, sub!.id, asManager());
        expect(removed).toContain(`dashsub:${sub!.id}`);
    });

    it('RLS: los envíos programados de una empresa no se ven ni se escriben desde otra', async () => {
        const sub = await subs.create(tenantId, dashId, asManager(), baseInput());
        const seen = await withTenant(pg.db, otherTenantId, (tx) => tx.select().from(dashboardSubscriptions));
        expect(seen.map((r) => r.id)).not.toContain(sub.id);
        await expect(
            withTenant(pg.db, otherTenantId, (tx) =>
                tx.insert(dashboardSubscriptions).values({ tenantId, dashboardId: dashId, ownerId: u.manager }),
            ),
        ).rejects.toThrow();
        const own = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboardSubscriptions));
        expect(own.map((r) => r.id)).toContain(sub.id);
    });

    function baseInput() {
        return {
            enabled: true,
            frequency: 'daily' as const,
            weekdays: [1],
            month_day: 1,
            hour: 7,
            minute: 30,
            time_zone: null,
            recipient_user_ids: [u.viewer],
            recipient_emails: [] as string[],
            subject: '',
            message: '',
            attach_pdf: false,
        };
    }
});
