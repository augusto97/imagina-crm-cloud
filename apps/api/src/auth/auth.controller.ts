import {
    Body,
    Controller,
    Get,
    HttpCode,
    Inject,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    forgotPasswordSchema,
    loginInputSchema,
    registerInputSchema,
    resetPasswordSchema,
    type AuthSession,
    type ForgotPasswordInput,
    type LoginInput,
    type RegisterInput,
    type ResetPasswordInput,
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
    ): Promise<AuthSession> {
        const session = await this.auth.login(input);
        this.setSessionCookie(reply, session.token as string);
        return session;
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

    @Get('me')
    @UseGuards(SessionGuard)
    me(@Req() req: FastifyRequest): Promise<AuthSession> {
        return this.auth.me(req.authUserId as number);
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
            secure: this.env.COOKIE_SECURE,
            sameSite: 'lax',
            path: '/',
            maxAge: this.env.SESSION_TTL_SECONDS,
        });
    }
}
