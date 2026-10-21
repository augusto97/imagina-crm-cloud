import { applyDocumentTitle } from '@/lib/favicon';

/**
 * v0.1.286 — título de la pestaña POR PANTALLA ("Clientes — Acme").
 *
 * Dos fuentes escriben el título y no se pisan: la marca del tenant
 * (`useBranding` → nombre de la app) y la ruta (`RouteTracker` → la lista,
 * el registro, el tablero o la sección de ajustes). Este módulo guarda las
 * dos partes y siempre pinta la combinación con `applyDocumentTitle`.
 */
let appName: string | null = null;
let section: string | null = null;

function paint(): void {
    if (typeof document === 'undefined') return;
    applyDocumentTitle(appName, section);
}

export function setTitleAppName(name: string | null): void {
    appName = name;
    paint();
}

export function setTitleSection(next: string | null): void {
    section = next;
    paint();
}
