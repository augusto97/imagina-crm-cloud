import { z } from 'zod';
import { sessionUserSchema } from './auth';
import { capabilitySchema } from './membership';
import { fieldSchema } from './field';
import { listSchema } from './list';
import { tenantSchema } from './tenant';
import { roleSchema } from './membership';
import { viewSchema } from './view';

/**
 * Respuesta de `GET /bootstrap` (STANDALONE.md §6): TODO lo necesario para el
 * primer paint en UN request — workspace + user + lists + fields + views +
 * capabilities. Evita el waterfall de 4-5 fetches (HANDOFF §2.2/§2.3).
 */
export const bootstrapSchema = z.object({
    user: sessionUserSchema,
    tenant: tenantSchema.extend({ role: roleSchema }),
    capabilities: z.record(capabilitySchema, z.boolean()),
    lists: z.array(listSchema),
    fields: z.array(fieldSchema),
    views: z.array(viewSchema),
});
export type Bootstrap = z.infer<typeof bootstrapSchema>;
