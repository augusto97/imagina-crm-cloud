import { forwardRef } from 'react';
import {
    AlertTriangle,
    Archive,
    Bell,
    Calendar,
    Check,
    CheckCircle2,
    Clock,
    CreditCard,
    DollarSign,
    Download,
    ExternalLink,
    FileText,
    Flag,
    Gift,
    Link2,
    Loader2,
    Mail,
    MapPin,
    MessageCircle,
    MousePointerClick,
    Navigation,
    Phone,
    Play,
    Printer,
    RefreshCw,
    Rocket,
    Send,
    ShoppingCart,
    Star,
    ThumbsUp,
    Truck,
    User,
    XCircle,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import type { ButtonIcon } from '@imagina-base/shared';

import { chipSoftStyle, type OptionColor } from '@/components/ui/color-picker';
import { cn } from '@/lib/utils';

/** Iconos del campo «Botón» (las claves de `BUTTON_ICONS` de shared). */
export const BUTTON_ICON_COMPONENTS: Record<ButtonIcon, LucideIcon> = {
    check: Check,
    check_circle: CheckCircle2,
    zap: Zap,
    play: Play,
    send: Send,
    mail: Mail,
    phone: Phone,
    message: MessageCircle,
    map_pin: MapPin,
    navigation: Navigation,
    external_link: ExternalLink,
    link: Link2,
    file_text: FileText,
    download: Download,
    printer: Printer,
    dollar: DollarSign,
    credit_card: CreditCard,
    calendar: Calendar,
    clock: Clock,
    bell: Bell,
    flag: Flag,
    star: Star,
    thumbs_up: ThumbsUp,
    user: User,
    archive: Archive,
    refresh: RefreshCw,
    rocket: Rocket,
    truck: Truck,
    shopping_cart: ShoppingCart,
    gift: Gift,
    x_circle: XCircle,
    alert: AlertTriangle,
};

export interface FieldButtonViewProps {
    label: string;
    color?: string | null;
    icon?: string | null;
    disabled?: boolean;
    /** Por qué está deshabilitado (tooltip y lectores de pantalla). */
    reason?: string | null;
    loading?: boolean;
    /** `cell`: dentro de la tabla; `md`: la ficha; `full`: a lo ancho de su columna. */
    size?: 'cell' | 'md' | 'full';
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    className?: string;
    /** El editor y la vista previa lo dibujan sin acción. */
    inert?: boolean;
}

/**
 * Campo «Botón» — cómo se ve: el color elegido sólido (con la tinta que
 * contrasta, igual que los chips de opción) o el primario, su icono y su
 * texto. Deshabilitado se ve atenuado y el motivo va en el tooltip.
 */
export const FieldButtonView = forwardRef<HTMLButtonElement, FieldButtonViewProps>(function FieldButtonView(
    { label, color, icon, disabled = false, reason = null, loading = false, size = 'md', onClick, className, inert = false },
    ref,
) {
    const Icon = (icon ? BUTTON_ICON_COMPONENTS[icon as ButtonIcon] : undefined) ?? (size === 'cell' ? undefined : MousePointerClick);
    const style = color ? chipSoftStyle(color as OptionColor) : undefined;
    return (
        <button
            ref={ref}
            type="button"
            data-imcrm-button-field
            // Sin el atributo `disabled`: un botón deshabilitado no muestra su
            // tooltip (ni recibe el foco), y el motivo es lo que importa.
            aria-disabled={disabled || loading || undefined}
            aria-busy={loading || undefined}
            data-disabled={disabled || undefined}
            title={disabled && reason ? reason : label}
            aria-label={disabled && reason ? `${label}: ${reason}` : label}
            onClick={(e) => {
                e.stopPropagation();
                if (inert || disabled || loading) return;
                onClick?.(e);
            }}
            // En la tabla el click no debe ELEGIR la celda antes de presionar.
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            tabIndex={size === 'cell' ? -1 : undefined}
            className={cn(
                'imcrm-inline-flex imcrm-max-w-full imcrm-select-none imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-font-medium imcrm-transition',
                'focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring focus-visible:imcrm-ring-offset-1',
                !style && 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground',
                size === 'cell' && 'imcrm-h-6 imcrm-px-2 imcrm-text-[12px]',
                size === 'md' && 'imcrm-h-8 imcrm-px-3 imcrm-text-sm',
                size === 'full' && 'imcrm-h-9 imcrm-w-full imcrm-px-3 imcrm-text-sm',
                disabled || loading ? 'imcrm-cursor-not-allowed imcrm-opacity-50' : 'hover:imcrm-brightness-95 active:imcrm-brightness-90 imcrm-cursor-pointer',
                inert && 'imcrm-cursor-default',
                className,
            )}
            style={style}
        >
            {loading ? (
                <Loader2 className={cn('imcrm-shrink-0 imcrm-animate-spin', size === 'cell' ? 'imcrm-h-3 imcrm-w-3' : 'imcrm-h-4 imcrm-w-4')} aria-hidden />
            ) : (
                Icon && <Icon className={cn('imcrm-shrink-0', size === 'cell' ? 'imcrm-h-3 imcrm-w-3' : 'imcrm-h-4 imcrm-w-4')} aria-hidden />
            )}
            <span className="imcrm-min-w-0 imcrm-truncate">{label}</span>
        </button>
    );
});
