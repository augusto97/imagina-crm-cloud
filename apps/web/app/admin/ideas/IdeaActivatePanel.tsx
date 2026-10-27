import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Loader2, Lock, PencilLine, Plug, Sparkles } from 'lucide-react';
import type { Connection } from '@imagina-base/shared';

import type { AutomationFormState } from '@/admin/automations/config-editors';
import { RoleFieldMapper } from '@/admin/templates/RoleFieldMapper';
import { useSession } from '@/cloud/session';
import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAutomations, useCreateAutomation } from '@/hooks/useAutomations';
import { useApplyDashboardTemplate, useDashboardTemplates } from '@/hooks/useDashboardTemplates';
import { useFields } from '@/hooks/useFields';
import { useApplyListTemplate, useListTemplates } from '@/hooks/useListTemplates';
import { useLists } from '@/hooks/useLists';
import { api } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { buildIdeaAutomations, defaultRawAnswer, personEmailTag, resolveAnswers, suggestIdeaMapping, suggestList, type AnswerEnv } from './activate';
import type { IdeaDef, IdeaPlan, IdeaQuestion } from './types';

/**
 * El panel «Actívala» de una idea (v0.1.323, ADR-S76). Para las de
 * automatizaciones el caso común es UN clic: la lista sugerida por su nombre,
 * los campos sugeridos por nombre y tipo (`suggestRoleMapping`) y respuestas
 * por defecto; lo que falta se marca en ámbar con la explicación de qué hacer.
 */

const APP_NAMES: Record<string, string> = {
    whatsapp: 'WhatsApp',
    whatsapp_cloud: 'WhatsApp oficial',
    telegram: 'Telegram',
    slack: 'Slack',
    mercadopago: 'Mercado Pago',
    wompi: 'Wompi',
    google_sheets: 'Google Sheets',
    google_calendar: 'Google Calendar',
};

export function appName(key: string): string {
    return APP_NAMES[key] ?? key;
}

function useConnections(): Connection[] {
    const q = useQuery({
        queryKey: ['connections'],
        queryFn: async () => (await api.get<Connection[]>('/connections')).data ?? [],
        retry: false,
        staleTime: 60_000,
    });
    return q.data ?? [];
}

function capabilityFor(plan: IdeaPlan): string | undefined {
    switch (plan.kind) {
        case 'automations':
            return CAP.MANAGE_AUTOMATIONS;
        case 'list':
            return CAP.MANAGE_LISTS;
        case 'dashboard':
            return CAP.MANAGE_DASHBOARDS;
        case 'go':
            if (!plan.capability) return undefined;
            return plan.capability === 'workspace_admin' ? 'workspace_admin' : CAP[plan.capability as keyof typeof CAP];
    }
}

export function IdeaActivatePanel({ idea }: { idea: IdeaDef }): JSX.Element {
    const cap = capabilityFor(idea.plan);
    const allowed = useCan((cap ?? CAP.VIEW_RECORDS) as Parameters<typeof useCan>[0]) || cap === undefined;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-sm" data-testid="idea-activate" data-tour="ideas-activate">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-primary-foreground">
                    <Sparkles className="imcrm-h-4 imcrm-w-4" aria-hidden />
                </span>
                <h2 className="imcrm-text-base imcrm-font-semibold">{idea.plan.kind === 'go' ? __('Ponla en marcha') : __('Actívala')}</h2>
            </div>
            {!allowed ? (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground" data-testid="idea-not-allowed">
                    <Lock className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    {__('Esto lo activa un administrador de la empresa. Compártele esta idea: el enlace de esta página lleva directo aquí.')}
                </p>
            ) : idea.plan.kind === 'automations' ? (
                <AutomationsActivator idea={idea} plan={idea.plan} />
            ) : idea.plan.kind === 'list' ? (
                <ListActivator plan={idea.plan} />
            ) : idea.plan.kind === 'dashboard' ? (
                <DashboardActivator idea={idea} plan={idea.plan} />
            ) : (
                <GoActivator idea={idea} plan={idea.plan} />
            )}
        </section>
    );
}

// ── Requisitos: apps conectadas ─────────────────────────────────────────────

