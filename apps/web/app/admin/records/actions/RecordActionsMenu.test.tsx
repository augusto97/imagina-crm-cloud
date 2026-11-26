// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordActionsMenu } from './RecordAction';

/**
 * v0.1.472 — Las acciones del menú se arman recién cuando la ficha ya cargó
 * (o al acercarse al botón): cada una pregunta al servidor si aplica, y esos
 * pedidos competían con los de la ficha al abrirla.
 */
describe('RecordActionsMenu — acciones diferidas', () => {
    const Item = vi.fn(() => <button className="imcrm-ra-row">Código QR</button>);

    beforeEach(() => {
        vi.useFakeTimers();
        Item.mockClear();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    const renderMenu = (props: { open?: boolean; deferKey?: number }) =>
        render(
            <RecordActionsMenu open={props.open ?? false} onOpenChange={() => undefined} deferKey={props.deferKey}>
                <Item />
            </RecordActionsMenu>,
        );

    it('sin deferKey arma las acciones enseguida (como antes)', () => {
        renderMenu({});
        expect(Item).toHaveBeenCalled();
    });

    it('con deferKey espera a que la pestaña quede libre; el botón se ve mientras tanto', async () => {
        renderMenu({ deferKey: 5 });
        expect(Item).not.toHaveBeenCalled();
        expect(screen.getByTestId('imcrm-record-more')).toBeTruthy();
        await act(async () => {
            vi.advanceTimersByTime(4000);
        });
        expect(Item).toHaveBeenCalled();
    });

    it('acercarse al botón las arma al toque', () => {
        renderMenu({ deferKey: 5 });
        fireEvent.pointerEnter(screen.getByTestId('imcrm-record-actions'));
        expect(Item).toHaveBeenCalled();
    });

    it('abierto las muestra aunque todavía no se hayan armado', () => {
        renderMenu({ deferKey: 5, open: true });
        expect(Item).toHaveBeenCalled();
    });

    it('al pasar a otro registro vuelve a esperar', async () => {
        const view = renderMenu({ deferKey: 5 });
        fireEvent.pointerEnter(screen.getByTestId('imcrm-record-actions'));
        expect(screen.queryByText('Código QR')).toBeTruthy();
        view.rerender(
            <RecordActionsMenu open={false} onOpenChange={() => undefined} deferKey={6}>
                <Item />
            </RecordActionsMenu>,
        );
        expect(screen.queryByText('Código QR')).toBeNull();
        await act(async () => {
            vi.advanceTimersByTime(4000);
        });
        expect(screen.queryByText('Código QR')).toBeTruthy();
    });
});
