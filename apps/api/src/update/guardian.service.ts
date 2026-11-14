import { Inject, Injectable } from '@nestjs/common';
import {
    GUARDIAN_VERSION,
    guardianEventSchema,
    guardianReportSchema,
    type GuardianEvent,
    type GuardianReport,
    type GuardianStatus,
} from '@imagina-base/shared';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ENV, type Env } from '../config/env';

/** Revisó hace menos de esto: «al día». */
export const GUARDIAN_FRESH_MS = 5 * 60_000;
/** Cuántos eventos del final del archivo se leen. */
const EVENTS_TAIL = 60;

/** Lee los últimos `n` eventos del archivo (una línea JSON cada uno), tolerante. */
export function parseGuardianEvents(raw: string, n = EVENTS_TAIL): GuardianEvent[] {
    const out: GuardianEvent[] = [];
    const lines = raw.split('\n').filter((l) => l.trim());
    for (const line of lines.slice(-n)) {
        try {
            const parsed = guardianEventSchema.safeParse(JSON.parse(line));
            if (parsed.success) out.push(parsed.data);
        } catch {
            // línea a medias (el guardián estaba escribiendo): se ignora
        }
    }
    return out.reverse();
}

export function parseGuardianReport(raw: string): GuardianReport | null {
    try {
        const parsed = guardianReportSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/**
 * v0.1.431 (ADR-S104) — El guardián del servidor, visto desde la app.
 *
 * El guardián es un script de ROOT (`deploy/guardian/imagina-guardian.sh`) que
 * corre cada minuto por un timer de systemd: revisa el API, Postgres, Redis,
 * el servidor web, la puerta de entrada por el dominio y el disco, y repara lo
 * que puede (reiniciar, volver a la versión anterior, rehacer el archivo de
 * Nginx que reescribe ServerAvatar, liberar espacio). Nació de una caída real:
 * ServerAvatar reescribió el Nginx al emitir un certificado y la app quedó en
 * «403» sin nada que pudiera arreglarlo desde adentro.
 *
 * La app NUNCA le da órdenes: sólo lee su informe (`status.json` +
 * `events.jsonl`) y, con «Reparar ahora», deja un archivo VACÍO en
 * `requests/` que hace que el guardián revise al instante (el contenido no se
 * lee; lo que hace el guardián lo decide él). Así el usuario del API sigue sin
 * privilegios y no hay forma de que la app ejecute algo como root.
 */
@Injectable()
export class GuardianService {
    constructor(@Inject(ENV) private readonly env: Env) {}

    private get dir(): string {
        return this.env.GUARDIAN_DIR;
    }

    /** Sólo tiene sentido en un servidor con el layout de releases (producción). */
    applicable(): boolean {
        return this.env.UPDATER_BASE_PATH !== '' || existsSync(path.join(this.dir, 'status.json'));
    }

    installCommand(): string {
        const base = this.env.UPDATER_BASE_PATH || '/opt/imagina-base';
        return `sudo bash ${base}/current/deploy/install-guardian.sh`;
    }

    report(): GuardianReport | null {
        try {
            return parseGuardianReport(readFileSync(path.join(this.dir, 'status.json'), 'utf8'));
        } catch {
            return null;
        }
    }

    events(n = EVENTS_TAIL): GuardianEvent[] {
        try {
            return parseGuardianEvents(readFileSync(path.join(this.dir, 'events.jsonl'), 'utf8'), n);
        } catch {
            return [];
        }
    }

    requestPending(): boolean {
        try {
            return readdirSync(path.join(this.dir, 'requests')).length > 0;
        } catch {
            return false;
        }
    }

    /** Edad del informe en ms (null = no hay informe). Mira el archivo, no el reloj del informe. */
    reportAgeMs(now = Date.now()): number | null {
        try {
            return Math.max(0, now - statSync(path.join(this.dir, 'status.json')).mtimeMs);
        } catch {
            return null;
        }
    }

    status(now = Date.now()): GuardianStatus {
        const report = this.report();
        const age = this.reportAgeMs(now);
        return {
            applicable: this.applicable(),
            installed: report !== null,
            fresh: report !== null && age !== null && age < GUARDIAN_FRESH_MS,
            outdated: report !== null && report.version < GUARDIAN_VERSION,
            expected_version: GUARDIAN_VERSION,
            report,
            events: this.events(),
            request_pending: this.requestPending(),
            install_command: this.installCommand(),
        };
    }

    /**
     * «Reparar ahora»: un archivo vacío en `requests/` (sólo lo puede escribir
     * el usuario del API). El `.path` de systemd lo ve y corre al guardián en
     * segundos; el guardián lo borra sin leerlo.
     */
    requestRepair(now = Date.now()): { ok: boolean; reason: string | null } {
        const dir = path.join(this.dir, 'requests');
        if (!existsSync(dir)) {
            return { ok: false, reason: 'El guardián no está instalado en este servidor (falta su carpeta de pedidos).' };
        }
        try {
            writeFileSync(path.join(dir, `repair-${now}`), '', { flag: 'wx', mode: 0o600 });
            return { ok: true, reason: null };
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EEXIST') return { ok: true, reason: null };
            return { ok: false, reason: code === 'EACCES' ? 'La app no tiene permiso para dejar el pedido: vuelve a correr el instalador del guardián.' : (err as Error).message };
        }
    }
}
