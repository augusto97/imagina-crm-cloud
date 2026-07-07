interface Props {
    config: {
        title?: string;
        name?: string;
        role?: string;
        avatar_url?: string;
        email?: string;
        phone?: string;
        whatsapp?: string;
    };
}

/**
 * Bloque `contact_card`. Tarjeta del asesor con avatar (URL o
 * iniciales), nombre, rol y botones de contacto (email/tel/whatsapp).
 *
 * WhatsApp: el número debe venir con código país sin `+` (formato
 * wa.me). Mensaje predefinido en español.
 */
export function ContactCardBlock({ config }: Props): JSX.Element {
    const name = config.name ?? '';
    const role = config.role ?? '';
    const avatar = config.avatar_url ?? '';
    const email = config.email ?? '';
    const phone = config.phone ?? '';
    const whatsapp = config.whatsapp ?? '';
    const title = config.title ?? '';

    const initials = name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0] ?? '')
        .join('')
        .toUpperCase();

    return (
        <section className="imcrm-portal-block imcrm-portal-block--contact-card">
            {title !== '' && (
                <p className="imcrm-portal-contact__eyebrow">{title}</p>
            )}
            <div className="imcrm-portal-contact__header">
                {avatar !== '' ? (
                    <img
                        src={avatar}
                        alt=""
                        className="imcrm-portal-contact__avatar"
                    />
                ) : (
                    <div className="imcrm-portal-contact__avatar imcrm-portal-contact__avatar--initials">
                        {initials !== '' ? initials : '👤'}
                    </div>
                )}
                <div className="imcrm-portal-contact__info">
                    {name !== '' && (
                        <p className="imcrm-portal-contact__name">{name}</p>
                    )}
                    {role !== '' && (
                        <p className="imcrm-portal-contact__role">{role}</p>
                    )}
                </div>
            </div>
            <div className="imcrm-portal-contact__actions">
                {email !== '' && (
                    <a
                        href={`mailto:${email}`}
                        className="imcrm-portal-contact__action imcrm-portal-contact__action--email"
                    >
                        <span aria-hidden>✉</span>
                        <span>Email</span>
                    </a>
                )}
                {phone !== '' && (
                    <a
                        href={`tel:${phone.replace(/[^+\d]/g, '')}`}
                        className="imcrm-portal-contact__action imcrm-portal-contact__action--phone"
                    >
                        <span aria-hidden>📞</span>
                        <span>Llamar</span>
                    </a>
                )}
                {whatsapp !== '' && (
                    <a
                        href={`https://wa.me/${whatsapp.replace(/[^\d]/g, '')}?text=${encodeURIComponent('Hola, te escribo desde el portal.')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="imcrm-portal-contact__action imcrm-portal-contact__action--whatsapp"
                    >
                        <span aria-hidden>💬</span>
                        <span>WhatsApp</span>
                    </a>
                )}
            </div>
        </section>
    );
}
