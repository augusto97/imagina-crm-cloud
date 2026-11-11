import { lazyDialog } from '@/lib/lazyDialog';

/**
 * «Nueva lista» a pedido: trae la galería de plantillas, el duplicado y el
 * alta desde un archivo, y se abre de vez en cuando — no viaja con el menú.
 */
export const ListCreateDialog = lazyDialog(() =>
    import('./ListCreateDialog').then((m) => ({ default: m.ListCreateDialog })),
);
