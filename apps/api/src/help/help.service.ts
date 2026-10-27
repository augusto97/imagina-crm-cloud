import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    parsePlatformHelp,
    SYSTEM_GUIDE_IDS,
    type HelpConfigView,
    type PlatformHelp,
    type UpdatePlatformHelpInput,
} from '@imagina-base/shared';
import { REDIS } from '../redis/redis.module';

/** Subconjunto de ioredis: se testea con un fake en memoria. */
export interface HelpStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
}

/** `platform:*` → viaja en el snapshot del servidor (ADR-S20). */
export const HELP_KEY = 'platform:help';

/**
 * Fase 7 · entrega 2 — la ayuda que configura el operador (Plataforma →
 * Ayuda): el contacto de soporte que ven las empresas, un video por guía del
 * sistema, guías propias y guías del sistema ocultas. No hay secretos aquí:
 * la lectura es para cualquier miembro del equipo.
 */
@Injectable()
export class HelpService {
    private readonly logger = new Logger(HelpService.name);

    constructor(@Inject(REDIS) private readonly redis: HelpStore) {}

    /** La configuración completa (consola del operador). */
    async get(): Promise<PlatformHelp> {
        return this.read();
    }

    async update(patch: UpdatePlatformHelpInput): Promise<PlatformHelp> {
        const current = await this.read();
        const next = parsePlatformHelp({ ...current, ...patch });
        // Videos y ocultas sólo de guías que existen: un id viejo (de una
        // guía que el sistema ya no trae) se descarta solo.
        const known = new Set<string>(SYSTEM_GUIDE_IDS);
        next.videos = Object.fromEntries(Object.entries(next.videos).filter(([id]) => known.has(id)));
        next.hidden = [...new Set(next.hidden.filter((id) => known.has(id)))];
        await this.redis.set(HELP_KEY, JSON.stringify(next));
        return next;
    }

    /**
     * Lo que ve un miembro del equipo: las guías propias ya filtradas por su
     * rol (una guía sin roles es para todos). `role` es el rol BASE: un rol
     * propio cuenta como el suyo.
     */
    async forMember(role: string): Promise<HelpConfigView> {
        const cfg = await this.read();
        return {
            support: cfg.support,
            videos: cfg.videos,
            hidden: cfg.hidden,
            custom: cfg.custom.filter((g) => g.roles.length === 0 || (g.roles as string[]).includes(role)),
        };
    }

    private async read(): Promise<PlatformHelp> {
        let raw: string | null;
        try {
            raw = await this.redis.get(HELP_KEY);
        } catch (err) {
            // La ayuda no puede tumbar la app: sin Redis, la ayuda del sistema.
            this.logger.warn(`${HELP_KEY} no se pudo leer: ${err instanceof Error ? err.message : String(err)}`);
            return parsePlatformHelp({});
        }
        if (!raw) return parsePlatformHelp({});
        try {
            return parsePlatformHelp(JSON.parse(raw));
        } catch (err) {
            this.logger.warn(`${HELP_KEY} corrupto, se ignora: ${err instanceof Error ? err.message : String(err)}`);
            return parsePlatformHelp({});
        }
    }
}
