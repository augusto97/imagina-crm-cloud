import { describe, expect, it } from 'vitest';
import { automationConfigIssues } from './automation';
import { ON_ERROR_EXEMPT_ACTIONS, onErrorIssues } from './automation-control';
import {
    automationCommentAuthor,
    conditionRuleText,
    describeStopUnless,
    readAddCommentConfig,
    readAutomationCommentMark,
    readStopUnlessRules,
} from './automation-steps';

describe('v0.1.466 — «Comprobar y detener si no se cumple»', () => {
    it('lee las reglas con field o slug e ignora las que no tienen campo', () => {
        expect(
            readStopUnlessRules({
                condition: [
                    { field: 'estado', op: 'eq', value: 'pendiente' },
                    { slug: 'monto', op: 'gt', value: 100 },
                    { field: '', op: 'eq', value: 'x' },
                    'basura',
                ],
            }),
        ).toEqual([
            { field: 'estado', op: 'eq', value: 'pendiente' },
            { field: 'monto', op: 'gt', value: 100 },
        ]);
        expect(readStopUnlessRules({})).toEqual([]);
        expect(readStopUnlessRules({ condition: { estado: 'x' } })).toEqual([]);
    });

    it('exige al menos una regla al guardar, también dentro de ramas y repeticiones', () => {
        const issues = automationConfigIssues({
            actions: [
                { type: 'stop_unless', config: { condition: [] } },
                { type: 'stop_unless', config: { condition: [{ field: 'estado', op: 'eq', value: 'a' }] } },
                {
                    type: 'for_each_linked',
                    config: { relation_field_id: 4, actions: [{ type: 'stop_unless', config: {} }] },
                },
            ],
        });
        expect(issues.map((i) => i.path)).toEqual(['actions.0.config.condition', 'actions.2.config.actions.0.config.condition']);
    });

    it('no puede fallar: no lleva «Si este paso falla»', () => {
        expect(ON_ERROR_EXEMPT_ACTIONS).toContain('stop_unless');
        expect(onErrorIssues('stop_unless', { mode: 'retry', retries: 2 }, 'actions.0', false)).toEqual([]);
    });

    it('dice las reglas en palabras', () => {
        expect(conditionRuleText('Estado', 'eq', 'Pendiente')).toBe('«Estado» es «Pendiente»');
        expect(conditionRuleText('Responsable', 'is_null', '')).toBe('«Responsable» está vacío');
        expect(conditionRuleText('Monto', 'gt', '')).toBe('«Monto» es mayor que «(vacío)»');
        expect(describeStopUnless([])).toBe('Falta elegir la condición');
        expect(
            describeStopUnless([
                { label: 'Estado', op: 'eq', valueText: 'Pendiente' },
                { label: 'Monto', op: 'gt', valueText: '100' },
            ]),
        ).toBe('Sigue sólo si «Estado» es «Pendiente» y 1 regla más; si no, se detiene');
    });
});

describe('v0.1.466 — «Agregar un comentario»', () => {
    it('lee la configuración con sus valores por defecto', () => {
        expect(readAddCommentConfig({})).toEqual({ body: '', visibility: 'internal', target: 'record' });
        expect(readAddCommentConfig({ body: 'Hola {{nombre}}', visibility: 'client', target: 'item' })).toEqual({
            body: 'Hola {{nombre}}',
            visibility: 'client',
            target: 'item',
        });
        expect(readAddCommentConfig({ visibility: 'publico', target: 'otro' })).toMatchObject({ visibility: 'internal', target: 'record' });
    });

    it('exige el texto, y el vinculado sólo dentro de una repetición', () => {
        const issues = automationConfigIssues({
            actions: [
                { type: 'add_comment', config: { body: '   ' } },
                { type: 'add_comment', config: { body: 'Hola', target: 'item' } },
                { type: 'add_comment', config: { body: 'x'.repeat(10001) } },
                {
                    type: 'for_each_linked',
                    config: { relation_field_id: 4, actions: [{ type: 'add_comment', config: { body: 'Ok', target: 'item' } }] },
                },
            ],
        });
        expect(issues.map((i) => i.path)).toEqual(['actions.0.config.body', 'actions.1.config.target', 'actions.2.config.body']);
    });

    it('nombra al autor y lee la marca del servidor', () => {
        expect(automationCommentAuthor('Recordatorio de pago')).toBe('Automatización «Recordatorio de pago»');
        expect(automationCommentAuthor('')).toBe('Automatización');
        expect(readAutomationCommentMark({ automation: { id: 7, name: 'Bienvenida' } })).toEqual({ id: 7, name: 'Bienvenida' });
        expect(readAutomationCommentMark({ automation: { id: 'x' } })).toBeNull();
        expect(readAutomationCommentMark({ agent: { id: 1 } })).toBeNull();
        expect(readAutomationCommentMark(null)).toBeNull();
    });
});
