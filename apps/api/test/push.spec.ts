import { createECDH } from 'node:crypto';
import { readNotificationPrefs, type Field, type PushPayload } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { loadEnv } from '../src/config/env';
import { memberships, notifications, pushSubscriptions, recordFollows, recordShares, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import type { MailMessage } from '../src/mail/mail.types';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotifyHub } from '../src/notifications/notify-hub';
import { buildManifest, shortAppName } from '../src/pwa/manifest';
import { deletePushForUser } from '../src/pwa/push-cleanup';
import { PushKeysService } from '../src/pwa/push-keys.service';
import { assertPushEndpoint, PUSH_PER_HOUR, PushService, type PushTransport } from '../src/pwa/push.service';
import { b64url, decryptPushPayload, fromB64url } from '../src/pwa/web-push';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

class NullDispatcher extends AutomationDispatcher {
    override dispatch(_event: TriggerEvent): void {}
}

/** Un «navegador»: su par P-256 y su secreto `auth`, como los de `pushManager.subscribe`. */
function browserKeys() {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 7));
    return {
        keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) },
        open: (body: Buffer): PushPayload =>
            JSON.parse(decryptPushPayload(body, { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(), auth }).toString('utf8')) as PushPayload,
    };
}

describe('H1 — manifiesto (puro)', () => {
    it('plataforma: Imagina Base; empresa: su nombre de app y su color; iconos genéricos', () => {
        const base = buildManifest({ tenant: null });
        expect(base).toMatchObject({ id: '/', name: 'Imagina Base', short_name: 'Imagina Base', start_url: '/', scope: '/', display: 'standalone', theme_color: '#0c7e97', lang: 'es' });
        expect(base.icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(['192x192:any', '512x512:any', '192x192:maskable', '512x512:maskable']);
        const acme = buildManifest({ tenant: { name: 'Acme S.A.S.', app_name: 'Acme Gestión Comercial', primary_color: '#AA2200' } });
        expect(acme).toMatchObject({ name: 'Acme Gestión Comercial', short_name: 'Acme', theme_color: '#aa2200' });
        // El id no cambia con la marca: el navegador reconoce la MISMA app.
        expect(acme.id).toBe(base.id);
        expect(buildManifest({ tenant: { name: 'Beta', app_name: null, primary_color: 'rojo' } })).toMatchObject({ name: 'Beta', theme_color: '#0c7e97' });
        expect(shortAppName('Supercalifragilístico')).toBe('Supercalifr…');
    });

    it('endpoints: sólo https (http sólo en desarrollo con salida privada habilitada)', () => {
        expect(() => assertPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).not.toThrow();
        expect(() => assertPushEndpoint('http://127.0.0.1:9/x')).toThrow(/https/);
        expect(() => assertPushEndpoint('https://u:p@push.test/x')).toThrow(/https/);
        expect(() => assertPushEndpoint('nada')).toThrow(/válida/);
    });

    it('preferencias: push encendido para menciones, asignaciones, aprobaciones y recordatorios', () => {
        expect(readNotificationPrefs(undefined).push).toEqual({
            mention: true,
            assigned: true,
            comment: false,
            update: false,
            reminder: true,
            failure: false,
            reply: false,
            consent: false,
            approval: true,
            // Algo asignado a TU EQUIPO no es directo: sólo campana (como el correo).
            team_assigned: false,
            // E5 — un ticket que vence (o venció) y te toca.
            sla: true,
        });
        expect(readNotificationPrefs({ push: { update: true } }).push).toMatchObject({ update: true, mention: true });
    });
});

describe('H1 — notificaciones push (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let push: PushService;
    let keys: PushKeysService;
    let sessions: SessionService;
    let notif: NotificationsService;
    let recs: RecordsService;
    let comments: CommentsService;
    let tenantId: number;
    let otherTenant: number;
    let ana: number;
    let beto: number;
    let caro: number;
    let cliente: number;
    const f: Record<string, Field> = {};
    const sent: Array<{ endpoint: string; headers: Record<string, string>; body: Buffer }> = [];
    const statusFor = new Map<string, number>();
    const pending: Array<Promise<unknown>> = [];
    const settle = async (): Promise<void> => {
        while (pending.length > 0) await Promise.all(pending.splice(0));
    };
    const transport: PushTransport = async (endpoint, headers, body) => {
        sent.push({ endpoint, headers, body });
        return statusFor.get(endpoint) ?? 201;
    };
    const env = loadEnv({ APP_BASE_URL: 'https://app.test', SECRETS_KEY: 'clave-de-pruebas-para-push-32bytes' });

    const subscribe = async (userId: number, endpoint: string, token?: string) => {
        const b = browserKeys();
        const t = token ?? (await sessions.create(userId));
        const dev = await push.subscribe(tenantId, { userId, sessionToken: t, impersonated: false }, { endpoint, keys: b.keys }, 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile');
        return { ...b, token: t, device: dev };
    };

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const changes = new RecordChangeHub();
        const hub = new NotifyHub();
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new NullDispatcher(),
            new RelationsRepository(),
            undefined,
            changes,
            undefined,
            undefined,
            hub,
        );
        comments = new CommentsService(tenantDb, new CommentsRepository(), lists, recs, rt, hub);
        sessions = new SessionService(redis as never, env);
        keys = new PushKeysService(redis as never, env);
        push = new PushService(pg.db, tenantDb, redis as never, env, keys, sessions, transport);
        const mail = { enqueue: (_m: MailMessage) => Promise.resolve() };
        notif = new NotificationsService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            rt,
            mail as never,
            redis as never,
            env,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            push,
        );
        hub.subscribe((e) => void pending.push(notif.onNotify(e)));
        changes.subscribe((c) => void pending.push(notif.onRecordChange(c)));

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenant = o!.id;
        const mk = async (email: string, name: string) => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = await mk('ana@acme.test', 'Ana');
        beto = await mk('beto@acme.test', 'Beto');
        caro = await mk('caro@acme.test', 'Caro');
        cliente = await mk('cli@cliente.test', 'Cliente');
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: ana, role: 'admin' },
                { tenantId, userId: beto, role: 'manager' },
                { tenantId, userId: caro, role: 'agent' },
                { tenantId, userId: cliente, role: 'client' },
            ]),
        );
        await lists.create(tenantId, { name: 'Tareas' });
        f.titulo = await fieldsSvc.create(tenantId, 'tareas', { label: 'Título', type: 'text', slug: 'titulo' });
        f.resp = await fieldsSvc.create(tenantId, 'tareas', { label: 'Responsable', type: 'user', slug: 'responsable' });
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        sent.length = 0;
        statusFor.clear();
        // Las llaves VAPID se conservan entre tests (como en un servidor real).
        for (const k of await redis.keys('notifpush:*')) await redis.del(k);
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.tenantId, tenantId));
            await tx.delete(notifications).where(eq(notifications.tenantId, tenantId));
            await tx.delete(recordFollows).where(eq(recordFollows.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.update(memberships).set({ settings: {} }).where(eq(memberships.tenantId, tenantId));
        });
    });

    const create = async (data: Record<string, unknown>, actor: { userId: number; role: 'admin' | 'manager' } = { userId: ana, role: 'admin' }) => {
        const r = await recs.create(tenantId, actor, 'tareas', { data });
        await settle();
        return r.id;
    };

    it('llaves VAPID: se generan una vez, la privada cifrada en Redis, y se reusan', async () => {
        const k1 = await keys.keys();
        const raw = JSON.parse((await redis.get('platform:push'))!) as Record<string, string>;
        expect(raw.public_key).toBe(k1.publicKey);
        expect(raw.private_key_enc).toMatch(/^enc:v1:/);
        expect(raw.private_key_enc).not.toContain(k1.privateKey);
        // Otro proceso (otro nodo) lee las MISMAS.
        const other = new PushKeysService(redis as never, env);
        expect((await other.keys()).publicKey).toBe(k1.publicKey);
        // Con otra SECRETS_KEY no se pueden leer — y no se regeneran solas.
        const wrong = new PushKeysService(redis as never, loadEnv({ APP_BASE_URL: 'https://app.test', SECRETS_KEY: 'otra-clave-distinta-de-la-buena-123' }));
        await expect(wrong.keys()).rejects.toMatchObject({ response: { code: 'push_keys_unreadable' } });
        expect(JSON.parse((await redis.get('platform:push'))!).public_key).toBe(k1.publicKey);
    });

    it('una mención llega por push: cifrado para ESE navegador, título, una línea y la URL del registro', async () => {
        const b = await subscribe(beto, 'https://push.test/beto-1');
        const id = await create({ [`f${f.titulo!.id}`]: 'Cotización Acme' });
        await comments.create(tenantId, { userId: ana, role: 'admin' }, 'tareas', id, {
            body: '@beto@acme.test mira esto, el cliente pide el descuento del 15% y\nla entrega antes del viernes; confirma por favor si se puede hacer. ' + 'x'.repeat(300),
            kind: 'note',
        });
        await settle();
        expect(sent).toHaveLength(1);
        const msg = sent[0]!;
        expect(msg.endpoint).toBe('https://push.test/beto-1');
        expect(msg.headers).toMatchObject({ 'content-encoding': 'aes128gcm', ttl: '86400', urgency: 'high' });
        expect(msg.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
        // El cuerpo NO es legible en claro: sólo el navegador lo abre.
        expect(msg.body.toString('latin1')).not.toContain('Cotización');
        const payload = b.open(msg.body);
        expect(payload).toMatchObject({
            v: 1,
            kind: 'mention',
            title: 'Ana te mencionó en «Cotización Acme»',
            url: `/#/lists/tareas/records/${id}`,
            tenant_id: tenantId,
            tag: `rec-${id}-mention`,
        });
        // Una línea, cortada: nunca el comentario completo.
        expect(payload.body.length).toBeLessThanOrEqual(140);
        expect(payload.body).not.toContain('\n');
        expect(payload.body.endsWith('…')).toBe(true);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, b.device.id)));
        expect(row!.lastUsedAt).not.toBeNull();
    });

    it('respeta la preferencia: apagar push de menciones (el correo y la campana siguen)', async () => {
        await subscribe(beto, 'https://push.test/beto-2');
        await notif.setPrefs(tenantId, beto, { push: { mention: false } });
        expect((await notif.getPrefs(tenantId, beto)).push).toMatchObject({ mention: false, assigned: true });
        const id = await create({ [`f${f.titulo!.id}`]: 'Sin push' });
        await comments.create(tenantId, { userId: ana, role: 'admin' }, 'tareas', id, { body: '@beto@acme.test hola', kind: 'note' });
        await settle();
        expect(sent).toHaveLength(0);
        const inbox = await withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, beto))));
        expect(inbox.map((n) => n.kind)).toContain('mention');
        // Asignar sigue encendido por defecto.
        await create({ [`f${f.titulo!.id}`]: 'Para Beto', [`f${f.resp!.id}`]: beto });
        expect(sent).toHaveLength(1);
        // «Cambió» y «comentó» están apagados por defecto.
        await notif.setPrefs(tenantId, beto, { push: { mention: true } });
    });

    it('nadie recibe push de lo que no puede ver, ni el cliente del portal, ni de lo que hizo él', async () => {
        await subscribe(caro, 'https://push.test/caro');
        await subscribe(ana, 'https://push.test/ana');
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(pushSubscriptions).values({ tenantId, userId: cliente, endpoint: 'https://push.test/cli', endpointHash: 'cli', p256dh: browserKeys().keys.p256dh, auth: 'AAECAwQFBgcICQoLDA0ODw', sessionId: null }),
        );
        const id = await create({ [`f${f.titulo!.id}`]: 'Privado' });
        // Caro (agente) no ve registros ajenos; el cliente es sólo portal; Ana es quien escribe.
        await comments.create(tenantId, { userId: ana, role: 'admin' }, 'tareas', id, { body: '@caro@acme.test @cli@cliente.test @ana@acme.test', kind: 'note' });
        await settle();
        expect(sent).toHaveLength(0);
    });

    it('un invitado externo recibe el aviso en la campana (le compartieron el registro) pero nunca push', async () => {
        const invitado = (await pg.db.insert(users).values({ email: `inv-${Date.now()}@afuera.test`, name: 'Invitado', passwordHash: 'x' }).returning())[0]!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: invitado, role: 'guest' }));
        const id = await create({ [`f${f.titulo!.id}`]: 'Compartido' });
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select({ listId: records.listId }).from(records).where(eq(records.id, id)));
        await withTenant(pg.db, tenantId, (tx) => tx.insert(recordShares).values({ tenantId, listId: rec!.listId, recordId: id, userId: invitado, level: 'comment' }));
        // Aunque tuviera una suscripción (no puede crearla: el TenantGuard le cierra /me/push).
        await subscribe(invitado, 'https://push.test/invitado');
        await notif.deliver(tenantId, 'mention', [invitado], { listId: rec!.listId, recordId: id, actorId: ana, title: 'Ana te mencionó', body: 'hola' });
        await settle();
        const inbox = await withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, invitado))));
        expect(inbox.map((n) => n.kind)).toEqual(['mention']);
        expect(sent).toHaveLength(0);
    });

    it('tope por persona y hora: el resto queda sólo en la campana', async () => {
        await subscribe(beto, 'https://push.test/beto-tope');
        for (let i = 0; i < PUSH_PER_HOUR + 3; i++) {
            await notif.deliver(tenantId, 'assigned', [beto], { listId: null, recordId: null, actorId: ana, title: `Aviso ${i}`, body: 'x' });
        }
        expect(sent).toHaveLength(PUSH_PER_HOUR);
        const inbox = await withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(eq(notifications.userId, beto)));
        expect(inbox).toHaveLength(PUSH_PER_HOUR + 3);
    });

    it('404/410 borra la suscripción; 5xx cuenta fallos y a los 5 la descarta', async () => {
        const gone = await subscribe(beto, 'https://push.test/vencida');
        const flaky = await subscribe(beto, 'https://push.test/inestable');
        statusFor.set('https://push.test/vencida', 410);
        statusFor.set('https://push.test/inestable', 503);
        const r = await push.sendTest(tenantId, beto);
        expect(r).toMatchObject({ sent: 0, failed: 2, removed: 1 });
        const left = await push.devices(tenantId, beto);
        expect(left.map((d) => d.id)).toEqual([flaky.device.id]);
        expect(left[0]!.last_error).toMatch(/no respondió \(503\)/);
        expect(gone.device.id).not.toBe(flaky.device.id);
        for (let i = 0; i < 4; i++) await push.sendTest(tenantId, beto);
        expect(await push.devices(tenantId, beto)).toHaveLength(0);
        // El navegador no se entera del 410 y la sigue devolviendo: al
        // re-vincularla se rechaza (el dispositivo pide una nueva)…
        await expect(subscribe(beto, 'https://push.test/vencida')).rejects.toMatchObject({ status: 410, response: { code: 'push_subscription_gone' } });
        // …y un 5xx repetido no la marca: puede volver.
        await expect(subscribe(beto, 'https://push.test/inestable')).resolves.toBeTruthy();
    });

    it('la sesión manda: cerrar sesión, revocarla o que venza deja de enviar a ese dispositivo', async () => {
        const auth = new AuthService(pg.db, redis as never, env, { enqueue: () => Promise.resolve() } as never, sessions);
        const a = await subscribe(beto, 'https://push.test/sesion-a');
        const b = await subscribe(beto, 'https://push.test/sesion-b');
        // Cerrar sesión en A la borra al instante.
        await auth.logout(a.token);
        expect((await push.devices(tenantId, beto)).map((d) => d.id)).toEqual([b.device.id]);
        // B: la sesión desaparece por otro camino (vence) → no se envía y se borra.
        await redis.del(`sess:${b.token}`);
        const r = await push.sendTest(tenantId, beto);
        expect(r.sent).toBe(0);
        expect(sent).toHaveLength(0);
        expect(await push.devices(tenantId, beto)).toHaveLength(0);
    });

    it('el mismo navegador cambia de dueño; un id ajeno no se borra; desactivar la cuenta limpia todo', async () => {
        const first = await subscribe(beto, 'https://push.test/compartido');
        // Beto cerró sesión y Ana activa en el MISMO navegador: el endpoint pasa a ella.
        const second = await subscribe(ana, 'https://push.test/compartido');
        expect(second.device.id).toBe(first.device.id);
        expect(await push.devices(tenantId, beto)).toHaveLength(0);
        expect(await push.devices(tenantId, ana)).toHaveLength(1);
        await expect(push.remove(tenantId, beto, second.device.id)).rejects.toMatchObject({ response: { code: 'push_device_not_found' } });
        await push.unsubscribe(tenantId, ana, 'https://push.test/compartido');
        expect(await push.devices(tenantId, ana)).toHaveLength(0);
        await subscribe(beto, 'https://push.test/x1');
        await deletePushForUser(pg.db, beto);
        expect(await push.devices(tenantId, beto)).toHaveLength(0);
        // Quien mira la app como otra persona (soporte) no puede activarlo.
        await expect(
            push.subscribe(tenantId, { userId: beto, sessionToken: 't', impersonated: true }, { endpoint: 'https://push.test/imp', keys: browserKeys().keys }, ''),
        ).rejects.toMatchObject({ response: { code: 'push_impersonating' } });
    });

    it('RLS: otra empresa no ve los dispositivos de ésta', async () => {
        await subscribe(beto, 'https://push.test/rls');
        const mine = await withTenant(pg.db, tenantId, (tx) => tx.select().from(pushSubscriptions));
        expect(mine).toHaveLength(1);
        const other = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(pushSubscriptions));
        expect(other).toHaveLength(0);
        await expect(
            withTenant(pg.db, otherTenant, (tx) =>
                tx.insert(pushSubscriptions).values({ tenantId, userId: beto, endpoint: 'https://x', endpointHash: 'zz', p256dh: 'a', auth: 'b' }),
            ),
        ).rejects.toThrow();
        // El status no expone el endpoint, sólo su huella.
        const st = await push.status(tenantId, beto);
        expect(JSON.stringify(st)).not.toContain('push.test/rls');
        expect(fromB64url(st.public_key)).toHaveLength(65);
    });
});