function NeedsApps({ idea, connections }: { idea: IdeaDef; connections: Connection[] }): JSX.Element | null {
    const needs = idea.needsApps ?? [];
    if (needs.length === 0) return null;
    const connected = new Set(connections.map((c) => c.integration_key).filter((k): k is string => k !== null));
    const any = needs.some((k) => connected.has(k));
    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-3', any ? 'imcrm-border-border' : 'imcrm-border-amber-400/60 imcrm-bg-amber-50/60 dark:imcrm-bg-amber-500/10')}>
            <span className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {needs.length > 1 ? __('Necesita una de estas apps conectada') : __('Necesita esta app conectada')}
            </span>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                {needs.map((k) => (
                    <span key={k} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-py-1 imcrm-text-xs">
                        <IntegrationLogo integrationKey={k} size={16} />
                        {appName(k)}
                        {connected.has(k) && <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-success" aria-label={__('Conectada')} />}
                    </span>
                ))}
            </div>
            {!any && (
                <Link to="/settings?s=conectores" className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-primary hover:imcrm-underline" data-testid="idea-connect-app">
                    <Plug className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {__('Conectarla en Integraciones')}
                </Link>
            )}
        </div>
    );
}

// ── Elegir la lista ─────────────────────────────────────────────────────────

function ListPicker({
    lists,
    value,
    onChange,
    suggested,
    label = __('En qué lista'),
}: {
    lists: ListSummary[];
    value: number | null;
    onChange: (id: number | null) => void;
    suggested?: ListSummary;
    label?: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor="idea-list">{label}</Label>
            <Select id="idea-list" value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} data-testid="idea-list">
                <option value="">{lists.length === 0 ? __('Todavía no tienes listas') : __('— Elige una lista —')}</option>
                {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                        {l.name}
                        {suggested?.id === l.id ? ` · ${__('sugerida')}` : ''}
                    </option>
                ))}
            </Select>
        </div>
    );
}

/** La lista elegida: la de `?lista=` (si vino desde una lista), si no la sugerida por nombre. */
function usePickedList(idea: IdeaDef): { lists: ListSummary[]; suggested: ListSummary | undefined; listId: number | null; setListId: (id: number | null) => void; list: ListSummary | undefined } {
    const lists = useLists();
    const allLists = useMemo(() => lists.data ?? [], [lists.data]);
    const [params] = useSearchParams();
    const fromUrl = params.get('lista');
    const suggested = useMemo(() => allLists.find((l) => l.slug === fromUrl) ?? suggestList(idea, allLists), [idea, allLists, fromUrl]);
    const [listId, setListId] = useState<number | null>(null);
    useEffect(() => {
        if (listId === null && suggested) setListId(suggested.id);
    }, [listId, suggested]);
    return { lists: allLists, suggested, listId, setListId, list: allLists.find((l) => l.id === listId) };
}

// ── Automatizaciones ────────────────────────────────────────────────────────

function optionsOf(field: FieldEntity | undefined): Array<{ value: string; label: string }> {
    const raw = field?.config.options;
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((o): o is { value: unknown; label: unknown } => typeof o === 'object' && o !== null)
        .map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }));
}

