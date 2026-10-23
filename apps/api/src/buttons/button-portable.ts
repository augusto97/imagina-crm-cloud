/**
 * Campo «Botón» — la config en un BLUEPRINT (duplicar lista, plantillas) y al
 * migrar una empresa. Los campos que referencia terminan en `field_id` y los
 * re-mapean los mecanismos de siempre; aquí se resuelve lo que no sigue esa
 * convención:
 *  - `automation_id`: una automatización de la MISMA lista viaja como
 *    `{ $automation: <índice en el blueprint> }` y se re-apunta cuando la
 *    copia ya la creó; si no viaja, el botón corre las que escuchan el botón.
 *  - `document_template_id`: las plantillas de documento no viajan en un
 *    blueprint (son de la lista), así que la referencia se quita y se avisa.
 */

type Json = Record<string, unknown>;

function actionsOf(config: Json): Json[] {
    return Array.isArray(config.actions) ? (config.actions as Json[]) : [];
}

/** Al serializar: automatización → token por índice; plantilla de PDF → fuera. */
export function portableButtonConfig(config: Json, autoIndexById: ReadonlyMap<number, number>): Json {
    return {
        ...config,
        actions: actionsOf(config).map((a) => {
            if (a.type === 'run_automation') {
                const idx = typeof a.automation_id === 'number' ? autoIndexById.get(a.automation_id) : undefined;
                const { automation_id: _drop, ...rest } = a;
                return idx === undefined ? rest : { ...rest, automation_id: { $automation: idx } };
            }
            if (a.type === 'generate_pdf') {
                const { document_template_id: _drop, ...rest } = a;
                return rest;
            }
            return a;
        }),
    };
}

/** Al materializar: saca los tokens `$automation` (se re-apuntan después). */
export function extractButtonAutomationRefs(config: Json): { config: Json; refs: Array<{ action: number; auto: number }> } {
    const refs: Array<{ action: number; auto: number }> = [];
    const actions = actionsOf(config).map((a, i) => {
        const tok = a.automation_id as { $automation?: unknown } | undefined;
        if (a.type === 'run_automation' && tok && typeof tok === 'object' && typeof tok.$automation === 'number') {
            refs.push({ action: i, auto: tok.$automation });
            const { automation_id: _drop, ...rest } = a;
            return rest;
        }
        return a;
    });
    return { config: { ...config, actions }, refs };
}

/** Pone los ids nuevos de las automatizaciones en la config ya creada. */
export function applyButtonAutomationRefs(config: Json, refs: Array<{ action: number; auto: number }>, autoIds: ReadonlyArray<number | null>): Json {
    const actions = actionsOf(config).map((a, i) => {
        const ref = refs.find((r) => r.action === i);
        const id = ref ? autoIds[ref.auto] ?? null : null;
        return id ? { ...a, automation_id: id } : a;
    });
    return { ...config, actions };
}

/**
 * Tras resolver los campos: lo que no resolvió (un campo que no viajó) queda
 * en `null`; se quita para que la config siga siendo válida.
 */
export function cleanResolvedButtonConfig(config: Json): Json {
    const actions = actionsOf(config).map((a) => {
        if (a.type === 'update_fields' && Array.isArray(a.values)) {
            return { ...a, values: (a.values as Json[]).filter((v) => typeof v.field_id === 'number') };
        }
        if (a.type === 'generate_pdf' && a.save_field_id === null) {
            const { save_field_id: _drop, ...rest } = a;
            return rest;
        }
        if (a.automation_id === null || a.document_template_id === null) {
            const out = { ...a };
            if (out.automation_id === null) delete out.automation_id;
            if (out.document_template_id === null) delete out.document_template_id;
            return out;
        }
        return a;
    });
    const out: Json = { ...config, actions };
    if (out.disabled_if && typeof out.disabled_if === 'object') {
        const cleaned = pruneNullConditions(out.disabled_if as Json);
        if (cleaned) out.disabled_if = cleaned;
        else delete out.disabled_if;
    }
    return out;
}

function pruneNullConditions(node: Json): Json | null {
    if (node.type === 'condition') return typeof node.field_id === 'number' ? node : null;
    const children = Array.isArray(node.children) ? (node.children as Json[]).map(pruneNullConditions).filter((c): c is Json => c !== null) : [];
    return children.length > 0 ? { ...node, children } : null;
}

/** ¿Algún «Generar un PDF» del botón quedó sin plantilla? (para avisar). */
export function buttonLostTemplate(config: Json): boolean {
    return actionsOf(config).some((a) => a.type === 'generate_pdf' && typeof a.document_template_id !== 'number');
}
