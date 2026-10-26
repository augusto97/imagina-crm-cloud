import { z } from 'zod';
import { idSchema } from './common';

/**
 * C1 — Equipos («Ventas», «Soporte»): grupos de personas del EQUIPO de
 * trabajo de una empresa (nunca clientes del portal ni invitados). Sirven
 * para asignar un registro a un equipo (campo «Equipo»), dar acceso a una
 * lista a un equipo, mencionar a @equipo y ver «De mis equipos» en «Mi
 * trabajo». Tablas `teams` + `team_members` (RLS).
 */

/** Tope de equipos por empresa y de personas por equipo. */
export const MAX_TEAMS = 200;
export const MAX_TEAM_MEMBERS = 500;

export const teamMemberSchema = z.object({
    user_id: idSchema,
    /** Líder del equipo (sólo se muestra; no da permisos extra). */
    is_lead: z.boolean().default(false),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamSchema = z.object({
    id: idSchema,
    name: z.string().min(1).max(80),
    description: z.string().max(500).nullable(),
    /** Mismo catálogo que las listas: clave del icono y color hex. */
    icon: z.string().max(64).nullable(),
    color: z.string().max(32).nullable(),
    members: z.array(
        teamMemberSchema.extend({
            /** Nombre visible (los emails no viajan en este listado). */
            name: z.string(),
        }),
    ),
    member_count: z.number().int().min(0),
    created_at: z.string(),
    updated_at: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

const teamNameSchema = z.string().trim().min(1, 'El equipo necesita un nombre').max(80);

export const createTeamSchema = z.object({
    name: teamNameSchema,
    description: z.string().trim().max(500).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    members: z.array(teamMemberSchema).max(MAX_TEAM_MEMBERS).optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
    name: teamNameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    /** Lista COMPLETA de personas (reemplaza la guardada). */
    members: z.array(teamMemberSchema).max(MAX_TEAM_MEMBERS).optional(),
});
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

/**
 * Valor especial del filtro de un campo «Equipo»: los equipos de quien mira
 * («es uno de mis equipos»). Lo resuelve el servidor con los equipos de la
 * persona que pide; sin equipos no coincide nada. Se guarda tal cual en las
 * vistas: cada persona ve lo de SUS equipos.
 */
export const MY_TEAMS_TOKEN = '$my_teams';

/**
 * C1 — «Manija» de un equipo para mencionarlo en un comentario (`@ventas-norte`,
 * como los grupos de usuarios de Slack): el nombre en minúsculas, sin acentos,
 * con guiones. Los nombres son únicos por empresa; dos que dan la misma manija
 * no se resuelven (sería adivinar).
 */
export function teamHandle(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

/**
 * Manijas `@equipo` escritas en el texto de un comentario. Los `@email` de
 * las personas NO cuentan (lo que sigue después de la manija no puede ser
 * `@` ni `.algo`).
 */
export function parseTeamHandles(body: string): string[] {
    const out = new Set<string>();
    for (const m of body.matchAll(/(^|[\s(])@([a-z0-9][a-z0-9-]{0,59})(?![\w@.+-]*@)(?![a-z0-9-])/gi)) {
        const h = m[2]!.toLowerCase();
        out.add(h);
    }
    return [...out];
}

/**
 * Normaliza el valor de un campo «Equipo» a una lista de ids únicos (el valor
 * guardado siempre es un array de números, también con un solo equipo).
 */
export function teamIdsOf(value: unknown): number[] {
    const raw = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
    const out: number[] = [];
    for (const v of raw) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
        if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}
