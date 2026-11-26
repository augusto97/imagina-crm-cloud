import { createServer, type Server } from 'node:net';
import { openXlsx, updateReportSchema, type CreateFieldInput, type Field, type ReportBlock } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { DashboardSnapshotService } from '../src/dashboard-sharing/dashboard-snapshot.service';
import { DashboardSubscriptionScheduler } from '../src/dashboard-sharing/dashboard-subscription-scheduler';
import { DashboardSubscriptionsService } from '../src/dashboard-sharing/dashboard-subscriptions.service';
import { PublicDashboardsService } from '../src/dashboard-sharing/public-dashboards.service';
import { DashboardsService, type DashboardViewer } from '../src/dashboards/dashboards.service';
import { auditLog, dashboardSubscriptions, memberships, records, reports, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { FilesService } from '../src/files/files.service';
import { IncidentHub } from '../src/incidents/incident-hub';
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
import { ReportsService } from '../src/reports/reports.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
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

type Cmp = { value: number; previous: { from: string; to: string } };
const valueOf = (d: unknown): number => (d as { value: number }).value;
const cmpOf = (d: unknown): Cmp => (d as { compare: Cmp }).compare;
const errorOf = (d: unknown): string | undefined => (d as { __error?: string } | undefined)?.__error;

/**
 * v0.1.464 (J1) — Informes armados con bloques de VARIAS listas: el mismo
 * motor de los tableros (ACL de quien mira, zona de la empresa, cada bloque
 * aislado), el período y la comparación del informe pisando los de cada
 * bloque, la descarga en PDF y en Excel y el envío programado por correo.
 */
describe('Informes con bloques de varias listas (Postgres real)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let service: ReportsService;
    let subs: DashboardSubscriptionsService;
    let smtp: TenantSmtpService;
    let capture: CapturingMailTransport;
    let fake: { server: Server; port: number; received: string[] };
    const upserts: Array<{ id: string; repeat: Record<string, unknown> }> = [];
    const removed: string[] = [];
    let tenantId: number;
    let otherTenantId: number;
    let otherListId: number;
    const L: Record<'ventas' | 'gastos' | 'nomina', number> = { ventas: 0, gastos: 0, nomina: 0 };
    const f: Record<string, Field> = {};
    const u: Record<'admin' | 'manager' | 'viewer' | 'agent', number> = { admin: 0, manager: 0, viewer: 0, agent: 0 };
    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', SMTP_ALLOW_PRIVATE_HOSTS: 'true', FILES_SIGNING_SECRET: 'firma-de-test' });
    const as = (role: keyof typeof u): DashboardViewer => ({ userId: u[role], role });
    let reportId: number;
    let blocks: ReportBlock[];

    beforeAll(async () => {
        pg = await startPostgres();
        fake = await startFakeSmtp();
        const tenantDb = new TenantDb(pg.db);
        const tzs = new TenantTimeZones(tenantDb);
        const rt = new RealtimeService();
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
            undefined,
            undefined,
            undefined,
            tzs,
        );
        const aggregate = new AggregateService(tenantDb, listsService, fieldsService, tzs);
        const dashboards = new DashboardsService(tenantDb, aggregate, recordsService, fieldsService);
        const files = new FilesService(tenantDb, {} as never, env);
        const audit = new AuditService(tenantDb);
        const snapshots = new DashboardSnapshotService(tenantDb, dashboards, fieldsService, aggregate);
        const domains = { baseUrlFor: () => Promise.resolve('https://app.informes.test') } as never;
        const publicDash = new PublicDashboardsService(pg.db, dashboards, snapshots, files, audit, domains, tzs);
        smtp = new TenantSmtpService(pg.db, env);
        capture = new CapturingMailTransport();
        const plansService = new PlansService(pg.db);
        const mail = new MailService(env, capture, undefined, smtp, new EmailQuotaService(pg.db, plansService));
        const scheduler = new DashboardSubscriptionScheduler(tzs);
        scheduler.setQueue({
            upsertJobScheduler: (id: string, repeat: Record<string, unknown>) => (upserts.push({ id, repeat }), Promise.resolve()),
            removeJobScheduler: (id: string) => (removed.push(id), Promise.resolve(true)),
        } as never);
        subs = new DashboardSubscriptionsService(pg.db, env, tenantDb, dashboards, snapshots, publicDash, mail, audit, scheduler, domains, tzs, new IncidentHub());
        service = new ReportsService(tenantDb, dashboards, snapshots, audit, subs, tzs);
        service.onModuleInit();

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'informes', name: 'Informes SA', plan: 'trial', status: 'trialing', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        const [t2] = await pg.db.insert(tenants).values({ slug: 'ajena', name: 'Ajena', plan: 'trial', status: 'trialing' }).returning();
        otherTenantId = t2!.id;
        for (const role of ['admin', 'manager', 'viewer', 'agent'] as const) {
            const [usr] = await pg.db.insert(users).values({ email: `${role}@informes.test`, name: `Persona ${role}`, passwordHash: 'x' }).returning();
            u[role] = usr!.id;
            await pg.db.insert(memberships).values({ userId: usr!.id, tenantId, role });
        }

        const make = async (name: string, slug: string, defs: CreateFieldInput[]) => {
            await listsService.create(tenantId, { name, slug });
            for (const d of defs) f[`${slug}.${d.slug}`] = await fieldsService.create(tenantId, slug, d);
            return f[`${slug}.${defs[0]!.slug}`]!.list_id;
        };
        L.ventas = await make('Ventas', 'ventas', [
            { label: 'Cliente', type: 'text', slug: 'cliente' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'pendiente', label: 'Pendiente', color: 'amber' }, { value: 'hecho', label: 'Hecho', color: 'green' }] },
            },
            { label: 'Monto', type: 'currency', slug: 'monto', config: { currency: 'COP', precision: 0 } },
            { label: 'Costo interno', type: 'currency', slug: 'costo', config: { currency: 'COP', precision: 0 } },
            { label: 'Fecha', type: 'date', slug: 'fecha' },
        ]);
        L.gastos = await make('Gastos', 'gastos', [
            { label: 'Concepto', type: 'text', slug: 'concepto' },
            {
                label: 'Categoría',
                type: 'select',
                slug: 'categoria',
                config: { options: [{ value: 'oficina', label: 'Oficina', color: 'blue' }, { value: 'viajes', label: 'Viajes', color: 'green' }] },
            },
            { label: 'Valor', type: 'currency', slug: 'valor', config: { currency: 'COP', precision: 0 } },
            { label: 'Fecha', type: 'date', slug: 'fecha' },
        ]);
        L.nomina = await make('Nómina', 'nomina', [
            { label: 'Persona', type: 'text', slug: 'persona' },
            { label: 'Salario', type: 'currency', slug: 'salario', config: { currency: 'COP', precision: 0 } },
        ]);
        const seed = async (slug: string, rows: Array<Record<string, unknown>>) => {
            for (const r of rows) {
                const data: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(r)) data[`f${f[`${slug}.${k}`]!.id}`] = v;
                const listId = L[slug as keyof typeof L];
                await withTenant(pg.db, tenantId, (tx) => tx.insert(records).values({ tenantId, listId, createdBy: u.admin, data }));
            }
        };
        // Hoy es el 19-nov-2026 en Bogotá. Números hechos a mano:
        //   Ventas este mes = 1.000.000 + 300.000 = 1.300.000; el mes anterior
        //   hasta el 19 = 50.000 (Delta, del 25-oct, queda afuera).
        //   Gastos este mes = 200.000 + 80.000 = 280.000; el mes anterior = 500.000.
        await seed('ventas', [
            { cliente: 'Acme', estado: 'pendiente', monto: 1000000, costo: 111111, fecha: '2026-11-05' },
            { cliente: 'Beta', estado: 'hecho', monto: 300000, costo: 222222, fecha: '2026-11-18' },
            { cliente: 'Gama', estado: 'hecho', monto: 50000, costo: 333333, fecha: '2026-10-10' },
            { cliente: 'Delta', estado: 'hecho', monto: 400000, costo: 444444, fecha: '2026-10-25' },
        ]);
        await seed('gastos', [
            { concepto: 'Papelería', categoria: 'oficina', valor: 200000, fecha: '2026-11-02' },
            { concepto: 'Bus', categoria: 'viajes', valor: 80000, fecha: '2026-11-15' },
            { concepto: 'Arriendo', categoria: 'oficina', valor: 500000, fecha: '2026-10-03' },
        ]);
        await seed('nomina', [{ persona: 'Ana', salario: 4000000 }]);
        // El costo es INTERNO (el gerente no lo ve) y la nómina no la ve.
        await listsService.updatePermissions(tenantId, 'ventas', {
            permissions: { manager: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['costo'] } },
        });
        await listsService.updatePermissions(tenantId, 'nomina', {
            permissions: { manager: { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
        });

        await listsService.create(otherTenantId, { name: 'Ajena', slug: 'ajena' });
        otherListId = (await fieldsService.create(otherTenantId, 'ajena', { label: 'Nombre', type: 'text', slug: 'nombre' })).list_id;

        const yearOf = (slug: string) => ({ field_id: f[`${slug}.fecha`]!.id, preset: 'this_year' });
        blocks = [
            { id: 'h1', type: 'heading', text: 'Resumen del mes', subtitle: 'Ventas y gastos' },
            { id: 'tx', type: 'text', text: 'Lo más importante **del mes**.' },
            {
                id: 'kv',
                type: 'widget',
                widget: { type: 'kpi', list_id: L.ventas, title: 'Ventas', config: { metric: 'sum', metric_field_id: f['ventas.monto']!.id, period: yearOf('ventas') } },
            },
            {
                id: 'row',
                type: 'columns',
                children: [
                    {
                        id: 'kg',
                        type: 'widget',
                        widget: { type: 'kpi', list_id: L.gastos, title: 'Gastos', config: { metric: 'sum', metric_field_id: f['gastos.valor']!.id, period: yearOf('gastos') } },
                    },
                    {
                        id: 'bc',
                        type: 'widget',
                        widget: {
                            type: 'chart_bar',
                            list_id: L.gastos,
                            title: 'Gastos por categoría',
                            config: { metric: 'sum', metric_field_id: f['gastos.valor']!.id, group_by_field_id: f['gastos.categoria']!.id, period: yearOf('gastos') },
                        },
                    },
                ],
            },
            {
                id: 'kc',
                type: 'widget',
                widget: { type: 'kpi', list_id: L.ventas, title: 'Costo', config: { metric: 'sum', metric_field_id: f['ventas.costo']!.id, period: yearOf('ventas') } },
            },
            { id: 'kn', type: 'widget', widget: { type: 'kpi', list_id: L.nomina, title: 'Nómina', config: { metric: 'sum', metric_field_id: f['nomina.salario']!.id } } },
            // Mal armado: no se suma un texto. No tumba a los demás.
            { id: 'kx', type: 'widget', widget: { type: 'kpi', list_id: L.ventas, title: 'Roto', config: { metric: 'sum', metric_field_id: f['ventas.cliente']!.id } } },
            { id: 'pb', type: 'page_break' },
            {
                id: 't1',
                type: 'widget',
                widget: {
                    type: 'table',
                    list_id: L.ventas,
                    title: 'Últimas ventas',
                    config: { limit: 10, visible_field_ids: [f['ventas.cliente']!.id, f['ventas.costo']!.id, f['ventas.monto']!.id] },
                },
            },
            { id: 'dv', type: 'divider' },
        ] as ReportBlock[];
        reportId = (
            await service.create(tenantId, as('manager'), {
                name: 'Resumen comercial',
                description: 'Ventas y gastos del mes',
                blocks,
                settings: { period: 'this_month', compare: 'previous' },
            } as never)
        ).id;
        // Hoy: 19-nov-2026 10:00 en Bogotá.
        vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-19T15:00:00Z') });
    });

    afterAll(async () => {
        vi.useRealTimers();
        fake?.server.close();
        await pg?.stop();
    });

    it('un pedido trae los bloques de las dos listas con el período y la comparación del informe', async () => {
        const { data, period, compare } = await service.bundle(tenantId, reportId, as('manager'));
        expect(period).toBe('this_month');
        expect(compare).toBe('previous');
        expect(valueOf(data.kv)).toBe(1300000);
        expect(cmpOf(data.kv)).toMatchObject({ value: 50000, previous: { from: '2026-10-01', to: '2026-10-19' } });
        expect(valueOf(data.kg)).toBe(280000);
        expect(cmpOf(data.kg)).toMatchObject({ value: 500000 });
        const bars = Object.fromEntries((data.bc as { data: Array<{ label: string; value: number }> }).data.map((r) => [r.label, r.value]));
        expect(bars).toEqual({ oficina: 200000, viajes: 80000 });
        // Los títulos y textos no van al servidor de datos.
        expect(Object.keys(data).sort()).toEqual(['bc', 'kc', 'kg', 'kn', 'kv', 'kx', 't1'].sort());
    });

    it('ACL de quien mira: el campo oculto no se suma ni sale en la tabla, y la lista sin acceso lo dice', async () => {
        const { data } = await service.bundle(tenantId, reportId, as('manager'));
        expect(errorOf(data.kc)).toBeTruthy();
        expect(errorOf(data.kn)).toBe('No tienes acceso a esta lista.');
        const table = data.t1 as { columns: Array<{ field_id: number }>; rows: unknown[] };
        expect(table.columns.map((c) => c.field_id)).not.toContain(f['ventas.costo']!.id);
        expect(table.rows).toHaveLength(4);
        const raw = JSON.stringify(data);
        for (const secret of ['111111', '222222', '333333', '444444', '4000000']) expect(raw).not.toContain(secret);
        // El admin sí ve el costo y la nómina.
        const admin = await service.bundle(tenantId, reportId, as('admin'));
        expect(valueOf(admin.data.kc)).toBe(333333);
        expect(valueOf(admin.data.kn)).toBe(4000000);
    });

    it('un bloque mal armado dice por qué y el resto se dibuja', async () => {
        const { data } = await service.bundle(tenantId, reportId, as('admin'));
        expect(errorOf(data.kx)).toMatch(/num/i);
        expect(errorOf(data.kv)).toBeUndefined();
        expect(errorOf(data.kg)).toBeUndefined();
    });

    it('quien mira cambia el período y la comparación: «el de cada bloque» o un rango', async () => {
        const own = await service.bundle(tenantId, reportId, as('manager'), { period: '', compare: '' });
        expect(valueOf(own.data.kv)).toBe(1750000); // este año, el del bloque
        expect('compare' in (own.data.kv as object)).toBe(false);
        const oct = await service.bundle(tenantId, reportId, as('manager'), { period: 'custom:2026-10-01:2026-10-31', compare: 'none' });
        expect(valueOf(oct.data.kv)).toBe(450000);
        expect(valueOf(oct.data.kg)).toBe(500000);
        expect('compare' in (oct.data.kv as object)).toBe(false);
        // La vista previa del editor: bloques SIN guardar, el mismo motor.
        const prev = await service.preview(tenantId, as('manager'), blocks.slice(2, 3), { period: 'this_month' });
        expect(valueOf(prev.data.kv)).toBe(1300000);
    });

    it('PDF: portada y saltos de página; Excel: una hoja por bloque, con «Antes» y sin el campo oculto', async () => {
        const pdf = await service.export(tenantId, reportId, as('manager'), 'pdf');
        expect(pdf.contentType).toBe('application/pdf');
        expect(pdf.filename).toBe('resumen-comercial-2026-11-19.pdf');
        expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
        const doc = await PDFDocument.load(pdf.buffer);
        expect(doc.getTitle()).toBe('Resumen comercial');
        // Portada + los bloques hasta el salto + lo que sigue.
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);

        const xlsx = await service.export(tenantId, reportId, as('manager'), 'xlsx');
        expect(xlsx.filename).toBe('resumen-comercial-2026-11-19.xlsx');
        const book = openXlsx(new Uint8Array(xlsx.buffer));
        expect(book.sheets.map((s) => s.name)).toEqual(['Informe', 'Ventas', 'Gastos', 'Gastos por categoría', 'Costo', 'Nómina', 'Roto', 'Últimas ventas']);
        const rowsOf = (i: number) => book.readSheet(i).rows.map((r) => r.cells.map((c) => (c && 'v' in c ? c.v : null)));
        const cover = rowsOf(0);
        expect(cover[0]![0]).toBe('Resumen comercial');
        expect(cover.some((r) => r[0] === 'Período' && r[1] === 'Este mes')).toBe(true);
        expect(cover.some((r) => r[0] === 'Comparación')).toBe(true);
        const ventas = rowsOf(1);
        expect(ventas).toContainEqual(['Ventas', 1300000]);
        expect(ventas.some((r) => String(r[0]).startsWith('Antes') && r[1] === 50000)).toBe(true);
        expect(ventas).toContainEqual(['Variación (%)', 2500]);
        expect(rowsOf(3)).toContainEqual(['Oficina', 200000, 500000, -60]);
        expect(rowsOf(5).some((r) => String(r[0] ?? '').includes('No tienes acceso'))).toBe(true);
        const table = rowsOf(7);
        expect(table.some((r) => r.includes('Acme'))).toBe(true);
        const all = JSON.stringify([...Array(book.sheets.length).keys()].map(rowsOf));
        for (const secret of ['Costo interno', '111111', '222222', '4000000']) expect(all).not.toContain(secret);
        // El admin baja el costo.
        const adminBook = openXlsx(new Uint8Array((await service.export(tenantId, reportId, as('admin'), 'xlsx')).buffer));
        expect(JSON.stringify(adminBook.readSheet(4).rows)).toContain('333333');
    });

    it('envío programado del informe por el SMTP de la empresa, con el PDF y sin lo oculto; «Enviarme una prueba» sólo a quien la pide', async () => {
        const target = { kind: 'report' as const, id: reportId };
        const sub = await subs.createFor(tenantId, target, as('manager'), {
            enabled: true,
            frequency: 'weekly',
            weekdays: [1],
            month_day: 1,
            hour: 8,
            minute: 0,
            time_zone: null,
            recipient_user_ids: [u.viewer],
            recipient_emails: ['socio@externo.test'],
            subject: '',
            message: 'Buenos días.',
            attach_pdf: true,
        });
        expect(upserts.filter((x) => x.id === `dashsub:${sub.id}`).pop()?.repeat).toEqual({ pattern: '0 8 * * 1', tz: 'America/Bogota' });
        expect((await subs.listFor(tenantId, target, as('manager'))).map((s) => s.id)).toEqual([sub.id]);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.id, sub.id)));
        expect(row).toMatchObject({ reportId, dashboardId: null });

        capture.sent.length = 0;
        const test = await subs.sendTestFor(tenantId, target, as('manager'), { ...baseInput(), recipient_emails: ['nadie@externo.test'] });
        expect(test).toEqual({ status: 'sent', sent_to: ['manager@informes.test'], error: null });
        expect(capture.sent).toHaveLength(1);
        expect(capture.sent[0]!.subject).toBe('[Prueba] Resumen de «Resumen comercial»');

        await smtp.update(tenantId, { host: '127.0.0.1', port: fake.port, secure: false, user: 'u', pass: 'p', from: 'reportes@informes.test' });
        fake.received.length = 0;
        const result = await subs.run(tenantId, sub.id);
        expect(result).toMatchObject({ status: 'sent', error: null });
        expect(result.sent_to.sort()).toEqual(['socio@externo.test', 'viewer@informes.test']);
        expect(fake.received).toHaveLength(2);
        const raw = fake.received[0]!;
        const parts = mimeParts(raw);
        const html = parts.find((p) => p.type === 'text/html')!.body;
        expect(html).toContain('Resumen comercial');
        expect(html).toContain('Buenos días.');
        expect(html).toContain('$1,300,000');
        expect(html).toContain('Ver el informe');
        expect(html).toContain(`https://app.informes.test/#/reports/${reportId}`);
        for (const secret of ['111111', '222222', '333333', '4000000', 'Costo interno']) expect(raw).not.toContain(secret);
        const pdf = parts.find((p) => p.type === 'application/pdf');
        expect(pdf?.filename).toBe('resumen-comercial-2026-11-19.pdf');
        expect(pdf!.body.startsWith('%PDF')).toBe(true);
        await smtp.clear(tenantId);
    });

    it('visibilidad: privado sólo para quien lo creó (y el admin); por roles; y sólo el dueño lo cambia', async () => {
        const priv = await service.create(tenantId, as('manager'), { name: 'Privado', blocks: [], visibility: 'private' } as never);
        const roles = await service.create(tenantId, as('manager'), { name: 'Para lectores', blocks: [], visibility: 'roles', allowed_roles: ['viewer'] } as never);
        const ids = async (who: DashboardViewer) => (await service.list(tenantId, who)).map((r) => r.id);
        expect(await ids(as('viewer'))).toEqual(expect.arrayContaining([reportId, roles.id]));
        expect(await ids(as('viewer'))).not.toContain(priv.id);
        expect(await ids(as('agent'))).not.toContain(roles.id);
        expect(await ids(as('admin'))).toEqual(expect.arrayContaining([reportId, priv.id, roles.id]));
        await expect(service.get(tenantId, priv.id, as('viewer'))).rejects.toMatchObject({ status: 404 });
        await expect(service.bundle(tenantId, priv.id, as('agent'))).rejects.toMatchObject({ status: 404 });
        await expect(service.update(tenantId, reportId, as('viewer'), { name: 'Mío' })).rejects.toMatchObject({ status: 403 });
        await expect(service.update(tenantId, priv.id, as('viewer'), { name: 'Mío' })).rejects.toMatchObject({ status: 404 });
        // Un bloque de una lista de OTRA empresa no se guarda.
        await expect(
            service.update(tenantId, reportId, as('manager'), {
                blocks: [{ id: 'z', type: 'widget', widget: { type: 'kpi', list_id: otherListId, title: 'Z', config: {} } }] as ReportBlock[],
            }),
        ).rejects.toMatchObject({ status: 400 });
        // Duplicar: una copia de quien la pide, sin sus envíos.
        const copy = await service.duplicate(tenantId, reportId, as('admin'));
        expect(copy).toMatchObject({ name: 'Resumen comercial (copia)', created_by: u.admin });
        expect(copy.blocks).toEqual((await service.get(tenantId, reportId, as('admin'))).blocks);
        expect(await subs.listFor(tenantId, { kind: 'report', id: copy.id }, as('admin'))).toEqual([]);
        // Borrar: sus envíos salen de la cola y de la base.
        const s = await subs.createFor(tenantId, { kind: 'report', id: copy.id }, as('admin'), baseInput());
        await service.remove(tenantId, copy.id, as('admin'));
        expect(removed).toContain(`dashsub:${s.id}`);
        const left = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboardSubscriptions).where(eq(dashboardSubscriptions.id, s.id)));
        expect(left).toEqual([]);
        const actions = (await withTenant(pg.db, tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.tenantId, tenantId)))).map((a) => a.action);
        expect(actions).toEqual(expect.arrayContaining(['report.create', 'report.duplicate', 'report.delete']));
    });

    it('renombrar (por el esquema, como el controlador) no borra los bloques ni los ajustes', async () => {
        const before = await service.get(tenantId, reportId, as('admin'));
        expect(before.blocks.length).toBeGreaterThan(0);
        // Zod 4 rellenaba `blocks: []` cuando no llegaba (v0.1.469).
        const body = updateReportSchema.parse({ name: before.name });
        expect(Object.keys(body)).toEqual(['name']);
        const after = await service.update(tenantId, reportId, as('admin'), body);
        expect(after.blocks).toEqual(before.blocks);
        expect(after.settings).toEqual(before.settings);
    });

    it('RLS: los informes de una empresa no se ven ni se escriben desde otra', async () => {
        const seen = await withTenant(pg.db, otherTenantId, (tx) => tx.select().from(reports));
        expect(seen.map((r) => r.id)).not.toContain(reportId);
        await expect(
            withTenant(pg.db, otherTenantId, (tx) => tx.insert(reports).values({ tenantId, name: 'Colado', createdBy: u.admin })),
        ).rejects.toThrow();
        const own = await withTenant(pg.db, tenantId, (tx) => tx.select().from(reports));
        expect(own.map((r) => r.id)).toContain(reportId);
        await expect(service.get(otherTenantId, reportId, { userId: u.admin, role: 'admin' })).rejects.toMatchObject({ status: 404 });
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
