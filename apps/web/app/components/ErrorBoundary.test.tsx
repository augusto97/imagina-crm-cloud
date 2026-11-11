// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';

import { SafeOutlet } from '@/admin/layout/SafeOutlet';
import { AppErrorBoundary, ErrorBoundary, PageErrorBoundary } from './ErrorBoundary';

function Boom({ message = 'se rompió' }: { message?: string }): JSX.Element {
    throw new Error(message);
}

describe('ErrorBoundary', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('la raíz muestra una pantalla de recuperación con «Recargar» y sin el nombre del producto', () => {
        const shown = vi.fn();
        render(
            <AppErrorBoundary onShown={shown}>
                <Boom />
            </AppErrorBoundary>,
        );
        const screenEl = screen.getByTestId('crash-app');
        expect(screenEl.textContent).toContain('Algo salió mal');
        expect(screen.getByRole('button', { name: /Recargar/ })).toBeTruthy();
        expect(screenEl.textContent ?? '').not.toMatch(/imagina/i);
        expect(shown).toHaveBeenCalledTimes(1);
    });

    it('una pantalla que falla no se lleva el shell, y navegar limpia el aviso', () => {
        function Shell(): JSX.Element {
            const navigate = useNavigate();
            return (
                <div>
                    <button type="button" onClick={() => navigate('/ok')}>menú</button>
                    <SafeOutlet />
                </div>
            );
        }
        render(
            <MemoryRouter initialEntries={['/rota']}>
                <Routes>
                    <Route element={<Shell />}>
                        <Route path="rota" element={<Boom />} />
                        <Route path="ok" element={<p>pantalla sana</p>} />
                    </Route>
                </Routes>
            </MemoryRouter>,
        );
        expect(screen.getByTestId('crash-page')).toBeTruthy();
        // El shell sigue vivo.
        fireEvent.click(screen.getByText('menú'));
        expect(screen.queryByTestId('crash-page')).toBeNull();
        expect(screen.getByText('pantalla sana')).toBeTruthy();
    });

    it('«Volver a intentar» vuelve a dibujar el subárbol', () => {
        let fail = true;
        function Flaky(): JSX.Element {
            if (fail) throw new Error('una vez');
            return <p>recuperado</p>;
        }
        render(
            <PageErrorBoundary resetKey="/x">
                <Flaky />
            </PageErrorBoundary>,
        );
        fail = false;
        fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }));
        expect(screen.getByText('recuperado')).toBeTruthy();
    });

    it('un chunk que no se pudo bajar ofrece recargar (sin «volver a intentar»)', () => {
        render(
            <PageErrorBoundary resetKey="/x">
                <Boom message="Failed to fetch dynamically imported module: /assets/X-abc.js" />
            </PageErrorBoundary>,
        );
        expect(screen.getByTestId('crash-page').textContent).toContain('versión nueva');
        expect(screen.queryByRole('button', { name: 'Volver a intentar' })).toBeNull();
        expect(screen.getByRole('button', { name: /Recargar/ })).toBeTruthy();
    });

    it('sin fallback conserva la tarjeta chica con el mensaje', () => {
        render(
            <ErrorBoundary label="Falló el panel">
                <Boom />
            </ErrorBoundary>,
        );
        expect(screen.getByText('Falló el panel')).toBeTruthy();
    });
});
