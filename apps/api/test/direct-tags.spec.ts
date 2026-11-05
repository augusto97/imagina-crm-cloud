import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { conversionSettingsSchema, type PublicFormMeta } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import { bookingClientHash, renderBookingPage } from '../src/booking/booking-page';
import { DIRECT_TAGS_JS, directTagsCsp, directTagsHash, pageOrigin } from '../src/forms/direct-tags';
import { directTags } from '../src/forms/form-conversion';
import { cacheablePageCsp, renderFormPage } from '../src/forms/form-page';

/**
 * v0.1.375 (ADR-S97, addendum) — Las etiquetas de Google y Meta en el enlace
 * directo: sólo por ID, encerradas por la CSP (la ruta pública del API, sin
 * marcos de la app ni workers), y la conversión con el id del envío.
 */

const sha = (text: string) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;

interface FakeEnv {
    calls: { gtag: unknown[][]; fbq: unknown[][]; scripts: string[]; replaced: string[] };
    win: Record<string, unknown>;
    fireLoad: () => void;
    flushTimers: (ms?: number) => void;
}

/** Un navegador mínimo: lo justo para correr el código de las etiquetas. */
function fakeBrowser(href: string, opts: { framed?: boolean } = {}): FakeEnv {
    const calls: FakeEnv['calls'] = { gtag: [], fbq: [], scripts: [], replaced: [] };
    const timers: Array<{ at: number; fn: () => void }> = [];
    let now = 0;
    const listeners: Record<string, Array<() => void>> = {};
    const u = new URL(href);
    const location = {
        get href() {
            return u.href;
        },
        origin: u.origin,
        pathname: u.pathname,
    };
    const win: Record<string, unknown> = {};
    const doc = {
        readyState: 'loading',
        title: 'Contáctanos',
        head: { appendChild: (s: { src: string }) => calls.scripts.push(s.src) },
        createElement: () => ({ async: false, src: '' }),
    };
    Object.assign(win, {
        location,
        document: doc,
        history: {
            state: null,
            replaceState: (_s: unknown, _t: string, url: string) => {
                calls.replaced.push(url);
                const next = new URL(url, u.origin);
                u.search = next.search;
            },
        },
        URL,
        setTimeout: (fn: () => void, ms: number) => timers.push({ at: now + (ms || 0), fn }),
        addEventListener: (ev: string, fn: () => void) => (listeners[ev] ??= []).push(fn),
    });
    win.window = win;
    win.self = win;
    win.top = opts.framed ? {} : win;
    runInNewContext(DIRECT_TAGS_JS, win);
    const flushTimers = (ms = 5000): void => {
        const until = now + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at);
            const next = timers[0];
            if (!next || next.at > until) break;
            timers.shift();
            now = next.at;
            next.fn();
        }
        now = until;
    };
    const fireLoad = (): void => {
        doc.readyState = 'complete';
        for (const fn of listeners.load ?? []) fn();
        flushTimers(1000);
        // Lo que dejaron los stubs (gtag → dataLayer, fbq → queue).
        const dl = (win.dataLayer as unknown[] | undefined) ?? [];
        calls.gtag = dl.map((a) => Array.from(a as ArrayLike<unknown>));
        const q = ((win.fbq as { queue?: unknown[] } | undefined)?.queue ?? []) as unknown[];
        calls.fbq = q.map((a) => Array.from(a as ArrayLike<unknown>));
    };
    return { calls, win, fireLoad, flushTimers };
}

const CFG = { google_ads: 'AW-123456789/AbCdEf', google_ads_id: 'AW-123456789', google_tag_id: 'G-AB12CD34', meta_pixel_id: '1234567890123', notice: 'x' };

