import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/cloud/session';
import { useDashboards } from '@/hooks/useDashboards';
import { useListGroups } from '@/hooks/useListGroups';
import { useLists } from '@/hooks/useLists';
import { settingsSectionGroups, resolveSettingsSection } from '@/cloud/settingsSections';
import { isPlatformTab, PLATFORM_TABS } from '@/admin/platform/platformTabs';
import { setTitleSection } from '@/lib/documentTitle';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { pushRecent } from '@/lib/recents';
import { titleFieldOf } from '@/lib/recordTitle';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * v0.1.286 — lo que la RUTA dice de la pantalla, en un solo lugar (así no hay
 * que tocar cada página): el título de la pestaña ("Clientes — Acme") y los
 * «Recientes» de la paleta (listas, registros y tableros abiertos).
 *
 * Los nombres salen de caches que el shell ya tiene (listas, tableros,
 * carpetas) y el título de un registro del cache de su ficha si ya cargó —
 * no se pide nada extra por esto.
 */
export function RouteTracker(): null {
    const { pathname, search } = useLocation();
    const tenantId = useSession((s) => s.activeTenantId);
    const isAdmin = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'admin');
    const canManageAutomations = useCan(CAP.MANAGE_AUTOMATIONS);
    const lists = useLists();
    const dashboards = useDashboards();
    const groups = useListGroups();
    const params = useMemo(() => new URLSearchParams(search), [search]);

    const listMatch = /^\/lists\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(pathname);
    const listSlug = listMatch ? decodeURIComponent(listMatch[1]!) : null;
    const list = listSlug !== null ? lists.data?.find((l) => l.slug === listSlug || String(l.id) === listSlug) : undefined;
    const sub = listMatch?.[2] ?? null;
    const recordId = (() => {
        if (sub === 'records' && listMatch?.[3]) return Number(listMatch[3]);
        const q = params.get('record');
        return q !== null && /^\d+$/.test(q) ? Number(q) : null;
    })();
    const recordTitle = useCachedRecordTitle(list ? [String(list.id), list.slug] : [], recordId);

    const dashMatch = /^\/dashboards\/(\d+)/.exec(pathname);
    const dashboard = dashMatch ? dashboards.data?.find((d) => d.id === Number(dashMatch[1])) : undefined;

    // ── Título ─────────────────────────────────────────────────────────
    const title = ((): string | null => {
        if (pathname === '/lists' || pathname === '/') return __('Listas');
        if (listSlug !== null) {
            if (!list) return null;
            if (recordId !== null) return recordTitle ? `${recordTitle} · ${list.name}` : list.name;
            if (sub === 'edit') return sprintf(__('Ajustes de %s'), list.name);
            if (sub === 'automations') return sprintf(__('Automatizaciones · %s'), list.name);
            if (sub === 'template-editor') return sprintf(__('Diseño de la ficha · %s'), list.name);
            if (sub === 'portal-editor') return sprintf(__('Portal · %s'), list.name);
            return list.name;
        }
        const folder = /^\/folders\/(\d+)/.exec(pathname);
        if (folder) return groups.data?.find((g) => g.id === Number(folder[1]))?.name ?? __('Carpeta');
        if (pathname.startsWith('/my-work')) return __('Mi trabajo');
        if (pathname.startsWith('/favorites')) return __('Favoritos');
        if (pathname === '/dashboards') return __('Dashboards');
        if (dashMatch) return dashboard?.name ?? __('Dashboard');
        if (pathname.startsWith('/settings/stores/')) return `${__('Tienda')} · ${__('Ajustes')}`;
        if (pathname.startsWith('/settings/sql/')) return `${__('Sincronización SQL')} · ${__('Ajustes')}`;
        if (pathname.startsWith('/settings/collections/')) return `${__('Cobros')} · ${__('Ajustes')}`;
        if (pathname.startsWith('/settings')) {
            const groupsS = settingsSectionGroups({ isAdmin, canManageAutomations });
            const id = resolveSettingsSection(groupsS, params.get('s'));
            const label = groupsS.flatMap((g) => g.items).find((i) => i.id === id)?.label;
            return label ? `${label} · ${__('Ajustes')}` : __('Ajustes');
        }
        if (pathname.startsWith('/platform')) {
            const tab = params.get('tab');
            const label = isPlatformTab(tab) ? PLATFORM_TABS.find((t) => t.id === tab)?.label : null;
            return label ? `${__(label)} · ${__('Plataforma')}` : __('Plataforma');
        }
        return null;
    })();

    useEffect(() => {
        setTitleSection(title);
    }, [title]);
    useEffect(() => () => setTitleSection(null), []);

    // ── Recientes ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!list) return;
        if (recordId !== null) {
            pushRecent(tenantId, {
                kind: 'record',
                id: recordId,
                label: recordTitle ?? sprintf(__('Registro #%d'), recordId),
                fallback: recordTitle === null,
                context: list.name,
                href: `/lists/${list.slug}/records?record=${recordId}`,
                icon: list.icon ?? null,
                color: list.color ?? null,
            });
            return;
        }
        if (sub === 'records') {
            pushRecent(tenantId, {
                kind: 'list',
                id: list.id,
                label: list.name,
                href: `/lists/${list.slug}/records`,
                icon: list.icon ?? null,
                color: list.color ?? null,
            });
        }
    }, [tenantId, list, sub, recordId, recordTitle]);

    useEffect(() => {
        if (!dashboard) return;
        const s = (dashboard.settings ?? {}) as Record<string, unknown>;
        pushRecent(tenantId, {
            kind: 'dashboard',
            id: dashboard.id,
            label: dashboard.name,
            href: `/dashboards/${dashboard.id}`,
            icon: typeof s.icon === 'string' ? s.icon : null,
            color: typeof s.color === 'string' ? s.color : null,
        });
    }, [tenantId, dashboard]);

    return null;
}

/**
 * Título de un registro SI su ficha ya lo trajo al cache (`recordsKeys.item`,
 * por id o por slug de la lista). Escucha el cache: cuando la ficha termina de
 * cargar, el título de la pestaña se completa solo. No dispara requests.
 */
function useCachedRecordTitle(listKeys: string[], recordId: number | null): string | null {
    const qc = useQueryClient();
    const [title, setTitle] = useState<string | null>(null);
    const keysSig = listKeys.join('|');
    useEffect(() => {
        if (recordId === null || listKeys.length === 0) {
            setTitle(null);
            return;
        }
        const ids = new Set(listKeys);
        const compute = (): void => {
            let fields: FieldEntity[] | undefined;
            for (const k of ids) {
                fields ??= qc.getQueryData<FieldEntity[]>(['fields', k]);
            }
            const titleField = titleFieldOf(fields);
            let found: string | null = null;
            if (titleField) {
                for (const q of qc.getQueryCache().findAll({ queryKey: ['records'] })) {
                    const key = q.queryKey;
                    if (key[2] !== 'item' || key[3] !== recordId || !ids.has(String(key[1]))) continue;
                    const rec = q.state.data as RecordEntity | undefined;
                    const v = rec?.fields?.[titleField.slug];
                    if (typeof v === 'string' && v.trim() !== '') {
                        found = v.trim();
                        break;
                    }
                }
            }
            setTitle((prev) => (prev === found ? prev : found));
        };
        compute();
        return qc.getQueryCache().subscribe((event) => {
            if (event.type !== 'updated' && event.type !== 'added') return;
            const k = event.query.queryKey;
            if (k[0] === 'records' || k[0] === 'fields') compute();
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keysSig resume listKeys
    }, [qc, keysSig, recordId]);
    return title;
}
