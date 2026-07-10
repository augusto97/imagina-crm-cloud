import { sanitizeHref } from '@/lib/sanitize';

interface Props {
    config: {
        title?: string;
        description?: string;
        href?: string;
        label?: string;
        new_window?: boolean;
        variant?: 'button' | 'card_cta' | 'hero_cta';
        /** Hex (`#rrggbb`) que override el bg del botón o el accent del card. */
        accent_color?: string | null;
    };
}

/**
 * Bloque `external_link`. CTA con link a recurso externo.
 *
 * Variantes:
 *  - `button` (default) — botón centrado con label. Título y
 *    descripción se muestran arriba si están seteados.
 *  - `card_cta` — card con icono externo + título + descripción +
 *    label como link al pie. Más prominente, útil para "destacados".
 *
 * `accent_color` (hex opcional) overridea el primary del tema para
 * el bg del botón o el borde izquierdo del card.
 */
export function ExternalLinkBlock({ config }: Props): JSX.Element | null {
    const href = config.href?.trim() ?? '';
    if (href === '') return null;
    const safeHref = sanitizeHref(href);
    const variant = config.variant ?? 'button';
    const newWindow = config.new_window !== false;
    const accentStyle = config.accent_color
        ? ({ '--imcrm-portal-cta-accent': config.accent_color } as React.CSSProperties)
        : undefined;

    if (variant === 'hero_cta') {
        return (
            <section
                className="imcrm-portal-block imcrm-portal-block--external-link imcrm-portal-block--hero-cta"
                style={accentStyle}
            >
                <div className="imcrm-portal-hero-cta">
                    <div className="imcrm-portal-hero-cta__body">
                        {config.title !== undefined && config.title !== '' && (
                            <h2 className="imcrm-portal-hero-cta__title">{config.title}</h2>
                        )}
                        {config.description !== undefined && config.description !== '' && (
                            <p className="imcrm-portal-hero-cta__description">
                                {config.description}
                            </p>
                        )}
                    </div>
                    <a
                        href={safeHref}
                        target={newWindow ? '_blank' : undefined}
                        rel={newWindow ? 'noopener noreferrer' : undefined}
                        className="imcrm-portal-hero-cta__btn"
                    >
                        {config.label ?? 'Abrir'} →
                    </a>
                </div>
            </section>
        );
    }

    if (variant === 'card_cta') {
        return (
            <section
                className="imcrm-portal-block imcrm-portal-block--external-link imcrm-portal-block--cta-card"
                style={accentStyle}
            >
                <div className="imcrm-portal-cta-card">
                    <span className="imcrm-portal-cta-card__icon" aria-hidden>
                        ↗
                    </span>
                    <div className="imcrm-portal-cta-card__body">
                        {config.title !== undefined && config.title !== '' ? (
                            <h2 className="imcrm-portal-cta-card__title">{config.title}</h2>
                        ) : null}
                        {config.description !== undefined && config.description !== '' ? (
                            <p className="imcrm-portal-cta-card__description">
                                {config.description}
                            </p>
                        ) : null}
                        <a
                            href={safeHref}
                            target={newWindow ? '_blank' : undefined}
                            rel={newWindow ? 'noopener noreferrer' : undefined}
                            className="imcrm-portal-cta-card__link"
                        >
                            {config.label ?? 'Abrir'} →
                        </a>
                    </div>
                </div>
            </section>
        );
    }

    // variant === 'button'
    return (
        <section
            className="imcrm-portal-block imcrm-portal-block--external-link"
            style={accentStyle}
        >
            {config.title !== undefined && config.title !== '' ? (
                <h2 className="imcrm-portal-block__title">{config.title}</h2>
            ) : null}
            {config.description !== undefined && config.description !== '' ? (
                <p className="imcrm-portal-block__content">{config.description}</p>
            ) : null}
            <a
                href={safeHref}
                target={newWindow ? '_blank' : undefined}
                rel={newWindow ? 'noopener noreferrer' : undefined}
                className="imcrm-portal-card__btn imcrm-portal-external-link__btn"
            >
                {config.label ?? 'Abrir'}
            </a>
        </section>
    );
}
