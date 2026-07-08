import { z } from 'zod';

const boolFromString = z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z
        .string()
        .url()
        .default('postgres://imagina:imagina@localhost:5432/imagina_base'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    SESSION_TTL_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(60 * 60 * 24 * 30),
    COOKIE_SECURE: boolFromString,
    // Secret del webhook de billing (stand-in de la firma de Stripe). Vacío
    // = webhook deshabilitado.
    BILLING_WEBHOOK_SECRET: z.string().default(''),

    // --- Email (ADR-S11). `log` (default) escribe el mail al logger; `smtp`
    // usa nodemailer contra un servidor SMTP real. Elegir `smtp` sin SMTP_HOST
    // cae a `log` con un warning (no rompe el arranque).
    MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
    MAIL_FROM: z.string().default('Imagina Base <no-reply@imagina.base>'),
    // Origen público del SPA — para construir URLs absolutas en emails (magic
    // link del portal, etc.). Sin barra final.
    APP_BASE_URL: z
        .string()
        .url()
        .default('http://localhost:5174')
        .transform((v) => v.replace(/\/$/, '')),
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: boolFromString,
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(overrides: Partial<Record<string, string>> = {}): Env {
    if (process.env.NODE_ENV !== 'production') {
        try {
            process.loadEnvFile();
        } catch {
            // sin .env — se usan defaults de desarrollo
        }
    }
    return envSchema.parse({ ...process.env, ...overrides });
}
