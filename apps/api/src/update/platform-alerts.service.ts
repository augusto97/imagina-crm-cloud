import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    platformAlertSchema,
    type PlatformAlert,
    type PlatformAlerts,
    type PlatformAlertSeverity,
    type PlatformAlertSource,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { REDIS } from '../redis/redis.module';

/** Avisos abiertos: un hash `clave → JSON`. Estado de ESTE servidor (no `platform:*`). */
const OPEN_KEY = 'palert:open';
/** Historial (lo resuelto y los avisos de una sola vez), los más nuevos primero. */
const LOG_KEY = 'palert:log';
const LOG_MAX = 100;
const CHECKED_KEY = 'palert:checked_at';
/** «Descartar» un aviso: no vuelve a abrirse con la MISMA clave por 30 días. */
const DISMISSED_PREFIX = 'palert:dismissed:';
const DISMISS_TTL_S = 30 * 86_400;

export interface RaiseInput {
    key: string;
    source: PlatformAlertSource;
    severity: PlatformAlertSeverity;
    title: string;
    detail: string;
    /** Párrafos del correo (el primero suele repetir `detail`). */
    paragraphs?: string[];
    action_path?: string | null;
    action_label?: string | null;
    /** Cada cuántas horas se vuelve a mandar el correo si sigue abierto (0 = una sola vez). */
    remind_hours?: number;
    /** false = sólo queda en el panel (otro servicio ya manda su propio correo). */
    mail?: boolean;
    /**
     * v0.1.435 — Mandar el correo en el acto, sin la cola de correos. Para lo
     * que avisa justamente que la cola no se está atendiendo (los trabajos en
     * segundo plano detenidos): por la cola ese correo no saldría nunca.
     */
    direct?: boolean;
}

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function parse(raw: string | null | undefined): PlatformAlert | null {
    if (!raw) return null;
    try {
        const r = platformAlertSchema.safeParse(JSON.parse(raw));
        return r.success ? r.data : null;
    } catch {
        return null;
    }
}

const SEVERITY_ORDER: Record<PlatformAlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * v0.1.431 (ADR-S104) — Los avisos al operador de la plataforma.
 *
 * Un aviso ABIERTO es algo que sigue mal (una copia que no sale, un
 * certificado que vence, el guardián que no responde): se abre una vez, manda
 * un correo a los superadmins, vuelve a avisar cada `remind_hours` si sigue
 * igual y, cuando se arregla, se cierra (con un correo «Ya está bien» si había
 * avisado). Un aviso DE UNA VEZ (`event`) es algo que pasó (el guardián
 * reparó algo): manda su correo y queda en el historial.
 *
 * Antes cada parte tenía su propio correo (el WAL, la copia en Drive) y lo
 * demás —una copia automática que fallaba, una actualización que no se
 * instaló, el certificado por vencer— no avisaba a nadie: se descubría
 * entrando a la consola. Ahora todo queda en Plataforma → Diagnóstico →
 * Avisos y en la casilla del operador.
 */
