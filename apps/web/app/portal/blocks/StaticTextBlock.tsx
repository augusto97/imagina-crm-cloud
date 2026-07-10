import { sanitizeHtml } from '@/lib/sanitize';

interface Props {
    config: {
        html?: string;
        title?: string;
        variant?: 'card' | 'plain' | 'bordered_left';
        /** Color hex del border-left (solo aplica a variant bordered_left). */
        accent_color?: string | null;
    };
}

/**
 * Bloque `static_text`. Renderiza HTML estático configurado por el
 * admin. Variantes:
 *  - `card` (default): border + bg, padding interno
 *  - `plain`: sin marco, fluye con el contexto
 *  - `bordered_left`: card con border-left de acento (4px), útil
 *    para citas, notas destacadas, anuncios suaves
 *
 * El HTML lo configura el admin, pero se renderiza en el navegador del
 * CLIENTE del portal (identidad de menor confianza), así que se sanitiza
 * con DOMPurify antes de inyectarlo (SEC-02).
 */
export function StaticTextBlock({ config }: Props): JSX.Element {
    const variant = config.variant ?? 'card';
    const variantClass =
        variant === 'plain'
            ? 'imcrm-portal-block--plain'
            : variant === 'bordered_left'
                ? 'imcrm-portal-block--bordered-left'
                : 'imcrm-portal-block--card';
    const style: React.CSSProperties | undefined =
        variant === 'bordered_left' && config.accent_color
            ? { borderLeftColor: config.accent_color }
            : undefined;
    return (
        <section
            className={`imcrm-portal-block imcrm-portal-block--static-text ${variantClass}`}
            style={style}
        >
            {config.title !== undefined && config.title !== '' ? (
                <h2 className="imcrm-portal-block__title">{config.title}</h2>
            ) : null}
            {config.html !== undefined && config.html !== '' ? (
                <div
                    className="imcrm-portal-block__content"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(config.html) }}
                />
            ) : null}
        </section>
    );
}
