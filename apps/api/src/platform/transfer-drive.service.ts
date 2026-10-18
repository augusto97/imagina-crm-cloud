import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { TransferDriveRun, TransferDriveStatus } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { BackupDriveService } from '../update/backup-drive.service';
import { TenantTransferService } from './tenant-transfer.service';

/** Estado de la operación en curso (de ESTE servidor). */
const RUN_KEY = 'transfers:drive:run';
const STUCK_MS = 2 * 3600 * 1000;

/**
 * v0.1.284 (ADR-S43) — Mover UNA empresa entre servidores por Google Drive.
 * Orquesta lo que ya existe: el archivo de ADR-S23 (exportar/importar) y la
 * conexión del Drive de las copias del servidor (ADR-S43). Subir y traer
 * corren en segundo plano (un archivo puede pesar GB); el panel pregunta el
 * estado. Una operación a la vez.
 */
@Injectable()
export class TransferDriveService {
    private readonly logger = new Logger(TransferDriveService.name);

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        private readonly transfers: TenantTransferService,
        private readonly drive: BackupDriveService,
    ) {}

    async run(): Promise<TransferDriveRun | null> {
        const raw = await this.redis.get(RUN_KEY);
        if (!raw) return null;
        try {
            const r = JSON.parse(raw) as TransferDriveRun;
            if (r.status === 'running' && Date.now() - new Date(r.at).getTime() > STUCK_MS) {
                return { ...r, status: 'failed', message: 'La operación quedó colgada. Vuelve a intentarlo.' };
            }
            return r;
        } catch {
            return null;
        }
    }

    private async write(r: Omit<TransferDriveRun, 'at'>): Promise<void> {
        await this.redis.set(RUN_KEY, JSON.stringify({ ...r, at: new Date().toISOString() }));
    }

    private async assertIdle(): Promise<void> {
        if ((await this.run())?.status === 'running') {
            throw new ConflictException({ code: 'transfer_busy', message: 'Ya hay una subida o descarga de empresa en curso.', data: { status: 409 } });
        }
    }

    private async assertReady(): Promise<void> {
        const reason = await this.drive.transferReadiness();
        if (reason) throw new BadRequestException({ code: 'drive_not_ready', message: reason, data: { status: 400 } });
    }

    async status(): Promise<TransferDriveStatus> {
        const reason = await this.drive.transferReadiness().catch((err: unknown) => (err as Error).message);
        let files: TransferDriveStatus['files'] = [];
        let listError: string | null = null;
        if (!reason) files = await this.drive.listTransfers().catch((err: unknown) => ((listError = (err as Error).message), []));
        return { ready: !reason && !listError, reason: reason ?? listError, files, run: await this.run() };
    }

    /** Sube al Drive el archivo de una empresa que ya está en este servidor. */
    async startUpload(name: string): Promise<{ ok: true }> {
        const file = this.transfers.resolve(name);
        await this.assertReady();
        await this.assertIdle();
        const manifest = await this.transfers.readManifest(file);
        if (!manifest) {
            throw new BadRequestException({ code: 'bad_archive', message: 'Ese archivo no es una empresa exportada.', data: { status: 400 } });
        }
        await this.write({ op: 'upload', status: 'running', message: 'Subiendo a Google Drive…', file: name });
        void (async () => {
            try {
                await this.drive.uploadTransfer(
                    file,
                    {
                        tenant_slug: manifest.tenant.slug,
                        tenant_name: manifest.tenant.name,
                        exported_at: manifest.exported_at,
                        app_version: manifest.app_version,
                        records: manifest.counts.records ?? null,
                    },
                    (message) => this.write({ op: 'upload', status: 'running', message, file: name }),
                );
                await this.write({ op: 'upload', status: 'success', message: `«${manifest.tenant.name}» quedó en Google Drive, cifrada.`, file: name });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(`Subir la empresa al Drive falló: ${message}`);
                await this.write({ op: 'upload', status: 'failed', message: `No se pudo subir: ${message}`, file: name });
            }
        })();
        return { ok: true };
    }

    /**
     * Trae una empresa del Drive a este servidor (queda como un archivo más de
     * "Migrar empresas", listo para importar). La contraseña se verifica ANTES
     * de empezar, así el error sale en la misma respuesta.
     */
    async startFetch(id: string, passphrase: string): Promise<{ ok: true }> {
        await this.assertReady();
        await this.assertIdle();
        const dir = this.transfers.dir;
        if (!dir) throw new BadRequestException({ code: 'unavailable', message: 'Sin directorio de transferencias', data: { status: 400 } });
        const remote = await this.drive.verifyTransfer(id, passphrase);
        const label = remote.appProperties.imagina_tenant_name || remote.name;
        await this.write({ op: 'fetch', status: 'running', message: 'Bajando de Google Drive…', file: null });
        void (async () => {
            try {
                let last = -1;
                const file = await this.drive.fetchTransfer(id, passphrase, dir, (pct) => {
                    if (pct !== last && pct % 5 === 0) {
                        last = pct;
                        void this.write({ op: 'fetch', status: 'running', message: `Bajando de Google Drive… ${pct}%`, file: null });
                    }
                });
                await this.write({ op: 'fetch', status: 'success', message: `«${label}» está en este servidor: impórtala desde la lista.`, file });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(`Traer la empresa del Drive falló: ${message}`);
                await this.write({ op: 'fetch', status: 'failed', message: `No se pudo traer: ${message}`, file: null });
            }
        })();
        return { ok: true };
    }

    async remove(id: string): Promise<void> {
        await this.assertReady();
        await this.drive.deleteTransfer(id);
    }
}
