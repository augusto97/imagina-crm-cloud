import { describe, expect, it } from 'vitest';

import { help, registerHelpHandlers } from './helpBus';

describe('helpBus', () => {
    it('sin handlers las acciones no hacen nada y los recorridos no existen', () => {
        expect(help.startTour('welcome')).toBe(false);
        expect(help.hasTour('welcome')).toBe(false);
        expect(() => help.openHelp()).not.toThrow();
        expect(() => help.openWhatsNew({ id: 'x' })).not.toThrow();
    });

    it('registra, llama y quita sólo lo suyo', () => {
        const calls: string[] = [];
        const off = registerHelpHandlers({
            startTour: (id) => {
                calls.push(`tour:${id}`);
                return id === 'welcome';
            },
            hasTour: (id) => id === 'welcome',
        });
        expect(help.startTour('welcome')).toBe(true);
        expect(help.startTour('otro')).toBe(false);
        expect(help.hasTour('welcome')).toBe(true);

        // Otro reemplaza `hasTour`: al quitar el primero, `hasTour` sigue siendo del segundo.
        const hasTour2 = (id: string): boolean => id === 'otro';
        const off2 = registerHelpHandlers({ hasTour: hasTour2 });
        off();
        expect(help.startTour('welcome')).toBe(false);
        expect(help.hasTour('otro')).toBe(true);
        off2();
        expect(help.hasTour('otro')).toBe(false);
        expect(calls).toEqual(['tour:welcome', 'tour:otro']);
    });
});
