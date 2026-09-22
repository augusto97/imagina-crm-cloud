import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { buildWebhookRequest } from '../src/automations/webhook-request';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { auditLog, automations, connections, lists, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.196 (ADR-S22) — conectores con Postgres real.
 *
 * Lo que de verdad hay que demostrar: que el secreto queda CIFRADO en la fila
 * y no vuelve nunca al cliente, que una empresa no ve las credenciales de
 * otra, y que la conversión saca los secretos de dentro de las
 * automatizaciones sin romperlas.
 */
const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';

describe('Conectores (v0.1.196)', () => {
    let pg: TestPg;
    let svc: ConnectorsService;
    let tenantA: number;
    let tenantB: number;
    let adminId: number;
    let managerId: number;
    let listId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        svc = new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: KEY }), new AuditService(tenantDb));
        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        const [admin] = await pg.db
            .insert(users)
            .values({ email: 'admin@test.local', passwordHash: 'x', name: 'Ada' })
            .returning();
        const [manager] = await pg.db
            .insert(users)
            .values({ email: 'manager@test.local', passwordHash: 'x', name: 'Marta' })
            .returning();
        adminId = admin!.id;
        managerId = manager!.id;
        const [list] = await pg.db
            .insert(lists)
            .values({ tenantId: tenantA, slug: 'clientes', name: 'Clientes' })
            .returning();
        listId = list!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, async (tx) => {
                await tx.delete(automations).where(eq(automations.tenantId, t));
                await tx.delete(connections).where(eq(connections.tenantId, t));
                await tx.delete(auditLog).where(eq(auditLog.tenantId, t));
            });
        }
        await pg.db
            .update(tenants)
            .set({ settings: {} })
            .where(eq(tenants.id, tenantA));
    });

    function base(over: Record<string, unknown> = {}) {
        return {
            provider: 'http' as const,
            name: 'WhatsApp',
            base_url: 'https://was.example.com',
            auth_type: 'bearer' as const,
            auth_key: '',
            headers: [],
            query_params: [],
            actions: [],
            visibility: 'workspace' as const,
            ...over,
        };
    }

    it('cifra el secreto en la fila y NUNCA lo devuelve: sólo un hint', async () => {
        const dto = await svc.create(tenantA, adminId, 'admin', base({ token: 'tok-secretisimo-9876' }));
        expect(dto.secret_state).toBe('ok');
        expect(dto.secret_hint).toBe('••••9876');
        expect(JSON.stringify(dto)).not.toContain('tok-secretisimo-9876');

        // La fila cruda: cifrada de verdad, no "confiamos" en el service.
        const [row] = await pg.db.select().from(connections).where(eq(connections.id, dto.id));
        const stored = (row!.secrets as Record<string, string>).token!;
        expect(stored.startsWith('enc:v1:')).toBe(true);
        expect(stored).not.toContain('tok-secretisimo-9876');

        // Y resolviendo para ejecutar, la credencial vuelve a estar en claro.
        const parts = await svc.resolveParts(tenantA, dto.id);
        expect(parts?.headers['authorization']).toBe('Bearer tok-secretisimo-9876');
    });

    it('la credencial llega ENTERA por el cable, no sólo en memoria', async () => {
        // Cadena completa: fila cifrada → descifrado → partes → builder →
        // socket. `safeWebhookFetch` bloquea loopback por SEC-03, así que el
        // pedido se manda con node:http, igual que el test del Content-Length
        // de v0.1.157; lo que se verifica es lo que el servidor RECIBE.
        const got: { auth?: string; body?: string; url?: string } = {};
        const server = createServer((req, res) => {
            let body = '';
            req.on('data', (c: Buffer) => (body += c.toString()));
            req.on('end', () => {
                got.auth = req.headers.authorization;
                got.url = req.url;
                got.body = body;
                res.writeHead(200).end('ok');
            });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        const port = (server.address() as AddressInfo).port;

        const dto = await svc.create(
            tenantA,
            adminId,
            'admin',
            base({ name: 'Cable', base_url: `http://127.0.0.1:${port}`, token: 'tok-por-el-cable' }),
        );
        const parts = await svc.resolveParts(tenantA, dto.id);
        const req = buildWebhookRequest(
            { url: '/send', method: 'POST', content_type: 'form', body_params: [{ key: 'msg', value: 'hola' }] },
            (raw) => String(raw ?? ''),
            { recordId: 1, listId: listId },
            parts,
        );
        expect(req.url).toBe(`http://127.0.0.1:${port}/send`);

        await new Promise<void>((resolve, reject) => {
            const r = request(req.url, { method: req.method, headers: req.headers }, (res) => {
                res.resume();
                res.on('end', () => resolve());
            });
            r.on('error', reject);
            r.end(req.body);
        });
        server.close();

        expect(got.auth).toBe('Bearer tok-por-el-cable');
        expect(got.url).toBe('/send');
        expect(got.body).toBe('msg=hola');
    });

    it('las credenciales no cruzan empresas', async () => {
        const mine = await svc.create(tenantA, adminId, 'admin', base({ token: 'abcd1234' }));
        await svc.create(tenantB, adminId, 'admin', base({ name: 'Otra', token: 'zzzz9999' }));
        const listA = await svc.list(tenantA, adminId, 'admin');
        expect(listA.map((c) => c.name)).toEqual(['WhatsApp']);
        expect(await svc.resolveParts(tenantB, mine.id)).toBeNull();
    });

    it('conexión del equipo = admin; la privada necesita que el admin la habilite', async () => {
        await expect(svc.create(tenantA, managerId, 'manager', base())).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
            svc.create(tenantA, managerId, 'manager', base({ visibility: 'private' })),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await svc.updateSettings(tenantA, { allow_private: true });
        const mia = await svc.create(
            tenantA,
            managerId,
            'manager',
            base({ name: 'Mi gateway', visibility: 'private', token: 'abcd1234' }),
        );
        expect(mia.visibility).toBe('private');
        // Sólo la ve su dueño; el admin ni siquiera la lista.
        expect((await svc.list(tenantA, managerId, 'manager')).map((c) => c.name)).toEqual(['Mi gateway']);
        expect(await svc.list(tenantA, adminId, 'admin')).toEqual([]);
    });

    it('rotar el secreto: vacío conserva, con valor cambia', async () => {
        const dto = await svc.create(tenantA, adminId, 'admin', base({ token: 'viejo-1111' }));
        const same = await svc.update(tenantA, adminId, 'admin', dto.id, { name: 'WhatsApp prod', token: '' });
        expect(same.name).toBe('WhatsApp prod');
        expect(same.secret_hint).toBe('••••1111');
        const rotated = await svc.update(tenantA, adminId, 'admin', dto.id, { token: 'nuevo-2222' });
        expect(rotated.secret_hint).toBe('••••2222');
        const parts = await svc.resolveParts(tenantA, dto.id);
        expect(parts?.headers['authorization']).toBe('Bearer nuevo-2222');
    });

    it('un secreto que ya no descifra se REPORTA, no se usa en silencio', async () => {
        const dto = await svc.create(tenantA, adminId, 'admin', base({ token: 'abcd1234' }));
        // Simula el cambio de SECRETS_KEY del servidor.
        const otro = new ConnectorsService(
            new TenantDb(pg.db),
            pg.db,
            loadEnv({ SECRETS_KEY: 'otra-clave-distinta-del-servidor' }),
            new AuditService(new TenantDb(pg.db)),
        );
        const [shown] = await otro.list(tenantA, adminId, 'admin');
        expect(shown!.secret_state).toBe('unreadable');
        expect(shown!.secret_hint).toBeNull();
        // Ejecutar con ella tiene que FALLAR: mandar la petición sin
        // credencial sería el fallo silencioso del SMTP de v0.1.150.
        await expect(otro.resolveParts(tenantA, dto.id)).rejects.toThrow(/no se puede descifrar/);
    });

    it('borrar una conexión en uso dice qué se rompe; con force borra igual', async () => {
        const dto = await svc.create(tenantA, adminId, 'admin', base({ token: 'abcd1234' }));
        await pg.db.insert(automations).values({
            tenantId: tenantA,
            listId,
            name: 'Avisar por WhatsApp',
            triggerType: 'record_created',
            triggerConfig: {},
            actions: [{ type: 'call_webhook', config: { url: 'https://was.example.com/send', connection_id: dto.id } }],
        });
        const usage = await svc.usage(tenantA, dto.id);
        expect(usage).toHaveLength(1);
        expect(usage[0]!.automation_name).toBe('Avisar por WhatsApp');
        expect(usage[0]!.list_slug).toBe('clientes');
        expect((await svc.list(tenantA, adminId, 'admin'))[0]!.usage_count).toBe(1);

        await expect(svc.remove(tenantA, adminId, 'admin', dto.id, false)).rejects.toBeInstanceOf(ConflictException);
        await svc.remove(tenantA, adminId, 'admin', dto.id, true);
        expect(await svc.list(tenantA, adminId, 'admin')).toEqual([]);
    });

    describe('conversión de los secretos escritos dentro de las acciones', () => {
        async function seed(): Promise<void> {
            await pg.db.insert(automations).values({
                tenantId: tenantA,
                listId,
                name: 'Aviso al crear',
                triggerType: 'record_created',
                triggerConfig: {},
                actions: [
                    {
                        type: 'call_webhook',
                        config: {
                            url: 'https://was.example.com/send',
                            secret: 'firma-compartida',
                            headers: [
                                { key: 'Authorization', value: 'Bearer tok-en-claro-4321' },
                                { key: 'Accept', value: 'application/json' },
                            ],
                            body_params: [{ key: 'msg', value: 'hola {{nombre}}' }],
                        },
                    },
                    {
                        type: 'if_else',
                        config: {
                            then_actions: [
                                {
                                    // MISMA credencial, adentro de una rama: la
                                    // conversión tiene que alcanzarla igual.
                                    type: 'call_webhook',
                                    config: {
                                        url: 'https://was.example.com/status',
                                        secret: 'firma-compartida',
                                        headers: [{ key: 'Authorization', value: 'Bearer tok-en-claro-4321' }],
                                    },
                                },
                            ],
                            else_actions: [],
                        },
                    },
                ],
            });
            await pg.db.insert(automations).values({
                tenantId: tenantA,
                listId,
                name: 'Webhook abierto',
                triggerType: 'record_created',
                triggerConfig: {},
                actions: [{ type: 'call_webhook', config: { url: 'https://abierto.example.com/hook' } }],
            });
        }

        it('encuentra los candidatos sin exponer el secreto', async () => {
            await seed();
            const found = await svc.scanInline(tenantA);
            expect(found).toHaveLength(1);
            const c = found[0]!;
            expect(c.host).toBe('was.example.com');
            expect(c.auth_type).toBe('bearer');
            expect(c.base_url).toBe('https://was.example.com');
            expect(c.found).toContain('auth_header');
            expect(c.found).toContain('signing_secret');
            expect(c.secret_hint).toBe('••••4321');
            expect(JSON.stringify(found)).not.toContain('tok-en-claro-4321');
            // Las 2 acciones son de la misma automatización; el webhook sin
            // credencial no aparece: no hay nada que mover.
            expect(c.automations).toEqual([
                { id: expect.any(Number), name: 'Aviso al crear', list_slug: 'clientes', actions: 2 },
            ]);
        });

        it('convierte: crea la conexión cifrada y deja las acciones sin secreto', async () => {
            await seed();
            const result = await svc.convertInline(tenantA, adminId, 'admin', {
                items: [{ host: 'was.example.com', name: 'Gateway WhatsApp', visibility: 'workspace' }],
            });
            expect(result.created).toHaveLength(1);
            expect(result.actions_rewritten).toBe(2);
            expect(result.automations_updated).toBe(1);

            const connectionId = result.created[0]!.connection_id;
            const parts = await svc.resolveParts(tenantA, connectionId);
            expect(parts?.headers['authorization']).toBe('Bearer tok-en-claro-4321');
            expect(parts?.signingSecret).toBe('firma-compartida');

            const rows = await pg.db.select().from(automations).where(eq(automations.tenantId, tenantA));
            const target = rows.find((r) => r.name === 'Aviso al crear')!;
            const raw = JSON.stringify(target.actions);
            expect(raw).not.toContain('tok-en-claro-4321');
            expect(raw).not.toContain('firma-compartida');

            const actions = target.actions as unknown as Array<Record<string, unknown>>;
            const first = actions[0]!.config as Record<string, unknown>;
            expect(first.connection_id).toBe(connectionId);
            expect(first.secret).toBeUndefined();
            // Se saca SÓLO la cabecera de auth; lo demás queda como estaba.
            expect(first.headers).toEqual([{ key: 'Accept', value: 'application/json' }]);
            expect(first.body_params).toEqual([{ key: 'msg', value: 'hola {{nombre}}' }]);
            expect(first.url).toBe('https://was.example.com/send');
            // Y la acción anidada en la rama `then` también quedó convertida.
            const branch = (actions[1]!.config as Record<string, unknown>).then_actions as Array<
                Record<string, unknown>
            >;
            expect((branch[0]!.config as Record<string, unknown>).connection_id).toBe(connectionId);

            // Ya no queda nada que convertir, y quedó en la bitácora.
            expect(await svc.scanInline(tenantA)).toEqual([]);
            const log = await pg.db.select().from(auditLog).where(eq(auditLog.tenantId, tenantA));
            expect(log.some((e) => e.action === 'connection.convert')).toBe(true);
            expect(JSON.stringify(log)).not.toContain('tok-en-claro-4321');
        });

        it('dos credenciales distintas en el mismo host son DOS conexiones', async () => {
            await pg.db.insert(automations).values({
                tenantId: tenantA,
                listId,
                name: 'Cuenta 1',
                triggerType: 'record_created',
                triggerConfig: {},
                actions: [
                    {
                        type: 'call_webhook',
                        config: { url: 'https://api.example.com/a', headers: [{ key: 'X-Api-Key', value: 'clave-uno-1111' }] },
                    },
                ],
            });
            await pg.db.insert(automations).values({
                tenantId: tenantA,
                listId,
                name: 'Cuenta 2',
                triggerType: 'record_created',
                triggerConfig: {},
                actions: [
                    {
                        type: 'call_webhook',
                        config: { url: 'https://api.example.com/b', headers: [{ key: 'X-Api-Key', value: 'clave-dos-2222' }] },
                    },
                ],
            });
            const found = await svc.scanInline(tenantA);
            expect(found).toHaveLength(2);
            expect(found.map((c) => c.host).sort()).toEqual(['api.example.com', 'api.example.com#2']);
        });
    });

    /**
     * v0.1.198 (fase 2) — acciones con NOMBRE. Lo que hay que demostrar con la
     * base real: que se guardan, que vuelven al listado (así el menú del
     * editor de automatizaciones las ofrece), y que resolverlas para ejecutar
     * entrega credencial + definición juntas.
     */
    describe('Acciones con nombre (v0.1.198)', () => {
        it('las guarda, las devuelve en el listado y las resuelve para ejecutar', async () => {
            const dto = await svc.create(
                tenantA,
                adminId,
                'admin',
                base({
                    name: 'Gateway con acciones',
                    base_url: 'https://was.example.com/api',
                    token: 'tok-gateway-4321',
                    actions: [
                        {
                            key: 'enviar_whatsapp',
                            label: 'Enviar WhatsApp',
                            description: 'Manda un mensaje al número indicado',
                            method: 'POST',
                            path: '/send',
                            content_type: 'form',
                            params: [
                                {
                                    key: 'recipient',
                                    label: 'Destinatario',
                                    type: 'text',
                                    location: 'body',
                                    required: true,
                                    help: '',
                                    default: '',
                                    options: [],
                                },
                                {
                                    key: 'message',
                                    label: 'Mensaje',
                                    type: 'long_text',
                                    location: 'body',
                                    required: true,
                                    help: '',
                                    default: '',
                                    options: [],
                                },
                            ],
                            body_template: '',
                        },
                    ],
                }),
            );
            expect(dto.actions).toHaveLength(1);
            expect(dto.actions[0]!.key).toBe('enviar_whatsapp');
            expect(dto.actions[0]!.params.map((p) => p.key)).toEqual(['recipient', 'message']);

            // El listado es lo que alimenta el menú del editor.
            const listed = await svc.list(tenantA, adminId, 'admin');
            const found = listed.find((c) => c.id === dto.id);
            expect(found?.actions[0]?.label).toBe('Enviar WhatsApp');

            // Resolver para ejecutar: credencial + definición en un solo viaje.
            const resolved = await svc.resolveAction(tenantA, dto.id, 'enviar_whatsapp');
            expect(resolved?.name).toBe('Gateway con acciones');
            expect(resolved?.action?.path).toBe('/send');
            expect(resolved?.parts.baseUrl).toBe('https://was.example.com/api');
            expect(resolved?.parts.headers.authorization).toBe('Bearer tok-gateway-4321');

            // Una clave que ya no existe NO cae a otra acción: devuelve null y
            // el motor lo reporta como fallo (renombrar no debe ejecutar algo
            // distinto en silencio).
            const gone = await svc.resolveAction(tenantA, dto.id, 'enviar_sms');
            expect(gone?.action).toBeNull();
        });

        it('renombrar la etiqueta conserva la clave; editar sin `actions` no las borra', async () => {
            const dto = await svc.create(
                tenantA,
                adminId,
                'admin',
                base({
                    name: 'Gateway estable',
                    actions: [
                        {
                            key: 'ping',
                            label: 'Hacer ping',
                            description: '',
                            method: 'GET',
                            path: '/ping',
                            content_type: 'json',
                            params: [],
                            body_template: '',
                        },
                    ],
                }),
            );
            const renamed = await svc.update(tenantA, adminId, 'admin', dto.id, {
                actions: [{ ...dto.actions[0]!, label: 'Verificar estado' }],
            });
            expect(renamed.actions[0]!.key).toBe('ping');
            expect(renamed.actions[0]!.label).toBe('Verificar estado');

            // Un PATCH de otra cosa (rotar el token) no toca el catálogo.
            const rotated = await svc.update(tenantA, adminId, 'admin', dto.id, {
                token: 'tok-nuevo-0000',
            });
            expect(rotated.actions).toHaveLength(1);
            expect(rotated.actions[0]!.key).toBe('ping');
        });
    });
});
