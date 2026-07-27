import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Inject,
    Param,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    changePasswordSchema,
    disableTwoFactorSchema,
    enableTwoFactorSchema,
    forgotPasswordSchema,
    loginInputSchema,
    registerInputSchema,
    resetPasswordSchema,
    verifyEmailSchema,
    verifyTwoFactorSchema,
    type ActiveSessionsResponse,
    type AuthSession,
    type BackupCodes,
    type ChangePasswordInput,
    type DisableTwoFactorInput,
    type EnableTwoFactorInput,
    type ForgotPasswordInput,
    type LoginInput,
    type LoginResponse,
    type RegisterInput,
    type ResetPasswordInput,
    type TotpSetup,
    type VerifyEmailInput,
    type VerifyTwoFactorInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SessionGuard } from './session.guard';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly auth: AuthService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    @Post('register')
    async register(
        @Body(new ZodValidationPipe(registerInputSchema)) input: RegisterInput,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<AuthSession> {
        const session = await this.auth.register(input);
        this.setSessionCookie(reply, session.token as string);
        return session;
    }

    @Post('login')
    @HttpCode(200)
    async login(
        @Body(new ZodValidationPipe(loginInputSchema)) input: LoginInput,
        @Res({ passthrough: true }) reply: FastifyReply,
        @Req() req?: FastifyRequest,
    ): Promise<LoginResponse> {
        // v0.1.116 — se guarda el contexto del dispositivo para que el usuario
        // pueda reconocer sus sesiones en Ajustes → Cuenta.
        const result = await this.auth.login(input, {
            userAgent: String(req?.headers['user-agent'] ?? ''),
            ip: req?.ip ?? '',
        });
        // v0.1.120 — con 2FA el login no abre sesión: devuelve el desafío.
        if ('mfa_required' in result) return result;
        this.setSessionCookie(reply, result.token as string);
        return result;
    }

    /** v0.1.120 — Segundo paso del login: canjea el desafío con el código. */
    @Post('login/2fa')
    @HttpCode(200)
    async loginTwoFactor(
        @Body(new ZodValidationPipe(verifyTwoFactorSchema)) input: VerifyTwoFactorInput,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<AuthSession> {
        const session = await this.auth.verifyTwoFactorLogin(input);
        this.setSessionCookie(reply, session.token as string);
        return session;
    }

    // ── Verificación en dos pasos (v0.1.120) ────────────────────────────

    /** Estado del segundo factor (panel de Ajustes → Cuenta → Seguridad). */
    @Get('2fa')
    @UseGuards(SessionGuard)
    twoFactorStatus(
        @Req() req: FastifyRequest,
    ): Promise<{ enabled: boolean; backup_codes_left: number }> {
        return this.auth.twoFactorStatus(req.authUserId as number);
    }

    /** Paso 1: propone un secreto + el URI del QR (todavía no lo activa). */
    @Post('2fa/setup')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    setupTwoFactor(@Req() req: FastifyRequest): Promise<TotpSetup> {
        return this.auth.setupTwoFactor(req.authUserId as number);
    }

    /** Paso 2: confirma el código y devuelve los códigos de respaldo. */
    @Post('2fa/enable')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    enableTwoFactor(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(enableTwoFactorSchema)) input: EnableTwoFactorInput,
    ): Promise<BackupCodes> {
        return this.auth.enableTwoFactor(req.authUserId as number, input.code);
    }

    /** Nuevos códigos de respaldo (invalida los anteriores). */
    @Post('2fa/backup-codes')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    regenerateBackupCodes(@Req() req: FastifyRequest): Promise<BackupCodes> {
        return this.auth.regenerateBackupCodes(req.authUserId as number);
    }

    /** Desactiva el segundo factor. Exige la contraseña. */
    @Post('2fa/disable')
    @HttpCode(204)
    @UseGuards(SessionGuard)
    async disableTwoFactor(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(disableTwoFactorSchema)) input: DisableTwoFactorInput,
    ): Promise<void> {
        await this.auth.disableTwoFactor(req.authUserId as number, input.password);
    }

    @Post('logout')
    @HttpCode(204)
    @UseGuards(SessionGuard)
    async logout(
        @Req() req: FastifyRequest,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<void> {
        await this.auth.logout(req.sessionToken as string);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
    }

    /**
     * v0.1.116 — Cambiar la contraseña estando adentro. Antes sólo existía el
     * flujo de "olvidé mi contraseña" (había que pasar por el email para
     * cambiarla). Cierra las sesiones de los OTROS dispositivos.
     */
    @Post('change-password')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    changePassword(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(changePasswordSchema)) input: ChangePasswordInput,
    ): Promise<{ revoked_sessions: number }> {
        return this.auth.changePassword(
            req.authUserId as number,
            req.sessionToken as string,
            input,
        );
    }

    /** v0.1.118 — Confirma el email del alta (link del correo). Sin sesión. */
    @Post('verify-email')
    @HttpCode(204)
    async verifyEmail(
        @Body(new ZodValidationPipe(verifyEmailSchema)) input: VerifyEmailInput,
    ): Promise<void> {
        await this.auth.verifyEmail(input.token);
    }

    /** Reenvía el correo de verificación al usuario autenticado. */
    @Post('verify-email/resend')
    @HttpCode(204)
    @UseGuards(SessionGuard)
    async resendVerification(@Req() req: FastifyRequest): Promise<void> {
        await this.auth.sendEmailVerification(req.authUserId as number);
    }

    /** v0.1.116 — Sesiones activas de la cuenta (panel "Dispositivos"). */
    @Get('sessions')
    @UseGuards(SessionGuard)
    async sessions(@Req() req: FastifyRequest): Promise<ActiveSessionsResponse> {
        return {
            data: await this.auth.listSessions(
                req.authUserId as number,
                req.sessionToken as string,
            ),
        };
    }

    /** Cierra UNA sesión por su id público (hash del token). */
    @Delete('sessions/:id')
    @HttpCode(204)
    @UseGuards(SessionGuard)
    async revokeSession(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
        await this.auth.revokeSession(req.authUserId as number, id);
    }

    /** Cierra TODAS menos la actual ("salir en los otros dispositivos"). */
    @Delete('sessions')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    revokeOtherSessions(@Req() req: FastifyRequest): Promise<{ revoked_sessions: number }> {
        return this.auth.revokeOtherSessions(
            req.authUserId as number,
            req.sessionToken as string,
        );
    }

    @Get('me')
    @UseGuards(SessionGuard)
    me(@Req() req: FastifyRequest): Promise<AuthSession> {
        return this.auth.me(req.authUserId as number, req.impersonatedBy);
    }

    /**
     * Sale de una sesión de impersonación y restaura la del operador (ADR-S15 F5).
     * Sólo `SessionGuard` (la corre la sesión impersonada, que NO es superadmin);
     * el service valida que efectivamente sea de impersonación.
     */
    @Post('stop-impersonating')
    @HttpCode(200)
    @UseGuards(SessionGuard)
    async stopImpersonating(
        @Req() req: FastifyRequest,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<{ ok: true }> {
        const { origToken } = await this.auth.stopImpersonation(req.sessionToken as string);
        if (origToken) {
            this.setSessionCookie(reply, origToken);
        } else {
            reply.clearCookie(SESSION_COOKIE, { path: '/' });
        }
        return { ok: true };
    }

    /** Pide el email de reset. Siempre 204 (no revela si el email existe). */
    @Post('forgot-password')
    @HttpCode(204)
    async forgotPassword(
        @Body(new ZodValidationPipe(forgotPasswordSchema)) input: ForgotPasswordInput,
    ): Promise<void> {
        await this.auth.requestPasswordReset(input.email);
    }

    /** Setea la nueva contraseña con el token del email. */
    @Post('reset-password')
    @HttpCode(204)
    async resetPassword(
        @Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordInput,
    ): Promise<void> {
        await this.auth.resetPassword(input.token, input.password);
    }

    private setSessionCookie(reply: FastifyReply, token: string): void {
        reply.setCookie(SESSION_COOKIE, token, {
            httpOnly: true,
            // SEC-14: en producción la cookie de sesión SIEMPRE es Secure,
            // aunque el env no lo fuerce (evita fugarla por HTTP en claro).
            secure: this.env.COOKIE_SECURE || this.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: this.env.SESSION_TTL_SECONDS,
        });
    }
}
