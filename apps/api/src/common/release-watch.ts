import { realpathSync } from 'node:fs';

/**
 * v0.1.435 — El proceso de trabajos (IMAGINA_ROLE=worker) corre desde
 * `current/apps/api`, un enlace a la versión activa. Una actualización cambia
 * el enlace y reinicia el API, pero si el usuario de la app no puede reiniciar
 * también este servicio (sudoers viejo), el proceso seguiría con el código de
 * la versión anterior — y la poda la borraría debajo de sus pies. Por eso se
 * vigila solo: cuando el enlace apunta a otra carpeta, termina en orden y
 * systemd (`Restart=always`) lo vuelve a arrancar con la versión nueva.
 *
 * Puro respecto del reloj y del disco: `resolve` y `stop` se inyectan.
 */
export interface ReleaseWatchOptions {
    /** Carpeta con la que arrancó el proceso (física, sin enlaces). */
    startedIn: string;
    /** Ruta con el enlace (`/opt/imagina-base/current/apps/api`). */
    watchPath: string;
    resolve?: (p: string) => string;
    /** Se llama UNA vez con la carpeta nueva. */
    onChange: (next: string) => void;
}

/** Revisa una vez. Devuelve la carpeta nueva si cambió, o null. */
export function releaseChanged(opts: Pick<ReleaseWatchOptions, 'startedIn' | 'watchPath' | 'resolve'>): string | null {
    const resolve = opts.resolve ?? ((p: string) => realpathSync(p));
    let now: string;
    try {
        now = resolve(opts.watchPath);
    } catch {
        // En medio del cambio del enlace (o sin el layout de versiones): no hacer nada.
        return null;
    }
    return now !== opts.startedIn ? now : null;
}

/** Vigila cada `everyMs`; devuelve una función para detener la vigilancia. */
export function watchRelease(opts: ReleaseWatchOptions, everyMs = 15_000): () => void {
    let fired = false;
    const timer = setInterval(() => {
        if (fired) return;
        const next = releaseChanged(opts);
        if (next) {
            fired = true;
            clearInterval(timer);
            opts.onChange(next);
        }
    }, everyMs);
    timer.unref?.();
    return () => clearInterval(timer);
}
