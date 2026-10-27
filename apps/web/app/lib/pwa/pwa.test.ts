// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveAppBarColor } from '@imagina-base/shared';

import { describeDevice } from '@/lib/deviceLabel';
import { codeForField, parseRecordLinkCode } from '@/lib/scan/codeSearch';

import { applyAppMeta, currentAppName } from './appMeta';
import { canOfferInstall, INSTALL_OFFER_RETRY_MS, offerDue, readOfferMemory, rememberOffer } from './installOffer';
import { boldSegments, installGuide } from './installGuide';
import { deviceInfo, pushSupport } from './platform';
import { base64UrlToBytes } from './push';
import { isOpenMessage, safeAppPath, takeTenantParam } from './serviceWorker';

const IPHONE_17 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_15 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

function fakeNav(ua: string, extra: Record<string, unknown> = {}): Navigator {
    return { userAgent: ua, maxTouchPoints: 5, ...extra } as unknown as Navigator;
}
function fakeWin(standalone: boolean, extra: Record<string, unknown> = {}): Window {
    return {
        matchMedia: () => ({ matches: standalone }),
        isSecureContext: true,
        navigator: { serviceWorker: {} },
        PushManager: function () {},
        Notification: function () {},
        ...extra,
    } as unknown as Window;
}

describe('H1 — qué puede este dispositivo', () => {
    it('iPhone: push sólo con la app instalada y en iOS 16.4+', () => {
        const inSafari = deviceInfo(fakeNav(IPHONE_17), fakeWin(false));
        expect(inSafari).toMatchObject({ ios: true, iosSafari: true, standalone: false, iosVersion: 17.4 });
        expect(pushSupport(fakeWin(false), inSafari)).toBe('ios-install');
        const installed = deviceInfo(fakeNav(IPHONE_17), fakeWin(true));
        expect(pushSupport(fakeWin(true), installed)).toBe('ok');
        expect(pushSupport(fakeWin(true), deviceInfo(fakeNav(IPHONE_15), fakeWin(true)))).toBe('ios-old');
    });

    it('Android y escritorio: depende de la API (y de https)', () => {
        const info = deviceInfo(fakeNav(ANDROID), fakeWin(false));
        expect(info).toMatchObject({ ios: false, android: true });
        expect(pushSupport(fakeWin(false), info)).toBe('ok');
        expect(pushSupport(fakeWin(false, { isSecureContext: false }), info)).toBe('unsupported');
        expect(pushSupport(fakeWin(false, { PushManager: undefined }), info)).not.toBe('ok');
    });

    it('nombre del dispositivo: un iPhone no se confunde con un Mac', () => {
        expect(describeDevice(IPHONE_17).label).toBe('Safari · iOS');
        expect(describeDevice(ANDROID)).toEqual({ label: 'Chrome · Android', mobile: true });
        expect(describeDevice('').label).toBe('Dispositivo desconocido');
    });
});

