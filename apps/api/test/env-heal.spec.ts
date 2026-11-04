import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resetWebBuildCache, runningFromRelease, serverConfigStatus, useWebBuild } from '../src/common/web-build';

/**
 * v0.1.362 — `deploy/env-heal.sh` completa el .env de un servidor instalado
 * (lo llama deploy.sh en cada actualización). El caso real: un servidor de
 * ServerAvatar con la «config mínima» del runbook — sin NODE_ENV ni secretos —
 * corría en modo desarrollo y los formularios públicos quedaban en blanco.
 */
const SCRIPT = resolve(__dirname, '../../../deploy/env-heal.sh');
const dirs: string[] = [];

function run(content: string, mode = 0o640): { out: string; text: string; file: string } {
    const dir = mkdtempSync(join(tmpdir(), 'ib-envheal-'));
    dirs.push(dir);
    const file = join(dir, '.env.production');
    writeFileSync(file, content);
    chmodSync(file, mode);
    const out = execFileSync('bash', [SCRIPT, file], { encoding: 'utf8', stdio: 'pipe' });
    return { out, text: readFileSync(file, 'utf8'), file };
}

/** Lo que leería systemd / el lector de deploy.sh: la última asignación gana. */
function parse(text: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
        if (!m) continue;
        env[m[1]!] = m[2]!.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
    return env;
}

afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const MINIMAL = [
    'POSTGRES_USER=imagina',
    'DATABASE_URL=postgres://imagina:x@127.0.0.1:5432/imagina_base',
    'REDIS_URL=redis://127.0.0.1:6379',
    'COOKIE_SECURE=true',
    'APP_BASE_URL=https://base.example.com',
    'MAIL_FROM="Imagina Base <no-reply@example.com>"',
    '',
].join('\n');

describe('deploy/env-heal.sh', () => {
    it('config mínima del runbook: genera los dos secretos y agrega NODE_ENV=production', () => {
        const { out, text, file } = run(MINIMAL);
        const env = parse(text);
        expect(env.NODE_ENV).toBe('production');
        expect(env.SECRETS_KEY).toMatch(/^[0-9a-f]{96}$/);
        expect(env.FILES_SIGNING_SECRET).toMatch(/^[0-9a-f]{96}$/);
        expect(env.SECRETS_KEY).not.toBe(env.FILES_SIGNING_SECRET);
        // Lo que ya estaba queda igual, en su lugar.
        expect(text.startsWith(MINIMAL)).toBe(true);
        expect(env.MAIL_FROM).toBe('Imagina Base <no-reply@example.com>');
        // Nunca imprime un secreto, y no cambia los permisos del archivo.
        expect(out).not.toContain(env.SECRETS_KEY);
        expect(out).not.toContain(env.FILES_SIGNING_SECRET);
        expect(out).toContain('NODE_ENV=production');
        expect(statSync(file).mode & 0o777).toBe(0o640);
    });

    it('secretos vacíos: se reemplazan en su línea (sin duplicar); los que tienen valor no se tocan', () => {
        const { text } = run('SECRETS_KEY=\nFILES_SIGNING_SECRET=""\nexport OTRO=1\n');
        const lines = text.split('\n');
        expect(lines.filter((l) => l.startsWith('SECRETS_KEY=')).length).toBe(1);
        expect(lines.filter((l) => l.startsWith('FILES_SIGNING_SECRET=')).length).toBe(1);
        expect(lines[0]).toMatch(/^SECRETS_KEY=[0-9a-f]{96}$/);
        expect(lines[1]).toMatch(/^FILES_SIGNING_SECRET=[0-9a-f]{96}$/);
        expect(text).toContain('export OTRO=1');

        const kept = run('SECRETS_KEY=abc123\nexport FILES_SIGNING_SECRET="xyz"\n');
        const env = parse(kept.text);
        expect(env.SECRETS_KEY).toBe('abc123');
        expect(env.FILES_SIGNING_SECRET).toBe('xyz');
        expect(env.NODE_ENV).toBe('production');
    });

    it('un NODE_ENV puesto a mano se respeta (y se avisa)', () => {
        const { out, text } = run('NODE_ENV=development\nSECRETS_KEY=a\nFILES_SIGNING_SECRET=b\n');
        expect(parse(text).NODE_ENV).toBe('development');
        expect(out).toContain('NODE_ENV=development');
        expect(out).toContain('aviso');
    });

    it('ya completo: el archivo queda byte a byte igual', () => {
        const full = 'NODE_ENV=production\r\nSECRETS_KEY=a\r\nFILES_SIGNING_SECRET=b\r\n';
        const { out, text } = run(full);
        expect(text).toBe(full);
        expect(out).toContain('completa');
    });

    it('archivo sin salto de línea final ni con CRLF: lo agregado queda en líneas propias', () => {
        const { text } = run('APP_BASE_URL=https://x.example\r\nCOOKIE_SECURE=true');
        const env = parse(text);
        expect(env.COOKIE_SECURE).toBe('true');
        expect(env.NODE_ENV).toBe('production');
        expect(env.SECRETS_KEY).toMatch(/^[0-9a-f]{96}$/);
    });

    it('sin archivo: avisa y no falla (el deploy sigue)', () => {
        const out = execFileSync('bash', [SCRIPT, '/no/existe/.env.production'], { encoding: 'utf8' });
        expect(out).toContain('aviso');
    });
});