describe('v0.1.375 — etiquetas en el enlace directo', () => {
    it('sólo con el interruptor y algún ID; el aviso nombra lo que se carga', () => {
        const off = conversionSettingsSchema.parse({ google_ads: 'AW-123456789/AbCdEf', google_tag_id: 'G-AB12CD34' });
        expect(directTags(off)).toBeNull();
        expect(directTags(conversionSettingsSchema.parse({ direct_tags: true }))).toBeNull();
        const on = directTags(conversionSettingsSchema.parse({ direct_tags: true, google_ads: 'AW-123456789/AbCdEf', meta_pixel_id: '1234567890123' }));
        expect(on).toEqual({
            google_ads: 'AW-123456789/AbCdEf',
            google_ads_id: 'AW-123456789',
            google_tag_id: null,
            meta_pixel_id: '1234567890123',
            notice: 'Esta página usa cookies de Google y Meta para medir las campañas.',
        });
        expect(directTags(conversionSettingsSchema.parse({ direct_tags: true, google_tag_id: 'G-AB12CD34', cookie_notice: false }))!.notice).toBeNull();
    });

    it('la CSP: el hash del código, sólo los dominios de cada etiqueta y lo propio limitado a la ruta pública', () => {
        const google = cacheablePageCsp('sha256-abc', '*', null, {
            tags: { csp: directTagsCsp({ google_ads_id: 'AW-1', google_tag_id: null, meta_pixel_id: null }), origin: 'https://base.acme.co' },
        });
        expect(google).toContain(`'${directTagsHash()}'`);
        expect(google).toContain('https://www.googletagmanager.com');
        expect(google).toContain('https://www.googleadservices.com');
        expect(google).toContain('https://www.google.com.co');
        expect(google).not.toContain('facebook');
        expect(google).toContain('connect-src https://base.acme.co/api/v1/public/ ');
        expect(google).toContain('form-action https://base.acme.co/api/v1/public/');
        expect(google).not.toContain("connect-src 'self'");
        expect(google).toContain("worker-src 'none'");
        // Nunca la app en un marco.
        expect(/frame-src [^;]*'self'/.test(google)).toBe(false);

        const meta = cacheablePageCsp('sha256-abc', '*', null, {
            tags: { csp: directTagsCsp({ google_ads_id: null, google_tag_id: null, meta_pixel_id: '1234567890' }), origin: 'https://base.acme.co' },
        });
        expect(meta).toContain('https://connect.facebook.net');
        expect(meta).not.toContain('googletagmanager');

        // Sin etiquetas: igual que siempre.
        const plain = cacheablePageCsp('sha256-abc', '*', null);
        expect(plain).toContain("connect-src 'self'");
        expect(plain).not.toContain(directTagsHash());
        expect(plain).not.toContain('worker-src');

        // Un Host raro no se usa: queda 'self' (nunca una fuente inventada).
        expect(pageOrigin('https', 'base.acme.co')).toBe('https://base.acme.co');
        expect(pageOrigin('http', 'localhost:5174')).toBe('http://localhost:5174');
        expect(pageOrigin('https', "evil.co; script-src *")).toBeNull();
        expect(pageOrigin('https', '')).toBeNull();
    });

    it('la página lleva el código sólo con etiquetas, y la CSP autoriza exactamente ese texto', () => {
        const meta = { title: 'Contáctanos', conversion: { google_ads: null, meta_event: false, attribution: false, direct: CFG } } as unknown as PublicFormMeta;
        const html = renderFormPage({ title: 'T', meta, token: 'tok', themeCss: '', bodyClasses: [], preloadFont: null, client: 'void 0', directTags: true });
        const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
        expect(scripts).toHaveLength(2);
        expect(sha(scripts[0]!)).toBe(directTagsHash());
        const without = renderFormPage({ title: 'T', meta: { ...meta, conversion: { ...meta.conversion!, direct: null } }, token: 'tok', themeCss: '', bodyClasses: [], preloadFont: null, client: 'void 0', directTags: true });
        expect(without).not.toContain('imbPixels');

        const book = renderBookingPage({ title: 'A', boot: { mode: 'book', token: 't', meta: { conversion: { direct: CFG } } as never, manage: null }, themeCss: '', bodyClasses: [] });
        const bs = [...book.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
        expect(sha(bs[0]!)).toBe(directTagsHash());
        expect(sha(bs[1]!)).toBe(bookingClientHash());
        // La página de una cita ya agendada nunca las carga.
        const manage = renderBookingPage({ title: 'A', boot: { mode: 'manage', token: 't', meta: { conversion: { direct: CFG } } as never, manage: null }, themeCss: '', bodyClasses: [] });
        expect([...manage.matchAll(/<script>([\s\S]*?)<\/script>/g)]).toHaveLength(1);
    });

    it('carga los scripts oficiales al terminar de cargar, con la dirección sin datos personales', () => {
        const env = fakeBrowser('https://base.acme.co/api/v1/public/f/tok?nombre=Ana&correo=ana%40x.co&utm_source=google&gclid=Cj0K');
        const pixels = env.win.imbPixels as { start: (c: unknown) => boolean };
        expect(pixels.start(CFG)).toBe(true);
        expect(pixels.start(CFG)).toBe(false);
        expect(env.calls.scripts).toEqual([]);
        env.fireLoad();
        expect(env.calls.replaced).toEqual(['/api/v1/public/f/tok?utm_source=google&gclid=Cj0K']);
        expect(env.calls.scripts).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-AB12CD34', 'https://connect.facebook.net/en_US/fbevents.js']);
        const config = env.calls.gtag.filter((c) => c[0] === 'config');
        expect(config.map((c) => c[1])).toEqual(['AW-123456789', 'G-AB12CD34']);
        expect(config[0]![2]).toMatchObject({
            cookie_path: '/api/v1/public/',
            cookie_domain: 'none',
            page_location: 'https://base.acme.co/api/v1/public/f/tok?utm_source=google&gclid=Cj0K',
        });
        expect(env.calls.fbq).toEqual([
            ['set', 'autoConfig', false, '1234567890123'],
            ['init', '1234567890123'],
            ['track', 'PageView'],
        ]);
    });

    it('dentro de un marco no arranca (ahí mandan las etiquetas del sitio); un ID inválido tampoco', () => {
        const framed = fakeBrowser('https://base.acme.co/api/v1/public/f/tok', { framed: true });
        expect((framed.win.imbPixels as { start: (c: unknown) => boolean }).start(CFG)).toBe(false);
        framed.fireLoad();
        expect(framed.calls.scripts).toEqual([]);
        const bad = fakeBrowser('https://base.acme.co/api/v1/public/f/tok');
        expect((bad.win.imbPixels as { start: (c: unknown) => boolean }).start({ google_tag_id: 'GTM-XYZ', meta_pixel_id: 'abc' })).toBe(false);
    });

    it('la conversión: Google Ads con el id del envío, Analytics, Meta con eventID y done al terminar', () => {
        const env = fakeBrowser('https://base.acme.co/api/v1/public/f/tok');
        const pixels = env.win.imbPixels as { start: (c: unknown) => boolean; conversion: (ev: unknown, done: () => void) => void };
        pixels.start(CFG);
        let done = 0;
        pixels.conversion(
            { kind: 'form', name: 'Contáctanos', submission_id: 'abc123def456', value: 50000, currency: 'COP', user_data: { email: 'Ana@X.co', phone_number: '+573001112233' } },
            () => done++,
        );
        // Antes del tope, las etiquetas no avisaron: todavía no.
        env.flushTimers(1000);
        expect(done).toBe(0);
        env.fireLoad();
        const events = env.calls.gtag.filter((c) => c[0] === 'event');
        expect(events[0]![1]).toBe('conversion');
        expect(events[0]![2]).toMatchObject({ send_to: 'AW-123456789/AbCdEf', transaction_id: 'abc123def456', value: 50000, currency: 'COP' });
        expect(events[1]![1]).toBe('generate_lead');
        expect(events[1]![2]).toMatchObject({ send_to: 'G-AB12CD34', lead_source: 'form', value: 50000, currency: 'COP' });
        expect(env.calls.gtag).toContainEqual(['set', 'user_data', { email: 'Ana@X.co', phone_number: '+573001112233' }]);
        expect(env.calls.fbq).toContainEqual(['init', '1234567890123', { em: 'ana@x.co', ph: '573001112233' }]);
        expect(env.calls.fbq).toContainEqual(['track', 'Lead', { value: 50000, currency: 'COP' }, { eventID: 'abc123def456' }]);
        // Google avisa (event_callback): con las dos, done se llama una vez.
        (events[0]![2] as { event_callback: () => void }).event_callback();
        (events[1]![2] as { event_callback: () => void }).event_callback();
        expect(done).toBe(1);
        env.flushTimers(3000);
        expect(done).toBe(1);
    });

    it('la agenda registra «Schedule»; si las etiquetas no contestan (un bloqueador), done llega al tope', () => {
        const env = fakeBrowser('https://base.acme.co/api/v1/public/b/tok');
        const pixels = env.win.imbPixels as { start: (c: unknown) => boolean; conversion: (ev: unknown, done: () => void) => void };
        pixels.start({ ...CFG, google_tag_id: null });
        env.fireLoad();
        let done = 0;
        pixels.conversion({ kind: 'booking', submission_id: 'zzz', value: null, currency: null }, () => done++);
        const q = ((env.win.fbq as { queue: unknown[] }).queue ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
        expect(q).toContainEqual(['track', 'Schedule', {}, { eventID: 'zzz' }]);
        env.flushTimers(1500);
        expect(done).toBe(0);
        env.flushTimers(200);
        expect(done).toBe(1);
    });
});
