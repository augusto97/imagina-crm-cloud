import { useMemo, useState } from 'react';
import { Loader2, UserPlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useListPermissions, useUpdateListPermissions } from '@/hooks/usePermissions';
import { useWpUsersSearch } from '@/hooks/useWpUsers';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import type { RolePermissions } from '@imagina-base/shared';

import { ACCESS_LEVELS, levelOf } from './listAccessLevels';

interface ListPeopleAccessProps {
    listId: number;
}

const DEFAULT_LEVEL = 'collab';

function permsForLevel(id: string): RolePermissions {
    const lvl = ACCESS_LEVELS.find((l) => l.id === id) ?? ACCESS_LEVELS[0]!;
    return { ...lvl.perms, fields_hidden: [] };
}

/**
 * Compartir la lista con una PERSONA puntual (v0.1.138).
 *
 * Hasta acá el acceso a una lista se decidía sólo por ROL: para darle
 * acceso a alguien había que cambiarle el rol en todo el workspace, que es
 * exactamente lo que nadie quiere hacer. Esto guarda un acceso por persona
 * en el ACL de la lista, y ese acceso pisa lo que diga su rol — para esta
 * lista y nada más. Los admin no aparecen: siempre tienen acceso total.
 */
export function ListPeopleAccess({ listId }: ListPeopleAccessProps): JSX.Element {
    const perms = useListPermissions(listId);
    const update = useUpdateListPermissions(listId);
    const toast = useToast();

    const [search, setSearch] = useState('');
    const [level, setLevel] = useState(DEFAULT_LEVEL);
    const results = useWpUsersSearch(search);

    const current = useMemo(() => perms.data?.users ?? [], [perms.data]);
    const currentIds = useMemo(() => new Set(current.map((u) => u.user_id)), [current]);

    const save = (next: Record<string, RolePermissions>, done: string): void => {
        update.mutate(
            { users: next },
            {
                onSuccess: () => toast.success(done),
                onError: (err) =>
                    toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Error'),
            },
        );
    };

    const asMap = (): Record<string, RolePermissions> =>
        Object.fromEntries(current.map((u) => [String(u.user_id), u.permissions]));

    const add = (userId: number, name: string): void => {
        setSearch('');
        save(
            { ...asMap(), [String(userId)]: permsForLevel(level) },
            sprintf(/* translators: %s: person name */ __('Compartida con %s'), name),
        );
    };

    const changeLevel = (userId: number, nextLevel: string): void => {
        save({ ...asMap(), [String(userId)]: permsForLevel(nextLevel) }, __('Acceso actualizado'));
    };

    const remove = (userId: number, name: string): void => {
        const next = asMap();
        delete next[String(userId)];
        save(next, sprintf(/* translators: %s: person name */ __('Se quitó el acceso de %s'), name));
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Personas con acceso')}</h3>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('El acceso que le des acá a alguien manda sobre el de su rol, sólo en esta lista.')}
                </p>
            </div>

            {/* Alta: buscar un miembro y elegir con qué puede entrar. */}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <div className="imcrm-relative imcrm-min-w-[200px] imcrm-flex-1">
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={__('Buscar una persona por nombre o correo…')}
                        aria-label={__('Buscar una persona')}
                        className="imcrm-h-9"
                    />
                    {search.trim() !== '' && (
                        <div className="imcrm-absolute imcrm-left-0 imcrm-right-0 imcrm-top-full imcrm-z-30 imcrm-mt-1 imcrm-max-h-56 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-shadow-imcrm-md">
                            {results.isLoading && (
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                                    <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                                    {__('Buscando…')}
                                </p>
                            )}
                            {results.data?.length === 0 && !results.isLoading && (
                                <p className="imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Nadie coincide. Sólo aparecen miembros de esta empresa.')}
                                </p>
                            )}
                            {(results.data ?? []).map((u) => (
                                <button
                                    key={u.id}
                                    type="button"
                                    disabled={currentIds.has(u.id)}
                                    onClick={() => add(u.id, u.display_name)}
                                    className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent disabled:imcrm-opacity-50"
                                >
                                    <UserPlus className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                                    <span className="imcrm-truncate">{u.display_name}</span>
                                    {currentIds.has(u.id) && (
                                        <span className="imcrm-ml-auto imcrm-text-xs imcrm-text-muted-foreground">
                                            {__('ya tiene acceso')}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <Select
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    aria-label={__('Nivel de acceso para quien agregues')}
                    className="imcrm-h-9 imcrm-w-[160px]"
                >
                    {ACCESS_LEVELS.filter((l) => l.id !== 'none').map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.label}
                        </option>
                    ))}
                </Select>
            </div>

            {perms.isLoading ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando accesos…')}
                </p>
            ) : current.length === 0 ? (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-4 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Todavía no compartiste esta lista con nadie en particular. Entra quien su rol lo permita.')}
                </p>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border">
                    {current.map((u) => (
                        <li key={u.user_id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2">
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{u.name}</span>
                                <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                    {u.email}
                                </span>
                            </span>
                            <Select
                                value={levelOf(u.permissions) ?? 'custom'}
                                onChange={(e) => changeLevel(u.user_id, e.target.value)}
                                aria-label={sprintf(
                                    /* translators: %s: person name */
                                    __('Acceso de %s'),
                                    u.name,
                                )}
                                className="imcrm-h-8 imcrm-w-[150px]"
                            >
                                {levelOf(u.permissions) === null && (
                                    <option value="custom">{__('Personalizado')}</option>
                                )}
                                {ACCESS_LEVELS.map((l) => (
                                    <option key={l.id} value={l.id}>
                                        {l.label}
                                    </option>
                                ))}
                            </Select>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => remove(u.user_id, u.name)}
                                aria-label={sprintf(
                                    /* translators: %s: person name */
                                    __('Quitar el acceso de %s'),
                                    u.name,
                                )}
                                className="imcrm-shrink-0 imcrm-text-muted-foreground"
                            >
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
