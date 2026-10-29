import { ArrowLeftRight, Lock, PencilLine } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';

import { mirrorSourceOf, storeColumnKind, useStoreRules } from './storeRules';

/**
 * Marca del encabezado de una columna en una lista de tienda (v0.1.213): de
 * un vistazo se sabe qué viene de WooCommerce (candado), qué se puede
 * cambiar y viaja a la tienda (flechas) y qué es sólo de la empresa (lápiz).
 * Fuera de una lista de tienda no dibuja nada.
 */
export function StoreColumnBadge({ fieldId }: { fieldId: number }): JSX.Element | null {
    const rules = useStoreRules();
    const kind = storeColumnKind(rules, fieldId);
    if (kind === null) return null;
    // v0.1.333 — la misma marca para un sitio WordPress.
    const source = mirrorSourceOf(rules) ?? 'WooCommerce';
    const cls = 'imcrm-h-3 imcrm-w-3 imcrm-shrink-0';
    if (kind === 'store_locked') {
        return (
            <span title={sprintf(__('Viene de %s: se edita allá.'), source)} data-testid="store-col-locked" className="imcrm-text-muted-foreground/70">
                <Lock className={cls} aria-label={__('Sólo lectura')} />
            </span>
        );
    }
    if (kind === 'store_sync') {
        return (
            <span title={sprintf(__('Se puede cambiar desde aquí: el cambio viaja a %s.'), source)} data-testid="store-col-sync" className="imcrm-text-primary">
                <ArrowLeftRight className={cls} aria-label={sprintf(__('Se envía a %s'), source)} />
            </span>
        );
    }
    return (
        <span title={sprintf(__('Columna propia: sólo vive en esta app y nunca viaja a %s.'), source)} data-testid="store-col-own" className="imcrm-text-emerald-600 dark:imcrm-text-emerald-400">
            <PencilLine className={cls} aria-label={__('Columna propia')} />
        </span>
    );
}

/**
 * Aviso en los editores de un campo que viene de la tienda: sólo se le cambia
 * el nombre (y la descripción). El tipo, las opciones y "obligatorio" los
 * define WooCommerce, y la próxima sincronización los necesita tal cual.
 */
export function StoreFieldNote(): JSX.Element {
    const source = mirrorSourceOf(useStoreRules()) ?? 'WooCommerce';
    const where = source === 'WordPress' ? __('el sitio') : __('la tienda');
    return (
        <p
            className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-2.5 imcrm-text-xs imcrm-text-muted-foreground"
            data-testid="store-field-note"
        >
            <Lock className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
            {sprintf(__('Esta columna viene de %1$s: puedes cambiarle el nombre, pero el tipo y su configuración los define %2$s. No se puede borrar mientras la lista esté sincronizada.'), source, where)}
        </p>
    );
}
