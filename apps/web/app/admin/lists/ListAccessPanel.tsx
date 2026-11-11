import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Building2, ChevronRight, Loader2, Mail, Search, ShieldCheck, X } from 'lucide-react';
import { GUEST_LEVELS, GUEST_LEVEL_LABELS, type GuestLevel, type RolePermissions } from '@imagina-base/shared';

import { TeamGlyph } from '@/components/fields/TeamChip';
import { useToast } from '@/components/ui/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useListGuests, useSetListGuestLevel, useShareListWithGuest } from '@/hooks/useGuests';
import { useListPermissions, useUpdateListPermissions } from '@/hooks/usePermissions';
import { useTeams } from '@/hooks/useTeams';
import { useWpUsersSearch } from '@/hooks/useWpUsers';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { GUEST_LEVEL_HINTS, guestInvitedNotice } from '@/admin/guests/GuestAccess';
import { ACCESS_LEVELS, levelOf } from './listAccessLevels';
import { buildShareOptions, guestLevelFor, initialsOf, selectableOption, type ShareOption } from './shareAccess';

const DEFAULT_LEVEL = 'collab';

function permsForLevel(id: string): RolePermissions {
    const lvl = ACCESS_LEVELS.find((l) => l.id === id) ?? ACCESS_LEVELS[0]!;
    return { ...lvl.perms, fields_hidden: [] };
}

function errorText(err: unknown): string {
    return err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar.');
}

/**
 * v0.1.410 — «Compartir → Personas»: un buscador para sumar a una persona de
 * la empresa, a un equipo o a alguien de afuera por su correo, y UNA lista con
 * quién tiene acceso (antes eran tres secciones apiladas, cada una con su
 * buscador y su nivel). El acceso de una persona o un equipo manda sobre el de
 * su rol, sólo en esta lista; los de afuera ven sólo esta lista y no ocupan un
 * usuario del plan.
 */
