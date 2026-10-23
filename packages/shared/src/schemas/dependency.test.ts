import { describe, expect, it } from 'vitest';
import {
    doneRuleFor,
    effectiveEndMs,
    findDependencyCycle,
    isDoneValue,
    readDependencySettings,
    shiftDateValue,
} from './dependency';

const status = {
    id: 7,
    slug: 'estado',
    label: 'Estado',
    type: 'select',
    config: {
        options: [
            { value: 'pendiente', label: 'Pendiente' },
            { value: 'en_curso', label: 'En curso' },
            { value: 'ok', label: 'Completado' },
            { value: 'cancel', label: 'Cancelada' },
        ],
    },
};

describe('dependencias — reglas puras', () => {
    it('«terminado» con el mismo criterio de Mi trabajo (etiqueta de la opción)', () => {
        const rule = doneRuleFor([{ id: 1, slug: 'nombre', label: 'Nombre', type: 'text' }, status]);
        expect(rule).toEqual({ fieldId: 7, slug: 'estado', values: ['ok', 'cancel'] });
        expect(isDoneValue(rule, 'ok')).toBe(true);
        expect(isDoneValue(rule, 'en_curso')).toBe(false);
        expect(isDoneValue(rule, null)).toBe(false);
        // Sin un estado reconocible nada cuenta como terminado.
        expect(doneRuleFor([{ id: 1, slug: 'nombre', label: 'Nombre', type: 'text' }])).toBeNull();
    });

    it('ajustes de la lista: tolerantes, lo que no tiene forma va al default', () => {
        expect(readDependencySettings({ dependencies: { reschedule: true, start_field_id: 3, end_field_id: 4 } })).toEqual({
            reschedule: true,
            start_field_id: 3,
            end_field_id: 4,
        });
        expect(readDependencySettings({ dependencies: { reschedule: 'si', start_field_id: -1 } })).toEqual({
            reschedule: false,
            start_field_id: null,
            end_field_id: null,
        });
        expect(readDependencySettings(null).reschedule).toBe(false);
    });

    it('correr fechas: días enteros en una fecha, el instante en fecha y hora', () => {
        const day = 86_400_000;
        expect(shiftDateValue('date', '2026-01-30', 3 * day)).toBe('2026-02-02');
        expect(shiftDateValue('date', '2026-03-01', -1 * day)).toBe('2026-02-28');
        expect(shiftDateValue('date', '2026-03-01', 0.4 * day)).toBe('2026-03-01');
        expect(shiftDateValue('datetime', '2026-07-10T14:30:00.000Z', 2 * day)).toBe('2026-07-12T14:30:00.000Z');
        expect(shiftDateValue('date', 'mañana', day)).toBeNull();
    });

    it('fin efectivo: el fin, o el inicio en un hito', () => {
        expect(effectiveEndMs({ f1: '2026-01-01', f2: '2026-01-05' }, 'f1', 'f2')).toBe(Date.UTC(2026, 0, 5));
        expect(effectiveEndMs({ f1: '2026-01-01' }, 'f1', 'f2')).toBe(Date.UTC(2026, 0, 1));
        expect(effectiveEndMs({}, 'f1', 'f2')).toBeNull();
    });

    it('ciclos: A→B→C y agregar C→A cierra el círculo (con el camino)', () => {
        const edges = new Map<number, number[]>([
            [1, [2]],
            [2, [3]],
        ]);
        const next = (id: number) => edges.get(id) ?? [];
        // «3 bloquea a 1»: desde 1 se llega a 3.
        expect(findDependencyCycle(3, 1, next)).toEqual([1, 2, 3]);
        // «1 bloquea a 3» no cierra nada (ya hay camino en el mismo sentido).
        expect(findDependencyCycle(1, 3, next)).toBeNull();
        // Un registro no se bloquea a sí mismo.
        expect(findDependencyCycle(4, 4, next)).toEqual([4]);
    });
});
