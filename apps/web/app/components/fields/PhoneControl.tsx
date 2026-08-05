import { forwardRef, useMemo } from 'react';
import { PhoneCall } from 'lucide-react';
import { COUNTRY_DIAL_CODES, dialCodeFor, formatPhone, splitPhone } from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Teléfono con indicativo (v0.1.158).
 *
 * Dos controles, UN valor: el select del indicativo y el input del número
 * componen la misma cadena canónica (`+573001112233`) que guarda el backend.
 * El indicativo NO se guarda aparte — se deriva del valor con `splitPhone`,
 * así el control siempre muestra lo que hay guardado aunque el campo cambie
 * su país por defecto después.
 */
interface Props {
    value: string | null;
    onChange: (next: string | null) => void;
    /** `config` del campo — de ahí sale el país por defecto. */
    config?: Record<string, unknown>;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onBlur?: () => void;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
}

export const PhoneControl = forwardRef<HTMLInputElement, Props>(function PhoneControl(
    { value, onChange, config, onKeyDown, onBlur, disabled, className, placeholder },
    ref,
) {
    const defaultDial = useMemo(() => {
        const iso = typeof config?.default_country === 'string' ? config.default_country : null;
        return dialCodeFor(iso) ?? '';
    }, [config]);

    const parts = useMemo(() => splitPhone(value ?? ''), [value]);
    const dial = parts.dial !== '' ? parts.dial : defaultDial;
    const national = parts.national;

    const compose = (nextDial: string, nextNational: string): void => {
        const digits = nextNational.replace(/\D/g, '');
        if (digits === '') {
            onChange(null);
            return;
        }
        onChange(nextDial === '' ? digits : `+${nextDial}${digits}`);
    };

    return (
        <div className={cn('imcrm-flex imcrm-items-center imcrm-gap-1', className)}>
            <Select
                aria-label="Indicativo"
                value={dial}
                disabled={disabled}
                onChange={(e) => compose(e.target.value, national)}
                className="imcrm-h-7 imcrm-w-[104px] imcrm-shrink-0 imcrm-text-xs"
            >
                <option value="">—</option>
                {COUNTRY_DIAL_CODES.map((c) => (
                    // El país va en la key (dos países comparten indicativo:
                    // +1 es EE.UU. y Canadá).
                    <option key={c.iso2} value={c.dial}>
                        {c.iso2} +{c.dial}
                    </option>
                ))}
            </Select>
            <Input
                ref={ref}
                type="tel"
                inputMode="tel"
                value={national}
                disabled={disabled}
                onChange={(e) => compose(dial, e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
                placeholder={placeholder ?? '300 111 2233'}
                className="imcrm-h-7 imcrm-min-w-0 imcrm-flex-1 imcrm-text-sm"
            />
        </div>
    );
});

/**
 * Lectura: el número formateado, marcable con `tel:` — en el celular llama,
 * en el escritorio abre el softphone. El `href` usa el valor CANÓNICO (sin
 * espacios), que es el que entienden los marcadores.
 *
 * En la TABLA el número NO puede ser un enlace entero: un click en la celda
 * tiene que editarla como cualquier otra (si el enlace se come el evento, el
 * teléfono es el único campo que no se puede corregir en línea). Por eso
 * `variant="cell"` deja el texto plano y pone el icono de llamar aparte, que
 * es lo que hace ClickUp.
 */
export function PhoneDisplay({
    value,
    variant = 'full',
}: {
    value: unknown;
    variant?: 'full' | 'cell';
}): JSX.Element {
    if (typeof value !== 'string' || value.trim() === '') {
        return <span className="imcrm-text-muted-foreground">—</span>;
    }
    const canonical = value.replace(/[^\d+]/g, '');
    const pretty = formatPhone(value) || value;

    if (variant === 'cell') {
        return (
            <span className="imcrm-group/phone imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1">
                <span className="imcrm-truncate">{pretty}</span>
                <a
                    href={`tel:${canonical}`}
                    onClick={(e) => e.stopPropagation()}
                    className="imcrm-shrink-0 imcrm-opacity-0 group-hover/phone:imcrm-opacity-100 imcrm-text-primary"
                    aria-label={`Llamar a ${pretty}`}
                    title={`Llamar a ${pretty}`}
                >
                    <PhoneCall className="imcrm-h-3 imcrm-w-3" aria-hidden />
                </a>
            </span>
        );
    }

    return (
        <a
            href={`tel:${canonical}`}
            className="imcrm-text-primary hover:imcrm-underline"
            onClick={(e) => e.stopPropagation()}
        >
            {pretty}
        </a>
    );
}
