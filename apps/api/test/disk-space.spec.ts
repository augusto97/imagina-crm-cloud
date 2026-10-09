import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { LayoutDisk, MIN_FREE_INODES, freeBytes, freeInodes, planCleanup, spaceProblem } from '../src/update/disk-space';
import { SymlinkDeployer } from '../src/update/symlink-deployer.service';

const rel = (name: string, complete = true) => ({ name, isDir: true, complete });

describe('v0.1.278 — espacio en disco del layout de releases', () => {
    it('plan: basura de un deploy cortado, releases viejos y copias de más', () => {
        const entries = [
            rel('20261001000000_0.1.270'),
            rel('20261002000000_0.1.271'),
            rel('20261003000000_0.1.272'),
            rel('20261004000000_0.1.273'),
            rel('20261005000000_0.1.274'),
            rel('20261009154704_0.1.276', false), // unzip cortado
            { name: '20261009154704_0.1.276.zip', isDir: false, complete: false },
            { name: 'algo.txt', isDir: false, complete: false },
        ];
        const dumps = Array.from({ length: 8 }, (_, i) => `imagina-base-2026100${i}T000000Z.dump`).concat(['imagina-snapshot-x.tar']);
        const p = planCleanup(entries, '20261004000000_0.1.273', 3, dumps, 5);
        expect(p.releases.sort()).toEqual(
            ['20261001000000_0.1.270', '20261002000000_0.1.271', '20261009154704_0.1.276', '20261009154704_0.1.276.zip'].sort(),
        );
        // Queda el activo (0.1.273) + los 2 completos más nuevos (0.1.274 y 0.1.272).
        expect(p.releases).not.toContain('20261005000000_0.1.274');
        expect(p.releases).not.toContain('20261003000000_0.1.272');
        // Copias: quedan las 5 más nuevas; el snapshot diario no se toca.
        expect(p.dumps).toEqual(['imagina-base-20261002T000000Z.dump', 'imagina-base-20261001T000000Z.dump', 'imagina-base-20261000T000000Z.dump']);
        expect(p.dumps.some((d) => d.includes('snapshot'))).toBe(false);
    });

    it('el release activo nunca se borra aunque esté "incompleto" o sea viejo', () => {
        const p = planCleanup([rel('a', false), rel('b'), rel('c'), rel('d')], 'a', 1, [], 5);
        expect(p.releases).not.toContain('a');
        expect(p.releases.sort()).toEqual(['b', 'c', 'd']);
    });

    it('sobre carpetas reales: borra lo que sobra y deja el activo y uploads', async () => {
        const base = mkdtempSync(join(tmpdir(), 'imb-layout-'));
        const releases = join(base, 'releases');
        const mk = (name: string, complete = true) => {
            mkdirSync(join(releases, name, 'apps', 'api', complete ? 'dist' : 'src'), { recursive: true });
            writeFileSync(join(releases, name, 'apps', 'api', 'peso.bin'), Buffer.alloc(200_000));
        };
        mk('20261001000000_0.1.270');
        mk('20261002000000_0.1.271');
        mk('20261003000000_0.1.272');
        mk('20261009000000_0.1.276', false);
        writeFileSync(join(releases, '20261009000000_0.1.276.zip'), Buffer.alloc(300_000));
        symlinkSync(join(releases, '20261003000000_0.1.272'), join(base, 'current'));
        mkdirSync(join(base, 'shared', 'backups'), { recursive: true });
        mkdirSync(join(base, 'shared', 'uploads'), { recursive: true });
        writeFileSync(join(base, 'shared', 'uploads', 'logo.png'), 'x');
        for (let i = 0; i < 7; i++) writeFileSync(join(base, 'shared', 'backups', `imagina-base-2026100${i}T000000Z.dump`), Buffer.alloc(10_000));
        writeFileSync(join(base, 'shared', 'backups', 'imagina-snapshot-20261009.tar'), 'snap');

        const disk = new LayoutDisk(base, 2);
        expect(disk.currentName()).toBe('20261003000000_0.1.272');
        expect(await disk.reclaimable()).toBeGreaterThan(500_000);
        const out = await disk.cleanup();
        expect(out.removed).toContain('releases/20261009000000_0.1.276.zip');
        expect(existsSync(join(releases, '20261003000000_0.1.272'))).toBe(true);
        expect(existsSync(join(releases, '20261002000000_0.1.271'))).toBe(true);
        expect(existsSync(join(releases, '20261001000000_0.1.270'))).toBe(false);
        expect(existsSync(join(releases, '20261009000000_0.1.276'))).toBe(false);
        expect(existsSync(join(base, 'shared', 'uploads', 'logo.png'))).toBe(true);
        expect(existsSync(join(base, 'shared', 'backups', 'imagina-snapshot-20261009.tar'))).toBe(true);
        expect(existsSync(join(base, 'shared', 'backups', 'imagina-base-20261000T000000Z.dump'))).toBe(false);
        expect(existsSync(join(base, 'shared', 'backups', 'imagina-base-20261006T000000Z.dump'))).toBe(true);
        expect(freeBytes(base).total).toBeGreaterThan(0);
        expect(await disk.reclaimable()).toBe(0);
    });
});


