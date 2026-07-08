import { z } from 'zod';

/**
 * Reglas exactas de slugs heredadas del plugin (CONTRACT.md §2):
 * snake_case, arranca con letra, máx 63 chars.
 */
export const SLUG_REGEX = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Slug de tenant/workspace: se usa como subdominio (`acme.imaginacrm.com`),
 * por eso permite guiones (DNS-safe) en vez de guiones bajos.
 */
export const TENANT_SLUG_REGEX = /^[a-z][a-z0-9-]{0,62}$/;

/** Reservados de lista (CONTRACT.md §2). */
export const RESERVED_LIST_SLUGS: readonly string[] = [
    'lists',
    'fields',
    'views',
    'records',
    'comments',
    'activity',
    'relations',
    'automations',
    'settings',
    'me',
    'admin',
    'system',
    'api',
    'auth',
    'licensing',
    'slug-history',
    'slug_history',
    'field-types',
    'field_types',
    'import',
    'export',
    'webhook',
    'webhooks',
];

/**
 * Palabras reservadas de PostgreSQL 16 (categoría "reserved" del apéndice C)
 * que además matchean el formato de slug. Adaptación del
 * `SlugManager::MYSQL_RESERVED` del plugin (CONTRACT.md §2).
 */
export const POSTGRES_RESERVED_WORDS: readonly string[] = [
    'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc',
    'asymmetric', 'both', 'case', 'cast', 'check', 'collate', 'column',
    'constraint', 'create', 'current_catalog', 'current_date', 'current_role',
    'current_time', 'current_timestamp', 'current_user', 'default',
    'deferrable', 'desc', 'distinct', 'do', 'else', 'end', 'except', 'false',
    'fetch', 'for', 'foreign', 'from', 'grant', 'group', 'having', 'in',
    'initially', 'intersect', 'into', 'lateral', 'leading', 'limit',
    'localtime', 'localtimestamp', 'not', 'null', 'offset', 'on', 'only',
    'or', 'order', 'placing', 'primary', 'references', 'returning', 'select',
    'session_user', 'some', 'symmetric', 'table', 'then', 'to', 'trailing',
    'true', 'union', 'unique', 'user', 'using', 'variadic', 'when', 'where',
    'window', 'with',
];

/** Reservados de campo: columnas del sistema + reservadas SQL (CONTRACT.md §2). */
export const RESERVED_FIELD_SLUGS: readonly string[] = [
    'id',
    'created_at',
    'updated_at',
    'deleted_at',
    'created_by',
    ...POSTGRES_RESERVED_WORDS,
];

export const slugSchema = z
    .string()
    .regex(SLUG_REGEX, 'Slug inválido: snake_case, empieza con letra, máx 63 caracteres');

export const listSlugSchema = slugSchema.refine(
    (s) => !RESERVED_LIST_SLUGS.includes(s),
    { message: 'Slug reservado por el sistema' },
);

export const fieldSlugSchema = slugSchema.refine(
    (s) => !RESERVED_FIELD_SLUGS.includes(s),
    { message: 'Slug reservado por el sistema' },
);

export const tenantSlugSchema = z
    .string()
    .regex(TENANT_SLUG_REGEX, 'Slug inválido: minúsculas y guiones, empieza con letra, máx 63 caracteres');

/**
 * Generación automática de slug desde un label (CONTRACT.md §2):
 * slugify snake_case; la resolución de colisiones (`_2`, `_3`, …) la hace
 * quien conoce el universo de slugs existentes (backend).
 */
export function slugify(label: string): string {
    const base = label
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') // sin acentos
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_{2,}/g, '_')
        .slice(0, 63);
    // Debe arrancar con letra.
    const safe = /^[a-z]/.test(base) ? base : `f_${base}`.slice(0, 63);
    return safe.replace(/_+$/g, '') || 'campo';
}

/** Variante DNS-safe para slugs de tenant (subdominios). */
export function slugifyTenant(name: string): string {
    const base = name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 63);
    const safe = /^[a-z]/.test(base) ? base : `w-${base}`.slice(0, 63);
    return safe.replace(/-+$/g, '') || 'workspace';
}
