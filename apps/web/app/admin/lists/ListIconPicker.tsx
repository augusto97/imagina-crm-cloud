import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { IconCatalogPicker } from './IconCatalogPicker';

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
 * escaneable un menú con muchas listas. v0.1.175 — el catálogo (324 sólidos
 * por categoría + buscador) vive en `IconCatalogPicker`, compartido con el
 * submenú del panel.
 */
export function ListIconPicker({ icon, color, onChange }: ListIconPickerProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const Current = listIcon(icon) ?? DEFAULT_LIST_ICON;
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
            <PopoverContent align="start" className="imcrm-w-[340px] imcrm-p-3">
                <IconCatalogPicker icon={icon} color={color} onChange={onChange} gridMaxHeight={300} />
            </PopoverContent>
        </Popover>
    );
}
