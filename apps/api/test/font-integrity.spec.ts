import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * v0.1.362 — Las tipografías del PDF (`apps/api/assets/fonts`, WOFF) y de la
 * vista previa del navegador (`apps/web/public/email-fonts`, WOFF2) son
 * binarios del repo. En v0.1.300 un reemplazo de texto («vX» → «v0.1.300»)
 * pasó también por ellos y rompió 15 archivos: Chrome no los podía leer
 * («OTS parsing error: Failed to convert WOFF 2.0 font to SFNT») y los
 * formularios y correos mostraban otra letra.
 *
 * WOFF y WOFF2 declaran en la cabecera (offset 8, uint32 big-endian) el largo
 * TOTAL del archivo: un byte agregado o quitado en cualquier parte lo
 * desarma. Es un chequeo barato que atrapa exactamente esa clase de daño.
 */
const root = path.resolve(__dirname, '../../..');
const SETS = [
    { dir: path.join(root, 'apps/api/assets/fonts'), ext: '.woff', signature: 'wOFF' },
    { dir: path.join(root, 'apps/web/public/email-fonts'), ext: '.woff2', signature: 'wOF2' },
];

describe('tipografías del repo intactas', () => {
    for (const set of SETS) {
        const files = readdirSync(set.dir).filter((f) => f.endsWith(set.ext));

        it(`${path.relative(root, set.dir)} tiene las fuentes`, () => {
            expect(files.length).toBeGreaterThan(20);
        });

        for (const file of files) {
            it(`${file}: firma y largo declarado coinciden con el archivo`, () => {
                const bytes = readFileSync(path.join(set.dir, file));
                expect(bytes.subarray(0, 4).toString('latin1')).toBe(set.signature);
                expect(bytes.readUInt32BE(8)).toBe(bytes.length);
            });
        }
    }
});
