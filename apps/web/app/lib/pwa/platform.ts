/**
 * H1 — Qué puede el navegador de este dispositivo (instalar, push, cámara).
 * Funciones puras sobre `navigator`/`window` (testeables con jsdom).
 */

export interface DeviceInfo {
    ios: boolean;
    android: boolean;
    /** La app corre instalada (pantalla de inicio / ventana propia). */
    standalone: boolean;
    /** Safari de iPhone/iPad (el único que instala en iOS antes de la 16.4). */
    iosSafari: boolean;
    /** Versión de iOS (mayor.menor) o null. */
    iosVersion: number | null;
}

export function deviceInfo(nav: Navigator = navigator, win: Window = window): DeviceInfo {
    const ua = nav.userAgent || '';
    // iPadOS se presenta como Mac: se reconoce por la pantalla táctil.
    const ipadOs = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
    const ios = /iPhone|iPad|iPod/.test(ua) || ipadOs;
    const m = /OS (\d+)[_.](\d+)/.exec(ua);
    const iosVersion = ios && m ? Number(`${m[1]}.${m[2]}`) : ios && ipadOs ? versionFromSafari(ua) : null;
    const standalone =
        (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches) ||
        (nav as Navigator & { standalone?: boolean }).standalone === true;
    const iosSafari = ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return { ios, android: /Android/i.test(ua), standalone, iosSafari, iosVersion };
}

function versionFromSafari(ua: string): number | null {
    const m = /Version\/(\d+)\.(\d+)/.exec(ua);
    return m ? Number(`${m[1]}.${m[2]}`) : null;
}

export type PushSupport =
    /** Se puede activar. */
    | 'ok'
    /** El navegador no tiene Web Push (o no es un contexto seguro). */
    | 'unsupported'
    /** iPhone/iPad: sólo con la app instalada en la pantalla de inicio (iOS 16.4+). */
    | 'ios-install'
    /** iPhone/iPad con un iOS anterior a 16.4: no hay forma. */
    | 'ios-old';

export function pushSupport(win: Window = window, info: DeviceInfo = deviceInfo()): PushSupport {
    if (info.ios) {
        if (info.iosVersion !== null && info.iosVersion < 16.4) return 'ios-old';
        if (!info.standalone) return 'ios-install';
    }
    const w = win as unknown as { PushManager?: unknown; Notification?: unknown };
    const has =
        win.isSecureContext === true &&
        'serviceWorker' in win.navigator &&
        typeof w.PushManager !== 'undefined' &&
        typeof w.Notification !== 'undefined';
    return has ? 'ok' : 'unsupported';
}

/** El navegador, en palabras, para las instrucciones de desbloqueo. */
export function browserName(ua: string = navigator.userAgent): 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'other' {
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Firefox\//.test(ua) || /FxiOS/.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua) || /CriOS/.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
}
