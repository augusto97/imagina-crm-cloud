interface Props {
    config: {
        title?: string;
        body?: string;
        variant?: 'info' | 'success' | 'warning' | 'error' | 'announce';
        cta_label?: string;
        cta_href?: string;
        dismissible?: boolean;
    };
    /**
     * Callback que el padre (`PortalRenderer`) inyecta para sacar este
     * bloque del grid cuando el cliente clickea el botón de cerrar.
     * El state vive en el padre, no acá: si lo manejábamos local con
     * `useState`, el componente retornaba null pero el `<div className=
     * "imcrm-portal-grid__cell">` que lo wrappea seguía ocupando su
     * slot del grid, dejando un hueco vacío en lugar de dejar que los
     * bloques de abajo se desplazaran hacia arriba.
     */
    onDismiss?: () => void;
}

/**
 * Bloque `notice`. Banner alerta con icono, título y CTA opcional.
 *
 * Variantes con paleta independiente del accent del portal — los
 * colores semánticos son fijos para que info/warning/error sean
 * universalmente reconocibles.
 *
 * `dismissible`: si true, el cliente puede ocultarlo. El cierre
 * notifica al padre via `onDismiss`; no persiste entre recargas.
 */
export function NoticeBlock({ config, onDismiss }: Props): JSX.Element {
    const variant = config.variant ?? 'info';
    const body = config.body ?? '';
    const title = config.title ?? '';
    const ctaLabel = config.cta_label ?? '';
    const ctaHref = config.cta_href ?? '';

    return (
        <section
            className={`imcrm-portal-block imcrm-portal-block--notice imcrm-portal-notice--${variant}`}
            role={variant === 'error' || variant === 'warning' ? 'alert' : undefined}
        >
            <span className="imcrm-portal-notice__icon" aria-hidden>
                {iconFor(variant)}
            </span>
            <div className="imcrm-portal-notice__body">
                {title !== '' && (
                    <p className="imcrm-portal-notice__title">{title}</p>
                )}
                {body !== '' && (
                    <p className="imcrm-portal-notice__text">{body}</p>
                )}
                {ctaLabel !== '' && ctaHref !== '' && (
                    <a
                        href={ctaHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="imcrm-portal-notice__cta"
                    >
                        {ctaLabel} →
                    </a>
                )}
            </div>
            {config.dismissible === true && onDismiss !== undefined && (
                <button
                    type="button"
                    onClick={onDismiss}
                    className="imcrm-portal-notice__close"
                    aria-label="Cerrar"
                >
                    ✕
                </button>
            )}
        </section>
    );
}

function iconFor(variant: string): string {
    switch (variant) {
        case 'success':  return '✓';
        case 'warning':  return '⚠';
        case 'error':    return '✕';
        case 'announce': return '★';
        default:         return 'ⓘ';
    }
}
