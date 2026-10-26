import type { Team } from '@imagina-base/shared';
import { Users } from 'lucide-react';

import { listColor, listIcon } from '@/lib/listIcons';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * C1 — El icono de un equipo: el que eligió quien lo creó (mismo catálogo de
 * las listas) sobre su color, o el genérico de personas en gris.
 */
export function TeamGlyph({
    team,
    size = 'sm',
}: {
    team: Pick<Team, 'icon' | 'color'> | null | undefined;
    size?: 'xs' | 'sm' | 'md';
}): JSX.Element {
    const Icon = listIcon(team?.icon ?? null);
    const color = listColor(team?.color ?? null);
    const box = size === 'xs' ? 'imcrm-h-3.5 imcrm-w-3.5 imcrm-rounded-[3px]' : size === 'md' ? 'imcrm-h-7 imcrm-w-7 imcrm-rounded-md' : 'imcrm-h-4 imcrm-w-4 imcrm-rounded-[4px]';
    const glyph = size === 'xs' ? 'imcrm-h-2.5 imcrm-w-2.5' : size === 'md' ? 'imcrm-h-4 imcrm-w-4' : 'imcrm-h-3 imcrm-w-3';
    return (
        <span
            aria-hidden
            className={cn('imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-text-white', box, color === undefined && 'imcrm-bg-muted-foreground/70')}
            style={color !== undefined ? { backgroundColor: color } : undefined}
        >
            {Icon ? <Icon className={glyph} /> : <Users className={glyph} />}
        </span>
    );
}

/**
 * Chip de un equipo (campo «Equipo», filtros, permisos): el cuadrado con su
 * icono y color + el nombre. Un id que ya no existe (equipo borrado) se ve
 * como «Equipo borrado», nunca como un número suelto.
 */
export function TeamChip({
    team,
    id,
    known = true,
    className,
}: {
    team: Team | null | undefined;
    /** Para nombrar uno borrado. */
    id?: number;
    /** `false` = los equipos todavía no se cargaron (no se sabe si existe). */
    known?: boolean;
    className?: string;
}): JSX.Element {
    const name = team ? team.name : id !== undefined ? (known ? __('Equipo borrado') : __('Equipo')) : '';
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-py-px imcrm-pl-0.5 imcrm-pr-1.5 imcrm-text-xs imcrm-leading-5',
                !team && 'imcrm-text-muted-foreground',
                className,
            )}
            title={team ? (team.description ? `${team.name} — ${team.description}` : sprintf(__('%1$s · %2$d personas'), team.name, team.member_count)) : undefined}
            data-testid="imcrm-team-chip"
        >
            <TeamGlyph team={team} size="xs" />
            <span className="imcrm-truncate">{name}</span>
        </span>
    );
}

/** Los chips de un valor del campo «Equipo» (uno o varios). */
export function TeamChips({
    ids,
    teams,
    known = true,
    wrap = false,
    className,
}: {
    ids: number[];
    teams: ReadonlyMap<number, Team>;
    known?: boolean;
    wrap?: boolean;
    className?: string;
}): JSX.Element | null {
    if (ids.length === 0) return null;
    return (
        <span className={cn('imcrm-inline-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-gap-1', wrap ? 'imcrm-flex-wrap' : 'imcrm-overflow-hidden', className)}>
            {ids.map((id) => (
                <TeamChip key={id} id={id} known={known} team={teams.get(id)} className={wrap ? undefined : 'imcrm-shrink'} />
            ))}
        </span>
    );
}
