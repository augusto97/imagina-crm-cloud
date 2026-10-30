import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { readBillingPolicy, type BillingPolicy, type UpdateBillingPolicyInput } from '@imagina-base/shared';
import { REDIS } from '../redis/redis.module';
import { currentBillingPolicy, setCurrentBillingPolicy } from './tenant-access';

/** Subconjunto de ioredis: se testea con un fake en memoria. */
export interface BillingPolicyStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
}

const KEY = 'platform:billing-policy';
/** Cada nodo relee la política cada tanto: un cambio en otro nodo llega solo. */
const REFRESH_MS = 60_000;

/**
 * v0.1.338 (ADR-S87) — La política de prueba y vencimientos de la plataforma:
 * cuánto dura la prueba, qué pasa al terminar, días de gracia y si la empresa
 * que no renueva pasa al plan de prueba. Vive en Redis (`platform:billing-policy`,
 * como el resto de los ajustes de plataforma: viaja en el snapshot de ADR-S20)
 * y se deja en memoria (`setCurrentBillingPolicy`) para que el guard y lo que
 * corre solo la usen sin pegarle a Redis.
 */
@Injectable()
export class BillingPolicyService implements OnModuleInit {
    private readonly logger = new Logger(BillingPolicyService.name);
    private loadedAt = 0;

    constructor(@Inject(REDIS) private readonly redis: BillingPolicyStore) {}

    async onModuleInit(): Promise<void> {
        await this.refresh().catch((err) => this.logger.warn(`Política de cobro no se pudo leer (se usa la de fábrica): ${String(err)}`));
        const timer = setInterval(() => void this.refresh().catch(() => undefined), REFRESH_MS);
        timer.unref?.();
    }

    /** La política vigente (relee de Redis si pasó el minuto). */
    async get(): Promise<BillingPolicy> {
        if (Date.now() - this.loadedAt > REFRESH_MS) await this.refresh().catch(() => undefined);
        return currentBillingPolicy();
    }

    async update(patch: UpdateBillingPolicyInput): Promise<BillingPolicy> {
        const next = readBillingPolicy({ ...(await this.read()), ...patch });
        await this.redis.set(KEY, JSON.stringify(next));
        setCurrentBillingPolicy(next);
        this.loadedAt = Date.now();
        return next;
    }

    async refresh(): Promise<BillingPolicy> {
        const policy = readBillingPolicy(await this.read());
        setCurrentBillingPolicy(policy);
        this.loadedAt = Date.now();
        return policy;
    }

    private async read(): Promise<Record<string, unknown>> {
        const raw = await this.redis.get(KEY);
        if (!raw) return {};
        try {
            const v = JSON.parse(raw) as unknown;
            return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
        } catch {
            return {};
        }
    }
}
