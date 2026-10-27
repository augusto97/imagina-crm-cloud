import { useEffect } from 'react';

import { hideBootSplash } from '@/lib/bootSplash';

/**
 * v0.1.327 — se monta junto a lo PRIMERO que la app tiene para mostrar (el
 * login, la app, el reset de contraseña…) y retira la pantalla de arranque.
 */
export function BootSplashDone(): null {
    useEffect(() => {
        hideBootSplash();
    }, []);
    return null;
}
