// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lazyDialog } from './lazyDialog';

describe('lazyDialog — el código del diálogo se baja la primera vez que se abre', () => {
    afterEach(cleanup);

    it('cerrado no pide nada; al abrir lo carga y después queda montado', async () => {
        const factory = vi.fn(async () => ({
            default: ({ open, label }: { open: boolean; label: string }) => <p>{open ? `abierto: ${label}` : 'cerrado'}</p>,
        }));
        const Dialog = lazyDialog(factory);
        const view = render(<Dialog open={false} label="x" />);
        expect(factory).not.toHaveBeenCalled();
        expect(view.container.textContent).toBe('');

        view.rerender(<Dialog open label="x" />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(await screen.findByText('abierto: x')).toBeTruthy();
        expect(factory).toHaveBeenCalledTimes(1);

        // Al cerrar sigue montado (conserva su estado y su animación de salida).
        view.rerender(<Dialog open={false} label="x" />);
        expect(screen.getByText('cerrado')).toBeTruthy();
        expect(factory).toHaveBeenCalledTimes(1);
    });
});