export function ListAccessPanel({
    listId,
    listSlug,
    onNavigate,
}: {
    listId: number;
    listSlug?: string;
    /** Se llama al ir a otra pantalla (para cerrar el diálogo). */
    onNavigate?: () => void;
}): JSX.Element {
    const perms = useListPermissions(listId);
    const update = useUpdateListPermissions(listId);
    const guests = useListGuests(listId);
    const shareGuest = useShareListWithGuest(listId);
    const setGuestLevel = useSetListGuestLevel(listId);
    const teams = useTeams();
    const toast = useToast();
    const narrow = useMediaQuery('(max-width: 639px)');

    const [query, setQuery] = useState('');
    const [level, setLevel] = useState(DEFAULT_LEVEL);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const results = useWpUsersSearch(query);
    const boxRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const people = useMemo(() => (perms.data?.users ?? []).filter((u) => !u.is_guest), [perms.data]);
    const teamRows = useMemo(() => perms.data?.teams ?? [], [perms.data]);
    const guestRows = useMemo(() => guests.data ?? [], [guests.data]);

    const options = useMemo(
        () =>
            buildShareOptions(query, results.data ?? [], teams.data ?? [], {
                userIds: new Set(people.map((u) => u.user_id)),
                teamIds: new Set(teamRows.map((t) => t.team_id)),
                guestIds: new Set(guestRows.map((g) => g.user_id)),
                guestEmails: new Set(guestRows.map((g) => g.email.toLowerCase())),
            }),
        [query, results.data, teams.data, people, teamRows, guestRows],
    );

    useEffect(() => {
        const first = options.findIndex(selectableOption);
        setActive(first < 0 ? 0 : first);
    }, [options]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent): void => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const peopleMap = (): Record<string, RolePermissions> =>
        Object.fromEntries(people.map((u) => [String(u.user_id), u.permissions]));
    const teamsMap = (): Record<string, RolePermissions> =>
        Object.fromEntries(teamRows.map((t) => [String(t.team_id), t.permissions]));

    const savePeople = (next: Record<string, RolePermissions>, done: string): void => {
        update.mutate({ users: next }, { onSuccess: () => toast.success(done), onError: (err) => toast.error(errorText(err)) });
    };
    const saveTeams = (next: Record<string, RolePermissions>, done: string): void => {
        update.mutate({ teams: next }, { onSuccess: () => toast.success(done), onError: (err) => toast.error(errorText(err)) });
    };

    const pick = (o: ShareOption): void => {
        if (!selectableOption(o)) return;
        setQuery('');
        setOpen(false);
        if (o.kind === 'member') {
            savePeople({ ...peopleMap(), [String(o.id)]: permsForLevel(level) }, sprintf(__('Compartida con %s'), o.name));
        } else if (o.kind === 'team') {
            saveTeams({ ...teamsMap(), [String(o.id)]: permsForLevel(level) }, sprintf(__('Compartida con el equipo «%s»'), o.name));
        } else {
            const email = o.email;
            shareGuest.mutate(
                { email, level: guestLevelFor(level) },
                {
                    onSuccess: (r) => toast.success(guestInvitedNotice(email, r)),
                    onError: (err) => toast.error(__('No se pudo compartir.'), errorText(err)),
                },
            );
        }
        inputRef.current?.focus();
    };

    const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Escape' && (open || query !== '')) {
            // Escape cierra la búsqueda, no el diálogo.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setQuery('');
            return;
        }
        if (options.length === 0) return;
        const step = (dir: 1 | -1): void => {
            for (let i = 1; i <= options.length; i++) {
                const n = (active + dir * i + options.length) % options.length;
                if (selectableOption(options[n]!)) {
                    setActive(n);
                    return;
                }
            }
        };
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            step(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            step(-1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = options[active];
            if (o) pick(o);
        }
    };

    const total = people.length + teamRows.length + guestRows.length;
    const loading = perms.isLoading || guests.isLoading;
    const busy = update.isPending || shareGuest.isPending || setGuestLevel.isPending;
    const showList = open && query.trim() !== '';
    const groups: Array<{ kind: ShareOption['kind']; title: string }> = [
        { kind: 'member', title: __('Personas de la empresa') },
        { kind: 'team', title: __('Equipos') },
        { kind: 'guest', title: __('Personas de afuera') },
        { kind: 'email', title: __('Invitar por correo') },
    ];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="list-access-panel">
            {/* ── Buscador ─────────────────────────────────────────── */}
            <div ref={boxRef} data-tour="share-add">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-xl imcrm-border imcrm-border-input imcrm-bg-background imcrm-pl-3 imcrm-pr-1 imcrm-shadow-imcrm-inset focus-within:imcrm-border-primary focus-within:imcrm-ring-4 focus-within:imcrm-ring-primary/15">
                    <Search className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={onKey}
                        placeholder={narrow ? __('Nombre, equipo o correo…') : __('Agrega personas, equipos o un correo…')}
                        aria-label={__('Agregar personas, equipos o un correo')}
                        role="combobox"
                        aria-expanded={showList}
                        aria-controls="share-add-options"
                        aria-autocomplete="list"
                        className="imcrm-h-10 imcrm-min-w-0 imcrm-flex-1 imcrm-bg-transparent imcrm-px-1 imcrm-text-sm imcrm-outline-none placeholder:imcrm-text-muted-foreground"
                        data-testid="share-add-input"
                        data-escape-clears=""
                    />
                    {busy && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-animate-spin imcrm-text-muted-foreground" aria-hidden />}
                    <LevelSelect
                        value={level}
                        onChange={setLevel}
                        label={__('Con qué acceso entra quien agregues')}
                        testId="share-add-level"
                        hideNone
                    />
                </div>

                {showList && (
                    <div
                        id="share-add-options"
                        role="listbox"
                        className="imcrm-mt-1.5 imcrm-max-h-72 imcrm-overflow-y-auto imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1.5 imcrm-shadow-imcrm-md"
                        data-testid="share-add-options"
                    >
                        {results.isLoading && options.length === 0 ? (
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                {__('Buscando…')}
                            </p>
                        ) : options.length === 0 ? (
                            <p className="imcrm-px-2 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Nadie coincide. Para invitar a alguien de afuera, escribe su correo completo.')}
                            </p>
                        ) : (
                            groups.map((g) => {
                                const items = options.map((o, i) => ({ o, i })).filter(({ o }) => o.kind === g.kind);
                                if (items.length === 0) return null;
                                return (
                                    <div key={g.kind} className="imcrm-py-0.5">
                                        <p className="imcrm-px-2 imcrm-pb-1 imcrm-pt-1.5 imcrm-text-[10.5px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.06em] imcrm-text-muted-foreground">
                                            {g.title}
                                        </p>
                                        {items.map(({ o, i }) => (
                                            <OptionRow
                                                key={`${o.kind}-${o.kind === 'email' ? o.email : o.id}`}
                                                option={o}
                                                active={i === active}
                                                guestLevel={guestLevelFor(level)}
                                                onHover={() => selectableOption(o) && setActive(i)}
                                                onPick={() => pick(o)}
                                            />
                                        ))}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* ── Quién tiene acceso ───────────────────────────────── */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                    <h3 className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.06em] imcrm-text-muted-foreground">
                        {__('Quién tiene acceso')}
                    </h3>
                    {total > 0 && (
                        <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="share-access-count">
                            {sprintf(_n('%d acceso propio', '%d accesos propios', total), total)}
                        </span>
                    )}
                </div>

                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card" data-testid="share-access-list">
                    {/* Todos los de la empresa (por su rol) — siempre arriba. */}
                    <li className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5">
                        <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary" aria-hidden>
                            <Building2 className="imcrm-h-4 imcrm-w-4" />
                        </span>
                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-items-start">
                            <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{__('Todos en la empresa')}</span>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Entran según su rol. Los administradores siempre tienen control total.')}
                            </span>
                            {listSlug && narrow && <RolePermissionsLink listSlug={listSlug} onNavigate={onNavigate} className="imcrm--ml-2 imcrm-mt-0.5" />}
                        </span>
                        {listSlug && !narrow && <RolePermissionsLink listSlug={listSlug} onNavigate={onNavigate} />}
                    </li>

                    {loading && (
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-3 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('Cargando accesos…')}
                        </li>
                    )}

                    {teamRows.map((t) => (
                        <AccessRow
                            key={`t-${t.team_id}`}
                            testId="share-row-team"
                            avatar={<TeamGlyph team={t} size="md" />}
                            name={t.name}
                            sub={sprintf(_n('Equipo · %d persona', 'Equipo · %d personas', t.member_count), t.member_count)}
                            control={
                                <LevelSelect
                                    value={levelOf(t.permissions) ?? 'custom'}
                                    onChange={(v) => saveTeams({ ...teamsMap(), [String(t.team_id)]: permsForLevel(v) }, __('Acceso actualizado'))}
                                    label={sprintf(__('Acceso del equipo %s'), t.name)}
                                    allowCustom={levelOf(t.permissions) === null}
                                />
                            }
                            onRemove={() => {
                                const next = teamsMap();
                                delete next[String(t.team_id)];
                                saveTeams(next, sprintf(__('Se quitó el acceso del equipo «%s»'), t.name));
                            }}
                            removeLabel={sprintf(__('Quitar el acceso del equipo %s'), t.name)}
                        />
                    ))}

                    {people.map((u) => (
                        <AccessRow
                            key={`u-${u.user_id}`}
                            testId="share-row-person"
                            avatar={<PersonAvatar name={u.name} />}
                            name={u.name}
                            sub={u.email}
                            control={
                                <LevelSelect
                                    value={levelOf(u.permissions) ?? 'custom'}
                                    onChange={(v) => savePeople({ ...peopleMap(), [String(u.user_id)]: permsForLevel(v) }, __('Acceso actualizado'))}
                                    label={sprintf(__('Acceso de %s'), u.name)}
                                    allowCustom={levelOf(u.permissions) === null}
                                />
                            }
                            onRemove={() => {
                                const next = peopleMap();
                                delete next[String(u.user_id)];
                                savePeople(next, sprintf(__('Se quitó el acceso de %s'), u.name));
                            }}
                            removeLabel={sprintf(__('Quitar el acceso de %s'), u.name)}
                        />
                    ))}

                    {guestRows.map((g) => (
                        <AccessRow
                            key={`g-${g.user_id}`}
                            testId="share-row-guest"
                            avatar={<PersonAvatar name={g.name} outside />}
                            name={g.name}
                            badge={g.pending ? __('Invitación pendiente') : __('De afuera')}
                            sub={g.email}
                            control={
                                <GuestLevelPicker
                                    value={g.level}
                                    label={sprintf(__('Acceso de %s'), g.name)}
                                    onChange={(lv) =>
                                        setGuestLevel.mutate({ userId: g.user_id, level: lv }, { onError: (err) => toast.error(__('No se pudo cambiar el acceso.'), errorText(err)) })
                                    }
                                />
                            }
                            onRemove={() =>
                                setGuestLevel.mutate(
                                    { userId: g.user_id, level: null },
                                    {
                                        onSuccess: () => toast.success(sprintf(__('Se quitó el acceso de %s'), g.name)),
                                        onError: (err) => toast.error(__('No se pudo cambiar el acceso.'), errorText(err)),
                                    },
                                )
                            }
                            removeLabel={sprintf(__('Quitar el acceso de %s'), g.name)}
                        />
                    ))}
                </ul>

                {!loading && total === 0 && (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-px-1 imcrm-text-xs imcrm-text-muted-foreground" data-testid="share-access-empty">
                        <ShieldCheck className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                        {__('Para darle a alguien más (o menos) acceso que su rol sólo en esta lista, búscalo arriba. Escribe un correo para invitar a alguien de afuera: ve sólo esta lista y no ocupa un usuario de tu plan.')}
                    </p>
                )}
            </section>
        </div>
    );
}

function RolePermissionsLink({ listSlug, onNavigate, className }: { listSlug: string; onNavigate?: () => void; className?: string }): JSX.Element {
    return (
        <Link
            to={`/lists/${listSlug}/edit?s=permisos`}
            onClick={onNavigate}
            className={cn(
                'imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-bg-primary/10',
                className,
            )}
            data-testid="share-role-permissions"
        >
            {__('Permisos por rol')}
            <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
        </Link>
    );
}

function OptionRow({
    option: o,
    active,
    guestLevel,
    onHover,
    onPick,
}: {
    option: ShareOption;
    active: boolean;
    guestLevel: GuestLevel;
    onHover: () => void;
    onPick: () => void;
}): JSX.Element {
    const enabled = selectableOption(o);
    const has = o.kind !== 'email' && o.has;
    return (
        <button
            type="button"
            role="option"
            aria-selected={active}
            disabled={!enabled}
            onMouseEnter={onHover}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPick}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-lg imcrm-px-2 imcrm-py-1.5 imcrm-text-left',
                active && enabled && 'imcrm-bg-accent',
                !enabled && 'imcrm-cursor-default imcrm-opacity-60',
            )}
            data-testid={`share-option-${o.kind}`}
        >
            {o.kind === 'team' ? (
                <TeamGlyph team={o} size="md" />
            ) : o.kind === 'email' ? (
                <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground" aria-hidden>
                    <Mail className="imcrm-h-3.5 imcrm-w-3.5" />
                </span>
            ) : (
                <PersonAvatar name={o.name} outside={o.kind === 'guest'} size="sm" />
            )}
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">
                    {o.kind === 'email' ? sprintf(__('Invitar a %s'), o.email) : o.name}
                </span>
                <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                    {o.kind === 'member'
                        ? o.email
                        : o.kind === 'team'
                          ? sprintf(_n('%d persona', '%d personas', o.count), o.count)
                          : sprintf(
                                __('Ve sólo esta lista y entra con «%s». No ocupa un usuario de tu plan.'),
                                __(GUEST_LEVEL_LABELS[guestLevel]),
                            )}
                </span>
            </span>
            {has && <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">{__('Ya tiene acceso')}</span>}
        </button>
    );
}

function AccessRow({
    avatar,
    name,
    sub,
    badge,
    control,
    onRemove,
    removeLabel,
    testId,
}: {
    avatar: JSX.Element;
    name: string;
    sub: string;
    badge?: string;
    control: JSX.Element;
    onRemove: () => void;
    removeLabel: string;
    testId: string;
}): JSX.Element {
    return (
        <li className="imcrm-group imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2 hover:imcrm-bg-muted/30" data-testid={testId}>
            {avatar}
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{name}</span>
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5">
                    {badge && (
                        <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-amber-500/10 imcrm-px-1.5 imcrm-py-px imcrm-text-[10.5px] imcrm-font-medium imcrm-text-amber-700 dark:imcrm-text-amber-300">
                            {badge}
                        </span>
                    )}
                    <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{sub}</span>
                </span>
            </span>
            {control}
            <button
                type="button"
                onClick={onRemove}
                aria-label={removeLabel}
                title={removeLabel}
                className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
            >
                <X className="imcrm-h-4 imcrm-w-4" />
            </button>
        </li>
    );
}

function PersonAvatar({ name, outside = false, size = 'md' }: { name: string; outside?: boolean; size?: 'sm' | 'md' }): JSX.Element {
    return (
        <span
            aria-hidden
            className={cn(
                'imcrm-inline-flex imcrm-shrink-0 imcrm-select-none imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-font-semibold',
                size === 'sm' ? 'imcrm-h-7 imcrm-w-7 imcrm-text-[10px]' : 'imcrm-h-8 imcrm-w-8 imcrm-text-[11px]',
                outside
                    ? 'imcrm-border imcrm-border-dashed imcrm-border-amber-500/60 imcrm-bg-amber-500/10 imcrm-text-amber-700 dark:imcrm-text-amber-300'
                    : 'imcrm-bg-muted imcrm-text-foreground/70 imcrm-ring-1 imcrm-ring-border',
            )}
        >
            {initialsOf(name)}
        </span>
    );
}

/** El nivel como texto con flecha (sin caja hasta pasar el mouse), como en Google Docs. */
const quietSelect =
    'imcrm-h-8 imcrm-shrink-0 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-transparent imcrm-bg-transparent imcrm-pl-2 imcrm-pr-7 imcrm-text-[13px] imcrm-font-medium imcrm-text-foreground/80 imcrm-transition-colors hover:imcrm-border-border hover:imcrm-bg-muted/50 focus-visible:imcrm-border-primary focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/20';

function LevelSelect({
    value,
    onChange,
    label,
    allowCustom = false,
    hideNone = false,
    testId,
}: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    allowCustom?: boolean;
    hideNone?: boolean;
    testId?: string;
}): JSX.Element {
    const current = ACCESS_LEVELS.find((l) => l.id === value);
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            title={current?.hint}
            className={quietSelect}
            data-testid={testId}
        >
            {allowCustom && <option value="custom">{__('Personalizado')}</option>}
            {ACCESS_LEVELS.filter((l) => !hideNone || l.id !== 'none').map((l) => (
                <option key={l.id} value={l.id}>
                    {l.label}
                </option>
            ))}
        </select>
    );
}

function GuestLevelPicker({ value, onChange, label }: { value: GuestLevel; onChange: (l: GuestLevel) => void; label: string }): JSX.Element {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as GuestLevel)}
            aria-label={label}
            title={__(GUEST_LEVEL_HINTS[value])}
            className={quietSelect}
            data-testid="guest-level"
        >
            {GUEST_LEVELS.map((l) => (
                <option key={l} value={l}>
                    {__(GUEST_LEVEL_LABELS[l])}
                </option>
            ))}
        </select>
    );
}
