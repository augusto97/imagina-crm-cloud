import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import type { ActionMeta } from '@/types/automation';

import { actionMetaFor } from './automationMeta';

/**
 * Menú de tipos de acción (icono + título + descripción). Elegir un
 * tipo inserta la acción directamente — sin paso intermedio. Compartido
 * entre el flujo vertical y el lienzo visual.
 */
export function ActionTypeMenu({
    actionsCatalog,
    onPick,
    children,
    exclude,
}: {
    actionsCatalog: ActionMeta[];
    onPick: (type: string) => void;
    children: React.ReactNode;
    /** Slugs a ocultar (ej. if_else cuando se alcanzó el anidado máximo). */
    exclude?: string[];
}): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="imcrm-w-[300px]">
                {actionsCatalog
                    .filter((a) => !(exclude ?? []).includes(a.slug))
                    .map((a) => {
                        const meta = actionMetaFor(a.slug);
                        return (
                            <DropdownMenuItem
                                key={a.slug}
                                onSelect={() => onPick(a.slug)}
                                className="imcrm-items-start imcrm-gap-2.5 imcrm-py-2"
                            >
                                <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                                    <meta.icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-foreground/70" />
                                </span>
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                                    <span className="imcrm-text-[13px] imcrm-font-medium">{a.label}</span>
                                    {meta.description !== '' && (
                                        <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                                            {__(meta.description)}
                                        </span>
                                    )}
                                </span>
                            </DropdownMenuItem>
                        );
                    })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
