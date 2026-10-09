import { z } from 'zod';
import { idSchema } from './common';
import { emailSchema } from './auth';
import { roleSchema } from './membership';

/**
 * Miembros de un workspace (panel admin). Un miembro = una fila de
 * `memberships` (tenant-isolated por RLS) unida al `users`. El rol `client`
 * NO se administra desde aquí: se crea/gestiona vía portal (magic links).
 */
export const workspaceMemberSchema = z.object({
    user_id: idSchema,
    name: z.string(),
    email: z.string(),
    role: roleSchema,
    /**
     * v0.1.240 — la persona fue invitada y todavía no definió su contraseña
     * (no puede entrar hasta abrir el enlace del correo).
     */
    pending: z.boolean().optional(),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/** Roles administrables desde el panel (excluye `client`). */
export const staffRoleSchema = z.enum(['admin', 'manager', 'agent', 'viewer']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/**
 * Alta de un miembro por email. v0.1.240: si la persona no tiene cuenta se
 * crea por INVITACIÓN (le llega un correo para definir su contraseña) y `name`
 * es su nombre visible — si no viene, se usa la parte local del email.
 */
export const addMemberSchema = z.object({
    email: emailSchema,
    role: staffRoleSchema,
    name: z.string().trim().max(120).optional(),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

/**
 * Resultado del alta: el miembro + si se creó la cuenta por invitación
 * (`invited`) o se sumó una cuenta existente, y si esa cuenta existente
 * recibió el aviso por correo (`notified`, best-effort).
 */
export const addMemberResultSchema = workspaceMemberSchema.extend({
    invited: z.boolean(),
    notified: z.boolean(),
});
export type AddMemberResult = z.infer<typeof addMemberResultSchema>;

export const updateMemberRoleSchema = z.object({ role: staffRoleSchema });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
