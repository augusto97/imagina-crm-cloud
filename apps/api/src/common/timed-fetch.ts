/**
 * v0.1.393 — `fetch` con tope de tiempo. Sin él, un proveedor que acepta la
 * conexión y nunca contesta (Mercado Pago o PayPal caídos a medias) dejaba
 * colgado al que llamaba —la revisión de cobros, el aviso de un pago— hasta
 * que el sistema operativo cortaba la conexión, minutos después.
 */
export const PROVIDER_FETCH_TIMEOUT_MS = 20_000;

export const timedFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS) });
