// @vitest-environment jsdom
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Popover, PopoverContent, PopoverTrigger } from './popover';

/**
 * v0.1.473 — Una ventana (el registro flotante, el alta, un panel lateral)
 * bloquea el scroll de la página escuchando `wheel`/`touchmove` en el
 * documento y cancelando lo que pase fuera de su contenido. Los desplegables
 * se dibujan por portal FUERA de la ventana, así que la rueda sobre sus
 * opciones quedaba cancelada y la lista no se movía.
 */
describe('PopoverContent dentro de una ventana', () => {
    afterEach(() => cleanup());

    const renderInDialog = () =>
        render(
            <DialogPrimitive.Root open>
                <DialogPrimitive.Portal>
                    <DialogPrimitive.Overlay />
                    <DialogPrimitive.Content aria-describedby={undefined}>
                        <DialogPrimitive.Title>Registro</DialogPrimitive.Title>
                        <Popover open>
                            <PopoverTrigger>Mes</PopoverTrigger>
                            <PopoverContent>
                                <ul>
                                    <li>
                                        <button type="button">ENERO</button>
                                    </li>
                                </ul>
                            </PopoverContent>
                        </Popover>
                    </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
            </DialogPrimitive.Root>,
        );

    it('la rueda sobre las opciones no la cancela el bloqueo de scroll de la ventana', () => {
        renderInDialog();
        const option = screen.getByText('ENERO');
        const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
        option.dispatchEvent(wheel);
        expect(wheel.defaultPrevented).toBe(false);
    });

    it('el dedo sobre las opciones tampoco (celular)', () => {
        renderInDialog();
        const option = screen.getByText('ENERO');
        const move = new Event('touchmove', { bubbles: true, cancelable: true });
        option.dispatchEvent(move);
        expect(move.defaultPrevented).toBe(false);
    });

    it('fuera del desplegable la ventana sigue bloqueando la página', () => {
        renderInDialog();
        const outside = document.createElement('div');
        document.body.appendChild(outside);
        const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
        outside.dispatchEvent(wheel);
        expect(wheel.defaultPrevented).toBe(true);
        outside.remove();
    });
});
