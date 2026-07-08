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
        .default('postgres://imagina:imagina@localhost:5432/imagina_crm'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    SESSION_TTL_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(60 * 60 * 24 * 30),
    COOKIE_SECURE: boolFromString,
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
