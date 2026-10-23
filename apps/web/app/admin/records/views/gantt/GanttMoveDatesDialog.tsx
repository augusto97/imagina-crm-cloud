import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { addDaysToDateValue, dateValueForDay, dayOfDateValue, dayToYmd, ymdToDay } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { __ } from '@/lib/i18n';
import { getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

interface GanttMoveDatesDialogProps {
    record: RecordEntity | null;
    title: string;
    startField: FieldEntity;
    endField: FieldEntity | null;
    onOpenChange: (open: boolean) => void;
    /** Guarda sólo lo que cambió (el patch por slug). */
    onSave: (record: RecordEntity, patch: Record<string, unknown>) => void;
    /** Motivo por el que no se puede (permiso, columna de la tienda). */
    lockedReason?: string | null;
}

function dayInput(field: FieldEntity, value: unknown): string {
    const day = dayOfDateValue(field.type, value, getTenantTimeZone() ?? undefined);
    return day === null ? '' : dayToYmd(day);
}

/**
 * «Mover fechas…» (B1): en el teléfono las barras no se arrastran (el dedo
 * scrollea); se tocan y se eligen las fechas con el selector del sistema. En
 * escritorio sale del menú de la barra (click derecho) para fijar un día
 * exacto. Una fecha con hora conserva su hora al cambiar de día.
 */
export function GanttMoveDatesDialog({ record, title, startField, endField, onOpenChange, onSave, lockedReason }: GanttMoveDatesDialogProps): JSX.Element {
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!record) return;
        setStart(dayInput(startField, record.fields[startField.slug]));
        setEnd(endField ? dayInput(endField, record.fields[endField.slug]) : '');
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record?.id]);

    const valueFor = (field: FieldEntity, raw: unknown, ymd: string): unknown => {
        if (ymd === '') return null;
        const day = ymdToDay(ymd);
        if (day === null) return raw;
        const current = typeof raw === 'string' && raw !== '' ? raw : null;
        if (!current) return dateValueForDay(field.type, day);
        const before = dayOfDateValue(field.type, current, getTenantTimeZone() ?? undefined);
        return before === null ? dateValueForDay(field.type, day) : addDaysToDateValue(field.type, current, day - before);
    };

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        if (!record) return;
        if (start !== '' && end !== '' && end < start) {
            setError(__('El fin no puede quedar antes del inicio.'));
            return;
        }
        const patch: Record<string, unknown> = {};
        const s = valueFor(startField, record.fields[startField.slug], start);
        if (s !== (record.fields[startField.slug] ?? null)) patch[startField.slug] = s;
        if (endField) {
            const v = valueFor(endField, record.fields[endField.slug], end);
            if (v !== (record.fields[endField.slug] ?? null)) patch[endField.slug] = v;
        }
        if (Object.keys(patch).length > 0) onSave(record, patch);
        onOpenChange(false);
    };

    return (
        <Dialog.Root open={record !== null} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-sm',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-gantt-move-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Mover fechas')}</Dialog.Title>
                            <Dialog.Description className="imcrm-truncate imcrm-text-sm imcrm-text-muted-foreground">{title}</Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    {lockedReason ? (
                        <p className="imcrm-mt-4 imcrm-text-sm imcrm-text-muted-foreground">{lockedReason}</p>
                    ) : (
                        <form onSubmit={submit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="gantt-move-start">{startField.label}</Label>
                                <Input id="gantt-move-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                            </div>
                            {endField && (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <Label htmlFor="gantt-move-end">{endField.label}</Label>
                                    <Input id="gantt-move-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                                </div>
                            )}
                            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                                <Dialog.Close asChild>
                                    <Button type="button" variant="outline">
                                        {__('Cancelar')}
                                    </Button>
                                </Dialog.Close>
                                <Button type="submit" data-testid="gantt-move-save">
                                    {__('Guardar')}
                                </Button>
                            </div>
                        </form>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
