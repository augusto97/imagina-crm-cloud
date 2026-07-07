import { Group, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import { isGroupableType } from '@/types/record';
import type { FieldEntity } from '@/types/field';

interface GroupSelectorProps {
    fields: FieldEntity[];
    /** field_id seleccionado para agrupar, o null = vista plana. */
    value: number | null;
    onChange: (next: number | null) => void;
}

/**
 * Toolbar dropdown estilo ClickUp: lista los campos agrupables (select,
 * multi_select, user, checkbox, date, datetime) y permite elegir uno.
 *
 * El estado se persiste por SavedView en `config.group_by_field_id`.
 * Cuando hay un campo activo, el botón muestra el label del campo y un
 * botoncito X para limpiar.
 */
export function GroupSelector({ fields, value, onChange }: GroupSelectorProps): JSX.Element {
    const groupable = fields
        .filter((f) => isGroupableType(f.type))
        .sort((a, b) => a.position - b.position);

    const active = value !== null ? fields.find((f) => f.id === value) : null;

    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="imcrm-gap-1.5">
                        <Group className="imcrm-h-3.5 imcrm-w-3.5" />
                        {active ? (
                            <>
                                <span className="imcrm-text-muted-foreground">
                                    {__('Agrupar por')}
                                </span>
                                <span className="imcrm-font-semibold">{active.label}</span>
                            </>
                        ) : (
                            __('Agrupar por')
                        )}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="imcrm-min-w-[220px] imcrm-max-h-[60vh] imcrm-overflow-y-auto">
                    <div className="imcrm-px-2 imcrm-pt-1.5 imcrm-pb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('Campos agrupables')}
                    </div>
                    {groupable.length === 0 ? (
                        <p className="imcrm-px-2 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            {__(
                                'Esta lista no tiene campos agrupables. Crea uno tipo Selección, Usuario, Checkbox o Fecha.',
                            )}
                        </p>
                    ) : (
                        groupable.map((field) => (
                            <DropdownMenuItem
                                key={field.id}
                                onSelect={() => onChange(field.id)}
                                className={
                                    value === field.id
                                        ? 'imcrm-bg-accent imcrm-font-semibold'
                                        : undefined
                                }
                            >
                                <span className="imcrm-truncate">{field.label}</span>
                                <span className="imcrm-ml-auto imcrm-text-[10px] imcrm-text-muted-foreground">
                                    {field.type}
                                </span>
                            </DropdownMenuItem>
                        ))
                    )}
                    {value !== null && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => onChange(null)}>
                                <X className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Sin agrupación')}
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
