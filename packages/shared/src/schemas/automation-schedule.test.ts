import { describe, expect, it } from 'vitest';
import { automationConfigIssues, cronError, scheduleCron, scheduleParts } from './automation';

describe('scheduleCron (v0.1.221)', () => {
    it('traduce la frecuencia de la UI a cron, con defaults', () => {
        // Sin nada: lo que el editor muestra por defecto (diario a las 9).
        expect(scheduleCron({})).toBe('0 9 * * *');
        expect(scheduleCron({ frequency: 'hourly', minute: 15 })).toBe('15 * * * *');
        expect(scheduleCron({ frequency: 'twicedaily', hour: 21 })).toBe('0 9,21 * * *');
        expect(scheduleCron({ frequency: 'weekly', weekday: 1, hour: 7, minute: 30 })).toBe('30 7 * * 1');
        expect(scheduleCron({ frequency: 'monthly', day: 5, hour: 6 })).toBe('0 6 5 * *');
    });

    it('un cron explícito manda y los valores fuera de rango vuelven al default', () => {
        expect(scheduleCron({ cron: '*/10 * * * *', frequency: 'daily' })).toBe('*/10 * * * *');
        expect(scheduleParts({ hour: 99, weekday: 9, day: 31, frequency: 'x' })).toEqual({ frequency: 'daily', hour: 9, minute: 0, weekday: 1, day: 1 });
    });
});

describe('cronError (auditoría de automatizaciones)', () => {
    it('acepta crons comunes y los del editor', () => {
        for (const ok of ['0 9 * * *', '*/10 * * * *', '30 7 * * 1-5', '0 9,21 * * *', '0 6 5 * *', '0 0 L * ?', '0 8 * * MON-FRI', '0 0 1 jan *', '0 12 * * 5#2', '0 0 * * 5L', '0 0 * * 7', '15 30 9 * * *']) {
            expect(cronError(ok), ok).toBeNull();
        }
    });

    it('rechaza lo que el planificador no puede registrar, con el motivo', () => {
        expect(cronError('99 99 * * *')).toMatch(/fuera de rango para los minutos/);
        expect(cronError('0 24 * * *')).toMatch(/la hora/);
        expect(cronError('* * *')).toMatch(/5 partes/);
        expect(cronError('0 9 * * lunes')).toMatch(/no es válido/);
        expect(cronError('*/0 * * * *')).toMatch(/paso/);
        expect(cronError('0 9 10-5 * *')).toMatch(/al revés/);
    });

    it('automationConfigIssues: «Para» vacío, URL vacía (también dentro de un si/sino) y cron roto', () => {
        const issues = automationConfigIssues({
            trigger_type: 'scheduled',
            trigger_config: { cron: '99 99 * * *' },
            actions: [
                { type: 'send_email', config: { to: '  ', subject: 'Hola' } },
                { type: 'if_else', config: { then_actions: [{ type: 'call_webhook', config: {} }], else_actions: [] } },
                { type: 'call_webhook', config: { connection_id: 4 } },
            ],
        });
        expect(issues.map((i) => i.path)).toEqual(['trigger_config.cron', 'actions.0.config.to', 'actions.1.config.then_actions.0.config.url']);
        expect(automationConfigIssues({ trigger_type: 'record_created', actions: [{ type: 'send_email', config: { to: '{{email}}' } }] })).toEqual([]);
    });
});
