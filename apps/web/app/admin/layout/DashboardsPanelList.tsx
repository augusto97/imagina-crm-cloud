import { useRef, useState } from 'react';

import { useReorderDashboards } from '@/hooks/useDashboards';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { DashboardEntity } from '@/types/dashboard';

import { DashboardPanelItem } from './DashboardPanelItem';

/**
 * v0.1.286 — Tableros del panel lateral, REORDENABLES arrastrando (el mismo
 * gesto que las listas, v0.1.107). El orden es compartido del workspace y se
 * guarda al soltar (`PATCH /dashboards/reorder`, optimista).
 */
export function DashboardsPanelList({
    dashboards,
    starredIds,
    onToggleStar,
}: {
    dashboards: DashboardEntity[];
    starredIds: number[];
    onToggleStar: (id: number) => void;
}): JSX.Element {
    const canManage = useCan(CAP.MANAGE_DASHBOARDS);
    const reorder = useReorderDashboards();
    const dragIndex = useRef<number | null>(null);
    const [over, setOver] = useState<number | null>(null);

    const drop = (target: number): void => {
        const from = dragIndex.current;
        dragIndex.current = null;
        setOver(null);
        if (from === null || from === target) return;
        const next = [...dashboards];
        const [moved] = next.splice(from, 1);
        if (!moved) return;
        next.splice(target, 0, moved);
        reorder.mutate(next.map((d) => d.id));
    };

    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="imcrm-dashboards-panel-list">
            {dashboards.map((d, i) => (
                <li
                    key={d.id}
                    draggable={canManage}
                    onDragStart={() => {
                        dragIndex.current = i;
                    }}
                    onDragOver={(e) => {
                        if (!canManage || dragIndex.current === null) return;
                        e.preventDefault();
                        setOver(i);
                    }}
                    onDragLeave={() => setOver((cur) => (cur === i ? null : cur))}
                    onDrop={(e) => {
                        e.preventDefault();
                        drop(i);
                    }}
                    onDragEnd={() => {
                        dragIndex.current = null;
                        setOver(null);
                    }}
                    className={cn(over === i && dragIndex.current !== i && 'imcrm-rounded imcrm-ring-1 imcrm-ring-primary/40')}
                >
                    {/* v0.1.145 — su icono; v0.1.172 — con menú contextual. */}
                    <DashboardPanelItem
                        dashboard={d}
                        starred={starredIds.includes(d.id)}
                        onToggleStar={() => onToggleStar(d.id)}
                    />
                </li>
            ))}
        </ul>
    );
}
