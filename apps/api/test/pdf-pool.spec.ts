import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docDesignSchema } from '@imagina-base/shared';

import {
    recordDocInput,
    renderDocument,
    renderDocumentLocal,
    renderPlainPdfDefinition,
    replayDocInput,
    type DocRenderInput,
} from '../src/documents/document-render';
import { PdfPool, PdfTaskFallback, pdfWorkerCount, pdfWorkerEntry, setPdfPoolForTests } from '../src/documents/pdf-pool';
import { renderGanttPdf, renderGanttPdfLocal, type GanttPdfInput } from '../src/gantt/gantt-pdf';
import { buildLabelsDefinition, type LabelItem } from '../src/qr/record-labels.service';

/**
 * v0.1.439 — Los PDF se maquetan en un hilo aparte: el resultado es el mismo
 * que en el hilo principal y, mientras tanto, el hilo principal sigue libre.
 * El hilo se levanta desde el `.ts` con tsx (en producción, el `.js`).
 */
const VARS: Record<string, string> = { cliente: 'Ferretería Andina', empresa: 'Taller Uno' };

function docInput(rows: number): DocRenderInput {
    return {
        design: docDesignSchema.parse({
            footer: { text: '{{empresa}} · Gracias', page_numbers: true },
            blocks: [
                { id: 'h', type: 'heading', text: 'Cotización para {{cliente}}', level: 1 },
                { id: 'f', type: 'fields', slugs: ['nit', 'ciudad'] },
                { id: 'it', type: 'items', title: 'Ítems' },
            ],
        }),
        resolve: (t) => t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => VARS[k] ?? ''),
        tagsMode: false,
        fieldLabel: (s) => ({ nit: 'NIT', ciudad: 'Ciudad' })[s] ?? s,
        fieldValue: (s) => ({ nit: '900.123.456-7', ciudad: 'Bogotá' })[s] ?? '',
        items: new Map([
            [
                'it',
                {
                    columns: [
                        { label: 'Producto', align: 'left' as const, width: 'fill' as const },
                        { label: 'Cantidad', align: 'right' as const, width: 'auto' as const },
                        { label: 'Precio', align: 'right' as const, width: 'auto' as const },
                        { label: 'Total', align: 'right' as const, width: 'auto' as const },
                    ],
                    rows: Array.from({ length: rows }, (_, i) => [`Tornillo ${i + 1} de acero inoxidable`, String(i + 1), '$ 1.250', `$ ${(i + 1) * 1250}`]),
                },
            ],
        ]),
        totals: new Map(),
        images: new Map(),
        title: 'Cotización',
        author: 'Taller Uno',
    };
}

/** La pausa más larga del hilo principal mientras corre `work`. */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
    let last = performance.now();
    let worst = 0;
    const timer = setInterval(() => {
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
    }, 5);
    try {
        await work();
    } finally {
        // Si el trabajo nunca soltó el hilo, el reloj no llegó a marcar: la
        // pausa es todo lo que pasó desde la última marca.
        worst = Math.max(worst, performance.now() - last);
        clearInterval(timer);
    }
    return worst;
}

