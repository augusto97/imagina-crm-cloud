import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Hash, Lock, Search, Variable } from 'lucide-react';
import { parseTeamsChannelRef, parseTeamsChatRef, type TeamsChannelOption } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { MergeTagInput } from './MergeTagInput';

/**
 * Microsoft Teams (v0.1.348) — el destino de un mensaje. Teams no muestra los
 * identificadores de un canal: lo natural es ELEGIRLO de una lista (los
 * equipos y canales de la cuenta conectada) o pegar el vínculo que da Teams.
 * Abajo se ve a qué canal apunta lo que hay, o por qué no se entiende.
 */
export function TeamsChannelField({
    connectionId,
    value,
    onChange,
    fields,
}: {
    connectionId: number;
    value: string;
    onChange: (next: string) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const q = useQuery({
        queryKey: ['teams-channels', connectionId],
        queryFn: async () => (await api.get<TeamsChannelOption[]>(`/connections/${connectionId}/teams/channels`)).data ?? [],
        enabled: open,
        retry: false,
        staleTime: 5 * 60_000,
    });

    const ref = parseTeamsChannelRef(value);
    // El nombre del equipo sale de la lista si ya se cargó.
    const teamName = ref ? q.data?.find((t) => t.team_id === ref.teamId)?.team_name ?? ref.teamName : null;
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const teams = q.data ?? [];
        if (needle === '') return teams;
        return teams
            .map((t) => ({
                ...t,
                channels: t.team_name.toLowerCase().includes(needle)
                    ? t.channels
                    : t.channels.filter((c) => c.name.toLowerCase().includes(needle)),
            }))
            .filter((t) => t.channels.length > 0);
    }, [q.data, query]);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="imcrm-teams-channel">
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <MergeTagInput
                        value={value}
                        onChange={onChange}
                        fields={fields}
                        placeholder={__('Vínculo del canal o {{campo}}')}
                    />
                </div>
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="imcrm-shrink-0" data-testid="imcrm-teams-pick">
                            <Hash className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Elegir canal')}
                            <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5 imcrm-opacity-60" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="imcrm-w-80 imcrm-p-0" data-testid="imcrm-teams-picker">
                        <div className="imcrm-border-b imcrm-border-border imcrm-p-2">
                            <div className="imcrm-relative">
                                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2 imcrm-top-2.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={__('Buscar equipo o canal')}
                                    className="imcrm-h-8 imcrm-pl-7"
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="imcrm-max-h-72 imcrm-overflow-y-auto imcrm-p-1">
                            {q.isLoading && <p className="imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando tus equipos…')}</p>}
                            {q.isError && (
                                <p className="imcrm-p-3 imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-teams-pick-error">
                                    {q.error instanceof Error ? q.error.message : __('No pudimos leer tus equipos de Teams.')}
                                </p>
                            )}
                            {q.data && filtered.length === 0 && (
                                <p className="imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground">
                                    {q.data.length === 0
                                        ? __('La cuenta conectada no es miembro de ningún equipo de Teams.')
                                        : __('No hay canales con ese nombre.')}
                                </p>
                            )}
                            {filtered.map((team) => (
                                <div key={team.team_id} className="imcrm-py-1">
                                    <p className="imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                        {team.team_name}
                                    </p>
                                    {team.channels.map((ch) => {
                                        const chosen = ref?.channelId === ch.id && ref.teamId === team.team_id;
                                        return (
                                            <button
                                                key={ch.id}
                                                type="button"
                                                onClick={() => {
                                                    onChange(ch.link);
                                                    setOpen(false);
                                                }}
                                                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-muted focus-visible:imcrm-bg-muted focus-visible:imcrm-outline-none"
                                                data-testid="imcrm-teams-channel-option"
                                            >
                                                {ch.private ? (
                                                    <Lock className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                                ) : (
                                                    <Hash className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                                )}
                                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{ch.name}</span>
                                                {chosen && <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            <TeamsTargetStatus kind="channel" value={value} channelName={ref?.channelName ?? null} teamName={teamName} ok={ref !== null} />
        </div>
    );
}

/** Debajo del campo «Chat»: si el vínculo pegado se entiende. */
export function TeamsChatStatus({ value }: { value: string }): JSX.Element | null {
    return <TeamsTargetStatus kind="chat" value={value} channelName={null} teamName={null} ok={parseTeamsChatRef(value) !== null} />;
}

function TeamsTargetStatus({
    kind,
    value,
    channelName,
    teamName,
    ok,
}: {
    kind: 'channel' | 'chat';
    value: string;
    channelName: string | null;
    teamName: string | null;
    ok: boolean;
}): JSX.Element | null {
    const text = value.trim();
    if (text === '') return null;
    if (/\{\{[^}]+\}\}/.test(text)) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="imcrm-teams-target">
                <Variable className="imcrm-h-3 imcrm-w-3" />
                {kind === 'channel'
                    ? __('El canal sale de una variable: tiene que traer el vínculo de un canal.')
                    : __('El chat sale de una variable: tiene que traer el vínculo de un chat.')}
            </p>
        );
    }
    if (!ok) {
        return (
            <p className="imcrm-text-[11px] imcrm-text-destructive" data-testid="imcrm-teams-target">
                {kind === 'channel'
                    ? __('No reconocemos ese canal. Elígelo con «Elegir canal» o pega el vínculo que da Teams («…» junto al canal → «Obtener vínculo al canal»).')
                    : __('No reconocemos ese chat. Pega el vínculo de un mensaje del chat («…» sobre un mensaje → «Copiar vínculo»).')}
            </p>
        );
    }
    return (
        <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-success" data-testid="imcrm-teams-target">
            <CheckCircle2 className="imcrm-h-3 imcrm-w-3" />
            {kind === 'channel'
                ? channelName
                    ? teamName
                        ? sprintf(__('Canal «%1$s» de «%2$s»'), channelName, teamName)
                        : sprintf(__('Canal «%s»'), channelName)
                    : __('Canal de Teams reconocido')
                : __('Chat de Teams reconocido')}
        </p>
    );
}
