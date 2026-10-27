import { useEffect } from 'react';

import { hideBootSplash, rememberShell } from '@/lib/bootSplash';

/**
 * v0.1.327 — se monta junto a lo PRIMERO que la app tiene para mostrar (el
 * login, la app, el reset de contraseña…) y retira la pantalla de arranque.
 *
 * v0.1.329 — `shell` le dice a la PRÓXIMA apertura qué esperar: con la app
 * (true) arranca con el contorno de la app; con el login (false), con el
 * fondo liso. Sin el dato (reset, verificación…) no cambia lo recordado.
 */
export function BootSplashDone({ shell }: { shell?: boolean } = {}): null {
    useEffect(() => {
        hideBootSplash();
        if (shell !== undefined) rememberShell(shell);
    }, [shell]);
    return null;
}
