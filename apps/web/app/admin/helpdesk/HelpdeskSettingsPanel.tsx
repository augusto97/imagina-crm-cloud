import { useEffect, useMemo, useState } from 'react';
import { Loader2, MessageSquareReply, Plus, Save, Trash2 } from 'lucide-react';
import type { HelpdeskSettings, ReplyTemplate } from '@imagina-base/shared';

import { extractFieldOptions } from '@/admin/records/fieldOptions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { useHelpdeskSettings, useUpdateHelpdeskSettings } from '@/hooks/useHelpdesk';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { REPLY_VARIABLES } from './helpdeskUi';

type Draft = Omit<HelpdeskSettings, 'sla'>;

function draftOf(s: HelpdeskSettings): Draft {
    const { sla: _sla, ...rest } = s;
    return rest;
}

/** Campos de la lista de estos tipos, para un select de mapeo. */
function fieldsOf(fields: FieldEntity[], types: string[]): FieldEntity[] {
    return fields.filter((f) => types.includes(f.type));
}

/**
 * D2 — Cómo entra cada correo a la lista: a qué campos va (título, nombre y
 * correo del cliente, fecha, texto, adjuntos, contacto), los estados del
 * ticket (inicial, en espera, cerrados, reapertura), las protecciones
 * (autorrespuestas, tope por remitente, bloqueados) y las respuestas
 * guardadas que el equipo usa desde la ficha.
 */
