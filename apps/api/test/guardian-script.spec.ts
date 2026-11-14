import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * v0.1.431 (ADR-S104) — El guardián del servidor (`deploy/guardian/
 * imagina-guardian.sh`) corre como root cada minuto. Aquí corre contra un
 * servidor de mentira: `curl`, `systemctl`, `docker`, `nginx`, `df`… son dobles
 * que leen y escriben el estado del «mundo» en archivos, y registran lo que el
 * guardián les pidió.
 */
const SCRIPT = resolve(__dirname, '../../../deploy/guardian/imagina-guardian.sh');
const dirs: string[] = [];

afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface World {
    root: string;
    base: string;
    state: string;
    w: string;
    set(name: string, value: string): void;
    get(name: string): string;
    calls(): string[];
    run(): void;
    runArgs(...args: string[]): { code: number; out: string };
    conf(line: string): void;
    status(): Record<string, unknown> & { checks: Record<string, unknown> };
    events(): Array<{ kind: string; ok: boolean; message: string }>;
    request(): void;
}

function stub(bin: string, name: string, body: string): void {
    const file = join(bin, name);
    writeFileSync(file, `#!/usr/bin/env bash\nW="$WORLD"\necho "${name} $*" >> "$W/calls.log"\n${body}\n`);
    chmodSync(file, 0o755);
}

function world(): World {
    const root = mkdtempSync(join(tmpdir(), 'ib-guardian-'));
    dirs.push(root);
    const base = join(root, 'opt');
    const state = join(root, 'state');
    const lib = join(root, 'lib');
    const bin = join(root, 'bin');
    const w = join(root, 'world');
    for (const d of [base, join(base, 'releases'), join(base, 'shared', 'backups'), state, join(state, 'requests'), lib, bin, w]) mkdirSync(d, { recursive: true });
    // Tres versiones completas; la activa es la más nueva.
    for (const r of ['20261101000000_0.1.428', '20261105000000_0.1.429', '20261110000000_0.1.430']) {
        mkdirSync(join(base, 'releases', r, 'apps', 'api', 'dist'), { recursive: true });
        writeFileSync(join(base, 'releases', r, 'apps', 'api', 'dist', 'main.js'), '');
    }
    symlinkSync(join(base, 'releases', '20261110000000_0.1.430'), join(base, 'current'));
    execFileSync('touch', ['-h', '-d', '-3 days', join(base, 'current')]);

    const conf = join(root, 'guardian.conf');
    writeFileSync(
        conf,
        [`BASE=${base}`, 'DOMAIN=app.example.com', 'API_PORT=3001', 'SERVICE=imagina-api', 'PG_CONTAINER=imagina-pg', 'REDIS_SERVICE=redis-server', 'WEB_MODE=serveravatar', ''].join('\n'),
    );
    const defaults: Record<string, string> = { api: 'up', bad_release: '', front: 'ok', pg: 'true', redis: 'active', nginx: 'active', repair: 'ok', restart_fixes: '1', low_disk: '0', nginx_T: '', rescue: 'active' };
    for (const [k, v] of Object.entries(defaults)) writeFileSync(join(w, k), v);
    writeFileSync(join(w, 'calls.log'), '');

    // La app responde si está «up» y la versión activa no es la rota.
    stub(
        bin,
        'curl',
        `url="\${@: -1}"
api_ok() { [ "$(cat "$W/api")" = up ] && [ "$(readlink -f "$BASE_DIR/current")" != "$(cat "$W/bad_release")" ]; }
case "$url" in
  http://127.0.0.1:*) if api_ok; then printf 200; exit 0; else printf 000; exit 7; fi ;;
  https://*/api/v1/health/live) if [ "$(cat "$W/front")" = ok ]; then printf 200; else printf 404; fi; exit 0 ;;
  https://*/) if [ "$(cat "$W/front")" = ok ]; then printf 200; else printf 403; fi; exit 0 ;;
esac
printf 000; exit 7`,
    );
    stub(
        bin,
        'systemctl',
        `case "$1" in
  is-active) svc="\${@: -1}"; case "$svc" in nginx) [ "$(cat "$W/nginx")" = active ];; redis-server) [ "$(cat "$W/redis")" = active ];; imagina-rescue) [ "$(cat "$W/rescue")" = active ];; *) exit 0;; esac; exit $? ;;
  restart|start) svc="$2"; case "$svc" in
      imagina-api) [ "$(cat "$W/restart_fixes")" = 1 ] && echo up > "$W/api";;
      redis-server) echo active > "$W/redis";;
      nginx) echo active > "$W/nginx";;
      imagina-rescue) echo active > "$W/rescue";;
    esac; exit 0 ;;
esac
exit 0`,
    );
    stub(
        bin,
        'docker',
        `case "$1" in
  inspect) v=$(cat "$W/pg"); [ "$v" = missing ] && exit 1; echo "$v" ;;
  start) echo true > "$W/pg"; echo "$2" ;;
esac
exit 0`,
    );
    stub(bin, 'nginx', '[ "$1" = -T ] && cat "$W/nginx_T"; exit 0');
    stub(bin, 'journalctl', 'echo "boom: no arranca"; exit 0');
    stub(bin, 'apt-get', 'exit 0');
    stub(bin, 'sleep', 'exit 0');
    // Disco: con más de 3 versiones guardadas queda «lleno».
    stub(
        bin,
        'df',
        `n=$(ls -1 "$BASE_DIR/releases" | wc -l)
low=$(cat "$W/low_disk")
if [ "$2" = "-Pi" ] || [ "$1" = "-Pi" ]; then echo "Filesystem Inodes IUsed IFree IUse% Mounted"; echo "/dev/x 1000000 10 900000 1% /"; exit 0; fi
echo "Filesystem 1-blocks Used Available Capacity Mounted"
if [ "$low" = 1 ] && [ "$n" -gt 3 ]; then echo "/dev/x 107374182400 107000000000 300000000 99% /"; else echo "/dev/x 107374182400 50000000000 50000000000 50% /"; fi`,
    );
    writeFileSync(
        join(lib, 'serveravatar-nginx.sh'),
        `#!/usr/bin/env bash\necho "nginx-repair $*" >> "$WORLD/calls.log"\nif [ "$(cat "$WORLD/repair")" = ok ]; then echo ok > "$WORLD/front"; echo "  listo"; exit 0; fi\necho "ERROR: no encontré un 'location /'"; exit 1\n`,
    );
    chmodSync(join(lib, 'serveravatar-nginx.sh'), 0o755);

    const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        WORLD: w,
        BASE_DIR: base,
        GUARDIAN_CONF: conf,
        GUARDIAN_STATE: state,
        GUARDIAN_LIB: lib,
        GUARDIAN_LOCK: join(root, 'guardian.lock'),
    };
    return {
        root,
        base,
        state,
        w,
        set: (name, value) => writeFileSync(join(w, name), value),
        get: (name) => readFileSync(join(w, name), 'utf8').trim(),
        calls: () => readFileSync(join(w, 'calls.log'), 'utf8').split('\n').filter(Boolean),
        run: () => {
            writeFileSync(join(w, 'calls.log'), '');
            execFileSync('bash', [SCRIPT], { env, stdio: 'pipe' });
        },
        runArgs: (...args) => {
            writeFileSync(join(w, 'calls.log'), '');
            const r = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' });
            return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
        },
        conf: (line) => writeFileSync(conf, `${readFileSync(conf, 'utf8')}${line}\n`),
        status: () => JSON.parse(readFileSync(join(state, 'status.json'), 'utf8')),
        events: () => {
            const f = join(state, 'events.jsonl');
            if (!existsSync(f)) return [];
            return readFileSync(f, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((l) => JSON.parse(l));
        },
        request: () => writeFileSync(join(state, 'requests', 'repair-1'), 'cualquier cosa; rm -rf /'),
    };
}

