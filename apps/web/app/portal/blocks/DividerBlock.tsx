interface Props {
    config: {
        label?: string;
        style?: 'solid' | 'dashed' | 'dotted';
    };
}

/**
 * Bloque `divider`. Separador visual con label opcional centrado.
 */
export function DividerBlock({ config }: Props): JSX.Element {
    const label = config.label ?? '';
    const style = config.style ?? 'solid';
    return (
        <section
            className={`imcrm-portal-block imcrm-portal-block--divider imcrm-portal-divider--${style} ${label !== '' ? 'imcrm-portal-divider--labeled' : ''}`}
        >
            <span className="imcrm-portal-divider__line" />
            {label !== '' && (
                <>
                    <span className="imcrm-portal-divider__label">{label}</span>
                    <span className="imcrm-portal-divider__line" />
                </>
            )}
        </section>
    );
}
