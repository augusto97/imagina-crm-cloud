import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const net = vi.hoisted(() => ({
    calls: [] as string[],
    status: 200,
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (url: string) => {
            net.calls.push(url);
            return { status: net.status };
        },
    };
});

import { heartbeatSupportsFail } from '@imagina-base/shared';
import type { Env } from '../src/config/env';
import { GuardianService, parseGuardianEvents } from '../src/update/guardian.service';
import { PlatformAlertsService } from '../src/update/platform-alerts.service';
import { PlatformWatchService, certDaysLeft, guardianAllOk, pendingGuardianEvents } from '../src/update/platform-watch.service';
import { startRedis, type TestRedis } from './helpers/containers';

type Mail = { to: string; subject: string; text: string; html: string };

const T0 = Date.parse('2026-11-14T12:00:00Z');
const HOUR = 3600_000;

function report(over: Record<string, unknown> = {}, checks: Record<string, unknown> = {}): string {
    return JSON.stringify({
        version: 1,
        updated_at: '2026-11-14T12:00:00Z',
        domain: 'base.acme.co',
        web_mode: 'serveravatar',
        requested: false,
        current_release: '20261114_0.1.431',
        checks: {
            api: 'ok',
            database: 'ok',
            redis: 'ok',
            web_server: 'ok',
            front: 'ok',
            disk: { ok: true, free_bytes: 20e9, total_bytes: 60e9, free_inodes: 900000, total_inodes: 3000000 },
            ...checks,
        },
        last_action: null,
        ...over,
    });
}

function ev(at: string, kind: string, ok: boolean, message: string): string {
    return JSON.stringify({ id: `${Date.parse(at) / 1000}-${Math.floor(Math.random() * 30000)}`, at, kind, ok, message });
}

describe('Vigilancia del servidor (v0.1.431) — piezas puras', () => {
    it('lee los eventos del final, tolera líneas rotas y los da del más nuevo al más viejo', () => {
        const raw = [ev('2026-11-14T11:00:00Z', 'api_restarted', true, 'a'), '{"roto', ev('2026-11-14T11:05:00Z', 'nginx_repaired', true, 'b'), ''].join('\n');
        const out = parseGuardianEvents(raw);
        expect(out.map((e) => e.message)).toEqual(['b', 'a']);
    });

    it('eventos pendientes: después del cursor, no después del informe, y sin cursor sólo 2 horas', () => {
        const events = parseGuardianEvents(
            [
                ev('2026-11-14T08:00:00Z', 'api_restarted', true, 'viejo'),
                ev('2026-11-14T11:30:00Z', 'nginx_repaired', true, 'nuevo'),
                ev('2026-11-14T12:01:00Z', 'api_restarted', true, 'corrida en curso'),
            ].join('\n'),
        );
        expect(pendingGuardianEvents(events, null, '2026-11-14T12:00:00Z', T0).map((e) => e.message)).toEqual(['nuevo']);
        expect(pendingGuardianEvents(events, '2026-11-14T11:30:00Z', '2026-11-14T12:00:00Z', T0)).toEqual([]);
        expect(pendingGuardianEvents(events, '2026-11-14T11:30:00Z', '2026-11-14T12:01:00Z', T0).map((e) => e.message)).toEqual(['corrida en curso']);
    });

    it('días del certificado, «todo bien» y quién entiende /fail', () => {
        expect(certDaysLeft('Nov 24 12:00:00 2026 GMT', T0)).toBe(10);
        expect(certDaysLeft('basura', T0)).toBeNull();
        const r = JSON.parse(report({}, { front: 'skipped' }));
        expect(guardianAllOk(r)).toBe(true);
        expect(guardianAllOk({ ...r, checks: { ...r.checks, front: 'down' } })).toBe(false);
        expect(heartbeatSupportsFail('https://uptime.betterstack.com/api/v1/heartbeat/abc')).toBe(true);
        expect(heartbeatSupportsFail('https://hc-ping.com/uuid')).toBe(true);
        expect(heartbeatSupportsFail('https://cronitor.link/p/x')).toBe(false);
    });
});

