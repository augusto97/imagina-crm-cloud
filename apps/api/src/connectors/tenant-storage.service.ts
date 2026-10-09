import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isStorageIntegration } from '@imagina-base/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { connections, tenants } from '../db/schema';
import type { PresignableStorage, StorageChoiceCandidate, TenantStorageResolver } from '../files/file-storage';
import { describeS3Error, S3FileStorage } from '../files/s3-file-storage';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ConnectorsService } from './connectors.service';
import { DriveStorageError, GoogleDriveStorage } from './storage-drive';
import { s3ConfigFromCreds } from './storage-s3';

/** Error legible cuando el almacenamiento de la empresa no se puede usar. */
export class TenantStorageUnusableError extends Error {}

/**
 * v0.1.268 (ADR-S36) — el almacenamiento propio de la empresa.
 *
 * La elección vive en `tenants.settings.storage = { connection_id }` (mismo
 * patrón que la cuenta de correo, ADR-S29). El driver se arma con las
 * credenciales de la conexión y se cachea por la HUELLA de esas credenciales:
 * si alguien rota la clave o cambia la región, la huella cambia y el próximo
 * pedido arma uno nuevo — sin avisos entre módulos.
 */
@Injectable()
export class TenantStorageService implements TenantStorageResolver {
    private readonly cache = new Map<string, { hash: string; storage: PresignableStorage }>();

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly tenantDb: TenantDb,
        private readonly connectors: ConnectorsService,
    ) {}

    async choice(tenantId: number): Promise<number | null> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const raw = ((row?.settings ?? {}) as Record<string, unknown>).storage as { connection_id?: unknown } | undefined;
        const id = Number(raw?.connection_id);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    async active(tenantId: number): Promise<{ connectionId: number; storage: PresignableStorage } | null> {
        const id = await this.choice(tenantId);
        if (id === null) return null;
        return { connectionId: id, storage: await this.forConnection(tenantId, id) };
    }

    async forConnection(tenantId: number, connectionId: number): Promise<PresignableStorage> {
        let found;
        try {
            found = await this.connectors.integrationCredsFor(tenantId, connectionId);
        } catch (err) {
            throw new TenantStorageUnusableError(err instanceof Error ? err.message : String(err));
        }
        if (!found) {
            throw new TenantStorageUnusableError(
                'La conexión donde se guardan los archivos ya no existe. Elige otro almacenamiento en Ajustes → Almacenamiento.',
            );
        }
        if (!isStorageIntegration(found.provider)) {
            throw new TenantStorageUnusableError(`«${found.name}» no es un almacenamiento de archivos.`);
        }
        if (found.provider === 'google_drive') return this.driveFor(tenantId, connectionId);
        const built = s3ConfigFromCreds(found.creds, { allowPrivate: this.env.STORAGE_ALLOW_PRIVATE_HOSTS });
        if (!built.ok) throw new TenantStorageUnusableError(`«${found.name}»: ${built.error}`);
        const hash = createHash('sha256').update(JSON.stringify(built.config)).digest('hex');
        const key = `${tenantId}:${connectionId}`;
        const hit = this.cache.get(key);
        if (hit && hit.hash === hash) return hit.storage;
        const storage = new S3FileStorage(built.config);
        this.cache.set(key, { hash, storage });
        return storage;
    }

    /**
     * v0.1.269 — Google Drive: el token se pide en cada llamada (el servicio
     * de conectores lo renueva) y la carpeta se recuerda en la conexión.
     */
    private async driveFor(tenantId: number, connectionId: number): Promise<PresignableStorage> {
        const key = `${tenantId}:${connectionId}:drive`;
        const hit = this.cache.get(key);
        if (hit) return hit.storage;
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ config: connections.config })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1),
        );
        const folder = (row?.config as Record<string, unknown> | undefined)?.storage_folder_id;
        const storage = new GoogleDriveStorage({
            apiBase: this.env.GOOGLE_DRIVE_API_URL,
            token: async () => {
                try {
                    return await this.connectors.oauthAccessToken(tenantId, connectionId);
                } catch (err) {
                    throw new DriveStorageError(err instanceof Error ? err.message : String(err));
                }
            },
            folderId: typeof folder === 'string' && folder !== '' ? folder : null,
            saveFolder: (id) => this.connectors.rememberConfig(tenantId, connectionId, { storage_folder_id: id }),
        });
        this.cache.set(key, { hash: 'drive', storage });
        return storage;
    }

    /** Las conexiones que pueden guardar archivos, con el motivo si alguna no sirve. */
    async candidates(tenantId: number): Promise<StorageChoiceCandidate[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: connections.id,
                    name: connections.name,
                    provider: connections.provider,
                    visibility: connections.visibility,
                    config: connections.config,
                })
                .from(connections)
                .where(eq(connections.tenantId, tenantId))
                .orderBy(asc(connections.name)),
        );
        const out: StorageChoiceCandidate[] = [];
        for (const r of rows) {
            if (!isStorageIntegration(r.provider)) continue;
            let problem: string | null = null;
            try {
                const found = await this.connectors.integrationCredsFor(tenantId, r.id);
                if (r.provider === 'google_drive') {
                    if (found && found.creds.accessToken === '') {
                        problem = `«${r.name}» no está autorizada: conéctala de nuevo en Ajustes → Integraciones.`;
                    }
                } else {
                    const built = found ? s3ConfigFromCreds(found.creds, { allowPrivate: this.env.STORAGE_ALLOW_PRIVATE_HOSTS }) : null;
                    if (built && !built.ok) problem = built.error;
                }
            } catch (err) {
                problem = err instanceof Error ? err.message : String(err);
            }
            if (problem === null && r.visibility !== 'workspace') {
                problem = `«${r.name}» es una conexión privada. Para los archivos de la empresa usa una conexión del equipo.`;
            }
            const label = (r.config as Record<string, unknown>).account_label;
            out.push({
                id: r.id,
                name: r.name,
                integration: r.provider,
                detail: typeof label === 'string' ? label : null,
                problem,
            });
        }
        return out;
    }

    async set(tenantId: number, connectionId: number): Promise<{ name: string }> {
        const cand = (await this.candidates(tenantId)).find((c) => c.id === connectionId);
        if (!cand) {
            throw new BadRequestException({
                code: 'storage_not_found',
                message: 'Esa conexión no existe o no es un almacenamiento de archivos.',
                data: { status: 400 },
            });
        }
        if (cand.problem) {
            throw new BadRequestException({ code: 'storage_not_ready', message: cand.problem, data: { status: 400 } });
        }
        // Antes de mandar ahí los archivos de toda la empresa: subir, leer y
        // borrar uno de prueba (el Drive puede estar lleno, la API apagada…).
        try {
            const storage = (await this.forConnection(tenantId, connectionId)) as PresignableStorage & { selfTest?: () => Promise<void> };
            await storage.selfTest?.();
        } catch (err) {
            const message =
                err instanceof DriveStorageError || err instanceof TenantStorageUnusableError
                    ? err.message
                    : describeS3Error(err);
            throw new BadRequestException({
                code: 'storage_not_ready',
                message: `No se pudo guardar un archivo de prueba en «${cand.name}»: ${message}`,
                data: { status: 400 },
            });
        }
        await this.write(tenantId, (s) => {
            s.storage = { connection_id: connectionId };
        });
        return { name: cand.name };
    }

    async clear(tenantId: number): Promise<void> {
        await this.write(tenantId, (s) => {
            delete s.storage;
        });
    }

    /** Nombres de un lote de conexiones (para la tarjeta de estado). */
    async names(tenantId: number, ids: number[]): Promise<Map<number, string>> {
        if (ids.length === 0) return new Map();
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: connections.id, name: connections.name })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), inArray(connections.id, ids))),
        );
        return new Map(rows.map((r) => [r.id, r.name]));
    }

    private async write(tenantId: number, mutate: (settings: Record<string, unknown>) => void): Promise<void> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const settings = { ...((row?.settings ?? {}) as Record<string, unknown>) };
        mutate(settings);
        await this.db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    }
}
