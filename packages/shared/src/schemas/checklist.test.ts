import { describe, expect, it } from 'vitest';
import { automationConfigIssues } from './automation';
import {
    checklistDueHasTime,
    checklistPercent,
    checklistProgressOf,
    checklistTriggerMatches,
    isChecklistComplete,
    parseChecklistLines,
    updateChecklistItemSchema,
} from './checklist';

describe('A9 — checklist (puro)', () => {
    const items = (...done: boolean[]) => done.map((d) => ({ done: d }));

    it('progreso, porcentaje y completo', () => {
        expect(checklistProgressOf(items(true, false, true))).toEqual({ done: 2, total: 3 });
        expect(checklistPercent({ done: 1, total: 3 })).toBe(33);
        // Sin ítems no hay porcentaje (como la columna derivada: vacía, no 0 %).
        expect(checklistPercent({ done: 0, total: 0 })).toBeNull();
        // Un checklist vacío NO está completo (si no, crear uno vacío dispararía).
        expect(isChecklistComplete([])).toBe(false);
        expect(isChecklistComplete(items(true, true))).toBe(true);
        expect(isChecklistComplete(items(true, false))).toBe(false);
    });

    it('pegar varias líneas: viñetas, números y [x] marcado', () => {
        expect(parseChecklistLines('- [x] Firmar contrato\n2. Enviar factura\n\n* Llamar  \n  ')).toEqual([
            { text: 'Firmar contrato', done: true },
            { text: 'Enviar factura', done: false },
            { text: 'Llamar', done: false },
        ]);
    });

    it('fecha de vencimiento con o sin hora', () => {
        expect(checklistDueHasTime('2026-11-03')).toBe(false);
        expect(checklistDueHasTime('2026-11-03T14:00:00.000Z')).toBe(true);
        expect(checklistDueHasTime(null)).toBe(false);
        expect(updateChecklistItemSchema.safeParse({ due: 'mañana' }).success).toBe(false);
        expect(updateChecklistItemSchema.safeParse({ due: null, done: true }).success).toBe(true);
    });

    it('disparador «se completa un checklist»: cualquiera, uno por nombre (sin acentos) o todos', () => {
        const info = { id: 1, name: 'Revisión legal', all_done: false, total: 3 };
        expect(checklistTriggerMatches({}, info)).toBe(true);
        expect(checklistTriggerMatches({ checklist_mode: 'any' }, info)).toBe(true);
        expect(checklistTriggerMatches({ checklist_mode: 'named', checklist_name: ' revision LEGAL ' }, info)).toBe(true);
        expect(checklistTriggerMatches({ checklist_mode: 'named', checklist_name: 'Onboarding' }, info)).toBe(false);
        expect(checklistTriggerMatches({ checklist_mode: 'all' }, info)).toBe(false);
        expect(checklistTriggerMatches({ checklist_mode: 'all' }, { ...info, all_done: true })).toBe(true);
    });
});

describe('A9 / C6 · validación de la automatización', () => {
    it('«uno con un nombre» sin nombre y «Crear subtareas» sin plantilla se avisan al guardar', () => {
        const issues = automationConfigIssues({
            trigger_type: 'checklist_completed',
            trigger_config: { checklist_mode: 'named', checklist_name: '  ' },
            actions: [{ type: 'create_subtasks_from_template', config: {} }],
        });
        expect(issues.map((i) => i.path)).toEqual(['trigger_config.checklist_name', 'actions.0.config.template_id']);
    });

    it('con nombre y plantilla no hay nada que avisar', () => {
        expect(
            automationConfigIssues({
                trigger_type: 'checklist_completed',
                trigger_config: { checklist_mode: 'named', checklist_name: 'Documentación' },
                actions: [{ type: 'create_subtasks_from_template', config: { template_id: 3, include_checklists: true } }],
            }),
        ).toEqual([]);
    });
});
