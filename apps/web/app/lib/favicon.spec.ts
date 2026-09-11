// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
    DEFAULT_APPLE_TOUCH_ICON,
    DEFAULT_FAVICON_PNG,
    DEFAULT_FAVICON_SVG,
    applyDocumentTitle,
    applyFavicon,
} from '@/lib/favicon';

/** Reproduce los <link> que declara `cloud/index.html`. */
function seedHead(): void {
    document.head.innerHTML = `
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" data-imcrm-default="1" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" data-imcrm-default="1" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" data-imcrm-default="1" />
    `;
}

const icons = () => Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
const touch = () => document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');

describe('favicon white-label (v0.1.177)', () => {
    beforeEach(seedHead);

    it('con logo del tenant: UN solo icon sin type apuntando al logo, y el apple-touch también', () => {
        applyFavicon('/api/v1/files/7/signed?tenant=1&sig=x');
        const list = icons();
        expect(list).toHaveLength(1);
        expect(list[0]!.getAttribute('href')).toBe('/api/v1/files/7/signed?tenant=1&sig=x');
        expect(list[0]!.hasAttribute('type')).toBe(false);
        expect(touch()!.getAttribute('href')).toBe('/api/v1/files/7/signed?tenant=1&sig=x');
        // Los defaults se fueron.
        expect(document.head.querySelectorAll('[data-imcrm-default]')).toHaveLength(0);
    });

    it('cambiar de logo reusa el mismo <link> (no acumula)', () => {
        applyFavicon('/logo-a.png');
        applyFavicon('/logo-b.png');
        expect(icons()).toHaveLength(1);
        expect(icons()[0]!.getAttribute('href')).toBe('/logo-b.png');
    });

    it('null restaura los defaults de la app (svg + png 32 + apple-touch) y quita el logo', () => {
        applyFavicon('/logo-a.png');
        applyFavicon(null);
        const list = icons();
        expect(list.map((l) => l.getAttribute('href')).sort()).toEqual(
            [DEFAULT_FAVICON_PNG, DEFAULT_FAVICON_SVG].sort(),
        );
        expect(list.find((l) => l.type === 'image/svg+xml')).toBeDefined();
        expect(list.find((l) => l.type === 'image/png')?.getAttribute('sizes')).toBe('32x32');
        expect(touch()!.getAttribute('href')).toBe(DEFAULT_APPLE_TOUCH_ICON);
        expect(document.head.querySelectorAll('[data-imcrm-brand]')).toHaveLength(0);
    });

    it('null sobre un head sin links (HTML viejo cacheado) los crea', () => {
        document.head.innerHTML = '';
        applyFavicon(null);
        expect(icons()).toHaveLength(2);
        expect(touch()).not.toBeNull();
    });

    it('título: app_name del tenant o "Imagina Base"; con sección va "Sección — Nombre"', () => {
        applyDocumentTitle('Acme CRM');
        expect(document.title).toBe('Acme CRM');
        applyDocumentTitle(null);
        expect(document.title).toBe('Imagina Base');
        applyDocumentTitle('  ', 'Portal');
        expect(document.title).toBe('Portal — Imagina Base');
        applyDocumentTitle('Acme', 'Portal');
        expect(document.title).toBe('Portal — Acme');
    });
});
