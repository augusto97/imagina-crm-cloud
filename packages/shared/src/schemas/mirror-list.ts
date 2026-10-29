import { siteCellAccess, siteFieldKey, siteValueError } from './site-rules';
import { readSiteListMarker, type SiteListMarker } from './site-sync';
import {
    storeCellAccess,
    storeEditableSlugs,
    storeFieldSlug,
    storeValueError,
    type StoreCellAccess,
    type StoreRowGetter,
} from './store-rules';
import { readStoreListMarker, type StoreListMarker } from './store-sync';

/**
 * Listas ESPEJO (v0.1.333, ADR-S83): una lista que mantiene una fuente de
 * afuera —una tienda WooCommerce (ADR-S24) o un sitio WordPress (ADR-S83)—.
 *
 * Las dos comparten las reglas de fondo: los registros se crean y se borran
 * en la fuente, sus columnas son de sólo lectura salvo las que la empresa
 * habilitó, y las columnas propias son libres. Lo que cambia es QUÉ acepta
 * cada fuente, y eso lo decide su propio módulo (`store-rules`, `site-rules`).
 * Este archivo es la única puerta para todo lo genérico (crear, borrar,
 * importar, candados de celdas, el administrador de campos): así un camino
 * nuevo que pregunte «¿esta lista la manda otra cosa?» cubre las dos sin
 * acordarse de cada una.
 */
export type MirrorListMarker =
    | { source: 'store'; marker: StoreListMarker }
    | { source: 'site'; marker: SiteListMarker };

export function readMirrorListMarker(settings: unknown): MirrorListMarker | null {
    const store = readStoreListMarker(settings);
    if (store) return { source: 'store', marker: store };
    const site = readSiteListMarker(settings);
    if (site) return { source: 'site', marker: site };
    return null;
}

/** «WooCommerce» o «WordPress»: el nombre de la fuente en los mensajes. */
export function mirrorSourceName(m: MirrorListMarker): string {
    return m.source === 'store' ? 'WooCommerce' : 'WordPress';
}

/** El nombre de la tienda o del sitio («la tienda Demo», «el sitio Mi blog»). */
export function mirrorPlaceName(m: MirrorListMarker): string {
    if (m.source === 'store') return m.marker.store_name ? `la tienda ${m.marker.store_name}` : 'la tienda';
    return m.marker.site_name ? `el sitio ${m.marker.site_name}` : 'el sitio';
}

/** «de la tienda Demo» / «del sitio Mi blog» (para «viene …»: «de el» no existe en castellano). */
export function mirrorFromPlace(m: MirrorListMarker): string {
    if (m.source === 'store') return `de ${mirrorPlaceName(m)}`;
    return m.marker.site_name ? `del sitio ${m.marker.site_name}` : 'del sitio';
}

/** clave de la fuente → id del campo (las columnas que vienen de afuera). */
export function mirrorFieldMap(m: MirrorListMarker): Record<string, number> {
    return m.marker.fields;
}

/** La clave de la columna en la fuente, o null si es una columna propia. */
export function mirrorFieldKey(m: MirrorListMarker, fieldId: number): string | null {
    return m.source === 'store' ? storeFieldSlug(m.marker, fieldId) : siteFieldKey(m.marker, fieldId);
}

export function isMirrorField(m: MirrorListMarker, fieldId: number): boolean {
    return mirrorFieldKey(m, fieldId) !== null;
}

export function mirrorCellAccess(m: MirrorListMarker, fieldId: number, row: StoreRowGetter): StoreCellAccess {
    return m.source === 'store' ? storeCellAccess(m.marker, fieldId, row) : siteCellAccess(m.marker, fieldId, row);
}

export function mirrorValueError(m: MirrorListMarker, fieldId: number, value: unknown, row: StoreRowGetter): string | null {
    return m.source === 'store' ? storeValueError(m.marker, fieldId, value, row) : siteValueError(m.marker, fieldId, value, row);
}

/** «Editar desde la app» activado. */
export function mirrorWriteBack(m: MirrorListMarker): boolean {
    return m.marker.write_back;
}

/** Las columnas habilitadas para editar (claves de la fuente). */
export function mirrorEditableKeys(m: MirrorListMarker): readonly string[] {
    return m.source === 'store' ? storeEditableSlugs(m.marker) : m.marker.editable;
}

/**
 * Cómo se presenta una columna en el encabezado: `locked` (viene de la fuente
 * y no se edita aquí), `sync` (se puede cambiar y viaja) u `own` (propia).
 */
export function mirrorColumnKind(m: MirrorListMarker, fieldId: number): 'locked' | 'sync' | 'own' {
    const key = mirrorFieldKey(m, fieldId);
    if (key === null) return 'own';
    if (m.source === 'site' && !m.marker.can_edit.includes(key)) return 'locked';
    return m.marker.write_back && mirrorEditableKeys(m).includes(key) ? 'sync' : 'locked';
}

/** Dónde se configura la fuente (la página de la tienda o del sitio). */
export function mirrorSettingsPath(m: MirrorListMarker): string {
    return m.source === 'store' ? `/settings/stores/${m.marker.connection_id}` : `/settings/sites/${m.marker.connection_id}`;
}
