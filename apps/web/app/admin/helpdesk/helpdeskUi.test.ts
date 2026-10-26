import { describe, expect, it } from 'vitest';

import type { FieldEntity } from '@/types/field';

import { emailOf } from './EmailCommentMeta';
import { dueIn, hoursLabel, parseHours, summarizeHelpdeskTrigger } from './helpdeskUi';
import { helpdeskLockedReasons } from './managedFields';

describe('D2/E5 — mesa de ayuda en la interfaz', () => {
    it('horas del SLA: se leen con coma o punto y se muestran en h/min', () => {
        expect(parseHours('1,5')).toBe(1.5);
        expect(parseHours(' 8 ')).toBe(8);
        expect(parseHours('')).toBeNull();
        expect(parseHours('-2')).toBeNull();
        expect(hoursLabel(1.5)).toBe('1 h 30 min');
        expect(hoursLabel(0.25)).toBe('15 min');
        expect(hoursLabel(24)).toBe('24 h');
        expect(hoursLabel(null)).toBe('Sin objetivo');
    });

    it('cuánto falta para un vencimiento (o cuánto pasó)', () => {
        const now = new Date('2026-10-26T12:00:00Z');
        expect(dueIn('2026-10-26T13:20:00Z', now)).toBe('en 1 h 20 min');
        expect(dueIn('2026-10-26T11:30:00Z', now)).toBe('hace 30 min');
        expect(dueIn('2026-10-28T14:00:00Z', now)).toBe('en 2 d 2 h');
        expect(dueIn(null, now)).toBe('');
    });

    it('la frase de los disparadores', () => {
        expect(summarizeHelpdeskTrigger('email_received', {})).toBe('Cuando llega un correo al buzón de soporte');
        expect(summarizeHelpdeskTrigger('email_received', { email_kind: 'reply' })).toBe('Cuando el cliente responde un ticket por correo');
        expect(summarizeHelpdeskTrigger('sla_alert', { sla_alerts: ['breached'], sla_targets: ['first_response'] })).toBe(
            'Cuando un SLA queda vencido (primera respuesta)',
        );
        expect(summarizeHelpdeskTrigger('sla_alert', {})).toBe('Cuando un SLA queda en riesgo o vencido');
        expect(summarizeHelpdeskTrigger('record_created', {})).toBeNull();
    });

    it('un comentario es un correo sólo si trae la dirección', () => {
        const of = (metadata: unknown) => emailOf({ metadata } as Parameters<typeof emailOf>[0]);
        expect(of({ email: { direction: 'in', from: 'a@b.co' } })?.from).toBe('a@b.co');
        expect(of({ email: { direction: 'x' } })).toBeNull();
        expect(of({})).toBeNull();
        expect(of(undefined)).toBeNull();
    });

    it('las columnas del SLA llevan candado en los formularios', () => {
        const f = (id: number, slug: string) => ({ id, slug }) as FieldEntity;
        const reasons = helpdeskLockedReasons(new Set([2]), [f(1, 'asunto'), f(2, 'vence')]);
        expect(Object.keys(reasons)).toEqual(['vence']);
        expect(reasons.vence).toMatch(/SLA/);
        expect(helpdeskLockedReasons(null, [f(2, 'vence')])).toEqual({});
    });
});
