// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openButtonUrl } from './ButtonFieldControl';

describe('abrir el enlace de un botón', () => {
    afterEach(() => vi.restoreAllMocks());

    it('https en otra pestaña sin acceso a la app (sin opener)', () => {
        const tab = { opener: window as unknown, location: { href: '' } };
        const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
        openButtonUrl('https://wa.me/573001112233?text=Hola', null);
        expect(open).toHaveBeenCalledWith('', '_blank');
        expect(tab.opener).toBeNull();
        expect(tab.location.href).toBe('https://wa.me/573001112233?text=Hola');
    });

    it('si el navegador bloquea la ventana, el aviso trae el enlace para abrirlo', () => {
        vi.spyOn(window, 'open').mockReturnValue(null);
        const show = vi.fn();
        openButtonUrl('https://maps.google.com/?q=Bogot%C3%A1', { show } as never);
        expect(show).toHaveBeenCalledTimes(1);
        const arg = show.mock.calls[0]![0] as { title: string; action: { label: string } };
        expect(arg.title).toMatch(/bloqueó/);
        expect(arg.action.label).toBe('Abrir enlace');
    });
});
