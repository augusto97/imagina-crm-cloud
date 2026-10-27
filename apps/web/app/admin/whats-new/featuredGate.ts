/**
 * Cuándo se puede presentar una novedad destacada (el diálogo «Nuevo: …»).
 * Aparte del componente para poder probarlo sin montar el diálogo.
 *
 * Reglas (las del servidor deciden QUÉ destacada y a QUIÉN; éstas, CUÁNDO):
 *  - una por sesión del navegador, y como mucho una cada 12 horas aunque se
 *    abran pestañas nuevas;
 *  - nunca encima de otra cosa: otro diálogo, un menú abierto, un recorrido,
 *    la bienvenida de una empresa nueva o un campo donde la persona escribe.
 *    Si algo la ocupa, se espera y se vuelve a mirar.
 *
 * Convención para las otras piezas de ayuda: un recorrido o una bienvenida en
 * curso marcan su capa con `data-help-overlay` (o son un `role="dialog"`).
 */
export const FEATURED_SESSION_KEY = 'imcrm:whats-new:featured-session';
export const FEATURED_LAST_KEY = 'imcrm:whats-new:featured-at';
/** Aunque se abran pestañas nuevas, una presentación cada 12 horas como mucho. */
export const FEATURED_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const BUSY_SELECTORS = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    '[role="menu"][data-state="open"]',
    '[data-radix-popper-content-wrapper]',
    // Un recorrido o una bienvenida en curso (las otras piezas de ayuda).
    '[data-help-overlay]',
    '[data-tour-active]',
    '[data-onboarding-active]',
].join(', ');

/** Algo más está ocupando a la persona: la presentación espera. */
export function screenIsBusy(doc: Document = document): boolean {
    if (doc.querySelector(BUSY_SELECTORS)) return true;
    const active = doc.activeElement as HTMLElement | null;
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return true;
    return Boolean(doc.body?.dataset.tourActive);
}

/** En la propia página de Novedades ya se está leyendo lo nuevo: no se presenta. */
export function isOnWhatsNewPage(loc: Pick<Location, 'hash' | 'pathname'> = window.location): boolean {
    return /^#?\/novedades(?:[/?]|$)/.test(loc.hash) || /^\/novedades(?:[/?]|$)/.test(loc.pathname);
}

/** ¿Se puede presentar ahora? (una por sesión, una cada 12 h). Sin storage, sí: el servidor igual la marca. */
export function canPresentNow(now: number, session: Pick<Storage, 'getItem'> = sessionStorage, local: Pick<Storage, 'getItem'> = localStorage): boolean {
    try {
        if (session.getItem(FEATURED_SESSION_KEY)) return false;
        const last = Number(local.getItem(FEATURED_LAST_KEY) ?? 0);
        return !(last > 0 && now - last < FEATURED_COOLDOWN_MS);
    } catch {
        return true;
    }
}

export function rememberPresented(
    now: number,
    session: Pick<Storage, 'setItem'> = sessionStorage,
    local: Pick<Storage, 'setItem'> = localStorage,
): void {
    try {
        session.setItem(FEATURED_SESSION_KEY, '1');
        local.setItem(FEATURED_LAST_KEY, String(now));
    } catch {
        /* sin storage (modo privado): el servidor igual la marca presentada */
    }
}
