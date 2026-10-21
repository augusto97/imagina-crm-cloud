import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RecordEntity } from '@/types/record';

/**
 * Borrador de una ficha con botón «Guardar» (modal del registro y página
 * clásica).
 *
 * Antes la ficha copiaba TODOS los valores al abrir y los comparaba contra esa
 * foto: si otra persona (o una automatización, o el autoguardado de la
 * descripción) cambiaba el registro mientras estaba abierto, el formulario
 * quedaba "con cambios" que nadie hizo, y Guardar devolvía el registro a los
 * valores viejos — o directamente borraba lo que se estaba escribiendo.
 *
 * Ahora se guarda SÓLO lo que la persona tocó (`edits`, por slug): lo demás
 * se lee siempre del servidor, así un cambio externo se ve al instante y
 * Guardar manda únicamente los campos editados.
 */

type Values = Record<string, unknown>;

/** Vacío es vacío: `''`, `[]` y `null` no cuentan como cambio entre sí. */
function norm(v: unknown): unknown {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return null;
    return v;
}

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Las ediciones tras un cambio del formulario (`next` = valores completos). */
export function applyDraftChange(base: Values, edits: Values, next: Values): Values {
    const current = { ...base, ...edits };
    const out: Values = { ...edits };
    for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
        if (same(current[key], next[key])) continue;
        // Volver al valor del servidor deja de ser una edición.
        if (same(base[key], next[key])) delete out[key];
        else out[key] = next[key];
    }
    return out;
}

/** Lo que hay que mandar: las ediciones que difieren del servidor. */
export function draftPatch(base: Values, edits: Values): Values {
    const patch: Values = {};
    for (const [k, v] of Object.entries(edits)) {
        if (!same(base[k], v)) patch[k] = v;
    }
    return patch;
}

/** Ediciones que siguen pendientes tras guardar `sent` (lo tipeado durante el guardado queda). */
export function editsAfterSave(edits: Values, sent: Values): Values {
    const out: Values = {};
    for (const [k, v] of Object.entries(edits)) {
        if (!(k in sent) || !same(sent[k], v)) out[k] = v;
    }
    return out;
}

export function recordServerValues(record: RecordEntity | null | undefined): Values {
    if (!record) return {};
    return { ...record.fields, ...record.relations };
}

export interface RecordDraft {
    values: Values;
    setValues: (next: Values | ((current: Values) => Values)) => void;
    dirty: boolean;
    /** Sólo los campos tocados que difieren del servidor. */
    patch: () => Values;
    /** Marca como guardado lo enviado; `saved` = el registro que devolvió el servidor. */
    markSaved: (sent: Values, saved: RecordEntity | null) => void;
    /** Descarta todo lo editado. */
    reset: () => void;
}

export function useRecordDraft(record: RecordEntity | null | undefined): RecordDraft {
    const server = useMemo(() => recordServerValues(record), [record]);
    const [edits, setEdits] = useState<Values>({});
    /**
     * Lo que devolvió el último guardado, hasta que llegue el registro fresco:
     * evita que el campo "parpadee" al valor viejo entre la respuesta y el
     * refetch.
     */
    const [overlay, setOverlay] = useState<Values>({});
    const recordId = record?.id;

    useEffect(() => {
        setEdits({});
        setOverlay({});
    }, [recordId]);

    const lastServer = useRef(server);
    useEffect(() => {
        if (lastServer.current === server) return;
        lastServer.current = server;
        setOverlay({});
    }, [server]);

    const base = useMemo(() => ({ ...server, ...overlay }), [server, overlay]);
    const values = useMemo(() => ({ ...base, ...edits }), [base, edits]);
    const valuesRef = useRef(values);
    valuesRef.current = values;
    const baseRef = useRef(base);
    baseRef.current = base;

    const setValues = useCallback((next: Values | ((current: Values) => Values)) => {
        const resolved = typeof next === 'function' ? next(valuesRef.current) : next;
        setEdits((e) => applyDraftChange(baseRef.current, e, resolved));
    }, []);

    const dirty = Object.keys(draftPatch(base, edits)).length > 0;

    const patch = useCallback(() => draftPatch(baseRef.current, edits), [edits]);

    const markSaved = useCallback((sent: Values, saved: RecordEntity | null) => {
        if (saved) {
            const fresh = recordServerValues(saved);
            setOverlay((o) => {
                const out = { ...o };
                for (const k of Object.keys(sent)) if (k in fresh) out[k] = fresh[k];
                return out;
            });
        }
        setEdits((e) => editsAfterSave(e, sent));
    }, []);

    const reset = useCallback(() => setEdits({}), []);

    return { values, setValues, dirty, patch, markSaved, reset };
}