describe('deploy/guardian/imagina-guardian.sh', () => {
    it('todo sano: estado completo en JSON válido y ninguna acción', () => {
        const s = world();
        s.run();
        const st = s.status();
        expect(st.version).toBe(2);
        expect(st.rescue).toEqual({ enabled: false, port: 8899, cert: 'none', active: false });
        expect(st.checks).toMatchObject({ api: 'ok', database: 'ok', redis: 'ok', web_server: 'ok', front: 'ok' });
        expect((st.checks.disk as { ok: boolean }).ok).toBe(true);
        expect(st.current_release).toBe('20261110000000_0.1.430');
        expect(s.events()).toEqual([]);
        expect(s.calls().some((c) => c.startsWith('systemctl restart'))).toBe(false);
    });

    it('ServerAvatar reescribió Nginx (la raíz da 403): repone la configuración y avisa', () => {
        const s = world();
        s.set('front', 'down');
        s.run();
        expect(s.calls()).toContain('nginx-repair app.example.com');
        expect(s.status().checks.front).toBe('ok');
        const ev = s.events();
        expect(ev).toHaveLength(1);
        expect(ev[0]).toMatchObject({ kind: 'nginx_repaired', ok: true });
    });

    it('si la reparación de Nginx falla, lo dice con el motivo y no insiste más de 6 veces por hora', () => {
        const s = world();
        s.set('front', 'down');
        s.set('repair', 'fail');
        for (let i = 0; i < 8; i++) s.run();
        const ev = s.events();
        expect(ev.filter((e) => e.kind === 'nginx_repair_failed')).toHaveLength(6);
        expect(ev[0]!.message).toContain("no encontré un 'location /'");
        expect(ev.filter((e) => e.kind === 'needs_attention')).toHaveLength(1);
        expect(s.status().checks.front).toBe('down');
    });

    it('la app no responde: espera 3 minutos y recién ahí la reinicia', () => {
        const s = world();
        s.set('api', 'down');
        s.run();
        s.run();
        expect(s.calls().some((c) => c.startsWith('systemctl restart imagina-api'))).toBe(false);
        expect(s.status().checks.api).toBe('down');
        s.run();
        expect(s.calls()).toContain('systemctl restart imagina-api');
        expect(s.status().checks.api).toBe('ok');
        expect(s.events().map((e) => e.kind)).toEqual(['api_restarted']);
    });

    it('un pedido de la app adelanta la revisión (y su contenido nunca se ejecuta)', () => {
        const s = world();
        s.set('api', 'down');
        s.request();
        s.run();
        expect(s.calls()).toContain('systemctl restart imagina-api');
        expect(s.status().requested).toBe(true);
        expect(existsSync(join(s.state, 'requests', 'repair-1'))).toBe(false);
        expect(existsSync(s.base)).toBe(true);
    });

    it('no vuelve a arrancar más de 3 veces por hora: después pide que alguien la revise', () => {
        const s = world();
        s.set('api', 'down');
        s.set('restart_fixes', '0');
        for (let i = 0; i < 12; i++) s.run();
        const kinds = s.events().map((e) => e.kind);
        expect(kinds.filter((k) => k === 'api_restart_failed')).toHaveLength(3);
        expect(kinds.filter((k) => k === 'needs_attention')).toHaveLength(1);
        expect(s.events()[0]!.message).toContain('boom: no arranca');
    });

    it('la app no arranca tras una actualización: vuelve a la versión anterior una sola vez', () => {
        const s = world();
        const bad = join(s.base, 'releases', '20261110000000_0.1.430');
        execFileSync('touch', ['-h', '-d', '-10 minutes', join(s.base, 'current')]);
        s.set('bad_release', bad);
        s.set('restart_fixes', '0');
        s.run();
        s.run();
        s.run();
        expect(readlinkSync(join(s.base, 'current'))).toBe(join(s.base, 'releases', '20261105000000_0.1.429'));
        expect(s.events()).toEqual([expect.objectContaining({ kind: 'rolled_back', ok: true })]);
        expect(s.events()[0]!.message).toContain('20261110000000_0.1.430');
        expect(s.status().checks.api).toBe('ok');
    });

    it('si la versión anterior tampoco arranca, no sigue bajando de versión en cadena', () => {
        const s = world();
        execFileSync('touch', ['-h', '-d', '-10 minutes', join(s.base, 'current')]);
        s.set('api', 'down');
        s.set('restart_fixes', '0');
        for (let i = 0; i < 8; i++) {
            s.run();
            // El guardián cambia el symlink: que no parezca «se está instalando».
            execFileSync('touch', ['-h', '-d', '-10 minutes', join(s.base, 'current')]);
        }
        const kinds = s.events().map((e) => e.kind);
        expect(kinds.filter((k) => k === 'rollback_failed')).toHaveLength(1);
        expect(kinds.filter((k) => k === 'rolled_back')).toHaveLength(0);
        expect(readlinkSync(join(s.base, 'current'))).toBe(join(s.base, 'releases', '20261105000000_0.1.429'));
    });

    it('justo después de instalar una versión no toca la app (el actualizador la está reiniciando)', () => {
        const s = world();
        execFileSync('touch', ['-h', '-d', '-30 seconds', join(s.base, 'current')]);
        s.set('api', 'down');
        for (let i = 0; i < 4; i++) s.run();
        expect(s.status().checks.api).toBe('updating');
        expect(s.events()).toEqual([]);
    });

    it('la base de datos detenida se vuelve a levantar', () => {
        const s = world();
        s.set('pg', 'false');
        s.run();
        expect(s.calls()).toContain('docker start imagina-pg');
        expect(s.status().checks.database).toBe('ok');
        expect(s.events()[0]).toMatchObject({ kind: 'postgres_started', ok: true });
    });

    it('Redis y Nginx detenidos se vuelven a levantar', () => {
        const s = world();
        s.set('redis', 'inactive');
        s.set('nginx', 'inactive');
        s.run();
        expect(s.calls()).toEqual(expect.arrayContaining(['systemctl restart redis-server', 'systemctl start nginx']));
        expect(s.events().map((e) => e.kind).sort()).toEqual(['nginx_started', 'redis_restarted']);
    });

    it('disco casi lleno: borra versiones viejas (nunca la activa) y lo cuenta', () => {
        const s = world();
        for (const r of ['20261001000000_0.1.420', '20261010000000_0.1.425']) {
            mkdirSync(join(s.base, 'releases', r, 'apps', 'api', 'dist'), { recursive: true });
            writeFileSync(join(s.base, 'releases', r, 'apps', 'api', 'dist', 'main.js'), '');
        }
        for (let i = 0; i < 8; i++) writeFileSync(join(s.base, 'shared', 'backups', `imagina-base-2026110${i}T000000Z.dump`), 'x');
        s.set('low_disk', '1');
        s.run();
        const left = readFileSync(join(s.w, 'calls.log'), 'utf8');
        expect(left).toContain('journalctl --vacuum-size=200M');
        expect(existsSync(join(s.base, 'releases', '20261110000000_0.1.430'))).toBe(true);
        expect(existsSync(join(s.base, 'releases', '20261105000000_0.1.429'))).toBe(true);
        expect(existsSync(join(s.base, 'releases', '20261101000000_0.1.428'))).toBe(true);
        expect(existsSync(join(s.base, 'releases', '20261001000000_0.1.420'))).toBe(false);
        expect(existsSync(join(s.base, 'releases', '20261010000000_0.1.425'))).toBe(false);
        expect(execFileSync('ls', [join(s.base, 'shared', 'backups')], { encoding: 'utf8' }).trim().split('\n')).toHaveLength(5);
        expect(s.events()[0]).toMatchObject({ kind: 'disk_cleaned', ok: true });
        expect((s.status().checks.disk as { ok: boolean }).ok).toBe(true);
    });

    it('--check --human dice en palabras lo que está mal y no arregla nada ni toca el estado', () => {
        const s = world();
        s.set('api', 'down');
        s.set('pg', 'false');
        const r = s.runArgs('--check', '--human');
        expect(r.code).toBe(0);
        expect(r.out).toContain('sólo revisar');
        expect(r.out).toContain('✗ Base de datos: detenida');
        expect(r.out).toContain('✗ La app: no responde');
        expect(r.out).toContain('sudo imagina-reparar');
        expect(s.calls().some((c) => c.startsWith('docker start') || c.startsWith('systemctl restart'))).toBe(false);
        expect(existsSync(join(s.state, 'status.json'))).toBe(false);
        expect(s.events()).toEqual([]);
    });

    it('--check no se combina con una reparación', () => {
        const s = world();
        expect(s.runArgs('--check', '--force').code).toBe(2);
        expect(s.runArgs('--algo').code).toBe(2);
    });

    it('--force arregla ya: la app caída se reinicia sin esperar los 3 minutos', () => {
        const s = world();
        s.set('api', 'down');
        const r = s.runArgs('--force', '--human');
        expect(s.calls()).toContain('systemctl restart imagina-api');
        expect(r.out).toContain('Listo: todo funciona.');
        expect(s.status().checks.api).toBe('ok');
    });

    it('--force salta el límite por hora (después de 3 reinicios fallidos, igual reintenta)', () => {
        const s = world();
        s.set('api', 'down');
        s.set('restart_fixes', '0');
        for (let i = 0; i < 6; i++) s.run();
        s.set('restart_fixes', '1');
        s.run();
        expect(s.calls()).not.toContain('systemctl restart imagina-api');
        const r = s.runArgs('--force', '--human');
        expect(s.calls()).toContain('systemctl restart imagina-api');
        expect(r.code).toBe(0);
        expect(s.status().checks.api).toBe('ok');
    });

    it('--restart reinicia la app aunque funcione, y lo anota «por SSH»', () => {
        const s = world();
        s.runArgs('--restart', '--human');
        expect(s.calls()).toContain('systemctl restart imagina-api');
        expect(s.events()).toEqual([expect.objectContaining({ kind: 'manual_restart', ok: true })]);
        expect(s.events()[0]!.message).toContain('por SSH');
    });

    it('--rollback vuelve a la versión anterior aunque la actual sea vieja (sólo el código)', () => {
        const s = world();
        const r = s.runArgs('--rollback', '--human');
        expect(readlinkSync(join(s.base, 'current'))).toBe(join(s.base, 'releases', '20261105000000_0.1.429'));
        expect(s.events()).toEqual([expect.objectContaining({ kind: 'manual_rollback', ok: true })]);
        expect(s.events()[0]!.message).toContain('Los datos no se tocaron');
        expect(r.out).toContain('versión anterior');
    });

    it('--cleanup libera espacio aunque el disco no esté lleno', () => {
        const s = world();
        s.runArgs('--cleanup', '--human');
        expect(s.calls()).toContain('journalctl --vacuum-size=200M');
        expect(s.events().map((e) => e.kind)).toContain('manual_cleanup');
    });

    it('un pedido de la página de rescate se hace por su NOMBRE (y nunca se lee el contenido)', () => {
        const s = world();
        mkdirSync(join(s.state, 'rescue', 'requests'), { recursive: true });
        writeFileSync(join(s.state, 'rescue', 'requests', 'rollback-1700000000000'), 'rm -rf /');
        s.run();
        expect(readlinkSync(join(s.base, 'current'))).toBe(join(s.base, 'releases', '20261105000000_0.1.429'));
        expect(s.events()[0]!.message).toContain('desde la página de rescate');
        expect(readdirSync(join(s.state, 'rescue', 'requests'))).toEqual([]);
        expect(s.status().requested).toBe(true);
    });

    it('un pedido de la APP con nombre de acción sólo adelanta la revisión (no vuelve atrás)', () => {
        const s = world();
        writeFileSync(join(s.state, 'requests', 'rollback-1'), '');
        s.run();
        expect(readlinkSync(join(s.base, 'current'))).toBe(join(s.base, 'releases', '20261110000000_0.1.430'));
        expect(s.events()).toEqual([]);
    });

    it('página de rescate: toma el certificado del dominio de Nginx y la reinicia cuando se renueva', () => {
        const s = world();
        const crt = join(s.root, 'fullchain.pem');
        const key = join(s.root, 'privkey.pem');
        writeFileSync(crt, 'c');
        writeFileSync(key, 'k');
        s.set(
            'nginx_T',
            `# configuration file /etc/nginx/x.conf:\nserver {\n  listen 443 ssl;\n  server_name otro.example.com;\n  ssl_certificate /no/existe.pem;\n  ssl_certificate_key /no/existe.key;\n}\nserver {\n  listen 443 ssl;\n  server_name app.example.com www.app.example.com;\n  ssl_certificate ${crt};\n  ssl_certificate_key ${key}; # comentario\n  location / { try_files $uri /index.html; }\n}\n`,
        );
        s.conf('RESCUE_ENABLED=1');
        s.conf('RESCUE_PORT=8899');
        s.run();
        const tls = readFileSync(join(s.root, 'rescue-tls.conf'), 'utf8');
        expect(tls).toContain(`CERT=${crt}`);
        expect(tls).toContain(`KEY=${key}`);
        expect(tls).toContain('KIND=domain');
        expect(s.status().rescue).toEqual({ enabled: true, port: 8899, cert: 'domain', active: true });
        expect(s.calls()).not.toContain('systemctl restart imagina-rescue');
        execFileSync('touch', ['-d', '+1 minute', crt]);
        s.run();
        expect(s.calls()).toContain('systemctl restart imagina-rescue');
    });

    it('página de rescate: sin el del dominio usa el certificado propio, y la levanta si se cayó', () => {
        const s = world();
        writeFileSync(join(s.root, 'rescue-self.crt'), 'c');
        writeFileSync(join(s.root, 'rescue-self.key'), 'k');
        s.conf('RESCUE_ENABLED=1');
        s.set('rescue', 'inactive');
        s.run();
        expect(readFileSync(join(s.root, 'rescue-tls.conf'), 'utf8')).toContain('KIND=self');
        expect(s.calls()).toContain('systemctl restart imagina-rescue');
        expect(s.status().rescue).toMatchObject({ cert: 'self', active: true });
    });

    it('página de rescate: quién entró llega a los eventos (sólo los campos con forma conocida)', () => {
        const s = world();
        writeFileSync(join(s.root, 'rescue-self.crt'), 'c');
        writeFileSync(join(s.root, 'rescue-self.key'), 'k');
        s.conf('RESCUE_ENABLED=1');
        mkdirSync(join(s.state, 'rescue'), { recursive: true });
        writeFileSync(
            join(s.state, 'rescue', 'audit.jsonl'),
            [
                JSON.stringify({ at: 'x', what: 'login', ip: '190.25.1.2' }),
                JSON.stringify({ at: 'x', what: 'blocked', ip: '2001:db8::1' }),
                JSON.stringify({ at: 'x', what: 'login', ip: '$(rm -rf /)' }),
                'basura',
                '',
            ].join('\n'),
        );
        s.run();
        const ev = s.events();
        expect(ev.map((e) => e.kind)).toEqual(['rescue_login', 'rescue_blocked', 'rescue_login']);
        expect(ev[0]!.message).toContain('190.25.1.2');
        expect(ev[1]!.message).toContain('2001:db8::1');
        expect(ev[2]!.message).not.toContain('rm -rf');
        expect(readFileSync(join(s.state, 'rescue', 'audit.jsonl'), 'utf8')).toBe('');
        expect(readFileSync(join(s.state, 'rescue', 'app-log.txt'), 'utf8')).toContain('boom');
    });

    it('un mensaje con comillas y saltos de línea sigue siendo JSON válido', () => {
        const s = world();
        s.set('front', 'down');
        s.set('repair', 'fail');
        writeFileSync(
            join(s.root, 'lib', 'serveravatar-nginx.sh'),
            '#!/usr/bin/env bash\nprintf \'línea "uno"\\n\\tdos \\\\ tres\\n\'; exit 1\n',
        );
        s.run();
        expect(s.events()[0]!.message).toContain('línea "uno"');
    });
});

