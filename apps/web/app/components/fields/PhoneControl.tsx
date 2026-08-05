import { forwardRef, useMemo, useRef, useState } from 'react';
import { Check, PhoneCall } from 'lucide-react';
import {
    countryByIso2,
    flagEmoji,
    formatPhoneNational,
    searchCountries,
    splitPhone,
    type CountryDialCode,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Teléfono con indicativo (v0.1.158; rediseñado en v0.1.159 sobre el reporte
 * del usuario, con ClickUp como referencia).
 *
 * La v0.1.158 usaba un `<select>` nativo y tenía tres problemas: ocupaba
 * ~104px de ancho, y al abrirlo el navegador le sacaba el foco al input →
 * el `onBlur` de la celda cerraba el modo edición, así que el desplegable se
 * cerraba solo y era imposible cambiar el país.
 *
 * Ahora es lo que hace ClickUp: **una bandera** (ancho de un icono) que abre
 * un popover con buscador, y el número al lado. Dos controles, UN valor: la
 * cadena canónica `+573001112233`. El indicativo NO se guarda aparte — se
 * deriva del valor con `splitPhone`, así el control siempre muestra lo que
 * hay guardado aunque el campo cambie su país por defecto después.
 */
interface Props {
    value: string | null;
    onChange: (next: string | null) => void;
    /** `config` del campo — de ahí sale el país por defecto. */
    config?: Record<string, unknown>;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    /** Se llama al salir del control. NO se dispara si el foco se fue al
     *  popover de países (si no, elegir país cancelaría la edición). */
    onBlur?: () => void;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
}

export const PhoneControl = forwardRef<HTMLInputElement, Props>(function PhoneControl(
    { value, onChange, config, onKeyDown, onBlur, disabled, className, placeholder },
    ref,
) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const openRef = useRef(false);

    const fallback = useMemo(
        () => countryByIso2(typeof config?.default_country === 'string' ? config.default_country : null),
        [config],
    );

    const parts = useMemo(() => splitPhone(value ?? ''), [value]);
    const country = parts.country ?? (parts.dial === '' ? fallback : null);
    const dial = parts.dial !== '' ? parts.dial : (fallback?.dial ?? '');
    const national = parts.national;

    const results = useMemo(() => {
        const found = searchCountries(query);
        // Sin búsqueda, el país ACTUAL va primero (como ClickUp): es el que
        // se mira para confirmar, y buscarlo entre 233 sería absurdo.
        if (query.trim() !== '' || country === null) return found;
        return [country, ...found.filter((c) => c.iso2 !== country.iso2)];
    }, [query, country]);

    const compose = (nextDial: string, nextNational: string): void => {
        const digits = nextNational.replace(/\D/g, '');
        if (digits === '') {
            onChange(null);
            return;
        }
        onChange(nextDial === '' ? digits : `+${nextDial}${digits}`);
    };

    const pick = (c: CountryDialCode): void => {
        compose(c.dial, national);
        setOpen(false);
        setQuery('');
    };

    return (
        <div
            className={cn('imcrm-flex imcrm-items-center imcrm-gap-1', className)}
            // El cierre de la edición se decide para TODO el control, no para
            // el input: el foco viaja entre el número, la bandera y el
            // popover (portaleado al body) sin que eso signifique "terminé".
            onBlur={(e) => {
                if (openRef.current) return;
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                onBlur?.();
            }}
        >
            <Popover
                open={open}
                onOpenChange={(next) => {
                    openRef.current = next;
                    setOpen(next);
                    if (!next) setQuery('');
                }}
            >
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        disabled={disabled}
                        aria-label={__('Código de país')}
                        title={country ? `${country.name} +${country.dial}` : __('Código de país')}
                        // El popover se abre en el pointerdown de Radix; sin
                        // esto el evento seguiría hasta la celda/fila.
                        onClick={(e) => e.stopPropagation()}
                        className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-base hover:imcrm-bg-accent"
                    >
                        {country ? (
                            <span aria-hidden>{flagEmoji(country.iso2)}</span>
                        ) : (
                            <span className="imcrm-text-xs imcrm-text-muted-foreground" aria-hidden>
                                +
                            </span>
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="imcrm-w-72 imcrm-p-0" align="start">
                    <div className="imcrm-p-2">
                        <Input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={__('Código de país')}
                            className="imcrm-h-8 imcrm-text-sm"
                        />
                    </div>
                    <div className="imcrm-max-h-64 imcrm-overflow-y-auto imcrm-pb-2">
                        {results.length === 0 && (
                            <p className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Sin resultados.')}
                            </p>
                        )}
                        {results.map((c) => {
                            const active = country?.iso2 === c.iso2;
                            return (
                                <button
                                    key={c.iso2}
                                    type="button"
                                    onClick={() => pick(c)}
                                    className={cn(
                                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent',
                                        active && 'imcrm-bg-accent/60',
                                    )}
                                >
                                    <span className="imcrm-text-base" aria-hidden>
                                        {flagEmoji(c.iso2)}
                                    </span>
                                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{c.name}</span>
                                    <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground imcrm-tabular-nums">
                                        +{c.dial}
                                    </span>
                                    {active && <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" />}
                                </button>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
            <Input
                ref={ref}
                type="tel"
                inputMode="tel"
                value={national}
                disabled={disabled}
                onChange={(e) => compose(dial, e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder ?? '300 111 2233'}
                className="imcrm-h-7 imcrm-min-w-0 imcrm-flex-1 imcrm-text-sm"
            />
        </div>
    );
});

/**
 * Lectura: bandera + número, con el enlace `tel:` en un icono APARTE.
 *
 * El número entero no puede ser un enlace: en la tabla y en la ficha, un
 * click sobre el valor tiene que abrir la edición como en cualquier otro
 * campo — si el `<a>` se come el evento, el teléfono es el único campo que
 * no se puede corregir, y encima abre la app de llamadas sin que nadie se
 * lo haya pedido (reporte del usuario en v0.1.158). El icono de llamar
 * aparece al pasar el mouse, como en ClickUp.
 *
 * `variant="link"` (portal del cliente, superficie de sólo lectura) sí
 * devuelve el número entero como enlace.
 */
export function PhoneDisplay({
    value,
    variant = 'inline',
}: {
    value: unknown;
    variant?: 'inline' | 'link';
}): JSX.Element {
    if (typeof value !== 'string' || value.trim() === '') {
        return <span className="imcrm-text-muted-foreground">—</span>;
    }
    const canonical = value.replace(/[^\d+]/g, '');
    const { country } = splitPhone(value);
    const national = formatPhoneNational(value);
    const pretty = country ? `+${country.dial} ${national}` : national;

    if (variant === 'link') {
        return (
            <a href={`tel:${canonical}`} className="imcrm-text-primary hover:imcrm-underline">
                {pretty}
            </a>
        );
    }

    return (
        <span className="imcrm-group/phone imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5">
            {country && (
                <span className="imcrm-shrink-0 imcrm-text-base imcrm-leading-none" title={country.name} aria-hidden>
                    {flagEmoji(country.iso2)}
                </span>
            )}
            <span className="imcrm-truncate imcrm-tabular-nums">{national}</span>
            <a
                href={`tel:${canonical}`}
                onClick={(e) => e.stopPropagation()}
                className="imcrm-shrink-0 imcrm-opacity-0 group-hover/phone:imcrm-opacity-100 imcrm-text-primary"
                aria-label={`${__('Llamar a')} ${pretty}`}
                title={`${__('Llamar a')} ${pretty}`}
            >
                <PhoneCall className="imcrm-h-3 imcrm-w-3" aria-hidden />
            </a>
        </span>
    );
}
