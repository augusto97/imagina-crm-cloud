import { Moon, Sun } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * v0.1.112 / v0.1.271 — claro ⇄ oscuro de la APP.
 *
 * El mismo botón de la barra superior. Los editores a pantalla completa
 * (correos, documentos, ficha y portal) tapan esa barra, así que cada uno lo
 * monta en su propia cabecera: si no, para ver el editor en el otro modo había
 * que salir, cambiarlo y volver a entrar. La preferencia es por navegador; el
 * tri-estado (con "Seguir al sistema") vive en Ajustes → Apariencia.
 */
export function ThemeToggle({ className, compact }: { className?: string; compact?: boolean }): JSX.Element {
    const theme = useTheme();
    const isDark = theme.resolved === 'dark';
    const Icon = isDark ? Sun : Moon;
    return (
        <button
            type="button"
            aria-label={isDark ? __('Cambiar a modo claro') : __('Cambiar a modo oscuro')}
            title={isDark ? __('Modo claro') : __('Modo oscuro')}
            data-theme-toggle={theme.resolved}
            onClick={theme.toggle}
            className={cn(
                'imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-bg-accent hover:imcrm-text-foreground',
                compact ? 'imcrm-h-8 imcrm-w-8' : 'imcrm-h-9 imcrm-w-9',
                className,
            )}
        >
            <Icon className="imcrm-h-4 imcrm-w-4" />
        </button>
    );
}
