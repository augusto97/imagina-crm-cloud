// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

/** Sin ConfirmProvider el hook cae a `window.confirm`: se controla desde el test. */
describe('useUnsavedChangesGuard', () => {
    let confirmSpy: MockInstance<(message?: string) => boolean>;
    let anchor: HTMLAnchorElement;
    let navigated: number;

    beforeEach(() => {
        window.history.replaceState({ idx: 3 }, '', '/#/lists/x/automations/1');
        confirmSpy = vi.spyOn(window, 'confirm');
        navigated = 0;
        anchor = document.createElement('a');
        anchor.href = '/#/lists/x/automations';
        anchor.textContent = 'Volver';
        // Lo que haría el Link del router: navegar en su propio click.
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            navigated++;
        });
        document.body.appendChild(anchor);
    });

    afterEach(() => {
        anchor.remove();
        confirmSpy.mockRestore();
    });

    const flush = () => act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });

    it('sin cambios no interviene', async () => {
        renderHook(() => useUnsavedChangesGuard(false));
        anchor.click();
        await flush();
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(navigated).toBe(1);
    });

    it('con cambios: un enlace pregunta; «Seguir editando» no navega, «Salir» re-ejecuta el mismo clic', async () => {
        renderHook(() => useUnsavedChangesGuard(true));
        confirmSpy.mockReturnValueOnce(false);
        anchor.click();
        await flush();
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(navigated).toBe(0);

        confirmSpy.mockReturnValueOnce(true);
        anchor.click();
        await flush();
        expect(confirmSpy).toHaveBeenCalledTimes(2);
        expect(navigated).toBe(1);
    });

    it('Atrás del navegador: se deshace el paso, se pregunta y el router no lo ve si se cancela', async () => {
        // El router registra su listener ANTES que el editor (sin captura).
        const routerSaw = vi.fn();
        window.addEventListener('popstate', routerSaw);
        renderHook(() => useUnsavedChangesGuard(true));
        confirmSpy.mockReturnValueOnce(false);
        // El navegador ya cambió la URL cuando llega `popstate`.
        window.history.replaceState({ idx: 2 }, '', '/#/lists/x/records');
        window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 2 } }));
        await flush();
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(routerSaw).not.toHaveBeenCalled();
        expect(window.location.hash).toBe('#/lists/x/automations/1');
        expect(window.history.state).toEqual({ idx: 3 });
        window.removeEventListener('popstate', routerSaw);
    });

    it('confirmLeave() para navegaciones programáticas', async () => {
        const { result, rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), { initialProps: { dirty: true } });
        confirmSpy.mockReturnValueOnce(true);
        await expect(result.current.confirmLeave()).resolves.toBe(true);
        rerender({ dirty: false });
        await expect(result.current.confirmLeave()).resolves.toBe(true);
        expect(confirmSpy).toHaveBeenCalledTimes(1);
    });
});
