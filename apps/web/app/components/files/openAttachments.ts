import { resolveAttachments, type ResolvedAttachment } from '@/hooks/useAttachments';

import { openFilePreview, type PreviewFile } from './filePreview';

export function toPreviewFile(a: ResolvedAttachment): PreviewFile {
    return { id: a.id, url: a.url, title: a.title, mimeType: a.mimeType, sizeBytes: a.sizeBytes };
}

/**
 * v0.1.291 — Abre el visor con los archivos de UN campo (para pasar de uno a
 * otro con ←/→), empezando por `startId`. Los que falten se resuelven en lote.
 */
export async function openAttachmentsPreview(ids: readonly number[], startId: number): Promise<void> {
    const files = await resolveAttachments(ids);
    if (files.length === 0) return;
    openFilePreview(files.map(toPreviewFile), Math.max(0, files.findIndex((f) => f.id === startId)));
}

/**
 * Click en el nombre de un archivo: un click común abre el visor; con Ctrl/⌘,
 * Shift o el botón del medio el navegador hace lo de siempre (otra pestaña).
 */
export function isPlainClick(e: React.MouseEvent): boolean {
    return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
