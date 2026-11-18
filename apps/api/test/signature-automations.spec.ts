import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocumentStarter, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import { AiToolRegistry, type AiToolContext, type AiToolResult } from '../src/ai/tools/registry';
import { SignatureTools } from '../src/ai/tools/signature-tools';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { automationRuns, automations, memberships, signatureRequests, signatureSigners, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DocumentsService } from '../src/documents/documents.service';
import { EventWebhookHub, type OutgoingEvent } from '../src/event-webhooks/event-hub';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { SignaturesService, signatureTokenFor } from '../src/signatures/signatures.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class Mailbox implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
    to(email: string): MailMessage[] {
        return this.sent.filter((m) => m.to === email);
    }
}

const noHooks: HookCaptureStore = {
    lpush: () => Promise.resolve(1),
    ltrim: () => Promise.resolve('OK'),
    expire: () => Promise.resolve(1),
    lrange: () => Promise.resolve([]),
};

type LogEntry = { action: string; status: string; message: string; details?: Record<string, unknown> };

/**
 * v0.1.447 (D6, ADR-S107) — la firma electrónica en las automatizaciones: la
 * acción «Pedir firma» (con firmantes por variables y `{{firma.enlace}}` para
 * el paso siguiente), el disparador «Cuando cambia una firma» con
 * `{{firma.x}}`, la prueba que no pide nada, y los webhooks de eventos.
 */
