/**
 * v0.1.241 — la CUENTA del portal que se está mirando (id del acceso). Una
 * persona puede tener acceso a varios registros de la misma empresa; el portal
 * manda la elegida en `X-Portal-Account` y el servidor la valida contra SUS
 * accesos. Sin elección, el servidor muestra la del enlace con el que entró.
 *
 * Estado de módulo (no React): lo leen el cliente tipado y los bloques que
 * hacen `fetch` crudo, fuera del árbol de componentes.
 */
let current: number | null = null;

export function setPortalAccount(id: number | null): void {
    current = id !== null && Number.isInteger(id) && id > 0 ? id : null;
}

export function getPortalAccount(): number | null {
    return current;
}

export function portalAccountHeaders(): Record<string, string> {
    return current !== null ? { 'X-Portal-Account': String(current) } : {};
}
