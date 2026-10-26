import { describe, expect, it } from 'vitest';

import { dashboardFilterNode } from '@/admin/dashboards/widgets/useSegmentNav';
import { cellToText } from '@/admin/records/grid/cellText';
import { bucketLabel } from '@/admin/records/views/kanban/kanbanModel';
import { settingsSectionGroups } from '@/cloud/settingsSections';
import type { FieldEntity } from '@/types/field';

/** C1 — piezas puras del campo «Equipo» y de la sección Equipos. */
const teamField = { id: 9, slug: 'equipo', label: 'Equipo', type: 'team', config: { multiple: true } } as unknown as FieldEntity;
const names = new Map([
    [3, 'Ventas'],
    [7, 'Soporte'],
]);

describe('Equipos — piezas puras', () => {
    it('el filtro del tablero «mis equipos» lo resuelve el servidor; un equipo puntual va por id', () => {
        expect(dashboardFilterNode(teamField, 'me', 1)).toEqual({ type: 'condition', field_id: 9, op: 'in', value: ['$my_teams'] });
        expect(dashboardFilterNode(teamField, 3, 1)).toEqual({ type: 'condition', field_id: 9, op: 'in', value: [3] });
        expect(dashboardFilterNode(teamField, '', 1)).toBeNull();
    });

    it('copiar una celda de equipo deja los NOMBRES (pegarlos los vuelve a resolver)', () => {
        const ctx = { userName: () => null, relationTitle: () => null, fileName: () => null, teamName: (id: number) => names.get(id) ?? null };
        expect(cellToText(teamField, [3, 7], ctx)).toBe('Ventas, Soporte');
        expect(cellToText(teamField, [], ctx)).toBe('');
    });

    it('la columna del kanban por equipo usa el nombre; un conjunto vacío es «Sin valor»', () => {
        expect(bucketLabel(teamField, '[3, 7]', undefined, names)).toBe('Ventas + Soporte');
        expect(bucketLabel(teamField, '[]', undefined, names)).toBe('Sin valor');
        expect(bucketLabel(teamField, null, undefined, names)).toBe('Sin valor');
    });

    it('«Equipos» en Ajustes: el admin o quien tiene el permiso; nadie más', () => {
        const ids = (opts: Parameters<typeof settingsSectionGroups>[0]): string[] =>
            settingsSectionGroups(opts).flatMap((g) => g.items.map((i) => i.id));
        expect(ids({ isAdmin: true })).toContain('equipos');
        expect(ids({ isAdmin: false, canManageTeams: true })).toContain('equipos');
        expect(ids({ isAdmin: false })).not.toContain('equipos');
    });
});
