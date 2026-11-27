import { describe, expect, it } from 'vitest';

import { readDuplicateSettings } from './duplicates';
import {
    LIST_FEATURES_BASE,
    countListFeatures,
    listFeatureOn,
    listFeaturesInputSchema,
    listFeaturesWith,
    mergeListFeatures,
    readListFeatures,
    suggestListFeatures,
} from './list-features';

describe('readListFeatures', () => {
    it('una lista sin nada guardado (importada de antes) se lee como siempre, sin el aviso de duplicados', () => {
        expect(readListFeatures(null)).toEqual({
            description: true,
            ai_summary: true,
            subtasks: true,
            checklists: true,
            dependencies: true,
            time_tracking: true,
            duplicates: false,
        });
    });

    it('sin la clave, los duplicados quedan encendidos sólo con reglas elegidas a mano', () => {
        expect(readListFeatures({ duplicates: { rules: [] } }).duplicates).toBe(true);
        expect(readListFeatures({ duplicates: { rules: [], enabled: false } }).duplicates).toBe(false);
        expect(readListFeatures({ duplicates: { notify_on_create: true } }).duplicates).toBe(false);
    });

    it('lo guardado gana, clave por clave, y lo raro toma su valor de siempre', () => {
        const f = readListFeatures({ features: { subtasks: false, duplicates: true, checklists: 'si', extra: true } });
        expect(f.subtasks).toBe(false);
        expect(f.duplicates).toBe(true);
        expect(f.checklists).toBe(true);
        expect(Object.keys(f)).not.toContain('extra');
    });

    it('listFeatureOn y el conteo', () => {
        expect(listFeatureOn({ features: { time_tracking: false } }, 'time_tracking')).toBe(false);
        expect(countListFeatures(LIST_FEATURES_BASE)).toBe(2);
        expect(countListFeatures(listFeaturesWith('subtasks', 'checklists'))).toBe(4);
    });
});

describe('mergeListFeatures', () => {
    it('cambia sólo lo que llega y devuelve el objeto entero', () => {
        const next = mergeListFeatures({ features: { ...LIST_FEATURES_BASE } }, { checklists: true });
        expect(next).toEqual({ ...LIST_FEATURES_BASE, checklists: true });
    });

    it('el esquema de entrada no acepta claves desconocidas ni valores que no son sí/no', () => {
        expect(listFeaturesInputSchema.safeParse({ subtasks: true }).success).toBe(true);
        expect(listFeaturesInputSchema.safeParse({ otra: true }).success).toBe(false);
        expect(listFeaturesInputSchema.safeParse({ subtasks: 'si' }).success).toBe(false);
    });
});

describe('suggestListFeatures', () => {
    it('por el tipo de lista', () => {
        expect(suggestListFeatures({ name: 'Tareas del proyecto', fields: [{ slug: 'responsable', type: 'user', label: 'Responsable' }] })).toEqual(
            listFeaturesWith('subtasks', 'checklists', 'dependencies', 'time_tracking'),
        );
        expect(suggestListFeatures({ name: 'Clientes', fields: [{ slug: 'email', type: 'email', label: 'Correo' }] }).duplicates).toBe(true);
        expect(suggestListFeatures({ name: 'Gastos', fields: [{ slug: 'monto', type: 'currency', label: 'Monto' }] })).toEqual(LIST_FEATURES_BASE);
    });
});

describe('duplicados siguen a la función de la lista', () => {
    it('readDuplicateSettings().enabled sale de features.duplicates', () => {
        expect(readDuplicateSettings({ features: { duplicates: false }, duplicates: { rules: [] } }, []).enabled).toBe(false);
        expect(readDuplicateSettings({ features: { duplicates: true } }, []).enabled).toBe(true);
        expect(readDuplicateSettings({}, []).enabled).toBe(false);
    });
});
