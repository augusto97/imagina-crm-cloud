import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { resolveSettingsSection, settingsSectionGroups } from '@/cloud/settingsSections';
import { seedFieldsForList } from '@/hooks/useFields';
import { listsKeys, seedListDetail } from '@/hooks/useLists';
import { shouldRetryQuery } from '@/lib/query-client';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

/**
 * v0.1.286 — piezas puras del shell de navegación (auditoría): las secciones
 * de Ajustes por rol, el reintento de queries y la siembra id↔slug del cache.
 */
describe('Ajustes por rol', () => {
    it('«Plan y uso» es sólo de admins; un no-admin cae en Seguridad', () => {
        const admin = settingsSectionGroups({ isAdmin: true });
        expect(admin.flatMap((g) => g.items).some((i) => i.id === 'plan')).toBe(true);
        expect(resolveSettingsSection(admin, null)).toBe('plan');

        const agent = settingsSectionGroups({ isAdmin: false });
        const ids = agent.flatMap((g) => g.items).map((i) => i.id);
        expect(ids).not.toContain('plan');
        expect(ids).toContain('seguridad');
        // Sin el grupo de empresa vacío.
        expect(agent.every((g) => g.items.length > 0)).toBe(true);
        expect(resolveSettingsSection(agent, null)).toBe('seguridad');
        // Pedir una sección que no ve (link viejo) no deja la página en blanco.
        expect(resolveSettingsSection(agent, 'plan')).toBe('seguridad');
        expect(resolveSettingsSection(agent, 'avisos')).toBe('avisos');
    });

    it('un manager que arma automatizaciones ve Integraciones, no Plan', () => {
        const manager = settingsSectionGroups({ isAdmin: false, canManageAutomations: true });
        const ids = manager.flatMap((g) => g.items).map((i) => i.id);
        expect(ids).toContain('conectores');
        expect(ids).not.toContain('plan');
        expect(resolveSettingsSection(manager, null)).toBe('seguridad');
    });
});

describe('reintento de queries', () => {
    it('un 4xx no se reintenta; la red, un 5xx, un 408 o un 429 sí (una vez)', () => {
        expect(shouldRetryQuery(0, { status: 403 })).toBe(false);
        expect(shouldRetryQuery(0, { status: 404 })).toBe(false);
        expect(shouldRetryQuery(0, { status: 400 })).toBe(false);
        expect(shouldRetryQuery(0, { status: 500 })).toBe(true);
        expect(shouldRetryQuery(0, { status: 429 })).toBe(true);
        expect(shouldRetryQuery(0, { status: 408 })).toBe(true);
        expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
        expect(shouldRetryQuery(1, { status: 500 })).toBe(false);
    });
});

describe('cache de lista y campos por id Y por slug', () => {
    const list = { id: 42, slug: 'clientes', name: 'Clientes' } as ListSummary;
    const fields = [{ id: 7, list_id: 42, slug: 'nombre', type: 'text' }] as FieldEntity[];

    it('una lista traída por slug queda también bajo su id (y viceversa)', () => {
        const qc = new QueryClient();
        seedListDetail(qc, list);
        expect(qc.getQueryData(listsKeys.detail('clientes'))).toBe(list);
        expect(qc.getQueryData(listsKeys.detail(42))).toBe(list);
    });

    it('los campos traídos por slug quedan bajo el id (del índice o de `list_id`)', () => {
        const qc = new QueryClient();
        seedFieldsForList(qc, 'clientes', fields);
        expect(qc.getQueryData(['fields', '42'])).toBe(fields);

        const withIndex = new QueryClient();
        withIndex.setQueryData(listsKeys.list(), [list]);
        seedFieldsForList(withIndex, 42, []);
        expect(withIndex.getQueryData(['fields', 'clientes'])).toEqual([]);
        // No toca otras listas.
        expect(withIndex.getQueryData(['fields', 'facturas'])).toBeUndefined();
    });
});
