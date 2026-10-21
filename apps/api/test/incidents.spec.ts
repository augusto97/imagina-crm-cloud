import { incidentLink } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine, DUE_DATE_MAX_ATTEMPTS } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { encryptSecret } from '../src/common/secret-box';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { automationRuns, connections, incidents, memberships, notifications, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { IncidentsService } from '../src/incidents/incidents.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { NotificationsService } from '../src/notifications/notifications.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class NullCaptures implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(1);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}
const nullMail: MailTransport = { name: 'null', send: () => Promise.resolve() };

describe('v0.1.285 — problemas (puro)', () => {
    it('cada problema lleva a donde se arregla', () => {
        expect(incidentLink({ source: 'automation', source_id: 7, list_slug: 'facturas' })).toBe('/lists/facturas/automations/7');
        expect(incidentLink({ source: 'mail', source_id: null, list_slug: null })).toBe('/settings?s=correo');
        expect(incidentLink({ source: 'connection', source_id: 3, list_slug: null })).toBe('/settings?s=conectores');
        expect(incidentLink({ source: 'store_sync', source_id: 3, list_slug: null })).toBe('/settings/stores/3');
        expect(incidentLink({ source: 'sql_sync', source_id: 4, list_slug: null })).toBe('/settings/sql/4');
        expect(incidentLink({ source: 'ai_field', source_id: 9, list_slug: 'clientes' })).toBe('/lists/clientes/edit?s=campos&field=9');
        expect(incidentLink({ source: 'form', source_id: 2, list_slug: 'leads' })).toBe('/lists/leads/edit?s=formularios');
    });
});

