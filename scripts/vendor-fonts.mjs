#!/usr/bin/env node
/**
 * v0.1.272 — Trae las tipografías del editor de correos y del generador de
 * PDF (ADR-S37). Reproducible: baja los paquetes `@fontsource/*` del
 * registro de npm (licencias OFL / Apache 2.0) y copia SÓLO lo que se usa:
 * pesos 400 y 700, normal e itálica, subconjunto latino (español completo).
 *
 *  - `apps/api/assets/fonts/<clave>-<peso>-<estilo>.woff`: el PDF. pdfkit
 *    (fontkit) abre WOFF pero NO WOFF2 (verificado: "Offset is outside the
 *    bounds of the DataView").
 *  - `apps/web/public/email-fonts/<clave>-<peso>-<estilo>.woff2`: la vista
 *    previa del editor (la CSP de la app sólo deja cargar fuentes propias).
 *    Los correos de verdad usan Google Fonts: los programas de correo no
 *    cargan fuentes de un dominio sin CORS.
 *
 * Uso: node scripts/vendor-fonts.mjs   (necesita red; correrlo sólo al
 * agregar o actualizar una familia — los archivos quedan en el repo).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** clave del archivo → paquete @fontsource (y si va al PDF, a la web o a los dos). */
const FAMILIES = [
    // Equivalentes LIBRES de las fuentes del sistema (sólo PDF): mismas
    // métricas que Arial / Times / Courier / Georgia, así el texto ocupa lo
    // mismo que en el correo.
    { key: 'arimo', pkg: 'arimo', pdf: true, web: false },
    { key: 'tinos', pkg: 'tinos', pdf: true, web: false },
    { key: 'cousine', pkg: 'cousine', pdf: true, web: false },
    { key: 'gelasio', pkg: 'gelasio', pdf: true, web: false },
    // Fuentes web: PDF + vista previa del correo.
    { key: 'inter', pkg: 'inter', pdf: true, web: true },
    { key: 'roboto', pkg: 'roboto', pdf: false, web: true },
    { key: 'open_sans', pkg: 'open-sans', pdf: true, web: true },
    { key: 'lato', pkg: 'lato', pdf: true, web: true },
    { key: 'montserrat', pkg: 'montserrat', pdf: true, web: true },
    { key: 'poppins', pkg: 'poppins', pdf: true, web: true },
    { key: 'nunito', pkg: 'nunito', pdf: true, web: true },
    { key: 'raleway', pkg: 'raleway', pdf: true, web: true },
    { key: 'playfair', pkg: 'playfair-display', pdf: true, web: true },
    { key: 'merriweather', pkg: 'merriweather', pdf: true, web: true },
    { key: 'lora', pkg: 'lora', pdf: true, web: true },
];
const STYLES = [
    ['400', 'normal'],
    ['700', 'normal'],
    ['400', 'italic'],
    ['700', 'italic'],
];

const pdfDir = path.join(root, 'apps/api/assets/fonts');
const webDir = path.join(root, 'apps/web/public/email-fonts');
mkdirSync(pdfDir, { recursive: true });
mkdirSync(webDir, { recursive: true });

const tmp = mkdtempSync(path.join(tmpdir(), 'fonts-'));
const licenses = [];
try {
    for (const f of FAMILIES) {
        const name = `@fontsource/${f.pkg}@5`;
        const tgz = execFileSync('npm', ['pack', name, '--silent'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop();
        const dir = path.join(tmp, f.key);
        mkdirSync(dir, { recursive: true });
        execFileSync('tar', ['xzf', path.join(tmp, tgz), '-C', dir]);
        const files = path.join(dir, 'package/files');
        for (const [w, s] of STYLES) {
            const base = `${f.pkg}-latin-${w}-${s}`;
            for (const [want, ext, dest] of [
                [f.pdf, 'woff', pdfDir],
                [f.web, 'woff2', webDir],
            ]) {
                if (!want) continue;
                const src = path.join(files, `${base}.${ext}`);
                if (!existsSync(src)) throw new Error(`Falta ${base}.${ext} en ${name}`);
                copyFileSync(src, path.join(dest, `${f.key}-${w}-${s}.${ext}`));
            }
        }
        const pkg = JSON.parse(readFileSync(path.join(dir, 'package/package.json'), 'utf8'));
        licenses.push(`- **${f.key}** — ${pkg.name}@${pkg.version} · ${pkg.license}`);
        process.stdout.write(`✓ ${f.key}\n`);
    }
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

const note = [
    '# Tipografías incluidas',
    '',
    'Copiadas por `scripts/vendor-fonts.mjs` desde los paquetes `@fontsource/*`',
    '(Google Fonts). Todas con licencia libre (SIL Open Font License 1.1 o',
    'Apache 2.0), que permite incluirlas y embeberlas en documentos.',
    '',
    ...licenses,
    '',
].join('\n');
writeFileSync(path.join(pdfDir, 'LICENSES.md'), note);
writeFileSync(path.join(webDir, 'LICENSES.md'), note);
