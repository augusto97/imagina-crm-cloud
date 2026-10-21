import { useSyncExternalStore } from 'react';

/**
 * v0.1.286 — «Recientes» de la paleta (Ctrl+K): las últimas listas,
 * registros y tableros abiertos, por empresa y por navegador (localStorage).
 * Es una comodidad: si el storage está bloqueado, simplemente no hay.
 */
export type RecentKind = 'list' | 'record' | 'dashboard';

export interface RecentItem {
    kind: RecentKind;
    id: number;
    label: string;
    href: string;
    /** Registros: el nombre de su lista. */
    context?: string | null;
    icon?: string | null;
    color?: string | null;
    /** El label es un respaldo ("Registro #12"): uno real lo reemplaza. */
    fallback?: boolean;
    ts: number;
}

export const RECENTS_MAX = 8;

const keyFor = (tenantId: number): string => `imcrm:recents:${tenantId}`;

/**
 * Agrega (o sube al principio) un item. Puro, para testear: dedupe por
 * tipo+id, tope de `RECENTS_MAX`, y un label de respaldo nunca pisa uno real
 * (abrir un registro desde la URL no siempre sabe su título; desde la
 * búsqueda sí).
 */
export function mergeRecent(list: readonly RecentItem[], item: RecentItem): RecentItem[] {
    const prev = list.find((r) => r.kind === item.kind && r.id === item.id);
    const keepLabel = prev !== undefined && item.fallback === true && prev.fallback !== true;
    const merged: RecentItem = keepLabel
        ? { ...item, label: prev.label, context: item.context ?? prev.context, fallback: false }
        : item;
    return [merged, ...list.filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, RECENTS_MAX);
}

function parse(raw: string | null): RecentItem[] {
    try {
        const v: unknown = raw === null ? [] : JSON.parse(raw);
        if (!Array.isArray(v)) return [];
        return v.filter(
            (r): r is RecentItem =>
                typeof r === 'object' &&
                r !== null &&
                ((r as RecentItem).kind === 'list' ||
                    (r as RecentItem).kind === 'record' ||
                    (r as RecentItem).kind === 'dashboard') &&
                typeof (r as RecentItem).id === 'number' &&
                typeof (r as RecentItem).label === 'string' &&
                typeof (r as RecentItem).href === 'string',
        );
    } catch {
        return [];
    }
}

const listeners = new Set<() => void>();
const snapshots = new Map<number, { raw: string | null; items: RecentItem[] }>();

function read(tenantId: number): RecentItem[] {
    let raw: string | null = null;
    try {
        raw = window.localStorage.getItem(keyFor(tenantId));
    } catch {
        raw = null;
    }
    const cached = snapshots.get(tenantId);
    if (cached && cached.raw === raw) return cached.items;
    const items = parse(raw);
    snapshots.set(tenantId, { raw, items });
    return items;
}

export function pushRecent(tenantId: number | null, item: Omit<RecentItem, 'ts'>): void {
    if (tenantId === null) return;
    const current = read(tenantId);
    const head = current[0];
    // Re-navegar al mismo item (cambiar de vista, filtros) no reescribe nada.
    if (
        head &&
        head.kind === item.kind &&
        head.id === item.id &&
        head.href === item.href &&
        (item.fallback === true || head.label === item.label)
    ) {
        return;
    }
    const next = mergeRecent(current, { ...item, ts: Date.now() });
    try {
        window.localStorage.setItem(keyFor(tenantId), JSON.stringify(next));
    } catch {
        return;
    }
    for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

const EMPTY: RecentItem[] = [];

export function useRecents(tenantId: number | null): RecentItem[] {
    return useSyncExternalStore(
        subscribe,
        () => (tenantId === null ? EMPTY : read(tenantId)),
        () => EMPTY,
    );
}
