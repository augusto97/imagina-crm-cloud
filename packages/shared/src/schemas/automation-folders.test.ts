import { describe, expect, it } from 'vitest';

import { automationFolderOpSchema, moveAutomationsSchema } from './automation';
import { cleanFolderName, folderKey, matchFolder, mergeAutomationFolders, readSavedFolders } from './automation-folders';

describe('carpetas de automatizaciones', () => {
    it('mismo nombre sin importar mayúsculas, tildes o espacios', () => {
        expect(folderKey('  Facturación   mensual ')).toBe('facturacion mensual');
        expect(matchFolder(['Facturación'], 'facturacion')).toBe('Facturación');
        expect(matchFolder(['Ventas'], 'Soporte')).toBeNull();
        expect(cleanFolderName('  Avisos   al  cliente ')).toBe('Avisos al cliente');
    });

    it('lo guardado manda el orden; lo que usan las automatizaciones va después, por nombre', () => {
        expect(mergeAutomationFolders(['Ventas', 'Cobros'], ['Soporte', 'cobros', null, 'Alertas', 'Soporte'])).toEqual([
            'Ventas',
            'Cobros',
            'Alertas',
            'Soporte',
        ]);
        expect(mergeAutomationFolders([], [])).toEqual([]);
    });

    it('lectura tolerante de lo guardado', () => {
        expect(readSavedFolders(['A', 3, '  ', 'a', null, 'B'])).toEqual(['A', 'B']);
        expect(readSavedFolders('nada')).toEqual([]);
    });

    it('validación de las operaciones', () => {
        expect(automationFolderOpSchema.safeParse({ op: 'rename', name: 'A', to: 'B' }).success).toBe(true);
        expect(automationFolderOpSchema.safeParse({ op: 'create', name: '' }).success).toBe(false);
        expect(automationFolderOpSchema.safeParse({ op: 'create', name: 'x'.repeat(61) }).success).toBe(false);
        expect(moveAutomationsSchema.safeParse({ ids: [1, 2], folder: null }).success).toBe(true);
        expect(moveAutomationsSchema.safeParse({ ids: [], folder: 'A' }).success).toBe(false);
    });
});
