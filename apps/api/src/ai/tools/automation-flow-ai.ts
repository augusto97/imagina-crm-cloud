import { ADD_COMMENT_ACTION, ASK_AI_ACTION, STOP_UNLESS_ACTION, SWITCH_ACTION, automationConfigIssues, flowChildLists, isUserWritableType, readWaitConfig, type Field } from '@imagina-base/shared';
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
export function rulesTree(rules: FilterRuleSpec[], fields: Field[], where: string) {
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
        // v0.1.460 — las ramas de si/sino y de «Según el valor de…» y los pasos
        // de «Si falla» (el cuerpo de un bucle va aparte, con el lado vinculado).
        for (const kid of flowChildLists(act)) if (kid.branch !== 'each') await translateFlowActions(kid.actions, ctx, inLoop);
        if (act.type === 'if_else') continue;
        // v0.1.466 — «Comprobar y detener»: reglas por slug (como un if_else);
        // una opción de selección se puede escribir por su etiqueta.
        if (act.type === STOP_UNLESS_ACTION) {
            translateStopUnless(cfg, ctx.fields, inLoop);
            continue;
        }
        if (act.type === ADD_COMMENT_ACTION) {
            if (cfg.target === 'item' && !inLoop) throw new AiToolError('add_comment con target «item» sólo va dentro de for_each_linked.');
            if (typeof cfg.body !== 'string' || cfg.body.trim() === '') throw new AiToolError('add_comment necesita body: el texto del comentario.');
            if (cfg.visibility !== undefined && cfg.visibility !== 'internal' && cfg.visibility !== 'client') {
                throw new AiToolError('add_comment: visibility es "internal" (nota interna, default) o "client" (también la ve el cliente).');
            }
            continue;
        }
        if (act.type === SWITCH_ACTION) {
            translateSwitch(cfg, ctx.fields, ctx.listName);
            continue;
        }
        if (act.type === ASK_AI_ACTION) {
            translateAskAi(cfg, ctx.fields, ctx.listName);
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

/**
 * v0.1.466 — «Comprobar y detener si no se cumple»: las reglas quedan por
 * SLUG (como las de un if_else: el motor las evalúa así). Se valida que el
 * campo exista (el de un vinculado como `item.slug` dentro de un bucle; las
 * variables `payload.`, `respuestas.`… pasan) y el valor de un campo de
 * selección, de etiqueta a valor.
 */
export function translateStopUnless(cfg: Record<string, unknown>, fields: Field[], inLoop: { fields: Field[]; listName: string } | null): void {
    const raw = Array.isArray(cfg.condition) ? (cfg.condition as Array<Record<string, unknown>>) : [];
    if (raw.length === 0) throw new AiToolError('stop_unless necesita condition: [{field, op, value}] (al menos una regla).');
    for (const r of raw) {
        const slug = String(r.field ?? r.slug ?? '').trim();
        if (slug === '') throw new AiToolError('stop_unless: cada regla necesita field (slug del campo o una variable como "respuestas.ia.valor").');
        let f: Field | undefined;
        if (slug.startsWith('item.')) {
            if (!inLoop) throw new AiToolError(`stop_unless: «${slug}» sólo existe dentro de for_each_linked.`);
            f = inLoop.fields.find((x) => x.slug === slug.slice(5));
            if (!f) throw new AiToolError(`stop_unless: «${slug}» no es un campo de «${inLoop.listName}».`);
        } else if (!slug.includes('.')) {
            f = fields.find((x) => x.slug === slug);
        }
        if (f && OPTION_TYPES.includes(f.type)) {
            if (typeof r.value === 'string') r.value = optionValue(f, r.value);
            else if (Array.isArray(r.value)) r.value = r.value.map((v) => (typeof v === 'string' ? optionValue(f!, v) : v));
        }
    }
}

/** Para encontrar un campo de la lista por slug (o por id, si ya viene traducido). */
function fieldRef(raw: unknown, fields: Field[]): Field | undefined {
    if (typeof raw === 'number') return fields.find((f) => f.id === raw);
    if (typeof raw !== 'string' || raw.trim() === '') return undefined;
    const t = raw.trim().toLowerCase();
    return fields.find((f) => f.slug === raw.trim()) ?? fields.find((f) => (f.label ?? '').trim().toLowerCase() === t);
}

const OPTION_TYPES = ['select', 'multi_select'];
/** Dónde puede guardar la IA: lo que se escribe a mano (no archivos ni vínculos). */
const savable = (f: Field): boolean => isUserWritableType(f.type) && f.type !== 'file' && f.type !== 'relation';

/**
 * v0.1.460 — «Según el valor de…» en el vocabulario del modelo:
 * `{field: slug | variable: "respuestas.ia.valor", cases: [{label?, op?, value, actions}], default_actions?}`.
 * El campo pasa a `source_field_id` (por id: si lo renombran no se rompe) y
 * el valor de cada rama de un campo de selección, de etiqueta a valor.
 */
export function translateSwitch(cfg: Record<string, unknown>, fields: Field[], listName: string): void {
    const raw = cfg.field ?? cfg.source_field ?? cfg.source_field_id;
    delete cfg.field;
    delete cfg.source_field;
    let f: Field | undefined;
    if (raw !== undefined && raw !== null && raw !== '') {
        f = fieldRef(raw, fields);
        if (!f) throw new AiToolError(`switch: el campo «${String(raw)}» no existe en «${listName}». Campos: ${fields.map((x) => x.slug).join(', ')}.`);
        cfg.source_field_id = f.id;
        delete cfg.source_variable;
    } else if (typeof cfg.variable === 'string' && cfg.variable.trim() !== '') {
        cfg.source_variable = cfg.variable.trim().replace(/^\{\{\s*|\s*\}\}$/g, '');
    }
    delete cfg.variable;
    if (cfg.source_field_id === undefined && typeof cfg.source_variable !== 'string') {
        throw new AiToolError('switch necesita field (slug del campo que decide la rama) o variable (por ejemplo "respuestas.ia.valor").');
    }
    const cases = Array.isArray(cfg.cases) ? (cfg.cases as Array<Record<string, unknown>>) : [];
    if (cases.length === 0) throw new AiToolError('switch necesita cases: [{value, actions}] (una rama por valor).');
    if (f && OPTION_TYPES.includes(f.type)) {
        for (const c of cases) {
            if (typeof c.value === 'string') c.value = optionValue(f, c.value);
            else if (Array.isArray(c.value)) c.value = c.value.map((v) => (typeof v === 'string' ? optionValue(f!, v) : v));
        }
    }
}

/**
 * v0.1.460 — «Preguntarle a la IA» en el vocabulario del modelo: campos por
 * slug (`choices_field`, `save_to`, `items[].field`) → ids.
 */
export function translateAskAi(cfg: Record<string, unknown>, fields: Field[], listName: string): void {
    const need = (raw: unknown, what: string): Field => {
        const f = fieldRef(raw, fields);
        if (!f) throw new AiToolError(`ask_ai: ${what} «${String(raw)}» no existe en «${listName}». Campos: ${fields.map((x) => x.slug).join(', ')}.`);
        return f;
    };
    if (cfg.choices_field !== undefined && cfg.choices_field !== null && cfg.choices_field !== '') {
        const f = need(cfg.choices_field, 'el campo de las opciones');
        if (!OPTION_TYPES.includes(f.type)) throw new AiToolError(`ask_ai: «${f.label}» no es un campo de selección (choices_field).`);
        cfg.choices_field_id = f.id;
    }
    delete cfg.choices_field;
    if (cfg.save_to !== undefined && cfg.save_to !== null && cfg.save_to !== '') {
        const f = need(cfg.save_to, 'el campo donde se guarda');
        if (!savable(f)) throw new AiToolError(`ask_ai: en «${f.label}» no se puede guardar (es un campo que se calcula solo, un archivo o un vínculo).`);
        cfg.save_field_id = f.id;
    }
    delete cfg.save_to;
    if (Array.isArray(cfg.items)) {
        cfg.items = (cfg.items as Array<Record<string, unknown>>).map((it) => {
            const out: Record<string, unknown> = { ...it };
            const ref = it.field ?? it.save_to;
            delete out.field;
            delete out.save_to;
            if (ref !== undefined && ref !== null && ref !== '') {
                const f = need(ref, `el campo del dato «${String(it.key ?? '')}»`);
                if (!savable(f)) throw new AiToolError(`ask_ai: en «${f.label}» no se puede guardar.`);
                out.field_id = f.id;
            }
            return out;
        });
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
    // v0.1.460 — también «Según el valor de…», «Preguntarle a la IA» y «Si este paso falla».
    const flowPath =
        /(\.type|\.response_name|\.relation_field_id|\.config\.actions|\.config\.target|\.config\.condition|\.config\.source_field_id|\.config\.cases(\.\d+\.value)?|\.config\.(instruction|choices|items(\.\d+\.key)?)|\.on_error\.(mode|actions))$/;
    const issues = automationConfigIssues({ trigger_type: input.trigger_type, trigger_config: input.trigger_config ?? {}, actions: input.actions }).filter(
        (i) => flowPath.test(i.path) || /esperar|espera /i.test(i.message),
    );
    if (issues.length > 0) throw new AiToolError(issues.map((i) => `${i.path}: ${i.message}`).join(' · '));
}
