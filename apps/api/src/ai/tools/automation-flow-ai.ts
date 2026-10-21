import { automationConfigIssues, readWaitConfig, type Field } from '@imagina-base/shared';
import { z } from 'zod';
import { optionValue } from './bulk-ops';
import { AiToolError } from './registry';
import { filterRuleSpec, rulesToFilterTree, type FilterRuleSpec } from './structure-tools';

/**
 * v0.1.288 — Las acciones nuevas del flujo en el vocabulario del modelo
 * (asistente ✨ y MCP): «Esperar» (`wait`), «Repetir por cada registro
 * vinculado» (`for_each_linked`) y el horario «para cada registro». El modelo
 * habla por SLUG (de campos y de la lista vinculada); aquí se valida contra
 * la lista real y se traduce a lo que guarda el editor (ids en la relación y
 * en los filtros). Lo que no cierra vuelve como error CORREGIBLE.
 */

/** Un camino de relación de la lista (lo que devuelve `relationPaths`). */
export interface AiRelationPath {
    relation_field_id: number;
    relation_label: string;
    direction: 'forward' | 'reverse';
    other_list_id: number;
    other_list_name: string;
    other_list_slug: string | null;
}

export interface FlowTranslateCtx {
    listName: string;
    fields: Field[];
    paths: AiRelationPath[];
    /** Los campos de otra lista (la del lado vinculado de un bucle). */
    fieldsOf: (listId: number) => Promise<Field[]>;
}

const DATE_TYPES = ['date', 'datetime'];

/** Reglas por slug → filter tree con ids (y opciones por etiqueta → value). */
function rulesTree(rules: FilterRuleSpec[], fields: Field[], where: string) {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    return rulesToFilterTree(
        rules.map((r) => {
            const f = bySlug.get(r.field);
            if (!f) throw new AiToolError(`${where}: el campo del filtro «${r.field}» no existe. Campos: ${fields.map((x) => x.slug).join(', ')}.`);
            return { ...r, value: typeof r.value === 'string' ? optionValue(f, r.value) : r.value };
        }),
        (slug) => bySlug.get(slug)!.id,
    );
}

/** El horario «para cada registro»: `records_filters` por slug → `records_filter`. */
export function translateScheduledEach(triggerType: string, cfg: Record<string, unknown>, fields: Field[], listName: string): void {
    if (triggerType !== 'scheduled' || cfg.for_each_record !== true) {
        delete cfg.records_filters;
        return;
    }
    if (cfg.records_filters !== undefined) {
        const rules = z.array(filterRuleSpec).max(20).safeParse(cfg.records_filters);
        if (!rules.success) throw new AiToolError('El horario «para cada registro»: records_filters está mal armado ([{field, op, value}]).');
        if (rules.data.length > 0) cfg.records_filter = rulesTree(rules.data, fields, `«${listName}»`);
        delete cfg.records_filters;
    }
}

/**
 * Recorre las acciones (ramas de un si/sino y el cuerpo de un bucle) y
 * traduce/valida las de flujo. Mutación IN PLACE, como `translateBulkEditActions`.
 */
