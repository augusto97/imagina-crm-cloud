import {
    EMAIL_TRIGGER_KINDS,
    SLA_ALERT_KINDS,
    SLA_TARGET_KINDS,
    TICKET_MERGE_TAGS,
    type EmailTriggerKind,
    type SlaAlertKind,
    type SlaTargetKind,
} from '@imagina-base/shared';
import { Info } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useHelpdeskMailbox, useHelpdeskSettings } from '@/hooks/useHelpdesk';
import { __ } from '@/lib/i18n';
import type { ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { MergeTagInput, type MergeTagSection } from '../automations/MergeTagInput';

/**
 * D2/E5 — Las piezas de la mesa de ayuda en el editor de automatizaciones: los
 * disparadores «Cuando llega un correo» y «Cuando un SLA está en riesgo o se
 * vence», y la acción «Responder por correo». Viven aquí (y no en
 * `config-editors.tsx`) para tocar lo mínimo el editor compartido.
 */

const EMAIL_KIND_LABELS: Record<EmailTriggerKind, string> = {
    any: 'Cualquier correo (ticket nuevo o respuesta)',
    new: 'Sólo cuando se abre un ticket nuevo',
    reply: 'Sólo cuando el cliente responde un ticket',
};

function readList<T extends string>(value: unknown, allowed: readonly T[]): T[] {
    return Array.isArray(value) ? (value.map(String).filter((v) => (allowed as readonly string[]).includes(v)) as T[]) : [];
}

/** Lo que el disparador guarda (sólo lo que no es el valor por defecto). */
export function cleanHelpdeskTriggerConfig(c: TriggerConfig, out: TriggerConfig): void {
    if (c.email_kind === 'new' || c.email_kind === 'reply') out.email_kind = c.email_kind;
    const alerts = readList(c.sla_alerts, SLA_ALERT_KINDS);
    if (alerts.length > 0 && alerts.length < SLA_ALERT_KINDS.length) out.sla_alerts = alerts;
    const targets = readList(c.sla_targets, SLA_TARGET_KINDS);
    if (targets.length > 0 && targets.length < SLA_TARGET_KINDS.length) out.sla_targets = targets;
}

/** Aviso cuando a la lista le falta lo que el disparador o la acción necesitan. */
function MissingSetup({ text }: { text: string }): JSX.Element {
    return (
        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs imcrm-text-[hsl(var(--imcrm-warning-ink))]">
            <Info className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
            <span>{text}</span>
        </p>
    );
}

/** «Cuando llega un correo»: cualquiera, sólo tickets nuevos o sólo respuestas. */
export function EmailReceivedTriggerConfig({
    listId,
    config,
    onChange,
}: {
    listId: number | undefined;
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
}): JSX.Element {
    const mailbox = useHelpdeskMailbox(listId);
    const kind: EmailTriggerKind = (EMAIL_TRIGGER_KINDS as readonly string[]).includes(String(config.email_kind))
        ? (config.email_kind as EmailTriggerKind)
        : 'any';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-email-config">
            <Label htmlFor="trigger-email-kind">{__('Qué correos')}</Label>
            <Select
                id="trigger-email-kind"
                value={kind}
                onChange={(e) => {
                    const next = { ...config };
                    if (e.target.value === 'any') delete next.email_kind;
                    else next.email_kind = e.target.value;
                    onChange(next);
                }}
            >
                {EMAIL_TRIGGER_KINDS.map((k) => (
                    <option key={k} value={k}>
                        {__(EMAIL_KIND_LABELS[k])}
                    </option>
                ))}
            </Select>
            {!mailbox.isLoading && mailbox.data === null && (
                <MissingSetup text={__('Esta lista todavía no tiene un buzón de soporte: conéctalo en Ajustes de la lista → Correo entrante para que lleguen los correos.')} />
            )}
        </div>
    );
}

