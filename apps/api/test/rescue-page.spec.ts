import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * v0.1.432 (ADR-S104) — La página de rescate (`deploy/guardian/
 * imagina-rescue.mjs`): un servicio aparte, en su propio puerto y con clave, que
 * funciona aunque la app o Nginx no abran. Sólo muestra lo que ve el guardián y
 * deja pedirle cuatro cosas, dejando un archivo VACÍO con el nombre del pedido.
 */
const SCRIPT = resolve(__dirname, '../../../deploy/guardian/imagina-rescue.mjs');
const PASS = 'clave-de-prueba-123';

interface Mod {
    hashPassword(p: string): string;
    verifyPassword(p: string, h: string): boolean;
    createLimiter(now?: () => number): { blocked(ip: string): boolean; fail(ip: string): boolean; ok(ip: string): void };
    sameSite(req: { headers: Record<string, string | undefined> }): boolean;
}
let mod: Mod;

let root: string;
let state: string;
let child: ChildProcess;
let port = 0;

interface Res {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

function call(method: string, path: string, opts: { cookie?: string; form?: Record<string, string>; origin?: string } = {}): Promise<Res> {
    return new Promise((ok, bad) => {
        const body = opts.form ? new URLSearchParams(opts.form).toString() : undefined;
        const req = request(
            {
                host: '127.0.0.1',
                port,
                method,
                path,
                rejectUnauthorized: false,
                headers: {
                    ...(opts.cookie ? { cookie: opts.cookie } : {}),
                    ...(opts.origin ? { origin: opts.origin } : {}),
                    ...(body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}),
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
            },
        );
        req.on('error', bad);
        if (body) req.write(body);
        req.end();
    });
}

function cookieOf(res: Res): string {
    const raw = res.headers['set-cookie'];
    const first = (Array.isArray(raw) ? raw[0] : raw) ?? '';
    return first.split(';')[0]!;
}

async function login(): Promise<{ cookie: string; csrf: string }> {
    const res = await call('POST', '/entrar', { form: { clave: PASS } });
    expect(res.status).toBe(303);
    const cookie = cookieOf(res);
    const page = await call('GET', '/', { cookie });
    const csrf = /name="t" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
    expect(csrf).not.toBe('');
    return { cookie, csrf };
}

function requests(): string[] {
    return readdirSync(join(state, 'rescue', 'requests'));
}
function audit(): string {
    return readFileSync(join(state, 'rescue', 'audit.jsonl'), 'utf8');
}

beforeAll(async () => {
    mod = (await import(SCRIPT)) as Mod;
    root = mkdtempSync(join(tmpdir(), 'ib-rescue-'));
    state = join(root, 'state');
    mkdirSync(join(state, 'rescue', 'requests'), { recursive: true });
    writeFileSync(join(state, 'rescue', 'audit.jsonl'), '');
    writeFileSync(join(state, 'rescue', 'app-log.txt'), 'nov 14 imagina-api: Error: connect ECONNREFUSED 127.0.0.1:5432\n');
    writeFileSync(
        join(state, 'status.json'),
        JSON.stringify({
            version: 2,
            updated_at: new Date().toISOString(),
            domain: 'app.example.com',
            current_release: '20261110000000_0.1.430',
            checks: { api: 'down', database: 'ok', redis: 'ok', web_server: 'ok', front: 'skipped', disk: { ok: true, free_bytes: 5 * 1024 ** 3 } },
        }),
    );
    writeFileSync(
        join(state, 'events.jsonl'),
        `${JSON.stringify({ id: '1', at: new Date().toISOString(), kind: 'api_restart_failed', ok: false, message: 'La app no volvió <script>alert(1)</script>' })}\n`,
    );
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=app.example.com', '-keyout', join(root, 'k.pem'), '-out', join(root, 'c.pem')], {
        stdio: 'ignore',
    });
    writeFileSync(join(root, 'rescue-tls.conf'), `CERT=${join(root, 'c.pem')}\nKEY=${join(root, 'k.pem')}\nKIND=self\n`);
    writeFileSync(
        join(root, 'rescue.conf'),
        [
            'PORT=0',
            'BIND=127.0.0.1',
            `PASSWORD_HASH=${mod.hashPassword(PASS)}`,
            'SESSION_SECRET=secreto-de-sesion-de-prueba',
            `STATE=${state}`,
            'DOMAIN=app.example.com',
            '',
        ].join('\n'),
    );
    child = spawn(process.execPath, [SCRIPT, 'serve'], {
        env: { ...process.env, RESCUE_CONF: join(root, 'rescue.conf'), RESCUE_ALLOW_ROOT: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    port = await new Promise<number>((ok, bad) => {
        let out = '';
        child.stdout!.on('data', (c: Buffer) => {
            out += c.toString();
            const m = /puerto (\d+)/.exec(out);
            if (m) ok(Number(m[1]));
        });
        child.stderr!.on('data', (c: Buffer) => (out += c.toString()));
        child.on('exit', (code) => bad(new Error(`salió con ${code}: ${out}`)));
        setTimeout(() => bad(new Error(`no arrancó: ${out}`)), 10_000);
    });
}, 30_000);

afterAll(() => {
    child?.kill();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe('deploy/guardian/imagina-rescue.mjs', () => {
    it('la clave se guarda como hash scrypt y se verifica en tiempo constante', () => {
        const h = mod.hashPassword('otra-clave-larga');
        expect(h).toMatch(/^scrypt:16384:8:1:/);
        expect(mod.verifyPassword('otra-clave-larga', h)).toBe(true);
        expect(mod.verifyPassword('otra-clave-largA', h)).toBe(false);
        expect(mod.verifyPassword('x', 'basura')).toBe(false);
        expect(mod.verifyPassword('x', '')).toBe(false);
    });

    it('«hash» lee la clave por stdin y rechaza una corta', () => {
        const out = execFileSync(process.execPath, [SCRIPT, 'hash'], { input: 'una-clave-bien-larga\n', encoding: 'utf8' });
        expect(mod.verifyPassword('una-clave-bien-larga', out.trim())).toBe(true);
        expect(() => execFileSync(process.execPath, [SCRIPT, 'hash'], { input: 'corta', stdio: 'pipe' })).toThrow();
    });

    it('sólo acepta formularios de la misma página (Sec-Fetch-Site u Origin; «null» con no-referrer)', () => {
        const h = (headers: Record<string, string>) => mod.sameSite({ headers: { host: 'a.co:8899', ...headers } });
        expect(h({ 'sec-fetch-site': 'same-origin', origin: 'https://a.co:8899' })).toBe(true);
        expect(h({ 'sec-fetch-site': 'same-origin', origin: 'null' })).toBe(true);
        expect(h({})).toBe(true);
        expect(h({ 'sec-fetch-site': 'cross-site' })).toBe(false);
        expect(h({ 'sec-fetch-site': 'same-site', origin: 'https://b.a.co' })).toBe(false);
        expect(h({ origin: 'https://otro.example' })).toBe(false);
    });

    it('el freno bloquea una IP tras 5 claves equivocadas por 15 minutos', () => {
        let t = 1_000_000;
        const lim = mod.createLimiter(() => t);
        for (let i = 0; i < 4; i++) expect(lim.fail('1.1.1.1')).toBe(false);
        expect(lim.fail('1.1.1.1')).toBe(true);
        expect(lim.blocked('1.1.1.1')).toBe(true);
        expect(lim.blocked('2.2.2.2')).toBe(false);
        t += 15 * 60_000 + 1;
        expect(lim.blocked('1.1.1.1')).toBe(false);
    });

    it('sin sesión muestra sólo el formulario de la clave, con cabeceras estrictas', async () => {
        const res = await call('GET', '/');
        expect(res.status).toBe(200);
        expect(res.body).toContain('Clave de rescate');
        expect(res.body).not.toContain('Lo que ve el guardián');
        expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
        expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.body).toContain('noindex');
        expect(res.body).not.toMatch(/<script/i);
    });

    it('una clave equivocada no entra; la correcta deja una cookie segura y queda anotada', async () => {
        const bad = await call('POST', '/entrar', { form: { clave: 'no-es' } });
        expect(bad.status).toBe(401);
        expect(bad.body).toContain('La clave no es correcta');
        expect(bad.headers['set-cookie']).toBeUndefined();
        const good = await call('POST', '/entrar', { form: { clave: PASS } });
        expect(good.status).toBe(303);
        const raw = String(good.headers['set-cookie']);
        expect(raw).toContain('HttpOnly');
        expect(raw).toContain('Secure');
        expect(raw).toContain('SameSite=Strict');
        expect(audit()).toMatch(/"what":"login","ip":"127\.0\.0\.1"/);
    });

    it('con sesión muestra lo que ve el guardián, escapado, y lo último que dijo la app', async () => {
        const { cookie } = await login();
        const page = await call('GET', '/', { cookie });
        expect(page.body).toContain('Lo que ve el guardián');
        expect(page.body).toContain('No responde');
        expect(page.body).toContain('Base de datos');
        expect(page.body).toContain('versión 0.1.430');
        expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(page.body).not.toContain('<script>alert(1)');
        expect(page.body).toContain('ECONNREFUSED');
        for (const label of ['Reparar ahora', 'Reiniciar la app', 'Volver a la versión anterior', 'Liberar espacio']) expect(page.body).toContain(label);
    });

    it('una cookie alterada vuelve al formulario', async () => {
        const { cookie } = await login();
        const page = await call('GET', '/', { cookie: `${cookie.slice(0, -2)}xx` });
        expect(page.body).toContain('Clave de rescate');
    });

    it('un pedido deja un archivo vacío con su nombre; sin el token del formulario no hace nada', async () => {
        const { cookie, csrf } = await login();
        const before = requests().length;
        const noToken = await call('POST', '/accion', { cookie, form: { que: 'restart' } });
        expect(noToken.status).toBe(400);
        const wrong = await call('POST', '/accion', { cookie, form: { que: 'rm -rf', t: csrf } });
        expect(wrong.status).toBe(400);
        expect(requests()).toHaveLength(before);

        const ok = await call('POST', '/accion', { cookie, form: { que: 'restart', t: csrf } });
        expect(ok.status).toBe(303);
        expect(ok.headers.location).toBe('/?pedido=restart');
        const made = requests().filter((f) => f.startsWith('restart-'));
        expect(made).toHaveLength(1);
        expect(statSync(join(state, 'rescue', 'requests', made[0]!)).size).toBe(0);
        const after = await call('GET', '/?pedido=restart', { cookie });
        expect(after.body).toContain('Pedido enviado: «Reiniciar la app»');
    });

    it('volver a la versión anterior pide confirmar', async () => {
        const { cookie, csrf } = await login();
        await call('POST', '/accion', { cookie, form: { que: 'rollback', t: csrf } });
        expect(requests().some((f) => f.startsWith('rollback-'))).toBe(false);
        await call('POST', '/accion', { cookie, form: { que: 'rollback', t: csrf, confirmo: 'si' } });
        expect(requests().some((f) => f.startsWith('rollback-'))).toBe(true);
    });

    it('un formulario que llega desde otro sitio se rechaza', async () => {
        const { cookie, csrf } = await login();
        const res = await call('POST', '/accion', { cookie, origin: 'https://otro.example', form: { que: 'cleanup', t: csrf } });
        expect(res.status).toBe(403);
        expect(requests().some((f) => f.startsWith('cleanup-'))).toBe(false);
    });

    it('salir borra la cookie (con el token del formulario)', async () => {
        const { cookie, csrf } = await login();
        const res = await call('POST', '/salir', { cookie, form: { t: csrf } });
        expect(res.status).toBe(303);
        expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
    });

    it('cinco claves equivocadas bloquean el ingreso (incluso con la clave buena) y queda anotado', async () => {
        for (let i = 0; i < 5; i++) await call('POST', '/entrar', { form: { clave: `mala-${i}` } });
        const res = await call('POST', '/entrar', { form: { clave: PASS } });
        expect(res.status).toBe(429);
        expect(res.body).toContain('Espera 15 minutos');
        expect(audit()).toContain('"what":"blocked"');
    }, 20_000);
});
