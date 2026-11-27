import { useMemo } from 'react';

import { readListFeatures, type ListFeatures } from '@imagina-base/shared';

import { useList } from './useLists';

/**
 * v0.1.475 — Las funciones que usa una lista («Funciones de la lista»:
 * descripción, resumen con IA, subtareas, checklists, dependencias, tiempo
 * registrado y aviso de duplicados). `null` mientras la lista no llegó: quien
 * pregunta decide si espera o dibuja como siempre. Lo normal es que la lista
 * ya esté en el índice (`useList` la toma de ahí sin pedir nada).
 */
export function useListFeatures(listKey: string | number | undefined): ListFeatures | null {
    const list = useList(listKey);
    const settings = list.data?.settings;
    return useMemo(() => (settings ? readListFeatures(settings) : null), [settings]);
}

/** ¿La función está apagada? (sólo `true` cuando se sabe: mientras carga, no). */
export function useListFeatureOff(listKey: string | number | undefined, key: keyof ListFeatures): boolean {
    const f = useListFeatures(listKey);
    return f !== null && !f[key];
}
