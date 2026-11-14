import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    GUARDIAN_VERSION,
    heartbeatPingSchema,
    heartbeatSupportsFail,
    monitoringSettingsSchema,
    type GuardianEvent,
    type GuardianReport,
    type HeartbeatPing,
    type MonitoringSettings,
    type MonitoringStatus,
    type UpdateMonitoringInput,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import tls from 'node:tls';
import type { Pool } from 'pg';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { PG_POOL } from '../db/client';
import { REDIS } from '../redis/redis.module';
import { BackupDriveService } from './backup-drive.service';
import { BackupsService } from './backups.service';
import { GUARDIAN_FRESH_MS, GuardianService } from './guardian.service';
import { PlatformAlertsService } from './platform-alerts.service';
import { PostgresWalService } from './postgres-wal';
import { UpdateManager } from './update-manager.service';

/** Ajustes del monitoreo externo: `platform:*` → viajan en la copia del servidor. */
const MONITORING_KEY = 'platform:monitoring';
const HB_LAST_KEY = 'pwatch:hb:last';
/** Hasta dónde se avisaron los eventos del guardián (`at` del último). */
const GUARDIAN_CURSOR_KEY = 'pwatch:guardian:at';
const FRONT_BAD_KEY = 'pwatch:front:bad';
const SLOW_GATE_KEY = 'pwatch:slow';
const CERT_GATE_KEY = 'pwatch:cert';

/** Informe del guardián más viejo que esto = el guardián dejó de revisar. */
export const GUARDIAN_STALE_MS = 10 * 60_000;
/** Sin copia más nueva que esto, con las automáticas encendidas = falta una copia. */
export const BACKUP_MISSING_MS = 36 * 3600_000;
export const CERT_WARN_DAYS = 14;
export const CERT_CRITICAL_DAYS = 3;

/** Los eventos del guardián que piden una persona (además de los `ok: false`). */
const ATTENTION_KINDS = new Set(['needs_attention']);
/** v0.1.432 — Quién entró a la página de rescate: aviso aparte (no es una reparación). */
const ACCESS_KINDS = new Set(['rescue_login', 'rescue_blocked']);
/** La página de rescate no arranca: no es la app caída, tiene su propio aviso. */
const RESCUE_FAIL_KIND = 'rescue_page_failed';

const GUARDIAN_KIND_LABEL: Record<string, string> = {
    postgres_started: 'Base de datos encendida',
    postgres_start_failed: 'La base de datos no arrancó',
    postgres_missing: 'No se encuentra el contenedor de la base',
    redis_restarted: 'Redis reiniciado',
    redis_restart_failed: 'Redis no arrancó',
    rolled_back: 'Vuelta a la versión anterior',
    rollback_failed: 'No se pudo volver a la versión anterior',
    api_restarted: 'App reiniciada',
    api_restart_failed: 'La app no volvió después de reiniciarla',
    needs_attention: 'Necesita que lo revises',
    nginx_started: 'Nginx encendido',
    nginx_start_failed: 'Nginx no arrancó',
    caddy_restarted: 'Caddy reiniciado',
    caddy_start_failed: 'Caddy no arrancó',
    nginx_repaired: 'Configuración de Nginx repuesta',
    nginx_repair_failed: 'No se pudo reponer Nginx',
    disk_cleaned: 'Espacio liberado',
    disk_still_full: 'El disco sigue lleno',
    manual_restart: 'App reiniciada a mano',
    manual_restart_failed: 'Se reinició la app a mano y no responde',
    manual_rollback: 'Vuelta a la versión anterior (a mano)',
    manual_rollback_failed: 'No se pudo volver a la versión anterior',
    manual_cleanup: 'Espacio liberado (a mano)',
    rescue_login: 'Entraron a la página de rescate',
    rescue_blocked: 'Página de rescate bloqueada',
    rescue_page_failed: 'La página de rescate no arranca',
};

export function guardianKindLabel(kind: string): string {
    return GUARDIAN_KIND_LABEL[kind] ?? kind;
}

/**
 * Los eventos que todavía no se avisaron: más nuevos que el cursor y, para no
 * cortar una corrida del guardián a la mitad, no más nuevos que su informe
 * (el guardián escribe los eventos y AL FINAL el informe, con la misma hora).
 * Sin cursor (recién instalado o Redis vacío) sólo las últimas 2 horas.
 */
