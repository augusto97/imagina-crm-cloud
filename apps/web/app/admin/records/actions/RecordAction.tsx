import { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { FLOATING_MENU_ATTR, isInsideFloatingUi } from '@/lib/escapeGuard';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.471 — Las acciones de un registro (seguir, PDF, WhatsApp, QR…) se
 * dibujan de dos formas, según dónde estén:
 *
 * - **icon**: un ícono en la barra, con un tooltip que sale al instante y
 *   dice qué es y para qué sirve (antes, el `title` nativo: ~1,5 s y en
 *   varios ni aparecía).
 * - **row**: una fila del menú «Acciones», con su nombre escrito y una línea
 *   de para qué sirve. Así no hay que adivinar qué hace cada ícono.
 *
 * Cada botón de acción usa `RecordAction` y el contenedor decide la forma
 * (por contexto): los componentes no cambian de API.
 */
export type RecordActionMode = 'icon' | 'row';

interface RecordActionContext {
    mode: RecordActionMode;
    /** Pliega el menú (al elegir una acción que abre un diálogo). */
    closeMenu: () => void;
}

const Ctx = createContext<RecordActionContext>({ mode: 'icon', closeMenu: () => undefined });

/** La forma en que se dibujan las acciones aquí (`icon` fuera de un menú). */
export function useRecordActionMode(): RecordActionContext {
    return useContext(Ctx);
}

/** Marca de cada fila del menú: el menú y sus grupos se esconden si no tienen ninguna. */
export const RECORD_ACTION_ROW_CLASS = 'imcrm-ra-row';

export interface RecordActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
    /** El ícono, ya con su tamaño (h-4 w-4). */
    icon: ReactNode;
    /** El nombre de la acción («Generar PDF»). */
    label: string;
    /** Para qué sirve, en una línea. */
    hint?: string | null;
    /** Un atajo de teclado para el tooltip. */
    shortcut?: string | null;
    /** Un número sobre el ícono (recordatorios pendientes). */
    badge?: number | null;
    /** Un punto de color sobre el ícono (la ventana de 24 h de WhatsApp abierta). */
    dot?: boolean;
    /** Encendida (seguir): el ícono va en el color de la marca. */
    active?: boolean;
    tone?: 'default' | 'danger';
    /**
     * En el menú: no plegarlo al tocar la fila. Para las acciones que abren un
     * menú o un globo colgado de la propia fila (PDF, Recordarme): si el menú
     * se plegara, quedarían colgados de nada.
     */
    keepMenuOpen?: boolean;
    /** Texto a la derecha de la fila (p. ej. «Activado»). */
    rowEnd?: ReactNode;
}

export const RecordAction = forwardRef<HTMLButtonElement, RecordActionProps>(function RecordAction(
    { icon, label, hint, shortcut, badge, dot = false, active = false, tone = 'default', keepMenuOpen = false, rowEnd, onClick, className, ...rest },
    ref,
) {
    const { mode, closeMenu } = useContext(Ctx);
    const hasBadge = typeof badge === 'number' && badge > 0;

    if (mode === 'row') {
        return (
            <button
                ref={ref}
                type="button"
                {...rest}
                onClick={(e) => {
                    onClick?.(e);
                    if (!keepMenuOpen && !e.defaultPrevented) closeMenu();
                }}
                className={cn(
                    RECORD_ACTION_ROW_CLASS,
                    'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-transition-colors',
                    'hover:imcrm-bg-accent focus-visible:imcrm-bg-accent focus-visible:imcrm-outline-none data-[state=open]:imcrm-bg-accent',
                    'disabled:imcrm-pointer-events-none disabled:imcrm-opacity-50',
                    className,
                )}
            >
                <span
                    className={cn(
                        'imcrm-relative imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted',
                        active ? 'imcrm-text-primary' : tone === 'danger' ? 'imcrm-text-destructive' : 'imcrm-text-foreground/70',
                    )}
                    aria-hidden
                >
                    {icon}
                    {dot && <span className="imcrm-absolute imcrm-right-1 imcrm-top-1 imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-emerald-500 imcrm-ring-2 imcrm-ring-muted" />}
                </span>
                <span className="imcrm-min-w-0 imcrm-flex-1">
                    <span className={cn('imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium imcrm-leading-5', tone === 'danger' && 'imcrm-text-destructive')}>{label}</span>
                    {hint && <span className="imcrm-block imcrm-text-xs imcrm-leading-4 imcrm-text-muted-foreground">{hint}</span>}
                </span>
                {hasBadge && (
                    <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-primary imcrm-px-1.5 imcrm-text-[11px] imcrm-font-semibold imcrm-leading-5 imcrm-text-primary-foreground">{badge}</span>
                )}
                {rowEnd && <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">{rowEnd}</span>}
            </button>
        );
    }

    return (
        <Tip label={label} hint={hint} shortcut={shortcut}>
            <Button
                ref={ref}
                variant="ghost"
                size="icon"
                aria-label={label}
                {...rest}
                onClick={onClick}
                className={cn(
                    'imcrm-relative imcrm-h-8 imcrm-w-8 imcrm-shrink-0',
                    active && 'imcrm-text-primary',
                    tone === 'danger' && 'imcrm-text-destructive hover:imcrm-text-destructive',
                    className,
                )}
            >
                {icon}
                {hasBadge && (
                    <span className="imcrm-absolute imcrm--right-0.5 imcrm--top-0.5 imcrm-flex imcrm-h-3.5 imcrm-min-w-3.5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-px-0.5 imcrm-text-[9px] imcrm-font-semibold imcrm-text-primary-foreground">
                        {badge}
                    </span>
                )}
                {dot && <span className="imcrm-absolute imcrm-right-1.5 imcrm-top-1.5 imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-emerald-500 imcrm-ring-2 imcrm-ring-card" aria-hidden />}
            </Button>
        </Tip>
    );
});

/** Un grupo del menú con su título; se esconde solo si no le quedó ninguna acción. */
export function RecordActionGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col [&:not(:has(.imcrm-ra-row))]:imcrm-hidden" role="group" aria-label={title}>
            <p className="imcrm-px-2 imcrm-pb-0.5 imcrm-pt-2 imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground first:imcrm-pt-1">{title}</p>
            {children}
        </div>
    );
}

