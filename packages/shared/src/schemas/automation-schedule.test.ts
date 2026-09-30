import { describe, expect, it } from 'vitest';
import { scheduleCron, scheduleParts } from './automation';

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
