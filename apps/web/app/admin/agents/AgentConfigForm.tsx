import { useMemo, useState } from 'react';
import { AlertTriangle, Search, X } from 'lucide-react';
import {
    AI_AGENT_DEFAULTS,
    AI_AGENT_MAX_STEPS,
    AI_AGENT_MODE_LABELS,
    AI_AGENT_MODES,
    AI_AGENT_TOOLS,
    AI_AGENT_TOOL_META,
    type AiAgentMode,
    type AiAgentTool,
} from '@imagina-base/shared';

import { IconSquare } from '@/admin/lists/FolderBadge';
import { IconCatalogPicker } from '@/admin/lists/IconCatalogPicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/components/ui/user-picker';
import { useLists } from '@/hooks/useLists';
import { useMemberNames } from '@/hooks/useWpUsers';
import { __ } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { cn } from '@/lib/utils';

import { agentColor, agentIcon } from './agentUi';

/** Lo que se edita de un agente (mismo shape que el alta). */
export interface AgentDraft {
    name: string;
    description: string;
    color: string | null;
    icon: string | null;
    instructions: string;
    list_ids: number[];
    tools: AiAgentTool[];
    mode: AiAgentMode;
    client_comments: boolean;
    reviewer_user_ids: number[];
    max_steps: number;
    max_runs_per_day: number;
    /** null = sin tope propio (manda la cuota del plan). */
    monthly_token_budget: number | null;
}