describe('v0.1.278 — inodos: sin lugar para archivos aunque haya GB libres', () => {
    it('distingue falta de bytes, falta de archivos y nada', () => {
        const gb = 1024 ** 3;
        expect(spaceProblem({ free: 26 * gb }, { free: 12 }, gb)).toBe('inodes'); // el caso del reporte
        expect(spaceProblem({ free: 100 }, { free: 12 }, gb)).toBe('bytes');
        expect(spaceProblem({ free: 26 * gb }, { free: MIN_FREE_INODES + 1 }, gb)).toBeNull();
        // btrfs/xfs dinámico: sin tope fijo de inodos → sólo cuentan los bytes.
        expect(spaceProblem({ free: 26 * gb }, null, gb)).toBeNull();
    });

    it('freeInodes lee el sistema de archivos real (o null si no tiene tope)', () => {
        const i = freeInodes(tmpdir());
        if (i !== null) {
            expect(i.total).toBeGreaterThan(0);
            expect(i.free).toBeLessThanOrEqual(i.total);
        }
    });
});

describe('v0.1.278 — el actualizador y el disco', () => {
    const layout = () => {
        const base = mkdtempSync(join(tmpdir(), 'imb-upd-'));
        mkdirSync(join(base, 'releases', '20261001000000_0.1.270', 'apps', 'api', 'dist'), { recursive: true });
        symlinkSync(join(base, 'releases', '20261001000000_0.1.270'), join(base, 'current'));
        mkdirSync(join(base, 'shared'), { recursive: true });
        return base;
    };
    const release = (url: string, checksum: string) =>
        ({ version: '0.1.276', bundle_url: url, checksum, channel: 'stable' }) as never;

    it('sin espacio suficiente corta ANTES de descargar, con el número a la vista', async () => {
        const base = layout();
        const d = new SymlinkDeployer(loadEnv({ UPDATER_BASE_PATH: base, UPDATER_MIN_FREE_MB: '99999999' }));
        const out = await d.deploy(release('file:///no/existe.zip', 'abc'));
        expect(out.ok).toBe(false);
        expect(out.message).toMatch(/No hay espacio en disco para actualizar: quedan \d+ MB libres/);
        expect(readdirSync(join(base, 'releases'))).toEqual(['20261001000000_0.1.270']);
    });

    it('un deploy que falla al extraer no deja el zip ni la carpeta a medias', async () => {
        const base = layout();
        const src = join(mkdtempSync(join(tmpdir(), 'imb-zip-')), 'bundle.zip');
        const bytes = Buffer.from('esto no es un zip');
        writeFileSync(src, bytes);
        const sum = createHash('sha256').update(bytes).digest('hex');
        const d = new SymlinkDeployer(loadEnv({ UPDATER_BASE_PATH: base, UPDATER_MIN_FREE_MB: '1' }));
        const out = await d.deploy(release(`file://${src}`, sum));
        expect(out.ok).toBe(false);
        expect(out.message).toMatch(/Fallo en deploy/);
        expect(readdirSync(join(base, 'releases'))).toEqual(['20261001000000_0.1.270']);
    });
});
