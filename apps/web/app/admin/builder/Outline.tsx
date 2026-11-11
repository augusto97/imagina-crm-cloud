import type { ReactNode } from 'react';
import { EyeOff, Plus, type LucideIcon } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.407 — La columna «Estructura» de los editores (formularios y agenda).
 *
 * Antes era una sola lista con títulos chicos en mayúsculas y lo oculto
 * tachado entre lo que se ve: no se distinguía qué sección era cuál. Ahora
 * cada sección es su propio bloque, con un dibujito que marca EN QUÉ PARTE de
 * la página está (arriba, en el medio, abajo, el marco), un nombre y una línea
 * que dice qué tiene. Lo apagado no ocupa filas: queda en «Agregar» al pie
 * del bloque, y tocarlo lo muestra.
 */

export type OutlineZone = 'top' | 'middle' | 'bottom' | 'frame';

/** Un color por zona: así cada bloque se reconoce de un vistazo (y su dibujito dice dónde está). */
export const ZONE_COLOR: Record<OutlineZone, string> = {
    top: '#0ea5e9',
    middle: 'hsl(var(--imcrm-primary))',
    bottom: '#f59e0b',
    frame: '#8b5cf6',
};

/** Una página en miniatura con la zona de la sección marcada. */
export function ZoneMark({ zone, className }: { zone: OutlineZone; className?: string }): JSX.Element {
    const primary = ZONE_COLOR[zone];
    const muted = 'hsl(var(--imcrm-muted-foreground))';
    const bar = (z: OutlineZone): { fill: string; fillOpacity: number } => (zone === z ? { fill: primary, fillOpacity: 1 } : { fill: muted, fillOpacity: 0.25 });
    return (
        <svg viewBox="0 0 20 26" aria-hidden="true" className={cn('imcrm-h-7 imcrm-w-[22px] imcrm-shrink-0', className)}>
            <rect
                x="0.75"
                y="0.75"
                width="18.5"
                height="24.5"
                rx="3"
                fill={zone === 'frame' ? primary : 'hsl(var(--imcrm-background))'}
                fillOpacity={zone === 'frame' ? 0.16 : 1}
                stroke={zone === 'frame' ? primary : muted}
                strokeOpacity={zone === 'frame' ? 1 : 0.4}
                strokeWidth="1.5"
            />
            <rect x="4" y="4" width="12" height="3" rx="1" {...bar('top')} />
            <rect x="4" y="9.5" width="12" height="2.2" rx="1" {...bar('middle')} />
            <rect x="4" y="13.2" width="12" height="2.2" rx="1" {...bar('middle')} />
            <rect x="4" y="16.9" width="9" height="2.2" rx="1" {...bar('middle')} />
            <rect x="4" y="20.4" width="7" height="2.4" rx="1.2" {...bar('bottom')} />
        </svg>
    );
}

