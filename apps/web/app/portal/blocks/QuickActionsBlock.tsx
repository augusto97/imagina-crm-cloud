interface QuickAction {
    icon: string;
    label: string;
    href: string;
    new_window?: boolean;
}

interface Props {
    config: {
        title?: string;
        items?: QuickAction[];
        columns?: 2 | 3 | 4;
    };
}

/**
 * Bloque `quick_actions`. Grid de N cards de acción, cada una con
 * icono + label + URL. Reemplaza el patrón de tener N bloques
 * `external_link` separados.
 *
 * Iconos: lookup de `icon` key contra una whitelist de strings que
 * se renderean como emoji unicode (cero JS adicional, cero deps
 * extras). Si el icon no existe en la whitelist, fallback a `↗`.
 */
export function QuickActionsBlock({ config }: Props): JSX.Element {
    const items = config.items ?? [];
    const columns = config.columns ?? 3;
    if (items.length === 0) return <></>;

    return (
        <section className={`imcrm-portal-block imcrm-portal-block--quick-actions imcrm-portal-actions--cols-${columns}`}>
            {config.title !== undefined && config.title !== '' && (
                <h2 className="imcrm-portal-block__title">{config.title}</h2>
            )}
            <div className="imcrm-portal-actions__grid">
                {items.map((it, i) => (
                    <a
                        key={i}
                        href={it.href || '#'}
                        target={it.new_window === false ? undefined : '_blank'}
                        rel={it.new_window === false ? undefined : 'noopener noreferrer'}
                        className="imcrm-portal-actions__item"
                    >
                        <span className="imcrm-portal-actions__icon" aria-hidden>
                            {iconFor(it.icon)}
                        </span>
                        <span className="imcrm-portal-actions__label">{it.label || '—'}</span>
                    </a>
                ))}
            </div>
        </section>
    );
}

function iconFor(key: string): string {
    const map: Record<string, string> = {
        link: '🔗',
        download: '⬇',
        upload: '⬆',
        'file-text': '📄',
        mail: '✉',
        phone: '📞',
        'message-circle': '💬',
        calendar: '📅',
        'credit-card': '💳',
        'help-circle': '?',
        settings: '⚙',
        user: '👤',
        shield: '🛡',
        zap: '⚡',
    };
    return map[key] ?? '↗';
}
