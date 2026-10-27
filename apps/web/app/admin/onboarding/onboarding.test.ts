import { describe, expect, it } from 'vitest';
import { ONBOARDING_BUSINESS_TYPES, ONBOARDING_ICON_KEYS, type ListTemplateSummary, type OnboardingStatus } from '@imagina-base/shared';

import { optimisticPrefs } from '@/hooks/useOnboarding';
import { listIcon } from '@/lib/listIcons';

import { STEP_META, stepAction, stepProgress } from './gettingStartedSteps';
import { combinedListNames } from './welcomeHelpers';

function status(partial: Partial<OnboardingStatus> = {}): OnboardingStatus {
    return {
        audience: 'admin',
        steps: [
            { id: 'create_list', done: true, skipped: false },
            { id: 'add_records', done: false, skipped: false },
            { id: 'invite_team', done: false, skipped: false },
            { id: 'install_app', done: false, skipped: false },
        ],
        prefs: { hidden: false, skipped: [], marks: [], celebrated: false, welcome_dismissed: false },
        complete: false,
        has_lists: true,
        first_list: { id: 7, slug: 'clientes', name: 'Clientes' },
        welcome: false,
        samples: [],
        seeded_automations: 0,
        assistant_possible: false,
        admin_name: null,
        ...partial,
    };
}

describe('Primeros pasos', () => {
    it('lleva cada paso al lugar exacto', () => {
        const s = status();
        expect(stepAction('add_records', s, { canPromptInstall: false })).toEqual({ kind: 'navigate', to: '/lists/clientes/records?import=1' });
        expect(stepAction('invite_team', s, { canPromptInstall: false })).toEqual({ kind: 'navigate', to: '/settings?s=miembros' });
        expect(stepAction('automation', s, { canPromptInstall: false })).toEqual({ kind: 'navigate', to: '/lists/clientes/automations' });
        expect(stepAction('assistant', s, { canPromptInstall: false })).toEqual({ kind: 'open-assistant' });
        expect(stepAction('install_app', s, { canPromptInstall: true })).toEqual({ kind: 'install' });
        expect(stepAction('install_app', s, { canPromptInstall: false })).toEqual({ kind: 'navigate', to: '/settings?s=seguridad' });
        // Ya hay listas: «Crea una lista» abre el diálogo; sin listas, va a la bienvenida
        // (y si la descartó con «Empezar en blanco», directo al diálogo).
        expect(stepAction('create_list', s, { canPromptInstall: false })).toEqual({ kind: 'create-list' });
        expect(stepAction('create_list', status({ has_lists: false, first_list: null, welcome: true }), { canPromptInstall: false })).toEqual({ kind: 'navigate', to: '/lists' });
        expect(stepAction('create_list', status({ has_lists: false, first_list: null, welcome: false }), { canPromptInstall: false })).toEqual({ kind: 'create-list' });
        // Sin una lista a la que llevar, los pasos de registros van al índice.
        expect(stepAction('comment_record', status({ first_list: null }), { canPromptInstall: false })).toEqual({ kind: 'navigate', to: '/lists' });
    });

    it('cuenta los hechos sobre los que no se saltaron', () => {
        const s = status();
        expect(stepProgress(s.steps)).toEqual({ done: 1, total: 4, ratio: 0.25 });
        const skipped = s.steps.map((x) => (x.id === 'install_app' ? { ...x, skipped: true } : x));
        expect(stepProgress(skipped)).toEqual({ done: 1, total: 3, ratio: 1 / 3 });
        expect(stepProgress([]).ratio).toBe(1);
    });

    it('cada paso tiene título y por qué, sin voseo', () => {
        for (const meta of Object.values(STEP_META)) {
            expect(meta.title.length).toBeGreaterThan(5);
            expect(meta.why.length).toBeGreaterThan(10);
            expect(`${meta.title} ${meta.why}`).not.toMatch(/\b(podés|tenés|elegí|acá|vos|hacé|creá)\b/i);
        }
    });

    it('el PATCH optimista mezcla sin perder lo demás', () => {
        const s = status();
        const skipped = optimisticPrefs(s, { skip: 'install_app' });
        expect(skipped.prefs.skipped).toEqual(['install_app']);
        expect(skipped.steps.find((x) => x.id === 'install_app')?.skipped).toBe(true);
        expect(skipped.complete).toBe(false);

        // Un paso marcado a mano cuenta como hecho, y uno hecho no puede estar saltado.
        const marked = optimisticPrefs(skipped, { mark: 'install_app' });
        expect(marked.steps.find((x) => x.id === 'install_app')).toMatchObject({ done: true, skipped: false });
        expect(marked.prefs.skipped).toEqual(['install_app']);

        const back = optimisticPrefs(skipped, { unskip: 'install_app' });
        expect(back.prefs.skipped).toEqual([]);

        const all = optimisticPrefs(s, { skip: 'add_records' });
        const allDone = optimisticPrefs(optimisticPrefs(all, { skip: 'invite_team' }), { skip: 'install_app' });
        expect(allDone.complete).toBe(true);

        const welcome = status({ welcome: true });
        expect(optimisticPrefs(welcome, { welcome_dismissed: true }).welcome).toBe(false);
        expect(optimisticPrefs(s, { hidden: true }).prefs).toMatchObject({ hidden: true, celebrated: false });
    });
});

describe('Elegir por tipo de negocio', () => {
    const tpl = (name: string, lists: string[]): ListTemplateSummary => ({
        id: `sys:${name.toLowerCase()}`,
        source: 'system',
        name,
        description: null,
        icon: null,
        color: null,
        category: 'otros',
        lists: lists.map((l) => ({ name: l, fields: [], views: [], automations: [], records_count: 0, booking_pages: [] })),
        dashboards: [],
        created_at: null,
    });

    it('distingue los nombres repetidos con el de su plantilla (como el servidor)', () => {
        expect(combinedListNames([tpl('CRM', ['Clientes']), tpl('Facturación', ['Clientes', 'Facturas'])])).toEqual([
            'Clientes',
            'Clientes · Facturación',
            'Facturas',
        ]);
        expect(combinedListNames([])).toEqual([]);
    });

    it('los iconos que se le ofrecen a la IA y los de cada tipo de negocio existen en el catálogo', () => {
        for (const key of ONBOARDING_ICON_KEYS) expect(listIcon(key), key).toBeDefined();
        for (const t of ONBOARDING_BUSINESS_TYPES) expect(listIcon(t.icon), t.id).toBeDefined();
    });
});
