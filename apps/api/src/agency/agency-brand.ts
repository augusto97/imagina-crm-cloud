import { brandingSchema, type InheritedBranding } from '@imagina-base/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/client';
import { tenants } from '../db/schema';
import type { FilesService } from '../files/files.service';

/**
 * v0.1.450 (I3, ADR-S108) — La marca de la APP que ve el equipo de una empresa
 * cliente: la de su agencia (decisión del usuario: «sólo la de la agencia»).
 * Es la marca que la agencia eligió para sí en Ajustes → Marca (nombre de app,
 * color, riel, barras y logo). Lo que ven los clientes DEL cliente (portal,
 * formularios, agenda, tienda) sigue con la marca propia de la empresa.
 *
 * Se lee con la conexión BASE (cruza empresas). El logo es un archivo de la
 * AGENCIA: se firma con su id.
 */
export function agencyBrandFromRow(
    agency: { id: number; name: string; settings: unknown },
    files: Pick<FilesService, 'signedUrl'>,
    ttlSeconds = 86_400,
): InheritedBranding {
    const parsed = brandingSchema.safeParse((agency.settings as Record<string, unknown> | null)?.branding ?? {});
    const b = parsed.success ? parsed.data : brandingSchema.parse({});
    return {
        source: 'agency',
        name: agency.name,
        app_name: b.app_name,
        primary_color: b.primary_color,
        sidebar_color: b.sidebar_color,
        app_bar_color: b.app_bar_color,
        logo_url: b.logo_file_id !== null ? files.signedUrl(agency.id, b.logo_file_id, ttlSeconds) : null,
    };
}

export interface AgencyRow {
    id: number;
    name: string;
    settings: unknown;
}

/** La agencia (viva) de una empresa cliente; null si no es cliente de ninguna. */
export async function agencyOf(db: Db | Tx, clientTenantId: number): Promise<AgencyRow | null> {
    const agency = alias(tenants, 'agency');
    const [row] = await db
        .select({ id: agency.id, name: agency.name, settings: agency.settings })
        .from(tenants)
        .innerJoin(agency, eq(agency.id, tenants.agencyId))
        .where(and(eq(tenants.id, clientTenantId), isNull(agency.archivedAt)))
        .limit(1);
    return row ? { id: row.id, name: row.name, settings: row.settings } : null;
}

export async function agencyAppBrand(
    db: Db | Tx,
    files: Pick<FilesService, 'signedUrl'>,
    clientTenantId: number,
    ttlSeconds = 86_400,
): Promise<InheritedBranding | null> {
    const agency = await agencyOf(db, clientTenantId);
    return agency ? agencyBrandFromRow(agency, files, ttlSeconds) : null;
}

/**
 * v0.1.450 — La llave del manifiesto de la app instalable con la marca de la
 * agencia (`/public/manifest.webmanifest?b=`). Sin sesión: la pide el
 * navegador. Sólo dice «la empresa N»; el manifiesto revisa que siga siendo
 * cliente de una agencia y sólo devuelve nombre y color (nada privado).
 */
export function manifestBrandToken(files: Pick<FilesService, 'signParts'>, tenantId: number): string {
    return `${tenantId}.${files.signParts('appbrand', tenantId).slice(0, 32)}`;
}

export function readManifestBrandToken(files: Pick<FilesService, 'signParts'>, raw: unknown): number | null {
    if (typeof raw !== 'string' || raw.length > 64) return null;
    const m = /^([1-9][0-9]{0,15})\.([0-9a-f]{32})$/.exec(raw);
    if (!m) return null;
    const id = Number(m[1]);
    if (!Number.isSafeInteger(id)) return null;
    const expected = files.signParts('appbrand', id).slice(0, 32);
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= expected.charCodeAt(i) ^ m[2]!.charCodeAt(i);
    return diff === 0 ? id : null;
}
