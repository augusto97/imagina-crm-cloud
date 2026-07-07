interface Props {
    config: {
        text?: string;
        eyebrow?: string;
        level?: 1 | 2 | 3;
        align?: 'left' | 'center';
        accent_color?: string | null;
    };
}

/**
 * Bloque `heading`. Heading h1/h2/h3 con eyebrow opcional,
 * alineación y color de acento para el eyebrow.
 */
export function HeadingBlock({ config }: Props): JSX.Element {
    const text = config.text ?? '';
    const eyebrow = config.eyebrow ?? '';
    const level = config.level ?? 2;
    const align = config.align ?? 'left';
    const accent = config.accent_color ?? null;

    const accentStyle: React.CSSProperties = accent ? { color: accent } : {};

    const HeadingTag = (`h${level}` as 'h1' | 'h2' | 'h3');

    return (
        <section
            className={`imcrm-portal-block imcrm-portal-block--heading imcrm-portal-heading--${align} imcrm-portal-heading--h${level}`}
        >
            {eyebrow !== '' && (
                <p className="imcrm-portal-heading__eyebrow" style={accentStyle}>
                    {eyebrow}
                </p>
            )}
            <HeadingTag className="imcrm-portal-heading__text">{text}</HeadingTag>
        </section>
    );
}
