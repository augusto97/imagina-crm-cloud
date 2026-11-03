import { useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    effectiveMobileNav,
    parseMobileNavItem,
    type MobileNavConfig,
    type MobileNavSection,
    type MobileNavSource,
    type MobileNavState,
} from '@imagina-base/shared';

import type { MobileNavContext, MobileNavEntity } from '@/admin/layout/mobileNav';
import { useSession } from '@/cloud/session';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';
import { useDashboards } from '@/hooks/useDashboards';
import { useLists } from '@/hooks/useLists';
import { useIsSuperadmin } from '@/hooks/usePlatform';
import { api } from '@/lib/api';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { dashboardIcon } from '@/lib/dashboardIcon';
import { useIsGuest } from '@/lib/guest';
import { DEFAULT_LIST_ICON, listIcon } from '@/lib/listIcons';
import { CAP, useCan } from '@/lib/permissions';

/**
 * v0.1.347 — La barra de abajo del celular, personalizable: la de la persona
 * y la predeterminada del equipo (`GET /me/mobile-nav`).
 *
 * La key lleva la empresa: cada empresa tiene su barra, y al cambiar de
 * empresa se borra el caché que no empieza con `me` (ver workspaceSwitch).
 */
export function mobileNavKey(tenantId: number | null): readonly unknown[] {
    return ['mobile-nav', tenantId] as const;
}

export function useMobileNavState() {
    const tenantId = useSession((s) => s.activeTenantId);
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: mobileNavKey(tenantId),
        queryFn: async (): Promise<MobileNavState> => {
            const res = await api.get<MobileNavState>('/me/mobile-nav');
            return { own: res.data?.own ?? null, team: res.data?.team ?? null };
        },
        enabled: !isGuest && tenantId !== null,
        staleTime: 5 * 60_000,
    });
}

/** La barra que vale ahora y de dónde viene (la propia, la del equipo o la de siempre). */
export function useMobileNav(): { config: MobileNavConfig; source: MobileNavSource; state: MobileNavState | undefined; loading: boolean } {
    const q = useMobileNavState();
    const { config, source } = effectiveMobileNav(q.data);
    return { config, source, state: q.data, loading: q.isLoading };
}

/**
 * Guardar la propia: el cambio se ve AL INSTANTE (en la barra de abajo y en
 * la vista previa) y se manda al servidor un momento después, así varios
 * toques seguidos son UN pedido. `null` vuelve a la del equipo / la de siempre.
 * Sólo se aplica la respuesta del ÚLTIMO pedido: una respuesta vieja que
 * llega tarde no deshace lo que la persona tocó después.
 */
export function useSaveMobileNav(): { save: (config: MobileNavConfig | null) => void; flush: () => Promise<void> } {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const timer = useRef<number | null>(null);
    const pending = useRef<{ config: MobileNavConfig | null } | null>(null);
    const seq = useRef(0);

    const send = useCallback(async (): Promise<void> => {
        const next = pending.current;
        pending.current = null;
        if (!next) return;
        const mine = ++seq.current;
        try {
            const res =
                next.config === null
                    ? await api.delete<MobileNavState>('/me/mobile-nav')
                    : await api.put<MobileNavState>('/me/mobile-nav', next.config);
            if (mine === seq.current && res.data) qc.setQueryData(mobileNavKey(tenantId), res.data);
        } catch {
            if (mine === seq.current) void qc.invalidateQueries({ queryKey: mobileNavKey(tenantId) });
        }
    }, [qc, tenantId]);

    const save = useCallback(
        (config: MobileNavConfig | null) => {
            qc.setQueryData<MobileNavState>(mobileNavKey(tenantId), (prev) => ({ own: config, team: prev?.team ?? null }));
            pending.current = { config };
            if (timer.current !== null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
                timer.current = null;
                void send();
            }, 450);
        },
        [qc, tenantId, send],
    );

    const flush = useCallback(async () => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
        await send();
    }, [send]);

    return { save, flush };
}