export function emptyDraft(): AgentDraft {
    return {
        name: '',
        description: '',
        color: null,
        icon: 'robot',
        instructions: '',
        list_ids: [],
        tools: ['read_record', 'search_records', 'update_fields', 'comment'],
        mode: 'propose',
        client_comments: false,
        reviewer_user_ids: [],
        max_steps: AI_AGENT_DEFAULTS.max_steps,
        max_runs_per_day: AI_AGENT_DEFAULTS.max_runs_per_day,
        monthly_token_budget: AI_AGENT_DEFAULTS.monthly_token_budget,
    };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <div>
                <h3 className="imcrm-text-sm imcrm-font-semibold">{title}</h3>
                {hint && <p className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

/**
 * E6 — Configuración de un agente: quién es, qué hace, dónde trabaja, con qué
 * herramientas, cómo aplica los cambios y sus topes. El servidor re-chequea
 * todo contra el acceso de quien guarda (nadie le da a un agente más de lo
 * que tiene); aquí sólo se arma.
 */
export function AgentConfigForm({
    draft,
    onChange,
    errors = {},
}: {
    draft: AgentDraft;
    onChange: (next: AgentDraft) => void;
    errors?: Record<string, string>;
}): JSX.Element {
    const lists = useLists();
    const [listQuery, setListQuery] = useState('');
    const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]): void => onChange({ ...draft, [key]: value });
    const allLists = useMemo(() => lists.data ?? [], [lists.data]);
    const shownLists = useMemo(() => {
        const q = listQuery.trim().toLowerCase();
        return q === '' ? allLists : allLists.filter((l) => l.name.toLowerCase().includes(q) || l.slug.includes(q));
    }, [allLists, listQuery]);
    const reviewers = useMemberNames(draft.reviewer_user_ids);
    const toggle = <T,>(arr: readonly T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    const errorFor = (prefix: string): string | undefined => Object.entries(errors).find(([k]) => k === prefix || k.startsWith(`${prefix}.`))?.[1];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6" data-testid="agent-config">
            <Section title={__('El agente')}>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <Popover>
                        <PopoverTrigger asChild>
                            <button type="button" className="imcrm-rounded-lg imcrm-ring-offset-2 focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary" aria-label={__('Color e ícono')}>
                                <IconSquare icon={agentIcon(draft.icon)} color={agentColor(draft.color)} size="lg" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="imcrm-w-[340px]">
                            <IconCatalogPicker icon={draft.icon} color={draft.color} onChange={(n) => onChange({ ...draft, icon: n.icon, color: n.color })} />
                        </PopoverContent>
                    </Popover>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-2">
                        <div>
                            <Label htmlFor="agent-name">{__('Nombre')}</Label>
                            <Input id="agent-name" value={draft.name} maxLength={80} placeholder={__('Ej.: Clasificador de tickets')} onChange={(e) => set('name', e.target.value)} />
                            {errorFor('name') && <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">{errorFor('name')}</p>}
                        </div>
                        <div>
                            <Label htmlFor="agent-description">{__('Descripción (opcional)')}</Label>
                            <Input id="agent-description" value={draft.description} maxLength={500} onChange={(e) => set('description', e.target.value)} />
                        </div>
                    </div>
                </div>
            </Section>

            <Section
                title={__('Qué hace')}
                hint={__('Escríbelo como se lo explicarías a alguien nuevo en el equipo: qué mira, qué decide, qué campos cambia y con qué valores, y cuándo no hace nada.')}
            >
                <Textarea
                    value={draft.instructions}
                    onChange={(e) => set('instructions', e.target.value)}
                    rows={8}
                    maxLength={6000}
                    placeholder={__('Ej.: Lee cada ticket nuevo, elige su prioridad (Alta si hay algo caído) y deja una nota interna con el motivo.')}
                    data-testid="agent-instructions"
                />
                {errorFor('instructions') && <p className="imcrm-text-xs imcrm-text-destructive">{errorFor('instructions')}</p>}
            </Section>

            <Section title={__('Dónde trabaja')} hint={__('Sólo lee y cambia registros de estas listas.')}>
                {allLists.length > 8 && (
                    <div className="imcrm-relative">
                        <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2.5 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        <Input value={listQuery} onChange={(e) => setListQuery(e.target.value)} placeholder={__('Buscar lista')} className="imcrm-pl-8" />
                    </div>
                )}
                <div className="imcrm-grid imcrm-max-h-64 imcrm-grid-cols-1 imcrm-gap-1 imcrm-overflow-y-auto sm:imcrm-grid-cols-2" data-testid="agent-lists">
                    {shownLists.map((l) => {
                        const checked = draft.list_ids.includes(l.id);
                        return (
                            <label
                                key={l.id}
                                className={cn(
                                    'imcrm-flex imcrm-min-h-10 imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-1.5 imcrm-text-sm',
                                    checked ? 'imcrm-border-primary/50 imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-muted/40',
                                )}
                            >
                                <input type="checkbox" checked={checked} onChange={() => set('list_ids', toggle(draft.list_ids, l.id))} className="imcrm-h-4 imcrm-w-4" />
                                <IconSquare icon={listIcon(l.icon) ?? DEFAULT_LIST_ICON} color={listColor(l.color)} size="sm" />
                                <span className="imcrm-truncate">{l.name}</span>
                            </label>
                        );
                    })}
                </div>
                {errorFor('list_ids') && <p className="imcrm-text-xs imcrm-text-destructive">{errorFor('list_ids')}</p>}
            </Section>

            <Section title={__('Herramientas')} hint={__('Elige sólo lo necesario. Nunca puede más que quien lo guarda: si tu rol no permite algo, el agente tampoco.')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="agent-tools">
                    {AI_AGENT_TOOLS.map((t) => {
                        const meta = AI_AGENT_TOOL_META[t];
                        const checked = draft.tools.includes(t);
                        return (
                            <label key={t} className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 hover:imcrm-bg-muted/40" data-tool={t}>
                                <input type="checkbox" checked={checked} onChange={() => set('tools', toggle(draft.tools, t))} className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4" />
                                <span className="imcrm-min-w-0">
                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                        {meta.label}
                                        {meta.risky && <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-[hsl(var(--imcrm-warning-ink))]" aria-label={__('Sale de la app')} />}
                                    </span>
                                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{meta.help}</span>
                                </span>
                            </label>
                        );
                    })}
                </div>
                {errorFor('tools') && <p className="imcrm-text-xs imcrm-text-destructive">{errorFor('tools')}</p>}
                {draft.tools.includes('comment') && (
                    <label className="imcrm-ml-8 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                        <input type="checkbox" checked={draft.client_comments} onChange={(e) => set('client_comments', e.target.checked)} className="imcrm-h-4 imcrm-w-4" />
                        {__('Puede escribir comentarios visibles para el cliente (en su portal)')}
                    </label>
                )}
            </Section>

            <Section title={__('Cómo aplica los cambios')}>
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2" role="radiogroup" data-testid="agent-mode">
                    {AI_AGENT_MODES.map((m) => (
                        <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={draft.mode === m}
                            onClick={() => set('mode', m)}
                            className={cn(
                                'imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-0.5 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left',
                                draft.mode === m ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary/30' : 'imcrm-border-border hover:imcrm-bg-muted/40',
                            )}
                            data-mode={m}
                        >
                            <span className="imcrm-text-sm imcrm-font-medium">{AI_AGENT_MODE_LABELS[m]}</span>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {m === 'propose'
                                    ? __('Deja los cambios como propuesta en el registro; una persona los aplica o los descarta. Recomendado para empezar.')
                                    : __('Cambia los registros solo, por los mismos caminos que una persona. Queda todo en la actividad.')}
                            </span>
                        </button>
                    ))}
                </div>
                {draft.mode === 'propose' && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('Quiénes revisan las propuestas')}</Label>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Les llega un aviso y las ven en «Mi trabajo». Sin nadie elegido, las revisa quien guarda el agente.')}</p>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            {draft.reviewer_user_ids.map((id) => (
                                <span key={id} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-xs">
                                    {reviewers.data?.get(id) ?? `#${id}`}
                                    <button type="button" aria-label={__('Quitar')} onClick={() => set('reviewer_user_ids', draft.reviewer_user_ids.filter((x) => x !== id))}>
                                        <X className="imcrm-h-3 imcrm-w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="imcrm-max-w-xs">
                            <UserPicker
                                value={null}
                                onChange={(id) => {
                                    if (id !== null && !draft.reviewer_user_ids.includes(id)) set('reviewer_user_ids', [...draft.reviewer_user_ids, id]);
                                }}
                                placeholder={__('Agregar a alguien')}
                                excludeGuests
                            />
                        </div>
                        {errorFor('settings') && <p className="imcrm-text-xs imcrm-text-destructive">{errorFor('settings')}</p>}
                    </div>
                )}
            </Section>

            <Section title={__('Topes')} hint={__('Si llega a un tope, la corrida no sigue y te avisa una vez.')}>
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-3">
                    <div>
                        <Label htmlFor="agent-steps">{__('Pasos por corrida')}</Label>
                        <Input
                            id="agent-steps"
                            type="number"
                            min={1}
                            max={AI_AGENT_MAX_STEPS}
                            value={draft.max_steps}
                            onChange={(e) => set('max_steps', clampInt(e.target.value, 1, AI_AGENT_MAX_STEPS, draft.max_steps))}
                        />
                    </div>
                    <div>
                        <Label htmlFor="agent-runs">{__('Corridas por día')}</Label>
                        <Input
                            id="agent-runs"
                            type="number"
                            min={1}
                            max={10000}
                            value={draft.max_runs_per_day}
                            onChange={(e) => set('max_runs_per_day', clampInt(e.target.value, 1, 10000, draft.max_runs_per_day))}
                        />
                    </div>
                    <div>
                        <Label htmlFor="agent-budget">{__('Tokens por mes')}</Label>
                        <Input
                            id="agent-budget"
                            type="number"
                            min={1000}
                            step={1000}
                            value={draft.monthly_token_budget ?? ''}
                            placeholder={__('Sin tope propio')}
                            onChange={(e) => set('monthly_token_budget', e.target.value === '' ? null : clampInt(e.target.value, 1000, 1_000_000_000, draft.monthly_token_budget ?? 1000))}
                        />
                    </div>
                </div>
            </Section>
            {Object.keys(errors).length > 0 && !errorFor('name') && !errorFor('instructions') && !errorFor('list_ids') && !errorFor('tools') && !errorFor('settings') && (
                <p className="imcrm-text-xs imcrm-text-destructive">{Object.values(errors)[0]}</p>
            )}
        </div>
    );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}
