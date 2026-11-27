// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shareText, useChartTip } from './ChartTip';

/**
 * v0.1.474 — El recuadro de los gráficos sale apenas el mouse entra (antes
 * era el `title` del navegador, ~1 s tarde y nunca con el dedo). Con el dedo,
 * el primer toque lo muestra y el segundo abre los registros.
 */
function Bars({ onOpen }: { onOpen: (label: string) => void }): JSX.Element {
    const tip = useChartTip();
    return (
        <div>
            {['ene', 'feb'].map((label) => (
                <div
                    key={label}
                    data-testid={`bar-${label}`}
                    {...tip.bind(label, () => ({ title: label, rows: [{ value: `$ ${label}` }] }), () => onOpen(label))}
                />
            ))}
            <div data-testid="fuera" />
            {tip.layer}
        </div>
    );
}

const pointer = (el: Element, type: string, pointerType: 'mouse' | 'touch'): void => {
    // jsdom no trae PointerEvent: un MouseEvent con `pointerType` alcanza para React.
    const ev = new MouseEvent(type, { bubbles: true, clientX: 20, clientY: 30 });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    act(() => {
        el.dispatchEvent(ev);
    });
};

describe('useChartTip', () => {
    afterEach(() => cleanup());

    it('con el mouse aparece al entrar, cambia al pasar a otra barra y se va al salir', () => {
        const onOpen = vi.fn();
        render(<Bars onOpen={onOpen} />);
        expect(screen.queryByTestId('imcrm-chart-tip')).toBeNull();
        pointer(screen.getByTestId('bar-ene'), 'pointerover', 'mouse');
        expect(screen.getByTestId('imcrm-chart-tip').textContent).toContain('$ ene');
        pointer(screen.getByTestId('bar-ene'), 'pointerout', 'mouse');
        pointer(screen.getByTestId('bar-feb'), 'pointerover', 'mouse');
        expect(screen.getByTestId('imcrm-chart-tip').textContent).toContain('$ feb');
        pointer(screen.getByTestId('bar-feb'), 'pointerout', 'mouse');
        expect(screen.queryByTestId('imcrm-chart-tip')).toBeNull();
        // Un clic con el mouse abre los registros de una.
        pointer(screen.getByTestId('bar-ene'), 'pointerdown', 'mouse');
        fireEvent.click(screen.getByTestId('bar-ene'));
        expect(onOpen).toHaveBeenCalledWith('ene');
    });

    it('con el dedo: el primer toque muestra el recuadro y el segundo abre', () => {
        const onOpen = vi.fn();
        render(<Bars onOpen={onOpen} />);
        const bar = screen.getByTestId('bar-feb');
        pointer(bar, 'pointerdown', 'touch');
        fireEvent.click(bar);
        expect(onOpen).not.toHaveBeenCalled();
        expect(screen.getByTestId('imcrm-chart-tip').textContent).toContain('$ feb');
        pointer(bar, 'pointerdown', 'touch');
        fireEvent.click(bar);
        expect(onOpen).toHaveBeenCalledWith('feb');
        expect(screen.queryByTestId('imcrm-chart-tip')).toBeNull();
    });

    it('con el dedo, tocar afuera lo cierra', () => {
        render(<Bars onOpen={() => undefined} />);
        pointer(screen.getByTestId('bar-ene'), 'pointerdown', 'touch');
        fireEvent.click(screen.getByTestId('bar-ene'));
        expect(screen.getByTestId('imcrm-chart-tip')).toBeTruthy();
        pointer(screen.getByTestId('fuera'), 'pointerdown', 'touch');
        expect(screen.queryByTestId('imcrm-chart-tip')).toBeNull();
    });

    it('la parte del total', () => {
        expect(shareText(1, 4)).toMatch(/^25 %$/);
        expect(shareText(1, 0)).toBe('—');
    });
});
