import { describe, expect, it } from 'vitest';
import { SHOP_CSS } from '../src/shop/shop-page';

/**
 * v0.1.424 — Dos cosas distintas con el mismo nombre de clase se pisan sin
 * avisar: así se rompió la casilla de los términos (la regla del cuadrito de
 * las tareas de la descripción también se llamaba `.s-check` y dejaba la
 * etiqueta en 17 px) y casi se rompe el resumen del carrito con la descripción
 * corta de las tarjetas. Una clase se define UNA vez a nivel raíz: los ajustes
 * van dentro de un @media o con un selector más específico.
 */
function rootRules(css: string): string[] {
    let out = '';
    let depth = 0;
    let atBlock = 0;
    let buf = '';
    for (const ch of css) {
        if (ch === '{') {
            if (depth === 0 && buf.trim().startsWith('@')) atBlock = 1;
            if (depth === 0 && !atBlock) out += `${buf.trim()}\n`;
            depth += 1;
            buf = '';
            continue;
        }
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) atBlock = 0;
            buf = '';
            continue;
        }
        buf += ch;
    }
    return out.split('\n').filter(Boolean);
}

describe('v0.1.424 — el CSS de la tienda no repite clases', () => {
    it('la regla base de cada clase está una sola vez fuera de los @media', () => {
        const seen = new Map<string, number>();
        // Sólo la regla «base» de cada clase (la clase sola); una lista de
        // selectores (`h1,.s-title{…}`) es un ajuste compartido, no la base.
        for (const sel of rootRules(SHOP_CSS)) {
            if (/^\.s-[a-z0-9-]+$/.test(sel)) seen.set(sel, (seen.get(sel) ?? 0) + 1);
        }
        const repeated = [...seen].filter(([, n]) => n > 1).map(([s]) => s);
        expect(repeated).toEqual([]);
        // Las que se pisaron de verdad.
        expect(seen.get('.s-check')).toBe(1);
        expect(seen.get('.s-task-box')).toBe(1);
        expect(seen.get('.s-sum')).toBe(1);
        expect(seen.get('.s-card-sum')).toBe(1);
    });

    it('la etiqueta de los términos no tiene ancho fijo', () => {
        const rule = /(^|[}\n])\.s-check\{([^}]*)\}/.exec(SHOP_CSS)?.[2] ?? '';
        expect(rule).not.toMatch(/(^|;)width:/);
        expect(rule).toContain('display:flex');
    });
});
