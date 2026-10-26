/**
 * H3 — Señal de cada lectura en el escaneo continuo (inventario, entradas a un
 * evento): un pitido corto y/o una vibración, distintos si se encontró el
 * registro o no. Opcional y recordado por dispositivo.
 */
const KEY = 'imcrm:scan:feedback';

export interface ScanFeedbackPrefs {
    sound: boolean;
    vibrate: boolean;
}

export function readFeedbackPrefs(): ScanFeedbackPrefs {
    try {
        const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<ScanFeedbackPrefs>;
        return { sound: raw.sound !== false, vibrate: raw.vibrate !== false };
    } catch {
        return { sound: true, vibrate: true };
    }
}

export function writeFeedbackPrefs(p: ScanFeedbackPrefs): void {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
        /* storage bloqueado */
    }
}

let audio: AudioContext | null = null;

function beep(freq: number, ms: number): void {
    try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        audio ??= new Ctor();
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
        osc.connect(gain).connect(audio.destination);
        osc.start();
        osc.stop(audio.currentTime + ms / 1000);
    } catch {
        /* sin audio: no pasa nada */
    }
}

export function signalScan(kind: 'found' | 'missing' | 'many', prefs: ScanFeedbackPrefs): void {
    if (prefs.sound) {
        if (kind === 'found') beep(1046, 120);
        else if (kind === 'many') beep(784, 160);
        else beep(220, 280);
    }
    if (prefs.vibrate && typeof navigator.vibrate === 'function') {
        navigator.vibrate(kind === 'found' ? 70 : [60, 60, 60]);
    }
}