export function HelpdeskSettingsPanel({ listId }: { listId: number }): JSX.Element {
    const settingsQ = useHelpdeskSettings(listId);
    const fieldsQ = useFields(listId);
    const update = useUpdateHelpdeskSettings(listId);
    const toast = useToast();
    const [draft, setDraft] = useState<Draft | null>(null);
    const [blocked, setBlocked] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});

    const loaded = settingsQ.data?.settings;
    useEffect(() => {
        if (loaded && draft === null) {
            setDraft(draftOf(loaded));
            setBlocked(loaded.blocked_senders.join('\n'));
        }
    }, [loaded, draft]);

    const fields = useMemo(() => fieldsQ.data ?? [], [fieldsQ.data]);
    const statusField = useMemo(() => fields.find((f) => f.id === draft?.status_field_id) ?? null, [fields, draft?.status_field_id]);
    const statusOptions = statusField ? extractFieldOptions(statusField) : [];
    const contactField = fields.find((f) => f.id === draft?.contact_field_id) ?? null;
    const contactTarget = Number((contactField?.config as { target_list_id?: unknown } | undefined)?.target_list_id) || undefined;
    const contactFields = useFields(contactTarget).data ?? [];

    if (!draft) return <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />;

    const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => (d ? { ...d, [key]: value } : d));
    const numberOrNull = (v: string): number | null => (v === '' ? null : Number(v));
    const toggleIn = (key: 'paused_statuses' | 'closed_statuses', value: string): void => {
        const cur = draft[key];
        set(key, cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]);
    };

    const saveAll = (): void => {
        setErrors({});
        const payload = {
            ...draft,
            blocked_senders: blocked
                .split(/[\n,;]+/)
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
        };
        update.mutate(payload, {
            onSuccess: (s) => {
                setDraft(draftOf(s));
                setBlocked(s.blocked_senders.join('\n'));
                toast.success(__('Mesa de ayuda guardada'));
            },
            onError: (err) => {
                if (err instanceof ApiError) setErrors(err.errors);
                toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : '');
            },
        });
    };

    const mapSelect = (key: keyof Draft, label: string, types: string[], empty: string, hint?: string): JSX.Element => (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <Label htmlFor={`hd-map-${String(key)}`}>{label}</Label>
            <Select
                id={`hd-map-${String(key)}`}
                value={draft[key] === null || draft[key] === undefined ? '' : String(draft[key])}
                onChange={(e) => set(key, numberOrNull(e.target.value) as never)}
            >
                <option value="">{empty}</option>
                {fieldsOf(fields, types).map((f) => (
                    <option key={f.id} value={f.id}>
                        {f.label}
                    </option>
                ))}
            </Select>
            {errors[String(key)] && <p className="imcrm-text-xs imcrm-text-destructive">{errors[String(key)]}</p>}
            {hint && <p className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );

    const templates = draft.reply_templates;
    const setTemplate = (i: number, patch: Partial<ReplyTemplate>): void =>
        set(
            'reply_templates',
            templates.map((t, j) => (j === i ? { ...t, ...patch } : t)),
        );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="imcrm-helpdesk-settings">
            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-text-base">{__('Cómo se crea cada ticket')}</CardTitle>
                    <CardDescription>{__('Qué parte del correo va a cada campo. El cuerpo del correo queda además en la descripción del registro, con su formato.')}</CardDescription>
                </CardHeader>
                <CardContent className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    {mapSelect('title_field_id', __('Asunto → título'), ['text'], __('El campo de título de la lista'))}
                    {mapSelect('from_name_field_id', __('Nombre del cliente'), ['text'], __('No guardar'))}
                    {mapSelect('from_email_field_id', __('Correo del cliente'), ['email', 'text'], __('No guardar'))}
                    {mapSelect('received_at_field_id', __('Fecha de llegada'), ['datetime', 'date'], __('No guardar'))}
                    {mapSelect('body_text_field_id', __('Texto del correo (copia en texto plano)'), ['long_text', 'text'], __('No guardar'))}
                    {mapSelect('attachments_field_id', __('Adjuntos'), ['file'], __('No guardar'), __('Cuentan para el almacenamiento del plan.'))}
                    {mapSelect('contact_field_id', __('Vincular al contacto (lista de clientes)'), ['relation'], __('No vincular'), __('Se busca en la otra lista el contacto con el mismo correo.'))}
                    {draft.contact_field_id !== null && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="hd-contact-match">{__('Buscar el contacto por')}</Label>
                            <Select
                                id="hd-contact-match"
                                value={draft.contact_match_field_id === null ? '' : String(draft.contact_match_field_id)}
                                onChange={(e) => set('contact_match_field_id', numberOrNull(e.target.value))}
                            >
                                <option value="">{__('El primer campo de correo')}</option>
                                {fieldsOf(contactFields, ['email', 'text']).map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                            {errors.contact_match_field_id && <p className="imcrm-text-xs imcrm-text-destructive">{errors.contact_match_field_id}</p>}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-text-base">{__('Estados del ticket')}</CardTitle>
                    <CardDescription>{__('Con qué estado nace cada ticket, cuáles lo dejan esperando al cliente (el reloj del SLA se detiene) y cuáles lo cierran.')}</CardDescription>
                </CardHeader>
                <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        {mapSelect('status_field_id', __('Campo de estado'), ['select'], __('Sin estados'))}
                        {statusField && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="hd-initial">{__('Estado de un ticket nuevo')}</Label>
                                <Select id="hd-initial" value={draft.initial_status ?? ''} onChange={(e) => set('initial_status', e.target.value || null)}>
                                    <option value="">{__('Dejarlo vacío')}</option>
                                    {statusOptions.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        )}
                    </div>
                    {statusField && (
                        <>
                            <ChipGroup
                                label={__('Esperando al cliente (el reloj del SLA se detiene)')}
                                options={statusOptions}
                                selected={draft.paused_statuses}
                                onToggle={(v) => toggleIn('paused_statuses', v)}
                                testId="imcrm-hd-paused"
                            />
                            <ChipGroup
                                label={__('Cerrado (el ticket está resuelto)')}
                                options={statusOptions}
                                selected={draft.closed_statuses}
                                onToggle={(v) => toggleIn('closed_statuses', v)}
                                testId="imcrm-hd-closed"
                            />
                            <div className="imcrm-flex imcrm-max-w-sm imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="hd-reopen">{__('Si el cliente responde a un ticket cerrado o en espera, pasa a')}</Label>
                                <Select id="hd-reopen" value={draft.reopen_status ?? ''} onChange={(e) => set('reopen_status', e.target.value || null)}>
                                    <option value="">{__('No cambiar el estado')}</option>
                                    {statusOptions.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        </>
                    )}
                    {errors.initial_status && <p className="imcrm-text-xs imcrm-text-destructive">{errors.initial_status}</p>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-text-base">{__('Protecciones')}</CardTitle>
                    <CardDescription>
                        {__('Las respuestas automáticas («fuera de la oficina»), los rebotes, los envíos masivos y los correos de esta misma mesa de ayuda nunca crean tickets.')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor="hd-rate">{__('Tickets nuevos por remitente en una hora')}</Label>
                        <Input id="hd-rate" inputMode="numeric" value={String(draft.max_per_sender_hour)} onChange={(e) => set('max_per_sender_hour', Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} />
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor="hd-size">{__('Tamaño máximo de un correo (MB)')}</Label>
                        <Input id="hd-size" inputMode="numeric" value={String(draft.max_size_mb)} onChange={(e) => set('max_size_mb', Math.min(50, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))} />
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 sm:imcrm-col-span-2">
                        <Label htmlFor="hd-blocked">{__('Remitentes bloqueados (uno por línea; @dominio.com bloquea todo el dominio)')}</Label>
                        <Textarea id="hd-blocked" rows={3} value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder="spam@ejemplo.com&#10;@publicidad.com" />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                        <MessageSquareReply className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Respuestas guardadas')}
                    </CardTitle>
                    <CardDescription>{__('Textos que el equipo inserta al responder por correo desde la ficha. Antes de enviar se pueden editar.')}</CardDescription>
                </CardHeader>
                <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {templates.map((t, i) => (
                        <div key={t.id} className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid="imcrm-hd-template">
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <Input aria-label={__('Nombre de la respuesta')} value={t.name} onChange={(e) => setTemplate(i, { name: e.target.value })} />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={__('Quitar la respuesta')}
                                    onClick={() => set('reply_templates', templates.filter((_, j) => j !== i))}
                                >
                                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </div>
                            <Textarea aria-label={__('Texto de la respuesta')} rows={4} value={t.body} onChange={(e) => setTemplate(i, { body: e.target.value })} />
                        </div>
                    ))}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                                set('reply_templates', [
                                    ...templates,
                                    { id: `r${Date.now().toString(36)}`, name: __('Nueva respuesta'), body: __('Hola {{cliente.nombre}},\n\n') },
                                ])
                            }
                            disabled={templates.length >= 50}
                        >
                            <Plus className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Agregar respuesta')}
                        </Button>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Variables:')}{' '}
                            {REPLY_VARIABLES.map((v) => (
                                <code key={v.tag} title={v.label} className="imcrm-mr-1 imcrm-rounded imcrm-bg-muted imcrm-px-1">
                                    {v.tag}
                                </code>
                            ))}
                            {__('y cualquier campo del ticket, como {{prioridad}}.')}
                        </span>
                    </div>
                    <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input type="checkbox" className="imcrm-h-4 imcrm-w-4" checked={draft.include_signature} onChange={(e) => set('include_signature', e.target.checked)} />
                        <span className="imcrm-text-muted-foreground">{__('Agregar la firma de quien responde (Ajustes → Cuenta → Firma de email).')}</span>
                    </label>
                </CardContent>
            </Card>

            <div className="imcrm-sticky imcrm-bottom-2 imcrm-z-10 imcrm-flex imcrm-justify-end">
                <Button onClick={saveAll} disabled={update.isPending} className="imcrm-shadow-lg" data-testid="imcrm-hd-save-settings">
                    <Save className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4" />
                    {update.isPending ? __('Guardando…') : __('Guardar cambios')}
                </Button>
            </div>
        </div>
    );
}

export function ChipGroup({
    label,
    options,
    selected,
    onToggle,
    testId,
}: {
    label: string;
    options: Array<{ value: string; label: string }>;
    selected: readonly string[];
    onToggle: (value: string) => void;
    testId?: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid={testId}>
            <span className="imcrm-text-sm imcrm-font-medium">{label}</span>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                {options.length === 0 && <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('El campo no tiene opciones.')}</span>}
                {options.map((o) => {
                    const on = selected.includes(o.value);
                    return (
                        <button
                            key={o.value}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onToggle(o.value)}
                            className={cn(
                                'imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs imcrm-transition-colors',
                                on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-foreground' : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-muted/60',
                            )}
                        >
                            {o.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
