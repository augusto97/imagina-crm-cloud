import { describe, expect, it } from 'vitest';
import { BUTTON_COLOR_PRESETS, buttonConfigSchema, readButtonConfig } from '../schemas/button';
import { COLOR_PRESETS, isDataField, isUserWritableType, parseFieldConfig } from '../schemas/field';
import {
    BUTTON_DISABLED_DEFAULT_REASON,
    buttonActionProblem,
    buttonChangesRecord,
    buttonDisabledState,
    buttonLabel,
    buttonPortalProblems,
    buttonSetModesFor,
    buttonSupportsBulk,
    buttonWrittenFieldIds,
    computeButtonValue,
} from './button';

const paidTree = {
    type: 'group' as const,
    logic: 'and' as const,
    children: [{ type: 'condition' as const, field_id: 7, op: 'eq' as const, value: 'pagada' }],
};

describe('campo «Botón»', () => {
    it('usa los mismos colores que las opciones y no es un campo de datos', () => {
        expect([...BUTTON_COLOR_PRESETS].sort()).toEqual([...COLOR_PRESETS].sort());
        expect(isDataField('button')).toBe(false);
        expect(isUserWritableType('button')).toBe(false);
        // Sin reglas de valor por defecto / validación (no guarda valor).
        expect(parseFieldConfig('button', { label: 'Pagar', default_value: { kind: 'value', value: 'x' } })).not.toHaveProperty('default_value');
    });

    it('la config valida acciones, colores y enlaces; una inválida se lee como botón vacío', () => {
        const ok = buttonConfigSchema.parse({
            label: 'Marcar como pagado',
            color: 'green',
            icon: 'check',
            actions: [{ type: 'update_fields', values: [{ field_id: 7, value: 'pagada' }] }],
        });
        expect(ok.actions[0]).toEqual({ type: 'update_fields', values: [{ field_id: 7, mode: 'set', value: 'pagada' }] });
        expect(buttonConfigSchema.safeParse({ color: '#12345' }).success).toBe(false);
        expect(buttonConfigSchema.safeParse({ icon: 'calavera' }).success).toBe(false);
        expect(buttonConfigSchema.safeParse({ actions: Array.from({ length: 6 }, () => ({ type: 'run_automation' })) }).success).toBe(false);
        expect(readButtonConfig({ actions: 'no' })).toEqual({ actions: [] });
        expect(buttonLabel({ label: '  ' }, 'Acciones')).toBe('Acciones');
    });

    it('«deshabilitado si…» con el motivo; una condición que no aplica no deshabilita', () => {
        const fieldOf = (status: unknown) => (id: number) => (id === 7 ? { type: 'select', value: status } : undefined);
        expect(buttonDisabledState({ disabled_if: paidTree, disabled_reason: 'Ya está pagado' }, fieldOf('pagada'))).toEqual({
            disabled: true,
            reason: 'Ya está pagado',
        });
        expect(buttonDisabledState({ disabled_if: paidTree }, fieldOf('pagada')).reason).toBe(BUTTON_DISABLED_DEFAULT_REASON);
        expect(buttonDisabledState({ disabled_if: paidTree }, fieldOf('pendiente')).disabled).toBe(false);
        // El campo de la condición se borró: el botón sigue andando.
        expect(buttonDisabledState({ disabled_if: paidTree }, () => undefined).disabled).toBe(false);
        expect(buttonDisabledState({ disabled_if: null }, fieldOf('pagada')).disabled).toBe(false);
    });

    it('cómo escribe cada tipo: hoy, quien presiona, invertir y sumar', () => {
        expect(buttonSetModesFor('date')).toContain('today');
        expect(buttonSetModesFor('user')).toContain('me');
        expect(buttonSetModesFor('checkbox')).toContain('toggle');
        expect(buttonSetModesFor('currency')).toContain('add');
        expect(buttonSetModesFor('file')).toEqual([]);
        expect(buttonSetModesFor('computed')).toEqual([]);
        const ctx = { configured: undefined as unknown, today: '2026-10-23', nowIso: '2026-10-23T15:00:00.000Z', userId: 5 };
        expect(computeButtonValue('today', { type: 'date' }, null, ctx)).toEqual({ ok: true, value: '2026-10-23' });
        expect(computeButtonValue('today', { type: 'datetime' }, null, ctx)).toEqual({ ok: true, value: '2026-10-23T15:00:00.000Z' });
        expect(computeButtonValue('me', { type: 'user' }, null, ctx)).toEqual({ ok: true, value: 5 });
        expect(computeButtonValue('toggle', { type: 'checkbox' }, true, ctx)).toEqual({ ok: true, value: false });
        expect(computeButtonValue('add', { type: 'number' }, 0.1, { ...ctx, configured: 0.2 })).toEqual({ ok: true, value: 0.3 });
        expect(computeButtonValue('add', { type: 'number' }, null, { ...ctx, configured: '-1' })).toEqual({ ok: true, value: -1 });
        expect(computeButtonValue('add', { type: 'number' }, 3, { ...ctx, configured: 'x' }).ok).toBe(false);
        expect(computeButtonValue('add', { type: 'text' }, 3, { ...ctx, configured: 1 }).ok).toBe(false);
        expect(computeButtonValue('clear', { type: 'text' }, 'hola', ctx)).toEqual({ ok: true, value: null });
    });

    it('en lote sólo lo que no abre enlaces ni descarga; qué campos escribe', () => {
        const update = { type: 'update_fields' as const, values: [{ field_id: 7, mode: 'set' as const, value: 'pagada' }] };
        const save = { type: 'generate_pdf' as const, document_template_id: 3, mode: 'save' as const, save_field_id: 9, save_mode: 'append' as const };
        const download = { ...save, mode: 'download' as const, save_field_id: null };
        expect(buttonSupportsBulk({ actions: [update, { type: 'run_automation' }, save] })).toBe(true);
        expect(buttonSupportsBulk({ actions: [update, { type: 'open_url', url: 'https://x.co' }] })).toBe(false);
        expect(buttonSupportsBulk({ actions: [download] })).toBe(false);
        expect(buttonSupportsBulk({ actions: [] })).toBe(false);
        expect(buttonChangesRecord({ actions: [{ type: 'run_automation' }] })).toBe(false);
        expect(buttonChangesRecord({ actions: [save] })).toBe(true);
        expect(buttonWrittenFieldIds({ actions: [update, save] }).sort()).toEqual([7, 9]);
    });

    it('portal: sólo lo editable, PDF publicados y automatizaciones con permiso explícito', () => {
        const ctx = { editableFieldIds: new Set([7]), portalTemplateIds: new Set([3]) };
        const update = (id: number) => ({ type: 'update_fields' as const, values: [{ field_id: id, mode: 'set' as const }] });
        expect(buttonPortalProblems({ actions: [{ type: 'open_url', url: 'https://x.co' }, update(7)] }, ctx)).toEqual([]);
        expect(buttonPortalProblems({ actions: [update(8)] }, ctx)).toHaveLength(1);
        expect(
            buttonPortalProblems({ actions: [{ type: 'generate_pdf', document_template_id: 4, mode: 'download', save_mode: 'append' }] }, ctx),
        ).toHaveLength(1);
        expect(buttonPortalProblems({ actions: [{ type: 'run_automation' }] }, ctx)).toHaveLength(1);
        expect(buttonPortalProblems({ actions: [{ type: 'run_automation' }], portal_run_automation: true }, ctx)).toEqual([]);
    });

    it('avisa de las acciones incompletas', () => {
        expect(buttonActionProblem({ type: 'open_url', url: ' ' })).toBe('Falta el enlace');
        expect(buttonActionProblem({ type: 'update_fields', values: [] })).not.toBeNull();
        expect(buttonActionProblem({ type: 'generate_pdf', document_template_id: null, mode: 'download', save_mode: 'append' })).not.toBeNull();
        expect(buttonActionProblem({ type: 'generate_pdf', document_template_id: 3, mode: 'save', save_field_id: null, save_mode: 'append' })).not.toBeNull();
        expect(buttonActionProblem({ type: 'run_automation' })).toBeNull();
    });
});
