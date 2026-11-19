import type { AutomationAiDraftAutomation, AutomationAiDraftCurrent } from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import type { ActionSpec } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import type { AutomationFormState } from './config-editors';

/**
 * v0.1.463 — «Describir con IA» del editor de automatizaciones: las piezas
 * PURAS (sin red): los ejemplos armados con los campos de ESTA lista, el ida
 * y vuelta entre el estado del editor y lo que viaja al servidor.
 */

interface Option {
    value: string;
    label: string;
}

function optionsOf(f: FieldEntity): Option[] {
    const raw = (f.config as { options?: unknown } | undefined)?.options;
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((o): o is Option => !!o && typeof o === 'object' && typeof (o as Option).label === 'string')
        .map((o) => ({ value: String(o.value ?? o.label), label: o.label }));
}

/** La opción que «suena» a algo que hay que atender (vencida, pendiente…), o la primera. */
function attentionOption(opts: Option[]): Option | undefined {
    return opts.find((o) => /venc|atras|pend|urgent|riesgo|perdid|rechaz/i.test(`${o.value} ${o.label}`)) ?? opts[0];
}

/**
 * Tres o cuatro ejemplos clicables con los campos REALES de la lista: así la
 * persona ve qué se puede pedir sin pensar en el vocabulario de la app.
 */
export function aiDraftExamples(fields: readonly FieldEntity[], mode: 'create' | 'change' = 'create'): string[] {
    if (mode === 'change') {
        const out = [__('Al final, espera 1 día y avísame en la app si sigue igual.')];
        const email = fields.find((f) => f.type === 'email');
        if (email) out.push(sprintf(__('Manda también un correo a «%s».'), email.label));
        out.push(__('Si un paso que llama a otro servicio falla, avísame en la app y sigue con el resto.'));
        out.push(__('Ponle un nombre más claro y una descripción corta.'));
        return out.slice(0, 4);
    }
    const out: string[] = [];
    const select = fields.find((f) => f.type === 'select' && optionsOf(f).length > 0);
    const email = fields.find((f) => f.type === 'email');
    const phone = fields.find((f) => f.type === 'phone');
    const date = fields.find((f) => f.type === 'date' || f.type === 'datetime');
    const person = fields.find((f) => f.type === 'user');
    const longText = fields.find((f) => f.type === 'long_text');
    if (select) {
        const opt = attentionOption(optionsOf(select))!;
        const to = email ? sprintf(__('mándale un correo a «%s»'), email.label) : __('avísale al responsable en la app');
        out.push(sprintf(__('Cuando «%1$s» pase a «%2$s», %3$s y espera 2 días; si sigue igual, vuelve a avisar.'), select.label, opt.label, to));
    }
    if (date) {
        out.push(
            person
                ? sprintf(__('Un día antes de «%1$s», avísale a «%2$s» en la app.'), date.label, person.label)
                : sprintf(__('Un día antes de «%s», mándame un aviso en la app.'), date.label),
        );
    }
    if (phone) out.push(sprintf(__('Cuando se cree un registro, mándale un WhatsApp de bienvenida a «%s».'), phone.label));
    if (person) out.push(sprintf(__('Cuando se cree un registro, asígnalo por turnos en «%s» entre el equipo.'), person.label));
    if (longText && out.length < 4) out.push(sprintf(__('Cuando se cree un registro, que la IA lea «%s» y lo clasifique por prioridad.'), longText.label));
    if (out.length < 3) out.push(__('Cada lunes a las 8:00, mándame un resumen de lo que está pendiente.'));
    if (out.length < 3) out.push(__('Cuando se cree un registro, avísale al equipo en la app.'));
    return out.slice(0, 4);
}

/** Lo que vuelve del servidor → el estado del editor (sin guardar). */
export function draftToFormState(a: AutomationAiDraftAutomation): AutomationFormState {
    return {
        name: a.name,
        description: a.description ?? '',
        triggerType: a.trigger_type,
        triggerConfig: { ...a.trigger_config },
        actions: a.actions.map((s) => JSON.parse(JSON.stringify(s)) as ActionSpec),
        isActive: a.is_active,
    };
}

/** El estado del editor → «la automatización actual» que se manda para «Pedir un cambio». */
export function formStateToCurrent(s: AutomationFormState, id?: number): AutomationAiDraftCurrent {
    return {
        ...(id !== undefined ? { id } : {}),
        name: s.name.trim() || __('Automatización sin nombre'),
        description: s.description.trim() === '' ? null : s.description.trim(),
        trigger_type: s.triggerType,
        trigger_config: s.triggerConfig as Record<string, unknown>,
        actions: s.actions as unknown as Array<Record<string, unknown>>,
        is_active: s.isActive,
    };
}

/** Para comparar con `describeVersionChanges` (el mismo «qué cambió» del historial de versiones). */
export function formStateAsVersion(s: AutomationFormState): {
    name: string;
    description: string | null;
    trigger_type: string;
    trigger_config: Record<string, unknown>;
    actions: ActionSpec[];
    is_active: boolean;
} {
    return {
        name: s.name,
        description: s.description.trim() === '' ? null : s.description,
        trigger_type: s.triggerType,
        trigger_config: s.triggerConfig as Record<string, unknown>,
        actions: s.actions,
        is_active: s.isActive,
    };
}

/**
 * ¿Hay algo armado en el editor? Con pasos, o con un disparador que ya se
 * eligió (p. ej. «Automatizar» desde un botón), la IA CAMBIA lo que hay en vez
 * de armar de cero: así no se pierde el disparador que trajo la persona.
 */
export function hasAutomationContent(s: AutomationFormState, defaultTrigger = 'record_created'): boolean {
    if (s.actions.length > 0) return true;
    if (s.triggerType !== defaultTrigger) return true;
    return Object.values(s.triggerConfig).some((v) =>
        v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
        && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0),
    );
}
