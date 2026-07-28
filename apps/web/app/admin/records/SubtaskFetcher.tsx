import { useEffect } from 'react';

import { useRecords } from '@/hooks/useRecords';
import type { RecordEntity } from '@/types/record';

interface SubtaskFetcherProps {
    listId: number;
    parentId: number;
    onLoaded: (rows: RecordEntity[]) => void;
}

/**
 * Trae las subtareas de UN padre abierto (v0.1.132).
 *
 * No pinta nada: existe para poder usar `useRecords` por padre sin llamar
 * hooks dentro de un bucle en la tabla. El listado normal devuelve sólo el
 * primer nivel, así que los hijos se piden aparte con `?parent=`.
 */
export function SubtaskFetcher({ listId, parentId, onLoaded }: SubtaskFetcherProps): null {
    const q = useRecords(listId, { parent: parentId, per_page: 200 });
    const rows = q.data?.data;

    useEffect(() => {
        if (rows) onLoaded(rows);
        // `onLoaded` es una lambda del padre: incluirla dispararía el efecto
        // en cada render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows]);

    return null;
}
