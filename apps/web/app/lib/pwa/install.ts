import { useSyncExternalStore } from 'react';

import { deviceInfo } from './platform';

/**
 * H1 — «Instalar la app».
 *
 * Chrome/Edge/Android avisan que la app se puede instalar con
 * `beforeinstallprompt`: se guarda el evento (hay que escucharlo ANTES de
 * montar React — llega temprano) y «Instalar la app» abre esa ventana.
 *
 * v0.1.321 — cuando el navegador NO avisa (Firefox, Safari, o Chrome/Edge
 * con el aviso ya cerrado o la app ya instalada en el equipo), la opción se
 * muestra IGUAL y abre los pasos para ese navegador (`installGuide`): antes
 * no aparecía en ningún lado. Sólo se oculta si la app ya corre instalada.
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

/** `prompt`: la ventana del navegador; `help`: los pasos para este navegador; null: ya corre instalada. */
export type InstallMode = 'prompt' | 'help' | null;

function snapshot(): string {
    if (installed || deviceInfo().standalone) return 'none';
    return deferred ? 'prompt' : 'help';
}

/** Cómo se instala aquí: con la ventana del navegador, con los pasos de este navegador, o ya está instalada. */
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
