import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronRight, Eye, Loader2, MoreHorizontal, MousePointerClick, X, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.406 — Las piezas comunes de los editores a pantalla completa
 * (formularios y agenda).
 *
 * Antes cada editor tenía una tira de pestañas DENTRO del panel izquierdo
 * (Contenido · Diseño · Lógica · Ajustes) que además cambiaba lo que se veía
 * en el panel derecho: no se entendía qué panel era de qué, y todo vivía
 * apretado en 280 px. Ahora:
 *
 * - Los modos del editor van ARRIBA, al centro, en un control segmentado con
 *   íconos (como la ventana de Compartir): se lee que cambian toda la pantalla.
 * - Cada panel tiene su encabezado («Estructura», «Propiedades», «Diseño»…):
 *   nunca hay que adivinar para qué sirve.
 * - «Ajustes» es una página: menú de grupos a la izquierda y el grupo a lo
 *   ancho, sin la vista previa al lado.
 * - En el celular los modos son una barra fija abajo, como en una app.
 */

export interface BuilderMode<T extends string = string> {
    id: T;
    label: string;
    icon: LucideIcon;
    /** Un número junto al nombre (p. ej. cuántas reglas tiene la lógica). */
    count?: number | null;
    /** Un punto rojo: falta algo para publicar. */
    problem?: boolean;
    testId: string;
    tour?: string;
}

