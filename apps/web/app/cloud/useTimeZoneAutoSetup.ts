import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isValidTimeZone } from '@imagina-base/shared';

import { brandingQueryKey, useBrandingData } from '@/hooks/useBranding';
import { browserTimeZone } from '@/lib/tenantFormat';
import { api, useSession } from '@/cloud/session';

const DONE_KEY = (tenantId: number) => `imcrm:tz-proposed:${tenantId}`;

/**
 * v0.1.263 — La zona horaria de la empresa se PROPONE sola: la primera vez
 * que un admin entra a una empresa que todavía no eligió zona, se guarda la
 * de su navegador. Sin esto, cada empresa existente seguiría corriendo sus
 * horarios en UTC hasta que alguien encontrara el ajuste (que es justo el
 * problema que motivó la versión). Se puede cambiar en Ajustes → Formato
 * regional.
 *
 * No se propone si: quien entra no es admin, está impersonando (el operador
 * puede estar en otro país), el navegador no sabe su zona o dice UTC (no
 * aporta nada), o ya se intentó en esta empresa desde este navegador.
 */
export function useTimeZoneAutoSetup(): void {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const role = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role ?? null);
    const impersonating = useSession((s) => s.impersonating !== undefined && s.impersonating !== null);
    const branding = useBrandingData();
    const format = branding.data?.format;

    useEffect(() => {
        if (tenantId === null || role !== 'admin' || impersonating || !format) return;
        if (format.timezone) return;
        const tz = browserTimeZone();
        if (!tz || tz === 'UTC' || tz === 'Etc/UTC' || !isValidTimeZone(tz)) return;
        try {
            if (localStorage.getItem(DONE_KEY(tenantId)) === '1') return;
            localStorage.setItem(DONE_KEY(tenantId), '1');
        } catch {
            // Sin storage igual se intenta: el PATCH es idempotente.
        }
        void api
            .updateTenantFormat({ timezone: tz })
            .then(() => qc.invalidateQueries({ queryKey: brandingQueryKey(tenantId) }))
            .catch(() => undefined);
    }, [tenantId, role, impersonating, format, qc]);
}
