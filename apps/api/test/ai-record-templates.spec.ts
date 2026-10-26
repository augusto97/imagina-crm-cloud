import type { Field } from '@imagina-base/shared';
import { jsonbKeyForField } from '@imagina-base/shared';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { ConversationsStore } from '../src/ai/conversations.store';
import { ProposalsService } from '../src/ai/proposals.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import { DataTools } from '../src/ai/tools/data-tools';
import { templateForModel, templateSpecToContent } from '../src/ai/tools/record-template-spec';
import { AiToolRegistry, type AiToolContext } from '../src/ai/tools/registry';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { ChecklistsRepository } from '../src/checklists/checklists.repository';
import { ChecklistsService } from '../src/checklists/checklists.service';
import { memberships, tenants, users } from '../src/db/schema';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordTemplatesService } from '../src/record-templates/record-templates.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * C6 / A9 — el asistente y el MCP: leen las plantillas de registro, proponen
 * una nueva (en el vocabulario de slugs, validada con el MISMO saneo que la
 * interfaz) y crean registros desde una (subtareas y checklists incluidos).
 */
describe('Asistente IA — plantillas de registro (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let lists: ListsService;
    let fields: FieldsService;
    let recordsSvc: RecordsService;
    let templates: RecordTemplatesService;
    let checklists: ChecklistsService;
    let registry: AiToolRegistry;
    let proposals: ProposalsService;
    let tenantId: number;
    let admin: AiToolContext;
    let manager: AiToolContext;
    let agent: AiToolContext;
    let caroId: number;
    let f: Record<string, Field>;
    const exec = (ctx: AiToolContext, name: string, input: unknown) => registry.execute(ctx, name, input);
    /** El error corregible que vuelve al modelo (no una excepción). */
    const errorOf = async (p: ReturnType<typeof exec>): Promise<string> => {
        const r = await p;
        expect(r.isError).toBe(true);
        return String((r.content as { error?: unknown }).error ?? '');
    };
    const key = (slug: string): string => jsonbKeyForField(f[slug]!.id);

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const dispatcher = new AutomationDispatcher();
        recordsSvc = new RecordsService(tenantDb, new RecordsRepository(), lists, fields, rt, activity, dispatcher, new RelationsRepository());
        checklists = new ChecklistsService(tenantDb, lists, fields, recordsSvc, new RecordsRepository(), new ChecklistsRepository(), activity, rt, dispatcher);
        templates = new RecordTemplatesService(tenantDb, lists, fields, recordsSvc, new RecordsRepository(), checklists, new ChecklistsRepository(), activity, rt, new AuditService(tenantDb));
        const store = new ProposalsStore(redis);
        const data = new DataTools(lists, fields, recordsSvc, new AggregateService(tenantDb, lists, fields), store, undefined, undefined, templates);
        // El StructureTools no se ejecuta aquí; sólo para el dispatch del applier.
        const structure = new StructureTools(tenantDb, lists, fields, null as never, null as never, null as never, null as never, store, null as never, null as never, null as never);
        registry = new AiToolRegistry();
        data.registerInto(registry);
        proposals = new ProposalsService(store, new ConversationsStore(redis), structure, new AuditService(tenantDb), data);

        const [t] = await pg.db.insert(tenants).values({ slug: 'plantillas', name: 'Plantillas SA', plan: 'pro' }).returning();
        tenantId = t!.id;
        const mk = async (email: string) => (await pg.db.insert(users).values({ email, name: email.split('@')[0]!, passwordHash: 'x' }).returning())[0]!.id;
        const adminId = await mk('admin@p.local');
        const managerId = await mk('manager@p.local');
        const agentId = await mk('agente@p.local');
        caroId = await mk('caro@p.local');
        await pg.db.insert(memberships).values([
            { tenantId, userId: adminId, role: 'admin' },
            { tenantId, userId: managerId, role: 'manager' },
            { tenantId, userId: agentId, role: 'agent' },
            { tenantId, userId: caroId, role: 'agent' },
        ]);
        admin = { tenantId, userId: adminId, role: 'admin' };
        manager = { tenantId, userId: managerId, role: 'manager' };
        agent = { tenantId, userId: agentId, role: 'agent' };

        const list = await lists.create(tenantId, { name: 'Proyectos' });
        const mkf = (label: string, slug: string, type: Field['type'], config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
            fields.create(tenantId, String(list.id), { label, slug, type, config, ...extra });
        f = {
            nombre: await mkf('Nombre', 'nombre', 'text', {}, { is_required: true }),
            estado: await mkf('Estado', 'estado', 'select', { options: [{ value: 'nuevo', label: 'Nuevo' }, { value: 'curso', label: 'En curso' }] }),
            responsable: await mkf('Responsable', 'responsable', 'user'),
            inicio: await mkf('Inicio', 'inicio', 'date'),
            entrega: await mkf('Entrega', 'entrega', 'date'),
            total: await mkf('Total', 'total', 'computed', { operation: 'concat', inputs: [] }),
        };
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
    });

    it('del vocabulario del modelo a la plantilla: slugs, etiquetas de opción, fechas y personas', () => {
        const all = Object.values(f);
        const content = templateSpecToContent(
            {
                list: 'proyectos',
                name: 'X',
                values: { estado: 'En curso', responsable: { person: 'creator' }, entrega: { date: { days: 3, from: 'inicio', business_days: true } } },
                subtasks: [{ title: 'Kickoff', values: { responsable: { person: { field: 'responsable' } } } }],
                checklists: [{ name: 'Arranque', items: [{ text: 'Contrato', assignee: caroId, due: { days: 1 } }] }],
                record_description: '**Alcance** del proyecto',
            },
            all,
        );
        expect(content.values[key('estado')]).toEqual({ mode: 'fixed', value: 'curso' });
        expect(content.values[key('responsable')]).toEqual({ mode: 'person', person: { kind: 'creator' } });
        expect(content.values[key('entrega')]).toEqual({ mode: 'relative_date', date: { days: 3, from_field_id: f.inicio!.id, business_days: true, time: null } });
        expect(content.subtasks[0]!.values[key('responsable')]).toEqual({ mode: 'person', person: { kind: 'field', field_id: f.responsable!.id } });
        expect(content.checklists[0]!.items[0]).toEqual({ text: 'Contrato', assignee: { kind: 'user', user_id: caroId }, due: { days: 1, from_field_id: null, business_days: false, time: null } });
        expect(JSON.stringify(content.record_description)).toContain('bold');
        // Errores corregibles, en lenguaje claro.
        expect(() => templateSpecToContent({ list: 'p', name: 'X', values: { nope: 'x' } }, all)).toThrow(/no existe el campo «nope»/);
        expect(() => templateSpecToContent({ list: 'p', name: 'X', values: { total: 'x' } }, all)).toThrow(/no se completa en una plantilla/);
        expect(() => templateSpecToContent({ list: 'p', name: 'X', values: { nombre: { date: { days: 1 } } } }, all)).toThrow(/no es una fecha/);
        expect(() => templateSpecToContent({ list: 'p', name: 'X', kind: 'checklist' }, all)).toThrow(/exactamente UN checklist/);
        // Y de vuelta para get_list_schema.
        const described = templateForModel(
            { id: 9, list_id: 1, kind: 'record', name: 'X', description: null, icon: null, color: null, content, position: 0, created_by: null, created_at: '', updated_at: '' },
            all,
        );
        expect(described).toMatchObject({
            id: 9,
            values: { estado: 'curso', responsable: { person: 'creator' }, entrega: { date: '+3 días hábiles desde «Inicio»' } },
            subtasks: ['Kickoff'],
            checklists: [{ name: 'Arranque', items: [{ text: 'Contrato', assignee: caroId, due: '+1 día desde la creación' }] }],
        });
    });

    it('propose_create_record_template → aplicar crea la plantilla; managers sí, agentes no', async () => {
        expect(registry.listFor('agent').map((t) => t.name)).not.toContain('propose_create_record_template');
        expect(registry.listFor('manager').map((t) => t.name)).toContain('propose_create_record_template');
        const r = await exec(manager, 'propose_create_record_template', {
            list: 'proyectos',
            name: 'Proyecto estándar',
            values: { estado: 'Nuevo', responsable: { person: 'creator' } },
            subtasks: [{ title: 'Kickoff' }, { title: 'Diseño' }],
            checklists: [{ name: 'Arranque', items: [{ text: 'Contrato', assignee: caroId }] }],
        });
        const proposal = r.proposal!;
        expect(proposal.kind).toBe('create_record_template');
        expect(proposal.preview.changes).toEqual(
            expect.arrayContaining([
                { label: 'Estado', from: null, to: 'Nuevo' },
                { label: 'Responsable', from: null, to: 'Quien crea el registro' },
                { label: 'Subtarea', from: null, to: 'Kickoff' },
                { label: 'Checklist', from: null, to: 'Arranque (1 ítem)' },
            ]),
        );
        // Un nombre repetido o una persona de afuera rebotan ANTES de proponer.
        const applied = await proposals.apply(manager, proposal.id);
        expect(applied.result?.message).toBe('Plantilla «Proyecto estándar» creada.');
        expect(await errorOf(exec(manager, 'propose_create_record_template', { list: 'proyectos', name: 'proyecto estándar' }))).toMatch(/Ya hay una plantilla/);
        expect(await errorOf(exec(manager, 'propose_create_record_template', { list: 'proyectos', name: 'Otra', values: { responsable: { person: 999_999 } } }))).toMatch(
            /equipo/,
        );
        const saved = await templates.list(tenantId, 'proyectos');
        expect(saved.map((t) => t.name)).toEqual(['Proyecto estándar']);
    });

    it('propose_create_records con `template`: cada registro nace con sus subtareas y checklists', async () => {
        // El nombre es obligatorio y NO está en la plantilla: hay que darlo.
        expect(await errorOf(exec(admin, 'propose_create_records', { list: 'proyectos', template: 'Proyecto estándar', records: [{}] }))).toMatch(/obligatorio «nombre»/);
        expect(await errorOf(exec(admin, 'propose_create_records', { list: 'proyectos', template: 'No existe', records: [{ nombre: 'X' }] }))).toMatch(
            /Disponibles: «Proyecto estándar»/,
        );
        const r = await exec(admin, 'propose_create_records', { list: 'proyectos', template: 'proyecto ESTANDAR', records: [{ nombre: 'Web Acme' }, { nombre: 'App Beta', estado: 'curso' }] });
        const proposal = r.proposal!;
        expect(proposal.title).toContain('desde la plantilla «Proyecto estándar»');
        expect(proposal.summary).toContain('2 subtareas y 1 checklist');
        const applied = await proposals.apply(admin, proposal.id);
        expect(applied.result?.message).toBe('2 registros creados.');
        const page = await recordsSvc.list(tenantId, { userId: admin.userId, role: 'admin' }, 'proyectos', { limit: 50, sort_dir: 'desc' });
        const web = page.data.find((x) => x.data[key('nombre')] === 'Web Acme')!;
        const app = page.data.find((x) => x.data[key('nombre')] === 'App Beta')!;
        expect(web.data[key('estado')]).toBe('nuevo');
        expect(app.data[key('estado')]).toBe('curso');
        expect(web.data[key('responsable')]).toBe(admin.userId);
        expect(web.subtask_count).toBe(2);
        expect(web.checklist).toEqual({ done: 0, total: 1 });
        // query_records muestra el avance de los checklists.
        const q = await exec(admin, 'query_records', { list: 'proyectos', search: 'Web Acme' });
        const rows = (q.content as { rows: Array<Record<string, unknown>> }).rows;
        expect(rows[0]!.checklist).toBe('0/1');
        void agent;
    });
});
