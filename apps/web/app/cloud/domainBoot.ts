import { api, useSession } from '@/cloud/session';

/**
 * Boot white-label pre-login (ADR-S17): si la app se abrió por un dominio /
 * subdominio de una empresa, `GET /public/boot` (SIN auth — el backend
 * resuelve el `Host`) devuelve su marca. Guardamos el tenant del dominio en
 * el store de sesión: `useBranding` re-pinta los tokens al instante (el LOGIN
 * ya sale con el color de la empresa), la LoginPage muestra logo/nombre y,
 * tras hidratar la sesión, el workspace queda fijado a esa empresa si el
 * usuario tiene membership (ver `setDomainTenant`/`setSession`).
 *
 * Corre en paralelo del check de sesión (`GET /auth/me`); el orden de llegada
 * no importa (el store resuelve el lock en ambos sentidos). Si falla (red,
 * backend viejo) seguimos SIN white-label: jamás rompe el boot.
 */
export function initDomainBoot(): void {
    void api
        .publicBoot()
        .then((boot) => {
            // v0.1.245 — el dominio del PORTAL de una empresa (el de sus
            // clientes) nunca muestra la app del equipo: va directo al portal.
            if (boot.tenant?.surface === 'portal' && !window.location.pathname.startsWith('/portal')) {
                window.location.replace('/portal');
                return;
            }
            useSession.getState().setDomainTenant(boot.tenant);
        })
        .catch(() => {
            // Dominio de plataforma o error de red: marca por defecto.
        });
}
