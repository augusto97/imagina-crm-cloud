import { ArrowLeftRight, Lock, PencilLine } from 'lucide-react';

import { __ } from '@/lib/i18n';

import { storeColumnKind, useStoreRules } from './storeRules';

/**
 * Marca del encabezado de una columna en una lista de tienda (v0.1.213): de
 * un vistazo se sabe qué viene de WooCommerce (candado), qué se puede
 * cambiar y viaja a la tienda (flechas) y qué es sólo de la empresa (lápiz).
 * Fuera de una lista de tienda no dibuja nada.
 */
export function StoreColumnBadge({ fieldId }: { fieldId: number }): JSX.Element | null {
    const kind = storeColumnKind(useStoreRules(), fieldId);
    if (kind === null) return null;
    const cls = 'imcrm-h-3 imcrm-w-3 imcrm-shrink-0';
    if (kind === 'store_locked') {
        return (
            <span title={__('Viene de WooCommerce: se edita allá.')} data-testid="store-col-locked" className="imcrm-text-muted-foreground/70">
                <Lock className={cls} aria-label={__('Sólo lectura')} />
            </span>
        );
    }
    if (kind === 'store_sync') {
        return (
            <span title={__('Se puede cambiar desde aquí: el cambio viaja a WooCommerce.')} data-testid="store-col-sync" className="imcrm-text-primary">
                <ArrowLeftRight className={cls} aria-label={__('Se envía a WooCommerce')} />
            </span>
        );
    }
    return (
        <span title={__('Columna sólo de Imagina: nunca viaja a WooCommerce.')} data-testid="store-col-own" className="imcrm-text-emerald-600 dark:imcrm-text-emerald-400">
            <PencilLine className={cls} aria-label={__('Sólo en Imagina')} />
        </span>
    );
}

/**
 * Aviso en los editores de un campo que viene de la tienda: sólo se le cambia
 * el nombre (y la descripción). El tipo, las opciones y "obligatorio" los
 * define WooCommerce, y la próxima sincronización los necesita tal cual.
 */
export function StoreFieldNote(): JSX.Element {
    return (
        <p
            className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-2.5 imcrm-text-xs imcrm-text-muted-foreground"
            data-testid="store-field-note"
        >
            <Lock className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
            {__('Esta columna viene de WooCommerce: puedes cambiarle el nombre, pero el tipo y su configuración los define la tienda. No se puede borrar mientras la lista esté sincronizada.')}
        </p>
    );
}
