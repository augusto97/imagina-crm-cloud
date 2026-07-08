import { z } from 'zod';
import { fieldSchema } from './field';
import { listSchema } from './list';
import { recordSchema } from './record';
import { viewSchema } from './view';

/**
 * Formato de intercambio (STANDALONE §16, CONTRACT §11): export JSON completo
 * de una lista (listas + fields + records + views). Es el formato que un
 * cliente del plugin puede importar mañana, y el que sigue disponible aunque
 * el workspace esté en solo-lectura por impago (ADR-S09).
 */
export const exportBundleSchema = z.object({
    version: z.literal(1),
    exported_at: z.string(),
    list: listSchema,
    fields: z.array(fieldSchema),
    views: z.array(viewSchema),
    records: z.array(recordSchema),
});
export type ExportBundle = z.infer<typeof exportBundleSchema>;
