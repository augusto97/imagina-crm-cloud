import type { QueryClient } from '@tanstack/react-query';

/**
 * Lo que una propuesta del asistente o una sugerencia aplicada NO puede
 * cambiar: la cuenta y la sesión de la persona, la consola de la plataforma,
 * la configuración de correo, dominio, IA e integraciones de la empresa, las
 * novedades, y los catálogos que se piden una vez (nombres de personas,
 * archivos ya resueltos, tipos de campo, festivos).
 *
 * Todo lo demás —listas, campos, vistas, registros, tableros,
 * automatizaciones, formularios, portal, permisos, plantillas…— SÍ puede
 * cambiar, y como una propuesta toca varias cosas a la vez se refresca entero.
 * Es una lista de exclusión a propósito: una query nueva que nadie anotó aquí
 * se refresca (lo seguro), no se queda vieja.
 */
const UNAFFECTED_NAMESPACES: ReadonlySet<string> = new Set([
    // La persona y su sesión.
    'me', 'two-factor', 'account-sessions', 'personal-tokens', 'deletion-blockers',
    // Catálogos y resoluciones por id (no cambian por aplicar una propuesta).
    'wp-user', 'wp-users-search', 'users-search', 'member-names', 'imcrm', 'field-types', 'booking-holidays',
    // El propio asistente.
    'ai-status', 'ai-settings', 'ai-models', 'ai-conversations',
    // Novedades y ayuda.
    'whats-new',
    // Consola de la plataforma.
    'platform', 'platform-ai', 'platform-ai-models', 'platform-disk', 'platform-payments', 'platform-payments-recent',
    'platform-integrations', 'platform-diagnostics', 'update-status', 'backups-status', 'backups-drive-files',
    'tenant-transfers',
    // Ajustes de la empresa que el asistente no toca.
    'tenant-smtp', 'tenant-smtp-dns', 'tenant-mail', 'smtp-config', 'tenant-domain', 'tenant-domain-dns',
    'payments-config', 'integrations-overview', 'connector-settings', 'google-workspace-help',
    'oauth-request', 'oauth-discovery-check',
]);

export function isWorkspaceDataKey(queryKey: readonly unknown[]): boolean {
    const ns = queryKey[0];
    return !(typeof ns === 'string' && UNAFFECTED_NAMESPACES.has(ns));
}

/**
 * Refresca los datos del espacio de trabajo tras aplicar algo que pudo tocar
 * varias cosas (una propuesta del asistente, una sugerencia). Antes era un
 * `invalidateQueries()` sin filtro: volvía a pedir TODA query montada —la
 * sesión, cada persona y cada archivo de la tabla, la consola, los ajustes—.
 */
export function invalidateWorkspaceData(qc: QueryClient): Promise<void> {
    return qc.invalidateQueries({ predicate: (q) => isWorkspaceDataKey(q.queryKey) });
}
