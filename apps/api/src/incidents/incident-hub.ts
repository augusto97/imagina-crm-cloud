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
    // Postgres habla en inglés («invalid input syntax for type date»): lo que
    // llega a la campana y al historial se explica en español.
    const pg = pgErrorText(err);
    if (pg) return pg.length > max ? `${pg.slice(0, max - 1)}…` : pg;
    const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
    const s = (raw ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s || 'Error desconocido';
}

/**
 * Explicación en español de los errores de Postgres más comunes (por su
 * código SQLSTATE), con el valor problemático cuando el mensaje lo trae.
 * null si el error no es de la base o el código no está en la lista.
 */
export function pgErrorText(err: unknown): string | null {
    if (!err || typeof err !== 'object') return null;
    const code = (err as { code?: unknown }).code;
    if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return null;
    const message = err instanceof Error ? err.message : '';
    const quoted = /"([^"]{1,120})"/.exec(message)?.[1];
    const value = quoted ? ` (valor: «${quoted}»)` : '';
    switch (code) {
        case '22007':
        case '22008':
            return `Hay una fecha guardada que no es válida${value}. Corrígela en el registro o en la acción que la escribe.`;
        case '22P02':
            return `Hay un valor guardado que no tiene el formato esperado${value}, por ejemplo texto donde va un número.`;
        case '22003':
            return 'Un número es demasiado grande para guardarse.';
        case '22001':
            return 'Un texto es demasiado largo para guardarse.';
        case '23505':
            return 'Ya existe un registro con ese valor y debe ser único.';
        case '23503':
            return 'Lo que se quería vincular o usar ya no existe (se borró).';
        case '23502':
            return 'Falta un dato obligatorio.';
        case '40P01':
        case '40001':
            return 'Otra operación estaba cambiando los mismos datos al mismo tiempo. Se intentará de nuevo en la próxima ejecución.';
        case '57014':
            return 'La consulta tardó demasiado y se canceló.';
        case '53300':
            return 'La base de datos está saturada en este momento.';
        default:
            if (code.startsWith('08')) return 'Se perdió la conexión con la base de datos.';
            return null;
    }
}
