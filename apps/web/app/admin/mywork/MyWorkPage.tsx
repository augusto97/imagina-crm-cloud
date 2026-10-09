import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlarmClock, Bell, Check, Eye, EyeOff, ListChecks, Loader2, Plus, Trash2, X } from 'lucide-react';
import type { MyWorkItem, ReminderDto } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { OptionChip } from '@/admin/records/renderCellValue';
import { IconSquare } from '@/admin/lists/FolderBadge';
import { useDeleteReminder, useMyWork, useSetFollow, useUpdateReminder } from '@/hooks/useNotifications';
import { __, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { browserTimeZone, formatDateStr, formatDateTime, formatDateTimeStr, getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { DUE_GROUPS, groupWork } from './myWorkGroups';
import { ReminderForm } from './ReminderForm';

type Tab = 'assigned' | 'reminders' | 'following';

/**
 * v0.1.276 (ADR-S40) — «Mi trabajo»: lo que la persona tiene asignado en
 * TODAS las listas (por los campos Persona), agrupado por vencimiento, sus
 * recordatorios y los registros que sigue. Una sola request (`/me/work`), con
 * el ACL de cada lista aplicado en el servidor.
 */
export function MyWorkPage(): JSX.Element {
    const [params, setParams] = useSearchParams();
    const tab: Tab = params.get('tab') === 'reminders' ? 'reminders' : params.get('tab') === 'following' ? 'following' : 'assigned';
    const work = useMyWork();
    const tz = getTenantTimeZone() ?? browserTimeZone() ?? 'UTC';
    const groups = useMemo(() => groupWork(work.data?.assigned ?? [], tz), [work.data, tz]);

    const setTab = (t: Tab): void => {
        const next = new URLSearchParams(params);
        if (t === 'assigned') next.delete('tab');
        else next.set('tab', t);
        setParams(next, { replace: true });
    };

    const counts = {
        assigned: work.data?.assigned.length ?? 0,
        reminders: work.data?.reminders.length ?? 0,
        following: work.data?.following.length ?? 0,
    };

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-4xl imcrm-flex-col imcrm-gap-4 imcrm-py-2" data-testid="my-work">
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-justify-between imcrm-gap-2">
                <div>
                    <h1 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold">
                        <ListChecks className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                        {__('Mi trabajo')}
                    </h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Lo que tenés asignado en todas las listas, tus recordatorios y lo que seguís.')}
                    </p>
                </div>
                <Link to="/settings?s=avisos" className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground">
                    <Bell className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Avisos y resumen diario')}
                </Link>
            </header>

            <div role="tablist" className="imcrm-flex imcrm-gap-1 imcrm-overflow-x-auto imcrm-border-b imcrm-border-border">
                {(
                    [
                        ['assigned', __('Asignado a mí'), ListChecks],
                        ['reminders', __('Recordatorios'), AlarmClock],
                        ['following', __('Siguiendo'), Eye],
                    ] as const
                ).map(([key, label, Icon]) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => setTab(key)}
                        className={cn(
                            '-imcrm-mb-px imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-border-b-2 imcrm-px-3 imcrm-py-2 imcrm-text-sm',
                            tab === key ? 'imcrm-border-primary imcrm-font-medium' : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                        data-testid={`my-work-tab-${key}`}
                    >
                        <Icon className="imcrm-h-4 imcrm-w-4" />
                        {label}
                        {work.data && <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">{counts[key]}</span>}
                    </button>
                ))}
            </div>

            {work.isLoading ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando…')}
                </p>
            ) : work.isError ? (
                <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar tu trabajo.')}</p>
            ) : tab === 'assigned' ? (
                counts.assigned === 0 ? (
                    <Empty
                        icon={ListChecks}
                        title={__('No tenés nada asignado')}
                        text={
                            (work.data?.lists_with_assignee ?? 0) === 0
                                ? __('Para asignar registros, una lista necesita un campo de tipo Persona (por ejemplo «Responsable»).')
                                : __('Cuando alguien te ponga como responsable de un registro, aparece acá.')
                        }
                    />
                ) : (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                        {DUE_GROUPS.map((g) => {
                            const items = groups.get(g.key) ?? [];
                            if (items.length === 0) return null;
                            return (
                                <section key={g.key} data-due-group={g.key}>
                                    <h2
                                        className={cn(
                                            'imcrm-mb-1.5 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide',
                                            g.key === 'overdue' ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground',
                                        )}
                                    >
                                        {__(g.label)}
                                        <span className="imcrm-font-normal">{items.length}</span>
                                    </h2>
                                    <Card>
                                        <ul className="imcrm-divide-y imcrm-divide-border">
                                            {items.map((i) => (
                                                <WorkRow key={`${i.list_id}:${i.record_id}`} item={i} overdue={g.key === 'overdue'} />
                                            ))}
                                        </ul>
                                    </Card>
                                </section>
                            );
                        })}
                        {work.data?.truncated && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Se muestran los primeros resultados de cada lista.')}</p>
                        )}
                    </div>
                )
            ) : tab === 'reminders' ? (
                <RemindersTab reminders={work.data?.reminders ?? []} />
            ) : counts.following === 0 ? (
                <Empty
                    icon={Eye}
                    title={__('No seguís ningún registro')}
                    text={__('Seguís automáticamente lo que creás, comentás o te asignan. Desde la ficha de un registro también podés tocar «Seguir».')}
                />
            ) : (
                <Card>
                    <ul className="imcrm-divide-y imcrm-divide-border">
                        {work.data!.following.map((i) => (
                            <WorkRow key={`${i.list_id}:${i.record_id}`} item={i} following />
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}

function Empty({ icon: Icon, title, text }: { icon: typeof Bell; title: string; text: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-6 imcrm-py-12 imcrm-text-center">
            <Icon className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground" />
            <p className="imcrm-text-sm imcrm-font-medium">{title}</p>
            <p className="imcrm-max-w-md imcrm-text-xs imcrm-text-muted-foreground">{text}</p>
        </div>
    );
}

function WorkRow({ item, overdue = false, following = false }: { item: MyWorkItem; overdue?: boolean; following?: boolean }): JSX.Element {
    const unfollow = useSetFollow(item.list_id, item.record_id);
    const due = item.due ? (item.due_is_datetime ? formatDateTimeStr(item.due) : formatDateStr(item.due.slice(0, 10))) : null;
    return (
        <li className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-work-item={item.record_id}>
            <IconSquare icon={listIcon(item.list_icon) ?? DEFAULT_LIST_ICON} color={listColor(item.list_color)} size="sm" />
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <Link to={`/lists/${item.list_slug}/records/${item.record_id}`} className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium hover:imcrm-underline">
                    {item.title}
                </Link>
                <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{item.list_name}</p>
            </div>
            {item.status_label && (
                <span className="imcrm-hidden sm:imcrm-inline-flex">
                    <OptionChip opt={{ value: item.status_label, label: item.status_label, color: item.status_color ?? undefined } as never} fallback={item.status_label} />
                </span>
            )}
            {due && (
                <span
                    className={cn('imcrm-shrink-0 imcrm-text-xs imcrm-tabular-nums', overdue ? 'imcrm-font-medium imcrm-text-destructive' : 'imcrm-text-muted-foreground')}
                    title={item.due_label ?? undefined}
                >
                    {due}
                </span>
            )}
            {following && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="imcrm-h-7 imcrm-w-7"
                    aria-label={__('Dejar de seguir')}
                    title={__('Dejar de seguir')}
                    disabled={unfollow.isPending}
                    onClick={() => unfollow.mutate(false)}
                >
                    <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
            )}
        </li>
    );
}

function RemindersTab({ reminders }: { reminders: ReminderDto[] }): JSX.Element {
    const [adding, setAdding] = useState(false);
    const update = useUpdateReminder();
    const remove = useDeleteReminder();
    const toast = useToast();
    const now = Date.now();
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {adding ? (
                <Card>
                    <CardContent className="imcrm-pt-4">
                        <div className="imcrm-mb-2 imcrm-flex imcrm-items-center imcrm-justify-between">
                            <p className="imcrm-text-sm imcrm-font-medium">{__('Nuevo recordatorio')}</p>
                            <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Cerrar')} onClick={() => setAdding(false)}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </div>
                        <ReminderForm onDone={() => setAdding(false)} />
                    </CardContent>
                </Card>
            ) : (
                <Button variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={() => setAdding(true)} data-testid="reminder-new">
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Nuevo recordatorio')}
                </Button>
            )}
            {reminders.length === 0 ? (
                <Empty
                    icon={AlarmClock}
                    title={__('No tenés recordatorios')}
                    text={__('Creá uno acá o desde la ficha de un registro con «Recordarme». Te llega a la bandeja (y por correo, si lo tenés encendido).')}
                />
            ) : (
                <Card>
                    <ul className="imcrm-divide-y imcrm-divide-border">
                        {reminders.map((r) => {
                            const past = new Date(r.remind_at).getTime() <= now;
                            return (
                                <li key={r.id} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-reminder={r.id}>
                                    <button
                                        type="button"
                                        aria-label={__('Marcar como hecho')}
                                        title={__('Marcar como hecho')}
                                        onClick={() =>
                                            update.mutate(
                                                { id: r.id, body: { done: true } },
                                                { onSuccess: () => toast.success(__('Listo')) },
                                            )
                                        }
                                        className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border imcrm-border-border hover:imcrm-border-primary hover:imcrm-bg-primary/10"
                                    >
                                        <Check className="imcrm-h-3 imcrm-w-3 imcrm-opacity-0 hover:imcrm-opacity-100" />
                                    </button>
                                    <div className="imcrm-min-w-0 imcrm-flex-1">
                                        <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">
                                            {r.record_id && r.list_slug ? (
                                                <Link to={`/lists/${r.list_slug}/records/${r.record_id}`} className="hover:imcrm-underline">
                                                    {r.record_title ?? sprintf(__('Registro #%d'), r.record_id)}
                                                </Link>
                                            ) : (
                                                r.note || __('Recordatorio')
                                            )}
                                        </p>
                                        <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {[r.record_id ? r.note : '', r.list_name].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                    <span className={cn('imcrm-shrink-0 imcrm-text-xs imcrm-tabular-nums', past ? 'imcrm-font-medium imcrm-text-destructive' : 'imcrm-text-muted-foreground')}>
                                        {formatDateTime(new Date(r.remind_at))}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="imcrm-h-7 imcrm-w-7"
                                        aria-label={__('Eliminar')}
                                        onClick={() => remove.mutate(r.id)}
                                    >
                                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                </Card>
            )}
        </div>
    );
}