export async function translateFlowActions(actions: unknown[], ctx: FlowTranslateCtx, inLoop: { fields: Field[]; listName: string } | null = null): Promise<void> {
    const ownSlugs = new Map(ctx.fields.map((f) => [f.slug, f]));
    for (const raw of actions) {
        if (!raw || typeof raw !== 'object') continue;
        const act = raw as { type?: unknown; config?: Record<string, unknown> };
        const cfg = (act.config ??= {});
        if (act.type === 'if_else') {
            await translateFlowActions(Array.isArray(cfg.then_actions) ? cfg.then_actions : [], ctx, inLoop);
            await translateFlowActions(Array.isArray(cfg.else_actions) ? cfg.else_actions : [], ctx, inLoop);
            continue;
        }
        if (act.type === 'wait') {
            if (inLoop) throw new AiToolError('No se puede esperar dentro de for_each_linked: pon la espera antes o después de la repetición.');
            const w = readWaitConfig(cfg);
            if (w.mode === 'until_field') {
                const f = ownSlugs.get(w.dateField);
                if (!f) throw new AiToolError(`«Esperar»: el campo de fecha «${w.dateField}» no existe en «${ctx.listName}».`);
                if (!DATE_TYPES.includes(f.type)) throw new AiToolError(`«Esperar»: «${f.label}» no es un campo de fecha (date/datetime).`);
            }
            continue;
        }
        if (act.type === 'update_field' && cfg.target === 'item') {
            if (!inLoop) throw new AiToolError('update_field con target «item» sólo va dentro de for_each_linked.');
            const bySlug = new Map(inLoop.fields.map((f) => [f.slug, f]));
            for (const slug of Object.keys((cfg.values as Record<string, unknown>) ?? {})) {
                if (!bySlug.has(slug)) {
                    throw new AiToolError(`update_field (target item): «${slug}» no es un campo de «${inLoop.listName}». Campos: ${inLoop.fields.map((f) => f.slug).join(', ')}.`);
                }
            }
            continue;
        }
        if (act.type !== 'for_each_linked') continue;
        if (inLoop) throw new AiToolError('No se puede repetir dentro de otra repetición (for_each_linked anidado).');
        const path = resolvePath(cfg, ctx);
        cfg.relation_field_id = path.relation_field_id;
        delete cfg.relation;
        delete cfg.via;
        const otherFields = await ctx.fieldsOf(path.other_list_id);
        if (cfg.filters !== undefined) {
            const rules = z.array(filterRuleSpec).max(20).safeParse(cfg.filters);
            if (!rules.success) throw new AiToolError('for_each_linked: filters está mal armado ([{field, op, value}] por slug de la lista vinculada).');
            if (rules.data.length > 0) cfg.filter_tree = rulesTree(rules.data, otherFields, `for_each_linked sobre «${path.other_list_name}»`);
            delete cfg.filters;
        }
        const inner = Array.isArray(cfg.actions) ? cfg.actions : [];
        if (inner.length === 0) throw new AiToolError('for_each_linked necesita actions: lo que se repite por cada vinculado.');
        // Las condiciones dentro del bucle pueden leer el vinculado (`item.slug`).
        await translateFlowActions(inner, ctx, { fields: otherFields, listName: path.other_list_name });
        for (const a of inner) {
            const c = (a as { condition?: unknown }).condition;
            if (!Array.isArray(c)) continue;
            for (const r of c as Array<{ field?: string; slug?: string }>) {
                const f = r.field ?? r.slug ?? '';
                if (f.startsWith('item.') && !otherFields.some((x) => x.slug === f.slice(5))) {
                    throw new AiToolError(`for_each_linked: la condición usa «${f}», que no es un campo de «${path.other_list_name}».`);
                }
            }
        }
    }
}

/** La relación del bucle: por id, por la lista vinculada (slug o nombre) y, si hay varias, por `via`. */
function resolvePath(cfg: Record<string, unknown>, ctx: FlowTranslateCtx): AiRelationPath {
    const available = (): string =>
        ctx.paths.map((p) => `${p.other_list_slug ?? p.other_list_name} (via «${p.relation_label}», relation_field_id ${p.relation_field_id})`).join(' | ') || 'ninguna';
    const byId = Number(cfg.relation_field_id);
    if (Number.isInteger(byId) && byId > 0) {
        const hit = ctx.paths.find((p) => p.relation_field_id === byId);
        if (!hit) throw new AiToolError(`for_each_linked: la relación ${byId} no conecta con «${ctx.listName}». Relaciones: ${available()}.`);
        return hit;
    }
    const target = typeof cfg.relation === 'string' ? cfg.relation.trim().toLowerCase() : '';
    if (target === '') throw new AiToolError(`for_each_linked necesita relation (slug de la lista vinculada) o relation_field_id. Relaciones: ${available()}.`);
    let hits = ctx.paths.filter((p) => (p.other_list_slug ?? '').toLowerCase() === target || p.other_list_name.toLowerCase() === target);
    const via = typeof cfg.via === 'string' ? cfg.via.trim().toLowerCase() : '';
    if (hits.length > 1 && via !== '') hits = hits.filter((p) => p.relation_label.toLowerCase() === via);
    if (hits.length === 0) throw new AiToolError(`for_each_linked: «${String(cfg.relation)}» no está vinculada con «${ctx.listName}». Relaciones: ${available()}.`);
    if (hits.length > 1) throw new AiToolError(`for_each_linked: hay varias relaciones con «${String(cfg.relation)}»; indica via (el nombre de la relación). Relaciones: ${available()}.`);
    return hits[0]!;
}

/**
 * Lo que el validador compartido diría al guardar sobre las piezas de FLUJO
 * (espera dentro de un bucle, bucle anidado, espera sin configurar, nombres de
 * respuesta). El resto de lo imprescindible lo sigue avisando el guardado.
 */
export function assertFlowIssues(input: { trigger_type: string; trigger_config?: Record<string, unknown>; actions: unknown[] }): void {
    const flowPath = /(\.type|\.response_name|\.relation_field_id|\.config\.actions|\.config\.target)$/;
    const issues = automationConfigIssues({ trigger_type: input.trigger_type, trigger_config: input.trigger_config ?? {}, actions: input.actions }).filter(
        (i) => flowPath.test(i.path) || /esperar|espera /i.test(i.message),
    );
    if (issues.length > 0) throw new AiToolError(issues.map((i) => `${i.path}: ${i.message}`).join(' · '));
}
