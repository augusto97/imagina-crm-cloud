import {
    flowBranchWord,
    flowChildLists,
    ASSIGN_MODES,
    automationExtraActionIssues,
    automationExtraTriggerIssues,
    COPY_RECORD_ACTION,
    FILE_ADDED_TRIGGER,
    FILE_KINDS,
    NOTIFY_IN_APP_ACTION,
    ASSIGN_ROUND_ROBIN_ACTION,
    RECORD_MATCHES_TRIGGER,
    type Field,
} from '@imagina-base/shared';
import { z } from 'zod';
import { rulesTree } from './automation-flow-ai';
import { AiToolError } from './registry';
import { filterRuleSpec } from './structure-tools';

/**
 * v0.1.455 — Los disparadores y acciones nuevos en el vocabulario del modelo
 * (asistente ✨ y MCP): todo por SLUG o por nombre; aquí se valida contra la
 * empresa real y se traduce a lo que guarda el editor (ids). Lo que no cierra
 * vuelve como error CORREGIBLE.
 */

const PERSON_TYPES = ['user', 'created_by', 'updated_by'];

/** El disparador: `match_filters` por slug → `match_filter`; `file_field` → `file_field_id`. */
export function translateExtraTrigger(triggerType: string, cfg: Record<string, unknown>, fields: Field[], listName: string): void {
    if (triggerType === RECORD_MATCHES_TRIGGER) {
        if (cfg.match_filters !== undefined) {
            const rules = z.array(filterRuleSpec).max(20).safeParse(cfg.match_filters);
            if (!rules.success) throw new AiToolError('record_matches: match_filters está mal armado ([{field, op, value}]).');
            if (rules.data.length > 0) cfg.match_filter = rulesTree(rules.data, fields, `«${listName}»`);
            delete cfg.match_filters;
        }
        if (cfg.match_on_create !== undefined) cfg.match_on_create = cfg.match_on_create !== false;
    } else {
        delete cfg.match_filters;
    }
    if (triggerType === FILE_ADDED_TRIGGER) {
        if (typeof cfg.file_field === 'string' && cfg.file_field.trim() !== '') {
            const f = fields.find((x) => x.slug === cfg.file_field);
            if (!f) throw new AiToolError(`file_added: el campo «${String(cfg.file_field)}» no existe en «${listName}».`);
            if (f.type !== 'file') throw new AiToolError(`file_added: «${f.label}» no es un campo de archivos.`);
            cfg.file_field_id = f.id;
        }
        delete cfg.file_field;
        if (cfg.file_kind !== undefined && !(FILE_KINDS as readonly string[]).includes(String(cfg.file_kind))) {
            throw new AiToolError(`file_added: file_kind es ${FILE_KINDS.join(' | ')}.`);
        }
    } else {
        delete cfg.file_field;
    }
    const issues = automationExtraTriggerIssues(triggerType, cfg);
    if (issues.length > 0) throw new AiToolError(issues.map((i) => i.message).join(' · '));
}

export interface ExtraTranslateCtx {
    listId: number;
    listName: string;
    fields: Field[];
    lists: Array<{ id: number; slug: string; name: string }>;
    fieldsOf: (listId: number) => Promise<Field[]>;
    teams: Array<{ id: number; name: string }>;
}

function idList(raw: unknown): number[] {
    const arr = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw];
    const out: number[] = [];
    for (const v of arr) {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}

/** Un equipo por id o por nombre (sin mayúsculas). */
function teamId(ctx: ExtraTranslateCtx, raw: unknown, where: string): number {
    const n = Number(raw);
    const byId = Number.isInteger(n) && n > 0 ? ctx.teams.find((t) => t.id === n) : undefined;
    const byName = typeof raw === 'string' ? ctx.teams.find((t) => t.name.trim().toLowerCase() === raw.trim().toLowerCase()) : undefined;
    const t = byId ?? byName;
    if (!t) throw new AiToolError(`${where}: el equipo «${String(raw)}» no existe. Equipos: ${ctx.teams.map((x) => `${x.id} «${x.name}»`).join(', ') || 'ninguno'}.`);
    return t.id;
}

