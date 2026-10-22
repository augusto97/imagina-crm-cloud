import { useState } from 'react';
import { Loader2, Mail, Pause, Pencil, Play, Plus, Send, Trash2, X } from 'lucide-react';
import {
    describeSubscription,
    SUBSCRIPTION_LAST_DAY,
    SUBSCRIPTION_MAX_RECIPIENTS,
    timeZoneLabel,
    type DashboardSubscription,
    type DashboardSubscriptionInput,
} from '@imagina-base/shared';

import { TimeZoneSelect } from '@/components/TimeZoneSelect';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { UserPicker } from '@/components/ui/user-picker';
import {
    useDashboardSubscriptions,
    useDeleteDashboardSubscription,
    useSaveDashboardSubscription,
    useSendDashboardSubscription,
    useTestDashboardSubscription,
} from '@/hooks/useDashboardSharing';
import { useMemberNames } from '@/hooks/useWpUsers';
import { ApiError } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { formatDateTimeStr, getTenantTimeZone } from '@/lib/tenantFormat';

const WEEKDAYS: Array<{ n: number; short: string; long: string }> = [
    { n: 1, short: 'L', long: 'lunes' },
    { n: 2, short: 'M', long: 'martes' },
    { n: 3, short: 'X', long: 'miércoles' },
    { n: 4, short: 'J', long: 'jueves' },
    { n: 5, short: 'V', long: 'viernes' },
    { n: 6, short: 'S', long: 'sábado' },
    { n: 7, short: 'D', long: 'domingo' },
];

