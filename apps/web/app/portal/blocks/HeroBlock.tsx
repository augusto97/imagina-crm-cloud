import type { PortalRecord } from '../types';

interface Props {
    config: {
        title?: string;
        subtitle?: string;
        cta_label?: string;
        cta_href?: string;
        variant?: 'gradient' | 'solid' | 'plain';
        accent_color?: string | null;
        /**
         * Color de fondo opcional. Si está seteado, override del bg
         * del `variant` (el gradient/solid se reemplaza por este
         * color sólido). El `accent_color` sigue mandando en CTA
         * border. Si `background_color` es null/vacío, comportamiento
         * tradicional del variant.
         */
        background_color?: string | null;
        /** Color del texto. Si está vacío, white para gradient/solid y heredado para plain. */
        text_color?: string | null;
        align?: 'left' | 'center';
    };
    record: PortalRecord;
}

/**
 * Bloque `hero`. Saludo destacado con título grande + subtítulo + CTA.
 *
 * Interpolación: `{{slug}}` en `title` / `subtitle` se reemplaza por
 * el valor del campo `slug` del record cliente (escapado para evitar
 * inyección).
 *
 * Variantes:
 *  - `gradient` (default): fondo con gradient del accent
 *  - `solid`: bg sólido en accent
 *  - `plain`: sin fondo, con border
 *
 * Override: `background_color` y `text_color` opcionales pisan el
 * bg/color del variant — útil cuando el admin quiere un look custom
 * sin restringirse a la paleta del accent.
 */
export function HeroBlock({ config, record }: Props): JSX.Element {
    const title = interpolate(config.title ?? '', record);
    const subtitle = interpolate(config.subtitle ?? '', record);
    const ctaLabel = config.cta_label ?? '';
    const ctaHref = config.cta_href ?? '';
    const variant = config.variant ?? 'gradient';
    const align = config.align ?? 'left';
    const accent = config.accent_color ?? '#4f46e5';
    const bg = config.background_color ?? null;
    const textColor = config.text_color ?? null;

    const style: React.CSSProperties = {
        ['--imcrm-portal-hero-accent' as string]: accent,
    };
    if (bg !== null && bg !== '') {
        style.background = bg;
    }
    if (textColor !== null && textColor !== '') {
        style.color = textColor;
    }

    return (
        <section
            className={`imcrm-portal-block imcrm-portal-block--hero imcrm-portal-hero--${variant} imcrm-portal-hero--${align}`}
            style={style}
        >
            <div className="imcrm-portal-hero__body">
                {title !== '' && (
                    <h1 className="imcrm-portal-hero__title">{title}</h1>
                )}
                {subtitle !== '' && (
                    <p className="imcrm-portal-hero__subtitle">{subtitle}</p>
                )}
                {ctaLabel !== '' && ctaHref !== '' && (
                    <a
                        href={ctaHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="imcrm-portal-hero__cta"
                    >
                        {ctaLabel}
                    </a>
                )}
            </div>
        </section>
    );
}

/**
 * Reemplaza `{{slug}}` en `template` por el valor del campo `slug`
 * del record. Solo lee `record.fields` (no relations) y stringifica
 * el valor. Si el campo no existe o es null, deja la string vacía.
 */
function interpolate(template: string, record: PortalRecord): string {
    return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (_, slug: string) => {
        const value = record.fields[slug];
        if (value === null || value === undefined) return '';
        return String(value);
    });
}
