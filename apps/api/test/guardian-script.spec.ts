import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    const defaults: Record<string, string> = { api: 'up', bad_release: '', front: 'ok', pg: 'true', redis: 'active', nginx: 'active', repair: 'ok', restart_fixes: '1', low_disk: '0' };
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
  is-active) svc="\${@: -1}"; case "$svc" in nginx) [ "$(cat "$W/nginx")" = active ];; redis-server) [ "$(cat "$W/redis")" = active ];; *) exit 0;; esac; exit $? ;;
  restart|start) svc="$2"; case "$svc" in
      imagina-api) [ "$(cat "$W/restart_fixes")" = 1 ] && echo up > "$W/api";;
      redis-server) echo active > "$W/redis";;
      nginx) echo active > "$W/nginx";;
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
    stub(bin, 'nginx', 'exit 0');
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
        expect(st.version).toBe(1);
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
    function install(nginxConf: string, opts: { caddy?: boolean } = {}) {
        const root = mkdtempSync(join(tmpdir(), 'ib-guardian-install-'));
        dirs.push(root);
        const base = join(root, 'opt');
        const bin = join(root, 'bin');
        const site = join(root, 'site.conf');
        mkdirSync(join(base, 'shared'), { recursive: true });
        mkdirSync(bin);
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
  show) echo nobody ;;
  is-active) [ "\${@: -1}" = caddy ] && exit ${opts.caddy ? 0 : 3}; exit 0 ;;
  list-unit-files) [ "$2" = redis-server.service ] && echo "redis-server.service enabled enabled" ;;
esac
exit 0`,
        );
        s('docker', 'echo "imagina-base-postgres-1 postgres:16-alpine"; echo "otra nginx:1"');
        s('nginx', `[ "$1" = -T ] && { echo "# configuration file ${site}:"; cat "${site}"; }; exit 0`);
        const env = {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            BASE_PATH: base,
            GUARDIAN_LIB: join(root, 'lib'),
            GUARDIAN_CONF_DIR: join(root, 'etc'),
            GUARDIAN_STATE: join(root, 'var', 'guardian'),
            GUARDIAN_UNIT_DIR: join(root, 'units'),
        };
        mkdirSync(join(root, 'units'));
        const out = execFileSync('bash', [INSTALLER], { env, encoding: 'utf8', stdio: 'pipe' });
        const conf = readFileSync(join(root, 'etc', 'guardian.conf'), 'utf8');
        return { root, out, conf, calls: readFileSync(join(root, 'calls.log'), 'utf8') };
    }

    it('detecta dominio, base de datos, Redis y el modo ServerAvatar; deja todo de root y programa el timer', () => {
        const { root, conf, calls } = install('server {\n  server_name app.example.com;\n  include /etc/nginx/imagina-base.locations;  # Imagina Base\n}\n');
        expect(conf).toContain('DOMAIN=app.example.com');
        expect(conf).toContain('PG_CONTAINER=imagina-base-postgres-1');
        expect(conf).toContain('REDIS_SERVICE=redis-server');
        expect(conf).toContain('WEB_MODE=serveravatar');
        expect(conf).toContain('APP_USER=nobody');
        expect(existsSync(join(root, 'lib', 'imagina-guardian.sh'))).toBe(true);
        expect(existsSync(join(root, 'lib', 'serveravatar-nginx.sh'))).toBe(true);
        for (const u of ['imagina-guardian.service', 'imagina-guardian.timer', 'imagina-guardian.path']) expect(existsSync(join(root, 'units', u))).toBe(true);
        expect(calls).toContain('systemctl enable --now imagina-guardian.timer imagina-guardian.path');
        const owner = execFileSync('stat', ['-c', '%U %a', join(root, 'var', 'guardian', 'requests')], { encoding: 'utf8' }).trim();
        expect(owner).toBe('nobody 700');
        expect(execFileSync('stat', ['-c', '%U', join(root, 'lib', 'imagina-guardian.sh')], { encoding: 'utf8' }).trim()).toBe('root');
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
