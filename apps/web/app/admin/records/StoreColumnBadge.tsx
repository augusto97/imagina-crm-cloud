import { createContext, useContext } from 'react';
import type { ManagedFieldLock } from '@imagina-base/shared';
import { ArrowLeftRight, Lock, PencilLine } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';

import { useManagedFields } from './managedFields';
import { mirrorSourceOf, storeColumnKind, useStoreRules } from './storeRules';

/**
 * v0.1.383 — La lista está dedicada a una sincronización de cobros (la lista
 * importada de Mercado Pago o la del registro de cobros): ahí también se marcan
 * las columnas propias, para que se vea que nunca viajan al proveedor.
 */
export const PaymentSyncListContext = createContext(false);

/**
 * Marca del encabezado de una columna en una lista de tienda (v0.1.213): de
 * un vistazo se sabe qué viene de WooCommerce (candado), qué se puede
 * cambiar y viaja a la tienda (flechas) y qué es sólo de la empresa (lápiz).
 * Fuera de una lista de tienda no dibuja nada.
 */
export function StoreColumnBadge({ fieldId }: { fieldId: number }): JSX.Element | null {
    const rules = useStoreRules();
    const kind = storeColumnKind(rules, fieldId);
    const managed = useManagedFields();
    const paymentSync = useContext(PaymentSyncListContext);
    if (kind === null) {
        // v0.1.383 — una columna que escribe una sincronización (cobros,
        // suscripciones, registro de cobros, SLA) lleva su candado con el motivo.
        const lock = managed?.get(fieldId);
        const cls = 'imcrm-h-3 imcrm-w-3 imcrm-shrink-0';
        if (lock) {
            return (
                <span title={__(lock.reason)} data-testid="managed-col-locked" className="imcrm-text-muted-foreground/70">
                    <Lock className={cls} aria-label={__('La escribe una sincronización')} />
                </span>
            );
        }
        if (paymentSync) {
            return (
                <span title={__('Columna propia: sólo vive en esta app y nunca se envía a Mercado Pago ni a PayPal.')} data-testid="managed-col-own" className="imcrm-text-emerald-600 dark:imcrm-text-emerald-400">
                    <PencilLine className={cls} aria-label={__('Columna propia')} />
                </span>
            );
        }
        return null;
    }
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

/**
 * v0.1.383 — Aviso en los editores de una columna que escribe una sincronización
 * (cobros, suscripciones, registro de cobros, SLA): se le cambia el nombre y la
 * descripción; el tipo y la configuración los necesita la sincronización tal cual.
 */
export function ManagedFieldNote({ lock }: { lock: ManagedFieldLock }): JSX.Element {
    return (
        <div
            className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-2.5 imcrm-text-xs imcrm-text-muted-foreground"
            data-testid="managed-field-note"
        >
            <Lock className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <p>{__(lock.reason)}</p>
                <p>{__('Puedes cambiarle el nombre y la descripción; el tipo y su configuración los necesita la sincronización tal cual.')}</p>
                {lock.free_hint && <p>{__(lock.free_hint)}</p>}
            </div>
        </div>
    );
}
