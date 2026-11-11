import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { isChunkLoadError } from '@/lib/lazyWithReload';

interface ErrorBoundaryProps {
    children: ReactNode;
    /** Mensaje contextual que se muestra al usuario cuando algo falla. */
    label?: string;
    /** Callback cuando el usuario decide volver atrás (cerrar el panel, etc.). */
    onReset?: () => void;
    /**
     * Qué se dibuja en lugar del subárbol que falló. `reset` vuelve a
     * intentar dibujarlo. Sin esto, la tarjeta chica de siempre.
     */
    fallback?: (error: Error, reset: () => void) => ReactNode;
    /**
     * Al cambiar (la ruta, el registro abierto…) el error se olvida: quien
     * navega a otra pantalla no se queda mirando el aviso de la anterior.
     */
    resetKey?: string | number;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * Captura errores de React en su subárbol y muestra un fallback en
 * vez de dejar la pantalla en blanco.
 *
 * Suspense NO captura errores — sólo promesas pendientes; necesitamos
 * un ErrorBoundary class component para fallos de runtime.
 *
 * Un chunk que no se pudo bajar (despliegue nuevo con la pestaña abierta)
 * NO se resuelve aquí: `lazyWithReload` y el listener de `vite:preloadError`
 * ya recargan la página una vez. Si aun así el error llega hasta aquí (la
 * recarga no lo arregló), el aviso ofrece recargar a mano.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // Log a la consola para diagnosticar; el usuario ve sólo el fallback.
        console.error('[app] ErrorBoundary:', error, info);
    }

    componentDidUpdate(prev: ErrorBoundaryProps): void {
        if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    private handleReset = (): void => {
        this.setState({ error: null });
        this.props.onReset?.();
    };

    render(): ReactNode {
        const { error } = this.state;
        if (error) {
            if (this.props.fallback) return this.props.fallback(error, this.handleReset);
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-4 imcrm-text-sm imcrm-text-destructive">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        <strong>
                            {this.props.label ?? __('Algo falló al mostrar esta parte.')}
                        </strong>
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {error.message}
                    </p>
                    {this.props.onReset && (
                        <Button type="button" variant="outline" size="sm" onClick={this.handleReset}>
                            {__('Volver')}
                        </Button>
                    )}
                </div>
            );
        }
        return this.props.children;
    }
}

interface CrashScreenProps {
    error: Error;
    /** `app`: toda la ventana. `page`: sólo el área de trabajo (el menú sigue). */
    variant: 'app' | 'page';
    /** Volver a intentar sin recargar (sólo `page`). */
    onRetry?: () => void;
    /** Al mostrarse (p. ej. para quitar la pantalla de arranque). */
    onShown?: () => void;
}

/**
 * Pantalla de recuperación: qué pasó en una línea, «Recargar» y, dentro de
 * la app, «Volver a intentar». Sin el nombre del producto (white-label).
 */
export function CrashScreen({ error, variant, onRetry, onShown }: CrashScreenProps): JSX.Element {
    useEffect(() => {
        onShown?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const stale = isChunkLoadError(error);
    const title = stale
        ? __('Hay una versión nueva de la aplicación')
        : variant === 'app'
            ? __('Algo salió mal')
            : __('No pudimos mostrar esta pantalla');
    const text = stale
        ? __('Recarga la página para seguir trabajando con la versión más reciente.')
        : variant === 'app'
            ? __('La aplicación tuvo un problema inesperado. Tus datos están a salvo: recarga la página para continuar.')
            : __('Ocurrió un problema inesperado en esta pantalla. Puedes volver a intentarlo, ir a otra sección desde el menú o recargar la página.');
    return (
        <div
            role="alert"
            data-testid={`crash-${variant}`}
            className={
                variant === 'app'
                    ? 'imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-background imcrm-p-6 imcrm-text-foreground'
                    : 'imcrm-flex imcrm-min-h-[50vh] imcrm-items-center imcrm-justify-center imcrm-p-6'
            }
        >
            <div className="imcrm-flex imcrm-max-w-md imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-text-center">
                <span className="imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground">
                    <TriangleAlert className="imcrm-h-5 imcrm-w-5" aria-hidden />
                </span>
                <h1 className="imcrm-text-lg imcrm-font-semibold">{title}</h1>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{text}</p>
                <div className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-2">
                    {variant === 'page' && onRetry && !stale && (
                        <Button type="button" variant="outline" onClick={onRetry}>
                            {__('Volver a intentar')}
                        </Button>
                    )}
                    <Button type="button" onClick={() => window.location.reload()}>
                        <RotateCw className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Recargar')}
                    </Button>
                </div>
                {!stale && error.message && (
                    <details className="imcrm-mt-1 imcrm-max-w-full imcrm-text-xs imcrm-text-muted-foreground">
                        <summary className="imcrm-cursor-pointer">{__('Detalle para soporte')}</summary>
                        <p className="imcrm-mt-1 imcrm-break-words">{error.message.slice(0, 300)}</p>
                    </details>
                )}
            </div>
        </div>
    );
}

/** Límite de toda la aplicación (raíz de cada SPA). */
export function AppErrorBoundary({ children, onShown }: { children: ReactNode; onShown?: () => void }): JSX.Element {
    return (
        <ErrorBoundary fallback={(error) => <CrashScreen error={error} variant="app" onShown={onShown} />}>
            {children}
        </ErrorBoundary>
    );
}

/**
 * Límite del área de trabajo: si una pantalla falla, el menú y la barra
 * superior siguen ahí. `resetKey` = la ruta: navegar limpia el aviso.
 */
export function PageErrorBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }): JSX.Element {
    return (
        <ErrorBoundary
            resetKey={resetKey}
            fallback={(error, reset) => <CrashScreen error={error} variant="page" onRetry={reset} />}
        >
            {children}
        </ErrorBoundary>
    );
}
