// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createHScrollGroup } from './hscrollGroup';

/**
 * jsdom no dispara `scroll` al asignar scrollLeft, así que el test simula
 * al navegador: asigna el valor y despacha el evento. Eso permite
 * reproducir EXACTAMENTE el eco tardío del táctil (v0.1.194): el evento
 * del elemento copiado llega cuando el original ya se movió más.
 */
function scroller(): HTMLDivElement {
    const el = document.createElement('div');
    el.scrollLeft = 0;
    return el;
}
const fire = (el: HTMLElement): void => {
    el.dispatchEvent(new Event('scroll'));
};
const userScroll = (el: HTMLElement, x: number): void => {
    el.scrollLeft = x;
    fire(el);
};

describe('createHScrollGroup', () => {
    it('copia el scroll genuino de un miembro a todos los demás', () => {
        const g = createHScrollGroup();
        const a = scroller();
        const b = scroller();
        const c = scroller();
        g.add(a);
        g.add(b);
        g.add(c);
        userScroll(a, 100);
        expect(b.scrollLeft).toBe(100);
        expect(c.scrollLeft).toBe(100);
        userScroll(c, 40);
        expect(a.scrollLeft).toBe(40);
        expect(b.scrollLeft).toBe(40);
    });

    it('el eco de una copia NO vuelve a escribir sobre el que se está arrastrando', () => {
        const g = createHScrollGroup();
        const a = scroller();
        const b = scroller();
        g.add(a);
        g.add(b);
        userScroll(a, 100); // b ← 100
        a.scrollLeft = 105; // el dedo siguió antes de que b avise
        fire(b); // eco tardío de b, con el valor viejo (100)
        expect(a.scrollLeft).toBe(105); // antes: volvía a 100 → "pelea" con el dedo
        fire(a); // el propio evento de a por el 105
        expect(b.scrollLeft).toBe(105);
    });

    it('un scroll genuino posterior en el miembro copiado sí se propaga', () => {
        const g = createHScrollGroup();
        const a = scroller();
        const b = scroller();
        g.add(a);
        g.add(b);
        userScroll(a, 100);
        fire(b); // eco ignorado
        userScroll(b, 130); // ahora la persona arrastra b
        expect(a.scrollLeft).toBe(130);
        fire(a); // eco de a
        expect(b.scrollLeft).toBe(130);
    });

    it('el que entra se alinea con el grupo y el que sale deja de recibir copias', () => {
        const g = createHScrollGroup();
        const a = scroller();
        const b = scroller();
        g.add(a);
        userScroll(a, 60);
        const offB = g.add(b);
        expect(b.scrollLeft).toBe(60);
        expect(g.members()).toEqual([a, b]);
        offB();
        userScroll(a, 90);
        expect(b.scrollLeft).toBe(60);
        expect(g.members()).toEqual([a]);
    });
});
