/**
 * v0.1.470 — Reglas puras de la ventana flotante del registro: qué ficha
 * muestra, si va el panel de comentarios al costado y cuándo se le sugiere
 * a quien administra la lista que la pruebe como ficha diseñada.
 */

/** La lista usa la ficha diseñada (Apariencia → «Ficha diseñada»). */
export function usesDesignedLayout(settings: Record<string, unknown> | null | undefined): boolean {
    return (settings ?? {}).record_layout === 'crm';
}

interface BlockLike {
    type?: unknown;
}
interface LayoutLike {
    pages: ReadonlyArray<{ sections: ReadonlyArray<{ blocks: ReadonlyArray<ReadonlyArray<BlockLike>> }> }>;
}

/** ¿El diseño ya trae la conversación (un bloque de actividad o de comentarios)? */
export function layoutHasConversation(layout: LayoutLike | null | undefined): boolean {
    if (!layout) return false;
    return layout.pages.some((p) => p.sections.some((s) => s.blocks.some((col) => col.some((b) => b.type === 'activity' || b.type === 'comments'))));
}

/**
 * Qué acompaña al registro en la ventana:
 *  - `none`: la ficha diseñada ya trae la conversación (no hace falta repetirla);
 *  - `aside`: el panel colapsable de Comentarios / Actividad al costado;
 *  - `tabs`: en pantallas angostas, pestañas (Ficha o Detalles · Comentarios · Actividad).
 * Mientras no se sabe (el diseño todavía carga), `none`: sin un panel que aparezca y desaparezca.
 */
export function recordSidePanel(opts: { designed: boolean; hasConversation: boolean | null; narrow: boolean }): 'none' | 'aside' | 'tabs' {
    if (opts.designed && opts.hasConversation !== false) return 'none';
    return opts.narrow ? 'tabs' : 'aside';
}

export interface LayoutSuggestionInput {
    listId: number;
    settings: Record<string, unknown> | null | undefined;
    canManageLists: boolean;
    isGuest: boolean;
    impersonating: boolean;
    /** La lista es espejo de una tienda o un sitio (sus columnas las manda la fuente). */
    mirror: boolean;
    /** Las listas en las que la persona ya cerró la tarjeta (`null` = todavía no se sabe). */
    dismissed: readonly number[] | null;
}

/**
 * ¿Se le ofrece «Esta lista se puede ver como ficha»? Una vez por lista y
 * persona, a quien la administra, en una lista con la ficha simple. Nunca a
 * un invitado, impersonando ni en una lista espejo.
 */
export function shouldOfferDesignedLayout(i: LayoutSuggestionInput): boolean {
    if (!i.canManageLists || i.isGuest || i.impersonating || i.mirror) return false;
    if (usesDesignedLayout(i.settings)) return false;
    // Quien ya diseñó su ficha y volvió a la simple, ya eligió.
    if (hasOwnDesign(i.settings)) return false;
    if (i.dismissed === null) return false;
    return !i.dismissed.includes(i.listId);
}

/** El editor de la ficha con ESTE registro de muestra y la vuelta a donde se estaba. */
export function designRecordHref(listSlug: string, recordId: number, back: string): string {
    const q = new URLSearchParams({ record: String(recordId), back });
    return `/lists/${listSlug}/template-editor?${q.toString()}`;
}

/** La vuelta del editor: sólo una pantalla de la app (nunca otra dirección). */
export function safeDesignBack(back: string | null | undefined): string | null {
    if (typeof back !== 'string' || !back.startsWith('/lists/') || back.startsWith('//') || back.includes('\\')) return null;
    return back;
}

/** ¿La lista ya tiene un diseño propio (guardado o del editor anterior)? */
export function hasOwnDesign(settings: Record<string, unknown> | null | undefined): boolean {
    const s = settings ?? {};
    return (s.record_layout_v3 !== undefined && s.record_layout_v3 !== null) || s.crm_template_id === 'custom';
}

const OPEN_KEY = (listId: number): string => `imcrm-unplaced-open:${listId}`;

/**
 * «Otros campos» arranca como dice el diseño; si la persona la abrió o la
 * plegó a mano, se recuerda en este dispositivo para esa lista.
 */
export function readUnplacedOpenPref(listId: number, fallback: boolean): boolean {
    try {
        const v = window.localStorage.getItem(OPEN_KEY(listId));
        if (v === '1') return true;
        if (v === '0') return false;
    } catch {
        // sin localStorage, lo del diseño
    }
    return fallback;
}

export function writeUnplacedOpenPref(listId: number, open: boolean): void {
    try {
        window.localStorage.setItem(OPEN_KEY(listId), open ? '1' : '0');
    } catch {
        // sin localStorage, queda en memoria
    }
}
