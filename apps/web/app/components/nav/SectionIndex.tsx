import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface SectionIndexItem {
    id: string;
    label: string;
    icon: LucideIcon;
    hint?: string;
    to: string;
    /** Un número al costado (p. ej. cuántas empresas). */
    count?: string | null;
}

export interface SectionIndexGroup {
    label: string;
    items: SectionIndexItem[];
}

/**
 * v0.1.342 — El índice de una página con secciones (Ajustes, Plataforma) en el
 * celular: grupos de filas grandes con su ícono, una línea que dice para qué
 * sirve cada una y la flecha. Reemplaza al desplegable (`<select>`) y a la
 * tira de pestañas que se deslizaba de costado: una lista se recorre con la
 * vista, un desplegable obliga a abrirlo para saber qué hay.
 */
export function SectionIndex({ groups, testId }: { groups: SectionIndexGroup[]; testId?: string }): JSX.Element {
    return (
        <nav className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-testid={testId}>
            {groups.map((g) => (
                <section key={g.label} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <h2 className="imcrm-px-1 imcrm-text-[12px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">
                        {__(g.label)}
                    </h2>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card">
                        {g.items.map((i) => (
                            <li key={i.id}>
                                <Link
                                    to={i.to}
                                    data-section={i.id}
                                    className="imcrm-flex imcrm-min-h-[56px] imcrm-items-center imcrm-gap-3 imcrm-px-3.5 imcrm-py-2.5 imcrm-transition-colors active:imcrm-bg-muted/70 [@media(hover:hover)]:hover:imcrm-bg-muted/40"
                                >
                                    <span
                                        aria-hidden
                                        className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted imcrm-text-foreground/75"
                                    >
                                        <i.icon className="imcrm-h-[18px] imcrm-w-[18px]" />
                                    </span>
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                        <span className="imcrm-truncate imcrm-text-[15px] imcrm-text-foreground">{__(i.label)}</span>
                                        {i.hint && <span className="imcrm-line-clamp-2 imcrm-text-[12px] imcrm-leading-snug imcrm-text-muted-foreground">{__(i.hint)}</span>}
                                    </span>
                                    {i.count && (
                                        <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-[12px] imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground">
                                            {i.count}
                                        </span>
                                    )}
                                    <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </nav>
    );
}

/** «‹ Ajustes»: volver al índice desde una sección (celular). */
export function BackToIndex({ to, label, className }: { to: string; label: string; className?: string }): JSX.Element {
    return (
        <Link
            to={to}
            data-testid="section-back"
            className={cn(
                '-imcrm-ml-1 imcrm-inline-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-rounded-md imcrm-pr-2 imcrm-text-[15px] imcrm-font-medium imcrm-text-primary active:imcrm-bg-muted/60',
                className,
            )}
        >
            <ChevronLeft className="imcrm-h-5 imcrm-w-5" aria-hidden />
            {label}
        </Link>
    );
}
