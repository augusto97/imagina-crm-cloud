import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Check, Info, Pencil, X } from 'lucide-react';
import {
    PORTAL_TEMPLATE_KINDS,
    portalLinkedColumns,
    portalTemplateFit,
    portalTemplateLayout,
    suggestPortalLinked,
    type PortalLinkedList,
    type PortalRelatedList,
    type PortalTemplateKind,
    type RecordLayoutV3,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { fieldsKeys } from '@/hooks/useFields';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { toLite } from '../useRecordLayout';

/**
 * v0.1.237 — Galería de plantillas del PORTAL DEL CLIENTE. Elegir una arma el
 * diseño en el editor (con los campos de la lista y las listas vinculadas que
 * se marquen) — no se guarda nada hasta tocar Guardar, y se puede deshacer.
 *
 * Las listas vinculadas se ELIGEN con una casilla y se ve qué columnas va a
 * ver el cliente: mostrarle una lista interna (comisiones, costos) por
 * descuido es justo lo que no puede pasar. De entrada se marcan sólo las que
 * el admin ya habilitó y la central de la plantilla (las facturas en «Estado
 * de cuenta»).
 */
export const PORTAL_TEMPLATE_INFO: Record<PortalTemplateKind, { name: string; blurb: string; points: string[] }> = {
    account: {
        name: __('Mi cuenta'),
        blurb: __('Sus datos, lo que tiene con ustedes y un canal para escribirles.'),
        points: [
            __('Sus cifras y cuántos registros tiene en cada lista, en una banda'),
            __('Lo que tiene con ustedes como tarjetas'),
            __('Puede corregir sus datos de contacto'),
            __('Un canal para escribirles'),
        ],
    },
    statement: {
        name: __('Estado de cuenta'),
        blurb: __('Saldo pendiente y pagado, su próximo vencimiento y la tabla de facturas.'),
        points: [
            __('Saldo pendiente, pagado y total facturado'),
            __('Cuenta regresiva a su próximo vencimiento'),
            __('Su cuenta por estado y por mes'),
            __('Tabla de facturas con el comprobante para descargar'),
        ],
    },
    project: {
        name: __('Seguimiento de proyecto'),
        blurb: __('Las etapas del proyecto, el avance, la entrega y cómo va el trabajo.'),
        points: [
            __('Las etapas en la cabecera (las ve, no las cambia)'),
            __('Avance en anillo y la entrega contando los días'),
            __('El trabajo como tablero por estado'),
            __('Fechas clave, entregables y conversación con el equipo'),
        ],
    },
    support: {
        name: __('Mis solicitudes'),
        blurb: __('Cuántas tiene abiertas y resueltas, cada caso por estado y cómo pedir ayuda.'),
        points: [
            __('Abiertas, resueltas y total en una franja'),
            __('Sus solicitudes como tablero por estado'),
            __('Si el registro es el caso: prioridad, estado y plazo'),
            __('Un canal para pedir ayuda'),
        ],
    },
    order: {
        name: __('Mi pedido'),
        blurb: __('El estado del pedido como etapas, total, entrega estimada y lo que pidió.'),
        points: [
            __('El estado del pedido como etapas'),
            __('Total y entrega estimada con cuenta regresiva'),
            __('Lo que pidió, con cantidades'),
            __('Datos de entrega y comprobantes'),
        ],
    },
};

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    list: ListSummary;
    fields: FieldEntity[];
    onApply: (layout: RecordLayoutV3, kind: PortalTemplateKind) => void;
}