describe('PDF en un hilo aparte (v0.1.439)', () => {
    let pool: PdfPool;

    beforeAll(() => {
        const entry = pdfWorkerEntry({ PDF_WORKER_TS: '1' } as NodeJS.ProcessEnv);
        expect(entry).not.toBeNull();
        pool = new PdfPool({ size: 1, ...entry! });
        setPdfPoolForTests(pool);
    });

    afterAll(async () => {
        setPdfPoolForTests(undefined);
        await pool?.close();
    });

    it('cuántos hilos: 1 por defecto, 0 los apaga, nunca más que procesadores', () => {
        expect(pdfWorkerCount({} as NodeJS.ProcessEnv)).toBe(1);
        expect(pdfWorkerCount({ PDF_WORKERS: '0' } as NodeJS.ProcessEnv)).toBe(0);
        expect(pdfWorkerCount({ PDF_WORKERS: 'x' } as NodeJS.ProcessEnv)).toBe(1);
        expect(pdfWorkerCount({ PDF_WORKERS: '999' } as NodeJS.ProcessEnv)).toBeLessThan(999);
        // Sin el archivo compilado y sin pedirlo, no hay hilo (se maqueta aquí).
        expect(pdfWorkerEntry({} as NodeJS.ProcessEnv)).toBeNull();
    });

    it('el documento sale igual que en el hilo principal: páginas, zonas y textos resueltos', async () => {
        const viaPool = await renderDocument(docInput(120));
        const local = await renderDocumentLocal(docInput(120));
        expect(viaPool.buffer.subarray(0, 5).toString()).toBe('%PDF-');
        expect(viaPool.pages).toBe(local.pages);
        expect(viaPool.pages).toBeGreaterThan(1);
        expect(viaPool.regions).toEqual(local.regions);
        expect(viaPool.pageWidth).toBe(local.pageWidth);
        expect(pool.spawned).toBeGreaterThanOrEqual(1);
        // Lo grabado alcanza para rearmarlo (también el pie).
        const rec = recordDocInput(docInput(3));
        expect(rec.resolved.get('{{empresa}} · Gracias')).toBe('Taller Uno · Gracias');
        expect(rec.values.get('ciudad')).toBe('Bogotá');
        expect(() => replayDocInput(rec).resolve('{{otra}}')).toThrow(PdfTaskFallback);
    });

    it('mientras se maqueta en el hilo, el hilo principal sigue atendiendo', async () => {
        await renderDocument(docInput(5)); // hilo ya levantado
        const heavy = docInput(2500);
        const localStall = await longestStall(() => renderDocumentLocal(heavy));
        const poolStall = await longestStall(() => renderDocument(heavy));
        // Aquí se mide de verdad: maquetar en el hilo principal lo frena
        // varios cientos de milisegundos; en el hilo aparte, casi nada.
        expect(localStall).toBeGreaterThan(200);
        expect(poolStall).toBeLessThan(Math.max(80, localStall / 4));
    });

    it('etiquetas y Gantt también pasan por el hilo', async () => {
        const items: LabelItem[] = Array.from({ length: 35 }, (_, i) => ({ qr: `https://x.test/r/${i}`, title: `Caja ${i}`, lines: ['Bodega 2'], code: `C-${i}` }));
        const labels = await renderPlainPdfDefinition(buildLabelsDefinition('letter_30', items));
        expect(labels.subarray(0, 5).toString()).toBe('%PDF-');
        expect((labels.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(2);

        const gantt: GanttPdfInput = {
            title: 'Obra',
            subtitle: 'Julio',
            columns: ['Responsable'],
            rows: [
                { kind: 'record', label: 'Excavar', depth: 0, cells: ['Ana'], bar: { start: 10, end: 14, milestone: false } as never, color: '#3b82f6', baseline: null, id: 1 },
                { kind: 'record', label: 'Fundir', depth: 0, cells: ['Luis'], bar: { start: 15, end: 18, milestone: false } as never, color: '#10b981', baseline: null, id: 2 },
            ],
            deps: [{ blocker: 1, blocked: 2 }],
            from: 8,
            to: 22,
            today: 12,
            preferredZoom: 'day',
        } as GanttPdfInput;
        const viaPool = await renderGanttPdf(gantt);
        const local = await renderGanttPdfLocal(gantt);
        expect(viaPool.subarray(0, 5).toString()).toBe('%PDF-');
        expect(Math.abs(viaPool.length - local.length)).toBeLessThan(200);
    });

    it('un PDF que no se puede armar falla con el motivo y el hilo sigue sirviendo', async () => {
        await expect(renderPlainPdfDefinition({ content: [{ image: 'data:image/png;base64,AAAA' }] })).rejects.toThrow();
        const ok = await renderPlainPdfDefinition({ content: ['Hola'] });
        expect(ok.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('un PDF que tarda demasiado cierra su hilo y el siguiente usa uno nuevo', async () => {
        const before = pool.spawned;
        await expect(pool.run({ kind: 'definition', def: buildLabelsDefinition('a4_21', []) }, { timeoutMs: 1 })).rejects.toThrow(/tardó demasiado/);
        const out = await renderPlainPdfDefinition({ content: ['Después'] });
        expect(out.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pool.spawned).toBe(before + 1);
    });

    it('sin uso, el hilo se cierra solo y se vuelve a crear al próximo PDF', async () => {
        const entry = pdfWorkerEntry({ PDF_WORKER_TS: '1' } as NodeJS.ProcessEnv)!;
        const quick = new PdfPool({ size: 1, ...entry, idleMs: 100 });
        try {
            await quick.run({ kind: 'definition', def: { content: ['Uno'] } });
            expect(quick.alive).toBe(1);
            await new Promise((r) => setTimeout(r, 400));
            expect(quick.alive).toBe(0);
            await quick.run({ kind: 'definition', def: { content: ['Dos'] } });
            expect(quick.spawned).toBe(2);
        } finally {
            await quick.close();
        }
    });

    it('si el hilo no puede rearmar el documento, se arma en el hilo principal', async () => {
        const fake = { size: 1, run: () => Promise.reject(new PdfTaskFallback('falta algo')) } as unknown as PdfPool;
        setPdfPoolForTests(fake);
        try {
            const out = await renderDocument(docInput(2));
            expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
        } finally {
            setPdfPoolForTests(pool);
        }
    });
});
