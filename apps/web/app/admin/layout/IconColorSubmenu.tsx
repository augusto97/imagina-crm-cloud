import { Check, Palette } from 'lucide-react';

import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { LIST_ICONS, LIST_ICON_COLORS, listColor } from '@/lib/listIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Submenú "Color e ícono" del menú contextual del panel (v0.1.172): el
 * MISMO catálogo que el selector de Ajustes (`ListIconPicker`), servido
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
    const hex = listColor(color);
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="menu-icon-color">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Palette className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Color e ícono')}
                </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="imcrm-w-[272px] imcrm-p-3" data-testid="icon-color-panel">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{__('Color')}</p>
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
                                    {hex === c.hex && <Check className="imcrm-h-3 imcrm-w-3 imcrm-text-white" aria-hidden />}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{__('Icono')}</p>
                        <div className="imcrm-grid imcrm-max-h-40 imcrm-grid-cols-8 imcrm-gap-1 imcrm-overflow-y-auto">
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
                    {(icon !== null || color !== null) && (
                        <button
                            type="button"
                            onClick={() => onChange({ icon: null, color: null })}
                            className="imcrm-self-start imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                        >
                            {__('Quitar el icono')}
                        </button>
                    )}
                </div>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}