export function OutlineSection({
    zone,
    title,
    hint,
    count,
    children,
    footer,
    testId,
}: {
    zone: OutlineZone;
    title: string;
    hint: string;
    /** Un número junto al nombre (cuántas preguntas…). */
    count?: number;
    children?: ReactNode;
    /** Lo que va al pie del bloque (agregar, lo apagado). */
    footer?: ReactNode;
    testId?: string;
}): JSX.Element {
    return (
        <section className="imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-sm" data-testid={testId} data-outline-zone={zone}>
            <header
                className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-border-b imcrm-border-l-[3px] imcrm-border-b-border/70 imcrm-bg-muted/30 imcrm-py-2 imcrm-pl-2 imcrm-pr-2.5"
                style={{ borderLeftColor: ZONE_COLOR[zone] }}
            >
                <ZoneMark zone={zone} className="imcrm-mt-0.5" />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[13px] imcrm-font-semibold imcrm-leading-tight">
                        {title}
                        {count !== undefined && (
                            <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-text-[10.5px] imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground">{count}</span>
                        )}
                    </h3>
                    <p className="imcrm-mt-0.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>
                </div>
            </header>
            {children && <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-p-1">{children}</div>}
            {footer && <div className={cn('imcrm-px-2 imcrm-pb-2', !children && 'imcrm-pt-2')}>{footer}</div>}
        </section>
    );
}

/** Una fila: el ícono (o el número del paso), el nombre y un detalle corto. */
export function OutlineRow({
    icon: Icon,
    step,
    label,
    detail,
    muted,
    selected,
    problem,
    onSelect,
    onHide,
    hideLabel,
    attrs,
}: {
    icon: LucideIcon;
    step?: number;
    label: string;
    detail?: string;
    /** Apagado pero sigue en la lista (p. ej. «Quién atiende: se asigna solo»). */
    muted?: boolean;
    selected: boolean;
    problem?: boolean;
    onSelect: () => void;
    /** Si se puede ocultar: aparece «ocultar» al pasar el mouse. */
    onHide?: () => void;
    hideLabel?: string;
    attrs?: Record<string, string | undefined>;
}): JSX.Element {
    return (
        <div
            className={cn(
                'imcrm-group imcrm-relative imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-pr-1',
                selected ? 'imcrm-bg-primary/10 imcrm-ring-1 imcrm-ring-inset imcrm-ring-primary/40' : 'hover:imcrm-bg-accent',
            )}
            {...attrs}
        >
            {selected && <span className="imcrm-absolute imcrm-inset-y-1.5 imcrm-left-0 imcrm-w-[3px] imcrm-rounded-full imcrm-bg-primary" aria-hidden="true" />}
            <button
                type="button"
                onClick={onSelect}
                aria-current={selected ? 'true' : undefined}
                className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-py-1.5 imcrm-pl-2.5 imcrm-text-left"
            >
                {step !== undefined ? (
                    <span className="imcrm-flex imcrm-h-[18px] imcrm-w-[18px] imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-[10.5px] imcrm-font-semibold imcrm-text-primary">
                        {step}
                    </span>
                ) : (
                    <Icon className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0', selected ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')} />
                )}
                <span className={cn('imcrm-shrink-0 imcrm-text-sm', selected && 'imcrm-font-medium', muted && 'imcrm-text-muted-foreground')}>{label}</span>
                {detail && <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{detail}</span>}
                {problem && <span className="imcrm-ml-auto imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-destructive" aria-label={__('Falta algo')} />}
            </button>
            {onHide && (
                <button
                    type="button"
                    aria-label={`${__('Ocultar')} ${label.toLowerCase()}`}
                    title={hideLabel ?? __('Ocultar')}
                    onClick={onHide}
                    className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground imcrm-opacity-0 hover:imcrm-bg-background hover:imcrm-text-foreground focus-visible:imcrm-opacity-100 group-hover:imcrm-opacity-100 [@media(hover:none)]:imcrm-opacity-60"
                    data-hide-element
                >
                    <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" />
                </button>
            )}
        </div>
    );
}

export interface OutlineAddItem {
    key: string;
    icon: LucideIcon;
    label: string;
    onAdd: () => void;
    /** Si no se puede encender desde aquí (y por qué). */
    disabledReason?: string;
    attrs?: Record<string, string | undefined>;
}

/** Lo apagado de una sección, al pie: tocar una pastilla la muestra. */
export function OutlineAddChips({ items, label, separated = true }: { items: OutlineAddItem[]; label?: string; /** Una línea arriba (cuando hay filas encima). */ separated?: boolean }): JSX.Element | null {
    if (items.length === 0) return null;
    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1.5', separated && 'imcrm-border-t imcrm-border-dashed imcrm-border-border/80 imcrm-pt-2')} data-testid="outline-add-chips">
            <p className="imcrm-text-[10.5px] imcrm-font-medium imcrm-text-muted-foreground">{label ?? __('Ocultos · tócalos para mostrarlos')}</p>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {items.map((it) => (
                    <button
                        key={it.key}
                        type="button"
                        onClick={it.onAdd}
                        disabled={!!it.disabledReason}
                        title={it.disabledReason ?? `${__('Mostrar')} ${it.label.toLowerCase()}`}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-background imcrm-py-0.5 imcrm-pl-1.5 imcrm-pr-2 imcrm-text-[11.5px] imcrm-text-muted-foreground hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5 hover:imcrm-text-foreground disabled:imcrm-cursor-not-allowed disabled:imcrm-opacity-50 disabled:hover:imcrm-border-border disabled:hover:imcrm-bg-background"
                        {...it.attrs}
                    >
                        <Plus className="imcrm-h-3 imcrm-w-3" />
                        <it.icon className="imcrm-h-3 imcrm-w-3" />
                        {it.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
