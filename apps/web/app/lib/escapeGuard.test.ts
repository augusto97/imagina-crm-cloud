// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { escapeIntent, FLOATING_MENU_ATTR, isEditableTarget } from './escapeGuard';

afterEach(() => {
    document.body.innerHTML = '';
});

function mount(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
}

describe('Esc dentro de la ficha', () => {
    it('con el foco en un campo, Esc sale del campo (no cierra la ficha)', () => {
        const root = mount('<input id="t" type="text" /><textarea id="a"></textarea><div contenteditable="true"><p id="p">x</p></div>');
        expect(escapeIntent(root.querySelector('#t'), root)).toBe('field');
        expect(escapeIntent(root.querySelector('#a'), root)).toBe('field');
        // Dentro del editor de la descripción (ProseMirror).
        expect(escapeIntent(root.querySelector('#p'), root)).toBe('field');
    });

    it('con un menú propio abierto (el «/» del editor), Esc es del menú', () => {
        const root = mount(`<div contenteditable="true"><p id="p">/</p></div><div ${FLOATING_MENU_ATTR}></div>`);
        expect(escapeIntent(root.querySelector('#p'), root)).toBe('menu');
    });

    it('con el foco afuera (o en un botón / casilla), Esc es para cerrar', () => {
        const root = mount('<button id="b">x</button><input id="c" type="checkbox" />');
        expect(escapeIntent(root.querySelector('#b'), root)).toBe('close');
        expect(escapeIntent(root.querySelector('#c'), root)).toBe('close');
        expect(escapeIntent(document.body, root)).toBe('close');
        expect(isEditableTarget(null)).toBe(false);
    });
});