describe('v0.1.285 — problemas (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let svc: IncidentsService;
    let hub: IncidentHub;
    let engine: AutomationEngine;
    let automations: AutomationsService;
    let recs: RecordsService;
    let tenantId: number;
    let listId: number;
    let ana: number; // admin
    let beto: number; // manager
    let caro: number; // agent (dueña de cosas)
    let tenantDbRef: TenantDb;
    let fNombre = '';
    let fVence = '';
    const sent: MailMessage[] = [];
    const pending: Array<Promise<unknown>> = [];
    const settle = async (): Promise<void> => {
        while (pending.length > 0) await Promise.all(pending.splice(0));
    };
    const inbox = (userId: number) =>
        withTenant(pg.db, tenantId, (tx) =>
            tx
                .select()
                .from(notifications)
                .where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId)))
                .orderBy(notifications.id),
        );
    const open = () =>
        withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(incidents).where(and(eq(incidents.tenantId, tenantId), sql`${incidents.resolvedAt} is null`)),
        );
    const report = (r: Partial<IncidentReport> = {}): Promise<void> =>
        svc.report({
            tenantId,
            key: 'automation:1',
            source: 'automation',
            sourceId: 1,
            title: 'Falló la automatización «Enviar factura»',
            message: 'Enviar email: SMTP rechazó la contraseña',
            ...r,
        });

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        const tenantDb = new TenantDb(pg.db);
        tenantDbRef = tenantDb;
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const mail = { enqueue: (m: MailMessage) => (sent.push(m), Promise.resolve()) };
        const notifs = new NotificationsService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            rt,
            mail as never,
            redis as never,
            loadEnv({ APP_BASE_URL: 'https://app.test' }),
        );
        hub = new IncidentHub();
        svc = new IncidentsService(tenantDb, notifs, redis as never);
        // Igual que onModuleInit, pero esperable desde el test.
        hub.subscribe({
            report: (r) => void pending.push(svc.report(r)),
            resolve: (t, k) => void pending.push(svc.resolve(t, k)),
            resolvePrefix: (t, p) => void pending.push(svc.resolvePrefix(t, p)),
        });

        const scheduler = new AutomationScheduler();
        const connectors = new ConnectorsService(
            tenantDb,
            pg.db,
            loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }),
            memoryOAuthStore(),
            new AuditService(tenantDb),
            memoryIntegrationApps(),
        );
        automations = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            lists,
            scheduler,
            new NullCaptures(),
            connectors,
            undefined,
            undefined,
            undefined,
            hub,
        );
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), nullMail),
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            hub,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'inc', name: 'Inc' }).returning();
        tenantId = t!.id;
        const mk = async (email: string, name: string) =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = await mk('ana@inc.test', 'Ana');
        beto = await mk('beto@inc.test', 'Beto');
        caro = await mk('caro@inc.test', 'Caro');
        const cliente = await mk('cli@inc.test', 'Cliente');
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: ana, role: 'admin' },
                { tenantId, userId: beto, role: 'manager' },
                { tenantId, userId: caro, role: 'agent' },
                { tenantId, userId: cliente, role: 'client' },
            ]),
        );
        listId = (await lists.create(tenantId, { name: 'Facturas', slug: 'facturas' })).id;
        fNombre = `f${(await fieldsSvc.create(tenantId, 'facturas', { label: 'Nombre', type: 'text', slug: 'nombre' })).id}`;
        await fieldsSvc.create(tenantId, 'facturas', { label: 'Estado', type: 'text', slug: 'estado' });
        fVence = `f${(await fieldsSvc.create(tenantId, 'facturas', { label: 'Vence', type: 'date', slug: 'vence' })).id}`;
        // Un error REAL de la base dentro de una acción: un trigger que rechaza
        // registros marcados «boom».
        await pg.db.execute(sql`
            create or replace function inc_boom() returns trigger as $$
            begin
                if new.data::text like '%boom%' then raise exception 'boom desde la base'; end if;
                return new;
            end $$ language plpgsql`);
        await pg.db.execute(sql`create trigger inc_boom before insert on records for each row execute function inc_boom()`);
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        sent.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(incidents).where(eq(incidents.tenantId, tenantId));
            await tx.delete(notifications).where(eq(notifications.tenantId, tenantId));
        });
    });

    it('abre el problema y avisa a los admins y a quien lo creó, por la campana y por el correo de la plataforma', async () => {
        await report({ ownerId: caro });
        const [row] = await open();
        expect(row).toMatchObject({ count: 1, source: 'automation', ownerId: caro });
        expect((await inbox(ana)).map((n) => n.kind)).toEqual(['failure']);
        expect((await inbox(caro)).map((n) => n.title)).toEqual(['Falló la automatización «Enviar factura»']);
        // El manager no creó nada ni es admin: no se entera.
        expect(await inbox(beto)).toEqual([]);
        // El correo NO sale por el correo de la empresa (podría ser lo que falla).
        expect(sent).toHaveLength(2);
        expect(sent.every((m) => m.tenantId === undefined)).toBe(true);
        expect(sent[0]!.html).toContain('Ver el problema');
        expect(sent[0]!.text).toContain('/#/settings?s=problemas');
    });

    it('las fallas repetidas se juntan: una fila, un aviso; al día siguiente, «Sigue fallando»', async () => {
        await report();
        await report({ message: 'Enviar email: timeout' });
        await report({ message: 'Enviar email: timeout otra vez' });
        const rows = await open();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.count).toBe(3);
        expect(rows[0]!.message).toBe('Enviar email: timeout otra vez');
        expect(await inbox(ana)).toHaveLength(1);

        await withTenant(pg.db, tenantId, (tx) =>
            tx.update(incidents).set({ notifiedAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(incidents.tenantId, tenantId)),
        );
        await report({ message: 'Enviar email: sigue roto' });
        const n = await inbox(ana);
        expect(n).toHaveLength(2);
        expect(n[1]!.title).toBe('Sigue fallando: falló la automatización «Enviar factura»');
        expect(n[1]!.body).toContain('Falló 4 veces');
        expect(n[1]!.body).toContain('sigue roto');
    });

    it('se cierra solo al volver a funcionar; si vuelve a fallar, abre otro y avisa de nuevo', async () => {
        await report();
        await svc.resolve(tenantId, 'automation:1');
        expect(await open()).toEqual([]);
        // Sin marca en Redis el camino feliz no toca la base.
        await svc.resolve(tenantId, 'automation:1');
        await report();
        expect(await open()).toHaveLength(1);
        expect(await inbox(ana)).toHaveLength(2);
    });

    it('listado: el admin ve todo; los demás, sólo lo que crearon. Marcar resuelto respeta lo mismo', async () => {
        await report({ key: 'connection:5', source: 'connection', sourceId: 5, ownerId: caro, title: 'La conexión «WA» dejó de funcionar' });
        await report({ key: 'mail', source: 'mail', sourceId: null, title: 'No se están enviando los correos de la empresa' });
        const all = await svc.list(tenantId, { userId: ana, role: 'admin' }, { status: 'open', limit: 100 });
        expect(all.open).toBe(2);
        const mine = await svc.list(tenantId, { userId: caro, role: 'agent' }, { status: 'open', limit: 100 });
        expect(mine.items.map((i) => i.source)).toEqual(['connection']);
        const mailId = all.items.find((i) => i.source === 'mail')!.id;
        await expect(svc.markResolved(tenantId, { userId: caro, role: 'agent' }, mailId)).rejects.toThrow(/Sólo un admin/);
        await svc.markResolved(tenantId, { userId: ana, role: 'admin' }, mailId);
        const resolved = await svc.list(tenantId, { userId: ana, role: 'admin' }, { status: 'resolved', limit: 100 });
        expect(resolved.items[0]).toMatchObject({ source: 'mail', resolved_by_name: 'Ana' });
    });

    it('cerrar por prefijo: lo que corría sobre una conexión borrada', async () => {
        await report({ key: 'store_sync:7:run', source: 'store_sync' });
        await report({ key: 'store_sync:7:push', source: 'store_sync' });
        await report({ key: 'store_sync:70:run', source: 'store_sync' });
        await svc.resolvePrefix(tenantId, 'store_sync:7:');
        expect((await open()).map((r) => r.key)).toEqual(['store_sync:70:run']);
    });

    it('motor: una acción que falla abre el problema de esa automatización; una corrida buena lo cierra', async () => {
        const auto = await automations.create(tenantId, 'facturas', {
            name: 'Avisar al ERP',
            trigger_type: 'record_created',
            actions: [{ type: 'call_webhook', config: { url: 'http://127.0.0.1:9/hook' } }],
        });
        const rec = await recs.create(tenantId, { userId: ana, role: 'admin' }, 'facturas', { data: { [fNombre]: 'A' } });
        await engine.process({ tenantId, listId, recordId: rec.id, trigger: 'record_created', after: {} });
        await settle();
        const [row] = await open();
        expect(row).toMatchObject({ key: `automation:${auto.id}`, listId, sourceId: auto.id });
        expect(row!.title).toBe('Falló la automatización «Avisar al ERP»');
        expect(row!.message).toMatch(/^Llamar webhook: .*\(registro #\d+\)$/);

        await automations.update(tenantId, 'facturas', auto.id, {
            actions: [{ type: 'update_field', config: { values: { estado: 'ok' } } }],
        });
        await engine.process({ tenantId, listId, recordId: rec.id, trigger: 'record_created', after: {} });
        await settle();
        expect(await open()).toEqual([]);
    });

    it('motor: un error de la base en una acción ya no borra la corrida (savepoint) y las demás acciones siguen', async () => {
        const auto = await automations.create(tenantId, 'facturas', {
            name: 'Duplicar con error',
            trigger_type: 'record_created',
            actions: [
                { type: 'create_record', config: { values: { nombre: 'boom' } } },
                { type: 'update_field', config: { values: { estado: 'siguió' } } },
            ],
        });
        const rec = await recs.create(tenantId, { userId: ana, role: 'admin' }, 'facturas', { data: { [fNombre]: 'B' } });
        await engine.process({ tenantId, listId, recordId: rec.id, trigger: 'record_created', after: {} });
        await settle();
        const runs = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto.id)),
        );
        expect(runs).toHaveLength(1);
        expect(runs[0]!.status).toBe('failed');
        expect(runs[0]!.actionsLog.map((l) => l.status)).toEqual(['failed', 'success']);
        expect(runs[0]!.error).toContain('boom desde la base');
        const [after] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.id, rec.id)));
        expect(Object.values(after!.data as Record<string, unknown>)).toContain('siguió');
        expect((await open()).map((r) => r.key)).toContain(`automation:${auto.id}`);
        await automations.remove(tenantId, 'facturas', auto.id);
        await settle();
        expect((await open()).map((r) => r.key)).not.toContain(`automation:${auto.id}`);
    });

    it(`motor: por vencimiento, una automatización rota se reintenta ${DUE_DATE_MAX_ATTEMPTS} veces por registro y para`, async () => {
        const auto = await automations.create(tenantId, 'facturas', {
            name: 'Cobrar vencidas',
            trigger_type: 'due_date_reached',
            trigger_config: { due_field: 'vence' },
            actions: [{ type: 'call_webhook', config: { url: 'http://127.0.0.1:9/cobrar' } }],
        });
        await recs.create(tenantId, { userId: ana, role: 'admin' }, 'facturas', { data: { [fNombre]: 'C', [fVence]: '2020-01-01' } });
        for (let i = 0; i < DUE_DATE_MAX_ATTEMPTS + 2; i++) await engine.runDueDate(tenantId, auto.id);
        await settle();
        const runs = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto.id)),
        );
        expect(runs).toHaveLength(DUE_DATE_MAX_ATTEMPTS);
        const [row] = (await open()).filter((r) => r.key === `automation:${auto.id}`);
        expect(row!.count).toBe(DUE_DATE_MAX_ATTEMPTS);
        // Un solo aviso para las tres fallas.
        expect((await inbox(ana)).filter((n) => n.title.includes('Cobrar vencidas'))).toHaveLength(1);
    });

    it('el listado de automatizaciones trae la última corrida', async () => {
        const auto = await automations.create(tenantId, 'facturas', {
            name: 'Con historial',
            trigger_type: 'record_created',
            actions: [{ type: 'call_webhook', config: { url: 'http://127.0.0.1:9/x' } }],
        });
        const rec = await recs.create(tenantId, { userId: ana, role: 'admin' }, 'facturas', { data: { [fNombre]: 'D' } });
        await engine.process({ tenantId, listId, recordId: rec.id, trigger: 'record_created', after: {} });
        await settle();
        const listed = (await automations.list(tenantId, 'facturas')).find((a) => a.id === auto.id)!;
        expect(listed.last_run).toMatchObject({ status: 'failed' });
        expect(listed.last_run!.error).toBeTruthy();
    });

    it('correo de la empresa: una falla definitiva abre «No se están enviando…»; un envío bueno lo cierra', async () => {
        let broken = true;
        const transport: MailTransport = {
            name: 'test',
            send: () => (broken ? Promise.reject(new Error('535 Authentication failed')) : Promise.resolve()),
        };
        const mail = new MailService(loadEnv(), transport, undefined, undefined, undefined, undefined, hub);
        await expect(mail.sendNow({ tenantId, to: 'x@y.test', subject: 'Hola', text: 'Hola' })).rejects.toThrow(/535/);
        await settle();
        const [row] = (await open()).filter((r) => r.key === 'mail');
        expect(row!.title).toBe('No se están enviando los correos de la empresa');
        expect(row!.message).toContain('535 Authentication failed');
        // Un correo de CUENTA (sin empresa) que falla no le abre nada a nadie.
        await expect(mail.sendNow({ to: 'x@y.test', subject: 'Reset', text: 'r' })).rejects.toThrow();
        await settle();
        expect((await open()).filter((r) => r.key === 'mail')).toHaveLength(1);
        broken = false;
        await mail.sendNow({ tenantId, to: 'x@y.test', subject: 'Hola', text: 'Hola' });
        await settle();
        expect((await open()).filter((r) => r.key === 'mail')).toEqual([]);
    });

    it('conector: una credencial que no se puede leer abre el problema de esa conexión (antes, sólo el log)', async () => {
        const connectors = new ConnectorsService(
            tenantDbRef,
            pg.db,
            loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }),
            memoryOAuthStore(),
            new AuditService(tenantDbRef),
            memoryIntegrationApps(),
            undefined,
            hub,
        );
        const [conn] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(connections)
                .values({
                    tenantId,
                    name: 'ERP',
                    baseUrl: 'https://erp.example',
                    authType: 'bearer',
                    secrets: { token: encryptSecret('tok', 'OTRA-clave-distinta-a-la-del-servidor') },
                    ownerUserId: caro,
                })
                .returning(),
        );
        await expect(connectors.resolveParts(tenantId, conn!.id)).rejects.toThrow(/no se puede descifrar/);
        await settle();
        const [row] = (await open()).filter((r) => r.key === `connection:${conn!.id}`);
        expect(row).toMatchObject({ source: 'connection', ownerId: caro, title: 'La conexión «ERP» dejó de funcionar' });
        // La tarjeta de la conexión también lo muestra.
        const [after] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, conn!.id)));
        expect(after!.lastCheckOk).toBe(false);
        expect((await inbox(caro)).some((n) => n.kind === 'failure')).toBe(true);
    });
});
