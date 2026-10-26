import { useMemo, useState } from 'react';
import { Crown, Palette, Pencil, Plus, Search, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import type { Team, TeamMember } from '@imagina-base/shared';

import { IconCatalogPicker } from '@/admin/lists/IconCatalogPicker';
import { TeamGlyph } from '@/components/fields/TeamChip';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateTeam, useDeleteTeam, useTeams, useUpdateTeam } from '@/hooks/useTeams';
import { useWpUsersSearch } from '@/hooks/useWpUsers';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * C1 — Ajustes → Equipos. Los arma quien administra la empresa (o quien
 * tiene «Gestionar equipos»); el backend lo vuelve a exigir en cada cambio.
 * Un equipo agrupa personas del EQUIPO de trabajo: los clientes del portal
 * nunca entran (el servidor los rechaza).
 */
export function TeamsPanel(): JSX.Element {
    const teams = useTeams();
    const del = useDeleteTeam();
    const confirm = useConfirm();
    const toast = useToast();
    const [editing, setEditing] = useState<Team | 'new' | null>(null);
    const [query, setQuery] = useState('');

    const list = useMemo(() => teams.data ?? [], [teams.data]);
    const visible = useMemo(() => {
        const q = fold(query);
        if (q === '') return list;
        return list.filter((t) => fold(t.name).includes(q) || t.members.some((m) => fold(m.name).includes(q)));
    }, [list, query]);

    const remove = async (team: Team): Promise<void> => {
        const ok = await confirm({
            title: sprintf(__('¿Eliminar el equipo «%s»?'), team.name),
            description: __(
                'Las personas siguen en la empresa. Los registros asignados a este equipo quedan sin él y las listas compartidas con el equipo dejan de estarlo.',
            ),
            confirmLabel: __('Eliminar equipo'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await del.mutateAsync(team.id);
            toast.success(sprintf(__('Se eliminó «%s».'), team.name));
        } catch (err) {
            toast.error(__('No se pudo eliminar el equipo.'), err instanceof Error ? err.message : undefined);
        }
    };

    return (
        <Card data-testid="imcrm-teams-panel">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <UsersRound className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>{__('Equipos')}</CardTitle>
                            <CardDescription>
                                {__(
                                    'Agrupa a las personas de tu empresa (Ventas, Soporte…) para asignarles registros con un campo «Equipo», darles acceso a una lista y mencionarlas a todas con @equipo.',
                                )}
                            </CardDescription>
                        </div>
                    </div>
                    <Button size="sm" onClick={() => setEditing('new')} data-testid="imcrm-team-new">
                        <Plus className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Nuevo equipo')}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-3 imcrm-pt-0">
                {list.length > 6 && (
                    <div className="imcrm-relative">
                        <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-4 imcrm-w-4 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" aria-hidden />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={__('Buscar un equipo o una persona')}
                            className="imcrm-pl-8"
                            aria-label={__('Buscar equipos')}
                        />
                    </div>
                )}

                {teams.isLoading && <div className="imcrm-h-24 imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/40" />}

                {!teams.isLoading && list.length === 0 && (
                    <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center">
                        <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay equipos')}</p>
                        <p className="imcrm-mx-auto imcrm-mt-1 imcrm-max-w-md imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Crea el primero —por ejemplo «Ventas»— y suma a las personas que lo forman.')}
                        </p>
                    </div>
                )}

                {visible.length > 0 && (
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                        {visible.map((t) => (
                            <li key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-testid="imcrm-team-row">
                                <TeamGlyph team={t} size="md" />
                                <button
                                    type="button"
                                    onClick={() => setEditing(t)}
                                    className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-left"
                                >
                                    <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium">{t.name}</span>
                                    <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                        {sprintf(_n('%d persona', '%d personas', t.member_count), t.member_count)}
                                        {t.description ? ` · ${t.description}` : ''}
                                    </span>
                                </button>
                                <AvatarStack names={t.members.map((m) => m.name)} total={t.member_count} />
                                <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setEditing(t)}
                                        aria-label={sprintf(__('Editar «%s»'), t.name)}
                                        title={__('Editar')}
                                    >
                                        <Pencil className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => void remove(t)}
                                        aria-label={sprintf(__('Eliminar «%s»'), t.name)}
                                        title={__('Eliminar')}
                                    >
                                        <Trash2 className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                {list.length > 0 && visible.length === 0 && (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Ningún equipo coincide con la búsqueda.')}</p>
                )}
            </CardContent>

            {editing !== null && (
                <TeamEditor team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
            )}
        </Card>
    );
}

function AvatarStack({ names, total }: { names: string[]; total: number }): JSX.Element | null {
    if (total === 0) return null;
    const shown = names.slice(0, 4);
    const rest = total - shown.length;
    return (
        <span className="imcrm-hidden imcrm-shrink-0 imcrm-items-center sm:imcrm-flex" title={names.join(', ')}>
            {shown.map((n, i) => (
                <Avatar key={`${n}-${i}`} name={n} size="sm" className={cn('imcrm-bg-card', i > 0 && '-imcrm-ml-1.5')} />
            ))}
            {rest > 0 && (
                <span className="-imcrm-ml-1.5 imcrm-inline-flex imcrm-h-6 imcrm-min-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-px-1 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                    +{rest}
                </span>
            )}
        </span>
    );
}

interface DraftMember extends TeamMember {
    name: string;
}

function TeamEditor({ team, onClose }: { team: Team | null; onClose: () => void }): JSX.Element {
    const create = useCreateTeam();
    const update = useUpdateTeam();
    const toast = useToast();
    const [name, setName] = useState(team?.name ?? '');
    const [description, setDescription] = useState(team?.description ?? '');
    const [icon, setIcon] = useState<string | null>(team?.icon ?? null);
    const [color, setColor] = useState<string | null>(team?.color ?? null);
    const [members, setMembers] = useState<DraftMember[]>(
        team?.members.map((m) => ({ user_id: m.user_id, is_lead: m.is_lead, name: m.name })) ?? [],
    );
    const [error, setError] = useState<string | null>(null);
    const saving = create.isPending || update.isPending;

    const save = async (): Promise<void> => {
        setError(null);
        if (name.trim() === '') {
            setError(__('El equipo necesita un nombre.'));
            return;
        }
        const payload = {
            name: name.trim(),
            description: description.trim() === '' ? null : description.trim(),
            icon,
            color,
            members: members.map((m) => ({ user_id: m.user_id, is_lead: m.is_lead })),
        };
        try {
            if (team) await update.mutateAsync({ id: team.id, ...payload });
            else await create.mutateAsync(payload);
            toast.success(team ? __('Equipo guardado.') : sprintf(__('Se creó el equipo «%s».'), payload.name));
            onClose();
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar el equipo.'));
        }
    };

    const preview = { id: team?.id ?? 0, name: name || __('Equipo'), icon, color };

    return (
        <Sheet open onOpenChange={(o) => !o && onClose()}>
            <SheetContent data-testid="imcrm-team-editor">
                <SheetHeader>
                    <div>
                        <SheetTitle>{team ? __('Editar equipo') : __('Nuevo equipo')}</SheetTitle>
                        <SheetDescription>
                            {__('Sólo personas del equipo de trabajo: los clientes del portal no forman parte de un equipo.')}
                        </SheetDescription>
                    </div>
                </SheetHeader>
                <SheetBody className="imcrm-space-y-4">
                    <div className="imcrm-flex imcrm-items-end imcrm-gap-2">
                        <Popover>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="imcrm-flex imcrm-h-9 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-px-2 hover:imcrm-bg-accent"
                                    aria-label={__('Color e ícono')}
                                    title={__('Color e ícono')}
                                    data-testid="imcrm-team-icon"
                                >
                                    <TeamGlyph team={preview} size="sm" />
                                    <Palette className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="imcrm-w-[340px] imcrm-p-3">
                                <IconCatalogPicker
                                    icon={icon}
                                    color={color}
                                    onChange={(next) => {
                                        setIcon(next.icon);
                                        setColor(next.color);
                                    }}
                                />
                            </PopoverContent>
                        </Popover>
                        <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-space-y-1.5">
                            <Label htmlFor="imcrm-team-name">{__('Nombre')}</Label>
                            <Input
                                id="imcrm-team-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={__('Ventas')}
                                maxLength={80}
                                autoFocus={!team}
                            />
                        </div>
                    </div>
                    <div className="imcrm-space-y-1.5">
                        <Label htmlFor="imcrm-team-description">{__('Descripción (opcional)')}</Label>
                        <Textarea
                            id="imcrm-team-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                            maxLength={500}
                            placeholder={__('Qué hace este equipo')}
                        />
                    </div>

                    <div className="imcrm-space-y-2">
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                            <Label>{sprintf(__('Personas (%d)'), members.length)}</Label>
                        </div>
                        <MemberSearch
                            exclude={members.map((m) => m.user_id)}
                            onPick={(u) => setMembers((prev) => [...prev, { user_id: u.id, is_lead: false, name: u.name }])}
                        />
                        {members.length === 0 ? (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Todavía no sumaste a nadie.')}</p>
                        ) : (
                            <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border" data-testid="imcrm-team-members">
                                {members.map((m) => (
                                    <li key={m.user_id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-2.5 imcrm-py-1.5">
                                        <Avatar name={m.name} size="sm" />
                                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm">{m.name}</span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setMembers((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, is_lead: !x.is_lead } : x)))
                                            }
                                            className={cn(
                                                'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px]',
                                                m.is_lead
                                                    ? 'imcrm-bg-warning/15 imcrm-font-medium imcrm-text-foreground'
                                                    : 'imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                            )}
                                            aria-pressed={m.is_lead}
                                            title={__('El líder sólo se muestra; no da permisos extra.')}
                                        >
                                            <Crown className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                            {m.is_lead ? __('Líder') : __('Marcar como líder')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setMembers((prev) => prev.filter((x) => x.user_id !== m.user_id))}
                                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                            aria-label={sprintf(__('Quitar a %s'), m.name)}
                                            title={__('Quitar del equipo')}
                                        >
                                            <X className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    {error && (
                        <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert">
                            {error}
                        </p>
                    )}
                </SheetBody>
                <SheetFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        {__('Cancelar')}
                    </Button>
                    <Button onClick={() => void save()} disabled={saving} data-testid="imcrm-team-save">
                        {saving ? __('Guardando…') : team ? __('Guardar') : __('Crear equipo')}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

/** Buscador de personas del equipo de trabajo para sumarlas al equipo. */
function MemberSearch({
    exclude,
    onPick,
}: {
    exclude: number[];
    onPick: (u: { id: number; name: string }) => void;
}): JSX.Element {
    const [q, setQ] = useState('');
    const search = useWpUsersSearch(q, 8);
    const results = (search.data ?? []).filter((u) => !exclude.includes(u.id));
    return (
        <div className="imcrm-relative">
            <UserPlus className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-4 imcrm-w-4 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" aria-hidden />
            <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={__('Buscar una persona para sumarla')}
                className="imcrm-pl-8"
                aria-label={__('Buscar una persona')}
                data-testid="imcrm-team-member-search"
            />
            {q.trim() !== '' && (
                <div className="imcrm-absolute imcrm-left-0 imcrm-right-0 imcrm-top-full imcrm-z-10 imcrm-mt-1 imcrm-max-h-56 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-shadow-imcrm-md">
                    {search.isLoading && <p className="imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">{__('Buscando…')}</p>}
                    {!search.isLoading && results.length === 0 && (
                        <p className="imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">{__('Sin resultados.')}</p>
                    )}
                    {results.map((u) => (
                        <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                                onPick({ id: u.id, name: u.display_name || u.login });
                                setQ('');
                            }}
                            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                        >
                            <Avatar name={u.display_name || u.login} size="sm" />
                            <span className="imcrm-truncate">{u.display_name || u.login}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function fold(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}
