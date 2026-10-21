import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { listsKeys } from '@/hooks/useLists';
import { AGGREGATES_NS, invalidateForList, patchRecordInCache, recordsKeys } from '@/hooks/useRecords';
import type { RecordEntity } from '@/types/record';

const rec = (id: number, fields: Record<string, unknown>): RecordEntity =>
    ({ id, fields, relations: {} }) as unknown as RecordEntity;

describe('cache de registros (v0.1.286)', () => {
    it('invalidar los registros de una lista refresca también su pie (aggregates), y sólo el de esa lista', () => {
        const qc = new QueryClient();
        qc.setQueryData(listsKeys.list(), [{ id: 42, slug: 'clientes' }, { id: 77, slug: 'facturas' }]);
        qc.setQueryData([AGGREGATES_NS, '42', '1,2', null, 0, null], { totals: {} });
        qc.setQueryData([AGGREGATES_NS, '77', '1', null, 0, null], { totals: {} });

        invalidateForList(qc, recordsKeys.all, 'clientes');

        expect(qc.getQueryState([AGGREGATES_NS, '42', '1,2', null, 0, null])!.isInvalidated).toBe(true);
        expect(qc.getQueryState([AGGREGATES_NS, '77', '1', null, 0, null])!.isInvalidated).toBe(false);
    });

    it('patchRecordInCache cubre el listado plano y el bundle de la vista agrupada', () => {
        const patch = (r: RecordEntity) => ({ ...r, fields: { ...r.fields, estado: 'hecho' } });
        const flat = { data: [rec(1, { estado: 'pendiente' }), rec(2, {})], meta: {} };
        const nextFlat = patchRecordInCache(flat, 1, patch) as typeof flat;
        expect(nextFlat.data[0]!.fields.estado).toBe('hecho');
        expect(nextFlat.data[1]).toBe(flat.data[1]);

        const bundle = {
            buckets: [],
            meta: {},
            expanded: {
                pendiente: { records: { data: [rec(1, { estado: 'pendiente' })], meta: {} } },
                hecho: { records: { data: [rec(3, {})], meta: {} } },
            },
        };
        const nextBundle = patchRecordInCache(bundle, 1, patch) as typeof bundle;
        expect(nextBundle.expanded.pendiente.records.data[0]!.fields.estado).toBe('hecho');
        expect(nextBundle.expanded.hecho).toBe(bundle.expanded.hecho);

        // Sin el registro: no se toca (undefined = no hay snapshot que guardar).
        expect(patchRecordInCache(flat, 99, patch)).toBeUndefined();
        expect(patchRecordInCache(bundle, 99, patch)).toBeUndefined();
        expect(patchRecordInCache(undefined, 1, patch)).toBeUndefined();
    });
});
