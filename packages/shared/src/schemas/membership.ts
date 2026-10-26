import { z } from 'zod';
import { idSchema } from './common';

/**
 * Los 5 roles del plugin (STANDALONE.md §5), sin el prefijo `crm_`, más
 * C3 — `guest`: un colaborador EXTERNO (proveedor, contador) que sólo ve lo
 * que se le compartió (listas puntuales o registros sueltos). No ocupa
 * usuario del plan; tiene su propio tope (`max_guests`).
 */
export const ROLES = ['admin', 'manager', 'agent', 'viewer', 'client', 'guest'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * Capabilities del plugin (CONTRACT.md §6), sin el prefijo `imcrm_`.
 * El backend SIEMPRE valida; el frontend solo oculta botones (`useCan`).
 */
export const CAPABILITIES = [
    'access_admin',
    'manage_lists',
    'manage_fields',
    'manage_views',
    'manage_automations',
    'manage_dashboards',
    'view_records',
    'view_own_records',
    'create_records',
    'edit_records',
    'edit_own_records',
    'delete_records',
    'delete_own_records',
    'import_records',
    'export_records',
    'bulk_actions',
    'access_portal',
    // C1 — crear, editar y borrar equipos y sus personas (sólo admin de base).
    'manage_teams',
    // C2 — capacidades por módulo (roles propios). Los roles base conservan
    // EXACTAMENTE lo que tenían: ver tableros y usar el asistente los tenía
    // todo el equipo; formularios y plantillas de documentos, sólo el admin
    // (iban por `manage_lists`).
    'view_dashboards',
    'use_ai_assistant',
    'manage_forms',
    'manage_documents',
] as const;
export const capabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

/**
 * Matriz rol → capabilities, portada 1:1 de
 * `reference/plugin-backend/Permissions/CapabilityRegistry.php`:
 *  - admin: todas.
 *  - manager: gestiona records y vistas, no toca schema ni automatizaciones.
 *  - agent: usuario operativo, solo sus propios records.
 *  - viewer: lectura total, sin mutaciones.
 *  - client: solo portal.
 */
export const CAPABILITIES_BY_ROLE: Record<Role, readonly Capability[]> = {
    admin: [...CAPABILITIES],
    manager: [
        'access_admin',
        'manage_views',
        'manage_dashboards',
        'view_records',
        'create_records',
        'edit_records',
        'delete_records',
        'import_records',
        'export_records',
        'bulk_actions',
        'view_dashboards',
        'use_ai_assistant',
    ],
    agent: [
        'access_admin',
        'view_own_records',
        'create_records',
        'edit_own_records',
        'delete_own_records',
        'export_records',
        'view_dashboards',
        'use_ai_assistant',
    ],
    viewer: ['access_admin', 'view_records', 'export_records', 'view_dashboards', 'use_ai_assistant'],
    client: ['access_portal'],
    // C3 — el invitado: lo justo para leer/editar los registros que el ACL
    // le deja (lista compartida con él o registros sueltos). Qué endpoints
    // puede usar lo decide `@AllowGuest()` (todo lo demás le da 403).
    guest: ['access_admin', 'view_own_records', 'create_records', 'edit_own_records'],
};

export function roleHasCapability(role: Role, capability: Capability): boolean {
    return CAPABILITIES_BY_ROLE[role].includes(capability);
}

/**
 * C2 — Capacidades que un rol PROPIO puede prender o apagar. `access_admin`
 * (entrar a la app) y `access_portal` (portal del cliente) no se eligen: el
 * primero va siempre, el segundo nunca.
 */
export const TOGGLEABLE_CAPABILITIES: readonly Capability[] = CAPABILITIES.filter(
    (c) => c !== 'access_admin' && c !== 'access_portal',
);

/** Roles base sobre los que se arma un rol propio (`admin` queda fijo). */
export const CUSTOM_ROLE_BASES = ['manager', 'agent', 'viewer'] as const;
export type CustomRoleBase = (typeof CUSTOM_ROLE_BASES)[number];

/**
 * C2 — Capacidades EFECTIVAS de una persona: las de su rol propio si lo tiene
 * (siempre con `access_admin`, sólo las elegibles), o las de su rol base.
 * `admin`, `client` y `guest` no admiten rol propio.
 */
export function effectiveCapabilities(role: Role, custom?: readonly string[] | null): Capability[] {
    if (custom && (CUSTOM_ROLE_BASES as readonly string[]).includes(role)) {
        const allowed = new Set<string>(TOGGLEABLE_CAPABILITIES);
        const picked = CAPABILITIES.filter((c) => allowed.has(c) && custom.includes(c));
        return ['access_admin', ...picked];
    }
    return [...CAPABILITIES_BY_ROLE[role]];
}

/** Mapa `{cap => bool}` para gatear UI sin N requests (payload de /me y bootstrap). */
export function capabilitiesMap(role: Role, custom?: readonly string[] | null): Record<Capability, boolean> {
    const have = new Set(effectiveCapabilities(role, custom));
    const out = {} as Record<Capability, boolean>;
    for (const cap of CAPABILITIES) {
        out[cap] = have.has(cap);
    }
    return out;
}

/**
 * C2 — Catálogo para la pantalla de Roles: las capacidades elegibles
 * agrupadas por módulo, cada una con lo que permite en palabras simples.
 */
export const CAPABILITY_GROUPS: ReadonlyArray<{
    module: string;
    items: ReadonlyArray<{ capability: Capability; label: string; help: string }>;
}> = [
    {
        module: 'Registros',
        items: [
            { capability: 'view_records', label: 'Ver todos los registros', help: 'Ve todos los registros de las listas (según los permisos de cada lista).' },
            { capability: 'view_own_records', label: 'Ver sus registros', help: 'Ve los registros que creó o tiene asignados.' },
            { capability: 'create_records', label: 'Crear registros', help: 'Da de alta registros nuevos.' },
            { capability: 'edit_records', label: 'Editar cualquier registro', help: 'Cambia los datos de cualquier registro que ve.' },
            { capability: 'edit_own_records', label: 'Editar sus registros', help: 'Cambia los registros que creó o tiene asignados.' },
            { capability: 'delete_records', label: 'Eliminar cualquier registro', help: 'Manda a la papelera cualquier registro que ve.' },
            { capability: 'delete_own_records', label: 'Eliminar sus registros', help: 'Manda a la papelera los registros que creó.' },
            { capability: 'bulk_actions', label: 'Acciones en lote', help: 'Edita, mueve o borra muchos registros a la vez y deshace ediciones masivas.' },
        ],
    },
    {
        module: 'Importar y exportar',
        items: [
            { capability: 'import_records', label: 'Importar', help: 'Sube registros desde un CSV o Excel.' },
            { capability: 'export_records', label: 'Exportar', help: 'Descarga los registros que ve en CSV o Excel.' },
        ],
    },
    {
        module: 'Listas, campos y vistas',
        items: [
            { capability: 'manage_lists', label: 'Gestionar listas', help: 'Crea, configura y elimina listas, y decide quién accede a cada una.' },
            { capability: 'manage_fields', label: 'Gestionar campos', help: 'Agrega, cambia y elimina columnas.' },
            { capability: 'manage_views', label: 'Gestionar vistas', help: 'Crea y cambia las vistas guardadas para todo el equipo.' },
        ],
    },
    {
        module: 'Tableros',
        items: [
            { capability: 'view_dashboards', label: 'Ver tableros', help: 'Abre los tableros que se comparten con su rol.' },
            { capability: 'manage_dashboards', label: 'Crear y editar tableros', help: 'Arma tableros, los publica y programa envíos por correo.' },
        ],
    },
    {
        module: 'Automatizaciones',
        items: [{ capability: 'manage_automations', label: 'Gestionar automatizaciones', help: 'Crea, cambia y pausa automatizaciones.' }],
    },
    {
        module: 'Formularios y documentos',
        items: [
            { capability: 'manage_forms', label: 'Gestionar formularios', help: 'Arma y publica formularios públicos que crean registros.' },
            { capability: 'manage_documents', label: 'Gestionar plantillas de documentos', help: 'Diseña las plantillas de PDF (cotizaciones, cuentas de cobro).' },
        ],
    },
    {
        module: 'Equipo',
        items: [{ capability: 'manage_teams', label: 'Gestionar equipos', help: 'Crea equipos y decide quién está en cada uno.' }],
    },
    {
        module: 'Asistente IA',
        items: [{ capability: 'use_ai_assistant', label: 'Usar el asistente IA', help: 'Conversa con el asistente y conecta Claude u otros clientes por MCP.' }],
    },
];

export const membershipSchema = z.object({
    user_id: idSchema,
    tenant_id: idSchema,
    role: roleSchema,
});
export type Membership = z.infer<typeof membershipSchema>;
