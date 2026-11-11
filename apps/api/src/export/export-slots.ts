/**
 * Tope de exportaciones a la vez por empresa EN ESTE SERVIDOR. Una exportación
 * recorre la lista entera y arma el archivo en este proceso (el mismo que
 * atiende los pedidos de todas las empresas): lo que se protege es su memoria
 * y su tiempo, que son de cada servidor — por eso el tope vive en memoria y no
 * en Redis (y no puede quedar tomado si el proceso se reinicia).
 */
export const MAX_EXPORTS_PER_TENANT = 2;

export class ExportSlots {
    private readonly running = new Map<number, number>();

    constructor(private readonly max = MAX_EXPORTS_PER_TENANT) {}

    /** Toma un lugar; `null` si la empresa ya tiene el máximo. Lo devuelto lo suelta (una sola vez). */
    take(tenantId: number): (() => void) | null {
        const n = this.running.get(tenantId) ?? 0;
        if (n >= this.max) return null;
        this.running.set(tenantId, n + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const left = (this.running.get(tenantId) ?? 1) - 1;
            if (left <= 0) this.running.delete(tenantId);
            else this.running.set(tenantId, left);
        };
    }

    active(tenantId: number): number {
        return this.running.get(tenantId) ?? 0;
    }
}

/** Quien pidió el archivo cerró la conexión: no tiene sentido seguir armándolo. */
export class ExportAborted extends Error {
    constructor() {
        super('export_aborted');
        this.name = 'ExportAborted';
    }
}
