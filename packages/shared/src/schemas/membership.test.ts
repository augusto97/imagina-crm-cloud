import { describe, expect, it } from 'vitest';
import {
    CAPABILITIES,
    CAPABILITIES_BY_ROLE,
    capabilitiesMap,
    ROLES,
    roleHasCapability,
} from './membership';

describe('matriz rol → capabilities (CapabilityRegistry del plugin)', () => {
    it('admin tiene todas las capabilities', () => {
        expect(CAPABILITIES_BY_ROLE.admin).toEqual([...CAPABILITIES]);
    });

    it('manager gestiona records y vistas pero no schema ni automatizaciones', () => {
        expect(roleHasCapability('manager', 'manage_views')).toBe(true);
        expect(roleHasCapability('manager', 'edit_records')).toBe(true);
        expect(roleHasCapability('manager', 'manage_lists')).toBe(false);
        expect(roleHasCapability('manager', 'manage_fields')).toBe(false);
        expect(roleHasCapability('manager', 'manage_automations')).toBe(false);
    });

    it('agent solo opera sobre sus propios records', () => {
        expect(roleHasCapability('agent', 'view_own_records')).toBe(true);
        expect(roleHasCapability('agent', 'edit_own_records')).toBe(true);
        expect(roleHasCapability('agent', 'view_records')).toBe(false);
        expect(roleHasCapability('agent', 'edit_records')).toBe(false);
        expect(roleHasCapability('agent', 'delete_records')).toBe(false);
    });

    it('viewer es solo lectura', () => {
        expect(roleHasCapability('viewer', 'view_records')).toBe(true);
        expect(roleHasCapability('viewer', 'create_records')).toBe(false);
        expect(roleHasCapability('viewer', 'edit_records')).toBe(false);
    });

    it('client solo accede al portal', () => {
        expect(CAPABILITIES_BY_ROLE.client).toEqual(['access_portal']);
        expect(roleHasCapability('client', 'access_admin')).toBe(false);
    });

    it('capabilitiesMap cubre todas las caps para todos los roles', () => {
        for (const role of ROLES) {
            const map = capabilitiesMap(role);
            expect(Object.keys(map)).toHaveLength(CAPABILITIES.length);
        }
    });
});
