import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AiProposal } from '@imagina-base/shared';
import { AlertTriangle, ArrowRight, Check, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { Link } from 'react-router';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<AiProposal['kind'], string> = {
    create_list: 'Lista nueva',
    add_fields: 'Campos nuevos',
    update_field: 'Cambio de campo',
    delete_field: 'Eliminar campo',
    create_view: 'Vista nueva',
    create_dashboard: 'Tablero nuevo',
    create_automation: 'Automatización nueva',
    update_list: 'Cambio de lista',
    create_records: 'Registros nuevos',
    update_records: 'Edición masiva',
    delete_records: 'Eliminar registros',
};

/**
 * Tarjeta de PROPUESTA del asistente (ADR-S21): lo que el modelo quiere
 * hacer, con vista previa, y el botón que lo hace de verdad. Hasta que la
 * persona aplica, nada existe. Las destructivas piden un segundo click.
 * Al aplicar se invalida TODO el cache de queries: la propuesta puede
 * tocar listas, campos, vistas, tableros o automatizaciones y es más
 * barato refrescar que adivinar.
 */
export function ProposalCard({
    proposal,
    onApplied,
}: {
    proposal: AiProposal;
    onApplied: (p: AiProposal) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const [confirming, setConfirming] = useState(false);
    const apply = useMutation({
        mutationFn: () => api.aiApply(proposal.id),
        onSuccess: async (res) => {
            onApplied(res.proposal);
            await qc.invalidateQueries();
        },
    });
    const p = proposal;
    const Icon = fieldTypeIcon;
    return (
        <div
            data-testid="imcrm-ai-proposal"
            data-kind={p.kind}
            data-applied={p.applied ? '1' : '0'}
            className={cn(
                'imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-text-sm imcrm-shadow-sm',
                p.applied ? 'imcrm-border-success/40' : p.destructive ? 'imcrm-border-destructive/40' : 'imcrm-border-primary/30',
            )}
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-px-3 imcrm-pt-3">
                <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                    <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                        <Badge variant={p.destructive ? 'destructive' : 'secondary'} className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                            {__(KIND_LABEL[p.kind])}
                        </Badge>
                        {p.applied && (
                            <Badge variant="success" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                <Check className="imcrm-mr-0.5 imcrm-h-3 imcrm-w-3" /> {__('Aplicada')}
                            </Badge>
                        )}
                    </div>
                    <div className="imcrm-mt-1 imcrm-font-semibold imcrm-leading-snug">{p.title}</div>
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">{p.summary}</p>
                </div>
            </div>

            <div className="imcrm-px-3 imcrm-pt-2">
                <Preview p={p} Icon={Icon} />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-px-3 imcrm-pb-3 imcrm-pt-2">
                {p.applied && p.result && (
                    <div className="imcrm-rounded-lg imcrm-bg-success/10 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs">
                        <div className="imcrm-font-medium imcrm-text-success">{p.result.message}</div>
                        {p.result.warnings.length > 0 && (
                            <ul className="imcrm-mt-1 imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-4 imcrm-text-warning">
                                {p.result.warnings.map((w, i) => (
                                    <li key={i}>{w}</li>
                                ))}
                            </ul>
                        )}
                        {p.result.links.length > 0 && (
                            <div className="imcrm-mt-1.5 imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                                {p.result.links.map((l) => (
                                    <Link
                                        key={l.href}
                                        to={l.href}
                                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                    >
                                        {l.label} <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {!p.applied && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        {p.destructive && !confirming ? (
                            <Button size="sm" variant="destructive" onClick={() => setConfirming(true)} disabled={apply.isPending}>
                                <AlertTriangle className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" /> {__('Aplicar…')}
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant={p.destructive ? 'destructive' : 'default'}
                                onClick={() => apply.mutate()}
                                disabled={apply.isPending}
                                data-testid="imcrm-ai-apply"
                            >
                                {apply.isPending ? <Loader2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Check className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />}
                                {p.destructive ? __('Sí, aplicar (no se puede deshacer)') : __('Aplicar')}
                            </Button>
                        )}
                        {confirming && !apply.isPending && (
                            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                                {__('Cancelar')}
                            </Button>
                        )}
                        {apply.isError && (
                            <span className="imcrm-text-xs imcrm-text-destructive">
                                {apply.error instanceof Error ? apply.error.message : __('No se pudo aplicar')}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function Preview({ p, Icon }: { p: AiProposal; Icon: typeof fieldTypeIcon }): JSX.Element | null {
    const pv = p.preview;
    const blocks: JSX.Element[] = [];
    for (const l of pv.lists) {
        blocks.push(
            <div key={`l-${l.name}`} className="imcrm-rounded-lg imcrm-border imcrm-border-border/70 imcrm-bg-muted/30 imcrm-p-2">
                <div className="imcrm-text-xs imcrm-font-semibold">{l.name}</div>
                {l.fields.length > 0 && (
                    <ul className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                        {l.fields.map((f) => {
                            const I = Icon(f.type);
                            return (
                                <li key={f.label} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-bg-background imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-ring-1 imcrm-ring-border">
                                    <I className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" /> {f.label}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {(l.views.length > 0 || l.automations.length > 0 || l.records_count > 0) && (
                    <div className="imcrm-mt-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {l.views.length > 0 && <span>{__('Vistas')}: {l.views.map((v) => v.name).join(', ')}. </span>}
                        {l.automations.length > 0 && <span>{__('Automatizaciones')}: {l.automations.join(', ')}. </span>}
                        {l.records_count > 0 && <span>{l.records_count} {__('registros de ejemplo')}.</span>}
                    </div>
                )}
            </div>,
        );
    }
    if (pv.fields.length > 0 && pv.lists.length === 0) {
        blocks.push(
            <ul key="fields" className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                {pv.fields.map((f) => {
                    const I = Icon(f.type);
                    return (
                        <li key={f.label} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                            <I className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                            <span className="imcrm-font-medium">{f.label}</span>
                            <span className="imcrm-text-muted-foreground">· {f.type}</span>
                            {f.detail && <span className="imcrm-truncate imcrm-text-muted-foreground">· {f.detail}</span>}
                        </li>
                    );
                })}
            </ul>,
        );
    }
    if (pv.widgets.length > 0) {
        blocks.push(
            <ul key="widgets" className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1">
                {pv.widgets.map((w, i) => (
                    <li key={i} className="imcrm-rounded-md imcrm-border imcrm-border-border/70 imcrm-px-2 imcrm-py-1 imcrm-text-[11px]">
                        <div className="imcrm-truncate imcrm-font-medium">{w.title || w.type}</div>
                        <div className="imcrm-truncate imcrm-text-muted-foreground">{w.detail ?? w.type}</div>
                    </li>
                ))}
            </ul>,
        );
    }
    if (pv.automation) {
        blocks.push(
            <div key="auto" className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1 imcrm-text-[11px]">
                <span className="imcrm-rounded-md imcrm-bg-primary/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-font-medium imcrm-text-primary">{pv.automation.trigger}</span>
                {pv.automation.actions.map((a, i) => (
                    <span key={i} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                        <ArrowRight className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" />
                        <span className="imcrm-rounded-md imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5">{a}</span>
                    </span>
                ))}
            </div>,
        );
    }
    if (pv.changes.length > 0) {
        blocks.push(
            <table key="changes" className="imcrm-w-full imcrm-text-[11px]">
                <tbody>
                    {pv.changes.map((c, i) => (
                        <tr key={i} className="imcrm-border-t imcrm-border-border/60 first:imcrm-border-t-0">
                            <td className="imcrm-py-1 imcrm-pr-2 imcrm-font-medium imcrm-align-top">{c.label}</td>
                            <td className="imcrm-py-1 imcrm-align-top imcrm-text-muted-foreground">
                                {c.from !== null && c.from !== '' && <span className="imcrm-line-through imcrm-opacity-70">{c.from} </span>}
                                <span className="imcrm-text-foreground">{c.to}</span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>,
        );
    }
    if (pv.affected_count > 0) {
        blocks.push(
            <div key="count" className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs" data-testid="imcrm-ai-affected">
                <span className={cn('imcrm-rounded-md imcrm-px-1.5 imcrm-py-0.5 imcrm-font-semibold imcrm-tabular-nums', p.destructive ? 'imcrm-bg-destructive/10 imcrm-text-destructive' : 'imcrm-bg-primary/10 imcrm-text-primary')}>
                    {pv.affected_count}
                </span>
                <span className="imcrm-text-muted-foreground">
                    {p.kind === 'create_records' ? __('registros a crear') : __('registros afectados')}
                </span>
            </div>,
        );
    }
    if (pv.rows.length > 0) {
        const cols = [...new Set(pv.rows.flatMap((r) => Object.keys(r)))].slice(0, 4);
        blocks.push(
            <div key="rows" className="imcrm-overflow-x-auto imcrm-rounded-lg imcrm-border imcrm-border-border/70" data-testid="imcrm-ai-rows">
                <table className="imcrm-w-full imcrm-text-[11px]">
                    <thead>
                        <tr className="imcrm-bg-muted/40 imcrm-text-left imcrm-text-muted-foreground">
                            {cols.map((c) => (
                                <th key={c} className="imcrm-px-2 imcrm-py-1 imcrm-font-medium">{c}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {pv.rows.map((r, i) => (
                            <tr key={i} className="imcrm-border-t imcrm-border-border/60">
                                {cols.map((c) => (
                                    <td key={c} className="imcrm-max-w-[140px] imcrm-truncate imcrm-px-2 imcrm-py-1">{r[c] ?? ''}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {pv.affected_count > pv.rows.length && (
                    <div className="imcrm-px-2 imcrm-py-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                        {__('Muestra de')} {pv.rows.length} {__('de')} {pv.affected_count}
                    </div>
                )}
            </div>,
        );
    }
    if (blocks.length === 0) return null;
    return <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">{blocks}</div>;
}
