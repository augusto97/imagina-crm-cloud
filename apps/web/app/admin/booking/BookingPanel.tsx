import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, CalendarClock, ExternalLink, Link2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { readStoreListMarker } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { __ } from '@/lib/i18n';

import { bookingPublicUrl, useBookingPages, useCreateBookingPage, useDeleteBookingPage, useUpdateBookingPage } from './useBookingPages';

const BookingBuilder = lazy(() => import('./BookingBuilder'));

/**
 * D5 — Ajustes de la lista → Agenda. Cada página es un enlace público donde
 * el cliente elige servicio, quién lo atiende, día y hora libres; la cita cae
 * como un registro de esta lista. Se arma en el constructor a pantalla
 * completa. `?page=<id>` la abre directo (el enlace que deja el asistente).
 */
export function BookingPanel({ listId, listName, listSettings }: { listId: number; listName: string; listSettings: unknown }): JSX.Element {
    const pages = useBookingPages(listId);
    const fields = useFields(listId);
    const create = useCreateBookingPage(listId);
    const update = useUpdateBookingPage(listId);
    const remove = useDeleteBookingPage(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const [editingId, setEditingId] = useState<number | null>(null);
    const [params, setParams] = useSearchParams();
    const pageParam = Number(params.get('page'));
    useEffect(() => {
        if (!Number.isInteger(pageParam) || pageParam <= 0) return;
        setEditingId(pageParam);
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('page');
                return next;
            },
            { replace: true },
        );
    }, [pageParam, setParams]);

    // Las listas que llena una tienda no aceptan altas desde la app.
    if (readStoreListMarker(listSettings)) {
        return (
            <Card>
                <CardContent className="imcrm-pt-5 imcrm-text-sm imcrm-text-muted-foreground" data-testid="booking-store-managed">
                    {__('Esta lista la llena la tienda en línea: los registros nuevos se crean allá, así que no puede tener una agenda.')}
                </CardContent>
            </Card>
        );
    }

    const list = pages.data ?? [];
    const editing = editingId !== null ? (list.find((p) => p.id === editingId) ?? null) : null;

    const createNew = (): void => {
        create.mutate(
            { name: list.length === 0 ? `${__('Agenda de')} ${listName}` : `${__('Agenda')} ${list.length + 1}` },
            {
                onSuccess: (page) => setEditingId(page.id),
                onError: (err) => toast.error(__('No se pudo crear'), err instanceof Error ? err.message : String(err)),
            },
        );
    };

    const copyLink = (url: string): void => {
        void navigator.clipboard.writeText(url).then(
            () => toast.success(__('Enlace copiado')),
            () => toast.error(__('No se pudo copiar')),
        );
    };

    return (
        <Card>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-5" data-testid="booking-panel">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <p className="imcrm-max-w-xl imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Comparte el enlace o insértalo en tu sitio: tus clientes eligen el servicio, el día y la hora que les quedan bien, y cada cita llega como un registro con su correo de confirmación y sus recordatorios.')}
                    </p>
                    <Button size="sm" className="imcrm-gap-1.5" onClick={createNew} disabled={create.isPending} data-testid="booking-new">
                        {create.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Nueva agenda')}
                    </Button>
                </div>

                {pages.isLoading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando…')}
                    </p>
                ) : list.length === 0 ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center">
                        <CalendarClock className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground" />
                        <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay una agenda')}</p>
                        <p className="imcrm-max-w-sm imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Arranca con un servicio y contigo atendiendo de lunes a viernes; ajusta los horarios y publícala.')}
                        </p>
                        <Button size="sm" variant="outline" onClick={createNew} disabled={create.isPending}>
                            {__('Crear la primera')}
                        </Button>
                    </div>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                        {list.map((p) => {
                            const url = bookingPublicUrl(p);
                            const services = p.config.services.filter((s) => s.active).length;
                            return (
                                <li key={p.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-booking-page={p.id}>
                                    <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                                        <CalendarClock className="imcrm-h-4 imcrm-w-4" />
                                    </span>
                                    <div className="imcrm-min-w-0 imcrm-flex-1">
                                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                            <span className="imcrm-truncate">{p.name}</span>
                                            <span
                                                className={
                                                    p.enabled
                                                        ? 'imcrm-shrink-0 imcrm-rounded imcrm-bg-success/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-success'
                                                        : 'imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground'
                                                }
                                                data-booking-status
                                            >
                                                {p.enabled ? __('Publicada') : __('Sin publicar')}
                                            </span>
                                            {p.problems.length > 0 && (
                                                <span title={p.problems.join(' ')} className="imcrm-text-warning">
                                                    <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5" aria-label={__('Le falta algo para publicarla')} />
                                                </span>
                                            )}
                                        </p>
                                        <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground" data-booking-counts>
                                            {services} {services === 1 ? __('servicio') : __('servicios')} · {p.upcoming_count}{' '}
                                            {p.upcoming_count === 1 ? __('cita próxima') : __('citas próximas')} · {p.bookings_count}{' '}
                                            {p.bookings_count === 1 ? __('reserva en total') : __('reservas en total')}
                                            {p.last_booked_at && ` · ${__('última')} ${formatDateTimeStr(p.last_booked_at)}`}
                                        </p>
                                    </div>
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                        <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setEditingId(p.id)} data-booking-edit>
                                            <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Editar')}
                                        </Button>
                                        {p.enabled ? (
                                            <>
                                                <Button variant="ghost" size="icon" aria-label={__('Copiar enlace')} title={__('Copiar enlace')} onClick={() => copyLink(url)}>
                                                    <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" aria-label={__('Abrir')} title={__('Abrir la agenda')} asChild>
                                                    <a href={url} target="_blank" rel="noreferrer">
                                                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    </a>
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={p.problems.length > 0 || update.isPending}
                                                title={p.problems[0]}
                                                onClick={() =>
                                                    update.mutate(
                                                        { id: p.id, body: { enabled: true } },
                                                        {
                                                            onSuccess: () => toast.success(__('Agenda publicada')),
                                                            onError: (err) => toast.error(__('No se pudo publicar'), err instanceof Error ? err.message : String(err)),
                                                        },
                                                    )
                                                }
                                            >
                                                {__('Publicar')}
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={__('Eliminar')}
                                            onClick={() =>
                                                void confirm({
                                                    title: __('¿Eliminar la agenda?'),
                                                    description: `«${p.name}». ${__('El enlace deja de funcionar. Las citas que ya llegaron se conservan como registros, pero sus enlaces para cambiar o cancelar dejan de servir.')}`,
                                                    confirmLabel: __('Eliminar'),
                                                    destructive: true,
                                                }).then((ok) => {
                                                    if (!ok) return;
                                                    remove.mutate(p.id, {
                                                        onSuccess: () => toast.success(__('Agenda eliminada')),
                                                        onError: (err) => toast.error(__('No se pudo eliminar'), err instanceof Error ? err.message : String(err)),
                                                    });
                                                })
                                            }
                                        >
                                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>

            {editing && (
                <Suspense fallback={null}>
                    <BookingBuilder open onOpenChange={(o) => !o && setEditingId(null)} listId={listId} page={editing} fields={fields.data ?? []} />
                </Suspense>
            )}
        </Card>
    );
}
