import type { InstallMode } from './install';
import type { browserName, DeviceInfo } from './platform';

/**
 * v0.1.326 — Ofrecer la instalación la primera vez en cada dispositivo (antes
 * había que encontrar «Instalar la app» en el menú de la persona).
 *
 * Reglas (puras, para poder probarlas):
 *  - sólo si la app no corre ya instalada;
 *  - con la ventana del navegador (Chrome/Edge/Android: `beforeinstallprompt`)
 *    se ofrece siempre;
 *  - sin ella, sólo donde instalar es con pasos y no hay otra señal: iPhone y
 *    iPad, Android con Samsung Internet o Firefox, y Safari del Mac. En Chrome
 *    o Edge sin la ventana la app suele estar YA instalada (o la persona cerró
 *    el aviso del navegador): ahí no se insiste. Firefox de escritorio no
 *    instala;
 *  - una vez por dispositivo; si se descarta, una segunda y última vez a los
 *    30 días. Queda en `localStorage` (es de ESTE dispositivo, no de la cuenta).
 */
export const INSTALL_OFFER_KEY = 'imcrm:install-offer';
export const INSTALL_OFFER_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
export const INSTALL_OFFER_MAX = 2;

export interface InstallOfferMemory {
    /** Cuántas veces se ofreció en este dispositivo. */
    count: number;
    /** Cuándo fue la última (ms). */
    at: number;
    /** Ya la instaló (o tocó «Instalar»): no se vuelve a ofrecer. */
    done?: boolean;
}

export function canOfferInstall(mode: InstallMode, info: DeviceInfo, browser: ReturnType<typeof browserName>): boolean {
    if (mode === null || info.standalone) return false;
    if (mode === 'prompt') return true;
    if (info.ios) return true;
    if (info.android) return browser === 'samsung' || browser === 'firefox';
    return browser === 'safari';
}

export function readOfferMemory(storage: Pick<Storage, 'getItem'> = localStorage): InstallOfferMemory {
    try {
        const raw = JSON.parse(storage.getItem(INSTALL_OFFER_KEY) ?? 'null') as Partial<InstallOfferMemory> | null;
        if (!raw || typeof raw !== 'object') return { count: 0, at: 0 };
        return {
            count: Number.isFinite(raw.count) ? Math.max(0, Number(raw.count)) : 0,
            at: Number.isFinite(raw.at) ? Number(raw.at) : 0,
            done: raw.done === true,
        };
    } catch {
        return { count: 0, at: 0 };
    }
}

/** ¿Toca ofrecerla ahora en este dispositivo? */
export function offerDue(memory: InstallOfferMemory, now: number): boolean {
    if (memory.done) return false;
    if (memory.count <= 0) return true;
    if (memory.count >= INSTALL_OFFER_MAX) return false;
    return now - memory.at >= INSTALL_OFFER_RETRY_MS;
}

export function rememberOffer(
    memory: InstallOfferMemory,
    now: number,
    outcome: 'shown' | 'installed',
    storage: Pick<Storage, 'setItem'> = localStorage,
): InstallOfferMemory {
    const next: InstallOfferMemory =
        outcome === 'installed' ? { ...memory, done: true } : { count: memory.count + 1, at: now, done: memory.done };
    try {
        storage.setItem(INSTALL_OFFER_KEY, JSON.stringify(next));
    } catch {
        /* sin storage (modo privado): se ofrecerá de nuevo, nada grave */
    }
    return next;
}
