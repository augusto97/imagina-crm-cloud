import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * v0.1.408 — Piezas chicas del editor del widget: interruptores de verdad (no
 * casillas), sub-secciones con título y tarjetas para elegir con un dibujo.
 */

/** Un interruptor (role=switch). */
export function Switch({ checked, onChange, label, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string }): JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            data-testid={testId}
            className={cn(
                'imcrm-relative imcrm-inline-flex imcrm-h-5 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-rounded-full imcrm-transition-colors focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring focus-visible:imcrm-ring-offset-2 focus-visible:imcrm-ring-offset-card disabled:imcrm-cursor-not-allowed disabled:imcrm-opacity-50',
                checked ? 'imcrm-bg-primary' : 'imcrm-bg-muted-foreground/30',
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'imcrm-inline-block imcrm-h-4 imcrm-w-4 imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-transform',
                    checked ? 'imcrm-translate-x-[18px]' : 'imcrm-translate-x-0.5',
                )}
            />
        </button>
    );
}

/** Una fila con nombre, explicación y el interruptor a la derecha. */
export function SwitchRow({
    label,
    hint,
    checked,
    onChange,
    icon: Icon,
    testId,
    boxed = false,
    disabled,
    children,
}: {
    label: string;
    hint?: ReactNode;
    checked: boolean;
    onChange: (v: boolean) => void;
    icon?: LucideIcon;
    testId?: string;
    /** Con borde (para una opción que abre más ajustes debajo). */
    boxed?: boolean;
    disabled?: boolean;
    /** Lo que se ve debajo cuando está encendido. */
    children?: ReactNode;
}): JSX.Element {
    return (
        <div className={cn(boxed && 'imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card', boxed && checked && 'imcrm-border-primary/30')}>
            <div className={cn('imcrm-flex imcrm-items-start imcrm-gap-3', boxed && 'imcrm-p-3')}>
                {Icon && (
                    <span
                        className={cn(
                            'imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-transition-colors',
                            checked ? 'imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                        )}
                        aria-hidden
                    >
                        <Icon className="imcrm-h-4 imcrm-w-4" />
                    </span>
                )}
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-text-[13px] imcrm-font-medium imcrm-leading-snug">{label}</p>
                    {hint && <p className="imcrm-mt-0.5 imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>}
                </div>
                <span className="imcrm-pt-0.5">
                    <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} testId={testId} />
                </span>
            </div>
            {checked && children && <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3', boxed ? 'imcrm-border-t imcrm-border-border imcrm-p-3' : 'imcrm-pt-3')}>{children}</div>}
        </div>
    );
}

/** Una parte de un panel: título chico y lo suyo debajo. */
export function SubSection({ title, hint, children, action, testId, tour }: { title: string; hint?: string; children: ReactNode; action?: ReactNode; testId?: string; tour?: string }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid={testId} data-tour={tour}>
            <div className="imcrm-flex imcrm-items-end imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <h3 className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.06em] imcrm-text-muted-foreground">{title}</h3>
                    {hint && <p className="imcrm-mt-0.5 imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

/** El cuerpo de un panel: las sub-secciones separadas por una línea. */
export function PanelBody({ children, testId, tour }: { children: ReactNode; testId?: string; tour?: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-px-4 [&>*]:imcrm-py-5 [&>*:first-child]:imcrm-pt-4" data-testid={testId} data-tour={tour}>
            {children}
        </div>
    );
}

/** Una tarjeta para elegir entre opciones, con un dibujo arriba. */
export function ChoiceCard({
    active,
    onClick,
    art,
    title,
    hint,
    testId,
}: {
    active: boolean;
    onClick: () => void;
    art: ReactNode;
    title: string;
    hint?: string;
    testId?: string;
}): JSX.Element {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={active}
            onClick={onClick}
            data-testid={testId}
            className={cn(
                'imcrm-group imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-text-left imcrm-transition-all',
                active ? 'imcrm-border-primary imcrm-ring-2 imcrm-ring-primary/20' : 'imcrm-border-border hover:imcrm-border-primary/40',
            )}
        >
            <span className={cn('imcrm-flex imcrm-h-[84px] imcrm-items-center imcrm-justify-center imcrm-border-b imcrm-transition-colors', active ? 'imcrm-border-primary/20 imcrm-bg-primary/[0.06]' : 'imcrm-border-border imcrm-bg-muted/40')}>
                {art}
            </span>
            <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-px-3 imcrm-py-2.5">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[13px] imcrm-font-medium">
                    <span
                        aria-hidden
                        className={cn('imcrm-flex imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border', active ? 'imcrm-border-primary' : 'imcrm-border-muted-foreground/40')}
                    >
                        {active && <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-primary" />}
                    </span>
                    {title}
                </span>
                {hint && <span className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</span>}
            </span>
        </button>
    );
}

/**
 * Una pantalla en miniatura con el widget dibujado: el panel tipo chat, los
 * botones apilados o sólo el botón redondo, a un costado o al otro.
 */
export function WidgetArt({ variant, side, accent }: { variant: 'card' | 'menu' | 'launcher'; side: 'left' | 'right'; accent: string }): JSX.Element {
    const line = 'hsl(var(--imcrm-muted-foreground) / 0.22)';
    const x = (fromSide: number, width: number): number => (side === 'right' ? 104 - fromSide - width : fromSide);
    return (
        <svg viewBox="0 0 112 68" className="imcrm-h-[68px] imcrm-w-[112px]" aria-hidden>
            <rect x="0.5" y="0.5" width="111" height="67" rx="6" fill="hsl(var(--imcrm-card))" stroke="hsl(var(--imcrm-border))" />
            <rect x="0.5" y="0.5" width="111" height="9" rx="6" fill={line} />
            <rect x="8" y="16" width="44" height="4" rx="2" fill={line} />
            <rect x="8" y="24" width="30" height="3" rx="1.5" fill={line} />
            <rect x="8" y="31" width="36" height="3" rx="1.5" fill={line} />
            {variant === 'card' && (
                <>
                    <rect x={x(8, 38)} y="13" width="38" height="40" rx="4" fill="hsl(var(--imcrm-card))" stroke="hsl(var(--imcrm-border))" />
                    <rect x={x(8, 38)} y="13" width="38" height="12" rx="4" fill={accent} />
                    <rect x={x(8, 38)} y="21" width="38" height="4" fill={accent} />
                    <rect x={x(11, 32)} y="29" width="32" height="7" rx="2" fill="hsl(var(--imcrm-muted))" />
                    <rect x={x(11, 32)} y="39" width="32" height="7" rx="2" fill="hsl(var(--imcrm-muted))" />
                </>
            )}
            {variant === 'menu' && (
                <>
                    <rect x={x(8, 30)} y="22" width="30" height="8" rx="4" fill="hsl(var(--imcrm-card))" stroke="hsl(var(--imcrm-border))" />
                    <rect x={x(8, 30)} y="33" width="30" height="8" rx="4" fill="hsl(var(--imcrm-card))" stroke="hsl(var(--imcrm-border))" />
                    <rect x={x(8, 30)} y="44" width="30" height="8" rx="4" fill="hsl(var(--imcrm-card))" stroke="hsl(var(--imcrm-border))" />
                    <circle cx={x(8, 30) + 5} cy="26" r="2" fill={accent} />
                    <circle cx={x(8, 30) + 5} cy="37" r="2" fill={accent} />
                    <circle cx={x(8, 30) + 5} cy="48" r="2" fill={accent} />
                </>
            )}
            <circle cx={side === 'right' ? 98 : 14} cy="58" r="6" fill={accent} />
        </svg>
    );
}
