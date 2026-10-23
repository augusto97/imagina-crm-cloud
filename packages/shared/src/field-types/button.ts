import type { FilterNode } from '../schemas/filter';
import type { ButtonAction, ButtonConfig, ButtonSetMode } from '../schemas/button';
import { evaluateFilterCondition, type ConditionOptions, type FilterFieldValue } from './conditions';

/**
 * Campo «Botón» — lógica pura compartida (navegador y servidor).
 *
 * El navegador la usa para dibujar el botón atenuado con su motivo, ofrecer
 * (o no) el lote y avisar en el editor; el servidor la usa para RE-CHEQUEAR
 * todo al presionar. Una sola definición: lo que la interfaz muestra como
 * deshabilitado es exactamente lo que el servidor rechaza.
 */

/** Motivo por defecto de un botón deshabilitado por condición. */
export const BUTTON_DISABLED_DEFAULT_REASON = 'No está disponible para este registro';

/**
 * ¿El registro cumple la condición «Deshabilitado si…»? Las condiciones que
 * no aplican (campo borrado, operador que el tipo no admite) se ignoran, y un
 * filtro sin ninguna condición aplicable NO deshabilita: un botón no queda
 * inutilizado porque alguien borró el campo de su condición.
 */
export function buttonDisabledState(
    config: Pick<ButtonConfig, 'disabled_if' | 'disabled_reason'>,
    fieldOf: (fieldId: number) => FilterFieldValue | undefined,
    opts: ConditionOptions = {},
): { disabled: boolean; reason: string | null } {
    const tree = config.disabled_if;
    if (!tree) return { disabled: false, reason: null };
    const hit = evalStrict(tree, fieldOf, opts);
    if (hit !== true) return { disabled: false, reason: null };
    const reason = (config.disabled_reason ?? '').trim();
    return { disabled: true, reason: reason !== '' ? reason : BUTTON_DISABLED_DEFAULT_REASON };
}

function evalStrict(
    node: FilterNode,
    fieldOf: (fieldId: number) => FilterFieldValue | undefined,
    opts: ConditionOptions,
): boolean | null {
    if (node.type === 'condition') return evaluateFilterCondition(node, fieldOf(node.field_id), opts);
    const parts = node.children.map((c) => evalStrict(c, fieldOf, opts)).filter((r): r is boolean => r !== null);
    if (parts.length === 0) return null;
    return node.logic === 'or' ? parts.some(Boolean) : parts.every(Boolean);
}

/** Tipos que un botón puede escribir (los que se editan a mano, salvo archivos). */
export const BUTTON_TARGET_TYPES: readonly string[] = [
    'text', 'long_text', 'number', 'currency', 'select', 'multi_select', 'date', 'datetime',
    'checkbox', 'url', 'email', 'user', 'phone', 'rating', 'percent', 'duration',
];

const NUMERIC_ADD_TYPES = ['number', 'currency', 'percent', 'rating', 'duration'];

/** Cómo se puede escribir un campo de este tipo desde un botón. */
export function buttonSetModesFor(type: string): ButtonSetMode[] {
    if (!BUTTON_TARGET_TYPES.includes(type)) return [];
    const modes: ButtonSetMode[] = ['set', 'clear'];
    if (type === 'date' || type === 'datetime') modes.push('today');
    if (type === 'user') modes.push('me');
    if (type === 'checkbox') modes.push('toggle');
    if (NUMERIC_ADD_TYPES.includes(type)) modes.push('add');
    return modes;
}

/** Etiqueta de cada modo, para el editor y la vista previa. */
export const BUTTON_SET_MODE_LABELS: Record<ButtonSetMode, string> = {
    set: 'Poner',
    clear: 'Vaciar',
    today: 'Hoy / ahora',
    me: 'Quien presiona',
    toggle: 'Invertir',
    add: 'Sumar',
};

/**
 * El valor NUEVO de un campo al presionar, a partir del actual. `set` devuelve
 * el valor configurado tal cual (el servidor resuelve las variables y lo
 * convierte al tipo del campo). `null` = vaciar.
 */
export function computeButtonValue(
    mode: ButtonSetMode,
    field: { type: string },
    current: unknown,
    ctx: { configured: unknown; today: string; nowIso: string; userId: number },
): { ok: true; value: unknown } | { ok: false; error: string } {
    const modes = buttonSetModesFor(field.type);
    if (!modes.includes(mode)) return { ok: false, error: 'Ese campo no se puede cambiar de esa forma' };
    switch (mode) {
        case 'clear':
            return { ok: true, value: null };
        case 'today':
            return { ok: true, value: field.type === 'date' ? ctx.today : ctx.nowIso };
        case 'me':
            return ctx.userId > 0 ? { ok: true, value: ctx.userId } : { ok: false, error: 'No hay una persona que presione' };
        case 'toggle':
            return { ok: true, value: !(current === true || current === 1 || current === '1' || current === 'true') };
        case 'add': {
            const step = typeof ctx.configured === 'number' ? ctx.configured : Number(String(ctx.configured ?? '').replace(',', '.'));
            if (!Number.isFinite(step)) return { ok: false, error: 'La cantidad a sumar no es un número' };
            const base = typeof current === 'number' ? current : Number(current ?? 0);
            const sum = (Number.isFinite(base) ? base : 0) + step;
            // Sin arrastrar el error de coma flotante (0,1 + 0,2).
            return { ok: true, value: Math.round(sum * 1e6) / 1e6 };
        }
        default:
            return { ok: true, value: ctx.configured ?? null };
    }
}

