import type { CreateFieldInput } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, automations, automationVersions, connections, fields, lists, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { encryptSecret } from '../src/common/secret-box';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { ConnectionSwapService } from '../src/automations/connection-swap.service';
import { AuditService } from '../src/audit/audit.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.400 — «Reemplazar en automatizaciones»: pasar a la conexión de Whats las
 * acciones que usan la de WAS y las llamadas directas a la API de WAS (el caso
 * real: «Llamar webhook externo» a https://was.imagina.cloud/api/send/whatsapp
 * con la cuenta, el número y el mensaje escritos a mano).
 */
const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const rt = new RealtimeService();
const WAS_URL = 'https://was.imagina.cloud/api/send/whatsapp';
const direct = (account: string, extra: Record<string, unknown> = {}) => ({
    type: 'call_webhook',
    config: {
        url: WAS_URL,
        method: 'POST',
        content_type: 'form',
        body_params: [
            { key: 'account', value: account },
            { key: 'recipient', value: '{{celular}}' },
            { key: 'message', value: `Hola {{cliente}} (${account})` },
        ],
        ...extra,
    },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- se navega el árbol de acciones en las aserciones
type Loose = Record<string, any>;

describe('Reemplazar la conexión en las automatizaciones (v0.1.400)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let autos: AutomationsService;
    let connectors: ConnectorsService;
    let swap: ConnectionSwapService;
    let tenantId: number;
    let adminId: number;
    let otherId: number;
    let wasId: number;
    let whatsId: number;
    let httpId: number;
    let gmailId: number;
    let privateWhatsId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: KEY }), memoryOAuthStore(), audit, memoryIntegrationApps());
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            undefined as never,
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            new AutomationDispatcher(),
            undefined,
            undefined,
            audit,
        );
        swap = new ConnectionSwapService(connectors, autos, tenantDb, audit);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        const [o] = await pg.db.insert(users).values({ email: 'beto@acme.test', passwordHash: 'x', name: 'Beto' }).returning();
        adminId = u!.id;
        otherId = o!.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: adminId, role: 'admin' },
                { tenantId, userId: otherId, role: 'manager' },
            ]),
        );
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationVersions).where(eq(automationVersions.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(connections).where(eq(connections.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        const defs: CreateFieldInput[] = [
            { label: 'Cliente', type: 'text', slug: 'cliente' },
            { label: 'Celular', type: 'phone', slug: 'celular' },
            { label: 'Estado', type: 'text', slug: 'estado' },
        ];
        for (const d of defs) await fieldsService.create(tenantId, 'clientes', d);
        const insert = (values: Partial<typeof connections.$inferInsert> & { provider: string; name: string }) =>
            withTenant(pg.db, tenantId, (tx) =>
                tx
                    .insert(connections)
                    .values({
                        tenantId,
                        baseUrl: '',
                        authType: 'none',
                        config: {},
                        secrets: { token: encryptSecret('clave', KEY) },
                        visibility: 'workspace',
                        ownerUserId: adminId,
                        createdBy: adminId,
                        ...values,
                    })
                    .returning({ id: connections.id }),
            ).then((r) => r[0]!.id);
        wasId = await insert({ provider: 'whatsapp', name: 'WhatsApp (WAS) · +57300', config: { account_label: '+57300', fields: { account: 'vieja' } } });
        whatsId = await insert({ provider: 'whatsapp_web', name: 'WhatsApp (Whats) · +57317', config: { account_label: '+57317 · Café', fields: { account: '1' } } });
        httpId = await insert({ provider: 'http', name: 'API de WAS', baseUrl: 'https://was.imagina.cloud', authType: 'body', config: { auth_key: 'secret' } });
        gmailId = await insert({ provider: 'gmail', name: 'Gmail · ana@acme.test', authType: 'oauth2', config: { account_label: 'ana@acme.test' } });
        privateWhatsId = await insert({ provider: 'whatsapp_web', name: 'WhatsApp de Beto', visibility: 'private', ownerUserId: otherId, createdBy: otherId });
    });

    const auto = (name: string, actions: unknown[], isActive = true) =>
        autos
            .create(tenantId, 'clientes', { name, trigger_type: 'record_created', trigger_config: {}, actions: actions as never, is_active: isActive })
            .then((a) => a.id);
    const actionsOf = async (id: number) =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(automations).where(eq(automations.id, id))))[0]!.actions as Array<Loose>;
    const wasText = (connectionId: number, message: string) => ({
        type: 'connector_action',
        config: { connection_id: connectionId, action_key: 'send_text', values: { recipient: '{{celular}}', message } },
    });

    it('vista previa: agrupa por origen (la conexión de WAS y cada cuenta llamada directo) y dice lo que no se puede pasar solo', async () => {
        await auto('Bienvenida', [
            { ...wasText(wasId, 'Hola'), condition: [{ slug: 'estado', op: 'eq', value: 'nuevo' }] },
            { type: 'if_else', config: { condition: [], then_actions: [direct('abc')], else_actions: [{ type: 'connector_action', config: { connection_id: gmailId, action_key: 'send_email', values: { to: 'x@y.co', subject: 'S', body: 'B' } } }] } },
        ]);
        await auto(
            'Recordatorio',
            [{ type: 'for_each_linked', config: { relation_field_id: 1, actions: [wasText(wasId, 'Bucle')] } }, direct('xyz'), direct('xyz', { response_name: 'envio' })],
            false,
        );

        const preview = await swap.preview(tenantId, adminId, 'admin', whatsId);
        expect(preview.target).toMatchObject({ id: whatsId, app: 'whatsapp_web', app_name: 'WhatsApp (Whats)' });
        const byKey = Object.fromEntries(preview.sources.map((s) => [s.key, s]));
        expect(Object.keys(byKey).sort()).toEqual([`conn:${wasId}`, 'was:was.imagina.cloud|abc', 'was:was.imagina.cloud|xyz']);
        expect(byKey[`conn:${wasId}`]).toMatchObject({ kind: 'connection', label: 'WhatsApp (WAS) · +57300', actions: 2, skipped: 0 });
        expect(byKey[`conn:${wasId}`]!.automations.map((a) => [a.name, a.actions, a.is_active])).toEqual([
            ['Bienvenida', 1, true],
            ['Recordatorio', 1, false],
        ]);
        expect(byKey['was:was.imagina.cloud|abc']).toMatchObject({ kind: 'was_api', label: 'Llamadas directas a la API de WAS', detail: 'was.imagina.cloud · cuenta …abc', actions: 1 });
        expect(byKey['was:was.imagina.cloud|abc']!.notes[0]).toMatch(/número de la conexión elegida/);
        expect(byKey['was:was.imagina.cloud|xyz']).toMatchObject({ actions: 1, skipped: 1 });
        expect(byKey['was:was.imagina.cloud|xyz']!.automations[0]!.skipped[0]!.reason).toMatch(/respuestas\.envio/);

        // Gmail no aparece: no es de la misma app.
        expect(preview.sources.some((s) => s.key === `conn:${gmailId}`)).toBe(false);
    });

    it('aplica sólo lo elegido: número, mensaje y condición quedan; guarda la versión anterior y la bitácora', async () => {
        const a = await auto('Bienvenida', [
            { ...wasText(wasId, 'Hola'), condition: [{ slug: 'estado', op: 'eq', value: 'nuevo' }] },
            { type: 'if_else', config: { condition: [], then_actions: [direct('abc')], else_actions: [] } },
        ]);
        const b = await auto('Recordatorio', [{ type: 'for_each_linked', config: { relation_field_id: 1, actions: [wasText(wasId, 'Bucle')] } }, direct('xyz')]);

        const res = await swap.apply(tenantId, adminId, 'admin', whatsId, [`conn:${wasId}`, 'was:was.imagina.cloud|abc']);
        expect(res).toEqual({ automations: 2, actions: 3, failed: [] });

        const A = await actionsOf(a);
        expect(A[0]).toEqual({
            type: 'connector_action',
            config: { connection_id: whatsId, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'Hola' } },
            condition: [{ slug: 'estado', op: 'eq', value: 'nuevo' }],
        });
        expect(A[1]!.config.then_actions[0]).toEqual({
            type: 'connector_action',
            config: { connection_id: whatsId, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'Hola {{cliente}} (abc)' } },
        });
        const B = await actionsOf(b);
        expect(B[0]!.config.actions[0].config.connection_id).toBe(whatsId);
        expect(B[1]).toEqual(direct('xyz')); // la otra cuenta no se eligió: queda igual

        // Historial: la versión anterior y la nueva con la nota.
        const versions = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(automationVersions).where(eq(automationVersions.automationId, a)).orderBy(automationVersions.id),
        );
        expect(versions.at(-1)!.note).toBe('Cambió la conexión de 2 acciones a «WhatsApp (Whats) · +57317»');
        expect((versions.at(-2)!.actions as Array<Loose>)[0]!.config.connection_id).toBe(wasId);

        const [log] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'connection.swap'))),
        );
        expect(log).toMatchObject({ userId: adminId, targetId: whatsId });

        // La conexión de WAS ya no la usa nadie (también se cuenta dentro de «Repetir por cada vinculado»).
        const list = await connectors.list(tenantId, adminId, 'admin');
        expect(list.find((c) => c.id === wasId)!.usage_count).toBe(0);
        expect(list.find((c) => c.id === whatsId)!.usage_count).toBe(3);

        // Repetirlo no cambia nada más.
        expect(await swap.apply(tenantId, adminId, 'admin', whatsId, [`conn:${wasId}`])).toEqual({ automations: 0, actions: 0, failed: [] });
    });

    it('de vuelta a WAS: el archivo lleva su tipo; y una llamada relativa a la conexión de la API también se reconoce', async () => {
        const a = await auto('Factura', [
            { type: 'connector_action', config: { connection_id: whatsId, action_key: 'send_media', values: { recipient: '{{celular}}', url: '{{pdf.link}}', caption: 'Tu factura' } } },
            { type: 'call_webhook', config: { url: '/api/send/whatsapp', connection_id: httpId, body_params: [{ key: 'recipient', value: '{{celular}}' }, { key: 'message', value: 'Hola' }] } },
        ]);
        const preview = await swap.preview(tenantId, adminId, 'admin', wasId);
        expect(preview.sources.map((s) => s.key).sort()).toEqual([`conn:${whatsId}`, 'was:was.imagina.cloud|']);
        await swap.apply(tenantId, adminId, 'admin', wasId, preview.sources.map((s) => s.key));
        const A = await actionsOf(a);
        expect(A[0]!.config).toEqual({ connection_id: wasId, action_key: 'send_media', values: { recipient: '{{celular}}', url: '{{pdf.link}}', caption: 'Tu factura', kind: 'document' } });
        expect(A[1]).toEqual({ type: 'connector_action', config: { connection_id: wasId, action_key: 'send_text', values: { recipient: '{{celular}}', message: 'Hola' } } });
    });

    it('la conexión destino tiene que verse, ser de la galería y no ser de «Mi calendario»', async () => {
        await expect(swap.preview(tenantId, adminId, 'admin', privateWhatsId)).rejects.toMatchObject({ status: 404 });
        await expect(swap.preview(tenantId, adminId, 'admin', httpId)).rejects.toMatchObject({ status: 404 });
        await expect(swap.preview(tenantId, adminId, 'admin', 999999)).rejects.toMatchObject({ status: 404 });
        // Beto sí ve la suya.
        const mine = await swap.preview(tenantId, otherId, 'manager', privateWhatsId);
        expect(mine.target.id).toBe(privateWhatsId);
    });
});
