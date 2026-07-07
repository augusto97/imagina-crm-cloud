import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

interface ErrorBoundaryProps {
    children: ReactNode;
    /** Mensaje contextual que se muestra al usuario cuando algo falla. */
    label?: string;
    /** Callback cuando el usuario decide volver atrás (cerrar el panel, etc.). */
    onReset?: () => void;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * Captura errores de React en su subárbol y muestra un fallback en
 * vez de dejar el dialog/panel en blanco. Útil envolviendo lazy chunks
 * de feature opcional (ej. AutomationVisualBuilder con React Flow):
 * si la dep externa rompe, al menos el form-based fallback queda
 * accesible.
 *
 * Suspense NO captura errores — sólo promesas pendientes; necesitamos
 * un ErrorBoundary class component para fallos de runtime.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // Log a la consola para que el dev pueda diagnosticar; en
        // producción el usuario verá sólo el mensaje del fallback.
        // eslint-disable-next-line no-console
        console.error('[ImaginaCRM] ErrorBoundary caught:', error, info);
    }

    private handleReset = (): void => {
        this.setState({ error: null });
        this.props.onReset?.();
    };

    render(): ReactNode {
        if (this.state.error) {
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-4 imcrm-text-sm imcrm-text-destructive">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        <strong>
                            {this.props.label ?? __('Algo falló al renderizar este componente.')}
                        </strong>
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {this.state.error.message}
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
