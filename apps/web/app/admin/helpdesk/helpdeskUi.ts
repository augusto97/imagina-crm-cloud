import {
    SLA_ALERT_KINDS,
    SLA_ALERT_LABELS,
    SLA_STATUS_LABELS,
    SLA_TARGET_KINDS,
    SLA_TARGET_LABELS,
    type HelpdeskMessageStatus,
    type ImapDiagnosticStep,
    type SlaStatusValue,
} from '@imagina-base/shared';

import type { BadgeProps } from '@/components/ui/badge';
import { __ } from '@/lib/i18n';

/**
 * D2/E5 — Etiquetas y colores de la mesa de ayuda, en un solo lugar (los usan
 * el panel del buzón, el del SLA y la ficha). PURO: se prueba sin React.
 */

export const MESSAGE_STATUS_LABELS: Record<HelpdeskMessageStatus, string> = {
    ticket: __('Ticket nuevo'),
    reply: __('Respuesta del cliente'),
    ignored: __('Ignorado'),
    failed: __('No se pudo procesar'),
    sent: __('Respuesta enviada'),
};

export const MESSAGE_STATUS_VARIANT: Record<HelpdeskMessageStatus, NonNullable<BadgeProps['variant']>> = {
    ticket: 'success',
    reply: 'info',
    ignored: 'secondary',
    failed: 'destructive',
    sent: 'default',
};

export const DIAGNOSTIC_STEP_LABELS: Record<ImapDiagnosticStep, string> = {
    dns: __('Servidor'),
    connect: __('Conexión'),
    tls: __('Seguridad (TLS)'),
    auth: __('Usuario y contraseña'),
    folder: __('Carpeta'),
    ok: __('Todo en orden'),
};

export const SLA_STATUS_VARIANT: Record<SlaStatusValue, NonNullable<BadgeProps['variant']>> = {
    a_tiempo: 'success',
    en_riesgo: 'warning',
    vencido: 'destructive',
    cumplido: 'info',
    pausado: 'secondary',
};

export function slaStatusLabel(status: SlaStatusValue | null | undefined): string {
    return status ? SLA_STATUS_LABELS[status] : __('Sin SLA');
}

/** Días de la semana (0 = domingo), en el orden en que se leen. */
export const WEEKDAYS: Array<{ value: number; short: string; long: string }> = [
    { value: 1, short: __('Lu'), long: __('Lunes') },
    { value: 2, short: __('Ma'), long: __('Martes') },
    { value: 3, short: __('Mi'), long: __('Miércoles') },
    { value: 4, short: __('Ju'), long: __('Jueves') },
    { value: 5, short: __('Vi'), long: __('Viernes') },
    { value: 6, short: __('Sá'), long: __('Sábado') },
    { value: 0, short: __('Do'), long: __('Domingo') },
];

/** Horas → texto («1 h 30 min», «2 días hábiles» no: son horas hábiles). */
export function hoursLabel(hours: number | null): string {
    if (hours === null) return __('Sin objetivo');
    const total = Math.round(hours * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Lo que se escribe en un input de horas («1,5» o «1.5») → número; vacío = sin objetivo. */
export function parseHours(raw: string): number | null {
    const t = raw.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 8760) : null;
}

/** Cuánto falta (o cuánto pasó) para un vencimiento, en reloj de pared: «en 1 h 20 min», «hace 30 min». */
export function dueIn(iso: string | null, now: Date = new Date()): string {
    if (!iso) return '';
    const at = new Date(iso.includes('Z') || iso.includes('+') ? iso : `${iso.replace(' ', 'T')}Z`);
    const ms = at.getTime() - now.getTime();
    if (Number.isNaN(ms)) return '';
    const mins = Math.round(Math.abs(ms) / 60000);
    if (mins < 1) return __('ahora');
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    const span = d > 0 ? `${d} d${h > 0 ? ` ${h} h` : ''}` : h > 0 ? `${h} h${m > 0 ? ` ${m} min` : ''}` : `${m} min`;
    return ms >= 0 ? `${__('en')} ${span}` : `${__('hace')} ${span}`;
}

/** Variables que acepta una respuesta guardada (la ayuda bajo el editor). */
export const REPLY_VARIABLES: Array<{ tag: string; label: string }> = [
    { tag: '{{cliente.nombre}}', label: __('Nombre del cliente') },
    { tag: '{{cliente.correo}}', label: __('Correo del cliente') },
    { tag: '{{ticket.numero}}', label: __('Número del ticket') },
    { tag: '{{ticket.asunto}}', label: __('Asunto del ticket') },
    { tag: '{{agente.nombre}}', label: __('Tu nombre') },
];

function pickKinds<T extends string>(value: unknown, allowed: readonly T[]): T[] {
    return Array.isArray(value) ? (value.map(String).filter((v) => (allowed as readonly string[]).includes(v)) as T[]) : [];
}

/**
 * La frase del disparador en el editor y el índice de automatizaciones
 * («Cuando el cliente responde un ticket por correo»). `null` si no es de la
 * mesa de ayuda.
 */
export function summarizeHelpdeskTrigger(triggerType: string, config: Record<string, unknown>): string | null {
    if (triggerType === 'email_received') {
        if (config.email_kind === 'new') return __('Cuando llega un correo que abre un ticket');
        if (config.email_kind === 'reply') return __('Cuando el cliente responde un ticket por correo');
        return __('Cuando llega un correo al buzón de soporte');
    }
    if (triggerType === 'sla_alert') {
        const alerts = pickKinds(config.sla_alerts, SLA_ALERT_KINDS);
        const targets = pickKinds(config.sla_targets, SLA_TARGET_KINDS);
        const what = alerts.length === 1 ? __(SLA_ALERT_LABELS[alerts[0]!]) : __('en riesgo o vencido');
        const of = targets.length === 1 ? ` (${__(SLA_TARGET_LABELS[targets[0]!])})` : '';
        return `${__('Cuando un SLA queda')} ${what}${of}`;
    }
    return null;
}
