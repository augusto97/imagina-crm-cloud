import { z } from 'zod';
import { idSchema } from './common';
import { tenantSlugSchema } from './slug';

/**
 * Workspace (tenant). El detalle de planes llega en F4 (Stripe);
 * por ahora `plan` es un string con default `trial`.
 */
export const tenantSchema = z.object({
    id: idSchema,
    slug: tenantSlugSchema,
    name: z.string().min(1).max(120),
    plan: z.string().default('trial'),
    settings: z.record(z.unknown()).default({}),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const createWorkspaceSchema = z.object({
    name: z.string().trim().min(1).max(120),
    slug: tenantSlugSchema.optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
