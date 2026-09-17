import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../../deploy/oauth-discovery-static.sh');

/**
 * v0.1.186 — El deploy escribe la metadata OAuth como archivos estáticos en
 * la raíz del SPA (los proxies sirven un archivo real ANTES del fallback a
 * index.html). Se prueba el script tal cual corre en el servidor.
 */
describe('deploy/oauth-discovery-static.sh', () => {
    const dirs: string[] = [];
    const run = (env: Record<string, string>): string => {
        const dir = mkdtempSync(join(tmpdir(), 'ib-wk-'));
        dirs.push(dir);
        execFileSync('bash', [SCRIPT], { env: { ...process.env, WEB_DIR: dir, ...env }, stdio: 'pipe' });
        return dir;
    };
    afterAll(() => {
        for (const d of dirs) rmSync(d, { recursive: true, force: true });
    });

    it('genera los tres documentos con el issuer = APP_BASE_URL (sin barra final)', () => {
        const dir = run({ APP_BASE_URL: 'https://base.acme.cloud/' });
        const as = JSON.parse(readFileSync(join(dir, '.well-known/oauth-authorization-server'), 'utf8')) as Record<string, unknown>;
        expect(as).toMatchObject({
            issuer: 'https://base.acme.cloud',
            authorization_endpoint: 'https://base.acme.cloud/api/v1/oauth/authorize',
            token_endpoint: 'https://base.acme.cloud/api/v1/oauth/token',
            registration_endpoint: 'https://base.acme.cloud/api/v1/oauth/register',
            code_challenge_methods_supported: ['S256'],
            response_types_supported: ['code'],
        });
        const oidc = JSON.parse(readFileSync(join(dir, '.well-known/openid-configuration'), 'utf8')) as Record<string, unknown>;
        expect(oidc.issuer).toBe('https://base.acme.cloud');
        // Recurso protegido en la forma path-aware (RFC 9728 §3.1) — la que un
        // cliente prueba primero para `/api/v1/mcp`.
        const pr = JSON.parse(readFileSync(join(dir, '.well-known/oauth-protected-resource/api/v1/mcp'), 'utf8')) as Record<string, unknown>;
        expect(pr).toMatchObject({ resource: 'https://base.acme.cloud/api/v1/mcp', authorization_servers: ['https://base.acme.cloud'] });
    });

    it('sin APP_BASE_URL (o inválido) no escribe nada y no falla el deploy', () => {
        const a = run({ APP_BASE_URL: '' });
        expect(existsSync(join(a, '.well-known'))).toBe(false);
        const b = run({ APP_BASE_URL: 'no es una url' });
        expect(existsSync(join(b, '.well-known'))).toBe(false);
    });
});
