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
    /**
     * v0.1.118 — `false` mientras el alta no confirme su casilla. No bloquea
     * el uso de la app (eso mataría la activación): la interfaz avisa y las
     * acciones que mandan correo en nombre del usuario son las que se gatean.
     */
    email_verified: z.boolean().default(true),
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
    /**
     * Presente si la sesión es de IMPERSONACIÓN (el operador entró como este
     * usuario para soporte). El front muestra un banner con opción de salir.
     */
    impersonating: z
        .object({ operator_id: idSchema, operator_name: z.string() })
        .optional(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

// --- v0.1.116: seguridad de la cuenta ---

/** Cambio de contraseña CON sesión iniciada (distinto del flujo de "olvidé"). */
export const changePasswordSchema = z.object({
    current_password: z.string().min(1),
    new_password: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Sesión activa del usuario ("Dispositivos"). El `id` es un hash del token:
 * el token es la credencial y NUNCA sale del servidor.
 */
export const activeSessionSchema = z.object({
    id: z.string(),
    created_at: z.string(),
    last_seen_at: z.string(),
    user_agent: z.string(),
    ip: z.string(),
    current: z.boolean(),
    impersonated: z.boolean(),
});
export type ActiveSessionDto = z.infer<typeof activeSessionSchema>;

export const activeSessionsResponseSchema = z.object({ data: z.array(activeSessionSchema) });
export type ActiveSessionsResponse = z.infer<typeof activeSessionsResponseSchema>;

/** v0.1.118 — reenviar el correo de verificación del alta. */
export const verifyEmailSchema = z.object({ token: z.string().min(16).max(200) });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
