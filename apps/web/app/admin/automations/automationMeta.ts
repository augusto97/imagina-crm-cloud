import {
    CalendarClock,
    Clock,
    FilePlus2,
    GitBranch,
    Mail,
    PenLine,
    Replace,
    Sparkles,
    Webhook,
    Zap,
    type LucideIcon,
} from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import type { ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

/**
 * Metadata visual + resúmenes en lenguaje humano del módulo de
 * automatizaciones. El flujo vertical del editor y las tarjetas del
 * índice muestran cada paso como una frase entendible ("Enviar un
 * correo a {{email}}") en vez del slug técnico.
 */

export interface StepMeta {
    icon: LucideIcon;
    /** Título corto de tarjeta (el catálogo del backend puede sobreescribirlo). */
    title: string;
    /** Una línea de qué hace — para el picker de acciones. */
    description: string;
}

export const TRIGGER_META: Record<string, StepMeta> = {
    record_created: {
        icon: Sparkles,
        title: 'Se crea un registro',
        description: 'Dispara cada vez que alguien crea un registro en esta lista.',
    },
    record_updated: {
        icon: PenLine,
        title: 'Se modifica un registro',
        description: 'Dispara cuando un registro cambia (opcionalmente solo ciertos campos).',
    },
    field_changed: {
        icon: Replace,
        title: 'Cambia un campo específico',
        description: 'Dispara cuando un campo pasa de un valor a otro.',
    },
    scheduled: {
        icon: Clock,
        title: 'De forma programada',
        description: 'Corre cada hora, dos veces al día, diario o semanal sobre todos los registros.',
    },
    due_date_reached: {
        icon: CalendarClock,
        title: 'Llega una fecha',
        description: 'Dispara cuando la fecha de un campo llega, se acerca o ya pasó.',
    },
};

export const ACTION_META: Record<string, StepMeta> = {
    update_field: {
        icon: PenLine,
        title: 'Actualizar campos',
        description: 'Cambia valores del registro que disparó la automatización.',
    },
    create_record: {
        icon: FilePlus2,
        title: 'Crear un registro',
        description: 'Crea un registro nuevo en esta u otra lista, con valores del registro origen.',
    },
    send_email: {
        icon: Mail,
        title: 'Enviar un correo',
        description: 'Envía un email con asunto y cuerpo personalizables con variables.',
    },
    call_webhook: {
        icon: Webhook,
        title: 'Llamar un webhook',
        description: 'Hace una petición HTTP a un sistema externo con datos del registro.',
    },
    if_else: {
        icon: GitBranch,
        title: 'Condición Si / Si no',
        description: 'Divide el flujo en dos ramas según una condición sobre el registro.',
    },
};

export function triggerMetaFor(slug: string): StepMeta {
    return TRIGGER_META[slug] ?? { icon: Zap, title: slug, description: '' };
}

export function actionMetaFor(slug: string): StepMeta {
    return ACTION_META[slug] ?? { icon: Zap, title: slug, description: '' };
}

function fieldLabel(fields: FieldEntity[], slug: string): string {
    return fields.find((f) => f.slug === slug)?.label ?? slug;
}

function conditionCount(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return 0;
}

function offsetHuman(offsetMinutes: number): string {
    if (offsetMinutes === 0) return __('el mismo día');
    const abs = Math.abs(offsetMinutes);
    const suffix = offsetMinutes < 0 ? __('antes') : __('después');
    if (abs % 1440 === 0) {
        const days = abs / 1440;
        return days === 1
            ? sprintf(__('1 día %s'), suffix)
            : sprintf(__('%1$d días %2$s'), days, suffix);
    }
    if (abs % 60 === 0) {
        const hours = abs / 60;
        return hours === 1
            ? sprintf(__('1 hora %s'), suffix)
            : sprintf(__('%1$d horas %2$s'), hours, suffix);
    }
    return sprintf(__('%1$d min %2$s'), abs, suffix);
}

const SCHEDULE_LABELS: Record<string, string> = {
    hourly: 'cada hora',
    twicedaily: 'dos veces al día',
    daily: 'todos los días',
    weekly: 'cada semana',
};

/**
 * Frase humana del trigger, ej.:
 *  - "Cuando se crea un registro"
 *  - "Cuando se modifica «Estado» o «Monto»"
 *  - "Cuando «Vence» llega (20 días después)"
 */
export function summarizeTrigger(
    triggerType: string,
    config: TriggerConfig,
    fields: FieldEntity[],
): string {
    switch (triggerType) {
        case 'record_created':
            return __('Cuando se crea un registro');
        case 'record_updated': {
            const changed = Array.isArray(config.changed_fields) ? config.changed_fields : [];
            if (changed.length === 0) return __('Cuando se modifica un registro');
            const labels = changed.map((s) => `«${fieldLabel(fields, s)}»`);
            return sprintf(
                /* translators: %s: field names */
                __('Cuando cambia %s'),
                labels.slice(0, 3).join(', ') + (labels.length > 3 ? '…' : ''),
            );
        }
        case 'field_changed': {
            const slug = typeof config.field === 'string' ? config.field : '';
            return slug === ''
                ? __('Cuando cambia un campo')
                : sprintf(__('Cuando cambia «%s»'), fieldLabel(fields, slug));
        }
        case 'scheduled': {
            const freq = typeof config.frequency === 'string' ? config.frequency : 'daily';
            return sprintf(__('De forma programada, %s'), __(SCHEDULE_LABELS[freq] ?? freq));
        }
        case 'due_date_reached': {
            const slug = typeof config.due_field === 'string' ? config.due_field : '';
            const offset = typeof config.offset_minutes === 'number' ? config.offset_minutes : 0;
            if (slug === '') return __('Cuando llega una fecha');
            return sprintf(
                /* translators: 1: date field name, 2: offset like "20 días después" */
                __('Cuando «%1$s» llega (%2$s)'),
                fieldLabel(fields, slug),
                offsetHuman(offset),
            );
        }
        default:
            return triggerType;
    }
}

/** Cantidad de condiciones (filtros) del trigger, para el chip "· N condiciones". */
export function triggerConditionCount(config: TriggerConfig): number {
    return conditionCount(config.field_filters);
}

/**
 * Frase humana de una acción, ej.:
 *  - "Actualiza «Próximo cobro»"
 *  - "Crea un registro en «Facturas» (4 valores)"
 *  - "Envía un correo a {{email}}"
 *  - "POST https://hooks.example.com/…"
 *  - "Si «estado» = pendiente → 2 acciones, si no → 1"
 */
export function summarizeAction(
    spec: ActionSpec,
    fields: FieldEntity[],
    lists: ListSummary[],
): string {
    const cfg = spec.config;
    switch (spec.type) {
        case 'update_field': {
            const values = cfg.values && typeof cfg.values === 'object' ? Object.keys(cfg.values as object) : [];
            if (values.length === 0) return __('Actualiza campos del registro');
            const labels = values.map((s) => `«${fieldLabel(fields, s)}»`);
            return sprintf(
                /* translators: %s: field names */
                __('Actualiza %s'),
                labels.slice(0, 3).join(', ') + (labels.length > 3 ? '…' : ''),
            );
        }
        case 'create_record': {
            const targetId = typeof cfg.target_list === 'number' ? cfg.target_list : undefined;
            const listName = lists.find((l) => l.id === targetId)?.name;
            const values = cfg.values && typeof cfg.values === 'object' ? Object.keys(cfg.values as object).length : 0;
            const base = listName !== undefined
                ? sprintf(__('Crea un registro en «%s»'), listName)
                : __('Crea un registro en esta lista');
            return values > 0 ? `${base} · ${sprintf(__('%d valores'), values)}` : base;
        }
        case 'send_email': {
            const to = typeof cfg.to === 'string' ? cfg.to : '';
            return to === ''
                ? __('Envía un correo')
                : sprintf(__('Envía un correo a %s'), to);
        }
        case 'call_webhook': {
            const method = typeof cfg.method === 'string' ? cfg.method : 'POST';
            const url = typeof cfg.url === 'string' ? cfg.url : '';
            if (url === '') return __('Llama un webhook');
            const short = url.length > 48 ? `${url.slice(0, 48)}…` : url;
            return `${method} ${short}`;
        }
        case 'if_else': {
            const thenN = Array.isArray(cfg.then_actions) ? cfg.then_actions.length : 0;
            const elseN = Array.isArray(cfg.else_actions) ? cfg.else_actions.length : 0;
            return sprintf(
                /* translators: 1: then-branch action count, 2: else-branch action count */
                __('Divide el flujo: %1$d acciones si se cumple, %2$d si no'),
                thenN,
                elseN,
            );
        }
        default:
            return spec.type;
    }
}

/** Cantidad de condiciones de ejecución de una acción (chip "N cond."). */
export function actionConditionCount(spec: ActionSpec): number {
    return conditionCount(spec.condition);
}
