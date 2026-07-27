import { describe, expect, it } from 'vitest';

import { ACCESS_LEVELS, blankRolePermissions, levelOf } from './listAccessLevels';
import {
    LIST_SETTINGS_SECTIONS,
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
