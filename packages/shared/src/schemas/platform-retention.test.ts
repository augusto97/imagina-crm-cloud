import { describe, expect, it } from 'vitest';

import { DEFAULT_PLATFORM_RETENTION, readPlatformRetention, updatePlatformRetentionSchema } from './platform-retention';

describe('retención de la plataforma (v0.1.439)', () => {
    it('de fábrica: corridas 90 días, actividad para siempre', () => {
        expect(readPlatformRetention(undefined)).toEqual(DEFAULT_PLATFORM_RETENTION);
        expect(DEFAULT_PLATFORM_RETENTION).toEqual({ automation_runs_days: 90, activity_days: null });
    });

    it('lee campo por campo: un valor roto no tira el otro', () => {
        expect(readPlatformRetention({ automation_runs_days: 30, activity_days: 730 })).toEqual({ automation_runs_days: 30, activity_days: 730 });
        expect(readPlatformRetention({ automation_runs_days: null, activity_days: 365 })).toEqual({ automation_runs_days: null, activity_days: 365 });
        expect(readPlatformRetention({ automation_runs_days: 7, activity_days: 'x' })).toEqual({ automation_runs_days: 90, activity_days: null });
        expect(readPlatformRetention('{no')).toEqual(DEFAULT_PLATFORM_RETENTION);
    });

    it('sólo acepta las opciones', () => {
        expect(updatePlatformRetentionSchema.safeParse({ automation_runs_days: 180 }).success).toBe(true);
        expect(updatePlatformRetentionSchema.safeParse({ automation_runs_days: null }).success).toBe(true);
        expect(updatePlatformRetentionSchema.safeParse({ automation_runs_days: 1 }).success).toBe(false);
        expect(updatePlatformRetentionSchema.safeParse({ activity_days: 90 }).success).toBe(false);
        expect(updatePlatformRetentionSchema.safeParse({ activity_days: 1825 }).success).toBe(true);
    });
});
