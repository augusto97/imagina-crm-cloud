import { describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env';
import { renderLegalMarkdown } from '../src/legal/legal-page';
import { LegalService, type LegalStore } from '../src/legal/legal.service';

class MemStore implements LegalStore {
    m = new Map<string, string>();
    async get(k: string) {
        return this.m.get(k) ?? null;
    }
    async set(k: string, v: string) {
        this.m.set(k, v);
        return 'OK';
    }
}

const env = { APP_BASE_URL: 'https://base.imagina.cloud' } as Env;

describe('páginas públicas de la plataforma (v0.1.247)', () => {
    it('markdown mínimo: escapa todo y sólo enlaza https/mailto', () => {
        const html = renderLegalMarkdown(
            '## Título <b>\nTexto **fuerte** con [ok](https://x.com) y [malo](javascript:alert(1))\n\n- uno\n- <script>dos</script>\n\nEscribinos a hola@acme.co.',
        );
        expect(html).toContain('<h2>Título &lt;b&gt;</h2>');
        expect(html).toContain('<strong>fuerte</strong>');
        expect(html).toContain('<a href="https://x.com" rel="noopener">ok</a>');
        expect(html).not.toContain('href="javascript');
        expect(html).toContain('<li>&lt;script&gt;dos&lt;/script&gt;</li>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('<a href="mailto:hola@acme.co">hola@acme.co</a>');
    });

    it('urls, faltantes, guardado y render con los datos de la empresa', async () => {
        const svc = new LegalService(new MemStore(), env);
        const v0 = await svc.view();
        expect(v0.urls).toEqual({
            home: 'https://base.imagina.cloud/api/v1/public/legal',
            privacy: 'https://base.imagina.cloud/api/v1/public/legal/privacidad',
            terms: 'https://base.imagina.cloud/api/v1/public/legal/terminos',
        });
        expect(v0.missing.length).toBe(2);

        const v1 = await svc.update({ company_name: 'Imagina SAS', contact_email: 'legal@imagina.cloud', app_name: 'Imagina Base' });
        expect(v1.missing).toEqual([]);
        expect(v1.settings.privacy_md).toBeNull();

        const home = await svc.render('home');
        expect(home).toContain('<h1>Imagina Base</h1>');
        // La página principal SIEMPRE enlaza a la política (lo revisa Google).
        expect(home).toContain('href="https://base.imagina.cloud/api/v1/public/legal/privacidad"');
        expect(home).not.toContain('{{');

        const privacy = await svc.render('privacy');
        expect(privacy).toContain('Imagina SAS opera Imagina Base');
        expect(privacy).toContain('Limited Use requirements');
        expect(privacy).toContain('mailto:legal@imagina.cloud');
        expect(privacy).not.toContain('{{');
    });

    it('un texto propio manda; guardar el sugerido tal cual vuelve al sugerido', async () => {
        const svc = new LegalService(new MemStore(), env);
        const v = await svc.update({ terms_md: '## Propias\nCondiciones de {{company}}.', company_name: 'Acme' });
        expect(v.settings.terms_md).toContain('Propias');
        expect(await svc.render('terms')).toContain('Condiciones de Acme.');

        const back = await svc.update({ privacy_md: v.defaults.privacy_md });
        expect(back.settings.privacy_md).toBeNull();
        const cleared = await svc.update({ terms_md: '   ' });
        expect(cleared.settings.terms_md).toBeNull();
    });

    it('un valor corrupto en Redis no tumba la página', async () => {
        const store = new MemStore();
        store.m.set('platform:legal', '{no es json');
        const svc = new LegalService(store, env);
        expect(await svc.render('privacy')).toContain('Política de privacidad');
    });
});
