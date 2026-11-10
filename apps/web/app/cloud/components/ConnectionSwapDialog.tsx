import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, X } from 'lucide-react';
import { Link } from 'react-router';
import {
    integrationDef,
    swapAppsCompatible,
    type Connection,
    type ConnectionSwapResult,
    type ConnectionSwapSource,
} from '@imagina-base/shared';
import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { automationsKeys } from '@/hooks/useAutomations';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';

/**
 * v0.1.400 — «Reemplazar en automatizaciones».
 *
 * Desde una conexión DESTINO (la de Whats, por ejemplo): muestra qué acciones
 * de otras conexiones (otra cuenta de la misma app, o WAS) y qué llamadas
 * directas a la API de WAS se pueden pasar a ella, con lo que cambia en cada
 * una y lo que no se puede pasar solo. Desde una conexión ORIGEN («Pasar a
 * otra conexión»), primero se elige a cuál.
 *
 * Nada cambia hasta tocar «Reemplazar»; después cada automatización guarda su
 * versión anterior en «Historial de versiones».
 */
export function connectionLabel(c: Connection): string {
    const app = integrationDef(c.integration_key)?.name ?? c.name;
    return c.custom_name ? c.name : [app, c.account_label].filter(Boolean).join(' · ');
}

/** Las conexiones a las que se puede pasar lo de `from`. */
export function swapTargetsFor(from: Connection, all: Connection[]): Connection[] {
    return all.filter((o) => o.id !== from.id && o.purpose !== 'agenda' && swapAppsCompatible(from.integration_key, o.integration_key));
}

