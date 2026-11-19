import { describe, expect, it } from 'vitest';
import { buildAirtableDraftPlan, type AirtableTableScan, type AirtableTableSchema } from '@imagina-base/shared';

import { formatBytes, patchField, patchTable, reviewInfos, setAttachments } from './airtablePlanEdit';

const tables: AirtableTableSchema[] = [
    {
        id: 'tblClientes',
        name: 'Clientes',
        primaryFieldId: 'fldNombre',
        fields: [
            { id: 'fldNombre', name: 'Nombre', type: 'singleLineText' },
            { id: 'fldProyectos', name: 'Proyectos', type: 'multipleRecordLinks', options: { linkedTableId: 'tblProyectos', inverseLinkFieldId: 'fldCliente' } },
        ],
    },
    {
        id: 'tblProyectos',
        name: 'Proyectos',
        primaryFieldId: 'fldPNombre',
        fields: [
            { id: 'fldPNombre', name: 'Nombre', type: 'singleLineText' },
            { id: 'fldCliente', name: 'Cliente', type: 'multipleRecordLinks', options: { linkedTableId: 'tblClientes', inverseLinkFieldId: 'fldProyectos', prefersSingleRecordLink: true } },
            { id: 'fldArchivos', name: 'Archivos', type: 'multipleAttachments' },
        ],
    },
];

const scan: AirtableTableScan[] = [
    { table_id: 'tblClientes', records: 3, truncated: false, attachments: {}, people: {}, autonumber_max: {} },
    { table_id: 'tblProyectos', records: 5, truncated: false, attachments: { fldArchivos: { files: 2, bytes: 2048, too_big: 0 } }, people: {}, autonumber_max: {} },
];

describe('airtablePlanEdit', () => {
    it('cambia una tabla o un campo sin tocar el resto', () => {
        const plan = buildAirtableDraftPlan(tables, scan, { attachments: true });
        const renamed = patchTable(plan, 'tblClientes', { name: 'Cuentas' });
        expect(renamed.tables.find((t) => t.table_id === 'tblClientes')?.name).toBe('Cuentas');
        expect(renamed.tables.find((t) => t.table_id === 'tblProyectos')).toEqual(plan.tables.find((t) => t.table_id === 'tblProyectos'));

        const off = patchField(plan, 'tblProyectos', 'fldArchivos', { include: false });
        expect(off.tables[1]?.fields.find((f) => f.field_id === 'fldArchivos')?.include).toBe(false);
        expect(plan.tables[1]?.fields.find((f) => f.field_id === 'fldArchivos')?.include).toBe(true);
    });

    it('apagar los adjuntos los deja fuera y encenderlos los vuelve archivos', () => {
        const plan = buildAirtableDraftPlan(tables, scan, { attachments: true });
        const off = setAttachments(plan, tables, false);
        expect(off.attachments).toBe(false);
        expect(off.tables[1]?.fields.find((f) => f.field_id === 'fldArchivos')?.include).toBe(false);
        const on = setAttachments(off, tables, true);
        const f = on.tables[1]?.fields.find((x) => x.field_id === 'fldArchivos');
        expect(f?.include).toBe(true);
        expect(f?.type).toBe('file');
    });

    it('el vínculo queda de un solo lado y se apaga si la otra tabla no viene', () => {
        const plan = buildAirtableDraftPlan(tables, scan, { attachments: true });
        const infos = reviewInfos(plan, tables, scan);
        expect(infos.get('tblProyectos')?.get('fldCliente')?.type).toBe('relation');
        expect(infos.get('tblClientes')?.get('fldProyectos')?.locked).toBe(true);

        const withoutClients = patchTable(plan, 'tblClientes', { include: false });
        expect(reviewInfos(withoutClients, tables, scan).get('tblProyectos')?.get('fldCliente')?.locked).toBe(true);
    });

    it('muestra los tamaños en KB o MB', () => {
        expect(formatBytes(2048)).toBe('2 KB');
        expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
    });
});
