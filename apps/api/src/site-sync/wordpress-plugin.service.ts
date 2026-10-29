import { Inject, Injectable, Logger } from '@nestjs/common';
import { zipFiles, type ZipFileInput } from '@imagina-base/shared';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ENV, type Env } from '../config/env';

/**
 * El complemento de WordPress que reparte la app (v0.1.334, ADR-S84).
 *
 * El código vive en el repo (`integrations/wordpress-plugin/imagina-base-connector`)
 * y viaja en cada release junto al API; el zip se arma EN MEMORIA al pedirlo,
 * con un archivo extra (`includes/update-source.php`) que le dice al
 * complemento de qué app buscar actualizaciones: la de este servidor. Así cada
 * operador reparte su propio complemento y las actualizaciones le llegan a
 * WordPress como las de cualquier plugin.
 */

export const WP_PLUGIN_SLUG = 'imagina-base-connector';
/** Lo que promete el complemento (lo mismo que dice su cabecera). */
const REQUIRES_WP = '6.0';
const REQUIRES_PHP = '7.4';
const TESTED_WP = '6.8';
/** Tope de bytes del código del complemento (un error de empaquetado no se reparte). */
const MAX_PLUGIN_BYTES = 5 * 1024 * 1024;

export function pluginDirCandidates(): string[] {
    const rel = path.join('integrations', 'wordpress-plugin', WP_PLUGIN_SLUG);
    return [
        // <release>/apps/api/dist/site-sync → <release>/integrations/… (y lo mismo desde el repo)
        path.resolve(__dirname, '../../../..', rel),
        path.resolve(process.cwd(), '../..', rel),
        path.resolve(process.cwd(), rel),
    ];
}

/** `Version: 1.2.3` de la cabecera del archivo principal. */
export function parsePluginVersion(php: string): string | null {
    const m = /^\s*\*?\s*Version:\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s*$/im.exec(php);
    return m ? m[1]! : null;
}

/** El archivo que le dice al complemento de dónde actualizarse (texto PHP escapado). */
export function updateSourcePhp(appUrl: string, appName: string): string {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return [
        '<?php',
        '/**',
        ' * Generado por la app al descargar el complemento: de aquí busca actualizaciones.',
        ' *',
        ' * @package ImaginaBaseConnector',
        ' */',
        '',
        "defined( 'ABSPATH' ) || exit;",
        '',
        `return array( 'url' => '${esc(appUrl)}', 'name' => '${esc(appName)}' );`,
        '',
    ].join('\n');
}

/** Compara versiones `1.2.3` (número por número). */
export function versionNewer(a: string | null, b: string | null): boolean {
    if (!a || !b) return false;
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x > y;
    }
    return false;
}

export interface WpPluginInfo {
    name: string;
    slug: string;
    version: string;
    download_url: string;
    requires: string;
    requires_php: string;
    tested: string;
    last_updated: string;
    homepage: string;
    sections: { description: string; changelog: string };
}

@Injectable()
export class WordpressPluginService {
    private readonly logger = new Logger(WordpressPluginService.name);
    private cache: { key: string; bytes: Buffer } | null = null;

    constructor(@Inject(ENV) private readonly env: Env) {}

    private baseUrl(): string {
        return this.env.APP_BASE_URL.replace(/\/+$/, '');
    }

    /** La carpeta del complemento (la primera que exista), o null si este servidor no lo trae. */
    dir(): string | null {
        for (const d of pluginDirCandidates()) {
            if (existsSync(path.join(d, `${WP_PLUGIN_SLUG}.php`))) return d;
        }
        return null;
    }

    version(): string | null {
        const d = this.dir();
        if (!d) return null;
        try {
            return parsePluginVersion(readFileSync(path.join(d, `${WP_PLUGIN_SLUG}.php`), 'utf8'));
        } catch {
            return null;
        }
    }

    info(): WpPluginInfo | null {
        const d = this.dir();
        const version = this.version();
        if (!d || !version) return null;
        const readme = existsSync(path.join(d, 'readme.txt')) ? readFileSync(path.join(d, 'readme.txt'), 'utf8') : '';
        const section = (name: string) => {
            const m = new RegExp(`== ${name} ==\\n([\\s\\S]*?)(?:\\n== |$)`).exec(readme);
            return (m?.[1] ?? '').trim();
        };
        const html = (text: string) =>
            text
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l !== '')
                .map((l) => (l.startsWith('* ') ? `<li>${escapeHtml(l.slice(2))}</li>` : l.startsWith('= ') ? `<h4>${escapeHtml(l.replace(/^=\s*|\s*=$/g, ''))}</h4>` : `<p>${escapeHtml(l)}</p>`))
                .join('\n');
        let mtime = 0;
        try {
            mtime = statSync(path.join(d, `${WP_PLUGIN_SLUG}.php`)).mtimeMs;
        } catch {
            mtime = 0;
        }
        return {
            name: 'Imagina Base Connector',
            slug: WP_PLUGIN_SLUG,
            version,
            download_url: `${this.baseUrl()}/api/v1/public/wordpress-plugin/download`,
            requires: REQUIRES_WP,
            requires_php: REQUIRES_PHP,
            tested: TESTED_WP,
            last_updated: new Date(mtime || Date.now()).toISOString().slice(0, 10),
            homepage: this.baseUrl(),
            sections: { description: html(section('Description')), changelog: html(section('Changelog')) },
        };
    }

    /** El zip listo para instalar (carpeta `imagina-base-connector/…` + de dónde actualizarse). */
    zip(): { bytes: Buffer; filename: string; version: string } | null {
        const d = this.dir();
        const version = this.version();
        if (!d || !version) return null;
        const key = `${version}|${this.baseUrl()}`;
        if (this.cache?.key === key) return { bytes: this.cache.bytes, filename: `${WP_PLUGIN_SLUG}.zip`, version };
        const files: ZipFileInput[] = [];
        let total = 0;
        const walk = (dir: string, rel: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                // Ocultos y lo generado: nunca viajan del servidor.
                if (entry.name.startsWith('.') || entry.name === 'update-source.php') continue;
                const abs = path.join(dir, entry.name);
                const relPath = rel ? `${rel}/${entry.name}` : entry.name;
                if (entry.isDirectory()) walk(abs, relPath);
                else if (entry.isFile()) {
                    const data = readFileSync(abs);
                    total += data.length;
                    if (total > MAX_PLUGIN_BYTES) throw new Error('El complemento pesa más de lo esperado: no se reparte.');
                    files.push({ path: `${WP_PLUGIN_SLUG}/${relPath}`, data: new Uint8Array(data) });
                }
            }
        };
        try {
            walk(d, '');
        } catch (err) {
            this.logger.error(`No se pudo armar el zip del complemento: ${String(err)}`);
            return null;
        }
        files.push({ path: `${WP_PLUGIN_SLUG}/includes/update-source.php`, data: updateSourcePhp(this.baseUrl(), 'Imagina Base') });
        const bytes = Buffer.from(zipFiles(files));
        this.cache = { key, bytes };
        return { bytes, filename: `${WP_PLUGIN_SLUG}.zip`, version };
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