export function ConnectionSwapDialog({
    open,
    onClose,
    connections,
    target: initialTarget,
    from,
}: {
    open: boolean;
    onClose: () => void;
    connections: Connection[];
    /** Abierto desde la conexión destino. */
    target: Connection | null;
    /** Abierto desde la conexión origen («Pasar a otra conexión»). */
    from: Connection | null;
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const targets = useMemo(() => (from ? swapTargetsFor(from, connections) : []), [from, connections]);
    const [targetId, setTargetId] = useState<number | null>(initialTarget?.id ?? (targets.length === 1 ? targets[0]!.id : null));
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [result, setResult] = useState<ConnectionSwapResult | null>(null);
    const target = connections.find((c) => c.id === targetId) ?? initialTarget ?? null;

    const preview = useQuery({
        queryKey: ['connection-swap', tenantId, targetId],
        queryFn: () => api.connectionSwapPreview(targetId!),
        enabled: open && targetId !== null && result === null,
    });
    const sources = useMemo(() => {
        const all = preview.data?.sources ?? [];
        return from ? all.filter((s) => s.key === `conn:${from.id}`) : all;
    }, [preview.data, from]);

    // Lo elegido de entrada: el origen desde el que se abrió, o el único que hay.
    useEffect(() => {
        if (!preview.data) return;
        const ready = sources.filter((s) => s.actions > 0);
        setSelected(new Set(from ? ready.map((s) => s.key) : ready.length === 1 ? [ready[0]!.key] : []));
    }, [preview.data, sources, from]);

    const apply = useMutation({
        mutationFn: () => api.connectionSwap(targetId!, [...selected]),
        onSuccess: (res) => {
            setResult(res);
            void qc.invalidateQueries({ queryKey: ['connections', tenantId] });
            void qc.invalidateQueries({ queryKey: automationsKeys.all });
        },
    });

    const count = sources.filter((s) => selected.has(s.key)).reduce((n, s) => n + s.actions, 0);
    const toggle = (set: Set<string>, key: string): Set<string> => {
        const next = new Set(set);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
    };

    return (
        <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/50" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90dvh] imcrm-w-[min(640px,calc(100vw-2rem))] -imcrm-translate-x-1/2 -imcrm-translate-y-1/2 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-xl"
                    data-testid="connection-swap-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-p-4">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                            <ArrowRightLeft className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {from ? __('Pasar a otra conexión') : __('Reemplazar en automatizaciones')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                                {from
                                    ? sprintf(__('Las acciones que hoy usan «%s» pasan a la conexión que elijas, con su número y su mensaje.'), connectionLabel(from))
                                    : target
                                      ? sprintf(__('Las acciones que elijas pasan a «%s», con su número y su mensaje. No hay que rehacer nada a mano.'), connectionLabel(target))
                                      : ''}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto imcrm-p-4 imcrm-text-sm">
                        {result ? (
                            <SwapDone result={result} target={target} />
                        ) : (
                            <>
                                {from && (
                                    <fieldset className="imcrm-space-y-2" data-testid="connection-swap-targets">
                                        <legend className="imcrm-mb-1 imcrm-font-medium">{__('¿A cuál conexión las pasas?')}</legend>
                                        {targets.length === 0 ? (
                                            <p className="imcrm-text-muted-foreground">
                                                {__('No hay otra conexión de esta app. Conecta primero la nueva (por ejemplo, WhatsApp (Whats)) y vuelve aquí.')}
                                            </p>
                                        ) : (
                                            targets.map((t) => (
                                                <label
                                                    key={t.id}
                                                    className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2 has-[:checked]:imcrm-border-primary has-[:checked]:imcrm-bg-primary/5"
                                                >
                                                    <input
                                                        type="radio"
                                                        name="swap-target"
                                                        className="imcrm-accent-[hsl(var(--imcrm-primary))]"
                                                        checked={targetId === t.id}
                                                        onChange={() => setTargetId(t.id)}
                                                    />
                                                    <IntegrationLogo integrationKey={t.integration_key} size={24} />
                                                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{connectionLabel(t)}</span>
                                                </label>
                                            ))
                                        )}
                                    </fieldset>
                                )}

                                {targetId !== null && preview.isLoading && (
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-muted-foreground">
                                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden />
                                        {__('Buscando en tus automatizaciones…')}
                                    </p>
                                )}
                                {preview.isError && <p className="imcrm-text-destructive">{errText(preview.error)}</p>}

                                {preview.data && sources.length === 0 && (
                                    <p className="imcrm-rounded-lg imcrm-bg-muted imcrm-p-3 imcrm-text-muted-foreground" data-testid="connection-swap-empty">
                                        {target && (target.integration_key === 'whatsapp_web' || target.integration_key === 'whatsapp')
                                            ? __('No hay nada para pasar: ninguna automatización usa otra cuenta de WhatsApp ni llama directo a la API de WAS.')
                                            : __('No hay nada para pasar: ninguna automatización usa otra cuenta de esta app.')}
                                    </p>
                                )}

                                {sources.length > 0 && (
                                    <ul className="imcrm-space-y-2" data-testid="connection-swap-sources">
                                        {sources.map((s) => (
                                            <SourceCard
                                                key={s.key}
                                                source={s}
                                                checked={selected.has(s.key)}
                                                open={expanded.has(s.key)}
                                                onToggle={() => setSelected((cur) => toggle(cur, s.key))}
                                                onExpand={() => setExpanded((cur) => toggle(cur, s.key))}
                                            />
                                        ))}
                                    </ul>
                                )}
                                {apply.isError && <p className="imcrm-text-destructive">{errText(apply.error)}</p>}
                            </>
                        )}
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-p-4">
                        {result ? (
                            <Button onClick={onClose} data-testid="connection-swap-close">
                                {__('Listo')}
                            </Button>
                        ) : (
                            <>
                                <p className="imcrm-mr-auto imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Cada automatización guarda la versión anterior en su historial.')}
                                </p>
                                <Button variant="ghost" onClick={onClose}>
                                    {__('Cancelar')}
                                </Button>
                                <Button disabled={count === 0 || apply.isPending} onClick={() => apply.mutate()} data-testid="connection-swap-apply">
                                    {apply.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden />}
                                    {count === 0
                                        ? __('Reemplazar')
                                        : count === 1
                                          ? __('Reemplazar 1 acción')
                                          : sprintf(__('Reemplazar %d acciones'), count)}
                                </Button>
                            </>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function SourceCard({
    source: s,
    checked,
    open,
    onToggle,
    onExpand,
}: {
    source: ConnectionSwapSource;
    checked: boolean;
    open: boolean;
    onToggle: () => void;
    onExpand: () => void;
}): JSX.Element {
    const autos = s.automations.length;
    return (
        <li className="imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid="connection-swap-source" data-source={s.key}>
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-p-3">
                <input
                    type="checkbox"
                    className="imcrm-mt-1 imcrm-accent-[hsl(var(--imcrm-primary))]"
                    checked={checked}
                    disabled={s.actions === 0}
                    onChange={onToggle}
                    aria-label={s.label}
                    data-testid="connection-swap-source-check"
                />
                {s.kind === 'connection' ? (
                    <IntegrationLogo integrationKey={s.app} size={28} />
                ) : (
                    <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-[10px] imcrm-font-semibold">
                        API
                    </span>
                )}
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-font-medium">{s.label}</p>
                    {s.detail && <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{s.detail}</p>}
                    <p className="imcrm-mt-1 imcrm-text-xs">
                        {s.actions === 1 ? __('1 acción') : sprintf(__('%d acciones'), s.actions)}{' '}
                        {autos === 1 ? __('en 1 automatización') : sprintf(__('en %d automatizaciones'), autos)}
                        {s.skipped > 0 && (
                            <span className="imcrm-ml-1 imcrm-text-warning">
                                · {s.skipped === 1 ? __('1 no se puede pasar sola') : sprintf(__('%d no se pueden pasar solas'), s.skipped)}
                            </span>
                        )}
                    </p>
                    {s.notes.length > 0 && (
                        <ul className="imcrm-mt-1.5 imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-4 imcrm-text-xs imcrm-text-muted-foreground">
                            {s.notes.map((n) => (
                                <li key={n}>{n}</li>
                            ))}
                        </ul>
                    )}
                    <button
                        type="button"
                        onClick={onExpand}
                        className="imcrm-mt-1.5 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        aria-expanded={open}
                        data-testid="connection-swap-source-expand"
                    >
                        {open ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Ver en qué automatizaciones')}
                    </button>
                </div>
            </div>
            {open && (
                <ul className="imcrm-divide-y imcrm-divide-border imcrm-border-t imcrm-border-border imcrm-text-xs">
                    {s.automations.map((a) => (
                        <li key={a.id} className="imcrm-px-3 imcrm-py-2">
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-font-medium">{a.name}</span>
                                <span className="imcrm-text-muted-foreground">· {a.list_name}</span>
                                {!a.is_active && (
                                    <Badge variant="outline" className="imcrm-text-[10px]">
                                        {__('Pausada')}
                                    </Badge>
                                )}
                                <span className="imcrm-ml-auto imcrm-text-muted-foreground">
                                    {a.actions === 1 ? __('1 acción') : sprintf(__('%d acciones'), a.actions)}
                                </span>
                                <Link
                                    to={`/lists/${a.list_slug}/automations/${a.id}`}
                                    target="_blank"
                                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-text-primary hover:imcrm-underline"
                                >
                                    {__('Abrir')}
                                    <ExternalLink className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                </Link>
                            </div>
                            {a.skipped.map((k) => (
                                <p key={k.path} className="imcrm-mt-1 imcrm-flex imcrm-items-start imcrm-gap-1 imcrm-text-warning">
                                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                                    {k.reason}
                                </p>
                            ))}
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

function SwapDone({ result, target }: { result: ConnectionSwapResult; target: Connection | null }): JSX.Element {
    return (
        <div className="imcrm-space-y-3" data-testid="connection-swap-done">
            {result.actions > 0 && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-success/10 imcrm-p-3">
                    <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-success" aria-hidden />
                    <span>
                        {sprintf(
                            __('Listo: %1$s en %2$s usan ahora «%3$s». Si algo no quedó como esperabas, cada automatización tiene la versión anterior en «Historial de versiones».'),
                            result.actions === 1 ? __('1 acción') : sprintf(__('%d acciones'), result.actions),
                            result.automations === 1 ? __('1 automatización') : sprintf(__('%d automatizaciones'), result.automations),
                            target ? connectionLabel(target) : '',
                        )}
                    </span>
                </p>
            )}
            {result.failed.length > 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3">
                    <p className="imcrm-font-medium">{__('Estas no se pudieron guardar (quedaron como estaban):')}</p>
                    <ul className="imcrm-mt-1 imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-4 imcrm-text-xs">
                        {result.failed.map((f) => (
                            <li key={f.automation_id}>
                                <strong>{f.automation_name}</strong>: {f.reason}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : __('Algo salió mal.');
}
