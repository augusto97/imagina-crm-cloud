import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { N8N_PACKAGE, N8N_TARBALL, n8nPackageInfo, n8nTarball } from '../src/public-api/n8n-package';

/** v0.1.443 — El paquete de n8n que reparte cada servidor. */
describe('app de n8n: el paquete que reparte el servidor', () => {
    const make = (name: string, opts: { version?: string; tgz?: Buffer | null } = {}): string => {
        const dir = mkdtempSync(path.join(tmpdir(), 'n8npkg-'));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: opts.version ?? '0.1.0' }));
        if (opts.tgz !== null) writeFileSync(path.join(dir, N8N_TARBALL), opts.tgz ?? Buffer.from('paquete'));
        return dir;
    };

    it('con el paquete armado: versión, disponible y los bytes con el nombre versionado', () => {
        const dir = make(N8N_PACKAGE, { version: '0.2.1' });
        expect(n8nPackageInfo([dir])).toEqual({ package: N8N_PACKAGE, version: '0.2.1', available: true });
        const pkg = n8nTarball([dir]);
        expect(pkg?.filename).toBe(`${N8N_PACKAGE}-0.2.1.tgz`);
        expect(pkg?.bytes.toString()).toBe('paquete');
    });

    it('sin el .tgz (desarrollo) no se reparte, pero se sabe la versión', () => {
        const dir = make(N8N_PACKAGE, { tgz: null });
        expect(n8nPackageInfo([dir])).toEqual({ package: N8N_PACKAGE, version: '0.1.0', available: false });
        expect(n8nTarball([dir])).toBeNull();
    });

    it('una carpeta de otro paquete, uno vacío o uno enorme no se reparten', () => {
        expect(n8nPackageInfo([make('otro-paquete')]).available).toBe(false);
        expect(n8nTarball([make(N8N_PACKAGE, { tgz: Buffer.alloc(0) })])).toBeNull();
        expect(n8nTarball([make(N8N_PACKAGE, { tgz: Buffer.alloc(5 * 1024 * 1024 + 1) })])).toBeNull();
        // La primera carpeta válida gana; una de otro paquete se saltea.
        const good = make(N8N_PACKAGE, { version: '1.0.0' });
        expect(n8nPackageInfo([make('otro-paquete'), good]).version).toBe('1.0.0');
        expect(n8nPackageInfo([path.join(tmpdir(), 'no-existe-n8n')])).toEqual({ package: N8N_PACKAGE, version: null, available: false });
    });
});
