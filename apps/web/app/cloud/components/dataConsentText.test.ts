import { describe, expect, it } from 'vitest';
import type { RecordDataConsentDto } from '@imagina-base/shared';

import { resolveSettingsSection, settingsSectionGroups } from '@/cloud/settingsSections';
import { setTenantFormat } from '@/lib/tenantFormat';

import { consentOrigin, consentSentence, recordDataConsentsKey } from './dataConsentText';

/** Ley 1581 — la línea de la ficha y la sección de Ajustes. */
const base: RecordDataConsentDto = {
    id: 7,
    version: 3,
    source: 'form',
    source_label: 'Formulario «Contacto»',
    subject_name: 'Ana',
    subject_email: 'ana@cliente.test',
    accepted_at: '2026-10-08T15:30:00.000Z',
    withdrawn_at: null,
    withdrawn_via: null,
};

describe('autorización de datos en la ficha', () => {
    it('dice desde dónde, con qué versión y cuándo', () => {
        setTenantFormat({ date_format: 'dmy', time_format: 'h24', timezone: 'UTC' });
        expect(consentOrigin('Formulario «Contacto»')).toBe('desde el formulario «Contacto»');
        expect(consentOrigin('Portal del cliente')).toBe('desde el portal del cliente');
        const s = consentSentence(base);
        expect(s).toContain('aceptada el 08/10/2026');
        expect(s).toContain('versión 3');
        expect(s).toContain('desde el formulario «Contacto»');
        setTenantFormat(null);
    });

    it('una retirada lo dice primero, con el canal', () => {
        setTenantFormat({ date_format: 'dmy', time_format: 'h24', timezone: 'UTC' });
        const s = consentSentence({ ...base, withdrawn_at: '2026-10-12T10:00:00.000Z', withdrawn_via: 'link' });
        expect(s.startsWith('retirada el 12/10/2026')).toBe(true);
        expect(s).toContain('desde el enlace del correo');
        expect(s).toContain('(aceptada el 08/10/2026');
        setTenantFormat(null);
    });

    it('la clave del cache usa el ID numérico de la lista', () => {
        expect(recordDataConsentsKey(12, 99)).toEqual(['record-data-consents', 12, 99]);
    });
});

describe('Ajustes → Datos personales', () => {
    it('sólo la ve un admin', () => {
        const admin = settingsSectionGroups({ isAdmin: true });
        expect(admin.flatMap((g) => g.items).some((i) => i.id === 'privacidad')).toBe(true);
        expect(resolveSettingsSection(admin, 'privacidad')).toBe('privacidad');
        const agent = settingsSectionGroups({ isAdmin: false, canManageAutomations: true });
        expect(agent.flatMap((g) => g.items).some((i) => i.id === 'privacidad')).toBe(false);
        expect(resolveSettingsSection(agent, 'privacidad')).toBe('seguridad');
    });
});
