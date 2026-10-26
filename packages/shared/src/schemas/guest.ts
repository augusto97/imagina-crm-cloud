import { z } from 'zod';
import { emailSchema } from './auth';
import type { RolePermissions } from './list-permissions';

/**
 * C3 — Invitados externos (rol `guest`): un proveedor, un freelancer o el
 * contador que trabajan sobre la TABLA, no clientes finales (eso es el
 * portal). Ven SÓLO lo que se les compartió:
 *   1. una lista entera, con el acceso por persona de la lista (`settings.
 *      permissions.users[id]`);
 *   2. registros sueltos: tabla `record_shares` (registro, persona, nivel).
 * No ocupan usuario del plan; tienen su propio tope (`max_guests`).
 */

/** Nivel de un acceso de invitado (a una lista o a un registro). */
export const GUEST_LEVELS = ['view', 'comment', 'edit'] as const;
export const guestLevelSchema = z.enum(GUEST_LEVELS);
export type GuestLevel = z.infer<typeof guestLevelSchema>;

export const GUEST_LEVEL_LABELS: Record<GuestLevel, string> = {
    view: 'Puede ver',
    comment: 'Puede comentar',
    edit: 'Puede editar',
};

/** Tope de registros sueltos compartidos con UNA persona invitada. */
export const MAX_RECORD_SHARES_PER_GUEST = 500;

/**
 * El acceso a una LISTA de un nivel de invitado, en la forma del ACL por
 * persona. «Puede editar» crea y edita pero no borra; nadie del lado de
 * afuera borra registros de la empresa.
 */
export function guestListPermissions(level: GuestLevel): RolePermissions {
    if (level === 'edit') return { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [], comment: true };
    return { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [], comment: level === 'comment' };
}

/** El nivel de invitado que corresponde a un acceso por persona guardado. */
export function guestLevelOf(p: Pick<RolePermissions, 'edit' | 'comment'> | null | undefined): GuestLevel | null {
    if (!p) return null;
    if (p.edit !== 'none') return 'edit';
    return p.comment === true ? 'comment' : 'view';
}

/** Compartir un registro con alguien de afuera (por email). */
export const shareRecordSchema = z.object({
    email: emailSchema,
    level: guestLevelSchema,
    name: z.string().trim().max(120).optional(),
});
export type ShareRecordInput = z.infer<typeof shareRecordSchema>;

/** Compartir una lista entera con alguien de afuera (por email). */
export const shareListWithGuestSchema = shareRecordSchema;
export type ShareListWithGuestInput = ShareRecordInput;

export const updateGuestLevelSchema = z.object({ level: guestLevelSchema });
export type UpdateGuestLevelInput = z.infer<typeof updateGuestLevelSchema>;

/** Una persona de afuera con acceso a un registro (ficha → «Compartir este registro»). */
export interface RecordShareDto {
    id: number;
    record_id: number;
    list_id: number;
    user_id: number;
    name: string;
    email: string;
    level: GuestLevel;
    /** Todavía no definió su contraseña. */
    pending: boolean;
    created_at: string;
}

/** Resultado de invitar: la cuenta se creó (correo de invitación) o ya existía (aviso). */
export interface GuestInviteResult {
    user_id: number;
    invited: boolean;
    notified: boolean;
}

/** Ajustes → Miembros → «Invitados»: cada invitado con lo que tiene compartido. */
export interface GuestSummary {
    user_id: number;
    name: string;
    email: string;
    pending: boolean;
    lists: Array<{ list_id: number; list_slug: string; list_name: string; level: GuestLevel }>;
    records: Array<{ share_id: number; record_id: number; list_id: number; list_slug: string; list_name: string; title: string; level: GuestLevel }>;
}

/** Lo que ve un invitado: «Compartido conmigo». */
export interface SharedWithMeDto {
    tenant_name: string;
    lists: Array<{ id: number; slug: string; name: string; icon: string | null; color: string | null; level: GuestLevel }>;
    records: Array<{ id: number; list_id: number; list_slug: string; list_name: string; title: string; level: GuestLevel }>;
}

export const promoteGuestSchema = z.object({ role: z.enum(['manager', 'agent', 'viewer']) });
export type PromoteGuestInput = z.infer<typeof promoteGuestSchema>;