export function PortalTemplateGallery({ open, onOpenChange, list, fields, onApply }: Props): JSX.Element {
    const enabled = useMemo(() => {
        const raw = ((list.settings ?? {}) as { portal?: { related_lists?: unknown } }).portal?.related_lists;
        return Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    }, [list.settings]);
    const linked = usePortalLinkedLists(list, open, enabled);
    const lite = useMemo(() => fields.map(toLite), [fields]);
    const [kind, setKind] = useState<PortalTemplateKind>('account');
    const [chosen, setChosen] = useState<Set<string>>(new Set());

    // Cada plantilla propone su selección de listas; la persona la ajusta.
    useEffect(() => {
        if (!open || linked.loading) return;
        setChosen(new Set(suggestPortalLinked(kind, linked.items, enabled)));
    }, [open, kind, linked.loading, linked.items, enabled]);

    const selected = linked.items.filter((l) => chosen.has(l.key));
    const fit = portalTemplateFit(kind, { fields: lite, linked: selected });
    const info = PORTAL_TEMPLATE_INFO[kind];
    const toggle = (key: string): void =>
        setChosen((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm imcrm-animate-imcrm-fade-in" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-5xl imcrm-flex-col imcrm-gap-4 imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="portal-template-gallery"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Plantillas del portal del cliente')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Arman el portal con tus campos y con lo que el cliente tiene en otras listas, en los colores de tu marca.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-grid imcrm-min-h-0 imcrm-flex-1 imcrm-gap-4 imcrm-overflow-y-auto md:imcrm-grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:imcrm-overflow-hidden">
                        <div className="imcrm-grid imcrm-content-start imcrm-gap-2 sm:imcrm-grid-cols-2 md:imcrm-overflow-y-auto md:imcrm-pr-1" role="radiogroup" aria-label={__('Plantilla')}>
                            {PORTAL_TEMPLATE_KINDS.map((k) => {
                                const active = k === kind;
                                const kFit = portalTemplateFit(k, { fields: lite, linked: linked.items });
                                return (
                                    <button
                                        key={k}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setKind(k)}
                                        data-portal-template={k}
                                        className={cn(
                                            'imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                                            active ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-border hover:imcrm-bg-accent/60',
                                        )}
                                    >
                                        <PortalTemplateThumb kind={k} />
                                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                                            <span className="imcrm-text-sm imcrm-font-semibold">{PORTAL_TEMPLATE_INFO[k].name}</span>
                                            <span className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{PORTAL_TEMPLATE_INFO[k].blurb}</span>
                                            {!kFit.ok && !linked.loading && (
                                                <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-amber-700 dark:imcrm-text-amber-300">{__('Le falta algo a esta lista')}</span>
                                            )}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-4 md:imcrm-overflow-y-auto">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <h3 className="imcrm-text-sm imcrm-font-semibold">{info.name}</h3>
                                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                    {info.points.map((p) => (
                                        <li key={p} className="imcrm-flex imcrm-gap-1.5">
                                            <Check className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                                            {p}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <span className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {__('Qué más ve el cliente')}
                                </span>
                                {linked.loading ? (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Buscando listas vinculadas…')}</p>
                                ) : linked.items.length === 0 ? (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Ninguna otra lista está vinculada a ésta. Con un campo de relación (por ejemplo, «Cliente» en Facturas) aparece acá.')}
                                    </p>
                                ) : (
                                    linked.items.map((l) => (
                                        <label key={l.key} className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm" data-linked={l.key}>
                                            <input
                                                type="checkbox"
                                                className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-rounded imcrm-border-input"
                                                checked={chosen.has(l.key)}
                                                onChange={() => toggle(l.key)}
                                            />
                                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                                <span className="imcrm-font-medium">{l.name}</span>
                                                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                                    {__('Columnas:')} {portalLinkedColumns(l, { file: true, qty: true }).map((f) => f.label).join(' · ') || '—'}
                                                </span>
                                            </span>
                                        </label>
                                    ))
                                )}
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {__('Ve sólo SUS registros de cada lista. Lo que suena interno (costos, márgenes, comisiones, notas internas) no se incluye.')}
                                </p>
                            </div>

                            {kind === 'account' && (
                                <p className="imcrm-flex imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                                    <Pencil className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                                    {__('El cliente podrá corregir sus datos de contacto. Lo cambiás en el bloque con «El cliente puede editarlo».')}
                                </p>
                            )}

                            {!fit.ok && (
                                <p className="imcrm-flex imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-amber-500/30 imcrm-bg-amber-500/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-text-amber-200" role="note">
                                    <Info className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                    {fit.reason}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Reemplaza el diseño en el editor. No se guarda hasta que toques Guardar, y se puede deshacer.')}
                        </p>
                        <div className="imcrm-flex imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button variant="outline" size="sm">{__('Cancelar')}</Button>
                            </Dialog.Close>
                            <Button
                                size="sm"
                                disabled={!fit.ok || linked.loading}
                                onClick={() => onApply(portalTemplateLayout(kind, { fields: lite, linked: selected }), kind)}
                                data-testid="portal-template-apply"
                            >
                                {__('Usar esta plantilla')}
                            </Button>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * Las listas con registros del cliente: las relaciones que tocan la lista (en
 * los dos sentidos) y —sólo si el admin ya las habilitó— las que se acotan por
 * un campo persona (cualquier lista con un «Responsable» califica, y ofrecerlas
 * todas llenaría la galería de listas internas).
 */
function usePortalLinkedLists(list: ListSummary, enabled: boolean, enabledListIds: readonly number[]): { items: PortalLinkedList[]; loading: boolean } {
    const paths = useRelationPaths(enabled ? list.id : undefined);
    const options = useQuery({
        queryKey: ['portal-related-options', list.id],
        queryFn: async () => (await api.get<{ options: PortalRelatedList[] }>(`/lists/${list.slug}/portal/related-options`)).data.options,
        enabled,
    });
    const sources = useMemo(() => {
        const out: Array<Omit<PortalLinkedList, 'fields'>> = [];
        for (const p of paths.data ?? []) {
            if (p.other_list_id === list.id) continue;
            out.push({
                key: `rel:${p.relation_field_id}:${p.direction}`,
                list_id: p.other_list_id,
                name: p.other_list_name,
                source: { kind: 'related', field_id: p.relation_field_id, direction: p.direction },
            });
        }
        for (const o of options.data ?? []) {
            if (o.via !== 'user' || !enabledListIds.includes(o.list_id) || out.some((x) => x.list_id === o.list_id)) continue;
            out.push({ key: `list:${o.list_id}`, list_id: o.list_id, name: o.name, source: { kind: 'list', list_id: o.list_id } });
        }
        return out.slice(0, 8);
    }, [paths.data, options.data, list.id, enabledListIds]);
    const fieldQueries = useQueries({
        queries: sources.map((s) => ({
            queryKey: fieldsKeys.forList(s.list_id),
            queryFn: async () => (await api.get<FieldEntity[]>(`/lists/${s.list_id}/fields`)).data,
            staleTime: 60_000,
        })),
    });
    const ready = fieldQueries.every((q) => q.data !== undefined || q.isError);
    const stamp = fieldQueries.map((q) => q.dataUpdatedAt).join(',');
    const items = useMemo(
        () => (ready ? sources.map((s, i) => ({ ...s, fields: (fieldQueries[i]?.data ?? []).map(toLite) })) : []),
        // stamp resume el estado de las queries de campos.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [sources, ready, stamp],
    );
    return { items, loading: paths.isLoading || options.isLoading || !ready };
}

/** Miniatura de cada plantilla: la composición, en el color de la marca. */
export function PortalTemplateThumb({ kind }: { kind: PortalTemplateKind }): JSX.Element {
    const accent = 'hsl(var(--imcrm-primary))';
    const box = (style: React.CSSProperties, key?: string | number, solid = false): JSX.Element => (
        <div
            key={key}
            className="imcrm-rounded-[2px]"
            style={{ background: solid ? `color-mix(in srgb, ${accent} 55%, transparent)` : 'hsl(var(--imcrm-muted-foreground) / 0.22)', ...style }}
        />
    );
    const card = (h: number, key?: number): JSX.Element => (
        <div key={key} className="imcrm-rounded-[2px] imcrm-bg-card imcrm-ring-1 imcrm-ring-border" style={{ height: h, flex: 1 }} />
    );
    const band = (children: React.ReactNode, tone: 'accent' | 'muted' = 'accent'): JSX.Element => (
        <div
            className="imcrm-flex imcrm-gap-[2px] imcrm-rounded-[3px] imcrm-p-[2px]"
            style={{ background: tone === 'accent' ? `color-mix(in srgb, ${accent} 16%, transparent)` : 'hsl(var(--imcrm-muted))' }}
        >
            {children}
        </div>
    );
    const col = (flex: number, children: React.ReactNode, key?: number): JSX.Element => (
        <div key={key} className="imcrm-flex imcrm-flex-col imcrm-gap-[2px]" style={{ flex }}>
            {children}
        </div>
    );
    const head = (cover: 'gradient' | 'color', stages = false): JSX.Element => (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-[2px]">
            <div
                className="imcrm-rounded-[2px]"
                style={{ height: 5, background: cover === 'color' ? `color-mix(in srgb, ${accent} 70%, transparent)` : `linear-gradient(90deg, color-mix(in srgb, ${accent} 50%, transparent), color-mix(in srgb, ${accent} 10%, transparent))` }}
            />
            {stages && <div className="imcrm-flex imcrm-gap-[1px]">{[0, 1, 2, 3].map((k) => box({ height: 2, flex: 1 }, k, k < 2))}</div>}
        </div>
    );
    let body: JSX.Element;
    switch (kind) {
        case 'statement':
            body = (
                <>
                    {head('color')}
                    {band([0, 1, 2].map((k) => card(5, k)))}
                    <div className="imcrm-flex imcrm-gap-[2px]">
                        <div className="imcrm-rounded-full" style={{ width: 9, height: 9, border: `2px solid color-mix(in srgb, ${accent} 55%, transparent)` }} />
                        <div className="imcrm-flex imcrm-flex-1 imcrm-items-end imcrm-gap-[1px]">{[4, 7, 5, 8, 6].map((h, k) => box({ height: h, flex: 1 }, k, true))}</div>
                    </div>
                    {[0, 1, 2].map((k) => box({ height: 2 }, `r${k}`))}
                </>
            );
            break;
        case 'project':
            body = (
                <>
                    {head('gradient', true)}
                    {band([0, 1, 2].map((k) => card(6, k)))}
                    <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                        {col(2, [<div key="b" className="imcrm-flex imcrm-gap-[2px]">{[0, 1, 2].map((k) => col(1, [box({ height: 4 }, 1), box({ height: 4 }, 2)], k))}</div>, box({ height: 5 }, 3)])}
                        {col(1, [box({ height: 6 }, 1, true), box({ height: 6 }, 2)])}
                    </div>
                </>
            );
            break;
        case 'support':
            body = (
                <>
                    {head('gradient')}
                    {band([0, 1, 2].map((k) => card(6, k)), 'muted')}
                    <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                        {col(1.4, [<div key="b" className="imcrm-flex imcrm-gap-[2px]">{[0, 1, 2].map((k) => col(1, [box({ height: 5 }, 1), box({ height: 4 }, 2)], k))}</div>])}
                        {col(1, [box({ height: 4 }, 1, true), box({ height: 10 }, 2)])}
                    </div>
                </>
            );
            break;
        case 'order':
            body = (
                <>
                    {head('color', true)}
                    {band([0, 1, 2].map((k) => card(6, k)))}
                    <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                        {col(1.4, [0, 1, 2, 3].map((k) => box({ height: 2.5 }, k)))}
                        {col(1, [box({ height: 6 }, 1), box({ height: 5 }, 2)])}
                    </div>
                </>
            );
            break;
        default:
            body = (
                <>
                    {head('gradient')}
                    {band([0, 1, 2, 3].map((k) => card(5, k)))}
                    <div className="imcrm-flex imcrm-flex-1 imcrm-gap-[3px]">
                        {col(1.4, [<div key="c" className="imcrm-flex imcrm-gap-[2px]">{[0, 1].map((k) => card(9, k))}</div>, box({ height: 5 }, 2)])}
                        {col(1, [box({ height: 7 }, 1, true), box({ height: 6 }, 2)])}
                    </div>
                </>
            );
    }
    return (
        <div
            aria-hidden
            className="imcrm-flex imcrm-h-[72px] imcrm-w-[96px] imcrm-shrink-0 imcrm-flex-col imcrm-gap-[3px] imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-[4px]"
            data-thumb={kind}
        >
            {body}
        </div>
    );
}