/** «Cuando un SLA está en riesgo o se vence»: qué alertas y de qué objetivo. */
export function SlaAlertTriggerConfig({
    listId,
    config,
    onChange,
}: {
    listId: number | undefined;
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
}): JSX.Element {
    const settings = useHelpdeskSettings(listId);
    const alerts = readList(config.sla_alerts, SLA_ALERT_KINDS);
    const targets = readList(config.sla_targets, SLA_TARGET_KINDS);
    const toggle = <T extends string>(key: 'sla_alerts' | 'sla_targets', all: readonly T[], current: T[], value: T, on: boolean): void => {
        const base = current.length === 0 ? [...all] : current;
        const picked = on ? [...new Set([...base, value])] : base.filter((x) => x !== value);
        const next = { ...config };
        // Ninguno o todos = sin filtro (el motor escucha todos).
        if (picked.length === 0 || picked.length === all.length) delete next[key];
        else next[key] = all.filter((x) => picked.includes(x));
        onChange(next);
    };
    const slaOff = settings.data !== undefined && !settings.data.settings.sla.enabled;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-sla-config">
            <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <legend className="imcrm-mb-1 imcrm-text-sm imcrm-font-medium">{__('Qué alerta')}</legend>
                {SLA_ALERT_KINDS.map((a: SlaAlertKind) => (
                    <label key={a} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            checked={alerts.length === 0 || alerts.includes(a)}
                            onChange={(e) => toggle('sla_alerts', SLA_ALERT_KINDS, alerts, a, e.target.checked)}
                            data-sla-alert={a}
                        />
                        {a === 'at_risk' ? __('Cuando queda en riesgo') : __('Cuando se vence')}
                    </label>
                ))}
            </fieldset>
            <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <legend className="imcrm-mb-1 imcrm-text-sm imcrm-font-medium">{__('De qué objetivo')}</legend>
                {SLA_TARGET_KINDS.map((t: SlaTargetKind) => (
                    <label key={t} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            checked={targets.length === 0 || targets.includes(t)}
                            onChange={(e) => toggle('sla_targets', SLA_TARGET_KINDS, targets, t, e.target.checked)}
                            data-sla-target={t}
                        />
                        {t === 'first_response' ? __('Primera respuesta') : __('Resolución')}
                    </label>
                ))}
            </fieldset>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Cada alerta dispara una sola vez por ticket. Si el ticket se reabre, el SLA vuelve a contar y puede volver a avisar.')}
            </p>
            {slaOff && <MissingSetup text={__('Esta lista todavía no tiene el SLA activado: configúralo en Ajustes de la lista → SLA.')} />}
        </div>
    );
}

const TICKET_SECTION: MergeTagSection[] = [
    {
        title: 'Ticket y cliente',
        items: TICKET_MERGE_TAGS.map((t) => ({ tag: t.tag, label: t.label, hint: `{{${t.tag}}}` })),
    },
];

/** «Responder por correo al hilo del registro». */
export function ReplyEmailActionConfig({
    listId,
    spec,
    onChange,
    fields,
}: {
    listId: number | undefined;
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const mailbox = useHelpdeskMailbox(listId);
    const settings = useHelpdeskSettings(listId);
    const cfg = spec.config ?? {};
    const body = typeof cfg.body === 'string' ? cfg.body : '';
    const subject = typeof cfg.subject === 'string' ? cfg.subject : '';
    const cc = typeof cfg.cc === 'string' ? cfg.cc : '';
    const set = (key: 'body' | 'subject' | 'cc', value: string): void => {
        const next = { ...cfg };
        if (value === '' && key !== 'body') delete next[key];
        else next[key] = value;
        onChange({ ...spec, config: next });
    };
    const templates = settings.data?.settings.reply_templates ?? [];
    const sections = TICKET_SECTION.map((s) => ({ ...s, title: __(s.title), items: s.items.map((i) => ({ ...i, label: __(i.label) })) }));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="action-reply-email">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Contesta en el hilo del ticket, desde el buzón de soporte, a quien escribió (con copia a quienes estaban en el correo). Sale marcada como respuesta automática: no cuenta como la primera respuesta del SLA.')}
            </p>
            {!mailbox.isLoading && mailbox.data === null && (
                <MissingSetup text={__('Esta lista no tiene un buzón de soporte conectado: la respuesta no se podrá enviar hasta que lo conectes en Ajustes de la lista → Correo entrante.')} />
            )}
            {templates.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="reply-email-template">{__('Partir de una plantilla de respuesta')}</Label>
                    <Select
                        id="reply-email-template"
                        value=""
                        onChange={(e) => {
                            const t = templates.find((x) => x.id === e.target.value);
                            if (t) set('body', t.body);
                        }}
                    >
                        <option value="">{__('Elige una plantilla para copiar su texto…')}</option>
                        {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </Select>
                </div>
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Respuesta')}</Label>
                <MergeTagInput
                    value={body}
                    onChange={(v) => set('body', v)}
                    fields={fields}
                    rows={5}
                    autoGrow
                    extraTags={sections}
                    placeholder={__('Hola {{cliente.nombre}}, recibimos tu mensaje…')}
                    aria-label={__('Respuesta')}
                />
                {body.trim() === '' && <p className="imcrm-text-xs imcrm-text-destructive">{__('Escribe el texto de la respuesta.')}</p>}
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Asunto (opcional)')}</Label>
                <MergeTagInput
                    value={subject}
                    onChange={(v) => set('subject', v)}
                    fields={fields}
                    extraTags={sections}
                    placeholder={__('Re: el asunto del ticket, con su número')}
                    aria-label={__('Asunto')}
                />
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('El número del ticket se agrega solo al asunto: así una respuesta del cliente vuelve al mismo registro.')}
                </p>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Con copia (opcional)')}</Label>
                <MergeTagInput value={cc} onChange={(v) => set('cc', v)} fields={fields} placeholder="soporte@empresa.com" aria-label={__('Con copia')} />
            </div>
        </div>
    );
}
