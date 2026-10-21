import { describe, expect, it } from 'vitest';

import { moveActiveCell } from './gridKeyboard';

describe('navegación con teclado en la tabla (v0.1.286)', () => {
    it('las flechas mueven la celda activa sin salirse de la tabla', () => {
        expect(moveActiveCell(null, 'ArrowDown', false, 5, 3)).toEqual({ row: 0, col: 0 });
        expect(moveActiveCell({ row: 0, col: 0 }, 'ArrowDown', false, 5, 3)).toEqual({ row: 1, col: 0 });
        expect(moveActiveCell({ row: 0, col: 0 }, 'ArrowUp', false, 5, 3)).toEqual({ row: 0, col: 0 });
        expect(moveActiveCell({ row: 2, col: 2 }, 'ArrowRight', false, 5, 3)).toEqual({ row: 2, col: 2 });
        expect(moveActiveCell({ row: 2, col: 2 }, 'ArrowLeft', false, 5, 3)).toEqual({ row: 2, col: 1 });
        expect(moveActiveCell({ row: 2, col: 1 }, 'End', false, 5, 3)).toEqual({ row: 2, col: 2 });
        expect(moveActiveCell({ row: 2, col: 1 }, 'Home', false, 5, 3)).toEqual({ row: 2, col: 0 });
        expect(moveActiveCell({ row: 1, col: 0 }, 'PageDown', false, 5, 3)).toEqual({ row: 4, col: 0 });
    });

    it('Tab avanza y salta de fila; en la última celda deja salir el foco', () => {
        expect(moveActiveCell({ row: 0, col: 2 }, 'Tab', false, 2, 3)).toEqual({ row: 1, col: 0 });
        expect(moveActiveCell({ row: 1, col: 0 }, 'Tab', true, 2, 3)).toEqual({ row: 0, col: 2 });
        expect(moveActiveCell({ row: 1, col: 2 }, 'Tab', false, 2, 3)).toBeUndefined();
        expect(moveActiveCell({ row: 0, col: 0 }, 'Tab', true, 2, 3)).toBeUndefined();
    });

    it('otras teclas y tablas vacías no navegan; una fila que desapareció se acota', () => {
        expect(moveActiveCell({ row: 0, col: 0 }, 'a', false, 2, 3)).toBeUndefined();
        expect(moveActiveCell(null, 'ArrowDown', false, 0, 3)).toBeUndefined();
        expect(moveActiveCell({ row: 9, col: 9 }, 'ArrowUp', false, 3, 2)).toEqual({ row: 1, col: 1 });
    });
});