const INSTALLER = resolve(__dirname, '../../../deploy/install-guardian.sh');

describe('deploy/install-guardian.sh', () => {
    // Como root (el servidor) instala a nombre de root y le da `requests/` al
    // usuario del servicio. En el CI no hay root: instala a nombre de quien corre
    // la prueba (GUARDIAN_OWNER) y el «usuario del servicio» es ese mismo.
    const asRoot = process.getuid?.() === 0;
    const me = userInfo().username;
    const appUser = asRoot ? 'nobody' : me;
    const owner = asRoot ? 'root' : me;
    // El usuario de la página de rescate: uno que ya existe (no se crea).
    const rescueUser = asRoot ? 'nobody' : me;

    function install(nginxConf: string, opts: { caddy?: boolean; args?: string[]; again?: string } = {}) {
        const root = opts.again ?? mkdtempSync(join(tmpdir(), 'ib-guardian-install-'));
        if (!opts.again) dirs.push(root);
        const base = join(root, 'opt');
        const bin = join(root, 'bin');
        const site = join(root, 'site.conf');
        mkdirSync(join(base, 'shared'), { recursive: true });
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(base, 'shared', '.env.production'), 'NODE_ENV=production\nAPP_BASE_URL="https://app.example.com/"\nPORT=3001\nMAIL_FROM=Imagina Base <x@y.z>\n');
        writeFileSync(site, nginxConf);
        writeFileSync(join(root, 'calls.log'), '');
        const s = (name: string, body: string) => {
            writeFileSync(join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${root}/calls.log"\n${body}\n`);
            chmodSync(join(bin, name), 0o755);
        };
        s(
            'systemctl',
            `case "$1" in
  show) case "$*" in *ExecStart*) echo "{ path=${process.execPath} ; argv[]=${process.execPath} dist/main.js ; }" ;; *) echo ${appUser} ;; esac ;;
  is-active) [ "\${@: -1}" = caddy ] && exit ${opts.caddy ? 0 : 3}; exit 0 ;;
  list-unit-files) [ "$2" = redis-server.service ] && echo "redis-server.service enabled enabled" ;;
esac
exit 0`,
        );
        s('docker', 'echo "imagina-base-postgres-1 postgres:16-alpine"; echo "otra nginx:1"');
        s('nginx', `[ "$1" = -T ] && { echo "# configuration file ${site}:"; cat "${site}"; }; exit 0`);
        s('ufw', '[ "$1" = status ] && echo "Status: active"; exit 0');
        s('ss', 'exit 0');
        s('useradd', 'exit 1');
        const env = {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            BASE_PATH: base,
            GUARDIAN_LIB: join(root, 'lib'),
            GUARDIAN_CONF_DIR: join(root, 'etc'),
            GUARDIAN_STATE: join(root, 'var', 'guardian'),
            GUARDIAN_UNIT_DIR: join(root, 'units'),
            GUARDIAN_BIN_DIR: join(root, 'usr-bin'),
            GUARDIAN_RESCUE_USER: rescueUser,
            ...(asRoot ? {} : { GUARDIAN_OWNER: me }),
        };
        mkdirSync(join(root, 'units'), { recursive: true });
        writeFileSync(join(root, 'calls.log'), '');
        const r = spawnSync('bash', [INSTALLER, ...(opts.args ?? [])], { env, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`el instalador falló (${r.status}): ${r.stdout}${r.stderr}`);
        const out = r.stdout;
        const conf = readFileSync(join(root, 'etc', 'guardian.conf'), 'utf8');
        return { root, out, conf, calls: readFileSync(join(root, 'calls.log'), 'utf8') };
    }
    const SA = 'server {\n  server_name app.example.com;\n  include /etc/nginx/imagina-base.locations;  # Imagina Base\n}\n';

    it('detecta dominio, base de datos, Redis y el modo ServerAvatar; deja todo de root y programa el timer', () => {
        const { root, conf, calls } = install('server {\n  server_name app.example.com;\n  include /etc/nginx/imagina-base.locations;  # Imagina Base\n}\n');
        expect(conf).toContain('DOMAIN=app.example.com');
        expect(conf).toContain('PG_CONTAINER=imagina-base-postgres-1');
        expect(conf).toContain('REDIS_SERVICE=redis-server');
        expect(conf).toContain('WEB_MODE=serveravatar');
        expect(conf).toContain(`APP_USER=${appUser}`);
        expect(existsSync(join(root, 'lib', 'imagina-guardian.sh'))).toBe(true);
        expect(existsSync(join(root, 'lib', 'serveravatar-nginx.sh'))).toBe(true);
        for (const u of ['imagina-guardian.service', 'imagina-guardian.timer', 'imagina-guardian.path']) expect(existsSync(join(root, 'units', u))).toBe(true);
        expect(calls).toContain('systemctl enable --now imagina-guardian.timer imagina-guardian.path');
        const perm = execFileSync('stat', ['-c', '%U %a', join(root, 'var', 'guardian', 'requests')], { encoding: 'utf8' }).trim();
        expect(perm).toBe(`${appUser} 700`);
        expect(execFileSync('stat', ['-c', '%U', join(root, 'lib', 'imagina-guardian.sh')], { encoding: 'utf8' }).trim()).toBe(owner);
    });

    it('instala la página de rescate: clave mostrada una vez y guardada como hash, unidad, comandos y firewall', async () => {
        const { root, out, conf, calls } = install(SA);
        expect(conf).toContain('RESCUE_ENABLED=1');
        expect(conf).toContain('RESCUE_PORT=8899');
        expect(conf).toContain(`RESCUE_USER=${rescueUser}`);
        const pass = /Clave: (\S+)/.exec(out)?.[1] ?? '';
        expect(pass).toMatch(/^[a-zA-Z2-9]{5}-[a-zA-Z2-9]{5}-[a-zA-Z2-9]{5}-[a-zA-Z2-9]{5}$/);
        expect(out).toContain('https://app.example.com:8899');
        expect(out).toContain('Firewall');
        const rconf = readFileSync(join(root, 'etc', 'rescue.conf'), 'utf8');
        expect(rconf).not.toContain(pass);
        const hash = /PASSWORD_HASH=(\S+)/.exec(rconf)![1]!;
        const mod = (await import(resolve(__dirname, '../../../deploy/guardian/imagina-rescue.mjs'))) as { verifyPassword(p: string, h: string): boolean };
        expect(mod.verifyPassword(pass, hash)).toBe(true);
        expect(rconf).toMatch(/SESSION_SECRET=[0-9a-f]{64}/);
        expect(rconf).toContain(`NODE=${process.execPath}`);
        expect(execFileSync('stat', ['-c', '%a', join(root, 'etc', 'rescue.conf')], { encoding: 'utf8' }).trim()).toBe('600');
        const unit = readFileSync(join(root, 'units', 'imagina-rescue.service'), 'utf8');
        expect(unit).toContain(`ExecStart=${process.execPath} ${join(root, 'lib')}/imagina-rescue.mjs serve`);
        expect(unit).toContain(`ReadWritePaths=${join(root, 'var', 'guardian')}/rescue`);
        expect(unit).not.toContain('@');
        expect(readFileSync(join(root, 'units', 'imagina-guardian.path'), 'utf8')).toContain('rescue/requests/*');
        for (const cmd of ['imagina-estado', 'imagina-reparar', 'imagina-rescate']) {
            const body = readFileSync(join(root, 'usr-bin', cmd), 'utf8');
            expect(body).toContain(join(root, 'lib'));
            expect(body).not.toContain('@LIB@');
        }
        const rdir = join(root, 'var', 'guardian', 'rescue');
        expect(execFileSync('stat', ['-c', '%a', rdir], { encoding: 'utf8' }).trim()).toBe('750');
        expect(execFileSync('stat', ['-c', '%U %a', join(rdir, 'requests')], { encoding: 'utf8' }).trim()).toBe(`${rescueUser} 700`);
        expect(execFileSync('stat', ['-c', '%U %a', join(rdir, 'audit.jsonl')], { encoding: 'utf8' }).trim()).toBe(`${rescueUser} 600`);
        expect(existsSync(join(root, 'etc', 'rescue-self.crt'))).toBe(true);
        expect(calls).toContain('ufw allow 8899/tcp');
        expect(calls).toContain('systemctl enable imagina-rescue');
        expect(calls).toContain('systemctl restart imagina-rescue');
        expect(calls).not.toContain('useradd');
    });

    it('volver a correrlo conserva la clave (no la muestra de nuevo); --puerto y --sin-rescate se respetan', () => {
        const first = install(SA, { args: ['--puerto', '9001'] });
        const hash1 = readFileSync(join(first.root, 'etc', 'rescue.conf'), 'utf8');
        expect(first.conf).toContain('RESCUE_PORT=9001');
        const again = install(SA, { again: first.root });
        expect(again.out).not.toMatch(/Clave: /);
        expect(again.out).toContain('La clave es la de antes');
        expect(again.conf).toContain('RESCUE_PORT=9001');
        expect(readFileSync(join(first.root, 'etc', 'rescue.conf'), 'utf8')).toBe(hash1);
        const off = install(SA, { again: first.root, args: ['--sin-rescate'] });
        expect(off.conf).toContain('RESCUE_ENABLED=0');
        expect(off.calls).toContain('systemctl disable --now imagina-rescue');
        expect(off.out).not.toContain('Página de rescate:');
    });

    it('un puerto que no sirve se rechaza con el motivo', () => {
        for (const p of ['80', '3001', 'abc']) {
            expect(() => install(SA, { args: ['--puerto', p] })).toThrow(/puerto/);
        }
    });

    it('una configuración de Nginx armada a mano no se reescribe (modo nginx)', () => {
        const { conf } = install('server {\n  server_name app.example.com;\n  location /api/ { proxy_pass http://127.0.0.1:3001; }\n}\n');
        expect(conf).toContain('WEB_MODE=nginx');
    });

    it('con Caddy, el modo es caddy', () => {
        const { conf } = install('', { caddy: true });
        expect(conf).toContain('WEB_MODE=caddy');
    });
});


const CMD_DIR = resolve(__dirname, '../../../deploy/guardian');

describe('comandos por SSH (imagina-estado, imagina-reparar, imagina-rescate)', () => {
    // Un guardián de mentira que sólo anota con qué lo llamaron.
    function fake() {
        const root = mkdtempSync(join(tmpdir(), 'ib-guardian-cmd-'));
        dirs.push(root);
        const lib = join(root, 'lib');
        const bin = join(root, 'bin');
        const etc = join(root, 'etc');
        for (const d of [lib, bin, etc]) mkdirSync(d);
        writeFileSync(join(lib, 'imagina-guardian.sh'), `#!/usr/bin/env bash\necho "guardian $*" >> "${root}/calls.log"\necho "salida del guardián"\n`);
        chmodSync(join(lib, 'imagina-guardian.sh'), 0o755);
        execFileSync('cp', [join(CMD_DIR, 'imagina-rescue.mjs'), join(lib, 'imagina-rescue.mjs')]);
        writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash\necho "systemctl $*" >> "${root}/calls.log"\nexit 0\n`);
        chmodSync(join(bin, 'systemctl'), 0o755);
        writeFileSync(join(root, 'calls.log'), '');
        const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GUARDIAN_TEST: '1', GUARDIAN_LIB: lib, GUARDIAN_CONF_DIR: etc };
        const run = (cmd: string, args: string[] = [], input = '') => {
            writeFileSync(join(root, 'calls.log'), '');
            const r = spawnSync('bash', [join(CMD_DIR, cmd), ...args], { env, input, encoding: 'utf8' });
            return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}`, calls: readFileSync(join(root, 'calls.log'), 'utf8').trim() };
        };
        return { root, etc, run };
    }

    it('imagina-estado sólo revisa', () => {
        const f = fake();
        const r = f.run('imagina-estado');
        expect(r.calls).toBe('guardian --check --human');
        expect(r.out).toContain('salida del guardián');
        expect(f.run('imagina-estado', ['reparar']).code).toBe(2);
    });

    it('imagina-reparar traduce lo que se pide y pide confirmar la vuelta atrás', () => {
        const f = fake();
        expect(f.run('imagina-reparar').calls).toBe('guardian --force --human');
        expect(f.run('imagina-reparar', ['reiniciar']).calls).toBe('guardian --restart --human');
        expect(f.run('imagina-reparar', ['espacio']).calls).toBe('guardian --cleanup --human');
        const no = f.run('imagina-reparar', ['version-anterior'], 'no\n');
        expect(no.calls).toBe('');
        expect(no.out).toContain('No se hizo nada');
        expect(f.run('imagina-reparar', ['version-anterior'], 'SI\n').calls).toBe('guardian --rollback --human');
        expect(f.run('imagina-reparar', ['version-anterior', '-y']).calls).toBe('guardian --rollback --human');
        const bad = f.run('imagina-reparar', ['borrar-todo']);
        expect(bad.code).toBe(2);
        expect(bad.calls).toBe('');
    });

    it('imagina-rescate clave crea una clave nueva, rota el secreto de las sesiones y la muestra una vez', async () => {
        const f = fake();
        writeFileSync(join(f.etc, 'guardian.conf'), 'DOMAIN=app.example.com\nRESCUE_ENABLED=1\nRESCUE_PORT=8899\n');
        writeFileSync(join(f.etc, 'rescue.conf'), `PORT=8899\nPASSWORD_HASH=scrypt:vieja\nSESSION_SECRET=viejo\nNODE=${process.execPath}\n`);
        const r = f.run('imagina-rescate', ['clave']);
        expect(r.code).toBe(0);
        const pass = /^\s+(\S{5}-\S{5}-\S{5}-\S{5})$/m.exec(r.out)?.[1] ?? '';
        expect(pass).not.toBe('');
        const conf = readFileSync(join(f.etc, 'rescue.conf'), 'utf8');
        expect(conf).not.toContain('scrypt:vieja');
        expect(conf).not.toContain('SESSION_SECRET=viejo');
        expect(conf).toContain('PORT=8899');
        const mod = (await import(join(CMD_DIR, 'imagina-rescue.mjs'))) as { verifyPassword(p: string, h: string): boolean };
        expect(mod.verifyPassword(pass, /PASSWORD_HASH=(\S+)/.exec(conf)![1]!)).toBe(true);
        expect(r.out).toContain('https://app.example.com:8899');
    });

    it('imagina-rescate apagar / encender cambian la configuración del guardián', () => {
        const f = fake();
        writeFileSync(join(f.etc, 'guardian.conf'), 'DOMAIN=app.example.com\nRESCUE_ENABLED=1\n');
        writeFileSync(join(f.etc, 'rescue.conf'), 'PORT=8899\n');
        expect(f.run('imagina-rescate', ['apagar']).calls).toContain('systemctl disable --now imagina-rescue');
        expect(readFileSync(join(f.etc, 'guardian.conf'), 'utf8')).toContain('RESCUE_ENABLED=0');
        expect(f.run('imagina-rescate').out).toContain('está apagada');
        const on = f.run('imagina-rescate', ['encender']);
        expect(on.calls).toContain('systemctl enable imagina-rescue');
        expect(on.calls).toContain('guardian');
        expect(readFileSync(join(f.etc, 'guardian.conf'), 'utf8')).toContain('RESCUE_ENABLED=1');
    });

    it('sin la instalación dice cómo instalarla', () => {
        const f = fake();
        const r = f.run('imagina-rescate');
        expect(r.code).toBe(1);
        expect(r.out).toContain('install-guardian.sh');
    });
});
