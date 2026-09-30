/**
 * v0.1.194 — grupo de scrollers HORIZONTALES sincronizados (cuerpo de la
 * tabla, su cabecera partida, los cuerpos y cabeceras de cada grupo de la
 * vista agrupada y la barra espejo del fondo): un scroll GENUINO en
 * cualquiera se copia al resto.
 *
 * La clave es distinguir el scroll del usuario del ECO de una copia. El
 * enfoque anterior ("asignar el mismo valor no re-dispara el evento, así
 * que no hay loop") era falso en táctil: el evento `scroll` del elemento
 * copiado llega UN CUADRO DESPUÉS, y para entonces el dedo ya movió al
 * original unos px más — el eco traía el valor viejo y lo escribía de
 * vuelta sobre el scroller que la persona está arrastrando. Resultado: el
 * scroll "pelea" contra el dedo (avanza poco, se ve a saltos), y en la
 * agrupada, con N cuerpos + N cabeceras + la barra espejo devolviendo ecos,
 * era todavía peor.
 *
 * Acá cada escritura programática se RECUERDA (`written`): si el evento de
 * un miembro llega con exactamente el valor que le escribimos, es el eco y
 * se ignora; si trae otro valor, lo movió la persona (o el navegador — un
 * `scrollIntoView` por foco cuenta como genuino) y se propaga. El valor
 * recordado se lee DESPUÉS de asignar, por si el navegador lo recortó al
 * máximo del elemento.
 */
export interface HScrollGroup {
    /** Suma un scroller; devuelve la función para sacarlo. */
    add(el: HTMLElement): () => void;
    /** Miembros vivos, en orden de alta. */
    members(): HTMLElement[];
}

export function createHScrollGroup(): HScrollGroup {
    const els = new Set<HTMLElement>();
    const written = new WeakMap<HTMLElement, number>();
    // Posición actual del grupo. v0.1.224 — al sumar un miembro se LEÍA el
    // `scrollLeft` de otro, y leerlo (o escribirlo) obliga al navegador a
    // recalcular el layout de toda la página en el acto: con 14 grupos
    // montándose tras una búsqueda eran 14 layouts forzados seguidos (lo más
    // caro del perfil). Con la posición recordada, en el caso común (nadie
    // scrolleó en horizontal) el alta no toca el layout.
    let current = 0;

    const write = (el: HTMLElement, x: number): void => {
        if (el.scrollLeft === x) return;
        el.scrollLeft = x;
        written.set(el, el.scrollLeft);
    };
    const broadcast = (from: HTMLElement): void => {
        const x = from.scrollLeft;
        current = x;
        for (const el of els) if (el !== from) write(el, x);
    };

    return {
        add(el) {
            els.add(el);
            // Al entrar se alinea con lo que ya está scrolleado.
            if (current !== 0) write(el, current);
            const onScroll = (): void => {
                const w = written.get(el);
                if (w !== undefined && el.scrollLeft === w) return; // eco de una copia
                written.delete(el);
                broadcast(el);
            };
            el.addEventListener('scroll', onScroll, { passive: true });
            return () => {
                els.delete(el);
                el.removeEventListener('scroll', onScroll);
            };
        },
        members: () => Array.from(els),
    };
}
