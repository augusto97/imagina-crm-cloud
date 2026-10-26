import { __ } from '@/lib/i18n';

/**
 * User-Agent crudo → algo legible ("Chrome · Windows"). Lo usan las sesiones
 * abiertas (Ajustes → Seguridad, v0.1.116) y los dispositivos con
 * notificaciones push (Ajustes → Avisos, H1).
 */
export function describeDevice(ua: string): { label: string; mobile: boolean } {
    if (ua === '') return { label: __('Dispositivo desconocido'), mobile: false };
    const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
    const browser =
        /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
        : /Edg\//.test(ua) ? 'Edge'
        : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
        : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
        : /Safari\//.test(ua) ? 'Safari'
        : __('Navegador');
    const os =
        /Windows/i.test(ua) ? 'Windows'
        : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
        : /Android/i.test(ua) ? 'Android'
        : /Macintosh|Mac OS/i.test(ua) ? 'macOS'
        : /Linux/i.test(ua) ? 'Linux'
        : '';
    return { label: os !== '' ? `${browser} · ${os}` : browser, mobile };
}
