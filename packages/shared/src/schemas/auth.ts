import { z } from 'zod';
import { idSchema } from './common';
import { roleSchema } from './membership';
import { tenantSlugSchema } from './slug';

export const emailSchema = z.string().trim().toLowerCase().email().max(255);
export const passwordSchema = z.string().min(8, 'Mínimo 8 caracteres').max(128);

/** Alta de usuario + su primer workspace (tenant) en un solo paso. */
export const registerInputSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(1).max(120),
    workspace_name: z.string().trim().min(1).max(120),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
    email: emailSchema,
    password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

/** Solicitud de recuperación de contraseña (ADR-S11 email). */
export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Reset con el token recibido por email + la nueva contraseña. */
export const resetPasswordSchema = z.object({
    token: z.string().min(16).max(200),
    password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const sessionUserSchema = z.object({
    id: idSchema,
    email: emailSchema,
    name: z.string(),
    locale: z.string().default('es'),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const membershipSummarySchema = z.object({
    tenant_id: idSchema,
    tenant_slug: tenantSlugSchema,
    tenant_name: z.string(),
    role: roleSchema,
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

/**
 * Respuesta de register/login/me. `token` solo viaja en register/login
 * (clientes Bearer); el SPA usa la cookie httpOnly.
 */
export const authSessionSchema = z.object({
    user: sessionUserSchema,
    memberships: z.array(membershipSummarySchema),
    token: z.string().optional(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;
