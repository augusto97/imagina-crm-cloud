import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { invalidateWorkspaceData, isWorkspaceDataKey } from './workspaceInvalidate';

describe('invalidateWorkspaceData — tras aplicar una propuesta del asistente', () => {
    it('refresca los datos del espacio y deja en paz la sesión, las personas, los archivos y la consola', async () => {
        const qc = new QueryClient();
        const touched = [['lists', 'list'], ['fields', '12'], ['records', '12', 'list', {}], ['views', '12'],
            ['dashboards', 'one', '3'], ['automations', '12'], ['forms', 12], ['permissions', 12], ['algo-nuevo-sin-anotar']];
        const untouched = [['me'], ['wp-user', 4], ['member-names', '1,2'], ['imcrm', 'attachment', 9],
            ['ai-status', 1], ['platform', 'brand'], ['tenant-smtp'], ['whats-new'], ['account-sessions']];
        for (const k of [...touched, ...untouched]) qc.setQueryData(k, {});
        await invalidateWorkspaceData(qc);
        for (const k of touched) expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
        for (const k of untouched) expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(false);
    });

    it('una clave que no empieza con texto se refresca (lo seguro)', () => {
        expect(isWorkspaceDataKey([12, 'x'])).toBe(true);
    });
});
