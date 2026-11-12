import { Inject, Injectable } from '@nestjs/common';
import { captchaCspSources } from '@imagina-base/shared';
import { useWebBuild } from '../common/web-build';
import { ENV, type Env } from '../config/env';
import { inlineScriptHash, type PageCspTags } from '../forms/form-page';
import { loadShopClient, shopPageCsp } from './shop-page';
import type { ShopPageInfo } from './shop-public.service';

/**
 * v0.1.423 — El script compilado de la tienda y su CSP: lo comparten la
 * dirección de la plataforma (`/api/v1/public/s/<token>`) y el dominio propio
 * de la tienda (`/`, `/p/…`).
 */
@Injectable()
export class ShopPageAssets {
    private hashFor: string | null = null;
    private hash = '';

    constructor(@Inject(ENV) private readonly env: Env) {}

    /** El compilado (null = desarrollo, módulo de vite; undefined = producción sin el build). */
    client(): string | null | undefined {
        if (!useWebBuild(this.env)) return null;
        return loadShopClient(this.env.WEB_DIST_DIR) ?? undefined;
    }

    csp(info: ShopPageInfo, client: string | null, tags: PageCspTags | null): string {
        const c = captchaCspSources(info.captchaProvider);
        return shopPageCsp(client === null ? '' : `'${this.clientHash(client)}'`, info.allowedDomains, {
            dev: client === null,
            captchaScript: c.script,
            captchaFrame: c.frame,
            captchaConnect: c.connect,
            tags,
        });
    }

    private clientHash(client: string): string {
        if (this.hashFor !== client) {
            this.hashFor = client;
            this.hash = inlineScriptHash(client);
        }
        return this.hash;
    }
}
