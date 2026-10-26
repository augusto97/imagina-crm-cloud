import { describe, expect, it } from 'vitest';
import { APPROVAL_FIELD_OPTIONS, type ApprovalRequestDto, type ApprovalStepDto } from '@imagina-base/shared';

import { approvalText } from '@/admin/activity/activityText';
import { asDisplayField, displayTypeOf, isDerivedFieldType } from '@/lib/fieldTypeCatalog';
import type { ActionSpec } from '@/types/automation';

import { actionsUseApprovals, approvalResultConditionField } from './approvalAutomation';
import { approvalProgressLabel, decisionFromQuery, decisionNeedsReason, missingApprovers, sortRequests } from './approvalUi';

function step(partial: Partial<ApprovalStepDto>): ApprovalStepDto {
    return { id: 's', name: '', mode: 'any', approver_label: '', state: 'upcoming', approvers: [], ...partial };
}

function req(partial: Partial<ApprovalRequestDto>): Pick<ApprovalRequestDto, 'status' | 'current_step' | 'steps' | 'id'> {
    return { id: 1, status: 'pending', current_step: 0, steps: [step({})], ...partial };
}

describe('C5 — interfaz de aprobaciones', () => {
    it('describe el avance de la solicitud', () => {
        expect(approvalProgressLabel(req({ steps: [step({ name: 'Jefe' })] }))).toBe('Esperando la decisión');
        expect(approvalProgressLabel(req({ current_step: 1, steps: [step({}), step({ name: 'Finanzas' })] }))).toBe('Paso 2 de 2 · Finanzas');
        expect(approvalProgressLabel(req({ steps: [step({}), step({})] }))).toBe('Paso 1 de 2');
        expect(approvalProgressLabel(req({ status: 'rejected' }))).toBe('Rechazada');
    });

    it('dice quién falta en el modo «todos» (y nada en «cualquiera»)', () => {
        const all = step({
            mode: 'all',
            state: 'current',
            approvers: [
                { id: 1, name: 'Ana', approved: true },
                { id: 2, name: 'Luis', approved: false },
            ],
        });
        expect(missingApprovers(req({ steps: [all] }))).toEqual(['Luis']);
        expect(missingApprovers(req({ steps: [{ ...all, mode: 'any' }] }))).toEqual([]);
        expect(missingApprovers(req({ status: 'approved', steps: [all] }))).toEqual([]);
    });

    it('rechazar y devolver piden motivo; aprobar no', () => {
        expect(decisionNeedsReason('approve')).toBe(false);
        expect(decisionNeedsReason('reject')).toBe(true);
        expect(decisionNeedsReason('return')).toBe(true);
    });

    it('el enlace del correo sólo sugiere decisiones conocidas', () => {
        expect(decisionFromQuery('approve')).toBe('approve');
        expect(decisionFromQuery('reject')).toBe('reject');
        expect(decisionFromQuery('delete')).toBeNull();
        expect(decisionFromQuery(null)).toBeNull();
    });

    it('ordena la abierta primero y después de la más nueva a la más vieja', () => {
        const rows = [
            { id: 1, status: 'approved' as const },
            { id: 3, status: 'rejected' as const },
            { id: 2, status: 'pending' as const },
            { id: 4, status: 'returned' as const },
        ];
        expect(sortRequests(rows).map((r) => r.id)).toEqual([2, 4, 3, 1]);
    });

    it('el campo «Aprobación» se muestra y filtra como una selección de sólo lectura', () => {
        expect(displayTypeOf('approval')).toBe('select');
        expect(isDerivedFieldType('approval')).toBe(true);
        const shown = asDisplayField({ id: 1, type: 'approval', config: { approval_flow_id: 3 } });
        expect(shown.type).toBe('select');
        expect(shown.config).toEqual({ approval_flow_id: 3, options: APPROVAL_FIELD_OPTIONS });
    });

    it('detecta las aprobaciones en el flujo, también dentro de ramas', () => {
        const nested: ActionSpec[] = [
            { type: 'if_else', config: { then_actions: [{ type: 'wait_approval', config: {} }], else_actions: [] } },
        ];
        expect(actionsUseApprovals(nested)).toBe(true);
        expect(actionsUseApprovals([{ type: 'send_email', config: {} }])).toBe(false);
        const field = approvalResultConditionField(7);
        expect(field.slug).toBe('aprobacion.resultado');
        expect((field.config.options as Array<{ value: string }>).map((o) => o.value)).toContain('vencida');
    });

    it('la actividad se lee en lenguaje claro', () => {
        const entry = (approval: Record<string, unknown>) => ({ changes: { approval } }) as never;
        expect(approvalText(entry({ event: 'requested', flow: 'Gasto > $1M', step: 0, steps: 2 }))).toBe('pidió aprobación (Gasto > $1M)');
        expect(approvalText(entry({ event: 'approved_step', flow: 'Gasto', step: 0, steps: 2 }))).toBe('aprobó el paso 1 de 2');
        expect(approvalText(entry({ event: 'approved_step', flow: 'Gasto', step: 1, steps: 2, waiting_on: 1 }))).toBe('aprobó el paso 2 de 2 · falta 1 persona');
        expect(approvalText(entry({ event: 'rejected', flow: 'Gasto', step: 0, steps: 1, reason: 'falta la factura' }))).toBe('rechazó: falta la factura');
        expect(approvalText(entry({ event: 'returned', flow: 'Gasto', step: 0, steps: 1, reason: 'adjunta el soporte' }))).toBe('devolvió la solicitud para corregir: adjunta el soporte');
        expect(approvalText(entry({ event: 'approved', flow: 'Gasto', step: 1, steps: 2 }))).toBe('aprobó el paso 2 de 2 · la solicitud quedó aprobada (Gasto)');
        expect(approvalText(entry({ event: 'requested', flow: 'Gasto', step: 0, steps: 1, automation: 'Gastos altos' }))).toBe(
            'pidió aprobación (Gasto) · desde la automatización «Gastos altos»',
        );
    });
});
