import type { GuardianCheckState, GuardianReport, PlatformAlertSeverity } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';

/**
 * v0.1.431 (ADR-S104) — Textos de la reparación automática y de los avisos del
 * servidor (puros: se prueban sin montar nada).
 */

export type CheckTone = 'ok' | 'bad' | 'wait' | 'none';

export function checkTone(state: GuardianCheckState): CheckTone {
    if (state === 'ok') return 'ok';
    if (state === 'down' || state === 'cert') return 'bad';
    if (state === 'updating') return 'wait';
    return 'none';
}

export function checkText(state: GuardianCheckState): string {
    switch (state) {
        case 'ok':
            return __('Funciona');
        case 'down':
            return __('No responde');
        case 'cert':
            return __('Certificado inválido');
        case 'updating':
            return __('Actualizándose');
        case 'skipped':
            return __('Sin revisar');
        default:
            return __('Sin datos');
    }
}

export function webModeLabel(mode: string): string {
    if (mode === 'serveravatar') return __('Nginx (ServerAvatar)');
    if (mode === 'nginx') return 'Nginx';
    if (mode === 'caddy') return 'Caddy';
    return __('Servidor web');
}

export interface CheckRow {
    key: string;
    label: string;
    state: GuardianCheckState;
    detail?: string;
}

/** Las filas que se muestran, en el orden en que importa mirarlas. */
export function guardianChecks(r: GuardianReport, size: (bytes: number) => string): CheckRow[] {
    const c = r.checks;
    const disk: GuardianCheckState = c.disk.ok ? 'ok' : 'down';
    return [
        { key: 'front', label: __('Entrada por el dominio'), state: c.front, detail: r.domain || undefined },
        { key: 'api', label: __('La app'), state: c.api },
        // v0.1.435 — con la app en dos procesos, los trabajos en segundo plano por su lado.
        ...(r.worker?.enabled ? [{ key: 'worker', label: __('Trabajos en segundo plano'), state: r.worker.check }] : []),
        { key: 'database', label: __('Base de datos'), state: c.database },
        { key: 'redis', label: 'Redis', state: c.redis },
        { key: 'web_server', label: webModeLabel(r.web_mode), state: c.web_server },
        {
            key: 'disk',
            label: __('Disco'),
            state: disk,
            detail: c.disk.total_bytes > 0 ? `${size(c.disk.free_bytes)} ${__('libres')}` : undefined,
        },
    ];
}

export function severityLabel(s: PlatformAlertSeverity): string {
    if (s === 'critical') return __('Urgente');
    if (s === 'warning') return __('Revisar');
    return __('Para saber');
}

export function severityVariant(s: PlatformAlertSeverity): 'destructive' | 'warning' | 'info' {
    if (s === 'critical') return 'destructive';
    if (s === 'warning') return 'warning';
    return 'info';
}

/** «hace 3 min», «hace 2 h», «hace 4 días» (para la última revisión y los eventos). */
export function agoText(iso: string | null | undefined, now = Date.now()): string {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return __('hace un momento');
    const m = Math.round(s / 60);
    if (m < 60) return `${__('hace')} ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `${__('hace')} ${h} h`;
    return `${__('hace')} ${Math.round(h / 24)} ${__('días')}`;
}

/** El servicio de monitoreo según la dirección del heartbeat. */
export function heartbeatProvider(url: string): string | null {
    const m = /^https:\/\/([^/:?#]+)/i.exec(url.trim());
    if (!m) return null;
    const host = m[1]!.toLowerCase();
    if (host === 'uptime.betterstack.com' || host.endsWith('betteruptime.com')) return 'Better Stack';
    if (host === 'hc-ping.com') return 'Healthchecks.io';
    if (host.endsWith('cronitor.link') || host.endsWith('cronitor.io')) return 'Cronitor';
    return null;
}

export interface ProcessesInfo {
    tone: CheckTone;
    title: string;
    detail: string;
}

/**
 * v0.1.435 — Cómo corre la app: en dos procesos (la que atiende y la de los
 * trabajos en segundo plano) o en uno. `role` lo dice el proceso que responde
 * al panel; `workers`, cuántos procesos están tomando trabajos ahora.
 */
export function processesInfo(p: { role: 'api' | 'worker' | 'all'; workers: number | null } | undefined): ProcessesInfo | null {
    if (!p) return null;
    if (p.role === 'api') {
        if (p.workers === 0) {
            return {
                tone: 'bad',
                title: __('Procesos separados: los trabajos en segundo plano están detenidos'),
                detail: __('La app atiende, pero nadie está haciendo las automatizaciones, los correos ni las sincronizaciones. Nada se pierde: queda en espera. La reparación automática lo vuelve a arrancar; si no, por SSH: imagina-reparar.'),
            };
        }
        return {
            tone: 'ok',
            title: __('Procesos separados'),
            detail:
                p.workers === null
                    ? __('La app atiende a las personas y otro proceso hace los trabajos en segundo plano.')
                    : __('La app atiende a las personas y otro proceso hace los trabajos en segundo plano (automatizaciones, correos, sincronizaciones, copias): si uno se traba, la app sigue respondiendo.'),
        };
    }
    return {
        tone: 'none',
        title: __('Un solo proceso'),
        detail: __('La app y los trabajos en segundo plano corren juntos. Con 1,5 GB de RAM o más se pueden separar: vuelve a correr el instalador de la reparación automática (lo hace solo, o con --procesos-separados).'),
    };
}
