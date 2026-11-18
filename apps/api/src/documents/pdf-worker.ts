import { parentPort } from 'node:worker_threads';

import { renderDashboardPdfLocal } from '../dashboard-sharing/dashboard-pdf';
import { renderGanttPdfLocal } from '../gantt/gantt-pdf';
import { renderDocumentLocal, renderPdfDefinition, replayDocInput, useDirectPdfRender } from './document-render';
import { PdfTaskFallback, type PdfTask, type PdfWorkerReply } from './pdf-pool';

/**
 * v0.1.439 — El hilo de PDF (ver `pdf-pool.ts`). Recibe una tarea con DATOS,
 * arma la definición de pdfmake con las mismas funciones que el hilo
 * principal y devuelve los bytes. Nunca toca la base, la red ni el disco
 * (pdfmake tiene cerrado el acceso a URLs y archivos locales).
 */
useDirectPdfRender();

/** Una copia propia de los bytes: transferirla no toca otro Buffer del pool de Node. */
function own(buf: Buffer): Uint8Array {
    return new Uint8Array(buf);
}

async function run(task: PdfTask): Promise<Omit<PdfWorkerReply, 'id'>> {
    switch (task.kind) {
        case 'document': {
            const out = await renderDocumentLocal(replayDocInput(task.input));
            const { buffer, ...meta } = out;
            return { ok: true, bytes: own(buffer), meta };
        }
        case 'definition':
            return { ok: true, bytes: own(await renderPdfDefinition(task.def)) };
        case 'gantt':
            return { ok: true, bytes: own(await renderGanttPdfLocal(task.input)) };
        case 'dashboard':
            return { ok: true, bytes: own(await renderDashboardPdfLocal(task.input)) };
        default:
            return { ok: false, error: 'Tarea de PDF desconocida.' };
    }
}

parentPort?.on('message', (msg: { id: number; task: PdfTask }) => {
    void (async () => {
        let reply: PdfWorkerReply;
        try {
            reply = { id: msg.id, ...(await run(msg.task)) };
        } catch (err) {
            reply = {
                id: msg.id,
                ok: false,
                fallback: err instanceof PdfTaskFallback,
                error: err instanceof Error ? err.message : String(err),
            };
        }
        const transfer = reply.bytes ? [reply.bytes.buffer as ArrayBuffer] : [];
        parentPort!.postMessage(reply, transfer);
    })();
});
