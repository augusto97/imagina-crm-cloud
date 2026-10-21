import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { IncidentSource } from '@imagina-base/shared';

/**
 * v0.1.285 (ADR-S44) — "Algo que corre solo dejó de funcionar" / "volvió a
 * funcionar". Mismo patrón que `NotifyHub` y `RecordChangeHub`: los módulos
 * que fallan (automatizaciones, correo, conectores, sincronizaciones…) avisan
 * acá sin depender del módulo de problemas, que depende de avisos y correo —
 * importarlo desde el correo armaría un ciclo.
 *
 * Fire-and-forget: reportar una falla JAMÁS rompe lo que la reporta.
 */
export interface IncidentReport {
    tenantId: number;
    /**
     * Lo que falla, estable: las fallas con la misma key se juntan en un solo
     * problema abierto (`automation:12`, `mail`, `connection:4`…).
     */
    key: string;
    source: IncidentSource;
    sourceId?: number | null;
    listId?: number | null;
    /** Quién creó lo que falla: también recibe el aviso (además de los admins). */
    ownerId?: number | null;
    /** «Falló la automatización «Enviar factura»». */
    title: string;
    /** El error, en lenguaje claro. */
    message: string;
}

type Listener = {
    report: (r: IncidentReport) => void | Promise<void>;
    resolve: (tenantId: number, key: string) => void | Promise<void>;
    resolvePrefix: (tenantId: number, prefix: string) => void | Promise<void>;
};

@Injectable()
export class IncidentHub {
    private readonly logger = new Logger(IncidentHub.name);
    private readonly listeners: Listener[] = [];

    subscribe(listener: Listener): void {
        this.listeners.push(listener);
    }

    report(r: IncidentReport): void {
        this.each('report', (l) => l.report(r));
    }

    /** Volvió a funcionar: cierra el problema abierto con esa key (si hay). */
    resolve(tenantId: number, key: string): void {
        this.each('resolve', (l) => l.resolve(tenantId, key));
    }

    /** Lo que fallaba ya no existe (se borró): cierra todos sus problemas. */
    resolvePrefix(tenantId: number, prefix: string): void {
        this.each('resolvePrefix', (l) => l.resolvePrefix(tenantId, prefix));
    }

    private each(what: string, fn: (l: Listener) => void | Promise<void>): void {
        for (const l of this.listeners) {
            try {
                void Promise.resolve(fn(l)).catch((err) => this.logger.error(`Problema (${what}): ${String(err)}`));
            } catch (err) {
                this.logger.error(`Problema (${what}): ${String(err)}`);
            }
        }
    }
}

@Global()
@Module({ providers: [IncidentHub], exports: [IncidentHub] })
export class IncidentHubModule {}

/** Mensaje legible de un error cualquiera (recortado: va a una campana y un correo). */
export function errorText(err: unknown, max = 600): string {
    // Un error de la base llega envuelto («Failed query: insert … params: …»):
    // lo útil (y lo que no expone datos) es el motivo de Postgres.
    const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
    if (err instanceof Error && err.message.startsWith('Failed query:') && cause instanceof Error) {
        return errorText(cause, max);
    }
    const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
    const s = (raw ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s || 'Error desconocido';
}
