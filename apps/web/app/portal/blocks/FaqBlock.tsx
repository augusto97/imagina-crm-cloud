import { useState } from 'react';

interface FaqItem {
    question: string;
    answer: string;
}

interface Props {
    config: {
        title?: string;
        items?: FaqItem[];
    };
}

/**
 * Bloque `faq`. Acordeón Q&A. Una pregunta abierta a la vez (estándar
 * de UI accordion), click toggle abre/cierra.
 */
export function FaqBlock({ config }: Props): JSX.Element {
    const items = config.items ?? [];
    const [openIdx, setOpenIdx] = useState<number | null>(null);

    if (items.length === 0) return <></>;

    return (
        <section className="imcrm-portal-block imcrm-portal-block--faq">
            {config.title !== undefined && config.title !== '' && (
                <h2 className="imcrm-portal-block__title">{config.title}</h2>
            )}
            <ul className="imcrm-portal-faq__list">
                {items.map((it, i) => {
                    const isOpen = openIdx === i;
                    return (
                        <li key={i} className={`imcrm-portal-faq__item ${isOpen ? 'imcrm-portal-faq__item--open' : ''}`}>
                            <button
                                type="button"
                                onClick={() => setOpenIdx(isOpen ? null : i)}
                                className="imcrm-portal-faq__question"
                                aria-expanded={isOpen}
                            >
                                <span>{it.question}</span>
                                <span className="imcrm-portal-faq__chevron" aria-hidden>
                                    {isOpen ? '−' : '+'}
                                </span>
                            </button>
                            {isOpen && it.answer !== '' && (
                                <div className="imcrm-portal-faq__answer">
                                    {it.answer.split('\n\n').map((para, p) => (
                                        <p key={p}>{para}</p>
                                    ))}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
