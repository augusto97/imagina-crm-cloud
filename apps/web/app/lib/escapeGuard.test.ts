// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { escapeIntent, FLOATING_MENU_ATTR, isEditableTarget, recordNavDirection } from './escapeGuard';

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

describe('navegar registros con el teclado (modal)', () => {
    const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
        ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

    it('J y ↓ van al siguiente; K y ↑ al anterior', () => {
        expect(recordNavDirection(key('j'), document.body)).toBe(1);
        expect(recordNavDirection(key('ArrowDown'), document.body)).toBe(1);
        expect(recordNavDirection(key('K'), document.body)).toBe(-1);
        expect(recordNavDirection(key('ArrowUp'), document.body)).toBe(-1);
        expect(recordNavDirection(key('x'), document.body)).toBeNull();
    });

    it('nunca con modificadores ni con el foco en un campo', () => {
        const root = mount('<input id="t" type="text" /><textarea id="a"></textarea><select id="s"><option>1</option></select>');
        expect(recordNavDirection(key('ArrowDown', { ctrlKey: true }), document.body)).toBeNull();
        expect(recordNavDirection(key('ArrowDown', { shiftKey: true }), document.body)).toBeNull();
        expect(recordNavDirection(key('ArrowDown'), root.querySelector('#t'))).toBeNull();
        expect(recordNavDirection(key('ArrowUp'), root.querySelector('#a'))).toBeNull();
        expect(recordNavDirection(key('ArrowDown'), root.querySelector('#s'))).toBeNull();
        expect(recordNavDirection(key('j'), root.querySelector('#t'))).toBeNull();
    });

    it('las flechas no se roban de pestañas, menús o radios; J/K sí navegan desde ahí', () => {
        const root = mount('<div role="tablist"><button id="tab" role="tab">A</button></div><div role="radiogroup"><button id="r" role="radio">x</button></div><button id="b">ok</button>');
        expect(recordNavDirection(key('ArrowDown'), root.querySelector('#tab'))).toBeNull();
        expect(recordNavDirection(key('ArrowUp'), root.querySelector('#r'))).toBeNull();
        expect(recordNavDirection(key('j'), root.querySelector('#tab'))).toBe(1);
        expect(recordNavDirection(key('ArrowDown'), root.querySelector('#b'))).toBe(1);
    });
});