function AutomationsActivator({ idea, plan }: { idea: IdeaDef; plan: Extract<IdeaPlan, { kind: 'automations' }> }): JSX.Element {
    const navigate = useNavigate();
    const { lists: allLists, suggested, listId, setListId, list } = usePickedList(idea);
    const fields = useFields(listId ?? undefined);
    const fieldList = useMemo(() => (fields.data ?? []).filter((f) => f.list_id === listId), [fields.data, listId]);
    const [mapping, setMapping] = useState<Record<string, number>>({});
    useEffect(() => {
        setMapping(suggestIdeaMapping(plan.roles, fieldList));
    }, [plan.roles, fieldList]);
    const connections = useConnections();
    const myEmail = useSession((s) => s.user?.email ?? '');
    const existing = useAutomations(listId ?? undefined);

    const slugById = useMemo(() => new Map(fieldList.map((f) => [f.id, f.slug])), [fieldList]);
    const roleToSlug = useMemo(() => {
        const out: Record<string, string> = {};
        for (const [role, id] of Object.entries(mapping)) {
            const slug = slugById.get(id);
            if (slug) out[role] = slug;
        }
        return out;
    }, [mapping, slugById]);
    const env: AnswerEnv = useMemo(() => {
        const roleOptions: AnswerEnv['roleOptions'] = {};
        for (const [role, id] of Object.entries(mapping)) roleOptions[role] = optionsOf(fieldList.find((f) => f.id === id));
        return {
            myEmail,
            roleOptions,
            mappedRoles: new Set(Object.keys(roleToSlug)),
            connections: connections.map((c) => ({ id: c.id, integration_key: c.integration_key, name: c.name })),
        };
    }, [mapping, fieldList, myEmail, roleToSlug, connections]);

    // Respuestas: el valor por defecto se recalcula mientras la persona no toque la pregunta.
    const [touched, setTouched] = useState<Record<string, string | string[]>>({});
    const raw = useMemo(() => {
        const out: Record<string, string | string[]> = {};
        for (const q of plan.questions) out[q.key] = touched[q.key] ?? defaultRawAnswer(q, env);
        return out;
    }, [plan.questions, touched, env]);
    useEffect(() => setTouched({}), [listId]);

    const built = useMemo(
        () =>
            buildIdeaAutomations(plan.automations, plan.roles, {
                roleToSlug,
                answers: resolveAnswers(plan.questions, raw),
                connectionApps: Object.fromEntries(connections.map((c) => [c.id, c.integration_key])),
            }),
        [plan, roleToSlug, raw, connections],
    );

    const create = useCreateAutomation(listId ?? 0);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [limitHit, setLimitHit] = useState(false);
    const [created, setCreated] = useState<Array<{ id: number; name: string; active: boolean }>>([]);
    useEffect(() => {
        setCreated([]);
        setError(null);
        setLimitHit(false);
    }, [listId]);

    const duplicates = (existing.data ?? []).filter((a) => plan.automations.some((p) => p.name === a.name));
    const ready = list !== undefined && built.problems.length === 0 && !saving;
    const finished = list !== undefined && created.length === built.automations.length && created.length > 0;

    /**
     * Guarda las que faltan (`created` ya tiene las que se guardaron antes de
     * un error). Con el tope de automatizaciones activas del plan lleno, la
     * misma idea se puede guardar EN PAUSA y activar cuando haya lugar.
     */
    const activate = async (active: boolean): Promise<void> => {
        if (!list) return;
        setSaving(true);
        setError(null);
        const done = [...created];
        try {
            for (const input of built.automations.slice(done.length)) {
                const a = await create.mutateAsync({ ...input, is_active: active } as Parameters<typeof create.mutateAsync>[0]);
                done.push({ id: a.id, name: a.name, active });
            }
            setLimitHit(false);
        } catch (err) {
            const code = (err as { code?: unknown }).code;
            setLimitHit(code === 'plan_limit_reached');
            setError(err instanceof Error ? err.message : __('No se pudo activar.'));
        } finally {
            setCreated(done);
            setSaving(false);
        }
    };

    const openInEditor = (): void => {
        const auto = built.automations[0];
        if (!list || !auto) return;
        const preset: AutomationFormState = {
            name: auto.name,
            description: auto.description ?? '',
            triggerType: auto.trigger_type,
            triggerConfig: (auto.trigger_config ?? {}) as AutomationFormState['triggerConfig'],
            actions: auto.actions as AutomationFormState['actions'],
            isActive: true,
        };
        navigate(`/lists/${list.slug}/automations/new`, { state: { preset } });
    };

    if (finished && list) {
        const paused = created.some((c) => !c.active);
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="idea-done">
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-success/10 imcrm-p-3 imcrm-text-sm imcrm-text-success">
                    <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    {paused
                        ? sprintf(__('Quedó guardada en «%s», en pausa: actívala desde las automatizaciones de la lista cuando tu plan tenga lugar.'), list.name)
                        : sprintf(_n('¡Listo! Quedó activa en «%s».', '¡Listo! Quedaron activas en «%s».', created.length), list.name)}
                </p>
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {created.map((c) => (
                        <li key={c.id}>
                            <Link to={`/lists/${list.slug}/automations/${c.id}`} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-sm hover:imcrm-bg-accent">
                                <PencilLine className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{c.name}</span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Ver o cambiar')}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('En el editor puedes probarla con un registro real («Probar») antes de que ocurra de verdad, o pausarla cuando quieras.')}</p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    <Button asChild size="sm">
                        <Link to={`/lists/${list.slug}/records`}>{sprintf(__('Ir a «%s»'), list.name)}</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                        <Link to="/ideas">{__('Ver más ideas')}</Link>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <NeedsApps idea={idea} connections={connections} />
            <ListPicker lists={allLists} value={listId} onChange={setListId} suggested={suggested} />
            {list && (
                <>
                    {plan.roles.length > 0 && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <span className="imcrm-text-sm imcrm-font-medium">{__('Qué campo es cada cosa')}</span>
                            {fields.isLoading ? (
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden />
                                    {__('Mirando los campos de la lista…')}
                                </p>
                            ) : (
                                <RoleFieldMapper roles={plan.roles} fields={fieldList} value={mapping} onChange={setMapping} idPrefix="idea-role" />
                            )}
                        </div>
                    )}
                    {plan.questions.length > 0 && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                            {plan.questions.map((q) => (
                                <QuestionField
                                    key={q.key}
                                    q={q}
                                    value={raw[q.key] ?? ''}
                                    env={env}
                                    connections={connections}
                                    onChange={(v) => setTouched((t) => ({ ...t, [q.key]: v }))}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
            {list && built.problems.length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-lg imcrm-bg-amber-50 imcrm-p-3 imcrm-text-sm imcrm-text-amber-900 dark:imcrm-bg-amber-500/10 dark:imcrm-text-amber-200" data-testid="idea-problems">
                    {built.problems.map((p) => (
                        <li key={p} className="imcrm-flex imcrm-items-start imcrm-gap-2">
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                            {p}
                        </li>
                    ))}
                </ul>
            )}
            {duplicates.length > 0 && (
                <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="idea-duplicate">
                    {sprintf(__('Esta lista ya tiene «%s». Activarla de nuevo crea otra igual.'), duplicates[0]!.name)}
                </p>
            )}
            {error && (
                <p className="imcrm-text-sm imcrm-text-destructive" data-testid="idea-error">
                    {error}
                </p>
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                {limitHit && (
                    <Button variant="outline" onClick={() => void activate(false)} disabled={!ready} data-testid="idea-save-paused">
                        {__('Guardarla en pausa')}
                    </Button>
                )}
                <Button onClick={() => void activate(true)} disabled={!ready} data-testid="idea-activate-btn">
                    {saving ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden /> : <Sparkles className="imcrm-h-4 imcrm-w-4" aria-hidden />}
                    {plan.automations.length > 1 ? sprintf(__('Activar las %d automatizaciones'), plan.automations.length) : __('Activar')}
                </Button>
                {plan.automations.length === 1 && list && (
                    <Button variant="outline" onClick={openInEditor} disabled={built.automations.length === 0} data-testid="idea-open-editor">
                        {__('Revisarla antes en el editor')}
                    </Button>
                )}
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Queda activa y la puedes cambiar, probar o pausar cuando quieras desde las automatizaciones de la lista.')}
                </p>
            </div>
        </div>
    );
}

function QuestionField({
    q,
    value,
    env,
    connections,
    onChange,
}: {
    q: IdeaQuestion;
    value: string | string[];
    env: AnswerEnv;
    connections: Connection[];
    onChange: (v: string | string[]) => void;
}): JSX.Element | null {
    const id = `idea-q-${q.key}`;
    const str = Array.isArray(value) ? value.join(',') : value;
    const label = (
        <Label htmlFor={id} className="imcrm-text-sm">
            {q.label}
        </Label>
    );
    const help = q.help ? <p className="imcrm-text-xs imcrm-text-muted-foreground">{q.help}</p> : null;
    switch (q.kind) {
        case 'email': {
            const tag = q.personRole ? personEmailTag(q.personRole) : null;
            const canPerson = q.personRole !== undefined && env.mappedRoles.has(q.personRole);
            const toPerson = tag !== null && str === tag;
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {label}
                    {canPerson && tag && (
                        <div className="imcrm-flex imcrm-gap-2" role="radiogroup" aria-label={q.label}>
                            <Chip active={toPerson} onClick={() => onChange(tag)}>{__('Al responsable')}</Chip>
                            <Chip active={!toPerson} onClick={() => onChange(toPerson ? env.myEmail : str)}>{__('A un correo')}</Chip>
                        </div>
                    )}
                    {!toPerson && <Input id={id} type="text" inputMode="email" value={str} onChange={(e) => onChange(e.target.value)} placeholder="nombre@empresa.com" />}
                    {help}
                </div>
            );
        }
        case 'option': {
            const options = env.roleOptions[q.role] ?? [];
            if (q.multiple) {
                const selected = Array.isArray(value) ? value : value === '' ? [] : [value];
                return (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <span className="imcrm-text-sm imcrm-font-medium">{q.label}</span>
                        {options.length === 0 ? (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Elige primero el campo arriba.')}</p>
                        ) : (
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                                {options.map((o) => (
                                    <Chip
                                        key={o.value}
                                        active={selected.includes(o.value)}
                                        onClick={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                                    >
                                        {o.label}
                                    </Chip>
                                ))}
                            </div>
                        )}
                        {help}
                    </div>
                );
            }
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {label}
                    <Select id={id} value={str} onChange={(e) => onChange(e.target.value)}>
                        <option value="">{options.length === 0 ? __('Elige primero el campo arriba') : __('— Elige —')}</option>
                        {options.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </Select>
                    {help}
                </div>
            );
        }
        case 'days':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {label}
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Input id={id} type="number" min={0} max={365} value={str} onChange={(e) => onChange(e.target.value)} className="imcrm-w-24" />
                        <span className="imcrm-text-sm imcrm-text-muted-foreground">{__('días')}</span>
                    </div>
                    {help}
                </div>
            );
        case 'text':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {label}
                    {q.multiline ? <Textarea id={id} rows={3} value={str} onChange={(e) => onChange(e.target.value)} /> : <Input id={id} value={str} onChange={(e) => onChange(e.target.value)} />}
                    {help}
                </div>
            );
        case 'url':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {label}
                    <Input id={id} type="url" value={str} onChange={(e) => onChange(e.target.value)} placeholder={q.placeholder} />
                    {help}
                </div>
            );
        case 'connection': {
            const options = connections.filter((c) => c.integration_key !== null && q.apps.includes(c.integration_key));
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {label}
                    {options.length === 0 ? (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {sprintf(__('Todavía no conectaste %s.'), q.apps.map(appName).join(' / '))}{' '}
                            <Link to="/settings?s=conectores" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                {__('Conectar')}
                            </Link>
                        </p>
                    ) : (
                        <Select id={id} value={str} onChange={(e) => onChange(e.target.value)}>
                            <option value="">{__('— Elige —')}</option>
                            {options.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.account_label ? ` · ${c.account_label}` : ''}
                                </option>
                            ))}
                        </Select>
                    )}
                    {help}
                </div>
            );
        }
        case 'choice':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {label}
                    <Select id={id} value={str} onChange={(e) => onChange(e.target.value)}>
                        {q.options.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </Select>
                    {help}
                </div>
            );
    }
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                active ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-border imcrm-bg-background hover:imcrm-bg-accent',
            )}
        >
            {active && <Check className="imcrm-h-3 imcrm-w-3" aria-hidden />}
            {children}
        </button>
    );
}

