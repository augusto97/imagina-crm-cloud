import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { RolePermissions } from '@imagina-base/shared';

import { TeamGlyph } from '@/components/fields/TeamChip';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useListPermissions, useUpdateListPermissions } from '@/hooks/usePermissions';
import { useTeams } from '@/hooks/useTeams';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';

import { ACCESS_LEVELS, levelOf } from './listAccessLevels';

const DEFAULT_LEVEL = 'collab';

function permsForLevel(id: string): RolePermissions {
    const lvl = ACCESS_LEVELS.find((l) => l.id === id) ?? ACCESS_LEVELS[0]!;
    return { ...lvl.perms, fields_hidden: [] };
}

/**
 * C1 — Compartir la lista con un EQUIPO entero. El acceso del equipo pisa el
 * del rol de sus personas sólo en esta lista; el de una persona puntual pisa
 * al del equipo. Quien está en varios equipos con acceso recibe lo más
 * permisivo de cada eje (lo decide el backend, aquí sólo se elige el nivel).
 */
export function ListTeamAccess({ listId, compact = false }: { listId: number; compact?: boolean }): JSX.Element {
    const perms = useListPermissions(listId);
    const update = useUpdateListPermissions(listId);
    const teams = useTeams();
    const toast = useToast();
    const [pick, setPick] = useState('');
    const [level, setLevel] = useState(DEFAULT_LEVEL);

    const current = useMemo(() => perms.data?.teams ?? [], [perms.data]);
    const currentIds = useMemo(() => new Set(current.map((t) => t.team_id)), [current]);
    const available = (teams.data ?? []).filter((t) => !currentIds.has(t.id));

    const asMap = (): Record<string, RolePermissions> =>
        Object.fromEntries(current.map((t) => [String(t.team_id), t.permissions]));

    const save = (next: Record<string, RolePermissions>, done: string): void => {
        update.mutate(
            { teams: next },
            {
                onSuccess: () => toast.success(done),
                onError: (err) => toast.error(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar.')),
            },
        );
    };

    const add = (): void => {
        const id = Number(pick);
        const team = (teams.data ?? []).find((t) => t.id === id);
        if (!team) return;
        setPick('');
        save({ ...asMap(), [String(id)]: permsForLevel(level) }, sprintf(__('Compartida con el equipo «%s»'), team.name));
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-list-team-access">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Equipos con acceso')}</h3>
                {!compact && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__(
                            'Todas las personas del equipo entran con este nivel, sólo en esta lista. Si alguien tiene un acceso propio, vale el suyo; si está en varios equipos, vale el más amplio.',
                        )}
                    </p>
                )}
            </div>

            {teams.data && teams.data.length === 0 ? (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Todavía no hay equipos en la empresa. Créalos en Ajustes → Equipos.')}
                </p>
            ) : (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Select
                        value={pick}
                        onChange={(e) => setPick(e.target.value)}
                        aria-label={__('Equipo para compartir')}
                        className="imcrm-h-9 imcrm-min-w-[180px] imcrm-flex-1"
                        data-testid="imcrm-list-team-pick"
                    >
                        <option value="">{available.length === 0 ? __('Todos los equipos ya tienen acceso') : __('Elige un equipo…')}</option>
                        {available.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </Select>
                    <Select
                        value={level}
                        onChange={(e) => setLevel(e.target.value)}
                        aria-label={__('Nivel de acceso para el equipo')}
                        className="imcrm-h-9 imcrm-w-[150px]"
                    >
                        {ACCESS_LEVELS.filter((l) => l.id !== 'none').map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.label}
                            </option>
                        ))}
                    </Select>
                    <Button size="sm" variant="outline" onClick={add} disabled={pick === '' || update.isPending} data-testid="imcrm-list-team-add">
                        {__('Compartir')}
                    </Button>
                </div>
            )}

            {perms.isLoading ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando accesos…')}
                </p>
            ) : current.length > 0 ? (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border">
                    {current.map((t) => (
                        <li key={t.team_id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2" data-testid="imcrm-list-team-row">
                            <TeamGlyph team={t} size="sm" />
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{t.name}</span>
                                <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                    {sprintf(_n('%d persona', '%d personas', t.member_count), t.member_count)}
                                </span>
                            </span>
                            <Select
                                value={levelOf(t.permissions) ?? 'custom'}
                                onChange={(e) =>
                                    save({ ...asMap(), [String(t.team_id)]: permsForLevel(e.target.value) }, __('Acceso actualizado'))
                                }
                                aria-label={sprintf(__('Acceso del equipo %s'), t.name)}
                                className="imcrm-h-8 imcrm-w-[150px]"
                            >
                                {levelOf(t.permissions) === null && <option value="custom">{__('Personalizado')}</option>}
                                {ACCESS_LEVELS.map((l) => (
                                    <option key={l.id} value={l.id}>
                                        {l.label}
                                    </option>
                                ))}
                            </Select>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    const next = asMap();
                                    delete next[String(t.team_id)];
                                    save(next, sprintf(__('Se quitó el acceso del equipo «%s»'), t.name));
                                }}
                                aria-label={sprintf(__('Quitar el acceso del equipo %s'), t.name)}
                                className="imcrm-shrink-0 imcrm-text-muted-foreground"
                            >
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
