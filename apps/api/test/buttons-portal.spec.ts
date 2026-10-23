import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AuditService } from '../src/audit/audit.service';
import { SessionService } from '../src/auth/session.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { ButtonsService } from '../src/buttons/buttons.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { RecordLayoutDataService } from '../src/dashboards/record-layout-data.service';
import { activity, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DocumentsService } from '../src/documents/documents.service';
import { DomainsService } from '../src/domains/domains.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { PortalService, type PortalActor } from '../src/portal/portal.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * Campo «Botón» en el portal del cliente. La regla: el botón aparece si está
 * en el diseño del portal y sólo hace lo que el portal ya permite — abrir un
 * enlace (con las variables que el cliente ve), cambiar campos que el diseño
 * deja editar y PDF publicados. Correr una automatización (que corre con los
 * permisos del equipo) exige la regla explícita del botón.
 */
class CapturingMail implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(m: MailMessage): Promise<void> {
        this.sent.push(m);
        return Promise.resolve();
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(0),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

class MemoryQueue {
    readonly jobs = new Map<string, { data: TriggerEvent; state: string }>();
    add(_name: string, data: TriggerEvent, opts: { jobId?: string }): Promise<{ id: string }> {
        const id = opts.jobId ?? `job-${this.jobs.size + 1}`;
        this.jobs.set(id, { data, state: 'waiting' });
        return Promise.resolve({ id });
    }
    getJob(): Promise<unknown> {
        return Promise.resolve(undefined);
    }
}

describe('Campo «Botón» en el portal del cliente (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let records: RecordsService;
    let automations: AutomationsService;
    let portal: PortalService;
    let sessions: SessionService;
    let queue: MemoryQueue;
    let tenantId: number;
    let admin: Actor;
    const id = { nombre: 0, telefono: 0, estado: 0, interno: 0, wa: 0, aprobar: 0, cambiarNombre: 0, auto: 0, oculto: 0 };
    let client = { userId: 0, recordId: 0 };
    const mailbox = new CapturingMail();
    const actor = (): PortalActor => ({ userId: client.userId, tenantId });

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.imagina.test', FILES_SIGNING_SECRET: 'x' });
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const act = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const dispatcher = new AutomationDispatcher();
        queue = new MemoryQueue();
        dispatcher.setQueue(queue as never);
        records = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, act, dispatcher, new RelationsRepository());
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-btnp-'))), env);
        const audit = new AuditService(tenantDb);
        const docs = new DocumentsService(tenantDb, lists, fieldsSvc, records, files, audit);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), noHooks, connectors);
        const buttons = new ButtonsService(tenantDb, lists, fieldsSvc, records, act, dispatcher, automations, docs, rt);
        const domains = new DomainsService(pg.db, env, files);
        domains.probeServing = () => Promise.resolve(false);
        portal = new PortalService(
            pg.db,
            redis,
            env,
            tenantDb,
            lists,
            (sessions = new SessionService(redis, env)),
            new MailService(env, mailbox),
            fieldsSvc,
            new CommentsRepository(),
            new ActivityRepository(),
            act,
            rt,
            dispatcher,
            files,
            domains,
            new RecordLayoutDataService(tenantDb, lists, fieldsSvc, records, new DashboardsService(tenantDb, new AggregateService(tenantDb, lists, fieldsSvc), records, fieldsSvc)),
            docs,
            undefined,
            undefined,
            records,
            undefined,
            undefined,
            buttons,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [a] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        admin = { userId: a!.id, role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: a!.id, tenantId, role: 'admin' }));

        await lists.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        id.nombre = (await fieldsSvc.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' })).id;
        id.telefono = (await fieldsSvc.create(tenantId, 'clientes', { label: 'Teléfono', type: 'phone', slug: 'telefono' })).id;
        id.interno = (await fieldsSvc.create(tenantId, 'clientes', { label: 'Nota interna', type: 'text', slug: 'interno' })).id;
        id.estado = (
            await fieldsSvc.create(tenantId, 'clientes', {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'aprobada', label: 'Aprobada' }] },
            })
        ).id;
        id.wa = (
            await fieldsSvc.create(tenantId, 'clientes', {
                label: 'Escribir',
                type: 'button',
                slug: 'escribir',
                config: { label: 'WhatsApp', actions: [{ type: 'open_url', url: 'https://wa.me/{{telefono}}?text=Hola {{nombre}} {{interno}}' }] },
            })
        ).id;
        id.aprobar = (
            await fieldsSvc.create(tenantId, 'clientes', {
                label: 'Aprobar',
                type: 'button',
                slug: 'aprobar',
                config: {
                    label: 'Aprobar cotización',
                    actions: [{ type: 'update_fields', values: [{ field_id: id.estado, mode: 'set', value: 'aprobada' }] }],
                    disabled_if: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: id.estado, op: 'eq', value: 'aprobada' }] },
                    disabled_reason: 'Ya la aprobaste',
                },
            })
        ).id;
        id.cambiarNombre = (
            await fieldsSvc.create(tenantId, 'clientes', {
                label: 'Renombrar',
                type: 'button',
                slug: 'renombrar',
                config: { actions: [{ type: 'update_fields', values: [{ field_id: id.nombre, mode: 'set', value: 'Otro' }] }] },
            })
        ).id;
        id.auto = (
            await fieldsSvc.create(tenantId, 'clientes', { label: 'Avisar', type: 'button', slug: 'avisar', config: { actions: [{ type: 'run_automation' }] } })
        ).id;
        id.oculto = (
            await fieldsSvc.create(tenantId, 'clientes', {
                label: 'Interno',
                type: 'button',
                slug: 'boton_interno',
                config: { actions: [{ type: 'update_fields', values: [{ field_id: id.estado, mode: 'set', value: 'aprobada' }] }] },
            })
        ).id;
        await automations.create(tenantId, 'clientes', {
            name: 'Avisar al equipo',
            trigger_type: 'button_pressed',
            trigger_config: { button_field_id: id.auto },
            actions: [{ type: 'update_field', config: { values: { interno: 'avisado' } } }],
            is_active: true,
        } as never);

        // El diseño del portal: los datos (estado editable) y cuatro botones.
        await lists.update(tenantId, 'clientes', {
            settings: {
                portal: { enabled: true },
                portal_layout_v3: {
                    v: 3,
                    pages: [
                        {
                            id: 'inicio',
                            name: 'Inicio',
                            sections: [
                                {
                                    id: 's1',
                                    columns: [12],
                                    blocks: [
                                        [
                                            { id: 'datos', type: 'fields', config: { field_ids: [id.nombre, id.telefono] } },
                                            { id: 'estado', type: 'field', config: { field_id: id.estado, editable: true } },
                                            { id: 'b1', type: 'fields', config: { field_ids: [id.wa, id.aprobar, id.cambiarNombre, id.auto] } },
                                            { id: 'act', type: 'activity', config: { mode: 'all' } },
                                        ],
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        });

        client.recordId = (
            await records.create(tenantId, admin, 'clientes', {
                data: { [`f${id.nombre}`]: 'Ana SAS', [`f${id.telefono}`]: '+573001112233', [`f${id.interno}`]: 'deuda vieja', [`f${id.estado}`]: 'pendiente' },
            })
        ).id;
        const link = await portal.issue(tenantId, 'clientes', { record_id: client.recordId, email: 'ana@cliente.test' });
        const { sessionToken } = await portal.consume(link.token!);
        client = { ...client, userId: (await sessions.get(sessionToken))!.userId };
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    it('el portal recibe el estado de cada botón del diseño y sólo la parte visual de su config', async () => {
        const boot = await portal.me(actor());
        expect(Object.keys(boot.buttons).map(Number).sort((x, y) => x - y)).toEqual([id.wa, id.aprobar, id.cambiarNombre, id.auto].sort((x, y) => x - y));
        expect(boot.buttons[String(id.wa)]).toEqual({ disabled: false, reason: null, blocked: null });
        expect(boot.buttons[String(id.aprobar)]).toEqual({ disabled: false, reason: null, blocked: null });
        expect(boot.buttons[String(id.cambiarNombre)]!.blocked).toMatch(/no deja editar/);
        expect(boot.buttons[String(id.auto)]!.blocked).toMatch(/automatización/);
        // Del botón sólo viaja cómo se ve y el TIPO de sus acciones: ni el
        // enlace con sus variables, ni los valores, ni la condición.
        const wa = boot.fields.find((f) => f.id === id.wa)!;
        expect(wa.config).toEqual({ label: 'WhatsApp', actions: [{ type: 'open_url' }] });
        const aprobar = boot.fields.find((f) => f.id === id.aprobar)!;
        expect(aprobar.config).not.toHaveProperty('disabled_if');
    });

    it('abrir un enlace sólo usa lo que el cliente ve (la nota interna no viaja)', async () => {
        const res = await portal.pressButton(actor(), id.wa);
        expect(res.ok).toBe(true);
        const open = res.actions[0] as { type: string; url: string };
        expect(open.url).toBe('https://wa.me/573001112233?text=Hola%20Ana%20SAS%20');
        expect(open.url).not.toContain('deuda');
    });

    it('cambia sólo campos editables del portal; después queda deshabilitado con su motivo', async () => {
        const res = await portal.pressButton(actor(), id.aprobar);
        expect(res.ok).toBe(true);
        const rec = await records.get(tenantId, admin, 'clientes', client.recordId);
        expect(rec.data[`f${id.estado}`]).toBe('aprobada');
        expect((await portal.me(actor())).buttons[String(id.aprobar)]).toEqual({ disabled: true, reason: 'Ya la aprobaste', blocked: null });
        await expect(portal.pressButton(actor(), id.aprobar)).rejects.toMatchObject({ response: { code: 'button_disabled' } });
        // La actividad lo registra con el cliente como autor.
        const rows = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(activity).where(and(eq(activity.recordId, client.recordId), eq(activity.action, 'button_pressed'))),
        );
        expect(rows.some((r) => r.userId === client.userId)).toBe(true);
        const feed = await portal.myActivity(actor(), 50);
        expect(feed.some((e) => e.action === 'button_pressed' && (e.diff as { button: { label: string } }).button.label === 'Aprobar cotización')).toBe(true);
    });

    it('un campo que el portal no deja editar, una automatización sin permiso o un botón fuera del diseño: no', async () => {
        await expect(portal.pressButton(actor(), id.cambiarNombre)).rejects.toMatchObject({ response: { code: 'portal_button_forbidden' } });
        await expect(portal.pressButton(actor(), id.auto)).rejects.toMatchObject({ response: { code: 'portal_button_forbidden' } });
        await expect(portal.pressButton(actor(), id.oculto)).rejects.toMatchObject({ response: { code: 'portal_button_not_found' } });
        expect([...queue.jobs.values()].some((j) => j.data.trigger === 'button_pressed')).toBe(false);
        const rec = await records.get(tenantId, admin, 'clientes', client.recordId);
        expect(rec.data[`f${id.nombre}`]).toBe('Ana SAS');
    });

    it('con la regla explícita del botón, el cliente corre la automatización', async () => {
        await fieldsSvc.update(tenantId, 'clientes', String(id.auto), {
            config: { actions: [{ type: 'run_automation' }], portal_run_automation: true },
        });
        expect((await portal.me(actor())).buttons[String(id.auto)]!.blocked).toBeNull();
        const res = await portal.pressButton(actor(), id.auto);
        expect(res.ok).toBe(true);
        const job = [...queue.jobs.values()].find((j) => j.data.trigger === 'button_pressed');
        expect(job?.data.button).toMatchObject({ field_id: id.auto, label: 'Avisar' });
        expect(job?.data.recordId).toBe(client.recordId);
    });
});