describe('serverConfigStatus (Plataforma → Diagnóstico)', () => {
    const base = { NODE_ENV: 'production' as const, SECRETS_KEY: 'k', FILES_SIGNING_SECRET: 's', COOKIE_SECURE: false, APP_BASE_URL: 'https://base.example.com' };

    it('un servidor bien configurado pasa todo', () => {
        const s = serverConfigStatus(base, true);
        expect(s.from_release).toBe(true);
        expect(s.checks.every((c) => c.ok)).toBe(true);
    });

    it('el servidor del reporte: sin NODE_ENV ni secretos', () => {
        const s = serverConfigStatus({ ...base, NODE_ENV: 'development', SECRETS_KEY: '', FILES_SIGNING_SECRET: ' ', COOKIE_SECURE: true }, true);
        const bad = s.checks.filter((c) => !c.ok).map((c) => c.key);
        expect(bad).toEqual(['production', 'secrets_key', 'files_signing_secret']);
        expect(s.node_env).toBe('development');
    });

    it('cookies sin Secure y una dirección http se marcan', () => {
        const s = serverConfigStatus({ ...base, NODE_ENV: 'development', APP_BASE_URL: 'http://1.2.3.4' }, true);
        const bad = s.checks.filter((c) => !c.ok).map((c) => c.key);
        expect(bad).toEqual(['production', 'cookie_secure', 'app_base_url']);
    });
});

describe('useWebBuild: las páginas públicas usan el build desde un release aunque falte NODE_ENV', () => {
    it('en el repo (sin release) y en desarrollo usa los módulos de vite', () => {
        resetWebBuildCache();
        expect(runningFromRelease()).toBe(false);
        expect(useWebBuild({ NODE_ENV: 'development', WEB_DIST_DIR: '' })).toBe(false);
        expect(useWebBuild({ NODE_ENV: 'production', WEB_DIST_DIR: '' })).toBe(true);
        expect(useWebBuild({ NODE_ENV: 'development', WEB_DIST_DIR: '/x' })).toBe(true);
    });

    it('corriendo desde <release>/apps/api con <release>/web/cloud/index.html usa el build', () => {
        const rel = mkdtempSync(join(tmpdir(), 'ib-rel-'));
        dirs.push(rel);
        mkdirSync(join(rel, 'apps', 'api'), { recursive: true });
        mkdirSync(join(rel, 'web', 'cloud'), { recursive: true });
        writeFileSync(join(rel, 'web', 'cloud', 'index.html'), '<!doctype html>');
        const before = process.cwd();
        try {
            process.chdir(join(rel, 'apps', 'api'));
            resetWebBuildCache();
            expect(runningFromRelease()).toBe(true);
            expect(useWebBuild({ NODE_ENV: 'development', WEB_DIST_DIR: '' })).toBe(true);
        } finally {
            process.chdir(before);
            resetWebBuildCache();
        }
    });
});
