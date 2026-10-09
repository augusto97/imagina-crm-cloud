import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useCreateReminder } from '@/hooks/useNotifications';
import { __ } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { reminderPresets, toLocalInput } from './reminderPresets';

/**
 * v0.1.276 — Crear un recordatorio (de un registro o suelto): atajos, otra
 * fecha y hora, y una nota opcional. Suena en la bandeja y, si la persona lo
 * tiene encendido, también por correo.
 */
export function ReminderForm({
    listId,
    recordId,
    onDone,
    compact = false,
}: {
    listId?: number;
    recordId?: number;
    onDone?: () => void;
    compact?: boolean;
}): JSX.Element {
    const presets = reminderPresets();
    const [choice, setChoice] = useState<string>(presets[presets.length > 2 ? 2 : 0]!.key);
    const [custom, setCustom] = useState(() => toLocalInput(presets[2]?.at ?? new Date(Date.now() + 86_400_000)));
    const [note, setNote] = useState('');
    const create = useCreateReminder();
    const toast = useToast();

    const when = choice === 'custom' ? new Date(custom) : (presets.find((p) => p.key === choice)?.at ?? null);
    const valid = when !== null && !Number.isNaN(when.getTime()) && when.getTime() > Date.now() - 60_000;

    const save = (): void => {
        if (!valid || !when) return;
        create.mutate(
            { list_id: listId, record_id: recordId, remind_at: when.toISOString(), note: note.trim() },
            {
                onSuccess: () => {
                    toast.success(__('Recordatorio creado'), formatDateTime(when));
                    setNote('');
                    onDone?.();
                },
                onError: (err) => toast.error(__('No se pudo crear'), err instanceof Error ? err.message : String(err)),
            },
        );
    };

    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2.5', compact && 'imcrm-text-sm')} data-testid="reminder-form">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                {[...presets.map((p) => ({ key: p.key, label: p.label })), { key: 'custom', label: __('Otra fecha…') }].map((p) => (
                    <button
                        key={p.key}
                        type="button"
                        onClick={() => setChoice(p.key)}
                        aria-pressed={choice === p.key}
                        className={cn(
                            'imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-xs',
                            choice === p.key
                                ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary'
                                : 'imcrm-border-border hover:imcrm-bg-accent',
                        )}
                    >
                        {__(p.label)}
                    </button>
                ))}
            </div>
            {choice === 'custom' && (
                <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={__('Fecha y hora')} className="imcrm-h-8" />
            )}
            <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={recordId ? __('Nota (opcional): qué tienes que hacer') : __('¿Qué te recordamos?')}
                maxLength={500}
                className="imcrm-h-8"
                onKeyDown={(e) => e.key === 'Enter' && save()}
                data-testid="reminder-note"
            />
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{valid && when ? formatDateTime(when) : __('Elige una fecha futura')}</span>
                <Button
                    size="sm"
                    onClick={save}
                    disabled={!valid || create.isPending || (!recordId && note.trim() === '')}
                    data-testid="reminder-save"
                >
                    {__('Recordarme')}
                </Button>
            </div>
        </div>
    );
}