/** La predeterminada del equipo (sólo el admin): `null` la quita. */
export async function saveTeamMobileNav(config: MobileNavConfig | null): Promise<MobileNavState> {
    const res =
        config === null ? await api.delete<MobileNavState>('/me/mobile-nav/team') : await api.put<MobileNavState>('/me/mobile-nav/team', config);
    return res.data;
}

/**
 * Qué puede usar esta persona en la barra, con los mismos permisos que «Más»
 * y el resto de la app. Las listas y los tableros sólo se piden si hacen
 * falta (los usa la barra, o el editor para ofrecerlos).
 */
export function useMobileNavContext(opts: { lists?: boolean; dashboards?: boolean } = {}): MobileNavContext {
    const canManageDashboards = useCan(CAP.MANAGE_DASHBOARDS);
    const canViewDashboards = useCan(CAP.VIEW_DASHBOARDS);
    const canAccessAdmin = useCan(CAP.ACCESS_ADMIN);
    const canManageAgents = useCan(CAP.MANAGE_AI_AGENTS);
    const canViewRecords = useCan(CAP.VIEW_RECORDS);
    const canViewOwnRecords = useCan(CAP.VIEW_OWN_RECORDS);
    const canUseAssistant = useCan(CAP.USE_AI_ASSISTANT);
    const aiOff = usePlanModuleOff('ai');
    const isSuperadmin = useIsSuperadmin();
    const inboxOn = moduleEnabled('mentions');
    const dashboardsOn = (canManageDashboards || (canAccessAdmin && canViewDashboards)) && moduleEnabled('dashboards');

    const wantLists = opts.lists ?? false;
    const wantDashboards = (opts.dashboards ?? false) && dashboardsOn;
    const lists = useLists(wantLists);
    const dashboards = useDashboards(wantDashboards);

    const listMap = useMemo(() => {
        if (!wantLists || !lists.data) return undefined;
        const m = new Map<number, MobileNavEntity>();
        for (const l of lists.data) {
            m.set(l.id, { name: l.name, to: `/lists/${l.slug}/records`, prefix: `/lists/${l.slug}`, icon: listIcon(l.icon) ?? DEFAULT_LIST_ICON });
        }
        return m;
    }, [wantLists, lists.data]);

    const dashboardMap = useMemo(() => {
        if (!wantDashboards || !dashboards.data) return undefined;
        const m = new Map<number, MobileNavEntity>();
        for (const d of dashboards.data) {
            m.set(d.id, { name: d.name, to: `/dashboards/${d.id}`, prefix: `/dashboards/${d.id}`, icon: dashboardIcon(d.settings) });
        }
        return m;
    }, [wantDashboards, dashboards.data]);

    const available = useCallback(
        (section: MobileNavSection): boolean => {
            switch (section) {
                case 'inbox':
                    return inboxOn;
                case 'dashboards':
                    return dashboardsOn;
                case 'agents':
                    return canManageAgents;
                case 'platform':
                    return isSuperadmin;
                case 'scan':
                    return canViewRecords || canViewOwnRecords;
                case 'assistant':
                    return canUseAssistant && !aiOff;
                default:
                    return true;
            }
        },
        [inboxOn, dashboardsOn, canManageAgents, isSuperadmin, canViewRecords, canViewOwnRecords, canUseAssistant, aiOff],
    );

    return useMemo(() => ({ available, lists: listMap, dashboards: dashboardMap }), [available, listMap, dashboardMap]);
}

/** ¿La barra tiene alguna lista o algún tablero puntual? (para pedirlos sólo entonces). */
export function needsEntities(config: MobileNavConfig): { lists: boolean; dashboards: boolean } {
    let lists = false;
    let dashboards = false;
    for (const raw of config.items) {
        const ref = parseMobileNavItem(raw);
        if (ref?.kind === 'list') lists = true;
        if (ref?.kind === 'dashboard') dashboards = true;
    }
    return { lists, dashboards };
}