/** Correos escritos en una caja (coma, punto y coma, espacios o renglones) → lista limpia. */
export function parseEmails(text: string): string[] {
    return [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

function emptyInput(): DashboardSubscriptionInput {
    const me = getBootData().user.id;
    return {
        enabled: true,
        frequency: 'weekly',
        weekdays: [1],
        month_day: 1,
        hour: 8,
        minute: 0,
        time_zone: null,
        recipient_user_ids: me ? [me] : [],
        recipient_emails: [],
        subject: '',
        message: '',
        attach_pdf: false,
    };
}

function errorText(err: unknown): string {
    return err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar.');
}

/**
 * v0.1.292 (ADR-S50) — Compartir → Envío por correo: un resumen del tablero
 * (KPIs y los valores principales de cada gráfico, PDF opcional) a una hora
 * fija, en la zona de la empresa.
 */
export function EmailSubscriptionsPanel({ dashboardId, dashboardName }: { dashboardId: number; dashboardName: string }): JSX.Element {
    const list = useDashboardSubscriptions(dashboardId, true);
    const [editing, setEditing] = useState<{ id: number | null; input: DashboardSubscriptionInput } | null>(null);

    if (editing) {
        return (
            <SubscriptionForm
                dashboardId={dashboardId}
                dashboardName={dashboardName}
                id={editing.id}
                initial={editing.input}
                onDone={() => setEditing(null)}
            />
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-subscriptions">
            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                {__('Un resumen del tablero por correo, cada día, semana o mes: los indicadores y los valores principales de cada gráfico, con un botón para abrirlo. Los datos son los que ve quien programa el envío.')}
            </p>
            {list.isLoading ? (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando…')}
                </div>
            ) : (list.data ?? []).length === 0 ? (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-sm imcrm-text-muted-foreground">
                    <Mail className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0" />
                    {__('Todavía no hay envíos programados de este tablero.')}
                </div>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {(list.data ?? []).map((s) => (
                        <SubscriptionRow key={s.id} dashboardId={dashboardId} sub={s} onEdit={() => setEditing({ id: s.id, input: inputOf(s) })} />
                    ))}
                </ul>
            )}
            <div>
                <Button type="button" size="sm" className="imcrm-gap-1.5" onClick={() => setEditing({ id: null, input: emptyInput() })} data-testid="imcrm-subscription-new">
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Programar un envío')}
                </Button>
            </div>
        </div>
    );
}

function inputOf(s: DashboardSubscription): DashboardSubscriptionInput {
    return {
        enabled: s.enabled,
        frequency: s.frequency,
        weekdays: s.weekdays,
        month_day: s.month_day,
        hour: s.hour,
        minute: s.minute,
        time_zone: s.time_zone,
        recipient_user_ids: s.recipient_user_ids,
        recipient_emails: s.recipient_emails,
        subject: s.subject,
        message: s.message,
        attach_pdf: s.attach_pdf,
    };
}

function SubscriptionRow({ dashboardId, sub, onEdit }: { dashboardId: number; sub: DashboardSubscription; onEdit: () => void }): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();
    const save = useSaveDashboardSubscription(dashboardId);
    const send = useSendDashboardSubscription(dashboardId);
    const remove = useDeleteDashboardSubscription(dashboardId);
    const recipients = sub.recipient_user_ids.length + sub.recipient_emails.length;
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-between" data-testid="imcrm-subscription-row">
            <div className="imcrm-min-w-0 imcrm-text-sm">
                <p className={cn('imcrm-font-medium', !sub.enabled && 'imcrm-text-muted-foreground')}>
                    {describeSubscription(sub)}
                    {!sub.enabled && <span className="imcrm-ml-2 imcrm-text-xs imcrm-font-normal">{__('(pausado)')}</span>}
                </p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(recipients === 1 ? __('%d destinatario') : __('%d destinatarios'), recipients)}
                    {' · '}
                    {timeZoneLabel(sub.effective_time_zone)}
                    {sub.attach_pdf ? ` · ${__('con PDF')}` : ''}
                    {' · '}
                    {sprintf(__('de %s'), sub.owner.name)}
                </p>
                {sub.last_status && (
                    <p className={cn('imcrm-text-xs', sub.last_status === 'failed' ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground')}>
                        {sub.last_status === 'sent' && sub.last_sent_at
                            ? sprintf(__('Último envío: %s'), formatDateTimeStr(sub.last_sent_at))
                            : sub.last_status === 'failed'
                              ? sprintf(__('Falló: %s'), sub.last_error ?? '')
                              : sprintf(__('No se envió: %s'), sub.last_error ?? '')}
                    </p>
                )}
            </div>
            {sub.can_edit && (
                <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-gap-1">
                    <Button type="button" variant="ghost" size="sm" className="imcrm-h-8 imcrm-gap-1" onClick={onEdit} title={__('Editar')}>
                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                        <span className="imcrm-sr-only sm:imcrm-not-sr-only">{__('Editar')}</span>
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="imcrm-h-8 imcrm-gap-1"
                        disabled={send.isPending}
                        title={__('Enviar ahora a todos los destinatarios')}
                        onClick={() =>
                            void send.mutateAsync(sub.id).then(
                                (r) => (r.status === 'sent' ? toast.success(sprintf(__('Enviado a %d destinatarios'), r.sent_to.length)) : toast.error(r.error ?? __('No se pudo enviar.'))),
                                (err: unknown) => toast.error(errorText(err)),
                            )
                        }
                        data-testid="imcrm-subscription-send"
                    >
                        {send.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Send className="imcrm-h-3.5 imcrm-w-3.5" />}
                        <span className="imcrm-sr-only sm:imcrm-not-sr-only">{__('Enviar ahora')}</span>
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="imcrm-h-8"
                        title={sub.enabled ? __('Pausar') : __('Reanudar')}
                        aria-label={sub.enabled ? __('Pausar') : __('Reanudar')}
                        onClick={() => void save.mutateAsync({ sid: sub.id, input: { ...inputOf(sub), enabled: !sub.enabled } }).catch((err: unknown) => toast.error(errorText(err)))}
                    >
                        {sub.enabled ? <Pause className="imcrm-h-3.5 imcrm-w-3.5" /> : <Play className="imcrm-h-3.5 imcrm-w-3.5" />}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="imcrm-h-8 imcrm-text-destructive hover:imcrm-text-destructive"
                        title={__('Eliminar')}
                        aria-label={__('Eliminar')}
                        onClick={() => {
                            void (async () => {
                                const ok = await confirm({ title: __('Eliminar el envío programado'), description: __('No se enviará más.'), destructive: true, confirmLabel: __('Eliminar') });
                                if (ok) await remove.mutateAsync(sub.id).catch((err: unknown) => toast.error(errorText(err)));
                            })();
                        }}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
            )}
        </li>
    );
}

function SubscriptionForm({
    dashboardId,
    dashboardName,
    id,
    initial,
    onDone,
}: {
    dashboardId: number;
    dashboardName: string;
    id: number | null;
    initial: DashboardSubscriptionInput;
    onDone: () => void;
}): JSX.Element {
    const toast = useToast();
    const save = useSaveDashboardSubscription(dashboardId);
    const test = useTestDashboardSubscription(dashboardId);
    const [v, setV] = useState<DashboardSubscriptionInput>(initial);
    const [emails, setEmails] = useState(initial.recipient_emails.join(', '));
    const [error, setError] = useState<string | null>(null);
    const names = useMemberNames(v.recipient_user_ids);
    const tenantTz = getTenantTimeZone();
    const set = (patch: Partial<DashboardSubscriptionInput>): void => setV((prev) => ({ ...prev, ...patch }));
    const value = (): DashboardSubscriptionInput => ({ ...v, recipient_emails: parseEmails(emails) });
    const total = v.recipient_user_ids.length + parseEmails(emails).length;
    const time = `${String(v.hour).padStart(2, '0')}:${String(v.minute).padStart(2, '0')}`;

    const submit = async (): Promise<void> => {
        setError(null);
        try {
            await save.mutateAsync({ sid: id, input: value() });
            toast.success(id === null ? __('Envío programado') : __('Envío actualizado'));
            onDone();
        } catch (err) {
            setError(errorText(err));
        }
    };

    return (
        <form
            className="imcrm-flex imcrm-flex-col imcrm-gap-4"
            onSubmit={(e) => {
                e.preventDefault();
                void submit();
            }}
            data-testid="imcrm-subscription-form"
        >
            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="sub-freq">{__('Frecuencia')}</Label>
                    <Select id="sub-freq" value={v.frequency} onChange={(e) => set({ frequency: e.target.value as DashboardSubscriptionInput['frequency'] })} data-testid="imcrm-subscription-frequency">
                        <option value="daily">{__('Todos los días')}</option>
                        <option value="weekly">{__('Cada semana')}</option>
                        <option value="monthly">{__('Cada mes')}</option>
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="sub-time">{__('Hora')}</Label>
                    <Input
                        id="sub-time"
                        type="time"
                        value={time}
                        onChange={(e) => {
                            const [h, m] = e.target.value.split(':');
                            if (h !== undefined && m !== undefined) set({ hour: Number(h), minute: Number(m) });
                        }}
                        data-testid="imcrm-subscription-time"
                    />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="sub-tz">{__('Zona horaria')}</Label>
                    <TimeZoneSelect
                        id="sub-tz"
                        value={v.time_zone}
                        onChange={(tz) => set({ time_zone: tz })}
                        emptyLabel={tenantTz ? sprintf(__('La de la empresa (%s)'), timeZoneLabel(tenantTz)) : __('La de la empresa (sin elegir: UTC)')}
                    />
                </div>
            </div>

            {v.frequency === 'weekly' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Días')}</Label>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1" role="group" aria-label={__('Días de la semana')}>
                        {WEEKDAYS.map((d) => {
                            const on = v.weekdays.includes(d.n);
                            return (
                                <button
                                    key={d.n}
                                    type="button"
                                    aria-pressed={on}
                                    title={d.long}
                                    onClick={() => set({ weekdays: on ? v.weekdays.filter((x) => x !== d.n) : [...v.weekdays, d.n].sort((a, b) => a - b) })}
                                    className={cn(
                                        'imcrm-h-8 imcrm-w-8 imcrm-rounded-md imcrm-border imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                        on ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border-border hover:imcrm-bg-accent',
                                    )}
                                >
                                    {d.short}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            {v.frequency === 'monthly' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 sm:imcrm-w-1/3">
                    <Label htmlFor="sub-day">{__('Día del mes')}</Label>
                    <Select id="sub-day" value={String(v.month_day)} onChange={(e) => set({ month_day: Number(e.target.value) })}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                        <option value={SUBSCRIPTION_LAST_DAY}>{__('El último día')}</option>
                    </Select>
                </div>
            )}
            <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-subscription-summary">
                {describeSubscription(v)}
            </p>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Personas del equipo')}</Label>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                    {v.recipient_user_ids.map((uid) => (
                        <span key={uid} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-muted/50 imcrm-py-0.5 imcrm-pl-2.5 imcrm-pr-1 imcrm-text-xs">
                            {names.data?.get(uid) ?? sprintf(__('Usuario %d'), uid)}
                            <button
                                type="button"
                                className="imcrm-rounded-full imcrm-p-0.5 hover:imcrm-bg-accent"
                                aria-label={__('Quitar')}
                                onClick={() => set({ recipient_user_ids: v.recipient_user_ids.filter((x) => x !== uid) })}
                            >
                                <X className="imcrm-h-3 imcrm-w-3" />
                            </button>
                        </span>
                    ))}
                    <div className="imcrm-min-w-[12rem]">
                        <UserPicker
                            value={null}
                            placeholder={__('Agregar una persona…')}
                            onChange={(uid) => {
                                if (uid !== null && !v.recipient_user_ids.includes(uid)) set({ recipient_user_ids: [...v.recipient_user_ids, uid] });
                            }}
                        />
                    </div>
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Tienen que poder ver el tablero.')}</p>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="sub-emails">{__('Correos externos (opcional)')}</Label>
                <Input
                    id="sub-emails"
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    placeholder="socio@empresa.com, contador@estudio.com"
                    data-testid="imcrm-subscription-emails"
                />
                <p className={cn('imcrm-text-xs', total > SUBSCRIPTION_MAX_RECIPIENTS ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground')}>
                    {sprintf(__('%1$d de %2$d destinatarios. Cada uno recibe su propio correo (nadie ve los demás) y cuenta para la cuota de correos del plan.'), total, SUBSCRIPTION_MAX_RECIPIENTS)}
                </p>
            </div>

            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="sub-subject">{__('Asunto')}</Label>
                    <Input id="sub-subject" value={v.subject} onChange={(e) => set({ subject: e.target.value })} placeholder={sprintf(__('Resumen de «%s»'), dashboardName)} maxLength={200} />
                </div>
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm sm:imcrm-pt-6">
                    <input type="checkbox" className="imcrm-mt-0.5" checked={v.attach_pdf} onChange={(e) => set({ attach_pdf: e.target.checked })} data-testid="imcrm-subscription-pdf" />
                    <span>
                        {__('Adjuntar el tablero en PDF')}
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Los gráficos dibujados, para imprimir o archivar.')}</span>
                    </span>
                </label>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="sub-message">{__('Mensaje (opcional)')}</Label>
                <Textarea id="sub-message" rows={2} value={v.message} onChange={(e) => set({ message: e.target.value })} maxLength={2000} />
            </div>
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                <input type="checkbox" checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                {__('Activo')}
            </label>

            {error && <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-subscription-error">{error}</p>}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="imcrm-gap-1.5"
                    disabled={test.isPending}
                    onClick={() => {
                        setError(null);
                        void test.mutateAsync(value()).then(
                            (r) =>
                                r.status === 'sent'
                                    ? toast.success(sprintf(__('Te enviamos una prueba a %s'), r.sent_to.join(', ')))
                                    : setError(r.error ?? __('No se pudo enviar la prueba.')),
                            (err: unknown) => setError(errorText(err)),
                        );
                    }}
                    data-testid="imcrm-subscription-test"
                >
                    {test.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Send className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {__('Enviarme una prueba ahora')}
                </Button>
                <div className="imcrm-flex imcrm-gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onDone}>
                        {__('Cancelar')}
                    </Button>
                    <Button type="submit" size="sm" disabled={save.isPending || total === 0 || total > SUBSCRIPTION_MAX_RECIPIENTS} data-testid="imcrm-subscription-save">
                        {save.isPending && <Loader2 className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                        {id === null ? __('Programar') : __('Guardar')}
                    </Button>
                </div>
            </div>
        </form>
    );
}
