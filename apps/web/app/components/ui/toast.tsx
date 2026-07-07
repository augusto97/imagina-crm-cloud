import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Sistema de notificaciones in-app.
 *
 * Reemplaza `window.alert()` con toasts apilables en la esquina
 * inferior derecha. Cada toast se auto-cierra (default 5s) y puede
 * ser descartado con el botón ✕. La API es similar a Sonner:
 *
 *   const toast = useToast();
 *   toast.success('Guardado');
 *   toast.error('No se pudo conectar');
 *   toast.info('Nueva versión disponible');
 *   toast.warning('Quedan pocos créditos');
 *
 * Para usos full-control:
 *   toast.show({ title, description, variant, duration });
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastSpec {
    id: number;
    title: string;
    description?: string;
    variant: ToastVariant;
    duration: number;
}

interface ShowArgs {
    title: string;
    description?: string;
    variant?: ToastVariant;
    duration?: number;
}

interface ToastContextValue {
    show: (args: ShowArgs) => number;
    success: (title: string, description?: string) => number;
    error: (title: string, description?: string) => number;
    warning: (title: string, description?: string) => number;
    info: (title: string, description?: string) => number;
    dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 5000;

let counter = 0;
const nextId = (): number => ++counter;

export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
    const [toasts, setToasts] = useState<ToastSpec[]>([]);
    const timers = useRef<Map<number, number>>(new Map());

    const dismiss = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        const handle = timers.current.get(id);
        if (handle !== undefined) {
            window.clearTimeout(handle);
            timers.current.delete(id);
        }
    }, []);

    const show = useCallback(
        (args: ShowArgs): number => {
            const id = nextId();
            const spec: ToastSpec = {
                id,
                title: args.title,
                description: args.description,
                variant: args.variant ?? 'info',
                duration: args.duration ?? DEFAULT_DURATION,
            };
            setToasts((prev) => [...prev, spec]);
            if (spec.duration > 0) {
                const handle = window.setTimeout(() => dismiss(id), spec.duration);
                timers.current.set(id, handle);
            }
            return id;
        },
        [dismiss],
    );

    useEffect(() => {
        const map = timers.current;
        return () => {
            for (const handle of map.values()) {
                window.clearTimeout(handle);
            }
            map.clear();
        };
    }, []);

    const value = useMemo<ToastContextValue>(
        () => ({
            show,
            dismiss,
            success: (title, description) => show({ title, description, variant: 'success' }),
            error: (title, description) =>
                show({ title, description, variant: 'error', duration: 8000 }),
            warning: (title, description) => show({ title, description, variant: 'warning' }),
            info: (title, description) => show({ title, description, variant: 'info' }),
        }),
        [show, dismiss],
    );

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastViewport toasts={toasts} onDismiss={dismiss} />
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        throw new Error('useToast debe usarse dentro de <ToastProvider>');
    }
    return ctx;
}

function ToastViewport({
    toasts,
    onDismiss,
}: {
    toasts: ToastSpec[];
    onDismiss: (id: number) => void;
}): JSX.Element | null {
    if (typeof document === 'undefined') return null;
    return createPortal(
        <ol
            role="region"
            aria-label={__('Notificaciones')}
            className="imcrm-pointer-events-none imcrm-fixed imcrm-bottom-4 imcrm-right-4 imcrm-z-[100000] imcrm-flex imcrm-w-full imcrm-max-w-sm imcrm-flex-col imcrm-gap-2"
        >
            {toasts.map((t) => (
                <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
            ))}
        </ol>,
        document.body,
    );
}

function ToastItem({
    toast,
    onDismiss,
}: {
    toast: ToastSpec;
    onDismiss: (id: number) => void;
}): JSX.Element {
    const Icon = ICONS[toast.variant];
    return (
        <li
            role="status"
            aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
            className={cn(
                'imcrm-pointer-events-auto imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-bg-card imcrm-p-3.5 imcrm-shadow-lg imcrm-animate-in imcrm-fade-in imcrm-slide-in-from-right-4',
                VARIANT_CLASSES[toast.variant],
            )}
        >
            <Icon className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-mt-0.5', ICON_CLASSES[toast.variant])} />
            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                <p className="imcrm-text-sm imcrm-font-medium imcrm-leading-tight">{toast.title}</p>
                {toast.description && (
                    <p className="imcrm-text-[12.5px] imcrm-text-muted-foreground imcrm-leading-snug">
                        {toast.description}
                    </p>
                )}
            </div>
            <Button
                variant="ghost"
                size="icon"
                className="imcrm-h-6 imcrm-w-6 imcrm-shrink-0"
                onClick={() => onDismiss(toast.id)}
                aria-label={__('Cerrar notificación')}
            >
                <X className="imcrm-h-3.5 imcrm-w-3.5" />
            </Button>
        </li>
    );
}

const ICONS = {
    success: CheckCircle2,
    error: XCircle,
    warning: TriangleAlert,
    info: Info,
} as const;

const VARIANT_CLASSES: Record<ToastVariant, string> = {
    success: 'imcrm-border-success/40',
    error: 'imcrm-border-destructive/50',
    warning: 'imcrm-border-warning/40',
    info: 'imcrm-border-border',
};

const ICON_CLASSES: Record<ToastVariant, string> = {
    success: 'imcrm-text-success',
    error: 'imcrm-text-destructive',
    warning: 'imcrm-text-warning',
    info: 'imcrm-text-info',
};