/** El texto del botón: el propio o, si no tiene, el nombre del campo. */
export function buttonLabel(config: Pick<ButtonConfig, 'label'>, fieldLabel: string): string {
    const own = (config.label ?? '').trim();
    return own !== '' ? own : fieldLabel;
}

/**
 * ¿Se puede presionar en LOTE? No, si abre un enlace o descarga un PDF (abrir
 * cincuenta pestañas o bajar cincuenta archivos no es lo que nadie quiere);
 * sí, si sólo cambia campos, corre automatizaciones o guarda PDF.
 */
export function buttonSupportsBulk(config: Pick<ButtonConfig, 'actions'>): boolean {
    if (config.actions.length === 0) return false;
    return config.actions.every(
        (a) => a.type === 'update_fields' || a.type === 'run_automation' || (a.type === 'generate_pdf' && a.mode === 'save'),
    );
}

/** ¿Alguna acción cambia campos del registro? (exige poder editarlo). */
export function buttonChangesRecord(config: Pick<ButtonConfig, 'actions'>): boolean {
    return config.actions.some(
        (a) => (a.type === 'update_fields' && a.values.length > 0) || (a.type === 'generate_pdf' && a.mode === 'save'),
    );
}

/** Los campos que escribe el botón (las acciones «Cambiar campos» y guardar PDF). */
export function buttonWrittenFieldIds(config: Pick<ButtonConfig, 'actions'>): number[] {
    const ids = new Set<number>();
    for (const a of config.actions) {
        if (a.type === 'update_fields') for (const v of a.values) ids.add(v.field_id);
        if (a.type === 'generate_pdf' && a.mode === 'save' && a.save_field_id) ids.add(a.save_field_id);
    }
    return [...ids];
}

/**
 * Portal del cliente: qué acciones del botón NO se permiten ahí y por qué.
 *  - Abrir un enlace: siempre (con las variables que el cliente ya ve).
 *  - Cambiar campos: sólo los que el diseño del portal deja editar.
 *  - Generar un PDF: sólo de una plantilla publicada en el portal, y para
 *    descargar (guardarlo cambia un campo: también tiene que ser editable).
 *  - Correr una automatización: corre con los permisos del equipo, así que
 *    exige la regla explícita `portal_run_automation`.
 * Lista vacía = el cliente lo puede presionar.
 */
export function buttonPortalProblems(
    config: Pick<ButtonConfig, 'actions' | 'portal_run_automation'>,
    ctx: { editableFieldIds: ReadonlySet<number>; portalTemplateIds: ReadonlySet<number> },
): string[] {
    const out: string[] = [];
    if (config.actions.length === 0) out.push('El botón no tiene acciones');
    for (const a of config.actions) {
        if (a.type === 'update_fields') {
            const locked = a.values.filter((v) => !ctx.editableFieldIds.has(v.field_id));
            if (locked.length > 0) out.push('Cambia campos que el portal no deja editar');
        } else if (a.type === 'generate_pdf') {
            if (!a.document_template_id || !ctx.portalTemplateIds.has(a.document_template_id)) {
                out.push('El PDF usa una plantilla que no está publicada en el portal');
            }
            if (a.mode === 'save' && (!a.save_field_id || !ctx.editableFieldIds.has(a.save_field_id))) {
                out.push('Guarda el PDF en un campo que el portal no deja editar');
            }
        } else if (a.type === 'run_automation' && config.portal_run_automation !== true) {
            out.push('Corre una automatización y no está permitido desde el portal');
        }
    }
    return [...new Set(out)];
}

/** Una acción incompleta (para avisar en el editor y rechazar al presionar). */
export function buttonActionProblem(action: ButtonAction): string | null {
    switch (action.type) {
        case 'open_url':
            return action.url.trim() === '' ? 'Falta el enlace' : null;
        case 'update_fields':
            return action.values.length === 0 ? 'Elige al menos un campo para cambiar' : null;
        case 'generate_pdf':
            if (!action.document_template_id) return 'Elige la plantilla del PDF';
            if (action.mode === 'save' && !action.save_field_id) return 'Elige el campo Archivo donde guardarlo';
            return null;
        default:
            return null;
    }
}
