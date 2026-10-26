import { describe, expect, it } from 'vitest';
import {
    APPROVAL_FIELD_OPTIONS,
    APPROVAL_RESULT_BY_STATUS,
    approvalFlowConfigProblems,
    approvalFlowConfigSchema,
    decideApprovalSchema,
    describeApprover,
    describeWaitApproval,
    readApprovalFlowConfig,
    readApprovalFlowId,
    readApprovalTriggerResults,
    readWaitApprovalConfig,
    stepLabel,
    waitApprovalProblem,
} from './approvals';
import { automationConfigIssues } from './automation';
import { parseFieldConfig, valueBaseType } from './field';

const config = {
    steps: [
        { id: 's1', name: 'Jefe', approver: { type: 'field', approver_field_id: 10 }, mode: 'any' },
        { id: 's2', approver: { type: 'role', role: 'manager' }, mode: 'all' },
    ],
    on_approve: [{ field_id: 11, value: 'aprobado' }],
    on_reject: [{ field_id: 11, value: 'rechazado' }],
};

describe('flujos de aprobación', () => {
    it('lee la config con defaults y rechaza basura sin lanzar', () => {
        const parsed = readApprovalFlowConfig(config);
        expect(parsed?.steps).toHaveLength(2);
        expect(parsed?.steps[1]?.name).toBe('');
        expect(parsed?.allow_resubmit).toBe(false);
        expect(parsed?.self_approval).toBe(false);
        expect(readApprovalFlowConfig({ steps: [] })).toBeNull();
        expect(readApprovalFlowConfig('basura')).toBeNull();
        expect(approvalFlowConfigSchema.safeParse({ ...config, steps: [{ id: 'x', approver: { type: 'users', approver_user_ids: [] } }] }).success).toBe(false);
    });

    it('valida los campos contra la lista (Persona, existentes, sin repetir)', () => {
        const fields = new Map([
            [10, { type: 'user', label: 'Jefe' }],
            [11, { type: 'select', label: 'Estado' }],
        ]);
        const ok = approvalFlowConfigSchema.parse(config);
        expect(approvalFlowConfigProblems(ok, fields)).toEqual([]);
        const wrong = approvalFlowConfigSchema.parse({
            ...config,
            steps: [{ id: 's1', approver: { type: 'field', approver_field_id: 11 } }, { id: 's1', approver: { type: 'role', role: 'jefe' } }],
            on_approve: [{ field_id: 99, value: 'x' }],
            on_reject: [{ field_id: 11, value: 'a' }, { field_id: 11, value: 'b' }],
        });
        const problems = approvalFlowConfigProblems(wrong, fields);
        expect(problems.some((p) => p.includes('no es un campo Persona'))).toBe(true);
        expect(problems.some((p) => p.includes('el rol «jefe» no existe'))).toBe(true);
        expect(problems.some((p) => p.includes('mismo identificador'))).toBe(true);
        expect(problems.some((p) => p.startsWith('Al aprobar'))).toBe(true);
        expect(problems.some((p) => p.includes('dos veces'))).toBe(true);
    });

    it('describe aprobadores y pasos en lenguaje claro', () => {
        expect(describeApprover({ type: 'field', approver_field_id: 10 }, { fieldLabel: 'Jefe' })).toBe('El campo «Jefe»');
        expect(describeApprover({ type: 'role', role: 'manager' })).toBe('Rol: Manager');
        expect(describeApprover({ type: 'users', approver_user_ids: [1, 2] }, { userNames: new Map([[1, 'Ana']]) })).toBe('Ana, Persona #2');
        expect(describeApprover({ type: 'team', team_id: 3 }, { teamName: 'Finanzas' })).toBe('Equipo: Finanzas');
        expect(stepLabel({ name: '' }, 1)).toBe('Paso 2');
        expect(stepLabel({ name: 'Finanzas' }, 1)).toBe('Finanzas');
    });

    it('rechazar y devolver exigen motivo; aprobar no', () => {
        expect(decideApprovalSchema.safeParse({ decision: 'approve', step: 0 }).success).toBe(true);
        expect(decideApprovalSchema.safeParse({ decision: 'reject', step: 0, reason: '  ' }).success).toBe(false);
        expect(decideApprovalSchema.safeParse({ decision: 'return', step: 1, reason: 'Falta la factura' }).success).toBe(true);
        // El paso que vio la persona es obligatorio (anti doble clic).
        expect(decideApprovalSchema.safeParse({ decision: 'approve' }).success).toBe(false);
    });
});

describe('automatizaciones con aprobaciones', () => {
    it('resultados del disparador: lo elegido o aprobada + rechazada', () => {
        expect(readApprovalTriggerResults({})).toEqual(['approved', 'rejected']);
        expect(readApprovalTriggerResults({ results: ['returned', 'x', 'returned'] })).toEqual(['returned']);
        expect(readApprovalFlowId({ approval_flow_id: '7' })).toBe(7);
        expect(readApprovalFlowId({ approval_flow_id: 0 })).toBeNull();
        expect(APPROVAL_RESULT_BY_STATUS.approved).toBe('aprobada');
    });

    it('«Esperar aprobación»: tope de días opcional y validado', () => {
        expect(readWaitApprovalConfig({ timeout_days: '5' })).toEqual({ flowId: null, timeoutDays: 5 });
        expect(readWaitApprovalConfig({ approval_flow_id: 3 })).toEqual({ flowId: 3, timeoutDays: null });
        expect(waitApprovalProblem({ timeout_days: -1 })).toMatch(/mayor que 0/);
        expect(waitApprovalProblem({ timeout_days: 500 })).toMatch(/366/);
        expect(waitApprovalProblem({})).toBeNull();
        expect(describeWaitApproval({ timeout_days: 1 }, 'Gastos')).toContain('como mucho 1 día');
    });

    it('al guardar: pedir aprobación necesita el flujo y esperar no va en un bucle', () => {
        const issues = automationConfigIssues({
            trigger_type: 'approval_resolved',
            trigger_config: {},
            actions: [
                { type: 'request_approval', config: {} },
                { type: 'wait_approval', config: { timeout_days: 0.5 } },
                {
                    type: 'for_each_linked',
                    config: { relation_field_id: 4, actions: [{ type: 'wait_approval', config: {} }] },
                },
            ],
        });
        expect(issues.map((i) => i.path)).toEqual(
            expect.arrayContaining(['actions.0.config.approval_flow_id', 'actions.2.config.actions.0.type']),
        );
        expect(automationConfigIssues({ trigger_type: 'record_created', actions: [{ type: 'request_approval', config: { approval_flow_id: 2 } }] })).toEqual([]);
    });
});

describe('campo «Aprobación»', () => {
    it('se muestra como una selección de sólo lectura con opciones fijas', () => {
        expect(valueBaseType('approval')).toBe('select');
        expect(APPROVAL_FIELD_OPTIONS.map((o) => o.value)).toEqual(['pending', 'approved', 'rejected', 'returned', 'cancelled']);
        expect(parseFieldConfig('approval', { approval_flow_id: 4 })).toEqual({ approval_flow_id: 4 });
        expect(() => parseFieldConfig('approval', { approval_flow_id: -1 })).toThrow();
    });
});
