/**
 * v0.1.347 — Las acciones del shell (abrir la búsqueda o el escáner) que se
 * disparan desde lugares que no las tienen a mano: la barra de abajo
 * personalizable y la página «Más». El estado de esos diálogos vive en
 * `AdminShell`, que las registra al montarse.
 */
type Handlers = { search?: () => void; scan?: () => void };

let handlers: Handlers = {};

export function registerShellActions(next: Handlers): () => void {
    handlers = next;
    return () => {
        if (handlers === next) handlers = {};
    };
}

export const shellActions = {
    openSearch(): void {
        handlers.search?.();
    },
    openScan(): void {
        handlers.scan?.();
    },
};
