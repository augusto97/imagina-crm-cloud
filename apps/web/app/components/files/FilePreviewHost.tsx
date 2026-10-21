import { lazy, Suspense } from 'react';

import { useFilePreviewState } from './filePreview';

// El visor se baja recién la primera vez que alguien abre un archivo.
const FilePreviewDialog = lazy(() => import('./FilePreviewDialog'));

/** v0.1.291 — Se monta una vez en la raíz de la app; muestra el visor si está abierto. */
export function FilePreviewHost(): JSX.Element | null {
    const state = useFilePreviewState();
    if (state === null) return null;
    return (
        <Suspense fallback={null}>
            <FilePreviewDialog files={state.files} index={state.index} />
        </Suspense>
    );
}
