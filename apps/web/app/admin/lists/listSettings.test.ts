import { describe, expect, it } from 'vitest';

import { ACCESS_LEVELS, blankRolePermissions, levelOf } from './listAccessLevels';
import {
    LIST_SETTINGS_GROUPS,
    LIST_SETTINGS_SECTIONS,
    groupedListSettingsSections,
    listSettingsSection,
    resolveListSettingsSection,
} from './listSettingsSections';

describe('secciones de la configuración de lista', () => {
    it('un `?s=` desconocido (o ausente) cae en Campos', () => {
        expect(resolveListSettingsSection(null)).toBe('campos');
        expect(resolveListSettingsSection('')).toBe('campos');
        expect(resolveListSettingsSection('no-existe')).toBe('campos');
        // Un id inventado no debe colarse como sección: la página lo usa
        // para decidir qué panel montar.
        expect(LIST_SETTINGS_SECTIONS.some((s) => s.id === ('no-existe' as never))).toBe(false);
    });

    it('un `?s=` válido se respeta y resuelve a su sección', () => {
        for (const section of LIST_SETTINGS_SECTIONS) {
            expect(resolveListSettingsSection(section.id)).toBe(section.id);
            expect(listSettingsSection(section.id).title).toBe(section.title);
        }
    });
});

describe('menú agrupado de la configuración (v0.1.406)', () => {
    it('cada sección aparece una sola vez, en su grupo y en el orden de los grupos', () => {
        const groups = groupedListSettingsSections(() => true);
        expect(groups.map((g) => g.id)).toEqual(LIST_SETTINGS_GROUPS.map((g) => g.id));
        const ids = groups.flatMap((g) => g.sections.map((s) => s.id));
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort()).toEqual(LIST_SETTINGS_SECTIONS.map((s) => s.id).sort());
        for (const g of groups) for (const section of g.sections) expect(section.group).toBe(g.id);
        // Campos sigue siendo lo primero (es la sección por defecto).
        expect(ids[0]).toBe('campos');
    });

    it('lo que el rol o la lista no permiten no aparece, y un grupo vacío tampoco', () => {
        const groups = groupedListSettingsSections((id) => id !== 'formularios' && id !== 'agenda' && id !== 'correo' && id !== 'tienda');
        expect(groups.some((g) => g.id === 'intake')).toBe(false);
        expect(groups.flatMap((g) => g.sections.map((s) => s.id))).not.toContain('formularios');
    });

    it('cada sección tiene su línea corta para el índice del celular', () => {
        for (const section of LIST_SETTINGS_SECTIONS) expect(section.short.length).toBeGreaterThan(5);
    });
});

describe('niveles de acceso por rol', () => {
    it('cada nivel se reconoce a sí mismo al releerlo', () => {
        for (const level of ACCESS_LEVELS) {
            expect(levelOf({ ...level.perms, fields_hidden: [] })).toBe(level.id);
        }
    });

    it('ocultar campos no cambia el nivel (son ejes independientes)', () => {
        const collab = ACCESS_LEVELS.find((l) => l.id === 'collab')!;
        expect(levelOf({ ...collab.perms, fields_hidden: ['telefono', 'monto'] })).toBe('collab');
    });

    it('una combinación fuera del catálogo queda como personalizada', () => {
        // "assigned" no tiene nivel prearmado: la UI lo muestra como
        // configuración propia en vez de mentir con un chip marcado.
        expect(
            levelOf({ view: 'assigned', create: true, edit: 'assigned', delete: 'none', fields_hidden: [] }),
        ).toBeNull();
        // Ver todo pero poder borrar sin poder editar tampoco es un nivel.
        expect(
            levelOf({ view: 'all', create: false, edit: 'none', delete: 'all', fields_hidden: [] }),
        ).toBeNull();
        expect(levelOf(undefined)).toBeNull();
    });

    it('el rol sin permisos guardados arranca sin acceso', () => {
        expect(levelOf(blankRolePermissions())).toBe('none');
    });
});