/** Los modos del editor, en un control segmentado (escritorio). */
export function BuilderModeSwitch<T extends string>({
    modes,
    value,
    onChange,
    compact,
}: {
    modes: ReadonlyArray<BuilderMode<T>>;
    value: T;
    onChange: (m: T) => void;
    /** Sólo íconos (con su nombre al pasar el mouse) cuando no hay lugar. */
    compact?: boolean;
}): JSX.Element {
    return (
        <div role="tablist" aria-label={__('Qué editar')} className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5" data-testid="builder-modes">
            {modes.map((m) => {
                const on = m.id === value;
                const Icon = m.icon;
                return (
                    <button
                        key={m.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        title={compact ? m.label : undefined}
                        aria-label={m.count ? `${m.label} (${m.count})` : m.label}
                        onClick={() => onChange(m.id)}
                        data-testid={m.testId}
                        data-tour={m.tour}
                        className={cn(
                            'imcrm-relative imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-whitespace-nowrap imcrm-rounded-md imcrm-text-[13px] imcrm-transition-colors',
                            compact ? 'imcrm-w-9' : 'imcrm-px-3',
                            on ? 'imcrm-bg-card imcrm-font-medium imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                    >
                        <Icon className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', on && 'imcrm-text-primary')} aria-hidden />
                        {!compact && <span>{m.label}</span>}
                        {!compact && !!m.count && (
                            <span className="imcrm-rounded-full imcrm-bg-primary/15 imcrm-px-1.5 imcrm-text-[10.5px] imcrm-font-semibold imcrm-tabular-nums imcrm-text-primary">{m.count}</span>
                        )}
                        {m.problem && (
                            <span
                                className={cn('imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-destructive', compact && 'imcrm-absolute imcrm-right-1.5 imcrm-top-1.5')}
                                aria-label={__('Falta algo')}
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}

/** El nombre del formulario o la agenda: se ve como texto y se edita al tocarlo. */
export function InlineName({ value, onChange, label, testId }: { value: string; onChange: (v: string) => void; label: string; testId?: string }): JSX.Element {
    return (
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            title={__('Toca para cambiar el nombre')}
            data-testid={testId}
            className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-rounded-md imcrm-border imcrm-border-transparent imcrm-bg-transparent imcrm-px-2 imcrm-text-[15px] imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground imcrm-outline-none imcrm-transition-colors hover:imcrm-border-border focus:imcrm-border-ring focus:imcrm-bg-card"
        />
    );
}

/** El interruptor «Publicado / Sin publicar» (los dos editores). */
export function PublishSwitch({
    enabled,
    busy,
    onClick,
    testId,
    labelOn,
    labelOff,
    compact,
}: {
    enabled: boolean;
    busy: boolean;
    onClick: () => void;
    testId: string;
    labelOn?: string;
    labelOff?: string;
    compact?: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy}
            onClick={onClick}
            data-testid={testId}
            title={enabled ? __('Publicado: toca para dejar de recibir') : __('Sin publicar: toca para publicar')}
            className={cn(
                'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-rounded-full imcrm-border imcrm-py-1 imcrm-pl-1.5 imcrm-text-[12px] imcrm-font-medium imcrm-transition-colors',
                compact ? 'imcrm-pr-1.5' : 'imcrm-pr-3',
                enabled ? 'imcrm-border-success/30 imcrm-bg-success/10 imcrm-text-success' : 'imcrm-border-border imcrm-bg-muted imcrm-text-muted-foreground',
            )}
        >
            <span className={cn('imcrm-relative imcrm-inline-flex imcrm-h-4 imcrm-w-7 imcrm-items-center imcrm-rounded-full imcrm-transition-colors', enabled ? 'imcrm-bg-success' : 'imcrm-bg-border')} aria-hidden>
                <span
                    className={cn(
                        'imcrm-inline-block imcrm-h-3 imcrm-w-3 imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-transform',
                        enabled ? 'imcrm-translate-x-3.5' : 'imcrm-translate-x-0.5',
                    )}
                />
            </span>
            {!compact && (enabled ? (labelOn ?? __('Publicado')) : (labelOff ?? __('Sin publicar')))}
        </button>
    );
}

/** «Guardar», que dice «Guardado» cuando no hay nada pendiente. */
export function SaveButton({ dirty, busy, onClick, testId }: { dirty: boolean; busy: boolean; onClick: () => void; testId: string }): JSX.Element {
    return (
        <Button size="sm" disabled={!dirty || busy} onClick={onClick} data-testid={testId} className="imcrm-min-w-[92px] imcrm-gap-1.5" data-dirty={dirty ? '1' : '0'}>
            {busy ? (
                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
            ) : dirty ? (
                __('Guardar')
            ) : (
                <>
                    <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Guardado')}
                </>
            )}
        </Button>
    );
}

export interface MenuAction {
    label: string;
    icon: LucideIcon;
    onSelect: () => void;
    disabled?: boolean;
    testId?: string;
    /** Una línea antes de esta acción. */
    separated?: boolean;
}

/** El menú «⋯» (en el celular junta deshacer, compartir, estadísticas…). */
export function MoreMenu({ actions, label = __('Más opciones'), testId }: { actions: MenuAction[]; label?: string; testId?: string }): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={label} title={label} data-testid={testId}>
                    <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="imcrm-min-w-[220px]">
                {actions.map((a) => (
                    <div key={a.label}>
                        {a.separated && <DropdownMenuSeparator />}
                        <DropdownMenuItem disabled={a.disabled} onSelect={a.onSelect} data-testid={a.testId} className="imcrm-gap-2.5">
                            <a.icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                            {a.label}
                        </DropdownMenuItem>
                    </div>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * La barra de arriba del editor: cerrar, el nombre y si está publicado a la
 * izquierda; los modos al centro; deshacer, compartir y guardar a la derecha.
 */
export function BuilderTopBar({
    kindIcon: KindIcon,
    kindLabel,
    onClose,
    name,
    status,
    modes,
    actions,
}: {
    kindIcon: LucideIcon;
    kindLabel: string;
    onClose: () => void;
    /** El nombre editable (InlineName). */
    name: ReactNode;
    /** Algo junto al nombre (opcional). */
    status?: ReactNode;
    modes: ReactNode;
    actions: ReactNode;
}): JSX.Element {
    return (
        <header
            className="imcrm-grid imcrm-h-14 imcrm-shrink-0 imcrm-grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] imcrm-items-center imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-bg-card imcrm-px-3"
            data-testid="builder-topbar"
        >
            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5">
                <Button variant="ghost" size="icon" aria-label={__('Cerrar')} title={__('Cerrar')} onClick={onClose} className="imcrm-shrink-0">
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <span className="imcrm-h-6 imcrm-w-px imcrm-shrink-0 imcrm-bg-border" aria-hidden />
                <span className="imcrm-ml-1 imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary" title={kindLabel} aria-hidden>
                    <KindIcon className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-flex imcrm-min-w-0 imcrm-max-w-[300px] imcrm-flex-1 imcrm-items-center">{name}</div>
                {status}
            </div>
            <div className="imcrm-flex imcrm-justify-center">{modes}</div>
            <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-1">{actions}</div>
        </header>
    );
}

/** La barra de arriba en el celular: cerrar, nombre, «⋯» y guardar. */
export function BuilderMobileTopBar({
    onClose,
    name,
    statusText,
    published,
    more,
    save,
}: {
    onClose: () => void;
    name: ReactNode;
    statusText: string;
    published: boolean;
    more: ReactNode;
    save: ReactNode;
}): JSX.Element {
    return (
        <header className="imcrm-flex imcrm-h-14 imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-bg-card imcrm-px-1.5" data-testid="builder-topbar">
            <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={onClose} className="imcrm-shrink-0">
                <X className="imcrm-h-5 imcrm-w-5" />
            </Button>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                {name}
                <span className={cn('imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-px-2 imcrm-text-[11px] imcrm-leading-none', published ? 'imcrm-text-success' : 'imcrm-text-muted-foreground')} data-testid="builder-status-text">
                    <span className={cn('imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full', published ? 'imcrm-bg-success' : 'imcrm-bg-muted-foreground/50')} aria-hidden />
                    {statusText}
                </span>
            </div>
            {more}
            {save}
        </header>
    );
}

/** La barra fija de abajo en el celular (los modos y la vista previa). */
export function BuilderMobileNav<T extends string>({ items, value, onChange }: { items: ReadonlyArray<BuilderMode<T>>; value: T; onChange: (m: T) => void }): JSX.Element {
    return (
        <nav
            aria-label={__('Qué editar')}
            className="imcrm-grid imcrm-shrink-0 imcrm-border-t imcrm-border-border imcrm-bg-card imcrm-pb-[env(safe-area-inset-bottom)]"
            style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
            data-testid="builder-mobile-nav"
        >
            {items.map((m) => {
                const on = m.id === value;
                const Icon = m.icon;
                return (
                    <button
                        key={m.id}
                        type="button"
                        aria-current={on ? 'page' : undefined}
                        onClick={() => onChange(m.id)}
                        data-testid={m.testId}
                        data-tour={m.tour}
                        className={cn('imcrm-relative imcrm-flex imcrm-min-h-[56px] imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-text-[11px]', on ? 'imcrm-font-semibold imcrm-text-primary' : 'imcrm-text-muted-foreground')}
                    >
                        <span className={cn('imcrm-flex imcrm-h-7 imcrm-w-12 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-transition-colors', on && 'imcrm-bg-primary/10')}>
                            <Icon className="imcrm-h-[19px] imcrm-w-[19px]" aria-hidden />
                        </span>
                        <span className="imcrm-truncate">{m.label}</span>
                        {(m.problem || !!m.count) && (
                            <span
                                className={cn('imcrm-absolute imcrm-right-[calc(50%-20px)] imcrm-top-2 imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-ring-2 imcrm-ring-card', m.problem ? 'imcrm-bg-destructive' : 'imcrm-bg-primary')}
                                aria-hidden
                            />
                        )}
                    </button>
                );
            })}
        </nav>
    );
}

/**
 * El encabezado de un panel: para qué sirve (título y una línea), con sus
 * acciones a la derecha. Queda fijo arriba mientras el panel scrollea.
 */
export function PanelHeader({
    icon: Icon,
    title,
    subtitle,
    actions,
    back,
    testId,
    children,
}: {
    icon?: LucideIcon;
    title: string;
    subtitle?: string;
    actions?: ReactNode;
    /** Algo fijo debajo del título (p. ej. Plantillas · Personalizar). */
    children?: ReactNode;
    /** «‹ Diseño»: volver a lo que estaba antes de elegir una parte. */
    back?: { label: string; onClick: () => void };
    testId?: string;
}): JSX.Element {
    return (
        <div className="imcrm-sticky imcrm-top-0 imcrm-z-10 imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-bg-card/95 imcrm-px-4 imcrm-py-3 imcrm-backdrop-blur" data-testid={testId}>
            {back && (
                <button
                    type="button"
                    onClick={back.onClick}
                    className="-imcrm-ml-1 imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-self-start imcrm-rounded imcrm-pr-1 imcrm-text-[12px] imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                    data-testid="panel-back"
                >
                    <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                    {back.label}
                </button>
            )}
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5">
                {Icon && (
                    <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary" aria-hidden>
                        <Icon className="imcrm-h-4 imcrm-w-4" />
                    </span>
                )}
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-truncate imcrm-text-[14px] imcrm-font-semibold imcrm-leading-tight">{title}</p>
                    {subtitle && <p className="imcrm-mt-0.5 imcrm-line-clamp-2 imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">{subtitle}</p>}
                </div>
                {actions && <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1">{actions}</div>}
            </div>
            {children && <div className="imcrm-pt-2">{children}</div>}
        </div>
    );
}

/** Un control segmentado chico dentro de un panel (p. ej. Plantillas · Personalizar). */
export function PanelSegments<T extends string>({
    value,
    onChange,
    options,
    testId,
}: {
    value: T;
    onChange: (v: T) => void;
    options: ReadonlyArray<{ id: T; label: string; icon?: LucideIcon; testId?: string }>;
    testId?: string;
}): JSX.Element {
    return (
        <div
            role="tablist"
            className="imcrm-grid imcrm-gap-0.5 imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5"
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
            data-testid={testId}
        >
            {options.map((o) => {
                const on = o.id === value;
                const Icon = o.icon;
                return (
                    <button
                        key={o.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => onChange(o.id)}
                        data-testid={o.testId}
                        className={cn(
                            'imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-text-[12.5px] imcrm-transition-colors',
                            on ? 'imcrm-bg-card imcrm-font-medium imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                    >
                        {Icon && <Icon className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

/** El panel de la derecha cuando no hay nada elegido. */
export function InspectorEmpty({
    title,
    text,
    quick,
    onPick,
    testId,
}: {
    title: string;
    text: string;
    quick: ReadonlyArray<readonly [string, string]>;
    onPick: (id: string) => void;
    testId: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-4 imcrm-px-6 imcrm-py-10 imcrm-text-center" data-testid={testId}>
            <span className="imcrm-relative imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-rounded-2xl imcrm-bg-primary/10 imcrm-text-primary">
                <MousePointerClick className="imcrm-h-6 imcrm-w-6" />
            </span>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-text-[15px] imcrm-font-semibold">{title}</p>
                <p className="imcrm-text-[12px] imcrm-leading-relaxed imcrm-text-muted-foreground">{text}</p>
            </div>
            <div className="imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-1.5">
                <p className="imcrm-text-left imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Ir directo a')}</p>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5">
                    {quick.map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => onPick(id)}
                            className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-[12px] imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-bg-primary/5"
                        >
                            <span className="imcrm-truncate">{label}</span>
                            <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** La franja de arriba de la vista previa: qué es y los controles (dispositivo, modo). */
export function PreviewToolbar({ hint, children }: { hint: string; children?: ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-h-11 imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-px-4">
            <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-[12px] imcrm-text-muted-foreground">
                <Eye className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                <span className="imcrm-shrink-0 imcrm-whitespace-nowrap imcrm-font-medium imcrm-text-foreground">{__('Vista previa')}</span>
                <span className="imcrm-hidden imcrm-truncate xl:imcrm-inline">· {hint}</span>
            </span>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5">{children}</div>
        </div>
    );
}

/** Un grupo de botones con ícono (dispositivo, claro/oscuro) para la vista previa. */
export function IconToggleGroup<T extends string>({
    label,
    value,
    onChange,
    options,
    testId,
}: {
    label: string;
    value: T;
    onChange: (v: T) => void;
    options: ReadonlyArray<{ id: T; label: string; icon: LucideIcon; testId?: string; showLabel?: boolean }>;
    testId?: string;
}): JSX.Element {
    return (
        <div role="group" aria-label={label} className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5" data-testid={testId}>
            {options.map((o) => {
                const on = o.id === value;
                const Icon = o.icon;
                return (
                    <button
                        key={o.id}
                        type="button"
                        title={o.label}
                        aria-label={o.label}
                        aria-pressed={on}
                        onClick={() => onChange(o.id)}
                        data-testid={o.testId}
                        className={cn(
                            'imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-rounded-md imcrm-text-[11.5px] imcrm-transition-colors',
                            o.showLabel ? 'imcrm-px-2' : 'imcrm-w-8',
                            on ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                    >
                        <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                        {o.showLabel && <span className="imcrm-hidden 2xl:imcrm-inline">{o.label}</span>}
                    </button>
                );
            })}
        </div>
    );
}

// ─────────────────────────── «Ajustes» como página ───────────────────────────

export interface SettingsNavItem<T extends string = string> {
    id: T;
    label: string;
    icon: LucideIcon;
    /** Cómo está ahora (p. ej. «Apagado», «Hasta el 30/11»). */
    summary?: string;
    problem?: boolean;
    /** Un grupo del menú (se muestra como título arriba de sus filas). */
    group?: string;
    /** Algo al costado (un contador, un punto de estado). */
    badge?: ReactNode;
}

/** El menú de grupos de «Ajustes» (computadora). */
export function SettingsNav<T extends string>({
    items,
    active,
    onPick,
    label,
    testId,
    tour,
    dense = false,
}: {
    items: ReadonlyArray<SettingsNavItem<T>>;
    active: T;
    onPick: (id: T) => void;
    label: string;
    testId?: string;
    tour?: string;
    /** Filas más bajas (un menú con muchas secciones). */
    dense?: boolean;
}): JSX.Element {
    const groups = groupItems(items);
    return (
        <nav aria-label={label} className={cn('imcrm-flex imcrm-flex-col imcrm-p-3', dense ? 'imcrm-gap-3' : 'imcrm-gap-4')} data-testid={testId} data-tour={tour}>
            {groups.map(([g, list]) => (
                <div key={g ?? '_'} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    {g && <p className="imcrm-px-2.5 imcrm-pb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.06em] imcrm-text-muted-foreground">{g}</p>}
                    {list.map((it) => {
                        const on = it.id === active;
                        const Icon = it.icon;
                        return (
                            <button
                                key={it.id}
                                type="button"
                                onClick={() => onPick(it.id)}
                                aria-current={on ? 'page' : undefined}
                                data-settings-group={it.id}
                                className={cn(
                                    'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-lg imcrm-px-2.5 imcrm-text-left imcrm-transition-colors',
                                    dense ? 'imcrm-py-1.5' : 'imcrm-py-2',
                                    on ? 'imcrm-bg-primary/10' : 'hover:imcrm-bg-muted/70',
                                )}
                            >
                                <span
                                    className={cn(
                                        'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-transition-colors',
                                        dense ? 'imcrm-h-6 imcrm-w-6' : 'imcrm-h-7 imcrm-w-7',
                                        on ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-bg-muted imcrm-text-muted-foreground group-hover:imcrm-text-foreground',
                                    )}
                                >
                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                                </span>
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                    <span className={cn('imcrm-truncate imcrm-text-[13px]', on ? 'imcrm-font-semibold imcrm-text-foreground' : 'imcrm-font-medium')}>{it.label}</span>
                                    {it.summary && <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{it.summary}</span>}
                                </span>
                                {it.badge}
                                {it.problem && <span className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-destructive" aria-label={__('Falta algo')} />}
                            </button>
                        );
                    })}
                </div>
            ))}
        </nav>
    );
}

/** Los grupos de «Ajustes» en el celular: filas grandes con la flecha. */
export function SettingsMobileIndex<T extends string>({
    items,
    onPick,
    testId,
    tour,
    intro,
}: {
    items: ReadonlyArray<SettingsNavItem<T>>;
    onPick: (id: T) => void;
    testId?: string;
    tour?: string;
    intro?: ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5 imcrm-p-4" data-testid={testId} data-tour={tour}>
            {intro}
            {groupItems(items).map(([g, list]) => (
                <section key={g ?? '_'} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    {g && <h2 className="imcrm-px-1 imcrm-text-[12px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">{g}</h2>}
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card">
                        {list.map((it) => (
                            <li key={it.id}>
                                <button
                                    type="button"
                                    onClick={() => onPick(it.id)}
                                    data-settings-group={it.id}
                                    className="imcrm-flex imcrm-min-h-[60px] imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-px-3.5 imcrm-py-2.5 imcrm-text-left active:imcrm-bg-muted/70"
                                >
                                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted imcrm-text-foreground/75">
                                        <it.icon className="imcrm-h-[18px] imcrm-w-[18px]" />
                                    </span>
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                        <span className="imcrm-truncate imcrm-text-[15px]">{it.label}</span>
                                        {it.summary && <span className="imcrm-truncate imcrm-text-[12px] imcrm-text-muted-foreground">{it.summary}</span>}
                                    </span>
                                    {it.problem && <span className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-destructive" aria-label={__('Falta algo')} />}
                                    <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function groupItems<T extends string>(items: ReadonlyArray<SettingsNavItem<T>>): Array<[string | undefined, SettingsNavItem<T>[]]> {
    const out: Array<[string | undefined, SettingsNavItem<T>[]]> = [];
    for (const it of items) {
        const last = out[out.length - 1];
        if (last && last[0] === it.group) last[1].push(it);
        else out.push([it.group, [it]]);
    }
    return out;
}

/** El encabezado de un grupo de «Ajustes» (página): ícono, título y para qué sirve. */
export function SettingsPageHeader({ icon: Icon, title, hint, actions }: { icon: LucideIcon; title: string; hint: string; actions?: ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-start imcrm-gap-3.5">
            <span className="imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-bg-primary/10 imcrm-text-primary" aria-hidden>
                <Icon className="imcrm-h-5 imcrm-w-5" />
            </span>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">{title}</h2>
                <p className="imcrm-mt-0.5 imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>
            </div>
            {actions}
        </div>
    );
}

/**
 * «Ajustes» del editor como página: el menú de grupos a la izquierda y el
 * grupo a lo ancho (sin la vista previa al lado). El contenido arranca arriba
 * al cambiar de grupo.
 */
export function SettingsPageLayout({ nav, children, scrollKey }: { nav: ReactNode; children: ReactNode; scrollKey: string }): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        ref.current?.scrollTo({ top: 0 });
    }, [scrollKey]);
    return (
        <div className="imcrm-grid imcrm-min-h-0 imcrm-flex-1 imcrm-grid-cols-[288px_minmax(0,1fr)]" data-testid="builder-settings-page">
            <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border imcrm-bg-card">{nav}</aside>
            <div ref={ref} className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-bg-canvas">
                <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-[760px] imcrm-flex-col imcrm-gap-5 imcrm-px-8 imcrm-py-8">{children}</div>
            </div>
        </div>
    );
}

/** Una tarjeta del contenido de «Ajustes». */
export function SettingsCard({ children, testId }: { children: ReactNode; testId?: string }): JSX.Element {
    // La primera sección no lleva la línea de arriba (la tarjeta ya la separa).
    return (
        <div
            className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm [&>div>*:first-child>*:first-child]:imcrm-border-t-0 [&>div>*:first-child>*:first-child]:imcrm-pt-0 [&>div>*:first-child]:imcrm-border-t-0 [&>div>*:first-child]:imcrm-pt-0"
            data-testid={testId}
        >
            {children}
        </div>
    );
}

/** En el celular, volver de un grupo de «Ajustes» o de lo elegido. */
export function MobileBackBar({ label, title, onBack, testId }: { label: string; title?: string; onBack: () => void; testId?: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-h-11 imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-bg-card imcrm-px-1.5">
            <button
                type="button"
                onClick={onBack}
                className="imcrm-inline-flex imcrm-min-h-9 imcrm-items-center imcrm-gap-0.5 imcrm-rounded-md imcrm-pr-2 imcrm-text-[15px] imcrm-font-medium imcrm-text-primary active:imcrm-bg-muted/60"
                data-testid={testId}
            >
                <ArrowLeft className="imcrm-h-5 imcrm-w-5" aria-hidden />
                {label}
            </button>
            {title && <span className="imcrm-ml-auto imcrm-truncate imcrm-pr-2 imcrm-text-[12px] imcrm-text-muted-foreground">{title}</span>}
        </div>
    );
}
