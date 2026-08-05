import { forwardRef, useEffect, useState } from 'react';
import { formatDuration, parseDuration, type DurationFormat } from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Duración (v0.1.158).
 *
 * El valor guardado son MINUTOS, pero nadie escribe minutos: se escribe
 * `1h 30m`, `1:30` o `90`. El control mantiene un borrador de TEXTO (si no,
 * tipear "1h" se convertiría a 60 y borraría lo que el usuario venía
 * escribiendo) y sólo convierte al confirmar; lo que no parsea se marca en
 * rojo y no se guarda.
 */
interface Props {
    value: number | null;
    onCommit: (next: number | null) => void;
    format?: DurationFormat;
    onCancel?: () => void;
    disabled?: boolean;
    className?: string;
}

export const DurationControl = forwardRef<HTMLInputElement, Props>(function DurationControl(
    { value, onCommit, format = 'hm', onCancel, disabled, className },
    ref,
) {
    const [draft, setDraft] = useState(() => formatDuration(value, format));
    const [invalid, setInvalid] = useState(false);

    useEffect(() => {
        setDraft(formatDuration(value, format));
        setInvalid(false);
    }, [value, format]);

    const commit = (): void => {
        const raw = draft.trim();
        if (raw === '') {
            setInvalid(false);
            onCommit(null);
            return;
        }
        const parsed = parseDuration(raw);
        if (!parsed.ok) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        onCommit(parsed.value);
    };

    return (
        <Input
            ref={ref}
            value={draft}
            disabled={disabled}
            placeholder="1h 30m"
            onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel?.();
                }
            }}
            className={cn(
                'imcrm-h-7 imcrm-text-sm',
                invalid && 'imcrm-border-destructive focus-visible:imcrm-ring-destructive',
                className,
            )}
            aria-invalid={invalid}
            title={invalid ? 'Escribí una duración: 1h 30m, 1:30 o 90' : undefined}
        />
    );
});