describe('H1 — puente con el service worker', () => {
    it('sólo rutas de este origen', () => {
        expect(safeAppPath('/#/lists/x/records/1')).toBe('/#/lists/x/records/1');
        expect(safeAppPath('//evil.test/x')).toBe('/');
        expect(safeAppPath('https://evil.test')).toBe('/');
        expect(isOpenMessage({ type: 'imcrm:open', url: '/', tenant_id: 3 })).toBe(true);
        expect(isOpenMessage({ type: 'otro' })).toBe(false);
    });

    it('?t= de una notificación: se lee y se quita de la URL', () => {
        window.history.replaceState(null, '', '/?t=7&x=1#/lists/a/records/2');
        expect(takeTenantParam()).toBe(7);
        expect(window.location.search).toBe('?x=1');
        expect(window.location.hash).toBe('#/lists/a/records/2');
        expect(takeTenantParam()).toBeNull();
    });

    it('clave VAPID base64url → bytes', () => {
        expect(Array.from(base64UrlToBytes('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
    });

    it('metas de la app con la marca', () => {
        applyAppMeta('#aa2200', 'Acme CRM');
        expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#aa2200');
        expect(currentAppName()).toBe('Acme CRM');
        applyAppMeta('rojo', null);
        expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#ffffff');
        expect(currentAppName()).toBe('Imagina Base');
    });

    it('v0.1.326 — barras del sistema: neutras por defecto, siguen el tema; la marca u otro color si se elige', () => {
        expect(resolveAppBarColor(null, '#FF00AA', 'light')).toBe('#ffffff');
        expect(resolveAppBarColor(null, '#FF00AA', 'dark')).toBe('#121212');
        expect(resolveAppBarColor('brand', '#FF00AA', 'dark')).toBe('#ff00aa');
        expect(resolveAppBarColor('brand', null, 'light')).toBe('#ffffff');
        expect(resolveAppBarColor('#1F2937', '#FF00AA', 'light')).toBe('#1f2937');
        expect(resolveAppBarColor('rojo', '#FF00AA', 'light')).toBe('#ffffff');
    });
});

describe('v0.1.326 — ofrecer la instalación la primera vez', () => {
    const base = { ios: false, android: false, standalone: false, iosSafari: false, iosVersion: null };
    it('dónde se ofrece', () => {
        expect(canOfferInstall('prompt', base, 'chrome')).toBe(true);
        expect(canOfferInstall(null, base, 'chrome')).toBe(false);
        expect(canOfferInstall('prompt', { ...base, standalone: true }, 'chrome')).toBe(false);
        // Chrome/Edge sin la ventana del navegador: casi siempre ya instalada.
        expect(canOfferInstall('help', base, 'chrome')).toBe(false);
        expect(canOfferInstall('help', { ...base, android: true }, 'chrome')).toBe(false);
        expect(canOfferInstall('help', base, 'firefox')).toBe(false);
        expect(canOfferInstall('help', { ...base, ios: true, iosSafari: true }, 'safari')).toBe(true);
        expect(canOfferInstall('help', { ...base, ios: true }, 'chrome')).toBe(true);
        expect(canOfferInstall('help', { ...base, android: true }, 'samsung')).toBe(true);
        expect(canOfferInstall('help', base, 'safari')).toBe(true);
    });

    it('una vez por dispositivo y una segunda a los 30 días; instalada, nunca más', () => {
        const store = new Map<string, string>();
        const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
        const t0 = 1_000_000;
        let m = readOfferMemory(storage);
        expect(offerDue(m, t0)).toBe(true);
        m = rememberOffer(m, t0, 'shown', storage);
        expect(offerDue(readOfferMemory(storage), t0 + 1000)).toBe(false);
        expect(offerDue(readOfferMemory(storage), t0 + INSTALL_OFFER_RETRY_MS)).toBe(true);
        m = rememberOffer(m, t0 + INSTALL_OFFER_RETRY_MS, 'shown', storage);
        expect(offerDue(readOfferMemory(storage), t0 + 10 * INSTALL_OFFER_RETRY_MS)).toBe(false);
        rememberOffer({ count: 0, at: 0 }, t0, 'installed', storage);
        expect(offerDue(readOfferMemory(storage), t0)).toBe(false);
        store.set('imcrm:install-offer', '{roto');
        expect(readOfferMemory(storage)).toEqual({ count: 0, at: 0 });
    });
});

describe('H3 — códigos escaneados', () => {
    const origin = 'https://app.acme.test';
    it('un QR con el enlace de un registro de ESTA app se abre directo', () => {
        expect(parseRecordLinkCode(`${origin}/#/lists/inventario/records/42`, origin)).toEqual({ listSlug: 'inventario', recordId: 42 });
        expect(parseRecordLinkCode(`${origin}/#/lists/inventario/records?view=3&record=9`, origin)).toEqual({ listSlug: 'inventario', recordId: 9 });
        expect(parseRecordLinkCode('https://otro.test/#/lists/x/records/1', origin)).toBeNull();
        expect(parseRecordLinkCode('7701234567890', origin)).toBeNull();
    });

    it('llenar un campo: texto tal cual; número sólo si lo es', () => {
        expect(codeForField('TZ-001', 'text')).toEqual({ ok: true, value: 'TZ-001' });
        expect(codeForField('0123', 'number')).toEqual({ ok: true, value: 123 });
        expect(codeForField('TZ-001', 'number').ok).toBe(false);
    });
});

describe('v0.1.321 — pasos para instalar según el navegador', () => {
    const DESKTOP = { ios: false, android: false, standalone: false, iosSafari: false, iosVersion: null };

    it('Chrome y Edge en el computador: el ícono de la barra y el camino por el menú', () => {
        const chrome = installGuide(DESKTOP, 'chrome');
        expect(chrome.unsupported).toBe(false);
        expect(chrome.steps.join(' ')).toMatch(/Instalar página como app/);
        expect(installGuide(DESKTOP, 'edge').steps.join(' ')).toMatch(/Instalar este sitio como una aplicación/);
    });

    it('Firefox en el computador no instala: lo dice y sugiere otro navegador', () => {
        const g = installGuide(DESKTOP, 'firefox');
        expect(g.unsupported).toBe(true);
        expect(g.steps).toEqual([]);
        expect(g.note).toMatch(/Chrome, Edge o Safari/);
    });

    it('Safari en el Mac: Agregar al Dock', () => {
        expect(installGuide(DESKTOP, 'safari').steps.join(' ')).toMatch(/Agregar al Dock/);
    });

    it('iPhone: Compartir → Agregar a inicio, y fuera de Safari sugiere Safari', () => {
        const safari = installGuide(deviceInfo(fakeNav(IPHONE_17), fakeWin(false)), 'safari');
        expect(safari.where).toMatch(/Safari/);
        expect(safari.steps.join(' ')).toMatch(/Agregar a inicio/);
        const chromeIos = installGuide({ ...DESKTOP, ios: true, iosSafari: false }, 'chrome');
        expect(chromeIos.where).toMatch(/^Chrome/);
        expect(chromeIos.note).toMatch(/Safari/);
    });

    it('Android: Chrome por el menú ⋮ y Samsung Internet por su menú', () => {
        const info = deviceInfo(fakeNav(ANDROID), fakeWin(false));
        expect(installGuide(info, 'chrome').steps.join(' ')).toMatch(/Instalar app/);
        expect(installGuide(info, 'samsung').steps.join(' ')).toMatch(/Pantalla de inicio/);
    });

    it('la negrita se dibuja por tramos, sin HTML', () => {
        expect(boldSegments('Toca **Compartir** y luego **Agregar**.')).toEqual([
            { text: 'Toca ', bold: false },
            { text: 'Compartir', bold: true },
            { text: ' y luego ', bold: false },
            { text: 'Agregar', bold: true },
            { text: '.', bold: false },
        ]);
        expect(boldSegments('<b>x</b>')).toEqual([{ text: '<b>x</b>', bold: false }]);
    });
});
