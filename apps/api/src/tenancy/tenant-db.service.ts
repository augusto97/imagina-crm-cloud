import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { withTenant, withUser, withUserAndTenant } from '../db/tenant-tx';

/**
 * Punto de entrada único a la DB para código de dominio. Obliga a elegir un
 * scope explícito (tenant / user) — no expone el `Db` crudo.
 */
@Injectable()
export class TenantDb {
    constructor(@Inject(DRIZZLE) private readonly db: Db) {}

    withTenant<T>(tenantId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
        return withTenant(this.db, tenantId, fn);
    }

    withUser<T>(userId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
        return withUser(this.db, userId, fn);
    }

    withUserAndTenant<T>(userId: number, tenantId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
        return withUserAndTenant(this.db, userId, tenantId, fn);
    }
}
