import { z } from 'zod';
import { idSchema } from './common';
import { emailSchema } from './auth';
import { roleSchema } from './membership';

/**
 * Miembros de un workspace (panel admin). Un miembro = una fila de
 * `memberships` (tenant-isolated por RLS) unida al `users`. El rol `client`
 * NO se administra desde acá: se crea/gestiona vía portal (magic links).
 */
export const workspaceMemberSchema = z.object({
    user_id: idSchema,
    name: z.string(),
    email: z.string(),
    role: roleSchema,
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/** Roles administrables desde el panel (excluye `client`). */
export const staffRoleSchema = z.enum(['admin', 'manager', 'agent', 'viewer']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/** Alta de un miembro: se referencia a un usuario YA registrado, por email. */
export const addMemberSchema = z.object({
    email: emailSchema,
    role: staffRoleSchema,
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberRoleSchema = z.object({ role: staffRoleSchema });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
