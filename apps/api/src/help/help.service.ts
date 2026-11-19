import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    helpSupportSchema,
    parsePlatformHelp,
    SYSTEM_GUIDE_IDS,
    type HelpConfigView,
    type HelpSupport,
    type PlatformHelp,
    type UpdatePlatformHelpInput,
} from '@imagina-base/shared';
import { agencyOf } from '../agency/agency-brand';
import { DRIZZLE, type Db } from '../db/client';
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

    constructor(
        @Inject(REDIS) private readonly redis: HelpStore,
        // v0.1.450 — para saber si la empresa es cliente de una agencia.
        @Optional() @Inject(DRIZZLE) private readonly db?: Db,
    ) {}

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
    async forMember(role: string, tenantId?: number): Promise<HelpConfigView> {
        const cfg = await this.read();
        // v0.1.450 (ADR-S108) — el equipo de una empresa cliente pide ayuda a
        // SU agencia: su contacto, y nada del operador (guías propias y videos
        // pueden mostrar la marca de la plataforma). Las guías del sistema
        // quedan (no nombran la plataforma).
        const agency = this.db && tenantId !== undefined ? await agencyOf(this.db, tenantId).catch(() => null) : null;
        if (agency) {
            return {
                support: readSupport((agency.settings as Record<string, unknown> | null)?.agency_support),
                videos: {},
                hidden: cfg.hidden,
                custom: [],
                support_name: agency.name,
            };
        }
        return {
            support: cfg.support,
            videos: cfg.videos,
            hidden: cfg.hidden,
            custom: cfg.custom.filter((g) => g.roles.length === 0 || (g.roles as string[]).includes(role)),
            support_name: null,
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

export function readSupport(raw: unknown): HelpSupport {
    const parsed = helpSupportSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : helpSupportSchema.parse({});
}
