import { describe, expect, it } from 'vitest';

import {
    INTEGRATION_DEFAULT_BETA,
    INTEGRATION_DEFAULT_HIDDEN,
    INTEGRATION_RETIRING,
    applyIntegrationOverride,
    integrationPolicies,
    integrationPolicy,
    readIntegrationOverrides,
    updateIntegrationCatalogSchema,
} from './integration-stage';
import { INTEGRATION_KEYS } from './integration-keys';

describe('integration-stage (v0.1.438)', () => {
    it('lo de fábrica: beta, ocultas y en retiro son apps que existen', () => {
        for (const k of [...INTEGRATION_DEFAULT_BETA, ...INTEGRATION_DEFAULT_HIDDEN, ...Object.keys(INTEGRATION_RETIRING)]) {
            expect(INTEGRATION_KEYS).toContain(k);
        }
        for (const r of Object.values(INTEGRATION_RETIRING)) expect(INTEGRATION_KEYS).toContain(r!.replacement);
        // Lo que se usa con cuentas reales no queda en beta.
        for (const k of ['whatsapp_web', 'woocommerce', 'wordpress', 'mercadopago', 'gmail', 'outlook', 'teams'] as const) {
            if ((INTEGRATION_KEYS as readonly string[]).includes(k)) expect(integrationPolicy(k).stage).toBe('stable');
        }
        expect(integrationPolicy('sms_twilio')).toEqual({ stage: 'beta', hidden: false });
        expect(integrationPolicy('sms_onurix')).toEqual({ stage: 'beta', hidden: false });
        expect(integrationPolicy('sms_infobip')).toEqual({ stage: 'beta', hidden: true });
        expect(integrationPolicy('whatsapp')).toEqual({ stage: 'retiring', hidden: true });
    });

    it('sólo dos proveedores de SMS a la vista de fábrica', () => {
        const sms = INTEGRATION_KEYS.filter((k) => k.startsWith('sms_'));
        const shown = sms.filter((k) => !integrationPolicy(k).hidden);
        expect(shown.sort()).toEqual(['sms_onurix', 'sms_twilio']);
    });

    it('el operador guarda sólo las diferencias y «null» vuelve a lo de fábrica', () => {
        let o = applyIntegrationOverride({}, 'sms_infobip', { hidden: false });
        expect(o).toEqual({ sms_infobip: { hidden: false } });
        expect(integrationPolicy('sms_infobip', o).hidden).toBe(false);

        // Igual a lo de fábrica: no se guarda (así una versión futura lo puede cambiar).
        o = applyIntegrationOverride(o, 'slack', { beta: true });
        expect(o.slack).toBeUndefined();
        o = applyIntegrationOverride(o, 'slack', { beta: false });
        expect(o.slack).toEqual({ beta: false });
        expect(integrationPolicy('slack', o).stage).toBe('stable');

        o = applyIntegrationOverride(o, 'sms_infobip', { hidden: null });
        expect(o.sms_infobip).toBeUndefined();
        expect(integrationPolicy('sms_infobip', o).hidden).toBe(true);

        // Una app en retiro no se puede marcar beta/probada: sigue «en retiro».
        o = applyIntegrationOverride(o, 'whatsapp', { beta: false });
        expect(o.whatsapp).toBeUndefined();
        expect(integrationPolicy('whatsapp', o).stage).toBe('retiring');
    });

    it('lo guardado se lee con tolerancia', () => {
        expect(readIntegrationOverrides(null)).toEqual({});
        expect(readIntegrationOverrides('x')).toEqual({});
        expect(
            readIntegrationOverrides({
                overrides: { slack: { beta: false }, nada: { hidden: true }, telegram: { hidden: 'si' }, gmail: {} },
            }),
        ).toEqual({ slack: { beta: false } });
        const all = integrationPolicies();
        expect(Object.keys(all).sort()).toEqual([...INTEGRATION_KEYS].sort());
    });

    it('el cambio pide algo para cambiar', () => {
        expect(updateIntegrationCatalogSchema.safeParse({}).success).toBe(false);
        expect(updateIntegrationCatalogSchema.safeParse({ hidden: null }).success).toBe(true);
        expect(updateIntegrationCatalogSchema.safeParse({ beta: true }).success).toBe(true);
    });
});