// ── Listas desde una plantilla ──────────────────────────────────────────────

function ListActivator({ plan }: { plan: Extract<IdeaPlan, { kind: 'list' }> }): JSX.Element {
    const templates = useListTemplates();
    const tpl = (templates.data ?? []).find((t) => t.id === plan.template);
    const apply = useApplyListTemplate();
    const [withSample, setWithSample] = useState(true);
    const [result, setResult] = useState<ListSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async (): Promise<void> => {
        setError(null);
        try {
            const r = await apply.mutateAsync({ id: plan.template, input: { include_records: withSample, ...(plan.listName ? { name: plan.listName } : {}) } });
            setResult(r.lists);
        } catch (err) {
            setError(err instanceof Error ? err.message : __('No se pudo crear.'));
        }
    };

    if (result && result.length > 0) {
        const first = result[0]!;
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="idea-done">
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-success/10 imcrm-p-3 imcrm-text-sm imcrm-text-success">
                    <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    {sprintf(_n('¡Listo! Se creó «%s».', '¡Listo! Se crearon %d listas.', result.length), result.length === 1 ? first.name : result.length)}
                </p>
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {result.map((l) => (
                        <li key={l.id}>
                            <Link to={`/lists/${l.slug}/records`} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-sm hover:imcrm-bg-accent">
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{l.name}</span>
                                <ArrowRight className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                            </Link>
                        </li>
                    ))}
                </ul>
                {withSample && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Trae datos de ejemplo: cuando quieras, los borras desde el aviso de arriba de la lista.')}</p>}
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {tpl && (
                <div className="imcrm-rounded-lg imcrm-bg-muted/50 imcrm-p-3 imcrm-text-sm">
                    <span className="imcrm-font-medium">{tpl.name}</span>
                    {tpl.description && <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">{tpl.description}</p>}
                </div>
            )}
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                <input type="checkbox" checked={withSample} onChange={(e) => setWithSample(e.target.checked)} className="imcrm-h-4 imcrm-w-4 imcrm-accent-primary" />
                {__('Con datos de ejemplo para probar')}
            </label>
            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
            <Button onClick={() => void run()} disabled={apply.isPending} data-testid="idea-activate-btn">
                {apply.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden /> : <Sparkles className="imcrm-h-4 imcrm-w-4" aria-hidden />}
                {__('Crear las listas')}
            </Button>
        </div>
    );
}

// ── Tablero desde una plantilla ─────────────────────────────────────────────

function DashboardActivator({ idea, plan }: { idea: IdeaDef; plan: Extract<IdeaPlan, { kind: 'dashboard' }> }): JSX.Element {
    const { lists: allLists, suggested, listId, setListId, list } = usePickedList(idea);
    const fields = useFields(listId ?? undefined);
    const fieldList = useMemo(() => (fields.data ?? []).filter((f) => f.list_id === listId), [fields.data, listId]);
    const templates = useDashboardTemplates();
    const tpl = (templates.data ?? []).find((t) => t.id === plan.template);
    const roleList = tpl?.lists[0];
    const roles = useMemo(() => roleList?.fields ?? [], [roleList]);
    const [mapping, setMapping] = useState<Record<string, number>>({});
    useEffect(() => setMapping(suggestIdeaMapping(roles, fieldList)), [roles, fieldList]);
    const [name, setName] = useState(plan.name);
    const apply = useApplyDashboardTemplate();
    const [done, setDone] = useState<{ id: number; warnings: string[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const missing = roles.filter((r) => r.required && mapping[r.key] === undefined);

    const run = async (): Promise<void> => {
        if (!list || !roleList) return;
        setError(null);
        try {
            const r = await apply.mutateAsync({ id: plan.template, input: { name: name.trim() || plan.name, lists: { [roleList.key]: { list_id: list.id, fields: mapping } } } });
            setDone({ id: r.dashboard.id, warnings: r.warnings });
        } catch (err) {
            setError(err instanceof Error ? err.message : __('No se pudo crear el tablero.'));
        }
    };

    if (done) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="idea-done">
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-success/10 imcrm-p-3 imcrm-text-sm imcrm-text-success">
                    <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    {__('¡Listo! El tablero ya está armado.')}
                </p>
                {done.warnings.length > 0 && <p className="imcrm-text-xs imcrm-text-muted-foreground">{done.warnings.join(' ')}</p>}
                <Button asChild>
                    <Link to={`/dashboards/${done.id}`}>{__('Abrir el tablero')}</Link>
                </Button>
            </div>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <ListPicker lists={allLists} value={listId} onChange={setListId} suggested={suggested} label={__('Con los datos de qué lista')} />
            {list && roles.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <span className="imcrm-text-sm imcrm-font-medium">{__('Qué campo es cada cosa')}</span>
                    <RoleFieldMapper roles={roles} fields={fieldList} value={mapping} onChange={setMapping} idPrefix="idea-dash" />
                </div>
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="idea-dash-name">{__('Nombre del tablero')}</Label>
                <Input id="idea-dash-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {list && missing.length > 0 && (
                <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-300">
                    {sprintf(__('Sin «%s» se omiten los gráficos que lo usan.'), missing.map((m) => m.label).join('», «'))}
                </p>
            )}
            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
            <Button onClick={() => void run()} disabled={!list || !roleList || apply.isPending} data-testid="idea-activate-btn">
                {apply.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden /> : <Sparkles className="imcrm-h-4 imcrm-w-4" aria-hidden />}
                {__('Crear el tablero')}
            </Button>
        </div>
    );
}

// ── Ir a configurar ─────────────────────────────────────────────────────────

function GoActivator({ idea, plan }: { idea: IdeaDef; plan: Extract<IdeaPlan, { kind: 'go' }> }): JSX.Element {
    const navigate = useNavigate();
    const listSection = plan.to.startsWith('list:') ? plan.to.slice('list:'.length) : null;
    const { lists: allLists, suggested, listId, setListId, list } = usePickedList(idea);
    const go = (): void => {
        if (listSection) {
            if (list) navigate(`/lists/${list.slug}/edit?s=${listSection}`);
            return;
        }
        navigate(plan.to);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {listSection && <ListPicker lists={allLists} value={listId} onChange={setListId} suggested={suggested} />}
            <Button onClick={go} disabled={listSection !== null && !list} data-testid="idea-activate-btn">
                {plan.label}
                <ArrowRight className="imcrm-h-4 imcrm-w-4" aria-hidden />
            </Button>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Te llevamos a la pantalla donde se configura; los pasos de la izquierda te guían.')}</p>
        </div>
    );
}
