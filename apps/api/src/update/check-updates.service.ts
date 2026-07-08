import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { ReleasesRepository } from './releases.repository';

interface GhAsset {
    name: string;
    browser_download_url: string;
    url: string;
}
interface GhRelease {
    tag_name: string;
    published_at: string;
    prerelease: boolean;
    draft: boolean;
    assets: GhAsset[];
}

/**
 * DETECT (ADR-S13): consulta el último release de GitHub y lo registra en
 * `app_releases`. Se corre por schedule (horario) y a demanda desde el panel.
 * Soporta repo privado vía `UPDATER_GITHUB_TOKEN`.
 */
@Injectable()
export class CheckUpdatesService {
    private readonly logger = new Logger(CheckUpdatesService.name);

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly repo: ReleasesRepository,
    ) {}

    /** Devuelve la versión registrada, o null si no había release publicable. */
    async check(): Promise<string | null> {
        const repo = this.env.UPDATER_GITHUB_REPO;
        const headers: Record<string, string> = {
            accept: 'application/vnd.github+json',
            'user-agent': 'imagina-base-updater',
            'x-github-api-version': '2022-11-28',
        };
        if (this.env.UPDATER_GITHUB_TOKEN) {
            headers.authorization = `Bearer ${this.env.UPDATER_GITHUB_TOKEN}`;
        }

        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
        if (!res.ok) {
            this.logger.warn(`GitHub releases/latest ${res.status} para ${repo}`);
            return null;
        }
        const rel = (await res.json()) as GhRelease;
        if (rel.draft) return null;

        const version = rel.tag_name.replace(/^v/, '');
        const zip = rel.assets.find((a) => a.name.endsWith('.zip'));
        if (!zip) {
            this.logger.warn(`Release ${rel.tag_name} sin asset .zip`);
            return null;
        }
        const shaAsset = rel.assets.find((a) => a.name.endsWith('.sha256'));
        const checksum = shaAsset ? await this.fetchChecksum(shaAsset, headers) : null;

        await this.repo.upsert({
            version,
            channel: this.env.UPDATER_CHANNEL,
            bundleUrl: zip.browser_download_url,
            checksum,
            releasedAt: new Date(rel.published_at),
        });
        this.logger.log(`Release registrado: ${version} (${this.env.UPDATER_CHANNEL})`);
        return version;
    }

    /** El .sha256 puede ser "<hash>" o "<hash>  <archivo>"; tomamos el primer token. */
    private async fetchChecksum(asset: GhAsset, headers: Record<string, string>): Promise<string | null> {
        try {
            const res = await fetch(asset.browser_download_url, { headers });
            if (!res.ok) return null;
            const text = (await res.text()).trim();
            return text.split(/\s+/)[0] ?? null;
        } catch {
            return null;
        }
    }
}