describe('Vigilancia del servidor (v0.1.431) — con Redis real', () => {
    let redisC: TestRedis;
    let redis: Redis;
    let dir: string;
    let env: Env;
    const mails: Mail[] = [];
    const mail = {
        enqueue: vi.fn(async (m: Mail) => void mails.push(m)),
        accountMailStatus: vi.fn(async () => ({ available: true, via: 'platform_smtp', host: 'smtp.acme.co', reason: null })),
    };
    let alerts: PlatformAlertsService;
    let guardian: GuardianService;
    let watch: PlatformWatchService;
    let backupsHealth: { available: boolean; settings: { enabled: boolean; hour_utc: number; keep: number; include_env: boolean }; run: Record<string, unknown>; last_snapshot_at: string | null };
    let driveStatus: Record<string, unknown>;
    let updateRun: Record<string, unknown>;
    let dbDown = false;

    const subjects = () => mails.map((m) => m.subject);

    beforeAll(async () => {
        redisC = await startRedis();
        redis = new Redis(redisC.url);
    }, 120_000);

    afterAll(async () => {
        await redis?.quit();
        await redisC?.stop();
    });

    beforeEach(async () => {
        await redis.flushall();
        mails.length = 0;
        net.calls.length = 0;
        net.status = 200;
        dbDown = false;
        dir = mkdtempSync(path.join(tmpdir(), 'guardian-'));
        env = {
            NODE_ENV: 'production',
            UPDATER_BASE_PATH: '/opt/imagina-base',
            GUARDIAN_DIR: dir,
            APP_BASE_URL: 'https://base.acme.co',
            PLATFORM_SUPERADMINS: ['ops@acme.co'],
        } as unknown as Env;
        backupsHealth = {
            available: true,
            settings: { enabled: true, hour_utc: 3, keep: 14, include_env: true },
            run: { status: 'success', kind: 'snapshot', message: null, file: null, started_at: null, finished_at: null },
            last_snapshot_at: new Date(T0 - 4 * HOUR).toISOString(),
        };
        driveStatus = { configured: true, connected: true, passphrase_set: true, enabled: true, broken: null, last_upload: { at: 'x', file: 'f', ok: true, message: 'ok' } };
        updateRun = { status: 'success', version: '0.1.431', message: 'Actualización aplicada', started_at: null, finished_at: '2026-11-14T10:00:00Z' };
        alerts = new PlatformAlertsService(redis, env, mail as never);
        guardian = new GuardianService(env);
        watch = new PlatformWatchService(
            redis,
            env,
            { query: async () => (dbDown ? Promise.reject(new Error('connection refused')) : { rows: [] }) } as never,
            alerts,
            guardian,
            { health: async () => backupsHealth } as never,
            { status: async () => driveStatus } as never,
            { run: async () => updateRun } as never,
        );
        watch.frontProbe = vi.fn(async () => 'ok' as const);
        watch.certProbe = vi.fn(async () => ({ valid_to: new Date(T0 + 60 * 86_400_000).toUTCString(), authorized: true, error: null }));
    });

    function writeReport(json: string, ageMs = 0, now = T0): void {
        const f = path.join(dir, 'status.json');
        writeFileSync(f, json);
        const t = (now - ageMs) / 1000;
        utimesSync(f, t, t);
    }

    it('un aviso: correo al abrir, ninguno mientras sigue igual, recordatorio, más grave avisa, y al arreglarse «Ya está bien»', async () => {
        const base = { key: 'x', source: 'backups' as const, title: 'Algo falló', detail: 'detalle', remind_hours: 24 };
        expect(await alerts.raise({ ...base, severity: 'warning' }, new Date(T0))).toBe(true);
        expect(await alerts.raise({ ...base, severity: 'warning' }, new Date(T0 + HOUR))).toBe(false);
        expect((await alerts.get('x'))!.count).toBe(2);
        expect(await alerts.raise({ ...base, severity: 'critical' }, new Date(T0 + 2 * HOUR))).toBe(true);
        expect(await alerts.raise({ ...base, severity: 'critical' }, new Date(T0 + 27 * HOUR))).toBe(true);
        expect(subjects()).toEqual(['Algo falló', 'Algo falló', 'Sigue pendiente: Algo falló']);
        expect(mails[0]!.to).toBe('ops@acme.co');
        expect(mails[0]!.text).toContain('https://base.acme.co/#/platform?tab=diagnostico');
        expect(await alerts.resolve('x', {}, new Date(T0 + 28 * HOUR))).toBe(true);
        expect(subjects().at(-1)).toBe('Ya está bien: Algo falló');
        const list = await alerts.list();
        expect(list.open).toEqual([]);
        expect(list.recent[0]).toMatchObject({ key: 'x', resolved_at: expect.any(String) });
        expect(list.mail_available).toBe(true);
        expect(list.recipients).toEqual(['ops@acme.co']);
    });

    it('«Ya lo vi» no vuelve a abrir la misma clave; sin correo sólo queda en el panel', async () => {
        await alerts.raise({ key: 'y', source: 'update', severity: 'critical', title: 'Update', detail: 'd' }, new Date(T0));
        await alerts.dismiss('y', new Date(T0 + 1000));
        expect(await alerts.raise({ key: 'y', source: 'update', severity: 'critical', title: 'Update', detail: 'd' }, new Date(T0 + 2000))).toBe(false);
        expect(await alerts.get('y')).toBeNull();
        await alerts.raise({ key: 'z', source: 'drive', severity: 'critical', title: 'Drive', detail: 'd', mail: false }, new Date(T0));
        expect(subjects()).toEqual(['Update']);
        expect((await alerts.list()).open.map((a) => a.key)).toEqual(['z']);
    });

    it('sin el guardián instalado avisa una vez cómo instalarlo; al instalarlo se cierra sin correo', async () => {
        await watch.checkGuardian(T0);
        await watch.checkGuardian(T0 + HOUR);
        expect(subjects()).toEqual(['La reparación automática del servidor no está instalada']);
        expect(mails[0]!.text).toContain('sudo bash /opt/imagina-base/current/deploy/install-guardian.sh');
        writeReport(report());
        await watch.checkGuardian(T0);
        expect(await alerts.get('guardian:missing')).toBeNull();
        expect(subjects()).toHaveLength(1);
        expect(guardian.status(T0)).toMatchObject({ installed: true, fresh: true, outdated: false, expected_version: 1 });
    });

    it('lo que el guardián reparó llega en UN correo y una sola vez; lo que no pudo abre un aviso crítico', async () => {
        writeFileSync(
            path.join(dir, 'events.jsonl'),
            [ev('2026-11-14T11:59:00Z', 'nginx_repaired', true, 'Se repuso la configuración de Nginx.'), ev('2026-11-14T11:59:00Z', 'api_restarted', true, 'La app volvió.')].join('\n') + '\n',
        );
        writeReport(report());
        await watch.checkGuardian(T0);
        await watch.checkGuardian(T0 + 60_000);
        expect(subjects()).toEqual(['El servidor se reparó solo']);
        expect(mails[0]!.text).toContain('Configuración de Nginx repuesta: Se repuso la configuración de Nginx.');

        writeFileSync(path.join(dir, 'events.jsonl'), ev('2026-11-14T12:02:00Z', 'needs_attention', false, 'La app sigue sin responder.') + '\n', { flag: 'a' });
        writeReport(report({ updated_at: '2026-11-14T12:02:00Z' }, { api: 'down' }), 0, T0 + 2 * 60_000);
        await watch.checkGuardian(T0 + 2 * 60_000);
        expect(subjects().at(-1)).toBe('El servidor necesita que lo revises');
        expect((await alerts.get('guardian:attention'))!.severity).toBe('critical');

        writeReport(report({ updated_at: '2026-11-14T12:05:00Z' }), 0, T0 + 5 * 60_000);
        await watch.checkGuardian(T0 + 5 * 60_000);
        expect(subjects().at(-1)).toBe('Ya está bien: El servidor necesita que lo revises');
    });

    it('un informe viejo = el guardián dejó de revisar', async () => {
        writeReport(report(), 20 * 60_000);
        await watch.checkGuardian(T0);
        expect(subjects()).toEqual(['La reparación automática del servidor dejó de revisar']);
        expect(mails[0]!.text).toContain('systemctl enable --now imagina-guardian.timer');
        writeReport(report());
        await watch.checkGuardian(T0);
        expect(subjects().at(-1)).toBe('Ya está bien: La reparación automática del servidor dejó de revisar');
    });

    it('«Reparar ahora» deja un archivo vacío en requests/', () => {
        expect(guardian.requestRepair(T0)).toEqual({ ok: false, reason: expect.stringContaining('no está instalado') });
        mkdirSync(path.join(dir, 'requests'));
        expect(guardian.requestRepair(T0)).toEqual({ ok: true, reason: null });
        expect(readdirSync(path.join(dir, 'requests'))).toEqual([`repair-${T0}`]);
        expect(guardian.status(T0).request_pending).toBe(true);
        rmSync(path.join(dir, 'requests'), { recursive: true });
    });

    it('la puerta de entrada caída 3 veces seguidas abre el aviso (del guardián o de la propia app)', async () => {
        writeReport(report({}, { front: 'down' }));
        await watch.checkFront(T0);
        await watch.checkFront(T0 + 60_000);
        expect(await alerts.get('front:down')).toBeNull();
        await watch.checkFront(T0 + 120_000);
        expect(subjects()).toEqual(['La app no abre desde afuera (base.acme.co)']);
        writeReport(report());
        await watch.checkFront(T0 + 180_000);
        expect(subjects().at(-1)).toBe('Ya está bien: La app no abre desde afuera (base.acme.co)');

        // Sin guardián: la app se prueba a sí misma por su dominio.
        rmSync(path.join(dir, 'status.json'));
        watch.frontProbe = vi.fn(async (url: string) => (url.endsWith('/') ? ('down' as const) : ('ok' as const)));
        for (let i = 0; i < 3; i++) await watch.checkFront(T0 + i * 60_000);
        expect(watch.frontProbe).toHaveBeenCalledWith('https://base.acme.co/api/v1/health/live');
        expect(await alerts.get('front:down')).not.toBeNull();
        // Sin respuesta de la red: no cuenta como caída.
        await redis.del('pwatch:front:bad');
        await alerts.dismiss('front:down');
        watch.frontProbe = vi.fn(async () => 'unknown' as const);
        for (let i = 0; i < 5; i++) await watch.checkFront(T0 + i * 60_000);
        expect(await redis.get('pwatch:front:bad')).toBeNull();
    });

    it('copias: la que falló, la que falta, las apagadas y las que no salen del servidor', async () => {
        backupsHealth.run = { status: 'failed', kind: 'snapshot', message: 'pg_dump: sin espacio', file: null, started_at: null, finished_at: '2026-11-14T03:00:00Z' };
        await watch.checkBackups(T0);
        await watch.checkBackups(T0 + HOUR);
        expect(subjects()).toEqual(['La copia de seguridad del servidor falló']);
        expect(mails[0]!.text).toContain('pg_dump: sin espacio');
        expect(mails[0]!.text).toContain('#/platform?tab=backups');
        backupsHealth.run = { status: 'success', kind: 'snapshot', message: null, file: 'f', started_at: null, finished_at: '2026-11-15T03:00:00Z' };
        await watch.checkBackups(T0 + 2 * HOUR);
        expect(subjects().at(-1)).toBe('Ya está bien: La copia de seguridad del servidor falló');

        backupsHealth.last_snapshot_at = new Date(T0 - 40 * HOUR).toISOString();
        await watch.checkBackups(T0);
        expect(subjects().at(-1)).toBe('No hay una copia de seguridad reciente');

        backupsHealth.settings.enabled = false;
        await watch.checkBackups(T0);
        await watch.checkBackups(T0 + 72 * HOUR);
        expect(subjects().filter((s) => s.includes('apagadas'))).toHaveLength(1);
        expect(await alerts.get('backups:missing')).toBeNull();

        backupsHealth.settings.enabled = true;
        driveStatus = { configured: false, connected: false, passphrase_set: false, enabled: false, broken: null, last_upload: null };
        await watch.checkDrive(T0);
        expect(subjects().at(-1)).toBe('Las copias no salen del servidor');
        // Drive roto: queda en el panel (el correo lo manda la subida a Drive).
        driveStatus = { configured: true, connected: true, passphrase_set: true, enabled: true, broken: 'Hay que reconectar', last_upload: { at: 'x', file: 'f', ok: false, message: 'invalid_grant' } };
        const before = mails.length;
        await watch.checkDrive(T0);
        expect(mails.length).toBe(before);
        expect((await alerts.list()).open.map((a) => a.key)).toEqual(expect.arrayContaining(['drive:broken', 'drive:upload']));
        expect(await alerts.get('drive:none')).toBeNull();
    });

    it('una actualización que falló o se revirtió avisa; la siguiente buena lo cierra', async () => {
        updateRun = { status: 'failed', version: '0.1.432', message: 'No hay espacio en el disco', started_at: null, finished_at: '2026-11-14T11:00:00Z' };
        await watch.checkUpdate(T0);
        expect(subjects()).toEqual(['La actualización a la 0.1.432 no se pudo instalar']);
        updateRun = { status: 'rolled_back', version: '0.1.433', message: 'Health-check falló; se revirtió', started_at: null, finished_at: '2026-11-14T12:00:00Z' };
        await watch.checkUpdate(T0);
        expect(subjects().at(-1)).toBe('La actualización a la 0.1.433 se revirtió');
        expect((await alerts.list()).open.map((a) => a.key)).toEqual(['update:rolled_back:2026-11-14T12:00:00Z']);
        updateRun = { status: 'success', version: '0.1.434', message: 'Actualización aplicada', started_at: null, finished_at: '2026-11-14T13:00:00Z' };
        await watch.checkUpdate(T0);
        expect((await alerts.list()).open).toEqual([]);
    });

    it('el certificado: a 10 días avisa, a 2 días vuelve a avisar como crítico, renovado se cierra', async () => {
        watch.certProbe = vi.fn(async () => ({ valid_to: new Date(T0 + 10 * 86_400_000 + HOUR).toUTCString(), authorized: true, error: null }));
        await watch.checkCertificate(T0);
        expect(subjects()).toEqual(['El certificado de base.acme.co vence en 10 días']);
        watch.certProbe = vi.fn(async () => ({ valid_to: new Date(T0 + 2 * 86_400_000 + HOUR).toUTCString(), authorized: true, error: null }));
        await watch.checkCertificate(T0);
        expect(subjects().at(-1)).toBe('El certificado de base.acme.co vence en 2 días');
        expect(mails.at(-1)!.text).toContain('Plataforma → Dominios');
        watch.certProbe = vi.fn(async () => ({ valid_to: new Date(T0 + 89 * 86_400_000).toUTCString(), authorized: true, error: null }));
        await watch.checkCertificate(T0);
        expect(subjects().at(-1)).toBe('Ya está bien: El certificado de base.acme.co vence en 2 días');
    });

    it('el latido: GET cada minuto, /fail si algo falla (Better Stack) y sin latir si el servicio no lo entiende', async () => {
        expect(await watch.heartbeat(T0)).toBeNull();
        await watch.setMonitoring({ heartbeat_url: 'https://uptime.betterstack.com/api/v1/heartbeat/abc' });
        const ok = await watch.heartbeat(T0);
        expect(ok).toMatchObject({ ok: true, failed: false, status: 200 });
        expect(net.calls).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/abc']);

        dbDown = true;
        const fail = await watch.heartbeat(T0);
        expect(fail).toMatchObject({ failed: true, message: expect.stringContaining('La base de datos no responde') });
        expect(net.calls.at(-1)).toBe('https://uptime.betterstack.com/api/v1/heartbeat/abc/fail');

        await watch.setMonitoring({ heartbeat_url: 'https://cronitor.link/p/abc' });
        net.calls.length = 0;
        const held = await watch.heartbeat(T0);
        expect(held).toMatchObject({ ok: false, failed: true, status: null });
        expect(net.calls).toEqual([]);
        // «Probar» late aunque haya algo mal (es para ver que la dirección sirve).
        await watch.heartbeat(T0, { test: true });
        expect(net.calls).toEqual(['https://cronitor.link/p/abc']);

        dbDown = false;
        writeReport(report({}, { disk: { ok: false, free_bytes: 1, total_bytes: 2, free_inodes: 1, total_inodes: 2 } }));
        expect(await watch.holdingReason(T0)).toBe('El disco del servidor está lleno.');
        const status = await watch.monitoringStatus(T0);
        expect(status.health_url).toBe('https://base.acme.co/api/v1/health/ready');
        expect(status.settings.heartbeat_url).toBe('https://cronitor.link/p/abc');

        await watch.setMonitoring({ enabled: false });
        net.calls.length = 0;
        expect(await watch.heartbeat(T0)).toBeNull();
        expect(net.calls).toEqual([]);
    });

    it('el tick: lo lento cada 15 minutos (o forzado) y la hora de la última revisión', async () => {
        writeReport(report());
        const spy = vi.spyOn(watch, 'checkBackups');
        await watch.tick({}, T0);
        await watch.tick({}, T0 + 60_000);
        expect(spy).toHaveBeenCalledTimes(1);
        await watch.tick({ force: true }, T0 + 120_000);
        expect(spy).toHaveBeenCalledTimes(2);
        expect((await alerts.list()).checked_at).toBe(new Date(T0 + 120_000).toISOString());
    });
});
