import { BadRequestException, Injectable } from '@nestjs/common';
import {
    brandingSchema,
    type Branding,
    type BrandingResponse,
    type UpdateBrandingInput,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { attachments, tenants } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * Branding white-label por workspace (color primario + logo + nombre).
 * Vive en `tenants.settings.branding` (jsonb — sin migración); el logo es un
 * attachment del PROPIO tenant (módulo de archivos, ADR-S16) y se sirve por
 * la ruta de descarga con sesión — el branding sólo se ve logueado, así que
 * no hace falta URL firmada acá.
 */
@Injectable()
export class BrandingService {
    constructor(private readonly tenantDb: TenantDb) {}

    async get(tenantId: number): Promise<BrandingResponse> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
        );
        const branding = parseBranding(row?.settings);
        return withLogoUrl(branding);
    }

    async update(tenantId: number, patch: UpdateBrandingInput): Promise<BrandingResponse> {
        // El logo debe ser un attachment vivo del propio tenant (si no, 400 —
        // nunca aceptamos IDs de otros workspaces).
        if (patch.logo_file_id !== undefined && patch.logo_file_id !== null) {
            const [file] = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ id: attachments.id })
                    .from(attachments)
                    .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, patch.logo_file_id!)))
                    .limit(1),
            );
            if (!file) {
                throw new BadRequestException({
                    code: 'logo_not_found',
                    message: 'El archivo del logo no existe en este workspace',
                    data: { status: 400 },
                });
            }
        }

        const next = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ settings: tenants.settings })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .limit(1);
            const settings = { ...(row?.settings ?? {}) };
            const merged: Branding = { ...parseBranding(settings), ...patch };
            settings.branding = merged;
            await tx
                .update(tenants)
                .set({ settings, updatedAt: new Date() })
                .where(eq(tenants.id, tenantId));
            return merged;
        });
        return withLogoUrl(next);
    }
}

function parseBranding(settings: Record<string, unknown> | undefined | null): Branding {
    const parsed = brandingSchema.safeParse((settings as Record<string, unknown> | undefined)?.branding ?? {});
    return parsed.success ? parsed.data : brandingSchema.parse({});
}

function withLogoUrl(branding: Branding): BrandingResponse {
    return {
        ...branding,
        logo_url: branding.logo_file_id !== null ? `/api/v1/files/${branding.logo_file_id}/download` : null,
    };
}
