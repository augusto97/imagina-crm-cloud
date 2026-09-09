import { Check, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
    icon: LucideIcon;
    /** Hex del icono (el mismo tratamiento que los iconos de lista). */
    color?: string;
    name: string;
    subtitle: string;
    description?: string | null;
    /** Línea de conteos ("9 campos · 2 vistas"). */
    meta?: string;
    active: boolean;
    onClick: () => void;
}

/**
 * Tarjeta de plantilla (v0.1.168) — el formato de la galería de listas,
 * compartido por las galerías de dashboards y de automatizaciones: icono
 * con color, nombre + categoría, descripción en dos líneas y conteos.
 */
export function TemplateCard({ icon: Icon, color, name, subtitle, description, meta, active, onClick }: Props): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-group imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                active
                    ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary'
                    : 'imcrm-border-border imcrm-bg-card hover:imcrm-border-primary/40 hover:imcrm-bg-accent/30',
            )}
        >
            <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span
                    className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-inset imcrm-ring-border"
                    style={color ? { color } : undefined}
                >
                    <Icon className="imcrm-h-4 imcrm-w-4" />
                </span>
                <span className="imcrm-min-w-0 imcrm-flex-1">
                    {/* Dos líneas, no elipsis: los nombres de receta son largos y
                        "Correo de bienveni…" no dice nada. */}
                    <span className="imcrm-line-clamp-2 imcrm-text-sm imcrm-font-semibold imcrm-leading-tight">{name}</span>
                    <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{subtitle}</span>
                </span>
                {active && <Check className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />}
            </span>
            {description && (
                <span className="imcrm-line-clamp-2 imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{description}</span>
            )}
            {meta && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{meta}</span>}
        </button>
    );
}

/** Colores por categoría para las plantillas que no traen icono propio. */
export const TEMPLATE_CATEGORY_COLORS: Record<string, string> = {
    ventas: '#a855f7',
    clientes: '#0ea5e9',
    proyectos: '#eab308',
    operaciones: '#f97316',
    finanzas: '#22c55e',
    personas: '#14b8a6',
    otros: '#64748b',
    correo: '#0ea5e9',
    plazos: '#f97316',
    campos: '#a855f7',
    integraciones: '#14b8a6',
};
