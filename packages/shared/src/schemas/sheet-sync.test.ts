import { describe, expect, it } from 'vitest';
import {
    createSheetSyncSchema,
    describeSheetInterval,
    findSheetColumn,
    nextSheetSyncRun,
    parseSpreadsheetLink,
    quoteSheetTitle,
    readSheetSyncSettings,
    sheetColumnIndex,
    sheetColumnLetter,
    sheetSyncReadsSheet,
    sheetSyncWritesSheet,
    spreadsheetUrl,
} from './sheet-sync';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789';

describe('sincronización con Google Sheets — piezas compartidas (v0.1.459)', () => {
    it('reconoce el enlace de una planilla (con o sin pestaña) o el id pegado solo', () => {
        expect(parseSpreadsheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`)).toEqual({ spreadsheetId: ID, gid: 123 });
        expect(parseSpreadsheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toEqual({ spreadsheetId: ID, gid: null });
        expect(parseSpreadsheetLink(`  ${ID}  `)).toEqual({ spreadsheetId: ID, gid: null });
        expect(parseSpreadsheetLink('https://drive.google.com/file/d/abc/view')).toBeNull();
        expect(parseSpreadsheetLink('hola')).toBeNull();
        expect(spreadsheetUrl(ID, 7)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=7`);
    });

    it('letras de columna ida y vuelta; títulos de pestaña con comillas', () => {
        expect([0, 25, 26, 51, 701, 702].map(sheetColumnLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
        for (const i of [0, 3, 26, 99, 701, 702]) expect(sheetColumnIndex(sheetColumnLetter(i))).toBe(i);
        expect(sheetColumnIndex('a1')).toBe(-1);
        expect(quoteSheetTitle("Ventas de Ana's")).toBe("'Ventas de Ana''s'");
    });

    it('encuentra una columna por su nombre exacto o sin tildes, mayúsculas ni espacios', () => {
        const headers = ['Nombre', 'Correo electrónico', ' Teléfono ', 'ID'];
        expect(findSheetColumn(headers, 'Nombre')).toBe(0);
        expect(findSheetColumn(headers, 'correo electronico')).toBe(1);
        expect(findSheetColumn(headers, 'TELEFONO')).toBe(2);
        expect(findSheetColumn(headers, 'Ciudad')).toBe(-1);
        expect(findSheetColumn(headers, '  ')).toBe(-1);
    });

    it('lee con tolerancia lo guardado: una configuración rota no rompe la pantalla', () => {
        const ok = createSheetSyncSchema.parse({
            name: 'x',
            list_id: 1,
            spreadsheet_id: ID,
            sheet_gid: 0,
            columns: [{ column: 'Nombre', field_id: 3 }],
        });
        expect(ok).toMatchObject({ direction: 'both', key: { mode: 'app_id', column: 'ID' }, header_row: 1, on_sheet_delete: 'ignore', on_app_delete: 'ignore' });
        const raw = { ...ok, spreadsheet_title: 'Libro', sheet_title: 'Hoja 1' };
        expect(readSheetSyncSettings(raw)).toMatchObject({ spreadsheet_title: 'Libro', sheet_title: 'Hoja 1', direction: 'both' });
        const broken = readSheetSyncSettings({ spreadsheet_id: ID, direction: 'raro', header_row: 900, key: 'mal', columns: 'tampoco' });
        expect(broken).toMatchObject({ direction: 'sheet_to_app', header_row: 50, key: { mode: 'app_id', column: 'ID' }, columns: [], interval_minutes: 60 });
        expect(readSheetSyncSettings(null).spreadsheet_id).toBe('');
    });

    it('qué lado lee y qué lado escribe; intervalos', () => {
        expect([sheetSyncReadsSheet('sheet_to_app'), sheetSyncReadsSheet('app_to_sheet'), sheetSyncReadsSheet('both')]).toEqual([true, false, true]);
        expect([sheetSyncWritesSheet('sheet_to_app'), sheetSyncWritesSheet('app_to_sheet'), sheetSyncWritesSheet('both')]).toEqual([false, true, true]);
        expect([5, 60, 180, 1440].map(describeSheetInterval)).toEqual(['cada 5 minutos', 'cada hora', 'cada 3 horas', 'una vez por día']);
        const from = new Date('2026-11-19T10:00:00Z');
        expect(nextSheetSyncRun(15, from).toISOString()).toBe('2026-11-19T10:15:00.000Z');
        expect(nextSheetSyncRun(7, from).toISOString()).toBe('2026-11-19T11:00:00.000Z');
    });
});
