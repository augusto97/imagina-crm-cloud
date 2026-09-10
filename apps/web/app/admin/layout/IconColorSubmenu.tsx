import { Palette } from 'lucide-react';

import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';

import { IconCatalogPicker } from '@/admin/lists/IconCatalogPicker';

/**
 * Submenú "Color e ícono" del menú contextual del panel (v0.1.172): el
 * MISMO catálogo que el selector de Ajustes (`IconCatalogPicker`), servido
 * dentro del menú para no tener que ir a la página de la lista. Elegir
 * aplica al instante y el menú queda abierto: se elige el color y después
 * el icono sin reabrir nada.
 */
export function IconColorSubmenu({
    icon,
    color,
    onChange,
}: {
    icon: string | null;
    color: string | null;
    onChange: (next: { icon: string | null; color: string | null }) => void;
}): JSX.Element {
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="menu-icon-color">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Palette className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Color e ícono')}
                </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="imcrm-w-[340px] imcrm-p-3" data-testid="icon-color-panel">
                <IconCatalogPicker icon={icon} color={color} onChange={onChange} gridMaxHeight={280} />
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}
