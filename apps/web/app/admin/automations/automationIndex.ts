import { folderKey } from '@imagina-base/shared';

import { foldText } from '@/lib/folderSections';
import type { AutomationEntity } from '@/types/automation';

/**
 * v0.1.411 — Lo que decide qué se ve en el índice de automatizaciones de una
 * lista: filtro por estado, búsqueda, orden y secciones (por carpeta o por
 * disparador). Puro, para probarlo sin montar la página.
 */

export type AutomationStatusFilter = 'all' | 'active' | 'paused' | 'failed';
export type AutomationGroupBy = 'folder' | 'trigger' | 'none';
export type AutomationSortBy = 'name' | 'recent' | 'updated' | 'last_run';

export const AUTOMATION_GROUP_BY: readonly AutomationGroupBy[] = ['folder', 'trigger', 'none'];
export const AUTOMATION_SORT_BY: readonly AutomationSortBy[] = ['name', 'recent', 'updated', 'last_run'];

/** La última corrida falló (lo que la página marca en rojo). */
export function lastRunFailed(a: AutomationEntity): boolean {
    return a.last_run?.status === 'failed';
}

export function matchesStatus(a: AutomationEntity, filter: AutomationStatusFilter): boolean {
    switch (filter) {
        case 'active':
            return a.is_active;
        case 'paused':
            return !a.is_active;
        case 'failed':
            return lastRunFailed(a);
        default:
            return true;
    }
}

export function statusCounts(list: readonly AutomationEntity[]): Record<AutomationStatusFilter, number> {
    let active = 0;
    let failed = 0;
    for (const a of list) {
        if (a.is_active) active++;
        if (lastRunFailed(a)) failed++;
    }
    return { all: list.length, active, paused: list.length - active, failed };
}

/**
 * Busca por nombre, descripción, carpeta y lo que hace (el resumen del
 * disparador y las acciones que arma la página), sin tildes ni mayúsculas.
 * Varias palabras: tienen que estar todas.
 */
export function matchesAutomationQuery(a: AutomationEntity, query: string, summary = ''): boolean {
    const words = foldText(query).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    const haystack = foldText([a.name, a.description ?? '', a.folder ?? '', summary].join(' '));
    return words.every((w) => haystack.includes(w));
}

function time(value: string | null | undefined): number {
    if (!value) return 0;
    const t = Date.parse(value.includes('T') || value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isNaN(t) ? 0 : t;
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export function sortAutomations(list: readonly AutomationEntity[], by: AutomationSortBy): AutomationEntity[] {
    const out = [...list];
    const byName = (x: AutomationEntity, y: AutomationEntity): number => collator.compare(x.name, y.name) || x.id - y.id;
    switch (by) {
        case 'recent':
            return out.sort((x, y) => time(y.created_at) - time(x.created_at) || y.id - x.id);
        case 'updated':
            return out.sort((x, y) => time(y.updated_at) - time(x.updated_at) || y.id - x.id);
        case 'last_run':
            // Las que nunca corrieron van al final, por nombre.
            return out.sort((x, y) => {
                const tx = time(x.last_run?.at);
                const ty = time(y.last_run?.at);
                if (tx === 0 && ty === 0) return byName(x, y);
                if (tx === 0) return 1;
                if (ty === 0) return -1;
                return ty - tx || byName(x, y);
            });
        default:
            return out.sort(byName);
    }
}

export interface AutomationSection {
    /** `folder:<clave>`, `none`, `trigger:<slug>` o `all`. */
    key: string;
    kind: 'folder' | 'none' | 'trigger' | 'all';
    /** Nombre de la carpeta (como se guardó) o el slug del disparador. */
    name: string;
    items: AutomationEntity[];
}

export const NO_FOLDER_KEY = 'none';

export function folderSectionKey(name: string): string {
    return `folder:${folderKey(name)}`;
}

/**
 * Arma las secciones en el orden en que se muestran. Por carpeta: las
 * carpetas en su orden guardado y «Sin carpeta» al final; las carpetas vacías
 * sólo si `showEmpty` (sin filtro ni búsqueda: con filtro, una carpeta vacía
 * es ruido). Por disparador: en el orden en que aparece cada uno en `items`
 * (que ya viene ordenado). Sin agrupar: una sola sección.
 */
export function groupAutomations(
    items: readonly AutomationEntity[],
    by: AutomationGroupBy,
    folders: readonly string[],
    showEmpty: boolean,
): AutomationSection[] {
    if (by === 'none') return [{ key: 'all', kind: 'all', name: '', items: [...items] }];

    if (by === 'trigger') {
        const map = new Map<string, AutomationSection>();
        for (const a of items) {
            const key = `trigger:${a.trigger_type}`;
            let s = map.get(key);
            if (!s) {
                s = { key, kind: 'trigger', name: a.trigger_type, items: [] };
                map.set(key, s);
            }
            s.items.push(a);
        }
        return [...map.values()];
    }

    const sections: AutomationSection[] = [];
    const byKey = new Map<string, AutomationSection>();
    for (const name of folders) {
        const key = folderSectionKey(name);
        if (byKey.has(key)) continue;
        const s: AutomationSection = { key, kind: 'folder', name, items: [] };
        byKey.set(key, s);
        sections.push(s);
    }
    const loose: AutomationSection = { key: NO_FOLDER_KEY, kind: 'none', name: '', items: [] };
    for (const a of items) {
        const folder = a.folder?.trim() ?? '';
        if (folder === '') {
            loose.items.push(a);
            continue;
        }
        const key = folderSectionKey(folder);
        let s = byKey.get(key);
        if (!s) {
            // Una carpeta que la lista de carpetas no tenía (otra pestaña la creó recién).
            s = { key, kind: 'folder', name: folder, items: [] };
            byKey.set(key, s);
            sections.push(s);
        }
        s.items.push(a);
    }
    const out = sections.filter((s) => showEmpty || s.items.length > 0);
    if (loose.items.length > 0) out.push(loose);
    return out;
}

/** Cuántas están activas en una sección (para el «3 · 2 activas» del encabezado). */
export function activeCount(items: readonly AutomationEntity[]): number {
    return items.reduce((n, a) => n + (a.is_active ? 1 : 0), 0);
}

/** Cambia de lugar una carpeta (subir/bajar en su menú). */
export function moveFolder(folders: readonly string[], name: string, delta: -1 | 1): string[] {
    const out = [...folders];
    const i = out.findIndex((f) => folderKey(f) === folderKey(name));
    const j = i + delta;
    if (i < 0 || j < 0 || j >= out.length) return out;
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
}
