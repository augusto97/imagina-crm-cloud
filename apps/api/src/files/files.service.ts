import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { attachments } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { FILE_STORAGE, type FileStorage } from './file-storage';

export interface AttachmentDto {
    id: number;
    /** URL de descarga servida por el API (auth + tenant check). */
    url: string;
    thumb_url?: string;
    title: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
}

const MAX_BATCH = 100;

/**
 * Archivos propios (ADR-S16). Metadata en `attachments` (RLS); bytes detrás
 * de `FileStorage`. El valor de un campo `file` es el ID del attachment.
 */
@Injectable()
export class FilesService {
    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    ) {}

    /** Sube un archivo: bytes al storage + metadata en el mismo flujo. */
    async upload(
        tenantId: number,
        userId: number,
        filename: string,
        mime: string,
        source: Readable,
    ): Promise<AttachmentDto> {
        const clean = sanitizeFilename(filename);
        if (clean === '') {
            throw new BadRequestException({
                code: 'invalid_filename',
                message: 'Nombre de archivo inválido',
                data: { status: 400 },
            });
        }
        // Clave opaca por tenant — el nombre humano vive solo en la metadata.
        const ext = extOf(clean);
        const key = `t${tenantId}/${randomBytes(16).toString('hex')}${ext}`;
        const size = await this.storage.write(key, source);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [inserted] = await tx
                .insert(attachments)
                .values({
                    tenantId,
                    filename: clean,
                    mime: mime || 'application/octet-stream',
                    sizeBytes: size,
                    storageKey: key,
                    createdBy: userId,
                })
                .returning();
            return inserted!;
        });
        return toDto(row);
    }

    /** Resuelve un batch de IDs (para tarjetas/galerías — 1 request). */
    async resolve(tenantId: number, ids: number[]): Promise<AttachmentDto[]> {
        const unique = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0))).slice(
            0,
            MAX_BATCH,
        );
        if (unique.length === 0) return [];
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, unique)))
                .orderBy(desc(attachments.id)),
        );
        return rows.map(toDto);
    }

    /** Stream de descarga. 404 si no existe EN ESTE tenant (RLS + explícito). */
    async openDownload(
        tenantId: number,
        id: number,
    ): Promise<{ stream: Readable; filename: string; mime: string; size: number }> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, id)))
                .limit(1),
        );
        if (!row) throw fileNotFound(id);
        return {
            stream: this.storage.read(row.storageKey),
            filename: row.filename,
            mime: row.mime,
            size: row.sizeBytes,
        };
    }

    async remove(tenantId: number, id: number): Promise<void> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [found] = await tx
                .select()
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, id)))
                .limit(1);
            if (!found) return null;
            await tx.delete(attachments).where(eq(attachments.id, found.id));
            return found;
        });
        if (!row) throw fileNotFound(id);
        // Bytes después del commit de la metadata (best-effort).
        await this.storage.delete(row.storageKey).catch(() => undefined);
    }
}

function toDto(row: typeof attachments.$inferSelect): AttachmentDto {
    return {
        id: row.id,
        url: `/api/v1/files/${row.id}/download`,
        title: row.filename,
        mime_type: row.mime,
        size_bytes: row.sizeBytes,
        created_at: row.createdAt.toISOString(),
    };
}

/** Solo el basename, sin caracteres de control ni separadores de path. */
function sanitizeFilename(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? '';
    // eslint-disable-next-line no-control-regex
    return base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
}

function extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return '';
    const ext = name.slice(dot).toLowerCase();
    return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

function fileNotFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'file_not_found',
        message: `Archivo ${id} no encontrado`,
        data: { status: 404 },
    });
}
