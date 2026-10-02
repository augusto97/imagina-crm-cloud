import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    DEFAULT_APP_DESCRIPTION,
    DEFAULT_PRIVACY_MD,
    DEFAULT_TERMS_MD,
    fillLegalTemplate,
    legalMissing,
    platformLegalSchema,
    type LegalVars,
    type PlatformLegal,
    type PlatformLegalView,
    type UpdatePlatformLegalInput,
} from '@imagina-base/shared';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { renderLegalPage, type LegalPageInput } from './legal-page';

/** Subconjunto de ioredis: se testea con un fake en memoria. */
export interface LegalStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
}

/** `platform:*` → viaja en el snapshot del servidor (ADR-S20). */
const KEY = 'platform:legal';

/**
 * Páginas públicas de la plataforma (v0.1.247): las que Google, Microsoft y
 * Slack piden para publicar y verificar la app de integraciones. Las sirve el
 * propio API en `/api/v1/public/legal[/privacidad|/terminos]`.
 */
@Injectable()
export class LegalService {
    private readonly logger = new Logger(LegalService.name);

    constructor(
        @Inject(REDIS) private readonly redis: LegalStore,
        @Inject(ENV) private readonly env: Env,
    ) {}

    urls(): PlatformLegalView['urls'] {
        const base = `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/public/legal`;
        return { home: base, privacy: `${base}/privacidad`, terms: `${base}/terminos` };
    }

    async view(): Promise<PlatformLegalView> {
        const settings = await this.read();
        return {
            settings,
            urls: this.urls(),
            defaults: { description: DEFAULT_APP_DESCRIPTION, privacy_md: DEFAULT_PRIVACY_MD, terms_md: DEFAULT_TERMS_MD },
            missing: legalMissing(settings),
        };
    }

    async update(patch: UpdatePlatformLegalInput): Promise<PlatformLegalView> {
        const current = await this.read();
        const next: PlatformLegal = { ...current, ...patch, updated_at: new Date().toISOString() } as PlatformLegal;
        // Guardar el texto sugerido tal cual = seguir usando el sugerido (y sus
        // mejoras futuras), no congelar una copia.
        if (next.privacy_md !== null && next.privacy_md.trim() === DEFAULT_PRIVACY_MD.trim()) next.privacy_md = null;
        if (next.terms_md !== null && next.terms_md.trim() === DEFAULT_TERMS_MD.trim()) next.terms_md = null;
        if (next.privacy_md !== null && next.privacy_md.trim() === '') next.privacy_md = null;
        if (next.terms_md !== null && next.terms_md.trim() === '') next.terms_md = null;
        await this.redis.set(KEY, JSON.stringify(next));
        return this.view();
    }

    async render(kind: LegalPageInput['kind']): Promise<string> {
        const s = await this.read();
        const updated = (s.updated_at ?? new Date().toISOString()).slice(0, 10);
        const vars: LegalVars = {
            app_name: s.app_name,
            company: s.company_name,
            email: s.contact_email,
            app_url: this.env.APP_BASE_URL.replace(/\/+$/, ''),
            website: s.website_url,
            updated,
        };
        const urls = this.urls();
        let md: string;
        if (kind === 'privacy') md = s.privacy_md ?? DEFAULT_PRIVACY_MD;
        else if (kind === 'terms') md = s.terms_md ?? DEFAULT_TERMS_MD;
        else {
            // Google pide que la página principal explique para qué se piden
            // los datos y enlace a la política: se agrega SIEMPRE, aunque la
            // descripción sea propia.
            md = [
                s.description || DEFAULT_APP_DESCRIPTION,
                '## Datos y privacidad',
                `Las integraciones con Google, Microsoft y Slack sólo se usan para lo que cada empresa configura en sus automatizaciones (enviar un correo, crear un evento, agregar una fila a una hoja, publicar un mensaje). Qué datos se usan y cómo se protegen está explicado en la [Política de privacidad](${urls.privacy}); el uso del servicio, en las [Condiciones del servicio](${urls.terms}).`,
                s.contact_email ? `## Contacto\n${s.contact_email}` : '',
            ]
                .filter(Boolean)
                .join('\n\n');
        }
        return renderLegalPage({
            kind,
            appName: s.app_name,
            company: s.company_name,
            email: s.contact_email,
            appUrl: vars.app_url,
            websiteUrl: s.website_url,
            urls,
            body: fillLegalTemplate(md, vars),
            updated,
        });
    }

    private async read(): Promise<PlatformLegal & { updated_at?: string }> {
        const raw = await this.redis.get(KEY);
        if (!raw) return platformLegalSchema.parse({});
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const s = platformLegalSchema.parse(parsed);
            return { ...s, updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined };
        } catch (err) {
            this.logger.warn(`${KEY} corrupto, se ignora: ${err instanceof Error ? err.message : String(err)}`);
            return platformLegalSchema.parse({});
        }
    }
}