/**
 * El menú «Acciones» de un registro: un botón con su nombre que abre la
 * lista de acciones, cada una con su nombre y para qué sirve, por grupos.
 *
 * El panel queda MONTADO aunque esté plegado: los diálogos que abre una
 * acción (QR, WhatsApp, compartir) viven en el componente de esa acción, y
 * plegar el menú no los cierra. Un click fuera del menú lo pliega, salvo en
 * una capa flotante (un submenú, un diálogo, un globo que abrió una acción).
 * Si ninguna acción aplica a este registro, el botón no se dibuja.
 */
export function RecordActionsMenu({
    open,
    onOpenChange,
    scopeRef,
    showLabel = true,
    children,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Dónde un click "afuera" pliega el menú (la ficha). Sin esto, toda la app. */
    scopeRef?: React.RefObject<HTMLElement>;
    /** «Acciones» escrito junto al ícono (en el teléfono, sólo el ícono). */
    showLabel?: boolean;
    children: ReactNode;
}): JSX.Element {
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [phoneTop, setPhoneTop] = useState<number | null>(null);
    const close = useCallback(() => onOpenChange(false), [onOpenChange]);
    const ctx = useMemo<RecordActionContext>(() => ({ mode: 'row', closeMenu: close }), [close]);

    // En el teléfono el panel va a lo ancho, justo debajo del botón (colgado
    // del botón se salía por la izquierda).
    useLayoutEffect(() => {
        if (!open) return;
        const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
        const rect = triggerRef.current?.getBoundingClientRect();
        setPhoneTop(narrow && rect ? Math.round(rect.bottom + 4) : null);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent): void => {
            const t = e.target as Element | null;
            if (!t || wrapRef.current?.contains(t)) return;
            if (isInsideFloatingUi(t)) return;
            const scope = scopeRef?.current ?? document.getElementById('root') ?? document.body;
            // Lo que no está en la ficha (un submenú, un diálogo, un globo que
            // abrió una acción: viven en el <body>) no cuenta como "afuera".
            if (scope.contains(t)) onOpenChange(false);
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            // Un submenú o un globo abierto se cierra primero (es su Esc).
            if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
            onOpenChange(false);
            triggerRef.current?.focus();
        };
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, onOpenChange, scopeRef]);

    const label = __('Acciones');
    return (
        <div ref={wrapRef} className="imcrm-relative imcrm-shrink-0 [&:not(:has(.imcrm-ra-row))]:imcrm-hidden" data-testid="imcrm-record-actions">
            <Tip label={label} hint={__('Enviar, compartir, PDF, código QR y más')} disabled={showLabel}>
                <Button
                    ref={triggerRef}
                    variant="ghost"
                    size="sm"
                    className={cn('imcrm-h-8 imcrm-gap-1.5', showLabel ? 'imcrm-px-2' : 'imcrm-w-8 imcrm-px-0', open && 'imcrm-bg-accent')}
                    aria-label={showLabel ? undefined : label}
                    aria-expanded={open}
                    aria-haspopup="true"
                    onClick={(e) => {
                        // Abierto con el teclado (Enter/Espacio): el foco entra a la primera acción.
                        const byKeyboard = e.detail === 0;
                        onOpenChange(!open);
                        if (byKeyboard && !open) window.setTimeout(() => rows(panelRef.current)[0]?.focus(), 0);
                    }}
                    data-testid="imcrm-record-more"
                >
                    <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                    {showLabel && (
                        <>
                            <span>{label}</span>
                            <ChevronDown className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-opacity-60 imcrm-transition-transform', open && 'imcrm-rotate-180')} />
                        </>
                    )}
                </Button>
            </Tip>
            <div
                ref={panelRef}
                // ↑/↓ recorren las acciones.
                onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                    const list = rows(panelRef.current);
                    if (list.length === 0) return;
                    e.preventDefault();
                    const at = list.indexOf(document.activeElement as HTMLButtonElement);
                    const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
                    list[next]?.focus();
                }}
                className={cn(
                    'imcrm-z-30 imcrm-flex-col imcrm-gap-0.5 imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1.5 imcrm-text-popover-foreground imcrm-shadow-imcrm-lg',
                    phoneTop !== null
                        ? 'imcrm-fixed imcrm-inset-x-3'
                        : 'imcrm-absolute imcrm-right-0 imcrm-top-full imcrm-mt-1 imcrm-w-[320px] imcrm-max-h-[min(70vh,560px)]',
                    open ? 'imcrm-flex' : 'imcrm-hidden',
                )}
                style={phoneTop !== null ? { top: phoneTop, maxHeight: `calc(100dvh - ${phoneTop + 12}px)` } : undefined}
                {...{ [FLOATING_MENU_ATTR]: open ? '' : undefined }}
                aria-label={label}
                data-testid="imcrm-record-more-panel"
            >
                <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
            </div>
        </div>
    );
}

/** Las filas del menú que se pueden tocar, en orden. */
function rows(panel: HTMLElement | null): HTMLButtonElement[] {
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLButtonElement>(`.${RECORD_ACTION_ROW_CLASS}:not(:disabled)`));
}
