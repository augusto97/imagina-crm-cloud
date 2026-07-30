import { useState } from 'react';
import { Check, List as ListFallback } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LIST_ICONS, LIST_ICON_COLORS, listColor, listIcon } from '@/lib/listIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ListIconPickerProps {
    icon: string | null;
    color: string | null;
    onChange: (next: { icon: string | null; color: string | null }) => void;
}

/**
 * Selector de icono + color de la lista (v0.1.137).
 *
 * `lists.icon` y `lists.color` existían en el backend desde F1 pero nunca
 * tuvieron interfaz: el menú pintaba el mismo punto para todas las listas.
 * El usuario lo pidió mirando ClickUp, donde el icono es lo que hace
 * escaneable un menú con muchas listas.
 */
export function ListIconPicker({ icon, color, onChange }: ListIconPickerProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const Current = listIcon(icon) ?? ListFallback;
    const hex = listColor(color);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="imcrm-h-9 imcrm-w-full imcrm-justify-start imcrm-gap-2 imcrm-px-3"
                >
                    <Current
                        className={cn('imcrm-h-4 imcrm-w-4', hex === undefined && 'imcrm-opacity-70')}
                        style={hex !== undefined ? { color: hex } : undefined}
                        aria-hidden
                    />
                    <span className="imcrm-text-sm">
                        {icon === null ? __('Sin icono') : __('Cambiar icono')}
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="imcrm-w-[320px] imcrm-p-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                            {__('Color')}
                        </p>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            {LIST_ICON_COLORS.map((c) => (
                                <button
                                    key={c.hex}
                                    type="button"
                                    title={c.label}
                                    aria-label={c.label}
                                    aria-pressed={hex === c.hex}
                                    onClick={() => onChange({ icon: icon ?? 'list', color: c.hex })}
                                    className={cn(
                                        'imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-ring-1 imcrm-ring-border',
                                        hex === c.hex && 'imcrm-ring-2 imcrm-ring-primary',
                                    )}
                                    style={{ backgroundColor: c.hex }}
                                >
                                    {hex === c.hex && (
                                        <Check className="imcrm-h-3 imcrm-w-3 imcrm-text-white" aria-hidden />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                            {__('Icono')}
                        </p>
                        <div className="imcrm-grid imcrm-max-h-56 imcrm-grid-cols-9 imcrm-gap-1 imcrm-overflow-y-auto">
                            {LIST_ICONS.map(({ key, icon: Icon, label }) => (
                                <button
                                    key={key}
                                    type="button"
                                    title={label}
                                    aria-label={label}
                                    aria-pressed={icon === key}
                                    onClick={() => onChange({ icon: key, color })}
                                    className={cn(
                                        'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                                        icon === key && 'imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-1 imcrm-ring-primary/40',
                                    )}
                                >
                                    <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </button>
                            ))}
                        </div>
                    </div>

                    {icon !== null && (
                        <button
                            type="button"
                            onClick={() => {
                                onChange({ icon: null, color: null });
                                setOpen(false);
                            }}
                            className="imcrm-self-start imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                        >
                            {__('Quitar el icono')}
                        </button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
