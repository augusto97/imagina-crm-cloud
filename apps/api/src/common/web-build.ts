import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ServerConfigStatus } from '@imagina-base/shared';
import type { Env } from '../config/env';

/**
 * v0.1.362 — ¿El API corre desde un release instalado? En el layout de
 * releases (ADR-S13) el proceso vive en `<release>/apps/api/dist/…` y el
 * front compilado en `<release>/web` (con `cloud/index.html`). En el repo esa
 * carpeta no existe.
 *
 * Las páginas públicas (formularios, tableros) decidían «build o módulos de
 * vite» SÓLO por `NODE_ENV === 'production'`. Un servidor instalado sin esa
 * variable (el runbook de ServerAvatar no la pedía) servía la página de
 * desarrollo — un `<script src="/app/public-form/main.ts">` que en producción
 * no existe — y el formulario quedaba en blanco. Estar en un release alcanza
 * para saber que hay que usar el build.
 */
let cached: boolean | null = null;

export function runningFromRelease(): boolean {
    if (cached !== null) return cached;
    cached = [
        // <release>/apps/api/{dist,src}/common → <release>/web
        path.resolve(__dirname, '../../../../web'),
        // cwd del servicio: <release>/apps/api
        path.resolve(process.cwd(), '../../web'),
    ].some((dir) => existsSync(path.join(dir, 'cloud', 'index.html')));
    return cached;
}

/** Usar el front compilado (y no los módulos del servidor de desarrollo de vite). */
export function useWebBuild(env: Pick<Env, 'NODE_ENV' | 'WEB_DIST_DIR'>): boolean {
    return env.NODE_ENV === 'production' || env.WEB_DIST_DIR.trim() !== '' || runningFromRelease();
}

/**
 * v0.1.362 — Plataforma → Diagnóstico: lo que el `.env` de un servidor
 * instalado tiene que tener. La actualización completa sola lo que falta
 * (`deploy/env-heal.sh`); esto lo muestra por si no pudo escribir el archivo.
 */
export function serverConfigStatus(
    env: Pick<Env, 'NODE_ENV' | 'SECRETS_KEY' | 'FILES_SIGNING_SECRET' | 'COOKIE_SECURE' | 'APP_BASE_URL'>,
    fromRelease: boolean = runningFromRelease(),
): ServerConfigStatus {
    const production = env.NODE_ENV === 'production';
    return {
        node_env: env.NODE_ENV,
        from_release: fromRelease,
        checks: [
            { key: 'production', ok: production },
            { key: 'secrets_key', ok: env.SECRETS_KEY.trim() !== '' },
            { key: 'files_signing_secret', ok: env.FILES_SIGNING_SECRET.trim() !== '' },
            { key: 'cookie_secure', ok: env.COOKIE_SECURE || production },
            { key: 'app_base_url', ok: env.APP_BASE_URL.startsWith('https://') },
        ],
    };
}

/** Sólo para tests. */
export function resetWebBuildCache(value: boolean | null = null): void {
    cached = value;
}