@Injectable()
export class PlatformAlertsService {
    private readonly logger = new Logger(PlatformAlertsService.name);

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        @Optional() private readonly mail?: MailService,
    ) {}

    private panelUrl(pathPart: string | null | undefined): string {
        const base = this.env.APP_BASE_URL.replace(/\/$/, '');
        const p = pathPart ?? '/platform?tab=diagnostico';
        return `${base}/#${p.startsWith('/') ? p : `/${p}`}`;
    }

    async get(key: string): Promise<PlatformAlert | null> {
        return parse(await this.redis.hget(OPEN_KEY, key));
    }

    /**
     * Abre (o actualiza) un aviso. Devuelve `true` si mandó correo ahora.
     */
    async raise(input: RaiseInput, now = new Date()): Promise<boolean> {
        const at = now.toISOString();
        if (await this.redis.exists(DISMISSED_PREFIX + input.key).catch(() => 0)) return false;
        const current = await this.get(input.key);
        const remindMs = (input.remind_hours ?? 24) * 3600_000;
        const wantsMail = input.mail !== false;
        // Subió de gravedad: se avisa aunque no haya pasado el intervalo (y como aviso nuevo).
        const escalated = !!current && SEVERITY_ORDER[input.severity] < SEVERITY_ORDER[current.severity];
        const notifyNow =
            wantsMail &&
            (!current || !current.notified_at || escalated || (remindMs > 0 && now.getTime() - Date.parse(current.notified_at) >= remindMs));
        const next: PlatformAlert = {
            key: input.key,
            source: input.source,
            severity: input.severity,
            title: input.title,
            detail: input.detail,
            action_path: input.action_path ?? null,
            action_label: input.action_label ?? null,
            opened_at: current?.opened_at ?? at,
            last_at: at,
            count: (current?.count ?? 0) + 1,
            notified_at: notifyNow ? at : (current?.notified_at ?? null),
            resolved_at: null,
        };
        let sent = false;
        if (notifyNow) {
            const reminder = !!current?.notified_at && !escalated;
            sent = await this.send(
                reminder ? `Sigue pendiente: ${input.title}` : input.title,
                [
                    ...(input.paragraphs ?? [input.detail]),
                    ...(reminder ? ['', `Lo vimos por primera vez el ${current!.opened_at.slice(0, 16).replace('T', ' ')} UTC y sigue igual.`] : []),
                ],
                next,
                input.direct === true,
            );
            if (!sent) next.notified_at = current?.notified_at ?? null;
        }
        await this.redis.hset(OPEN_KEY, input.key, JSON.stringify(next));
        return sent;
    }

    /** Cierra un aviso abierto. Si había avisado por correo, avisa que se arregló. */
    async resolve(key: string, opts: { message?: string; notify?: boolean } = {}, now = new Date()): Promise<boolean> {
        const current = await this.get(key);
        if (!current) return false;
        await this.redis.hdel(OPEN_KEY, key);
        const done: PlatformAlert = { ...current, resolved_at: now.toISOString() };
        await this.pushLog(done);
        if ((opts.notify ?? true) && current.notified_at && current.severity !== 'info') {
            await this.send(`Ya está bien: ${current.title}`, [opts.message ?? 'Lo que estaba mal se arregló; no hace falta hacer nada.'], done);
        }
        return true;
    }

    /** Cierra los avisos abiertos cuya clave empieza con `prefix` (menos `except`). */
    async resolvePrefix(prefix: string, except?: string, opts: { message?: string; notify?: boolean } = {}, now = new Date()): Promise<number> {
        const keys = (await this.redis.hkeys(OPEN_KEY).catch(() => [] as string[])).filter((k) => k.startsWith(prefix) && k !== except);
        let n = 0;
        for (const k of keys) if (await this.resolve(k, opts, now)) n++;
        return n;
    }

    /** «Ya lo vi»: se cierra sin correo y la misma clave no se vuelve a abrir por 30 días. */
    async dismiss(key: string, now = new Date()): Promise<boolean> {
        await this.redis.set(DISMISSED_PREFIX + key, now.toISOString(), 'EX', DISMISS_TTL_S);
        return this.resolve(key, { notify: false }, now);
    }

    /** Algo que pasó (no queda abierto): correo y al historial. */
    async event(input: Omit<RaiseInput, 'remind_hours'>, now = new Date()): Promise<boolean> {
        const at = now.toISOString();
        const alert: PlatformAlert = {
            key: input.key,
            source: input.source,
            severity: input.severity,
            title: input.title,
            detail: input.detail,
            action_path: input.action_path ?? null,
            action_label: input.action_label ?? null,
            opened_at: at,
            last_at: at,
            count: 1,
            notified_at: null,
            resolved_at: at,
        };
        const sent = input.mail === false ? false : await this.send(input.title, input.paragraphs ?? [input.detail], alert);
        if (sent) alert.notified_at = at;
        await this.pushLog(alert);
        return sent;
    }

    async list(): Promise<PlatformAlerts> {
        const [openRaw, logRaw, checked] = await Promise.all([
            this.redis.hgetall(OPEN_KEY).catch(() => ({}) as Record<string, string>),
            this.redis.lrange(LOG_KEY, 0, 49).catch(() => [] as string[]),
            this.redis.get(CHECKED_KEY).catch(() => null),
        ]);
        const open = Object.values(openRaw)
            .map(parse)
            .filter((a): a is PlatformAlert => a !== null)
            .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.last_at.localeCompare(a.last_at));
        const recent = logRaw.map(parse).filter((a): a is PlatformAlert => a !== null);
        const mailStatus = this.mail ? await this.mail.accountMailStatus().catch(() => null) : null;
        const recipients = this.env.PLATFORM_SUPERADMINS;
        return {
            open,
            recent,
            recipients,
            mail_available: !!mailStatus?.available && recipients.length > 0,
            mail_reason: !recipients.length
                ? 'No hay superadmins en PLATFORM_SUPERADMINS: nadie recibe los avisos.'
                : mailStatus && !mailStatus.available
                  ? mailStatus.reason
                  : null,
            checked_at: checked,
        };
    }

    async markChecked(now = new Date()): Promise<void> {
        await this.redis.set(CHECKED_KEY, now.toISOString()).catch(() => undefined);
    }

    private async pushLog(alert: PlatformAlert): Promise<void> {
        try {
            await this.redis.multi().lpush(LOG_KEY, JSON.stringify(alert)).ltrim(LOG_KEY, 0, LOG_MAX - 1).exec();
        } catch (err) {
            this.logger.warn(`No se pudo guardar el aviso en el historial: ${(err as Error).message}`);
        }
    }

    /** Un correo a cada superadmin. false = no salió (sin destinatarios o sin correo). */
    private async send(subject: string, paragraphs: string[], alert: PlatformAlert, direct = false): Promise<boolean> {
        const to = this.env.PLATFORM_SUPERADMINS;
        if (!this.mail || to.length === 0) return false;
        const link = this.panelUrl(alert.action_path);
        const label = alert.action_label ?? 'Abrir Plataforma → Diagnóstico';
        const tone = alert.severity === 'critical' ? '#fef2f2' : alert.severity === 'warning' ? '#fffbeb' : '#f0f9ff';
        const text = [...paragraphs, '', `${label}: ${link}`].join('\n');
        const html =
            `<div style="padding:10px 12px;background:${tone};border-radius:6px;margin-bottom:12px"><b>${esc(alert.title)}</b></div>` +
            paragraphs.map((p) => (p ? `<p>${esc(p)}</p>` : '')).join('') +
            `<p><a href="${esc(link)}">${esc(label)}</a></p>`;
        try {
            for (const address of to) {
                if (direct) await this.mail.sendNow({ to: address, subject, text, html });
                else await this.mail.enqueue({ to: address, subject, text, html });
            }
            return true;
        } catch (err) {
            this.logger.warn(`No se pudo avisar por correo (${subject}): ${(err as Error).message}`);
            return false;
        }
    }
}