/** Recorre las acciones (ramas y bucles) y traduce las tres nuevas, IN PLACE. */
export async function translateExtraActions(actions: unknown[], ctx: ExtraTranslateCtx, path = ''): Promise<void> {
    const bySlug = new Map(ctx.fields.map((f) => [f.slug, f]));
    for (const [i, raw] of actions.entries()) {
        if (!raw || typeof raw !== 'object') continue;
        const act = raw as { type?: unknown; config?: Record<string, unknown> };
        const cfg = (act.config ??= {});
        const where = `Acción ${path}${i + 1}`;
        // Las ramas (si/sino, bucle, «Según el valor de…» y «Si falla»).
        for (const kid of flowChildLists(act)) await translateExtraActions(kid.actions, ctx, `${path}${i + 1}.${flowBranchWord(kid.branch)}.`);
        if (act.type === 'if_else' || act.type === 'for_each_linked' || act.type === 'switch') continue;
        if (act.type === NOTIFY_IN_APP_ACTION) {
            if (cfg.person_fields !== undefined) {
                const ids: number[] = [];
                for (const s of Array.isArray(cfg.person_fields) ? cfg.person_fields : [cfg.person_fields]) {
                    const f = bySlug.get(String(s));
                    if (!f) throw new AiToolError(`${where} (notify_in_app): el campo «${String(s)}» no existe en «${ctx.listName}».`);
                    if (!PERSON_TYPES.includes(f.type)) throw new AiToolError(`${where} (notify_in_app): «${f.label}» no es un campo Persona.`);
                    ids.push(f.id);
                }
                cfg.person_field_ids = ids;
                delete cfg.person_fields;
            }
            if (cfg.users !== undefined) {
                cfg.notify_user_ids = idList(cfg.users);
                delete cfg.users;
            }
            if (cfg.teams !== undefined) {
                cfg.notify_team_ids = (Array.isArray(cfg.teams) ? cfg.teams : [cfg.teams]).map((t) => teamId(ctx, t, `${where} (notify_in_app)`));
                delete cfg.teams;
            }
        }
        if (act.type === ASSIGN_ROUND_ROBIN_ACTION) {
            if (cfg.person_field !== undefined) {
                const f = bySlug.get(String(cfg.person_field));
                if (!f) throw new AiToolError(`${where} (assign_round_robin): el campo «${String(cfg.person_field)}» no existe en «${ctx.listName}».`);
                if (f.type !== 'user') throw new AiToolError(`${where} (assign_round_robin): «${f.label}» no es un campo Persona.`);
                cfg.person_field_id = f.id;
                delete cfg.person_field;
            }
            if (cfg.assignees !== undefined) {
                cfg.assignee_user_ids = idList(cfg.assignees);
                delete cfg.assignees;
            }
            if (cfg.team !== undefined) {
                cfg.team_id = teamId(ctx, cfg.team, `${where} (assign_round_robin)`);
                delete cfg.team;
            }
            if (cfg.assign_mode !== undefined && !(ASSIGN_MODES as readonly string[]).includes(String(cfg.assign_mode))) {
                throw new AiToolError(`${where} (assign_round_robin): assign_mode es ${ASSIGN_MODES.join(' | ')}.`);
            }
        }
        if (act.type === COPY_RECORD_ACTION) {
            const rawList = cfg.list ?? cfg.target_list ?? cfg.target_list_id;
            let target: { id: number; slug: string; name: string } | undefined;
            if (typeof rawList === 'string' && rawList.trim() !== '' && !/^\d+$/.test(rawList)) target = ctx.lists.find((l) => l.slug === rawList.trim());
            else if (rawList !== undefined && rawList !== null && rawList !== '') target = ctx.lists.find((l) => l.id === Number(rawList));
            if (!target) {
                throw new AiToolError(`${where} (copy_record): la lista destino «${String(rawList ?? '')}» no existe. Listas: ${ctx.lists.map((l) => l.slug).join(', ')}.`);
            }
            cfg.target_list_id = target.id;
            delete cfg.list;
            delete cfg.target_list;
            const targetFields = target.id === ctx.listId ? ctx.fields : await ctx.fieldsOf(target.id);
            const tBySlug = new Map(targetFields.map((f) => [f.slug, f]));
            const values = cfg.values && typeof cfg.values === 'object' && !Array.isArray(cfg.values) ? (cfg.values as Record<string, unknown>) : {};
            const unknownKeys = Object.keys(values).filter((k) => !tBySlug.has(k) && !/^f\d+$/.test(k));
            if (unknownKeys.length > 0) {
                throw new AiToolError(
                    `${where} (copy_record): «${target.name}» no tiene los campos ${unknownKeys.join(', ')}. Campos: ${targetFields.map((f) => f.slug).join(', ')}.`,
                );
            }
            if (cfg.link_field !== undefined) {
                const s = String(cfg.link_field);
                const targetOf = (f: Field): number => Number((f.config as { target_list_id?: unknown } | null)?.target_list_id ?? 0);
                const tf = tBySlug.get(s);
                const sf = bySlug.get(s);
                if (tf && tf.type === 'relation' && targetOf(tf) === ctx.listId) cfg.link_field_id = tf.id;
                else if (sf && sf.type === 'relation' && targetOf(sf) === target.id) cfg.link_field_id = sf.id;
                else {
                    throw new AiToolError(
                        `${where} (copy_record): «${s}» no es una relación entre «${ctx.listName}» y «${target.name}» (una relación de «${target.name}» que apunta a «${ctx.listName}», o al revés).`,
                    );
                }
                delete cfg.link_field;
            }
        }
        if (typeof act.type === 'string') {
            const issues = automationExtraActionIssues(act.type, cfg, where);
            if (issues.length > 0) throw new AiToolError(issues.map((x) => `${where}: ${x.message}`).join(' · '));
        }
    }
}
