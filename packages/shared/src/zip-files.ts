import { strToU8, zipSync, type Zippable } from 'fflate';

/**
 * Arma un .zip en memoria (v0.1.334): con él la app reparte el complemento de
 * WordPress (ADR-S84). Las rutas van con `/` y sin `..` ni rutas absolutas —
 * un zip con `../` escribiría afuera de la carpeta al descomprimirlo—; la
 * fecha de cada archivo se fija para que el mismo contenido dé el mismo zip.
 */
export interface ZipFileInput {
    path: string;
    data: Uint8Array | string;
}

const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');

export function zipFiles(files: ZipFileInput[]): Uint8Array {
    const tree: Zippable = {};
    for (const f of files) {
        const path = f.path.replace(/\\/g, '/');
        if (path === '' || path.startsWith('/') || path.split('/').some((p) => p === '..' || p === '')) {
            throw new Error(`Ruta inválida en el zip: ${f.path}`);
        }
        tree[path] = [typeof f.data === 'string' ? strToU8(f.data) : f.data, { mtime: FIXED_MTIME }];
    }
    return zipSync(tree, { level: 6 });
}