export function pendingGuardianEvents(events: GuardianEvent[], cursor: string | null, reportAt: string | null, now: number): GuardianEvent[] {
    const floor = cursor ?? new Date(now - 2 * 3600_000).toISOString();
    return events
        .filter((e) => e.at > floor && (!reportAt || e.at <= reportAt))
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** El informe del guardián dice que todo lo que mira está bien. */
export function guardianAllOk(r: GuardianReport): boolean {
    const c = r.checks;
    const good = (s: string) => s === 'ok' || s === 'skipped' || s === 'updating';
    return good(c.api) && good(c.database) && good(c.redis) && good(c.web_server) && good(c.front) && c.disk.ok;
}

/** Días hasta que vence un certificado (`valid_to` de node). */
export function certDaysLeft(validTo: string, now: number): number | null {
    const t = Date.parse(validTo);
    return Number.isFinite(t) ? Math.floor((t - now) / 86_400_000) : null;
}

function fmtDay(iso: string): string {
    return iso.slice(0, 10);
}
function fmtTime(iso: string): string {
    return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * v0.1.431 (ADR-S104) — La vigilancia del servidor, desde la app. Corre cada
 * minuto en su PROPIA cola (`platform-watch`): la del actualizador tiene
 * concurrencia 1 y trabajos de media hora, y un latido atrasado detrás de una
 * copia de seguridad haría que Better Stack avise una caída que no existe.
 *
 *  - Cada minuto: el latido al monitoreo externo, los eventos del guardián
 *    (correo con lo que reparó o lo que no pudo) y si el guardián sigue vivo.
 *  - Cada 15 minutos: copias (fallidas, atrasadas, apagadas, sin salir del
 *    servidor), Google Drive, la última actualización, el registro de cambios
 *    de la base y, si no hay guardián, la puerta de entrada por el dominio.
 *  - Cada 6 horas: el certificado del dominio.
 *
 * Lo que ya avisa por su cuenta (el WAL y el disco desde `PostgresWalService`,
 * la subida a Drive desde `BackupDriveService`) aparece en el panel sin un
 * segundo correo.
 */
@Injectable()
export class PlatformWatchService {
    private readonly logger = new Logger(PlatformWatchService.name);
    /** Para tests: la sonda de la puerta de entrada y del certificado. */
    frontProbe: (url: string) => Promise<'ok' | 'down' | 'unknown'> = (url) => probeHttp(url);
    certProbe: (host: string) => Promise<{ valid_to: string; authorized: boolean; error: string | null } | null> = (host) => probeCert(host);

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        @Inject(PG_POOL) private readonly pool: Pool,
        private readonly alerts: PlatformAlertsService,
        private readonly guardian: GuardianService,
        private readonly backups: BackupsService,
        private readonly drive: BackupDriveService,
        private readonly manager: UpdateManager,
        @Optional() private readonly wal?: PostgresWalService,
    ) {}

    private get production(): boolean {
        return this.env.NODE_ENV === 'production' && this.env.UPDATER_BASE_PATH !== '';
    }

    // ── el tick ─────────────────────────────────────────────────────────

    /** Lo de cada minuto; lo lento sólo si le toca (o con `force`). */
    async tick(opts: { force?: boolean } = {}, now = Date.now()): Promise<void> {
        const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
            try {
                await fn();
            } catch (err) {
                this.logger.warn(`Vigilancia (${name}): ${(err as Error).message}`);
            }
        };
        await step('guardián', () => this.checkGuardian(now));
        await step('puerta de entrada', () => this.checkFront(now));
        const slow = opts.force || (await this.redis.set(SLOW_GATE_KEY, '1', 'EX', 14 * 60 - 10, 'NX')) === 'OK';
        if (slow) {
            await step('copias', () => this.checkBackups(now));
            await step('Google Drive', () => this.checkDrive(now));
            await step('actualización', () => this.checkUpdate(now));
            await step('base de datos', () => this.checkDatabaseMirror(now));
        }
        const cert = opts.force || (await this.redis.set(CERT_GATE_KEY, '1', 'EX', 6 * 3600 - 30, 'NX')) === 'OK';
        if (cert) await step('certificado', () => this.checkCertificate(now));
        await step('latido', () => this.heartbeat(now));
        await this.alerts.markChecked(new Date(now));
    }

    // ── el guardián ─────────────────────────────────────────────────────

    async checkGuardian(now = Date.now()): Promise<void> {
        const at = new Date(now);
        const report = this.guardian.report();
        if (!report) {
            await this.alerts.resolvePrefix('guardian:', 'guardian:missing', {}, at);
            if (this.production) {
                await this.alerts.raise(
                    {
                        key: 'guardian:missing',
                        source: 'guardian',
                        severity: 'warning',
                        title: 'La reparación automática del servidor no está instalada',
                        detail: 'Si algo tumba la app (un cambio de Nginx, un reinicio, un disco lleno), nada la vuelve a levantar sola.',
                        paragraphs: [
                            'La reparación automática del servidor (el guardián) no está instalada en este servidor.',
                            'Sin ella, si algo tumba la app —un panel que reescribe la configuración de Nginx, un servicio que no arranca, un disco lleno—, nada la vuelve a levantar sola y hay que entrar por consola.',
                            `Se instala UNA vez, como root: ${this.guardian.installCommand()}`,
                        ],
                        action_path: '/platform?tab=diagnostico',
                        action_label: 'Ver cómo instalarla',
                        remind_hours: 72,
                    },
                    at,
                );
            }
            return;
        }
        await this.alerts.resolve('guardian:missing', { notify: false }, at);
        const age = this.guardian.reportAgeMs(now) ?? Number.POSITIVE_INFINITY;
        if (age > GUARDIAN_STALE_MS) {
            await this.alerts.raise(
                {
                    key: 'guardian:stale',
                    source: 'guardian',
                    severity: 'warning',
                    title: 'La reparación automática del servidor dejó de revisar',
                    detail: `Su último informe es del ${fmtTime(report.updated_at)}.`,
                    paragraphs: [
                        `La reparación automática del servidor dejó de revisar: su último informe es del ${fmtTime(report.updated_at)}.`,
                        'Puede que se haya apagado su temporizador. Para volver a ponerla en marcha, como root:',
                        'systemctl enable --now imagina-guardian.timer imagina-guardian.path',
                        `O vuelve a correr el instalador: ${this.guardian.installCommand()}`,
                    ],
                    remind_hours: 24,
                },
                at,
            );
        } else {
            await this.alerts.resolve('guardian:stale', { message: 'La reparación automática volvió a revisar el servidor.' }, at);
        }
        if (report.version > 0 && report.version < GUARDIAN_VERSION) {
            await this.alerts.raise(
                {
                    key: `guardian:outdated:${report.version}`,
                    source: 'guardian',
                    severity: 'info',
                    title: 'Hay una versión nueva de la reparación automática',
                    detail: 'Esta versión de la app trae mejoras para el guardián del servidor.',
                    paragraphs: [
                        'Esta versión de la app trae una versión nueva de la reparación automática del servidor (el guardián).',
                        `Para instalarla, como root: ${this.guardian.installCommand()}`,
                    ],
                    remind_hours: 0,
                },
                at,
            );
        } else {
            await this.alerts.resolvePrefix('guardian:outdated:', undefined, { notify: false }, at);
        }
        await this.mailGuardianEvents(report, now);
        if (age <= GUARDIAN_STALE_MS && guardianAllOk(report)) {
            await this.alerts.resolve('guardian:attention', { message: 'El servidor volvió a funcionar: la app, la base y la entrada por el dominio responden.' }, at);
        }
    }

    /**
     * Un correo por tanda con lo que el guardián reparó (o no pudo). Aparte:
     * quién entró a la página de rescate (siempre se avisa, aunque haya sido
     * el propio operador) y la página de rescate que no arranca.
     */
    private async mailGuardianEvents(report: GuardianReport, now: number): Promise<void> {
        const at = new Date(now);
        if (!report.rescue.enabled || report.rescue.active) {
            await this.alerts.resolve('guardian:rescue', { message: 'La página de rescate volvió a funcionar.' }, at);
        }
        const cursor = await this.redis.get(GUARDIAN_CURSOR_KEY);
        const pending = pendingGuardianEvents(this.guardian.events(), cursor, report.updated_at, now);
        if (!pending.length) {
            if (!cursor) await this.redis.set(GUARDIAN_CURSOR_KEY, report.updated_at);
            return;
        }
        const last = pending[pending.length - 1]!;
        await this.redis.set(GUARDIAN_CURSOR_KEY, last.at);
        const line = (e: GuardianEvent) => `• ${fmtTime(e.at)} — ${guardianKindLabel(e.kind)}: ${e.message}`;

        const access = pending.filter((e) => ACCESS_KINDS.has(e.kind));
        if (access.length) {
            const blocked = access.some((e) => e.kind === 'rescue_blocked');
            const lastAccess = access[access.length - 1]!;
            await this.alerts.event(
                {
                    key: `guardian:access:${lastAccess.id}`,
                    source: 'guardian',
                    severity: 'warning',
                    title: blocked ? 'Intentaron entrar a la página de rescate con claves equivocadas' : 'Entraron a la página de rescate del servidor',
                    detail: lastAccess.message,
                    paragraphs: [
                        blocked
                            ? 'Alguien probó varias claves equivocadas en la página de rescate del servidor y quedó bloqueado 15 minutos.'
                            : 'Alguien entró con la clave a la página de rescate del servidor.',
                        '',
                        ...access.map(line),
                        '',
                        'Si no fuiste tú, cambia la clave ahora: por SSH, como root, imagina-rescate clave (cierra las sesiones abiertas).',
                    ],
                },
                at,
            );
        }

        const rescueFail = pending.filter((e) => e.kind === RESCUE_FAIL_KIND);
        if (rescueFail.length && report.rescue.enabled && !report.rescue.active) {
            await this.alerts.raise(
                {
                    key: 'guardian:rescue',
                    source: 'guardian',
                    severity: 'warning',
                    title: 'La página de rescate del servidor no arranca',
                    detail: rescueFail[rescueFail.length - 1]!.message,
                    paragraphs: [
                        'La página de rescate del servidor no arranca. La app no se ve afectada, pero si se cae no tendrás esa página para repararla.',
                        '',
                        ...rescueFail.map(line),
                        '',
                        'Por SSH, como root: imagina-rescate (dice por qué) o vuelve a correr el instalador:',
                        this.guardian.installCommand(),
                    ],
                    remind_hours: 24,
                },
                at,
            );
        }

        const work = pending.filter((e) => !ACCESS_KINDS.has(e.kind) && e.kind !== RESCUE_FAIL_KIND);
        if (!work.length) return;
        const lastWork = work[work.length - 1]!;
        const bad = work.filter((e) => !e.ok || ATTENTION_KINDS.has(e.kind));
        const lines = work.map(line);
        if (bad.length) {
            const attention = work.some((e) => ATTENTION_KINDS.has(e.kind));
            await this.alerts.raise(
                {
                    key: 'guardian:attention',
                    source: 'guardian',
                    severity: 'critical',
                    title: attention ? 'El servidor necesita que lo revises' : 'La reparación automática no pudo arreglar algo',
                    detail: bad[bad.length - 1]!.message,
                    paragraphs: [
                        attention
                            ? 'La reparación automática del servidor intentó varias veces y no logró que todo funcione. Hace falta que alguien lo revise.'
                            : 'La reparación automática del servidor intentó arreglar algo y no pudo:',
                        '',
                        ...lines,
                    ],
                    remind_hours: 6,
                },
                at,
            );
            return;
        }
        const manual = work.every((e) => e.kind.startsWith('manual_'));
        await this.alerts.event(
            {
                key: `guardian:event:${lastWork.id}`,
                source: 'guardian',
                severity: 'info',
                title: manual
                    ? `Se hizo lo que pediste en el servidor: ${guardianKindLabel(lastWork.kind).toLowerCase()}`
                    : work.length === 1
                      ? `El servidor se reparó solo: ${guardianKindLabel(lastWork.kind).toLowerCase()}`
                      : 'El servidor se reparó solo',
                detail: lastWork.message,
                paragraphs: [
                    manual
                        ? 'Se hizo lo que se pidió a mano (por SSH o desde la página de rescate). Te avisamos para que quede registro.'
                        : 'La reparación automática del servidor encontró algo mal y lo arregló. No hace falta hacer nada; te avisamos para que sepas qué pasó.',
                    '',
                    ...lines,
                ],
            },
            at,
        );
    }

    // ── la puerta de entrada ────────────────────────────────────────────

    /**
     * Que la app abra desde afuera, por su dominio. Con el guardián al día se
     * usa lo que él vio (lo mira cada minuto desde el propio servidor); sin
     * guardián, la app se prueba a sí misma por su dirección pública.
     */
    async checkFront(now = Date.now()): Promise<void> {
        const at = new Date(now);
        let state: 'ok' | 'down' | 'unknown';
        let how: string;
        const report = this.guardian.report();
        const age = this.guardian.reportAgeMs(now);
        if (report && age !== null && age < GUARDIAN_FRESH_MS) {
            state = report.checks.front === 'ok' ? 'ok' : report.checks.front === 'down' || report.checks.front === 'cert' ? 'down' : 'unknown';
            how = report.checks.front === 'cert' ? 'el certificado del dominio no es válido' : 'no responde por el dominio';
        } else if (this.production && this.env.APP_BASE_URL.startsWith('https://')) {
            const base = this.env.APP_BASE_URL.replace(/\/$/, '');
            const [api, root] = await Promise.all([this.frontProbe(`${base}/api/v1/health/live`), this.frontProbe(`${base}/`)]);
            state = api === 'down' || root === 'down' ? 'down' : api === 'ok' && root === 'ok' ? 'ok' : 'unknown';
            how = 'no responde por el dominio';
        } else {
            return;
        }
        if (state === 'ok') {
            await this.redis.del(FRONT_BAD_KEY);
            await this.alerts.resolve('front:down', { message: 'La app volvió a abrir por su dominio.' }, at);
            return;
        }
        if (state === 'unknown') return;
        const bad = await this.redis.incr(FRONT_BAD_KEY);
        await this.redis.expire(FRONT_BAD_KEY, 3600);
        if (bad < 3) return;
        const host = safeHost(this.env.APP_BASE_URL);
        await this.alerts.raise(
            {
                key: 'front:down',
                source: 'front',
                severity: 'critical',
                title: `La app no abre desde afuera (${host})`,
                detail: `Desde hace al menos 3 minutos ${how}.`,
                paragraphs: [
                    `La app no abre desde afuera: desde hace al menos 3 minutos ${how} (${host}).`,
                    report
                        ? 'La reparación automática ya lo está intentando; si no lo logra, te llega otro aviso.'
                        : 'La causa más común en ServerAvatar: el panel reescribió la configuración de Nginx al emitir un certificado. Como root: bash /opt/imagina-base/current/deploy/serveravatar-nginx.sh <tu dominio>',
                ],
                remind_hours: 6,
            },
            at,
        );
    }

    // ── copias y Drive ──────────────────────────────────────────────────

    async checkBackups(now = Date.now()): Promise<void> {
        const at = new Date(now);
        const h = await this.backups.health();
        if (!h.available) return;
        const run = h.run;
        if (run.status === 'failed' && run.finished_at) {
            const key = `backups:failed:${run.finished_at}`;
            await this.alerts.resolvePrefix('backups:failed:', key, { notify: false }, at);
            const what = run.kind === 'restore' ? 'La restauración de una copia falló' : run.kind === 'drive_upload' ? 'La subida de una copia a Google Drive falló' : 'La copia de seguridad del servidor falló';
            await this.alerts.raise(
                {
                    key,
                    source: 'backups',
                    severity: 'critical',
                    title: what,
                    detail: run.message ?? 'Sin detalle.',
                    paragraphs: [`${what} (${fmtTime(run.finished_at)}):`, '', run.message ?? 'Sin detalle.', '', 'Mientras no se arregle, no hay una copia reciente para volver atrás si algo se pierde.'],
                    action_path: '/platform?tab=backups',
                    action_label: 'Abrir Plataforma → Copias de seguridad',
                    remind_hours: 24,
                },
                at,
            );
        } else if (run.status === 'success' || run.status === 'idle') {
            await this.alerts.resolvePrefix('backups:failed:', undefined, { message: 'La última copia de seguridad salió bien.' }, at);
        }
        if (h.settings.enabled) {
            await this.alerts.resolve('backups:off', { notify: false }, at);
            const last = h.last_snapshot_at ? Date.parse(h.last_snapshot_at) : null;
            if (last !== null && now - last > BACKUP_MISSING_MS) {
                await this.alerts.raise(
                    {
                        key: 'backups:missing',
                        source: 'backups',
                        severity: 'warning',
                        title: 'No hay una copia de seguridad reciente',
                        detail: `La última es del ${fmtTime(h.last_snapshot_at!)}.`,
                        paragraphs: [
                            `Las copias automáticas están encendidas, pero la última es del ${fmtTime(h.last_snapshot_at!)} (más de un día y medio).`,
                            'Puede que el servidor haya estado apagado a la hora de la copia o que las copias estén fallando.',
                        ],
                        action_path: '/platform?tab=backups',
                        action_label: 'Abrir Plataforma → Copias de seguridad',
                        remind_hours: 24,
                    },
                    at,
                );
            } else {
                await this.alerts.resolve('backups:missing', { message: 'Ya hay una copia de seguridad reciente.' }, at);
            }
        } else {
            await this.alerts.resolve('backups:missing', { notify: false }, at);
            await this.alerts.raise(
                {
                    key: 'backups:off',
                    source: 'backups',
                    severity: 'warning',
                    title: 'Las copias automáticas del servidor están apagadas',
                    detail: 'Si algo se pierde, no hay una copia reciente para volver atrás.',
                    paragraphs: ['Las copias automáticas del servidor están apagadas: si algo se pierde, no hay una copia reciente para volver atrás.', 'Se encienden en Plataforma → Copias de seguridad (una por día, a la hora que elijas).'],
                    action_path: '/platform?tab=backups',
                    action_label: 'Encender las copias automáticas',
                    remind_hours: 0,
                },
                at,
            );
        }
    }

    async checkDrive(now = Date.now()): Promise<void> {
        const at = new Date(now);
        const h = await this.backups.health();
        if (!h.available) return;
        const d = await this.drive.status();
        const outside = d.configured && d.connected && d.passphrase_set && d.enabled;
        // La subida a Drive ya manda su propio correo cuando falla
        // (BackupDriveService): aquí sólo queda en el panel.
        if (d.connected && d.broken) {
            await this.alerts.raise(
                {
                    key: 'drive:broken',
                    source: 'drive',
                    severity: 'critical',
                    title: 'Hay que volver a conectar Google Drive',
                    detail: d.broken,
                    action_path: '/platform?tab=backups',
                    action_label: 'Reconectar Google Drive',
                    mail: false,
                },
                at,
            );
        } else {
            await this.alerts.resolve('drive:broken', { notify: false }, at);
        }
        if (outside && d.last_upload && !d.last_upload.ok) {
            await this.alerts.raise(
                {
                    key: 'drive:upload',
                    source: 'drive',
                    severity: 'critical',
                    title: 'La última copia no se pudo subir a Google Drive',
                    detail: d.last_upload.message ?? 'Sin detalle.',
                    action_path: '/platform?tab=backups',
                    action_label: 'Abrir Plataforma → Copias de seguridad',
                    mail: false,
                },
                at,
            );
        } else {
            await this.alerts.resolve('drive:upload', { notify: false }, at);
        }
        if (h.settings.enabled && !outside) {
            await this.alerts.raise(
                {
                    key: 'drive:none',
                    source: 'drive',
                    severity: 'warning',
                    title: 'Las copias no salen del servidor',
                    detail: 'Si el servidor se pierde, las copias se pierden con él.',
                    paragraphs: [
                        'Las copias de seguridad se guardan sólo dentro del servidor: si el servidor se pierde, se pierden con él.',
                        'Conecta Google Drive en Plataforma → Copias de seguridad para que cada copia se suba cifrada fuera del servidor.',
                    ],
                    action_path: '/platform?tab=backups',
                    action_label: 'Conectar Google Drive',
                    remind_hours: 0,
                },
                at,
            );
        } else {
            await this.alerts.resolve('drive:none', { notify: false }, at);
        }
    }

    // ── actualización, base y certificado ───────────────────────────────

    async checkUpdate(now = Date.now()): Promise<void> {
        const at = new Date(now);
        const run = await this.manager.run();
        if ((run.status === 'failed' || run.status === 'rolled_back') && run.finished_at) {
            const key = `update:${run.status}:${run.finished_at}`;
            await this.alerts.resolvePrefix('update:', key, { notify: false }, at);
            const failed = run.status === 'failed';
            const title = failed ? `La actualización${run.version ? ` a la ${run.version}` : ''} no se pudo instalar` : `La actualización${run.version ? ` a la ${run.version}` : ''} se revirtió`;
            await this.alerts.raise(
                {
                    key,
                    source: 'update',
                    severity: failed ? 'critical' : 'warning',
                    title,
                    detail: run.message ?? 'Sin detalle.',
                    paragraphs: [
                        `${title} (${fmtTime(run.finished_at)}):`,
                        '',
                        run.message ?? 'Sin detalle.',
                        '',
                        failed ? 'La app sigue en la versión que tenía. Revisa el motivo antes de volver a intentarlo.' : 'La versión nueva no pasó la revisión de salud y la app volvió a la anterior: sigue funcionando.',
                    ],
                    action_path: '/platform?tab=updates',
                    action_label: 'Abrir Plataforma → Actualizaciones',
                    remind_hours: 72,
                },
                at,
            );
        } else if (run.status === 'success') {
            await this.alerts.resolvePrefix('update:', undefined, { message: 'La actualización se instaló bien.' }, at);
        }
    }

    /** El WAL y el disco ya avisan por correo desde `PostgresWalService`: aquí, al panel. */
    async checkDatabaseMirror(now = Date.now()): Promise<void> {
        const at = new Date(now);
        if (!this.wal) return;
        const s = await this.wal.status();
        if (s.available && s.health === 'failing') {
            await this.alerts.raise(
                {
                    key: 'database:wal',
                    source: 'database',
                    severity: 'critical',
                    title: 'La base de datos no está archivando su registro de cambios',
                    detail: `${s.pending ?? 0} segmentos pendientes: el disco se va llenando.`,
                    action_path: '/platform?tab=diagnostico',
                    action_label: 'Liberar y reparar',
                    mail: false,
                },
                at,
            );
        } else {
            await this.alerts.resolve('database:wal', { notify: false }, at);
        }
        const report = this.guardian.report();
        const diskLow = report && (this.guardian.reportAgeMs(now) ?? Infinity) < GUARDIAN_FRESH_MS ? !report.checks.disk.ok : null;
        if (diskLow) {
            await this.alerts.raise(
                {
                    key: 'disk:low',
                    source: 'disk',
                    severity: 'critical',
                    title: 'El disco del servidor se está llenando',
                    detail: 'La reparación automática ya liberó lo que podía.',
                    action_path: '/platform?tab=diagnostico',
                    action_label: 'Ver el disco',
                    mail: false,
                },
                at,
            );
        } else if (diskLow === false) {
            await this.alerts.resolve('disk:low', { notify: false }, at);
        }
    }

    async checkCertificate(now = Date.now()): Promise<void> {
        const at = new Date(now);
        if (!this.production || !this.env.APP_BASE_URL.startsWith('https://')) return;
        const host = safeHost(this.env.APP_BASE_URL);
        if (!host) return;
        const cert = await this.certProbe(host);
        if (!cert) return; // sin conexión: lo cubre la puerta de entrada
        const days = certDaysLeft(cert.valid_to, now);
        const key = `cert:${host}`;
        if (days !== null && days < CERT_WARN_DAYS) {
            const expired = days < 0;
            await this.alerts.raise(
                {
                    key,
                    source: 'certificate',
                    severity: days < CERT_CRITICAL_DAYS ? 'critical' : 'warning',
                    title: expired ? `El certificado de ${host} venció` : `El certificado de ${host} vence en ${days} ${days === 1 ? 'día' : 'días'}`,
                    detail: `Vence el ${fmtDay(new Date(Date.parse(cert.valid_to)).toISOString())}.`,
                    paragraphs: [
                        expired
                            ? `El certificado HTTPS de ${host} venció: los navegadores muestran «no es seguro» y no dejan entrar.`
                            : `El certificado HTTPS de ${host} vence el ${fmtDay(new Date(Date.parse(cert.valid_to)).toISOString())} y no se renovó todavía.`,
                        'Se renueva solo cada 60-90 días; si no lo hizo, suele ser porque uno de los dominios del certificado ya no apunta al servidor (en ServerAvatar todos los dominios comparten UN certificado: uno roto frena la renovación de todos).',
                        'Revisa en Plataforma → Dominios los que hay que quitar del servidor y vuelve a emitir el certificado.',
                    ],
                    action_path: '/platform?tab=dominios',
                    action_label: 'Abrir Plataforma → Dominios',
                    remind_hours: days < CERT_CRITICAL_DAYS ? 12 : 72,
                },
                at,
            );
        } else if (days !== null) {
            await this.alerts.resolve(key, { message: `El certificado de ${host} se renovó.` }, at);
        }
    }

    // ── monitoreo externo (heartbeat) ───────────────────────────────────

    async getMonitoring(): Promise<MonitoringSettings> {
        const raw = await this.redis.get(MONITORING_KEY);
        try {
            return monitoringSettingsSchema.parse(raw ? JSON.parse(raw) : {});
        } catch {
            return monitoringSettingsSchema.parse({});
        }
    }

    async setMonitoring(patch: UpdateMonitoringInput): Promise<MonitoringStatus> {
        const current = await this.getMonitoring();
        const next = monitoringSettingsSchema.parse({ ...current, ...patch });
        await this.redis.set(MONITORING_KEY, JSON.stringify(next));
        if (patch.heartbeat_url !== undefined && patch.heartbeat_url !== current.heartbeat_url) await this.redis.del(HB_LAST_KEY);
        return this.monitoringStatus();
    }

    async lastPing(): Promise<HeartbeatPing | null> {
        const raw = await this.redis.get(HB_LAST_KEY);
        if (!raw) return null;
        try {
            const r = heartbeatPingSchema.safeParse(JSON.parse(raw));
            return r.success ? r.data : null;
        } catch {
            return null;
        }
    }

    async monitoringStatus(now = Date.now()): Promise<MonitoringStatus> {
        return {
            settings: await this.getMonitoring(),
            last_ping: await this.lastPing(),
            holding_reason: await this.holdingReason(now),
            health_url: `${this.env.APP_BASE_URL.replace(/\/$/, '')}/api/v1/health/ready`,
        };
    }

    /**
     * Por qué NO hay que latir ahora (null = todo bien). La app viva no alcanza:
     * si la base no responde o la app no abre por su dominio, el monitoreo de
     * afuera tiene que enterarse aunque este proceso siga corriendo.
     */
    async holdingReason(now = Date.now()): Promise<string | null> {
        try {
            await this.pool.query('SELECT 1');
        } catch (err) {
            return `La base de datos no responde: ${(err as Error).message}`;
        }
        const report = this.guardian.report();
        const age = this.guardian.reportAgeMs(now);
        if (report && age !== null && age < GUARDIAN_FRESH_MS) {
            if (report.checks.front === 'down') return 'La app no abre desde afuera (por su dominio).';
            if (report.checks.front === 'cert') return 'El certificado del dominio no es válido.';
            if (!report.checks.disk.ok) return 'El disco del servidor está lleno.';
        }
        if (await this.alerts.get('front:down')) return 'La app no abre desde afuera (por su dominio).';
        return null;
    }

    /**
     * El latido: GET a la dirección del heartbeat cada minuto mientras todo
     * está bien. Si algo falla y el servicio entiende `/fail` (Better Stack,
     * Healthchecks.io) se avisa la falla al momento; si no, se deja de latir
     * y el servicio avisa al no recibir más.
     */
    async heartbeat(now = Date.now(), opts: { test?: boolean } = {}): Promise<HeartbeatPing | null> {
        const settings = await this.getMonitoring();
        if (!settings.heartbeat_url || (!settings.enabled && !opts.test)) return null;
        const holding = opts.test ? null : await this.holdingReason(now);
        if (holding && !heartbeatSupportsFail(settings.heartbeat_url)) {
            const skipped: HeartbeatPing = { at: new Date(now).toISOString(), ok: false, failed: true, status: null, message: `Sin latir: ${holding}` };
            await this.redis.set(HB_LAST_KEY, JSON.stringify(skipped));
            return skipped;
        }
        const url = holding ? `${settings.heartbeat_url.replace(/\/$/, '')}/fail` : settings.heartbeat_url;
        let ping: HeartbeatPing;
        try {
            const res = await safeWebhookFetch(url, { method: 'GET', timeoutMs: 10_000 });
            const ok = res.status >= 200 && res.status < 300;
            ping = {
                at: new Date(now).toISOString(),
                ok,
                failed: !!holding,
                status: res.status,
                message: holding ? `Se avisó una falla: ${holding}` : ok ? null : `El servicio de monitoreo respondió ${res.status}: revisa la dirección del heartbeat.`,
            };
        } catch (err) {
            ping = { at: new Date(now).toISOString(), ok: false, failed: !!holding, status: null, message: `No se pudo llegar al servicio de monitoreo: ${(err as Error).message}` };
        }
        await this.redis.set(HB_LAST_KEY, JSON.stringify(ping));
        return ping;
    }
}

function safeHost(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

/** ¿Responde 2xx? `unknown` cuando ni siquiera hubo respuesta (red del propio servidor). */
async function probeHttp(url: string): Promise<'ok' | 'down' | 'unknown'> {
    try {
        const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'imagina-watch' } });
        await res.body?.cancel().catch(() => undefined);
        return res.status >= 200 && res.status < 400 ? 'ok' : 'down';
    } catch (err) {
        const cause = (err as { cause?: { code?: string } }).cause?.code ?? '';
        // Un certificado inválido sí es una caída (los navegadores no entran).
        if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(cause)) return 'down';
        return 'unknown';
    }
}

/** Vencimiento del certificado que presenta el dominio. null = no se pudo conectar. */
function probeCert(host: string): Promise<{ valid_to: string; authorized: boolean; error: string | null } | null> {
    return new Promise((resolve) => {
        const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
            const cert = socket.getPeerCertificate();
            const out = cert && cert.valid_to ? { valid_to: cert.valid_to, authorized: socket.authorized, error: socket.authorizationError ? String(socket.authorizationError) : null } : null;
            socket.end();
            resolve(out);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(null);
        });
        socket.on('error', () => resolve(null));
    });
}
