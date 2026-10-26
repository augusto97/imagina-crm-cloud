import { useSyncExternalStore } from 'react';

import { deviceInfo } from './platform';

/**
 * H1 — «Instalar la app».
 *
 * Chrome/Edge/Android avisan que la app se puede instalar con
 * `beforeinstallprompt`: se guarda el evento (hay que escucharlo ANTES de
 * montar React — llega temprano) y el menú de la persona ofrece «Instalar la
 * app». En iPhone/iPad no hay evento: se muestran las instrucciones de
 * Safari (Compartir → Agregar a inicio).
 */
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export function captureInstallPrompt(win: Window = window): void {
    win.addEventListener('beforeinstallprompt', (e) => {
        // Sin `preventDefault` Chrome muestra su propia barra; la app lo ofrece
        // en el menú de la persona, que es donde se busca.
        e.preventDefault();
        deferred = e as BeforeInstallPromptEvent;
        emit();
    });
    win.addEventListener('appinstalled', () => {
        deferred = null;
        installed = true;
        emit();
    });
}

export type InstallMode = 'prompt' | 'ios' | null;

function snapshot(): string {
    const info = deviceInfo();
    if (installed || info.standalone) return 'none';
    if (deferred) return 'prompt';
    if (info.ios) return 'ios';
    return 'none';
}

/** Cómo se instala aquí: con el diálogo del navegador, con instrucciones de iOS, o no se puede/ya está. */
export function useInstallMode(): InstallMode {
    const v = useSyncExternalStore(
        (cb) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        snapshot,
        () => 'none',
    );
    return v === 'none' ? null : (v as InstallMode);
}

/** Abre el diálogo del navegador. `true` si la persona aceptó. */
export async function promptInstall(): Promise<boolean> {
    const ev = deferred;
    if (!ev) return false;
    deferred = null;
    emit();
    await ev.prompt();
    const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    return choice.outcome === 'accepted';
}