describe('D6 — firma electrónica en las automatizaciones (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let docs: DocumentsService;
    let svc: SignaturesService;
    let engine: AutomationEngine;
    let autos: AutomationsService;
    let connectors: ConnectorsService;
    let mailbox: Mailbox;
    let jobs: TriggerEvent[];
    let outgoing: OutgoingEvent[];
    let tenantId: number;
    let admin: Actor;
    let f: Record<string, Field>;
    let templateId: number;
    let png: string;
    let askId = 0;
    const k = (key: string): string => `f${f[key]!.id}`;
    const ip = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 Chrome/120.0' };

    /** Corre lo encolado (como el worker) hasta que no quede nada del disparador pedido. */
    const drain = async (only?: TriggerEvent['trigger']): Promise<TriggerEvent[]> => {
        const ran: TriggerEvent[] = [];
        for (let round = 0; round < 6; round++) {
            await new Promise((r) => setTimeout(r, 30));
            const batch = jobs.splice(0);
            if (batch.length === 0) break;
            for (const ev of batch) {
                if (only && ev.trigger !== only) continue;
                ran.push(ev);
                await engine.process(ev);
            }
        }
        return ran;
    };
    const runsOf = (automationId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)));

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url);
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const act = new ActivityService(tenantDb, new ActivityRepository(), lists);
        jobs = [];
        outgoing = [];
        const hub = new EventWebhookHub();
        hub.subscribe((e) => void outgoing.push(e));
        const dispatcher = new AutomationDispatcher(undefined, pg.db, undefined, hub, new NotifyHub());
        dispatcher.setQueue({ add: (_name: string, data: unknown) => (jobs.push(data as TriggerEvent), Promise.resolve()) } as never);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, act, dispatcher, new RelationsRepository());
        const env = loadEnv({ FILES_SIGNING_SECRET: 'test-secret', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-sigauto-'))), env);
        const audit = new AuditService(tenantDb);
        docs = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, audit);
        mailbox = new Mailbox();
        const mail = new MailService(env, mailbox);
        svc = new SignaturesService(pg.db, tenantDb, lists, fieldsSvc, recs, files, docs, act, audit, redis as never, env, mail, new NotifyHub(), undefined, rt, undefined, dispatcher);
        connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            mail,
            connectors,
            undefined,
            dispatcher,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { get: () => recs } as never,
        );
        engine.setSignatures(svc);
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            lists,
            new AutomationScheduler(),
            noHooks,
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            dispatcher,
            undefined,
            engine,
            audit,
        );
        const svgSig = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><path d="M10 70 C 60 10, 110 90, 160 40 S 260 60, 290 30" stroke="#111" stroke-width="5" fill="none"/></svg>');
        png = `data:image/png;base64,${(await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: svgSig }]).png().toBuffer()).toString('base64')}`;

        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Gómez' }).returning();
        admin = { userId: u!.id, role: 'admin' };
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise', settings: { branding: { app_name: 'Acme SAS' } } }).returning();
        tenantId = t!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: u!.id, role: 'admin' }));

        await lists.create(tenantId, { name: 'Contratos' });
        f = {};
        const mk = async (def: Parameters<FieldsService['create']>[2]): Promise<void> => {
            f[def.slug as string] = await fieldsSvc.create(tenantId, 'contratos', def);
        };
        await mk({ label: 'Cliente', type: 'text', slug: 'cliente' });
        await mk({ label: 'Correo', type: 'email', slug: 'correo' });
        await mk({ label: 'Enlace de firma', type: 'text', slug: 'enlace' });
        await mk({ label: 'Bitácora', type: 'long_text', slug: 'bitacora' });
        await mk({ label: 'Contrato firmado', type: 'file', slug: 'contrato' });
        await mk({
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'firmado', label: 'Firmado' }] },
        });
        const design = buildDocumentStarter('cuenta_cobro', { fields: { cliente: 'cliente' } }).design;
        templateId = (await docs.create(tenantId, admin.userId, 'contratos', { name: 'Contrato de servicios', filename: 'Contrato', design })).id;
    }, 180_000);

    afterAll(async () => {
        await redis?.quit().catch(() => undefined);
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    it('«Pedir firma» con firmantes por variables deja {{firma.enlace}}; «Cuando cambia una firma» corre al firmar y al terminar', async () => {
        const ask = await autos.create(tenantId, 'contratos', {
            name: 'Pedir firma del contrato',
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [
                {
                    type: 'request_signature',
                    config: {
                        source: 'template',
                        template_id: templateId,
                        signers: [{ name: '{{cliente}}', email: '{{correo}}', role: 'Cliente' }],
                        verify: 'none',
                        send_email: false,
                        status_field: 'estado',
                        status_value: 'firmado',
                        save_field: 'contrato',
                    },
                },
                { type: 'update_field', config: { values: { enlace: '{{firma.enlace}}' } } },
            ] as never,
        });
        askId = ask.id;
        const onSign = await autos.create(tenantId, 'contratos', {
            name: 'Avisar firmas',
            trigger_type: 'signature_event',
            trigger_config: { signature_events: ['signed', 'completed'] },
            actions: [{ type: 'update_field', config: { values: { bitacora: '{{firma.evento}} · {{firma.firmante}} · {{firma.firmaron}}/{{firma.total}} · {{firma.estado}}' } } }] as never,
        });

        const rec = await recs.create(tenantId, admin, 'contratos', { data: { [k('cliente')]: 'Beta Ltda.', [k('correo')]: 'Carla@Beta.co', [k('estado')]: 'pendiente' } });
        await drain();

        // La solicitud nació, sin correo (se manda el enlace por otro lado), y el enlace quedó en el registro.
        const reqs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(signatureRequests).where(eq(signatureRequests.recordId, rec.id)));
        expect(reqs).toHaveLength(1);
        expect(reqs[0]!.createdBy).toBeNull();
        const signers = await withTenant(pg.db, tenantId, (tx) => tx.select().from(signatureSigners).where(eq(signatureSigners.requestId, reqs[0]!.id)));
        expect(signers.map((s) => [s.name, s.email, s.role])).toEqual([['Beta Ltda.', 'carla@beta.co', 'Cliente']]);
        expect(mailbox.to('carla@beta.co')).toHaveLength(0);
        const afterAsk = await recs.get(tenantId, admin, 'contratos', rec.id);
        expect(String(afterAsk.data[k('enlace')])).toMatch(/^https:\/\/app\.test\/firmar\/\d+-[0-9a-f]{40}$/);
        const askRun = (await runsOf(ask.id))[0]!;
        expect(askRun.status).toBe('success');
        expect((askRun.actionsLog as LogEntry[]).find((l) => l.action === 'request_signature')!.message).toContain('{{firma.enlace}}');
        // «Se pidió» no está entre los eventos elegidos: el disparador no corrió.
        expect(await runsOf(onSign.id)).toHaveLength(0);

        // Firmar con el enlace que dejó la automatización (sin código): corre «Alguien firmó» y «Firmaron todos».
        const token = signatureTokenFor(svc, { tenantId, id: reqs[0]!.id, linkVersion: reqs[0]!.linkVersion }, signers[0]!.id);
        expect(String(afterAsk.data[k('enlace')])).toContain(token);
        const res = await svc.sign(token, { name: 'Carla Ruiz', kind: 'drawn', image: png, consent: true }, ip);
        expect(res).toEqual({ status: 'completed', signed_available: true });
        const ran = await drain('signature_event');
        expect(ran.map((e) => e.signature?.evento)).toEqual(['signed', 'completed']);
        expect(ran[1]!.signature!.pdf).toMatch(/^https:\/\/app\.test\//);
        const runs = await runsOf(onSign.id);
        expect(runs).toHaveLength(2);
        const done = await recs.get(tenantId, admin, 'contratos', rec.id);
        expect(done.data[k('bitacora')]).toBe('Firmaron todos · Carla Ruiz · 1/1 · Firmado');
        // Lo que pidió «Cuando firmen todos…» de la acción.
        expect(done.data[k('estado')]).toBe('firmado');
        expect(done.data[k('contrato')]).toContainEqual(expect.any(Number));

        // Webhooks de eventos: firmó y firmaron todos, sin el enlace personal.
        const sig = outgoing.filter((e) => e.event.startsWith('signature.'));
        expect(sig.map((e) => e.event)).toEqual(['signature.signed', 'signature.completed']);
        expect(sig[1]!.signature).toMatchObject({ title: expect.any(String), status: 'completed', signed: 1, total: 1, signer: { name: 'Carla Ruiz', email: 'carla@beta.co' } });
        // (el registro sí lo tiene en un campo: lo guardó la automatización a propósito).
        expect(JSON.stringify(sig.map((e) => e.signature))).not.toContain('/firmar/');
    });

    it('«No quiso firmar» y «Se anuló» traen el motivo; una plantilla elegida filtra', async () => {
        const rec = await recs.create(tenantId, admin, 'contratos', { data: { [k('cliente')]: 'Gamma', [k('correo')]: 'g@gamma.co' } });
        await drain();
        const onNo = await autos.create(tenantId, 'contratos', {
            name: 'Avisar rechazos',
            trigger_type: 'signature_event',
            trigger_config: { signature_events: ['declined', 'voided'], signature_template_ids: [templateId] },
            actions: [{ type: 'update_field', config: { values: { bitacora: '{{firma.evento}}: {{firma.motivo}}' } } }] as never,
        });
        const base = {
            record_id: rec.id,
            title: '',
            signers: [{ name: 'Gamma', email: 'g@gamma.co', role: '' }],
            order: 'parallel' as const,
            message: '',
            expires_days: 30,
            verify: 'none' as const,
            remind_days: 0,
            send_email: false,
            on_complete: { save_field_id: null, status_field_id: null, status_value: null, date_field_id: null },
        };
        const a = await svc.create(tenantId, admin, 'contratos', { ...base, source: { kind: 'template', template_id: templateId } });
        await drain();
        const token = signatureTokenFor(svc, { tenantId, id: a.id, linkVersion: 1 }, a.signers[0]!.id);
        await svc.decline(token, { reason: 'El valor no es el acordado' }, ip);
        await drain('signature_event');
        expect((await recs.get(tenantId, admin, 'contratos', rec.id)).data[k('bitacora')]).toBe('Alguien no quiso firmar: El valor no es el acordado');

        const b = await svc.create(tenantId, admin, 'contratos', { ...base, source: { kind: 'template', template_id: templateId } });
        await svc.void(tenantId, admin, 'contratos', b.id, { reason: 'Se cambió el contrato' });
        await drain('signature_event');
        expect((await recs.get(tenantId, admin, 'contratos', rec.id)).data[k('bitacora')]).toBe('Se anuló: Se cambió el contrato');
        expect(await runsOf(onNo.id)).toHaveLength(2);
    });

    it('«Probar» no pide la firma; un correo que queda vacío falla con el motivo', async () => {
        const rec = await recs.create(tenantId, admin, 'contratos', { data: { [k('cliente')]: 'Delta', [k('correo')]: 'd@delta.co' } });
        await drain();
        const before = await withTenant(pg.db, tenantId, (tx) => tx.select().from(signatureRequests));
        const actions = [
            { type: 'request_signature', config: { template_id: templateId, signers: [{ name: '{{cliente}}', email: '{{correo}}' }] } },
            { type: 'update_field', config: { values: { enlace: '{{firma.enlace}}' } } },
        ];
        const res = await autos.testRun(tenantId, 'contratos', { trigger_type: 'record_created', trigger_config: {}, actions: actions as never, record_id: rec.id, real_steps: [] }, admin);
        const steps = res.steps as unknown as LogEntry[];
        expect(steps.find((s) => s.action === 'request_signature')!.message).toContain('Pediría la firma');
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(signatureRequests))).toHaveLength(before.length);

        // Sin correo en el registro: «Pedir firma» (la automatización del primer caso) falla y lo dice.
        const empty = await recs.create(tenantId, admin, 'contratos', { data: { [k('cliente')]: 'Sin correo' } });
        await drain();
        const run = (await runsOf(askId)).find((r) => r.recordId === empty.id)!;
        expect(run.status).toBe('failed');
        expect((run.actionsLog as LogEntry[])[0]!.message).toContain('sin un correo válido');
    });

    it('guardar la acción sin plantilla ni personas da el motivo', async () => {
        await expect(
            autos.create(tenantId, 'contratos', {
                name: 'Mal armada',
                trigger_type: 'record_created',
                trigger_config: {},
                actions: [{ type: 'request_signature', config: { source: 'template', signers: [] } }] as never,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });
    it('asistente/MCP: ver las firmas, proponer pedir una y armar automatizaciones con la firma', async () => {
        const store = new ProposalsStore(redis as never);
        const tools = new SignatureTools(lists, fieldsSvc, recs, store, svc);
        const structure = new StructureTools(tenantDb, lists, fieldsSvc, null as never, autos, null as never, null as never, store, connectors, null as never, null as never, docs);
        const registry = new AiToolRegistry();
        structure.registerInto(registry);
        tools.registerInto(registry);
        const ctx: AiToolContext = { tenantId, userId: admin.userId, role: 'admin' };
        const run = (name: string, input: unknown): Promise<AiToolResult> => registry.execute(ctx, name, input);
        const errorOf = (res: AiToolResult): string => {
            expect(res.isError).toBe(true);
            return String((res.content as { error: string }).error);
        };
        const stored = async (res: AiToolResult) => {
            expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
            return (await store.get(tenantId, (res.content as { proposal_id: string }).proposal_id))!;
        };

        // Un lector ve la lectura, no la propuesta.
        const viewerTools = registry.listFor('viewer').map((t) => t.name);
        expect(viewerTools).toContain('list_signature_requests');
        expect(viewerTools).not.toContain('propose_request_signature');

        const rec = await recs.create(tenantId, admin, 'contratos', { data: { [k('cliente')]: 'Épsilon', [k('correo')]: 'e@epsilon.co' } });
        await drain();
        expect(errorOf(await run('propose_request_signature', { list: 'contratos', record_id: rec.id, template: 'No existe', signers: [{ name: 'E', email: 'e@epsilon.co' }] }))).toMatch(
            /Contrato de servicios/,
        );
        expect(
            errorOf(await run('propose_request_signature', { list: 'contratos', record_id: rec.id, template: templateId, file_field: 'contrato', signers: [{ name: 'E', email: 'e@epsilon.co' }] })),
        ).toMatch(/uno de los dos/);
        expect(
            errorOf(
                await run('propose_request_signature', {
                    list: 'contratos',
                    record_id: rec.id,
                    template: 'Contrato de servicios',
                    signers: [{ name: 'E', email: 'e@epsilon.co' }],
                    on_complete: { status_field: 'estado', status_value: 'Archivado' },
                }),
            ),
        ).toMatch(/no es una opción/);
        const res = await run('propose_request_signature', {
            list: 'contratos',
            record_id: rec.id,
            template: 'contrato de servicios',
            signers: [{ name: 'Elena Ruiz', email: 'e@epsilon.co', role: 'Cliente' }],
            on_complete: { status_field: 'estado', status_value: 'Firmado', save_field: 'contrato' },
        });
        expect(res.proposal?.preview.changes).toContainEqual({ label: 'Firma 1', from: null, to: 'Elena Ruiz <e@epsilon.co> (Cliente)' });
        expect(res.proposal?.preview.changes).toContainEqual({ label: 'Estado', from: null, to: 'firmado' });
        const out = await tools.apply(ctx, await stored(res));
        expect(out.message).toContain('Elena Ruiz');
        const [req] = await svc.listForRecord(tenantId, admin, 'contratos', rec.id);
        expect(req).toMatchObject({ status: 'pending', on_complete: { status_field_id: f.estado!.id, status_value: 'firmado', save_field_id: f.contrato!.id } });

        // Leer: con quién va y sin enlaces personales.
        const listed = (await run('list_signature_requests', { list: 'contratos', record_id: rec.id })).content as { total: number; firmas: Array<Record<string, unknown>> };
        // (la automatización del primer caso también pidió una al crear el registro)
        expect(listed.total).toBe(2);
        expect(listed.firmas.find((x) => x.codigo === req!.code)).toMatchObject({ registro: 'Épsilon', documento: req!.title, estado: 'Esperando firmas' });
        expect(JSON.stringify(listed)).not.toContain('/firmar/');
        expect(((await run('list_signature_requests', { list: 'contratos', record_id: rec.id, status: ['completed'] })).content as { total: number }).total).toBe(0);

        // Automatizaciones: el disparador por nombre de plantilla y la acción con la opción por etiqueta.
        expect(errorOf(await run('propose_create_automation', { list: 'contratos', name: 'X', trigger_type: 'signature_event', trigger_config: { signature_events: ['firmó'] }, actions: [{ type: 'update_field', config: { values: { estado: 'firmado' } } }] }))).toMatch(
            /desconocido/,
        );
        let auto = await run('propose_create_automation', {
            list: 'contratos',
            name: 'Al firmar todos',
            trigger_type: 'signature_event',
            trigger_config: { signature_events: ['completed'], signature_templates: ['Contrato de servicios'] },
            actions: [{ type: 'update_field', config: { values: { bitacora: 'Firmó {{firma.firmante}}' } } }],
        });
        expect(auto.proposal?.preview.automation?.trigger).toBe('Cuando firman todos un documento');
        await structure.apply(ctx, await stored(auto));
        const [saved] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automations).where(eq(automations.name, 'Al firmar todos')));
        expect(saved!.triggerConfig).toMatchObject({ signature_events: ['completed'], signature_template_ids: [templateId] });

        expect(
            errorOf(
                await run('propose_create_automation', {
                    list: 'contratos',
                    name: 'Sin personas',
                    trigger_type: 'record_created',
                    actions: [{ type: 'request_signature', config: { template: 'Contrato de servicios', signers: [] } }],
                }),
            ),
        ).toMatch(/al menos una persona/);
        auto = await run('propose_create_automation', {
            list: 'contratos',
            name: 'Pedir firma al crear',
            trigger_type: 'record_created',
            is_active: false,
            actions: [
                {
                    type: 'request_signature',
                    config: { template: 'Contrato de servicios', signers: [{ name: '{{cliente}}', email: 'correo' }], status_field: 'estado', status_value: 'Firmado' },
                },
            ],
        });
        expect(auto.proposal?.preview.automation?.actions).toEqual(['Pide la firma de un documento a 1 persona']);
        await structure.apply(ctx, await stored(auto));
        const [askSaved] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automations).where(eq(automations.name, 'Pedir firma al crear')));
        expect((askSaved!.actions as Array<{ config: Record<string, unknown> }>)[0]!.config).toMatchObject({ template_id: templateId, source: 'template', status_value: 'firmado' });
    });
});
