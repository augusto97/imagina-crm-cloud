import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Hook para gestionar el estado collapsed de un panel lateral del
 * editor (paleta o inspector). Persiste la preferencia en
 * localStorage por nombre — al volver al editor, el panel
 * recuerda si el usuario lo había colapsado.
 *
 * Compartido entre el editor de plantilla del CRM y el del portal
 * del cliente, así ambos exponen la misma UX sin código duplicado.
 */
export function useCollapsablePanel(
    storageKey: string,
    defaultValue = false,
): [boolean, (next: boolean) => void] {
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        try {
            const v = window.localStorage.getItem(storageKey);
            if (v === '1') return true;
            if (v === '0') return false;
            return defaultValue;
        } catch {
            return defaultValue;
        }
    });

    useEffect(() => {
        try {
            window.localStorage.setItem(storageKey, collapsed ? '1' : '0');
        } catch {
            /* localStorage bloqueado (modo privado): el state queda
             * en memoria igual, solo no persiste entre sesiones. */
        }
    }, [storageKey, collapsed]);

    return [collapsed, setCollapsed];
}

/**
 * Tira angosta (28px) que reemplaza al panel cuando está colapsado.
 * Click la re-expande. El icono apunta hacia donde va a abrirse el
 * panel (→ para left, ← para right) para sugerir la dirección.
 */
export function CollapsedPanelHandle({
    side,
    label,
    onClick,
}: {
    side: 'left' | 'right';
    label: string;
    onClick: () => void;
}): JSX.Element {
    const Icon = side === 'left' ? ChevronRight : ChevronLeft;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground imcrm-transition-colors"
        >
            <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
        </button>
    );
}

/**
 * Botón de colapsar pegado al borde interno del panel. Para
 * garantizar visibilidad sobre cualquier contenido (incluido el
 * header del InspectorPanel que ocupa la parte superior con
 * background sólido), usa:
 *  - Fondo propio (`bg-background`) + border sutil → claramente
 *    "afford click" sobre cualquier header opaco.
 *  - Tamaño 7×7 (un poco más grande que un icono solo) para que
 *    sea fácil de targetear.
 *  - `z-30` → garantiza estar arriba de headers sticky del panel
 *    que típicamente usan z-10 o z-20.
 */
export function CollapsePanelButton({
    side,
    label,
    onClick,
}: {
    side: 'left' | 'right';
    label: string;
    onClick: () => void;
}): JSX.Element {
    const Icon = side === 'left' ? ChevronLeft : ChevronRight;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={cn(
                'imcrm-absolute imcrm-top-2 imcrm-z-30 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-text-muted-foreground imcrm-shadow-imcrm-sm hover:imcrm-bg-accent hover:imcrm-text-foreground imcrm-transition-colors',
                side === 'left' ? 'imcrm-right-2' : 'imcrm-left-2',
            )}
        >
            <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
        </button>
    );
}
