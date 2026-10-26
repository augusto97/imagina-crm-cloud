import { z } from 'zod';
import { idSchema } from './common';

/**
 * v0.1.285 (ADR-S44) — Problemas de la empresa.
 *
 * Un PROBLEMA es algo que corre solo y dejó de funcionar: una automatización
 * que falla, el correo de la empresa que no sale, un conector cuya
 * autorización venció, una sincronización que se cortó. Las fallas repetidas
 * de lo MISMO (misma `key`) se juntan en un solo problema abierto —con cuántas
 * veces pasó y el último error— y se cierra solo cuando eso vuelve a
 * funcionar. Al abrirse se avisa (campana + correo) a los admins y a quien
 * creó lo que falla; si sigue fallando, se recuerda una vez por día.
 */

export const INCIDENT_SOURCES = [
    'automation',
    'mail',
    'connection',
    'sql_sync',
    'store_sync',
    'ai_field',
    'form',
    'recurrence',
    'collections',
    // v0.1.292 (ADR-S50) — el envío programado de un tablero.
    'dashboard',
    // D5 — una página de agenda (calendario externo, correo de la cita, reserva perdida).
    'booking',
    // D2 — el buzón de la mesa de ayuda (no se puede leer o hay correos pendientes).
    'helpdesk',
    // E6 — un agente de IA que no pudo trabajar (sin IA, dueño sin acceso, topes).
    'ai_agent',
] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export const INCIDENT_SOURCE_LABELS: Record<IncidentSource, string> = {
    automation: 'Automatización',
    mail: 'Correo',
    connection: 'Conector',
    sql_sync: 'Sincronización SQL',
    store_sync: 'Tienda',
    ai_field: 'Campo con IA',
    form: 'Formulario',
    recurrence: 'Recurrencia',
    collections: 'Cobros',
    dashboard: 'Tablero',
    booking: 'Agenda',
    helpdesk: 'Mesa de ayuda',
    ai_agent: 'Agente de IA',
};

export interface IncidentDto {
    id: number;
    source: IncidentSource;
    /**
     * Id de lo que falla, para el enlace: automatización, conexión (también en
     * sql_sync, store_sync y cobros: la página es por conexión), campo o formulario.
     */
    source_id: number | null;
    list_id: number | null;
    list_slug: string | null;
    list_name: string | null;
    title: string;
    /** El último error, en lenguaje claro. */
    message: string;
    /** Cuántas veces falló desde que se abrió. */
    count: number;
    first_at: string;
    last_at: string;
    resolved_at: string | null;
    /** Quién lo marcó como resuelto (null = se resolvió solo al volver a funcionar). */
    resolved_by_name: string | null;
}

export interface IncidentsPage {
    items: IncidentDto[];
    open: number;
}

export const listIncidentsQuerySchema = z.object({
    status: z.enum(['open', 'resolved', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

export const resolveIncidentSchema = z.object({ id: idSchema });

/**
 * A dónde ir a arreglarlo (ruta del hash router de la app). Pura: la usan la
 * página de Problemas y la campana.
 */
export function incidentLink(i: Pick<IncidentDto, 'source' | 'source_id' | 'list_slug'>): string {
    const list = i.list_slug ? `/lists/${encodeURIComponent(i.list_slug)}` : null;
    switch (i.source) {
        case 'automation':
            if (list && i.source_id) return `${list}/automations/${i.source_id}`;
            return list ? `${list}/automations` : '/lists';
        case 'mail':
            return '/settings?s=correo';
        case 'connection':
        case 'collections':
            return '/settings?s=conectores';
        case 'sql_sync':
            return i.source_id ? `/settings/sql/${i.source_id}` : '/settings?s=conectores';
        case 'store_sync':
            return i.source_id ? `/settings/stores/${i.source_id}` : '/settings?s=conectores';
        case 'ai_field':
            return list ? `${list}/edit?s=campos${i.source_id ? `&field=${i.source_id}` : ''}` : '/lists';
        case 'form':
            return list ? `${list}/edit?s=formularios` : '/lists';
        case 'booking':
            return list ? `${list}/edit?s=agenda` : '/lists';
        case 'recurrence':
            return list ? `${list}/records` : '/lists';
        case 'dashboard':
            return i.source_id ? `/dashboards/${i.source_id}?share=email` : '/dashboards';
        case 'helpdesk':
            return list ? `${list}/edit?s=correo` : '/lists';
        case 'ai_agent':
            return i.source_id ? `/agents/${i.source_id}` : '/agents';
        default:
            return '/settings?s=problemas';
    }
}
