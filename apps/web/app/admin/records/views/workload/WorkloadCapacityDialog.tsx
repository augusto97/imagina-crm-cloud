import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { WORKLOAD_DEFAULT_CAPACITY, workloadCapacitySchema, type WorkloadCapacity } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSetWorkloadCapacity } from '@/hooks/useWorkload';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { DAY_LABELS_LONG, DAY_LABELS_SHORT, workDaysLabel } from './workloadModel';

interface WorkloadCapacityDialogProps {
    person: { user_id: number; name: string; capacity: WorkloadCapacity; capacity_custom: boolean } | null;
    onOpenChange: (open: boolean) => void;
    /** Avisa con la capacidad guardada (la vista la usa para el aviso). */
    onSaved?: (capacity: WorkloadCapacity, custom: boolean) => void;
}

/** Lunes primero, como el resto de la carga. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * B2 — «Capacidad» de una persona: horas por día y días laborables (para el
 * esfuerzo y el tiempo) y registros por semana (para la cantidad). Vale para
 * todas las vistas de carga del workspace. La editan admin y manager.
 */
export function WorkloadCapacityDialog({ person, onOpenChange, onSaved }: WorkloadCapacityDialogProps): JSX.Element {
    const save = useSetWorkloadCapacity();
    const [hours, setHours] = useState('8');
    const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [perWeek, setPerWeek] = useState('10');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!person) return;
        setHours(String(person.capacity.hours_per_day).replace('.', ','));
        setDays([...person.capacity.work_days]);
        setPerWeek(String(person.capacity.records_per_week));
        setError(null);
        save.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [person?.user_id]);

    const submit = async (capacity: WorkloadCapacity | null): Promise<void> => {
        if (!person) return;
        setError(null);
        try {
            const res = await save.mutateAsync({ userId: person.user_id, capacity });
            onSaved?.(res.capacity, res.capacity_custom);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        const parsed = workloadCapacitySchema.safeParse({
            hours_per_day: Number(hours.replace(',', '.')),
            work_days: days,
            records_per_week: Number(perWeek),
        });
        if (!parsed.success) {
            setError(__('Revisa los valores: de 0 a 24 horas por día y de 0 a 1000 registros por semana.'));
            return;
        }
        void submit(parsed.data);
    };

    const toggleDay = (d: number): void => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

    return (
        <Dialog.Root open={person !== null} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-sm',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="workload-capacity-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {sprintf(__('Capacidad de %s'), person?.name ?? '')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Cuánto trabajo puede tomar esta persona. Vale para todas las vistas de carga de la empresa.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="capacity-hours">{__('Horas por día')}</Label>
                            <Input
                                id="capacity-hours"
                                inputMode="decimal"
                                value={hours}
                                onChange={(e) => setHours(e.target.value)}
                                data-testid="capacity-hours"
                            />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <span className="imcrm-text-sm imcrm-font-medium">{__('Días laborables')}</span>
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1" role="group" aria-label={__('Días laborables')}>
                                {DAY_ORDER.map((d) => {
                                    const on = days.includes(d);
                                    return (
                                        <button
                                            key={d}
                                            type="button"
                                            aria-pressed={on}
                                            aria-label={DAY_LABELS_LONG[d]}
                                            onClick={() => toggleDay(d)}
                                            className={cn(
                                                'imcrm-h-8 imcrm-w-8 imcrm-rounded-md imcrm-border imcrm-text-xs imcrm-font-semibold imcrm-transition-colors',
                                                on
                                                    ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground'
                                                    : 'imcrm-border-border imcrm-bg-background imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                            )}
                                            data-testid={`capacity-day-${d}`}
                                        >
                                            {DAY_LABELS_SHORT[d]}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{workDaysLabel(days)}</p>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="capacity-records">{__('Registros por semana')}</Label>
                            <Input
                                id="capacity-records"
                                inputMode="numeric"
                                value={perWeek}
                                onChange={(e) => setPerWeek(e.target.value)}
                                data-testid="capacity-records"
                            />
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Para medir por cantidad de registros.')}</p>
                        </div>

                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </div>
                        )}

                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                            {person?.capacity_custom ? (
                                <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={() => void submit(null)}>
                                    {sprintf(
                                        __('Volver a %1$s h, %2$s'),
                                        String(WORKLOAD_DEFAULT_CAPACITY.hours_per_day),
                                        workDaysLabel(WORKLOAD_DEFAULT_CAPACITY.work_days),
                                    )}
                                </Button>
                            ) : (
                                <span />
                            )}
                            <div className="imcrm-flex imcrm-gap-2">
                                <Dialog.Close asChild>
                                    <Button type="button" variant="outline">
                                        {__('Cancelar')}
                                    </Button>
                                </Dialog.Close>
                                <Button type="submit" disabled={save.isPending} data-testid="capacity-save">
                                    {save.isPending ? __('Guardando…') : __('Guardar')}
                                </Button>
                            </div>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
